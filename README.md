# 📸 Organizador Supremo de Fotos

> **Tu propia alternativa privada, local y ultra-rápida a Google Fotos para escritorio con Inteligencia Artificial.**

[![GitHub Release](https://img.shields.io/github/v/release/vevikils/organizador-fotos-supreme?color=purple&label=Versi%C3%B3n)](https://github.com/vevikils/organizador-fotos-supreme/releases/latest)
[![Windows](https://img.shields.io/badge/Plataforma-Windows%2010%20%2F%2011-blue)](https://github.com/vevikils/organizador-fotos-supreme/releases)
[![License: MIT](https://img.shields.io/badge/Licencia-MIT-green.svg)](LICENSE)

Organizador Supremo de Fotos es una aplicación de escritorio nativa desarrollada con **Electron**, **Node.js (Express + SQLite)** y modelos de **Visión por Computador con IA (PyTorch, OpenCV Zoo, Real-ESRGAN)** que indexa, organiza y analiza tu biblioteca fotográfica de forma 100% local, sin subir ninguna foto a servidores externos ni depender de suscripciones en la nube.

---

## 📥 Descarga para Windows (.exe)

Si solo quieres usar la aplicación en tu ordenador, **no necesitas instalar Node.js ni usar la consola**:

| Tipo de Descarga | Archivo | Tamaño | Descripción |
| :--- | :--- | :--- | :--- |
| 🚀 **Instalador Oficial (Recomendado)** | [**Organizador-Supremo-de-Fotos-Setup-1.0.0.exe**](https://github.com/vevikils/organizador-fotos-supreme/releases/download/v1.0.0/Organizador-Supremo-de-Fotos-Setup-1.0.0.exe) | ~120 MB | Asistente de instalación estándar de Windows con accesos directos en Escritorio y Menú Inicio. |
| 🎒 **Versión Portable** | [**Organizador-Supremo-de-Fotos-1.0.0-Portable.exe**](https://github.com/vevikils/organizador-fotos-supreme/releases/download/v1.0.0/Organizador-Supremo-de-Fotos-1.0.0-Portable.exe) | ~120 MB | Ejecutable único sin instalación; ejecútalo directamente desde cualquier carpeta o pendrive. |

👉 **[Ver todas las versiones en GitHub Releases](https://github.com/vevikils/organizador-fotos-supreme/releases)**

---

## ✨ Características Principales

### 🪄 Restauración y Super-Resolución de Fotos Antiguas por IA
- **Escalado Neuronal 4x y 2x Ultra HD**: Reconstrucción de bordes y texturas con **Real-ESRGAN v3 Compact ONNX**.
- **Filtros Fotográficos Vintage**: Revive colores descoloridos y balancea el contraste con ecualización CLAHE en espacio LAB.
- **Reducción de Grano y Ruido Analógico**: Limpia el granulado de película o escaneos antiguos sin emborronar.
- **Comparador Deslizante Interactivo Antes / Después**: Compara en tiempo real la imagen original frente a la mejorada con IA.

### 🤖 Reconocimiento Automático de Contenido Generado por IA
- Identificación automática de imágenes generadas por **ComfyUI**, **Stable Diffusion / SDXL**, **Flux**, **NovelAI**, **InvokeAI**, **Midjourney** o **DALL-E**.
- Carpeta inteligente dedicada con portadas dinámicas y filtros por generador.

### 🔍 Aislamiento de Miniaturas y Archivos Basura (<1 KB)
- Separación automática de más de 46.000 miniaturas residuales, iconos de sistema y archivos temporales para mantener la cronología principal limpia.
- Botón de alternancia rápida en la barra superior para mostrar u ocultar miniaturas a voluntad.

### 📅 Cronología Infinita por Fechas
- Vista fluida organizada cronológicamente por años, meses y días.
- **Scrubber lateral de años**: Salto instantáneo a cualquier año de tu vida o filtrado con un solo clic.
- Desplazamiento infinito optimizado para colecciones de más de **100.000 fotos**.

### 👤 Reconocimiento Facial y Agrupación de Personas con IA
- **Detección de rostros**: Algoritmo **YuNet** de alto rendimiento.
- **Embeddings faciales**: Extracción de características vectoriales de 128 dimensiones con **SFace**.
- **Clustering automático**: Agrupamiento jerárquico aglomerativo que reúne las fotos de una misma persona.
- Galería con avatares de rostros, contadores de fotos por persona y opción para renombrar.

### 🛡️ Filtro Inteligente de Contenido Sensible (NSFW)
- Modelo de Inteligencia Artificial basado en **Vision Transformers (ViT)** (`Falconsai/nsfw_image_detection`).
- Modo seguro conmutador: desenfoque en tiempo real, ocultación completa o visualización normal.

### 🧹 Limpieza Inteligente de Duplicados con Borrado Masivo
- Identificación de **duplicados exactos** por hash criptográfico SHA-256.
- Detección de **fotos similares o ráfagas** mediante hash perceptual dHash.
- Selección masiva con un solo clic y botón de **Limpieza Total** (conserva automáticamente la versión con mayor resolución).

### 🗺️ Mapa de Lugares y Geolocalización
- Extracción automática de coordenadas GPS desde los metadatos EXIF.
- Mapa interactivo con agrupación por ciudades y países.

---

## 🛠️ Tecnologías Utilizadas

- **Frontend**: HTML5, Vanilla CSS3 (diseño oscuro premium, glassmorphism), JavaScript moderno.
- **Backend de Escritorio**: [Electron](https://www.electronjs.org/), [Express.js](https://expressjs.com/), base de datos SQLite integrada con WAL mode (`node:sqlite`).
- **Pipeline de IA & Visión**:
  - **OpenCV Zoo**: Modelos ONNX de detección (`YuNet`) y reconocimiento facial (`SFace`).
  - **Real-ESRGAN v3 ONNX**: Super-resolución e inferencia por teselas con `onnxruntime`.
  - **Hugging Face Transformers**: Clasificación de seguridad visual con ViT.

---

## 🚀 Instalación desde Código Fuente (Para Desarrolladores)

> [!NOTE]
> Si solo quieres usar el programa, no necesitas seguir estos pasos: descarga el [**.exe de instalación**](https://github.com/vevikils/organizador-fotos-supreme/releases/latest).

### Prerrequisitos
- **Node.js**: v20.0.0 o superior (recomendado v22 LTS).
- **Python**: v3.10 a v3.13 (para aceleración de visión por computador).

### 1. Clonar el repositorio
```bash
git clone https://github.com/vevikils/organizador-fotos-supreme.git
cd organizador-fotos-supreme
```

### 2. Instalar dependencias de Node.js
```bash
npm install
```

> 💡 **Solución a errores frecuentes con `npm install`**:
> - **Conflicto de versiones de npm**: Ejecuta `npm install --legacy-peer-deps`
> - **Fallo al descargar el binario de Electron por proxy o timeout**: Ejecuta `npm install --ignore-scripts`
> - **Versión de Node**: Verifica que tu versión sea 20+ con `node -v`.

### 3. Instalar dependencias de Python (para funciones de IA)
```bash
pip install opencv-python onnxruntime scikit-learn torch transformers pillow
```

### 4. Iniciar la aplicación en modo desarrollo
```bash
npm start
```

### 5. Compilar tu propio instalador .exe
```bash
npm run build
```
Los ejecutables se generarán en la carpeta `dist/`.

---

## 🔒 Privacidad por Diseño

Esta aplicación está pensada para la máxima privacidad:
- **100% Local**: Ninguna foto, miniatura, metadato ni base de datos sale jamás de tu equipo.
- **Sin cuentas obligatorias ni telemetría invasiva**.
- **Tus archivos se quedan donde están**: El organizador no duplica tus fotos originales a menos que expresamente lo solicites al editarlas o mejorarlas con IA.

---

## 📄 Licencia

Este proyecto está distribuido bajo la licencia [MIT](LICENSE).
