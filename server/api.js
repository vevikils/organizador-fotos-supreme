const os = require('os');
// server/api.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const { db, stmts, queryPhotos, findDuplicates, cleanAllDuplicates, batchDeletePhotos, getDuplicateStats, getCategoryCounts } = require('./db');
const { scanner } = require('./scanner');
const nsfwManager = require('./nsfw_manager');
const facesManager = require('./faces_manager');
const enhancerManager = require('./enhancer_manager');

const router = express.Router();

router.get('/stats', (req, res) => {
  try {
    const stats = stmts.getStats.get();
    const duplicates = getDuplicateStats();
    const nsfwStats = stmts.getNsfwStats ? stmts.getNsfwStats.get() : {};
    const faceStats = stmts.getFaceStats ? stmts.getFaceStats.get() : {};
    res.json({
      ...stats,
      exact_duplicates: duplicates.exactCount,
      similar_duplicates: duplicates.similarCount,
      reclaimable_bytes: duplicates.reclaimableBytes,
      nsfw: nsfwStats,
      faces: faceStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/photos', (req, res) => {
  try {
    const {
      limit = 80, offset = 0, year, month, category, color, camera,
      city, country, search, favorite, albumId, personId, sort, nsfw,
      is_ai, is_tiny, exclude_tiny, max_res
    } = req.query;

    const result = queryPhotos({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      year,
      month,
      category,
      color,
      camera,
      city,
      country,
      search,
      favorite: favorite === 'true',
      albumId: albumId ? parseInt(albumId, 10) : null,
      personId: personId ? parseInt(personId, 10) : null,
      sort,
      nsfwFilter: nsfw || 'all',
      isAi: is_ai,
      isTiny: is_tiny,
      excludeTiny: exclude_tiny === '1' || exclude_tiny === 'true'
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/photos/timeline', (req, res) => {
  try {
    const groups = stmts.getTimelineGroups.all();
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/photos/:id', (req, res) => {
  try {
    const photo = stmts.getPhotoById.get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
    res.json(photo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/photos/:id/view', (req, res) => {
  try {
    const photo = stmts.getPhotoById.get(req.params.id);
    if (!photo || !fs.existsSync(photo.file_path)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    res.sendFile(path.resolve(photo.file_path));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/photos/:id/raw', (req, res) => {
  try {
    const photo = stmts.getPhotoById.get(req.params.id);
    if (!photo || !fs.existsSync(photo.file_path)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    res.sendFile(path.resolve(photo.file_path));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/photos/:id/thumbnail', (req, res) => {
  try {
    const photo = stmts.getPhotoById.get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
    if (photo.thumbnail_path) {
      const abs = path.join(__dirname, '..', photo.thumbnail_path);
      if (fs.existsSync(abs)) return res.sendFile(abs);
    }
    if (fs.existsSync(photo.file_path)) return res.sendFile(path.resolve(photo.file_path));
    res.status(404).json({ error: 'Imagen no disponible' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/photos/:id/favorite', (req, res) => {
  try {
    stmts.toggleFavorite.run(req.params.id);
    const updated = stmts.getPhotoById.get(req.params.id);
    res.json({ success: true, is_favorite: updated ? updated.is_favorite : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/photos/:id/open-folder', (req, res) => {
  try {
    const photo = stmts.getPhotoById.get(req.params.id);
    if (!photo || !fs.existsSync(photo.file_path)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const winPath = photo.file_path.replace(/\//g, '\\');
    exec(`explorer.exe /select,"${winPath}"`);
    res.json({ success: true, path: winPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/photos/:id', (req, res) => {
  try {
    stmts.softDelete.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/explore/locations', (req, res) => {
  try {
    res.json({ locations: stmts.getLocations.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/explore/categories', (req, res) => {
  try {
    res.json({ categories: getCategoryCounts ? getCategoryCounts() : stmts.getCategories.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/explore/colors', (req, res) => {
  try {
    res.json({ colors: stmts.getColors.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/explore/cameras', (req, res) => {
  try {
    res.json({ cameras: stmts.getCameras.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/duplicates', (req, res) => {
  try {
    const tab = req.query.tab || 'all';
    res.json(findDuplicates({ tab }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/duplicates/clean-all', (req, res) => {
  try {
    const { type = 'exact' } = req.body || {};
    const result = cleanAllDuplicates(type);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/photos/batch-delete', (req, res) => {
  try {
    const { ids = [] } = req.body || {};
    const result = batchDeletePhotos(ids);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/albums', (req, res) => {
  try {
    res.json({ albums: stmts.getAlbums.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/albums', (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'El título es obligatorio' });
    stmts.createAlbum.run(title.trim(), description || '');
    res.json({ success: true, albums: stmts.getAlbums.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/albums/:id', (req, res) => {
  try {
    stmts.deleteAlbum.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/folders', (req, res) => {
  try {
    res.json({ folders: stmts.getFolders.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/folders', (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath || !fs.existsSync(folderPath)) {
      return res.status(400).json({ error: 'La ruta de la carpeta no existe' });
    }
    stmts.addFolder.run(path.normalize(folderPath));
    res.json({ success: true, folders: stmts.getFolders.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/folders/:id', (req, res) => {
  try {
    stmts.removeFolder.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scanner/start', async (req, res) => {
  try {
    let { folderPath } = req.body;
    if (!folderPath) {
      const folders = stmts.getFolders.all();
      folderPath = folders.length > 0 ? folders[0].path : path.join(os.homedir(), 'Pictures');
    }
    if (!fs.existsSync(folderPath)) return res.status(400).json({ error: `La carpeta ${folderPath} no existe` });
    scanner.scanFolder(folderPath).catch(console.error);
    res.json({ success: true, message: 'Escaneo iniciado', folder: folderPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scanner/pause', (req, res) => { scanner.pause(); res.json({ success: true }); });
router.post('/scanner/resume', (req, res) => { scanner.resume(); res.json({ success: true }); });
router.post('/scanner/cancel', (req, res) => { scanner.cancel(); res.json({ success: true }); });
router.get('/scanner/status', (req, res) => { res.json(scanner.getStatus()); });

router.get('/scanner/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'status', data: scanner.getStatus() })}\n\n`);
  const onProgress = data => res.write(`data: ${JSON.stringify({ type: 'progress', data })}\n\n`);
  const onComplete = data => res.write(`data: ${JSON.stringify({ type: 'complete', data })}\n\n`);
  const onError = err => res.write(`data: ${JSON.stringify({ type: 'error', data: { message: err.message } })}\n\n`);

  scanner.on('progress', onProgress);
  scanner.on('complete', onComplete);
  scanner.on('error', onError);

  req.on('close', () => {
    scanner.off('progress', onProgress);
    scanner.off('complete', onComplete);
    scanner.off('error', onError);
  });
});

// Rutas de Clasificación NSFW con Inteligencia Artificial
router.get('/nsfw/stats', (req, res) => {
  try {
    res.json(nsfwManager.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nsfw/scan', (req, res) => {
  try {
    const { batchSize = 16, threshold = 0.55 } = req.body || {};
    const result = nsfwManager.startScan({ batchSize, threshold });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nsfw/stop', (req, res) => {
  try {
    const result = nsfwManager.stopScan();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/nsfw/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  nsfwManager.addSubscriber(res);

  req.on('close', () => {
    nsfwManager.removeSubscriber(res);
  });
});

router.post('/photos/:id/toggle-nsfw', (req, res) => {
  try {
    stmts.toggleNsfw.run(req.params.id);
    const updated = stmts.getPhotoById.get(req.params.id);
    res.json({ success: true, photo: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rutas de Reconocimiento Facial y Personas
router.get('/faces/stats', (req, res) => {
  try {
    res.json(facesManager.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/faces/scan', (req, res) => {
  try {
    const { batchSize = 20 } = req.body || {};
    const result = facesManager.startScan({ batchSize });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/faces/stop', (req, res) => {
  try {
    const result = facesManager.stopScan();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/faces/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  facesManager.addSubscriber(res);

  req.on('close', () => {
    facesManager.removeSubscriber(res);
  });
});

router.get('/faces/persons', (req, res) => {
  try {
    const persons = stmts.getPersons.all();
    res.json({ persons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/faces/persons/:id', (req, res) => {
  try {
    const person = stmts.getPersonById.get(req.params.id);
    if (!person) return res.status(404).json({ error: 'Persona no encontrada' });
    res.json(person);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/faces/persons/:id/rename', (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    stmts.renamePerson.run(name.trim(), req.params.id);
    const updated = stmts.getPersonById.get(req.params.id);
    res.json({ success: true, person: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/faces/persons/:id', (req, res) => {
  try {
    stmts.deletePerson.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/faces/persons/:id/photos', (req, res) => {
  try {
    const photos = stmts.getPhotosByPerson.all(req.params.id);
    const person = stmts.getPersonById.get(req.params.id);
    res.json({ person, photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/photos/:id/faces', (req, res) => {
  try {
    const faces = stmts.getFacesByPhotoId.all(req.params.id);
    res.json({ faces });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// RESTAURADOR Y MEJORADOR DE FOTOS POR IA
// ==========================================

router.post('/photos/:id/enhance', (req, res) => {
  try {
    const photo = stmts.getPhotoById.get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
    
    const { scale = 4, color_restore = true, denoise = true, unsharp = true, face_enhance = true } = req.body || {};
    const job = enhancerManager.startEnhance({
      photoId: photo.id,
      filePath: photo.file_path,
      scale: parseInt(scale) || 4,
      color_restore: !!color_restore,
      denoise: !!denoise,
      unsharp: !!unsharp,
      face_enhance: !!face_enhance
    });

    res.json({ success: true, jobId: job.jobId, status: job.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/enhance/status/:jobId', (req, res) => {
  const job = enhancerManager.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.json({
    jobId: job.jobId,
    photoId: job.photoId,
    status: job.status,
    progress: job.progress,
    step: job.step,
    error: job.error,
    result: job.result
  });
});

router.get('/enhance/preview/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '..', 'cache', 'enhanced', filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Preview no encontrado');
  res.sendFile(filePath);
});

router.post('/photos/:id/save-enhanced', async (req, res) => {
  try {
    const { jobId, mode = 'copy' } = req.body;
    const result = await enhancerManager.saveEnhancedPhoto({
      photoId: req.params.id,
      jobId,
      mode
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/photos/low-res/candidates', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 60;
    const offset = parseInt(req.query.offset) || 0;
    const photos = db.prepare(`
      SELECT * FROM photos 
      WHERE is_tiny = 0 AND width > 0 AND height > 0 AND (width <= 1280 OR height <= 1280)
      ORDER BY (width * height) ASC 
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    const count = db.prepare(`
      SELECT COUNT(*) as total FROM photos 
      WHERE is_tiny = 0 AND width > 0 AND height > 0 AND (width <= 1280 OR height <= 1280)
    `).get();
    res.json({ photos, total: count ? count.total : photos.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

