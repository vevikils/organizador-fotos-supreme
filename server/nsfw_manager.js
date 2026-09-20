const { spawn } = require('child_process');
const path = require('path');
const { db, stmts, DB_FILE, STORAGE_ROOT } = require('./db');

function getUnpackedPath(targetPath) {
  if (targetPath && targetPath.includes('app.asar')) {
    return targetPath.replace('app.asar', 'app.asar.unpacked');
  }
  return targetPath;
}

function getPythonExe() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  return 'python';
}

class NsfwManager {
  constructor() {
    this.process = null;
    this.isScanning = false;
    this.currentStats = {
      isScanning: false,
      processed: 0,
      total: 0,
      percentage: 0,
      nsfwFound: 0,
      currentFile: '',
      lastScore: 0,
      lastLabel: 'sfw'
    };
    this.subscribers = new Set();
    this.lastBroadcastTime = 0;
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.subscribers) {
      try {
        res.write(payload);
      } catch (e) {
        this.subscribers.delete(res);
      }
    }
  }

  addSubscriber(res) {
    this.subscribers.add(res);
    // Enviar estado inicial
    res.write(`event: status\ndata: ${JSON.stringify(this.getStatus())}\n\n`);
  }

  removeSubscriber(res) {
    this.subscribers.delete(res);
  }

  getStatus() {
    let dbStats = { total_photos: 0, checked_photos: 0, nsfw_photos: 0, sfw_photos: 0, unclassified_photos: 0 };
    try {
      dbStats = stmts.getNsfwStats.get();
    } catch (e) {}

    return {
      isScanning: this.isScanning,
      current: this.currentStats,
      stats: dbStats
    };
  }

  startScan({ batchSize = 16, threshold = 0.55 } = {}) {
    if (this.isScanning) {
      return { success: false, message: 'El análisis de IA ya está en curso' };
    }

    const scriptPath = getUnpackedPath(path.join(__dirname, 'nsfw_worker.py'));
    const pythonExe = getPythonExe();
    const appDir = getUnpackedPath(path.join(__dirname, '..'));

    // Asegurar que cualquier cambio en memoria este guardado en disco antes de que Python acceda
    try { db.save(); } catch (e) {}

    let initialTotal = 0;
    try {
      const stats = stmts.getNsfwStats.get();
      initialTotal = stats ? (stats.unclassified_photos || 0) : 0;
    } catch (e) {}

    this.isScanning = true;
    this.currentStats = {
      isScanning: true,
      processed: 0,
      total: initialTotal,
      percentage: 0,
      nsfwFound: 0,
      currentFile: 'Iniciando modelo ViT...',
      lastScore: 0,
      lastLabel: 'sfw'
    };

    this.broadcast('start', {
      processed: 0,
      total: initialTotal,
      percentage: 0,
      nsfwTotal: 0,
      fileName: 'Iniciando modelo ViT...'
    });

    try {
      let stderrBuffer = '';

      this.process = spawn(pythonExe, [
        '-u',
        scriptPath,
        '--scan',
        '--batch-size', String(batchSize),
        '--threshold', String(threshold),
        '--db', DB_FILE,
        '--storage-dir', STORAGE_ROOT
      ], {
        cwd: appDir,
        env: {
          ...process.env,
          ORGANIZADOR_STORAGE_DIR: STORAGE_ROOT,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let buffer = '';

      this.process.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Mantener remanente incompleto

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            this.handleWorkerMessage(data);
          } catch (e) {
            // Ignorar lineas no JSON
          }
        }
      });

      this.process.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrBuffer += text;
        console.error('[NSFW Worker Error]:', text);
      });

      this.process.on('close', (code) => {
        const wasScanning = this.isScanning;
        this.isScanning = false;
        this.process = null;
        this.currentStats.isScanning = false;
        try {
          if (db.getEngine() && typeof db.getEngine().reload === 'function') {
            db.getEngine().reload();
          }
        } catch (e) {
          console.error('[NSFW Manager]: Error recargando DB tras analisis:', e);
        }

        if (code !== 0 && code !== null) {
          console.error(`[NSFW Manager]: Worker finalizó con código ${code}. Stderr: ${stderrBuffer}`);
          this.broadcast('scan_error', {
            message: stderrBuffer.trim() || `El proceso de IA finalizó inesperadamente (código ${code})`
          });
        } else {
          this.broadcast('complete', this.getStatus());
        }
      });

      this.process.on('error', (err) => {
        console.error('Error lanzando nsfw_worker:', err);
        this.isScanning = false;
        this.process = null;
        this.currentStats.isScanning = false;
        this.broadcast('scan_error', { message: `No se pudo iniciar Python: ${err.message}` });
      });

      return { success: true, message: 'Análisis de IA iniciado' };
    } catch (err) {
      this.isScanning = false;
      this.currentStats.isScanning = false;
      return { success: false, message: err.message };
    }
  }

  stopScan() {
    if (!this.isScanning || !this.process) {
      return { success: false, message: 'No hay análisis en curso' };
    }

    try {
      if (process.platform === 'win32' && this.process.pid) {
        try {
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${this.process.pid} /T /F`);
        } catch (e) {
          this.process.kill('SIGKILL');
        }
      } else {
        this.process.kill();
      }
      this.isScanning = false;
      this.process = null;
      this.currentStats.isScanning = false;
      try {
        if (db.getEngine() && typeof db.getEngine().reload === 'function') {
          db.getEngine().reload();
        }
      } catch (e) {}
      this.broadcast('stopped', this.getStatus());
      return { success: true, message: 'Análisis detenido' };
    } catch (e) {
      this.isScanning = false;
      this.process = null;
      this.currentStats.isScanning = false;
      return { success: false, message: e.message };
    }
  }

  handleWorkerMessage(data) {
    if (data.type === 'start') {
      this.currentStats.total = data.total_unclassified;
      this.currentStats.processed = 0;
      this.currentStats.nsfwFound = data.nsfw_total || 0;
      this.currentStats.currentFile = 'Procesando imágenes...';

      this.broadcast('progress', {
        photoId: 0,
        fileName: 'Iniciando escaneo con IA...',
        isNsfw: 0,
        score: 0,
        label: 'sfw',
        processed: 0,
        total: data.total_unclassified,
        percentage: 0,
        nsfwTotal: data.nsfw_total || 0
      });
    } else if (data.type === 'progress') {
      this.currentStats.processed = data.processed;
      this.currentStats.total = data.total;
      this.currentStats.percentage = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 100;
      this.currentStats.nsfwFound = data.nsfw_total;
      this.currentStats.currentFile = data.file_name;
      this.currentStats.lastScore = data.score;
      this.currentStats.lastLabel = data.label;

      const now = Date.now();
      // Transmision SSE con control de tasa (max cada 200ms o deteccion NSFW inmediata o completado)
      if (data.is_nsfw || (now - this.lastBroadcastTime >= 200) || (data.processed >= data.total)) {
        this.lastBroadcastTime = now;
        this.broadcast('progress', {
          photoId: data.id,
          fileName: data.file_name,
          isNsfw: data.is_nsfw,
          score: data.score,
          label: data.label,
          processed: data.processed,
          total: data.total,
          percentage: this.currentStats.percentage,
          nsfwTotal: data.nsfw_total
        });
      }
    } else if (data.type === 'complete') {
      this.currentStats.percentage = 100;
      this.broadcast('complete', this.getStatus());
    } else if (data.type === 'error') {
      this.isScanning = false;
      if (this.process) {
        try { this.process.kill(); } catch (e) {}
        this.process = null;
      }
      this.currentStats.isScanning = false;
      this.broadcast('scan_error', { message: data.message || 'Error en el escáner de IA' });
    }
  }
}

const nsfwManager = new NsfwManager();
module.exports = nsfwManager;
