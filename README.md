# 📸 Organizador Supremo de Fotos

> **Tu propia alternativa privada, local y ultra-rápida a Google Fotos para escritorio con Inteligencia Artificial.**

Organizador Supremo de Fotos es una aplicación de escritorio moderna desarrollada con **Electron**, **Node.js (Express + SQLite)** y modelos de **Visión por Computador con IA (PyTorch, OpenCV Zoo)** que indexa, organiza y analiza tu biblioteca fotográfica de forma 100% local, sin subir ninguna foto a servidores externos ni depender de suscripciones en la nube.

---

## ✨ Características Principales

### 📅 Cronología Infinita por Fechas
- Vista fluida organizada cronológicamente por años, meses y días.
- **Scrubber lateral de años**: salto instantáneo a cualquier año de tu vida o filtrado con un solo clic.
- Desplazamiento infinito optimizado para colecciones de más de **100.000 fotos**.

### 👤 Reconocimiento Facial y Agrupación de Personas con IA
- **Detección de rostros**: Algoritmo **YuNet** de alto rendimiento.
- **Embeddings faciales**: Extracción de características vectoriales de 128 dimensiones con **SFace**.
- **Clustering automático**: Algoritmo jerárquico aglomerativo que agrupa las fotos según la misma persona.
- Galería con avatares de rostros, contadores de fotos por persona y opción para renombrar.

### 🔞 Filtro Inteligente de Contenido Sensible (NSFW)
- Modelo de Inteligencia Artificial basado en **Vision Transformers (ViT)** (`Falconsai/nsfw_image_detection`).
- Modo seguro conmutador: desenfoque en tiempo real, ocultación completa o visualización normal.
- Escaneo en segundo plano multihilo con barra de progreso en vivo y control de parada/reanudación.

### ⚡ Limpieza Inteligente de Duplicados con Borrado Masivo
- Identificación de **duplicados exactos** por hash criptográfico SHA-256.
- Detección de **fotos similares o ráfagas** mediante hash perceptual dHash.
- **Acciones en lote**:
  - Checkbox para **seleccionar todas las copias redundantes** de golpe.
  - Botón de **Limpieza Total (Conserva automáticamente la mejor resolución/calidad)**.
  - Eliminación transaccional SQLite de miles de fotos en menos de 250 milisegundos.

### 🗺️ Mapa de Lugares y Geolocalización
- Extracción automática de coordenadas GPS desde los metadatos EXIF.
- Mapa interactivo con agrupación por ciudades y países.

### 🎨 Exploración por Colores, Cámaras y Colecciones
- Análisis de paletas de colores dominantes de cada imagen.
- Clasificación por modelo de cámara, smartphone y parámetros de disparo (ISO, apertura, velocidad).
- Álbumes personalizados y colección de fotos favoritas.

---

## 🛠️ Tecnologías Utilizadas

- **Frontend**: HTML5, Vanilla CSS3 (diseño oscuro premium, glassmorphism), JavaScript moderno.
- **Backend de Escritorio**: [Electron](https://www.electronjs.org/), [Express.js](https://expressjs.com/), base de datos SQLite integrada con WAL mode (`node:sqlite`).
- **Pipeline de IA & Visión**:
  - Python 3
  - OpenCV (`cv2.FaceDetectorYN`, `cv2.FaceRecognizerSF`)
  - Scikit-Learn (`AgglomerativeClustering`)
  - PyTorch & Hugging Face Transformers (`ViTForImageClassification`)
  - Pillow (PIL)

---

## 🚀 Instalación y Puesta en Marcha

### Prerrequisitos
- [Node.js](https://nodejs.org/) (versión 20 o superior recomendada).
- [Python](https://www.python.org/) 3.10 o superior.

### 1. Clonar el repositorio
```bash
git clone https://github.com/vevikils/organizador-fotos-supreme.git
cd organizador-fotos-supreme
```

### 2. Instalar dependencias de Node.js
```bash
npm install
```

### 3. Instalar dependencias de Python (para funciones de IA)
```bash
pip install opencv-python scikit-learn torch transformers pillow
```

### 4. Iniciar la aplicación
```bash
npm start
```
*En Windows también puedes ejecutar directamente `Iniciar_Organizador_Fotos.bat` o el lanzador compilado `Organizador_Fotos.exe`.*

---

## 🔒 Privacidad por Diseño

Esta aplicación está pensada para la máxima privacidad:
- Las bases de datos (`data/`), miniaturas de caché (`cache/`) y configuraciones personales se guardan localmente en tu equipo y están explícitamente excluidas del control de versiones.
- **Cero telemetría**: Ningún dato ni fotografía sale de tu ordenador.

---

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE).
