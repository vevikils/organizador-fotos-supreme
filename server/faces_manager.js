const { spawn } = require('child_process');
const path = require('path');
const { stmts } = require('./db');

class FacesManager {
  constructor() {
    this.process = null;
    this.isScanning = false;
    this.currentStats = {
      isScanning: false,
      processed: 0,
      total: 0,
      percentage: 0,
      facesFound: 0,
      currentFile: '',
      personsCount: 0
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
    res.write(`event: status\ndata: ${JSON.stringify(this.getStatus())}\n\n`);
  }

  removeSubscriber(res) {
    this.subscribers.delete(res);
  }

  getStatus() {
    let dbStats = { total_photos: 0, scanned_photos: 0, unscanned_photos: 0, total_faces: 0, total_persons: 0 };
    try {
      dbStats = stmts.getFaceStats.get();
    } catch (e) {}

    return {
      isScanning: this.isScanning,
      current: this.currentStats,
      stats: dbStats
    };
  }

  startScan({ batchSize = 20 } = {}) {
    if (this.isScanning) {
      return { success: false, message: 'El escaneo facial ya está en curso' };
    }

    const scriptPath = path.join(__dirname, 'faces_worker.py');
    const pythonExe = 'python';

    let initialTotal = 0;
    let initialFaces = 0;
    try {
      const stats = stmts.getFaceStats.get();
      initialTotal = stats ? (stats.unscanned_photos || 0) : 0;
      initialFaces = stats ? (stats.total_faces || 0) : 0;
    } catch (e) {}

    this.isScanning = true;
    this.currentStats = {
      isScanning: true,
      processed: 0,
      total: initialTotal,
      percentage: 0,
      facesFound: initialFaces,
      currentFile: 'Iniciando modelos de reconocimiento facial...',
      personsCount: 0
    };

    this.broadcast('start', {
      processed: 0,
      total: initialTotal,
      percentage: 0,
      facesFound: initialFaces,
      fileName: 'Iniciando modelos de reconocimiento facial...'
    });

    try {
      this.process = spawn(pythonExe, [
        '-u',
        scriptPath,
        '--scan',
        '--batch-size', String(batchSize)
      ], {
        cwd: path.join(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let buffer = '';

      this.process.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            this.handleWorkerMessage(data);
          } catch (e) {}
        }
      });

      this.process.stderr.on('data', (chunk) => {
        console.error('[Faces Worker]:', chunk.toString());
      });

      this.process.on('close', (code) => {
        this.isScanning = false;
        this.process = null;
        this.currentStats.isScanning = false;
        this.broadcast('complete', this.getStatus());
      });

      this.process.on('error', (err) => {
        console.error('Error lanzando faces_worker:', err);
        this.isScanning = false;
        this.process = null;
        this.currentStats.isScanning = false;
        this.broadcast('error', { message: err.message });
      });

      return { success: true, message: 'Detección y reconocimiento facial iniciado' };
    } catch (err) {
      this.isScanning = false;
      this.currentStats.isScanning = false;
      return { success: false, message: err.message };
    }
  }

  stopScan() {
    if (!this.isScanning || !this.process) {
      return { success: false, message: 'No hay escaneo facial en curso' };
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
      return { success: true, message: 'Escaneo facial detenido' };
    } catch (e) {
      this.isScanning = false;
      this.process = null;
      this.currentStats.isScanning = false;
      return { success: false, message: e.message };
    }
  }

  handleWorkerMessage(data) {
    if (data.type === 'start') {
      this.currentStats.total = data.total_unscanned;
      this.currentStats.processed = 0;
      this.currentStats.facesFound = data.initial_faces || 0;
      this.currentStats.currentFile = 'Analizando fotos con IA facial...';

      this.broadcast('progress', {
        processed: 0,
        total: data.total_unscanned,
        percentage: 0,
        facesFound: data.initial_faces || 0,
        fileName: 'Iniciando escaneo facial...'
      });
    } else if (data.type === 'progress') {
      this.currentStats.processed = data.processed;
      this.currentStats.total = data.total;
      this.currentStats.percentage = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 100;
      this.currentStats.facesFound = data.faces_found;
      this.currentStats.currentFile = data.current_file;

      this.broadcast('progress', {
        processed: data.processed,
        total: data.total,
        percentage: this.currentStats.percentage,
        facesFound: data.faces_found,
        fileName: data.current_file
      });
    } else if (data.type === 'clustering') {
      this.currentStats.currentFile = 'Agrupando caras similares en personas...';
      this.broadcast('clustering', {
        message: 'Agrupando caras de la misma persona con IA...'
      });
    } else if (data.type === 'complete') {
      this.currentStats.percentage = 100;
      this.currentStats.personsCount = data.persons_count || 0;
      this.broadcast('complete', this.getStatus());
    }
  }
}

const facesManager = new FacesManager();
module.exports = facesManager;
