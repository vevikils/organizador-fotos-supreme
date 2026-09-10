// server/scanner.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const exifr = require('exifr');
const { imageSize } = require('image-size');
const { Jimp } = require('jimp');

const { db, stmts, CACHE_DIR } = require('./db');
const { reverseGeocode } = require('./geocoder');

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.heic', '.heif'
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '$recycle.bin', 'appdata', 'temp', 'windows', 'program files',
  'system volume information', '.cache', '.vscode', '.gemini'
]);

class PhotoScanner extends EventEmitter {
  constructor() {
    super();
    this.isScanning = false;
    this.isPaused = false;
    this.shouldCancel = false;
    this.currentStats = {
      totalFound: 0, scanned: 0, added: 0, updated: 0, errors: 0,
      currentFile: '', currentFolder: '', startTime: null
    };
  }

  getStatus() {
    return { isScanning: this.isScanning, isPaused: this.isPaused, ...this.currentStats };
  }

  pause() { this.isPaused = true; this.emit('status', this.getStatus()); }
  resume() { this.isPaused = false; this.emit('status', this.getStatus()); }
  cancel() { this.shouldCancel = true; this.isScanning = false; this.emit('status', this.getStatus()); }

  async discoverFiles(dirPath, fileList = []) {
    if (this.shouldCancel) return fileList;
    let entries = [];
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      return fileList;
    }

