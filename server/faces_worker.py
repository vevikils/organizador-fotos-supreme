#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
server/faces_worker.py
Trabajador de Inteligencia Artificial para Deteccion y Reconocimiento Facial
Utiliza:
- OpenCV YuNet (FaceDetectorYN): Deteccion ultrarrapida de rostros y landmarks
- OpenCV SFace (FaceRecognizerSF): Alineacion de rostros y extraccion de embeddings de 128D
- scikit-learn AgglomerativeClustering: Agrupamiento de caras de la misma persona
"""

import sys
import os
import time
import json
import sqlite3
import argparse
from pathlib import Path
import cv2
import numpy as np

# Forzar codificacion UTF-8 en Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

_detector = None
_recognizer = None

def get_base_dir():
    return Path(__file__).resolve().parent.parent

def get_db_path():
    env_storage = os.environ.get('ORGANIZADOR_STORAGE_DIR')
    if env_storage:
        return Path(env_storage) / "data" / "photos.db"
    return get_base_dir() / "data" / "photos.db"

def get_models_dir():
    return Path(__file__).resolve().parent / "models"

def get_faces_cache_dir():
    env_storage = os.environ.get('ORGANIZADOR_STORAGE_DIR')
    if env_storage:
        faces_dir = Path(env_storage) / "cache" / "faces"
    else:
        faces_dir = get_base_dir() / "cache" / "faces"
    faces_dir.mkdir(parents=True, exist_ok=True)
    return faces_dir

def init_models():
    """Inicializa los modelos YuNet y SFace de OpenCV Zoo"""
    global _detector, _recognizer
    if _detector is not None and _recognizer is not None:
        return _detector, _recognizer

    models_dir = get_models_dir()
    yunet_path = models_dir / "face_detection_yunet_2023mar.onnx"
    sface_path = models_dir / "face_recognition_sface_2021dec.onnx"

    if not yunet_path.exists() or not sface_path.exists():
        raise RuntimeError(f"Modelos faciales no encontrados en {models_dir}")

    _detector = cv2.FaceDetectorYN.create(
        model=str(yunet_path),
        config="",
        input_size=(320, 320),
        score_threshold=0.6,
        nms_threshold=0.3,
        top_k=5000
    )

    _recognizer = cv2.FaceRecognizerSF.create(
        model=str(sface_path),
        config=""
    )

    return _detector, _recognizer

def resolve_target_path(base_dir, thumb_path, file_path):
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

def cluster_and_assign_persons(db_path):
    """
    Agrupa todos los rostros existentes segun su similitud de embedding
    y actualiza la tabla 'persons' y 'photo_faces'.
    """
    from sklearn.cluster import AgglomerativeClustering

    conn = sqlite3.connect(str(db_path), timeout=60.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, photo_id, embedding, confidence, crop_path 
        FROM photo_faces 
        WHERE embedding IS NOT NULL
    """)
    rows = cursor.fetchall()

    if not rows:
        conn.close()
        return 0

    face_ids = []
    photo_ids = []
    embeddings = []
    confidences = []
    crops = []

    for r in rows:
        fid, pid, emb_blob, conf, crop = r
        if not emb_blob:
            continue
        try:
            arr = np.frombuffer(emb_blob, dtype=np.float32)
            if len(arr) == 128:
                norm = np.linalg.norm(arr)
                if norm > 0:
                    arr = arr / norm
                face_ids.append(fid)
                photo_ids.append(pid)
                embeddings.append(arr)
                confidences.append(conf or 0.0)
                crops.append(crop or '')
        except Exception:
            continue

    n_faces = len(embeddings)
    if n_faces == 0:
        conn.close()
        return 0

    X = np.vstack(embeddings)

    if n_faces == 1:
        labels = [0]
    else:
        clustering = AgglomerativeClustering(
            n_clusters=None,
            metric='cosine',
            linkage='average',
            distance_threshold=0.50
        )
        labels = clustering.fit_predict(X)

    clusters = {}
    for idx, label in enumerate(labels):
        if label not in clusters:
            clusters[label] = []
        clusters[label].append(idx)

    cursor.execute("SELECT id, name FROM persons")
    existing_names = dict(cursor.fetchall())

    cursor.execute("DELETE FROM persons")

    person_counter = 1
    sorted_cluster_labels = sorted(clusters.keys(), key=lambda k: len(set(photo_ids[i] for i in clusters[k])), reverse=True)

    for c_label in sorted_cluster_labels:
        indices = clusters[c_label]
        best_idx = max(indices, key=lambda i: confidences[i])
        cover_crop = crops[best_idx]
        sample_pid = photo_ids[best_idx]
        unique_photos = len(set(photo_ids[i] for i in indices))

        person_name = existing_names.get(person_counter, f"Persona {person_counter}")
        person_counter += 1

        cursor.execute("""
            INSERT INTO persons (name, cover_crop_path, sample_photo_id, photo_count)
            VALUES (?, ?, ?, ?)
        """, (person_name, cover_crop, sample_pid, unique_photos))
        person_id = cursor.lastrowid

        for i in indices:
            fid = face_ids[i]
            cursor.execute("UPDATE photo_faces SET person_id = ? WHERE id = ?", (person_id, fid))

    conn.commit()
    conn.close()
    return len(sorted_cluster_labels)

