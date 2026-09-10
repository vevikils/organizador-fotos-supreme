const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { stmts } = require('./db');
const { scanner } = require('./scanner');

class EnhancerManager {
  constructor() {
    this.jobs = new Map();
    this.cacheDir = path.join(__dirname, '..', 'cache', 'enhanced');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  startEnhance({ photoId, filePath, scale = 4, color_restore = true, denoise = true, unsharp = true, face_enhance = true }) {
    const jobId = 'enh_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const outputPath = path.join(this.cacheDir, `enhanced_${photoId}_${Date.now()}.jpg`);

    const job = {
      jobId,
      photoId,
      originalPath: filePath,
      outputPath,
      scale,
      status: 'processing',
      progress: 5,
      step: 'Iniciando proceso de mejora...',
      error: null,
      result: null,
      startTime: Date.now()
    };

    this.jobs.set(jobId, job);

    const scriptPath = path.join(__dirname, 'enhancer_worker.py');
    const args = [
      scriptPath,
      '--input', filePath,
      '--output', outputPath,
      '--scale', String(scale)
    ];

    if (color_restore) args.push('--color_restore');
    if (denoise) args.push('--denoise');
    if (unsharp) args.push('--unsharp');
    if (face_enhance) args.push('--face_enhance');

    const proc = spawn('python', args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    job.process = proc;

    let buffer = '';
    proc.stdout.on('data', (data) => {
      buffer += data.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Mantener el último segmento incompleto

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'progress') {
            job.progress = msg.percent;
            job.step = msg.step;
          } else if (msg.type === 'done') {
            job.status = 'completed';
            job.progress = 100;
            job.step = '¡Mejora completada con éxito!';
            job.result = {
              success: true,
              input_dims: msg.input_dims,
              output_dims: msg.output_dims,
              scale: msg.scale,
              elapsed_seconds: msg.elapsed_seconds,
              previewUrl: `/api/enhance/preview/${path.basename(outputPath)}`
            };
          } else if (msg.type === 'error') {
            job.status = 'error';
            job.error = msg.error;
          }
        } catch (e) {
          // Ignorar líneas no JSON
        }
      }
    });

    proc.stderr.on('data', (data) => {
      // Registrar posibles avisos en depuración
    });

    proc.on('close', (code) => {
      if (job.status === 'processing') {
        if (code === 0 && fs.existsSync(outputPath)) {
          job.status = 'completed';
          job.progress = 100;
          job.result = {
            success: true,
            previewUrl: `/api/enhance/preview/${path.basename(outputPath)}`
          };
        } else {
          job.status = 'error';
          job.error = job.error || `El proceso finalizó con código ${code}`;
        }
      }
      job.process = null;
    });

    return job;
  }

  async saveEnhancedPhoto({ photoId, jobId, mode = 'copy' }) {
    const job = this.getJob(jobId);
    if (!job || !job.result || !fs.existsSync(job.outputPath)) {
      throw new Error('La imagen mejorada no está disponible para guardar');
    }

    const photo = stmts.getPhotoById ? stmts.getPhotoById.get(photoId) : null;
    const origPath = photo ? photo.file_path : job.originalPath;
    if (!fs.existsSync(origPath)) {
      throw new Error('No se encontró el archivo original en el disco');
    }

    const parsed = path.parse(origPath);

    if (mode === 'replace') {
      // 1. Guardar backup original
      const backupPath = path.join(parsed.dir, `${parsed.name}.bak`);
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(origPath, backupPath);
      }

      // 2. Reemplazar archivo original con la imagen mejorada
      fs.copyFileSync(job.outputPath, origPath);

      // 3. Re-escanear foto en la base de datos
      if (scanner && scanner.processPhoto) {
        await scanner.processPhoto(origPath);
      }

      return {
        success: true,
        mode: 'replace',
        savedPath: origPath,
        backupPath
      };
    } else {
      // Modo 'copy': crear copia HD
      let suffix = '_HD_IA';
      let targetName = `${parsed.name}${suffix}.jpg`;
      let targetPath = path.join(parsed.dir, targetName);
      let counter = 1;

      while (fs.existsSync(targetPath)) {
        targetName = `${parsed.name}${suffix}_${counter}.jpg`;
        targetPath = path.join(parsed.dir, targetName);
        counter++;
      }

      fs.copyFileSync(job.outputPath, targetPath);

      // Indexar la nueva foto en la base de datos
      let newPhoto = null;
      if (scanner && scanner.processPhoto) {
        newPhoto = await scanner.processPhoto(targetPath);
      }

      return {
        success: true,
        mode: 'copy',
        savedPath: targetPath,
        newPhoto
      };
    }
  }
}

module.exports = new EnhancerManager();