    for (const entry of entries) {
      if (this.shouldCancel) break;
      const fullPath = path.join(dirPath, entry.name);
      const lowerName = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(lowerName) && !lowerName.startsWith('.')) {
          await this.discoverFiles(fullPath, fileList);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(lowerName);
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          fileList.push(fullPath);
        }
      }
    }
    return fileList;
  }

  async computeSha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });
  }

  getTimeOfDay(hour) {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 21) return 'golden_hour';
    return 'night';
  }

  classifyColor(r, g, b) {
    const rf = r / 255, gf = g / 255, bf = b / 255;
    const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
    const l = (max + min) / 2;

    if (max === min) {
      if (l < 0.18) return 'negro';
      if (l > 0.85) return 'blanco';
      return 'gris';
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
      case rf: h = (gf - bf) / d + (gf < bf ? 6 : 0); break;
      case gf: h = (bf - rf) / d + 2; break;
      case bf: h = (rf - gf) / d + 4; break;
    }
    h *= 60;

    if (s < 0.15) {
      if (l < 0.2) return 'negro';
      if (l > 0.82) return 'blanco';
      return 'gris';
    }
    if (l < 0.12) return 'negro';
    if (l > 0.90) return 'blanco';

    if (h < 15 || h >= 345) return 'rojo';
    if (h >= 15 && h < 45) return 'naranja';
    if (h >= 45 && h < 70) return 'amarillo';
    if (h >= 70 && h < 165) return 'verde';
    if (h >= 165 && h < 195) return 'cian';
    if (h >= 195 && h < 260) return 'azul';
    if (h >= 260 && h < 310) return 'morado';
    if (h >= 310 && h < 345) return 'rosa';
    return 'gris';
  }

  async processVisuals(filePath, photoSha) {
    const thumbFileName = `${photoSha.slice(0, 16)}.jpg`;
    const thumbDiskPath = path.join(CACHE_DIR, thumbFileName);
    const thumbRelativePath = `/cache/thumbnails/${thumbFileName}`;

    let dhash = '';
    let dominantColor = '#4a90e2';
    let colorGroup = 'azul';

    try {
      const img = await Jimp.read(filePath);
      if (!fs.existsSync(thumbDiskPath)) {
        const thumb = img.clone().resize({ w: 360 });
        await thumb.write(thumbDiskPath);
      }

      const dhashImg = img.clone().resize({ w: 9, h: 8 }).greyscale();
      let binHash = '';
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const left = dhashImg.bitmap.data[(y * 9 + x) * 4];
          const right = dhashImg.bitmap.data[(y * 9 + (x + 1)) * 4];
          binHash += left > right ? '1' : '0';
        }
      }
      for (let i = 0; i < 64; i += 4) {
        dhash += parseInt(binHash.slice(i, i + 4), 2).toString(16);
      }

      const colorImg = img.clone().resize({ w: 16, h: 16 });
      let totalR = 0, totalG = 0, totalB = 0;
      const count = 16 * 16;
      for (let i = 0; i < count; i++) {
        totalR += colorImg.bitmap.data[i * 4];
        totalG += colorImg.bitmap.data[i * 4 + 1];
        totalB += colorImg.bitmap.data[i * 4 + 2];
      }
      const avgR = Math.round(totalR / count);
      const avgG = Math.round(totalG / count);
      const avgB = Math.round(totalB / count);
      dominantColor = `#${((1 << 24) + (avgR << 16) + (avgG << 8) + avgB).toString(16).slice(1)}`;
      colorGroup = this.classifyColor(avgR, avgG, avgB);
    } catch (err) {}

    return { thumbnailPath: thumbRelativePath, dhash, dominantColor, colorGroup };
  }

    detectAi(bufferHead, exifData, fileName, filePath) {
    const lowerName = fileName.toLowerCase();
    const lowerPath = filePath.toLowerCase();

    if (bufferHead) {
      const headText = bufferHead.toString('latin1');
      if (headText.includes('sd-metadata') || headText.includes('InvokeAI') || headText.includes('invoke-ai')) {
        return { isAi: 1, generator: 'InvokeAI' };
      }
      if (headText.includes('prompt') && (headText.includes('sampler_name') || headText.includes('workflow') || headText.includes('node_id'))) {
        return { isAi: 1, generator: 'ComfyUI' };
      }
      if (headText.includes('parameters') && (headText.includes('Steps:') || headText.includes('Sampler:') || headText.includes('CFG scale:'))) {
        return { isAi: 1, generator: 'Stable Diffusion' };
      }
      if (headText.includes('NovelAI') || headText.includes('Software\x00NovelAI')) {
        return { isAi: 1, generator: 'NovelAI' };
      }
      if (headText.includes('Midjourney')) {
        return { isAi: 1, generator: 'Midjourney' };
      }
      if (headText.includes('DALL·E') || headText.includes('DALL-E')) {
        return { isAi: 1, generator: 'DALL-E' };
      }
      if (headText.includes('Adobe Firefly')) {
        return { isAi: 1, generator: 'Adobe Firefly' };
      }
    }

    if (exifData) {
      const soft = String(exifData.Software || exifData.ImageDescription || exifData.UserComment || '').toLowerCase();
      if (soft.includes('stable diffusion') || soft.includes('automatic1111')) return { isAi: 1, generator: 'Stable Diffusion' };
      if (soft.includes('midjourney')) return { isAi: 1, generator: 'Midjourney' };
      if (soft.includes('dall-e') || soft.includes('dalle')) return { isAi: 1, generator: 'DALL-E' };
      if (soft.includes('comfyui')) return { isAi: 1, generator: 'ComfyUI' };
      if (soft.includes('invokeai') || soft.includes('invoke-ai')) return { isAi: 1, generator: 'InvokeAI' };
      if (soft.includes('novelai')) return { isAi: 1, generator: 'NovelAI' };
    }

    if (lowerName.includes('comfyui') || lowerPath.includes('\\comfyui\\') || lowerPath.includes('/comfyui/')) {
      return { isAi: 1, generator: 'ComfyUI' };
    }
    if (lowerName.includes('-k_euler') || lowerName.includes('-sd-v') || lowerName.includes('-sdxl') || lowerPath.includes('stable_diffusion')) {
      return { isAi: 1, generator: 'Stable Diffusion' };
    }
    if (lowerName.includes('flux_') || lowerName.includes('_flux_')) {
      return { isAi: 1, generator: 'Flux' };
    }
    if (lowerName.includes('midjourney') || lowerPath.includes('midjourney')) {
      return { isAi: 1, generator: 'Midjourney' };
    }
    if (lowerName.includes('dalle') || lowerName.includes('dall-e') || lowerPath.includes('dalle')) {
      return { isAi: 1, generator: 'DALL-E' };
    }
    if (lowerPath.includes('novelai') || lowerName.includes('novelai')) {
      return { isAi: 1, generator: 'NovelAI' };
    }

    return { isAi: 0, generator: null };
  }

  classifyPhoto({ fileName, width, height, aspectRatio, cameraMake, cameraModel, timeOfDay, iso, shutterSpeed }) {
    const lowerName = fileName.toLowerCase();
    const screenshotKeywords = ['screenshot', 'captura', 'screen_', 'pantalla', 'scrn', 'screencap'];
    const isScreenshotName = screenshotKeywords.some(k => lowerName.includes(k));
    const commonScreenRatios = [16 / 9, 9 / 16, 19.5 / 9, 9 / 19.5, 20 / 9, 9 / 20, 16 / 10, 10 / 16];
    const isScreenRatio = aspectRatio && commonScreenRatios.some(r => Math.abs(aspectRatio - r) < 0.03);

    if (isScreenshotName || (isScreenRatio && !cameraMake && !cameraModel && lowerName.endsWith('.png'))) {
      return 'screenshot';
    }
    if (aspectRatio && (aspectRatio > 2.15 || aspectRatio < 0.46)) return 'panorama';

    const docKeywords = ['doc', 'factura', 'recibo', 'ticket', 'scan', 'boleta', 'nota', 'comprobante'];
    if (docKeywords.some(k => lowerName.includes(k))) return 'document';

    if (aspectRatio && aspectRatio >= 0.65 && aspectRatio <= 0.85 && (cameraModel || cameraMake)) return 'portrait';
    if (timeOfDay === 'night' || (iso && iso >= 1600) || (typeof shutterSpeed === 'number' && shutterSpeed >= 0.5)) {
      return 'night';
    }
    return 'photo';
  }

  async processPhoto(filePath) {
    const stats = await fs.promises.stat(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    const existing = stmts.getPhotoByPath.get(filePath);
    if (existing && existing.file_size === stats.size && existing.date_modified === stats.mtime.toISOString()) {
      return { skipped: true, photo: existing };
    }

    let width = 0, height = 0, mimeType = `image/${ext.replace('.', '')}`;
    let bufferHead = null;
    try {
      bufferHead = Buffer.alloc(32768);
      const fd = await fs.promises.open(filePath, 'r');
      await fd.read(bufferHead, 0, 32768, 0);
      await fd.close();
      const dims = imageSize(bufferHead);
      if (dims) { width = dims.width || 0; height = dims.height || 0; }
    } catch (e) {}

    let exifData = null;
    try {
      exifData = await exifr.parse(filePath, {
        tiff: true, xmp: true, gps: true, exif: true, translateKeys: true
      });
    } catch (e) {}

    let dateTaken = null;
    if (exifData && (exifData.DateTimeOriginal || exifData.CreateDate || exifData.ModifyDate)) {
      const d = exifData.DateTimeOriginal || exifData.CreateDate || exifData.ModifyDate;
      if (d instanceof Date && !isNaN(d.getTime())) dateTaken = d;
    }
    if (!dateTaken) {
      dateTaken = stats.birthtime && stats.birthtime.getTime() > 0 ? stats.birthtime : stats.mtime;
    }

    const year = dateTaken.getFullYear();
    const month = dateTaken.getMonth() + 1;
    const day = dateTaken.getDate();
    const hour = dateTaken.getHours();
    const timeOfDay = this.getTimeOfDay(hour);
    const aspectRatio = width && height ? parseFloat((width / height).toFixed(3)) : 1;

    const cameraMake = exifData ? (exifData.Make || null) : null;
    const cameraModel = exifData ? (exifData.Model || null) : null;
    const lensModel = exifData ? (exifData.LensModel || null) : null;
    const focalLength = exifData ? (exifData.FocalLength || null) : null;
    const aperture = exifData ? (exifData.FNumber || null) : null;
    const shutterSpeed = exifData ? (exifData.ExposureTime ? `1/${Math.round(1 / exifData.ExposureTime)}s` : null) : null;
    const iso = exifData ? (exifData.ISO || null) : null;
    const orientation = exifData ? (exifData.Orientation || 1) : 1;

    let latitude = null, longitude = null, altitude = null;
    let city = null, region = null, country = null, locationName = null;

    if (exifData && typeof exifData.latitude === 'number' && typeof exifData.longitude === 'number') {
      latitude = exifData.latitude;
      longitude = exifData.longitude;
      altitude = exifData.altitude || null;
      const geo = reverseGeocode(latitude, longitude);
      if (geo) {
        city = geo.city; region = geo.region; country = geo.country; locationName = geo.location_name;
      }
    }

    const sha256 = await this.computeSha256(filePath);
    const visuals = await this.processVisuals(filePath, sha256);
    const category = this.classifyPhoto({
      fileName, width, height, aspectRatio, cameraMake, cameraModel, timeOfDay, iso, shutterSpeed
    });

    const aiInfo = this.detectAi(bufferHead, exifData, fileName, filePath);
    const isTiny = (stats.size < 1024) || (width > 0 && width <= 64 && height <= 64) || filePath.toLowerCase().includes('\\thumbnails\\') || filePath.toLowerCase().includes('/thumbnails/') ? 1 : 0;

    stmts.upsertPhoto.run(
      filePath, fileName, stats.size, mimeType,
      dateTaken.toISOString(), stats.mtime.toISOString(), year, month, day, hour, timeOfDay,
      width, height, aspectRatio, orientation,
      cameraMake, cameraModel, lensModel, focalLength, aperture, shutterSpeed, iso,
      latitude, longitude, altitude, city, region, country, locationName,
      category, visuals.dominantColor, visuals.colorGroup, sha256, visuals.dhash, visuals.thumbnailPath,
      aiInfo.isAi, aiInfo.generator, isTiny
    );

    return { skipped: false, isNew: !existing };
  }

  async scanFolder(folderPath) {
    if (this.isScanning) throw new Error('Ya hay un escaneo en curso');
    this.isScanning = true;
    this.isPaused = false;
    this.shouldCancel = false;
    this.currentStats = {
      totalFound: 0, scanned: 0, added: 0, updated: 0, errors: 0,
      currentFile: '', currentFolder: folderPath, startTime: Date.now()
    };
    this.emit('start', { folder: folderPath });

    try {
      const files = await this.discoverFiles(folderPath);
      this.currentStats.totalFound = files.length;
      this.emit('progress', this.getStatus());

      for (let i = 0; i < files.length; i++) {
        if (this.shouldCancel) break;
        while (this.isPaused && !this.shouldCancel) {
          await new Promise(r => setTimeout(r, 200));
        }
        const file = files[i];
        this.currentStats.currentFile = path.basename(file);
        this.currentStats.scanned = i + 1;

        try {
          const result = await this.processPhoto(file);
          if (result.isNew) this.currentStats.added++;
          else if (!result.skipped) this.currentStats.updated++;
        } catch (err) {
          console.error(`[Scanner Error en ${path.basename(file)}]:`, err ? (err.message || err) : 'desconocido');
          this.currentStats.errors++;
        }

        if (i % 5 === 0 || i === files.length - 1) {
          this.emit('progress', this.getStatus());
        }
      }

      const folderRecord = db.prepare('SELECT id FROM folders WHERE path = ?').get(folderPath);
      if (folderRecord) {
        stmts.updateFolderScan.run(this.currentStats.scanned, folderRecord.id);
      }
      this.emit('complete', this.getStatus());
    } catch (err) {
      this.emit('error', err);
    } finally {
      this.isScanning = false;
    }
    return this.getStatus();
  }
}

const scanner = new PhotoScanner();
module.exports = { scanner, PhotoScanner };