def scan_faces(batch_size=20):
    """Escanea fotos pendientes para detectar rostros y agrupar personas"""
    base_dir = get_base_dir()
    db_path = get_db_path()
    faces_cache = get_faces_cache_dir()

    init_models()
    detector, recognizer = _detector, _recognizer

    conn = sqlite3.connect(str(db_path), timeout=60.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM photos WHERE faces_scanned = 0 AND is_deleted = 0")
    total_unscanned = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM photos WHERE is_deleted = 0")
    total_photos = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM photo_faces")
    initial_faces_count = cursor.fetchone()[0]

    print(json.dumps({
        "type": "start",
        "total_unscanned": total_unscanned,
        "total_photos": total_photos,
        "initial_faces": initial_faces_count
    }), flush=True)

    if total_unscanned == 0:
        print(json.dumps({"type": "clustering"}), flush=True)
        n_persons = cluster_and_assign_persons(db_path)
        print(json.dumps({
            "type": "complete",
            "processed": 0,
            "faces_found": initial_faces_count,
            "persons_count": n_persons
        }), flush=True)
        conn.close()
        return

    processed_count = 0
    faces_found = initial_faces_count

    while True:
        cursor.execute("""
            SELECT id, file_path, thumbnail_path, file_name 
            FROM photos 
            WHERE faces_scanned = 0 AND is_deleted = 0
            LIMIT ?
        """, (batch_size,))
        rows = cursor.fetchall()

        if not rows:
            break

        for row in rows:
            photo_id, file_path, thumb_path, file_name = row
            target_path = resolve_target_path(base_dir, thumb_path, file_path)

            if not target_path or not os.path.exists(target_path):
                cursor.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?", (photo_id,))
                processed_count += 1
                continue

            try:
                bgr = cv2.imread(target_path)
                if bgr is None or bgr.shape[0] < 32 or bgr.shape[1] < 32:
                    cursor.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?", (photo_id,))
                    processed_count += 1
                    continue

                h, w, _ = bgr.shape
                detector.setInputSize((w, h))
                _, faces = detector.detect(bgr)

                if faces is not None and len(faces) > 0:
                    for f_idx, face in enumerate(faces):
                        box_x, box_y, box_w, box_h = int(face[0]), int(face[1]), int(face[2]), int(face[3])
                        confidence = float(face[-1])

                        aligned_chip = recognizer.alignCrop(bgr, face)
                        embedding = recognizer.feature(aligned_chip)

                        crop_fname = f"face_{photo_id}_{f_idx}.jpg"
                        crop_disk_path = faces_cache / crop_fname
                        cv2.imwrite(str(crop_disk_path), aligned_chip, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
                        crop_web_path = f"/cache/faces/{crop_fname}"

                        emb_blob = embedding.astype(np.float32).tobytes()

                        cursor.execute("""
                            INSERT INTO photo_faces (photo_id, box_x, box_y, box_w, box_h, confidence, crop_path, embedding)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, (photo_id, box_x, box_y, box_w, box_h, confidence, crop_web_path, emb_blob))
                        faces_found += 1

                cursor.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?", (photo_id,))
                processed_count += 1

                if processed_count % 5 == 0 or processed_count == total_unscanned:
                    print(json.dumps({
                        "type": "progress",
                        "processed": processed_count,
                        "total": total_unscanned,
                        "faces_found": faces_found,
                        "current_file": file_name
                    }), flush=True)

            except Exception:
                cursor.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?", (photo_id,))
                processed_count += 1

        conn.commit()

    conn.commit()
    conn.close()

    print(json.dumps({"type": "clustering"}), flush=True)
    n_persons = cluster_and_assign_persons(db_path)

    print(json.dumps({
        "type": "complete",
        "processed": processed_count,
        "faces_found": faces_found,
        "persons_count": n_persons
    }), flush=True)

def main():
    parser = argparse.ArgumentParser(description="Faces & Persons Classifier Worker")
    parser.add_argument("--scan", action="store_true", help="Escanear fotos pendientes y agrupar personas")
    parser.add_argument("--cluster-only", action="store_true", help="Solo reagrupar personas sobre caras ya existentes")
    parser.add_argument("--batch-size", type=int, default=20, help="Tamano de lote (def: 20)")
    args = parser.parse_args()

    db_path = get_db_path()

    if args.cluster_only:
        print("Reagrupando personas...")
        n = cluster_and_assign_persons(db_path)
        print(json.dumps({"status": "ok", "persons_count": n}))
        return

    scan_faces(batch_size=args.batch_size)

if __name__ == "__main__":
    main()
