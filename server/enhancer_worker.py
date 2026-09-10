#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
server/enhancer_worker.py
Motor de Inteligencia Artificial para Super-Resolución y Restauración de Fotos Antiguas
- Real-ESRGAN v3 Compact ONNX (4x Super-Resolution & Denoise)
- Restauración de color, contraste (CLAHE en LAB) y balance de blancos para fotos vintage
- Procesamiento en mosaicos (tiling) con solapamiento para soportar cualquier resolución sin límite de RAM
- Detección y realce facial adaptativo con OpenCV YuNet
"""

import sys
import os
import time
import json
import argparse
from pathlib import Path
import cv2
import numpy as np

# Forzar codificación UTF-8 en Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def send_message(msg_type, **kwargs):
    payload = {"type": msg_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=True), flush=True)

def read_image_utf8(path_str):
    """Lee una imagen soportando caracteres Unicode y rutas de Windows."""
    try:
        data = np.fromfile(path_str, dtype=np.uint8)
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        return None

def write_image_utf8(path_str, img, quality=95):
    """Guarda una imagen soportando caracteres Unicode y rutas de Windows."""
    try:
        ext = Path(path_str).suffix.lower()
        if ext in ['.png']:
            params = [cv2.IMWRITE_PNG_COMPRESSION, 4]
        else:
            params = [cv2.IMWRITE_JPEG_QUALITY, quality]
        success, encoded = cv2.imencode(ext if ext else '.jpg', img, params)
        if success:
            encoded.tofile(path_str)
            return True
        return False
    except Exception as e:
        return False

def restore_vintage_color(img):
    """
    Restaura colores descoloridos, corrige tintes amarillentos (vintage) 
    y realza el rango dinámico mediante CLAHE en espacio LAB.
    """
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    
    # Ecualización adaptativa de contraste (CLAHE) en el canal de luminancia
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    l_restored = clahe.apply(l)
    
    # Corrección suave de balance de blancos en canales cromáticos
    a_mean = float(np.mean(a))
    b_mean = float(np.mean(b))
    
    a_corr = np.clip(a.astype(np.float32) - 0.5 * (a_mean - 128.0), 0, 255).astype(np.uint8)
    b_corr = np.clip(b.astype(np.float32) - 0.5 * (b_mean - 128.0), 0, 255).astype(np.uint8)
    
    restored_lab = cv2.merge((l_restored, a_corr, b_corr))
    return cv2.cvtColor(restored_lab, cv2.COLOR_LAB2BGR)

def apply_denoise(img):
    """Elimina grano analógico y ruido de digitalización preservando bordes."""
    return cv2.bilateralFilter(img, d=7, sigmaColor=35, sigmaSpace=35)

def apply_unsharp_mask(img, amount=0.9, radius=1.3, threshold=2):
    """Aplica máscara de enfoque inteligente para recuperar micro-texturas."""
    blurred = cv2.GaussianBlur(img, (0, 0), radius)
    low_contrast = np.abs(img.astype(np.int16) - blurred.astype(np.int16)) < threshold
    sharpened = np.clip(img.astype(np.float32) * (1.0 + amount) - blurred.astype(np.float32) * amount, 0, 255).astype(np.uint8)
    sharpened[low_contrast] = img[low_contrast]
    return sharpened

def enhance_faces_with_yunet(img, yunet_model_path):
    """Detecta rostros con YuNet y aplica un realce facial suave."""
    if not os.path.exists(yunet_model_path):
        return img
    try:
        h, w = img.shape[:2]
        detector = cv2.FaceDetectorYN.create(
            str(yunet_model_path), "", (w, h),
            score_threshold=0.6, nms_threshold=0.3, top_k=20
        )
        faces = detector.detect(img)[1]
        if faces is None or len(faces) == 0:
            return img

        result = img.copy()
        for face in faces:
            fx, fy, fw, fh = [int(v) for v in face[:4]]
            pad_x = int(fw * 0.15)
            pad_y = int(fh * 0.15)
            x1 = max(0, fx - pad_x)
            y1 = max(0, fy - pad_y)
            x2 = min(w, fx + fw + pad_x)
            y2 = min(h, fy + fh + pad_y)

            crop = result[y1:y2, x1:x2]
            if crop.shape[0] < 10 or crop.shape[1] < 10:
                continue

            face_sharp = apply_unsharp_mask(crop, amount=0.6, radius=1.0, threshold=2)
            
            # Máscara elíptica difusa
            mask = np.zeros((y2 - y1, x2 - x1), dtype=np.float32)
            center = ((x2 - x1) // 2, (y2 - y1) // 2)
            axes = ((x2 - x1) // 2, (y2 - y1) // 2)
            cv2.ellipse(mask, center, axes, 0, 0, 360, 1.0, -1)
            mask = cv2.GaussianBlur(mask, (21, 21), 11)
            mask_3c = np.repeat(mask[:, :, np.newaxis], 3, axis=2)

            blended = (crop.astype(np.float32) * (1.0 - mask_3c) + face_sharp.astype(np.float32) * mask_3c).astype(np.uint8)
            result[y1:y2, x1:x2] = blended

        return result
    except Exception as e:
        return img

def upscale_with_realesrgan(img, model_path, tile_size=400, tile_pad=32):
    """
    Ejecuta la super-resolución 4x usando Real-ESRGAN v3 ONNX con inferencia por teselas (tiling).
    """
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    session = ort.InferenceSession(str(model_path), sess_options=opts, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name
    scale = 4

    h, w, c = img.shape
    if max(h, w) <= tile_size:
        send_message("progress", percent=45, step="Mejorando imagen con Real-ESRGAN IA...")
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        img_t = np.transpose(img_rgb, (2, 0, 1))[np.newaxis, ...]
        out_t = session.run(None, {input_name: img_t})[0]
        out_img = np.transpose(out_t[0], (1, 2, 0))
        out_img = np.clip(out_img * 255.0, 0, 255).astype(np.uint8)
        return cv2.cvtColor(out_img, cv2.COLOR_RGB2BGR)

    out_h = h * scale
    out_w = w * scale
    output_img = np.zeros((out_h, out_w, c), dtype=np.uint8)

    tiles_x = int(np.ceil(w / tile_size))
    tiles_y = int(np.ceil(h / tile_size))
    total_tiles = tiles_x * tiles_y
    current_tile = 0

    send_message("progress", percent=20, step=f"Dividiendo en {total_tiles} teselas para máxima calidad...")

    for yi in range(tiles_y):
        for xi in range(tiles_x):
            current_tile += 1
            percent = int(20 + (current_tile / total_tiles) * 60)
            send_message("progress", percent=percent, step=f"Procesando tesela {current_tile} de {total_tiles}...")

            x = xi * tile_size
            y = yi * tile_size
            w_box = min(tile_size, w - x)
            h_box = min(tile_size, h - y)

            x_pad_start = max(0, x - tile_pad)
            y_pad_start = max(0, y - tile_pad)
            x_pad_end = min(w, x + w_box + tile_pad)
            y_pad_end = min(h, y + h_box + tile_pad)

            tile_in = img[y_pad_start:y_pad_end, x_pad_start:x_pad_end]
            tile_rgb = cv2.cvtColor(tile_in, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            tile_t = np.transpose(tile_rgb, (2, 0, 1))[np.newaxis, ...]

            tile_out_t = session.run(None, {input_name: tile_t})[0]
            tile_out = np.transpose(tile_out_t[0], (1, 2, 0))
            tile_out = np.clip(tile_out * 255.0, 0, 255).astype(np.uint8)
            tile_out_bgr = cv2.cvtColor(tile_out, cv2.COLOR_RGB2BGR)

            pad_left = (x - x_pad_start) * scale
            pad_top = (y - y_pad_start) * scale
            pad_right = pad_left + w_box * scale
            pad_bottom = pad_top + h_box * scale

            tile_cropped = tile_out_bgr[pad_top:pad_bottom, pad_left:pad_right]
            output_img[y * scale:(y + h_box) * scale, x * scale:(x + w_box) * scale] = tile_cropped

    return output_img

def main():
    parser = argparse.ArgumentParser(description="Restaurador y Mejorador de Fotos Antiguas por IA")
    parser.add_argument("--input", required=True, help="Ruta de la foto original")
    parser.add_argument("--output", required=True, help="Ruta del archivo de salida")
    parser.add_argument("--scale", type=int, default=4, choices=[1, 2, 4], help="Factor de escalado (1, 2 o 4)")
    parser.add_argument("--color_restore", action="store_true", help="Restaurar colores y contraste vintage")
    parser.add_argument("--denoise", action="store_true", help="Eliminar grano y ruido antiguo")
    parser.add_argument("--unsharp", action="store_true", help="Mejorar nitidez y detalles de texturas")
    parser.add_argument("--face_enhance", action="store_true", help="Realce facial inteligente con YuNet")

    args = parser.parse_args()
    t0 = time.time()

    send_message("progress", percent=5, step="Iniciando motor de IA y cargando imagen...")

    input_path = Path(args.input)
    if not input_path.exists():
        send_message("error", error=f"El archivo no existe: {args.input}")
        sys.exit(1)

    img = read_image_utf8(str(input_path))
    if img is None:
        send_message("error", error=f"No se pudo decodificar la imagen: {args.input}")
        sys.exit(1)

    orig_h, orig_w = img.shape[:2]
    send_message("progress", percent=10, step=f"Imagen cargada ({orig_w}x{orig_h}). Aplicando restauraciones...")

    if args.denoise:
        send_message("progress", percent=12, step="Eliminando ruido y granulado antiguo...")
        img = apply_denoise(img)

    if args.color_restore:
        send_message("progress", percent=15, step="Restaurando balance de color y luminancia vintage...")
        img = restore_vintage_color(img)

    models_dir = Path(__file__).resolve().parent / "models"
    model_path = models_dir / "realesr-general-x4v3.onnx"

    if not model_path.exists():
        send_message("error", error=f"Modelo no encontrado en: {model_path}")
        sys.exit(1)

    enhanced_img = upscale_with_realesrgan(img, model_path)

    if args.scale == 2:
        send_message("progress", percent=82, step="Ajustando a resolución HD 2x...")
        target_w = orig_w * 2
        target_h = orig_h * 2
        enhanced_img = cv2.resize(enhanced_img, (target_w, target_h), interpolation=cv2.INTER_AREA)
    elif args.scale == 1:
        send_message("progress", percent=82, step="Ajustando a resolución original optimizada...")
        enhanced_img = cv2.resize(enhanced_img, (orig_w, orig_h), interpolation=cv2.INTER_AREA)

    if args.face_enhance:
        send_message("progress", percent=87, step="Realzando nitidez de rostros detectados...")
        yunet_path = models_dir / "face_detection_yunet_2023mar.onnx"
        enhanced_img = enhance_faces_with_yunet(enhanced_img, yunet_path)

    if args.unsharp:
        send_message("progress", percent=92, step="Acentuando detalles de texturas...")
        enhanced_img = apply_unsharp_mask(enhanced_img, amount=0.7, radius=1.2, threshold=2)

    send_message("progress", percent=96, step="Guardando imagen mejorada en alta definición...")
    os.makedirs(Path(args.output).parent, exist_ok=True)
    saved = write_image_utf8(args.output, enhanced_img, quality=95)
    if not saved:
        send_message("error", error=f"No se pudo escribir el archivo de salida: {args.output}")
        sys.exit(1)

    final_h, final_w = enhanced_img.shape[:2]
    elapsed = round(time.time() - t0, 2)

    send_message("progress", percent=100, step="¡Mejora completada con éxito!")
    send_message("done", 
        success=True,
        input_dims={"width": orig_w, "height": orig_h},
        output_dims={"width": final_w, "height": final_h},
        scale=args.scale,
        elapsed_seconds=elapsed,
        output_path=args.output
    )

if __name__ == "__main__":
    main()
