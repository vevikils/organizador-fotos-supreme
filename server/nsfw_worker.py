#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
server/nsfw_worker.py
Trabajador de Inteligencia Artificial para Deteccion de Contenido Sensible (NSFW)
Usa modelos Vision Transformer (ViT) locales optimizados:
- Falconsai/nsfw_image_detection (224x224, ultrarrapido y preciso)
- AdamCodd/vit-base-nsfw-detector
"""

import sys
import os
import time
import json
import sqlite3
import argparse
from pathlib import Path
from PIL import Image

# Forzar codificacion UTF-8 en Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

_model = None
_processor = None
_model_name = None
_device = None

def get_base_dir():
    return Path(__file__).resolve().parent.parent

def get_db_path():
    return get_base_dir() / "data" / "photos.db"

def resolve_target_path(base_dir, thumb_path, file_path):
    """
    Resuelve la ruta optima para clasificar:
    Primero busca la miniatura en cache (ultrarrapida para ViT).
    Si no existe, recurre al archivo original.
    """
    if thumb_path:
        clean_thumb = thumb_path.lstrip('/\\')
        full_thumb = base_dir / clean_thumb
        if full_thumb.exists():
            return str(full_thumb)
        if os.path.exists(thumb_path):
            return thumb_path

    if file_path and os.path.exists(file_path):
        return file_path

    return None

def init_model():
    """Carga el modelo ViT desde la cache local o directorio de modelos"""
    global _model, _processor, _model_name, _device
    if _model is not None:
        return _model, _processor

    import torch
    from transformers import AutoModelForImageClassification, ViTImageProcessor

    # Configurar hilos optimos en CPU
    if hasattr(torch, 'set_num_threads'):
        torch.set_num_threads(max(1, min(os.cpu_count() or 4, 8)))

    _device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    
    # Prioridad: modelo local en Documents/nsfw_image_detection (224x224 super optimizado)
    user_docs = Path(os.path.expanduser("~")) / "Documents" / "nsfw_image_detection"
    candidates = []
    if user_docs.exists():
        candidates.append(str(user_docs))
    
    candidates.extend([
        "Falconsai/nsfw_image_detection",
        "AdamCodd/vit-base-nsfw-detector"
    ])
    
    loaded = False
    for candidate in candidates:
        try:
            _processor = ViTImageProcessor.from_pretrained(candidate, local_files_only=True)
            _model = AutoModelForImageClassification.from_pretrained(candidate, local_files_only=True)
            _model.to(_device)
            _model.eval()
            _model_name = candidate if candidate != str(user_docs) else "Falconsai/nsfw_image_detection (local)"
            loaded = True
            break
        except Exception:
            continue

    if not loaded:
        for candidate in ["Falconsai/nsfw_image_detection", "AdamCodd/vit-base-nsfw-detector"]:
            try:
                _processor = ViTImageProcessor.from_pretrained(candidate)
                _model = AutoModelForImageClassification.from_pretrained(candidate)
                _model.to(_device)
                _model.eval()
                _model_name = candidate
                loaded = True
                break
            except Exception:
                continue

    if not loaded:
        raise RuntimeError("No se pudo cargar ningun modelo NSFW (local ni remoto)")

    return _model, _processor

def safe_preprocess_pil(img):
    """
    Asegura que la imagen sea RGB y tenga dimensiones minimas de 224x224
    para evitar el error de canal ambiguo (1, 1, 3) en Hugging Face Transformers.
    """
    if img.mode != 'RGB':
        img = img.convert('RGB')
    if img.width < 224 or img.height < 224:
        img = img.resize((224, 224), Image.Resampling.BILINEAR)
    return img

def classify_images(images):
    """
    Clasifica una lista de imagenes PIL en un unico lote.
    Devuelve lista de dicts con {'label', 'score', 'is_nsfw'}
    """
    if not images:
        return []

    import torch
    model, processor = init_model()

    preprocessed = [safe_preprocess_pil(im) for im in images]
    inputs = processor(images=preprocessed, return_tensors="pt").to(_device)

    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.softmax(outputs.logits, dim=1)
        preds = outputs.logits.argmax(-1).tolist()

    results = []
    for i, pred in enumerate(preds):
        raw_label = str(model.config.id2label[pred]).lower()
        score = probs[i][pred].item()

        # Normalizar label y score
        is_nsfw = 1 if ('nsfw' in raw_label or 'porn' in raw_label or 'sexy' in raw_label) and score >= 0.5 else 0
        norm_label = 'nsfw' if is_nsfw else 'sfw'

        results.append({
            'label': norm_label,
            'raw_label': raw_label,
            'score': round(score, 4),
            'is_nsfw': is_nsfw
        })
    return results

def classify_single_file(file_path):
    """Clasifica un archivo individual en disco"""
    try:
        with Image.open(file_path) as img:
            if img.width < 32 or img.height < 32:
                return {'file_path': file_path, 'is_nsfw': 0, 'score': 0.0, 'label': 'sfw', 'raw_label': 'tiny_asset'}
            res = classify_images([img])[0]
            res['file_path'] = file_path
            return res
    except Exception as e:
        return {'error': str(e), 'file_path': file_path, 'is_nsfw': 0, 'score': 0.0, 'label': 'sfw'}

def scan_database(batch_size=16, threshold=0.55):
    """
    Escaner continuo directo sobre SQLite.
    Emite lineas JSON para que Node.js las consuma y envie por SSE.
    """
    base_dir = get_base_dir()
    db_path = get_db_path()
    if not db_path.exists():
        print(json.dumps({"type": "error", "message": f"Base de datos no encontrada en {db_path}"}), flush=True)
        return

    init_model()
    print(json.dumps({"type": "ready", "model": _model_name}), flush=True)

    conn = sqlite3.connect(str(db_path), timeout=60.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM photos WHERE nsfw_checked = 0 AND is_deleted = 0")
    total_unclassified = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM photos WHERE is_deleted = 0")
    total_photos = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND is_nsfw = 1")
    nsfw_count = cursor.fetchone()[0]

    print(json.dumps({
        "type": "start",
        "total_unclassified": total_unclassified,
        "total_photos": total_photos,
        "nsfw_total": nsfw_count
    }), flush=True)

    if total_unclassified == 0:
        print(json.dumps({"type": "complete", "processed": 0, "nsfw_found": nsfw_count}), flush=True)
        conn.close()
        return

    processed_count = 0

    while True:
        cursor.execute("""
            SELECT id, file_path, thumbnail_path, file_name 
            FROM photos 
            WHERE nsfw_checked = 0 AND is_deleted = 0
            LIMIT ?
        """, (batch_size,))
        rows = cursor.fetchall()

        if not rows:
            break

        to_classify_images = []
        to_classify_rows = []
        already_handled_updates = []

        for row in rows:
            photo_id, file_path, thumb_path, file_name = row
            target_path = resolve_target_path(base_dir, thumb_path, file_path)

            if not target_path or not os.path.exists(target_path):
                # Archivo no encontrado en disco, marcar como revisado SFW para no bloquear
                already_handled_updates.append((0, 0.0, 'sfw', photo_id, file_name))
                continue

            try:
                img = Image.open(target_path)
                # Si es un icono o imagen diminuta (< 32x32), marcar segura de inmediato sin inferencia
                if img.width < 32 or img.height < 32:
                    img.close()
                    already_handled_updates.append((0, 0.0, 'sfw', photo_id, file_name))
                else:
                    to_classify_images.append(img)
                    to_classify_rows.append(row)
            except Exception:
                # Imagen corrupta o formato no compatible, marcar segura
                already_handled_updates.append((0, 0.0, 'sfw', photo_id, file_name))

        # Registrar las que se resolvieron inmediatamente (diminutas, inexistentes o corruptas)
        for is_nsfw, score, label, photo_id, file_name in already_handled_updates:
            cursor.execute("""
                UPDATE photos 
                SET is_nsfw = ?, nsfw_score = ?, nsfw_label = ?, nsfw_checked = 1 
                WHERE id = ?
            """, (is_nsfw, score, label, photo_id))
            processed_count += 1
            print(json.dumps({
                "type": "progress",
                "id": photo_id,
                "file_name": file_name,
                "is_nsfw": is_nsfw,
                "score": score,
                "label": label,
                "processed": processed_count,
                "total": total_unclassified,
                "nsfw_total": nsfw_count
            }), flush=True)

        # Clasificar las imagenes validas con la IA
        if to_classify_images:
            try:
                preds = classify_images(to_classify_images)
                for (row, pred) in zip(to_classify_rows, preds):
                    photo_id, file_path, thumb_path, file_name = row
                    is_nsfw = 1 if pred['is_nsfw'] and pred['score'] >= threshold else 0
                    score = pred['score']
                    label = pred['label']

                    if is_nsfw:
                        nsfw_count += 1

                    cursor.execute("""
                        UPDATE photos 
                        SET is_nsfw = ?, nsfw_score = ?, nsfw_label = ?, nsfw_checked = 1 
                        WHERE id = ?
                    """, (is_nsfw, score, label, photo_id))

                    processed_count += 1

                    print(json.dumps({
                        "type": "progress",
                        "id": photo_id,
                        "file_name": file_name,
                        "is_nsfw": is_nsfw,
                        "score": score,
                        "label": label,
                        "processed": processed_count,
                        "total": total_unclassified,
                        "nsfw_total": nsfw_count
                    }), flush=True)

            except Exception as e:
                # Fallback seguro: procesar una por una para que ninguna anomalia detenga el proceso
                sys.stderr.write(f"Aviso lote en bloque: {e}. Procesando individualmente...\n")
                sys.stderr.flush()

                for (row, img) in zip(to_classify_rows, to_classify_images):
                    photo_id, file_path, thumb_path, file_name = row
                    try:
                        single_pred = classify_images([img])[0]
                        is_nsfw = 1 if single_pred['is_nsfw'] and single_pred['score'] >= threshold else 0
                        score = single_pred['score']
                        label = single_pred['label']
                    except Exception:
                        is_nsfw = 0
                        score = 0.0
                        label = 'sfw'

                    if is_nsfw:
                        nsfw_count += 1

                    cursor.execute("""
                        UPDATE photos 
                        SET is_nsfw = ?, nsfw_score = ?, nsfw_label = ?, nsfw_checked = 1 
                        WHERE id = ?
                    """, (is_nsfw, score, label, photo_id))

                    processed_count += 1

                    print(json.dumps({
                        "type": "progress",
                        "id": photo_id,
                        "file_name": file_name,
                        "is_nsfw": is_nsfw,
                        "score": score,
                        "label": label,
                        "processed": processed_count,
                        "total": total_unclassified,
                        "nsfw_total": nsfw_count
                    }), flush=True)

            finally:
                for img in to_classify_images:
                    try:
                        img.close()
                    except Exception:
                        pass

        # Siempre confirmar las transacciones de este lote
        conn.commit()

    conn.commit()
    conn.close()

    print(json.dumps({
        "type": "complete",
        "processed": processed_count,
        "nsfw_found": nsfw_count
    }), flush=True)

def main():
    parser = argparse.ArgumentParser(description="NSFW AI Classifier Worker")
    parser.add_argument("--scan", action="store_true", help="Escanear fotos no clasificadas en photos.db")
    parser.add_argument("--test", action="store_true", help="Verificar que el modelo carga e infiere correctamente")
    parser.add_argument("--file", type=str, help="Clasificar un archivo de imagen especifico")
    parser.add_argument("--batch-size", type=int, default=16, help="Tamano de lote para inferencia (def: 16)")
    parser.add_argument("--threshold", type=float, default=0.55, help="Umbral de confianza NSFW (def: 0.55)")
    args = parser.parse_args()

    if args.test:
        print("Iniciando prueba de modelo...")
        init_model()
        dummy = Image.new('RGB', (224, 224), color=(100, 150, 200))
        res = classify_images([dummy])[0]
        print(json.dumps({"status": "ok", "model": _model_name, "test_result": res}, indent=2))
        return

    if args.file:
        res = classify_single_file(args.file)
        print(json.dumps(res, indent=2))
        return

    if args.scan:
        scan_database(batch_size=args.batch_size, threshold=args.threshold)
        return

    scan_database(batch_size=args.batch_size, threshold=args.threshold)

if __name__ == "__main__":
    main()
