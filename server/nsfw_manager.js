const { spawn } = require('child_process');
const path = require('path');
const { stmts } = require('./db');

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

    const scriptPath = path.join(__dirname, 'nsfw_worker.py');
    const pythonExe = 'python';

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
      this.process = spawn(pythonExe, [
        '-u',
        scriptPath,
        '--scan',
        '--batch-size', String(batchSize),
        '--threshold', String(threshold)
      ], {
        cwd: path.join(__dirname, '..'),
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
            // Ignorar líneas no JSON (ej. avisos informativos)
          }
        }
      });

      this.process.stderr.on('data', (chunk) => {
        console.error('[NSFW Worker Error]:', chunk.toString());
      });

      this.process.on('close', (code) => {
        this.isScanning = false;
        this.process = null;
        this.currentStats.isScanning = false;
        this.broadcast('complete', this.getStatus());
      });

      this.process.on('error', (err) => {
        console.error('Error lanzando nsfw_worker:', err);
        this.isScanning = false;
        this.process = null;
        this.currentStats.isScanning = false;
        this.broadcast('error', { message: err.message });
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
    } else if (data.type === 'complete') {
      this.currentStats.percentage = 100;
      this.broadcast('complete', this.getStatus());
    }
  }
}

const nsfwManager = new NsfwManager();
module.exports = nsfwManager;
