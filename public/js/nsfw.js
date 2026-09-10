// public/js/nsfw.js
// Gestor de Modo Seguro, Clasificacion NSFW y Visualizacion de Contenido Sensible

const nsfwManagerClient = {
  mode: localStorage.getItem('supreme_safe_mode') || 'blur', // 'blur' | 'hide' | 'none'
  revealedPhotoIds: new Set(),
  eventSource: null,
  isScanning: false,

  init() {
    this.setupSafeModeControls();
    this.connectEventStream();
    this.updateBadge();
    this.setupViewEvents();
  },

  getMode() {
    return this.mode;
  },

  setMode(newMode) {
    this.mode = newMode;
    localStorage.setItem('supreme_safe_mode', newMode);
    this.updateSafeModeUI();
    // Notificar a la linea de tiempo para actualizar el render
    if (window.timelineManager && typeof window.timelineManager.refreshCurrentView === 'function') {
      window.timelineManager.refreshCurrentView();
    }
  },

  setupSafeModeControls() {
    const btn = document.getElementById('btn-safe-mode');
    const dropdown = document.getElementById('safe-mode-dropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      dropdown.classList.remove('show');
    });

    dropdown.querySelectorAll('.safe-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const mode = opt.dataset.mode;
        this.setMode(mode);
        dropdown.classList.remove('show');
      });
    });

    const triggerBtn = document.getElementById('btn-trigger-nsfw-scan');
    if (triggerBtn) {
      triggerBtn.addEventListener('click', () => {
        dropdown.classList.remove('show');
        this.startAiScan();
      });
    }

    this.updateSafeModeUI();
  },

  updateSafeModeUI() {
    const btn = document.getElementById('btn-safe-mode');
    const dropdown = document.getElementById('safe-mode-dropdown');
    if (!btn) return;

    const label = btn.querySelector('.safe-label');
    const icon = btn.querySelector('.safe-icon');

    if (dropdown) {
      dropdown.querySelectorAll('.safe-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.mode === this.mode);
      });
    }

    if (this.mode === 'blur') {
      if (label) label.textContent = 'Modo Seguro: Desenfoque';
      if (icon) icon.textContent = 'blur_on';
      btn.className = 'safe-mode-btn mode-blur';
    } else if (this.mode === 'hide') {
      if (label) label.textContent = 'Modo Seguro: Ocultar';
      if (icon) icon.textContent = 'visibility_off';
      btn.className = 'safe-mode-btn mode-hide';
    } else {
      if (label) label.textContent = 'Modo Libre';
      if (icon) icon.textContent = 'visibility';
      btn.className = 'safe-mode-btn mode-none';
    }
  },

  isPhotoRevealed(photoId) {
    return this.revealedPhotoIds.has(Number(photoId));
  },

  toggleRevealPhoto(photoId, cardElement) {
    const id = Number(photoId);
    if (this.revealedPhotoIds.has(id)) {
      this.revealedPhotoIds.delete(id);
      if (cardElement) cardElement.classList.add('nsfw-blurred');
    } else {
      this.revealedPhotoIds.add(id);
      if (cardElement) cardElement.classList.remove('nsfw-blurred');
    }
  },

  async updateBadge() {
    try {
      const res = await fetch('/api/nsfw/stats');
      if (!res.ok) return;
      const data = await res.json();
      const nsfwCount = data.stats ? (data.stats.nsfw_photos || 0) : 0;
      
      const badge = document.getElementById('nsfw-badge');
      if (badge) {
        if (nsfwCount > 0) {
          badge.textContent = nsfwCount;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }

      // Actualizar tarjetas de estadistica si estamos en la vista NSFW
      const statNsfw = document.getElementById('stat-nsfw-total');
      const statSfw = document.getElementById('stat-sfw-total');
      const statPending = document.getElementById('stat-pending-total');
      if (statNsfw && data.stats) statNsfw.textContent = data.stats.nsfw_photos || 0;
      if (statSfw && data.stats) statSfw.textContent = data.stats.sfw_photos || 0;
      if (statPending && data.stats) statPending.textContent = data.stats.unclassified_photos || 0;
    } catch (e) {}
  },

  connectEventStream() {
    if (this.eventSource) return;

    this.eventSource = new EventSource('/api/nsfw/stream');

    this.eventSource.addEventListener('start', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.isScanning = true;
        this.showScanBanner(true);
        this.updateScanProgress(data);
      } catch (err) {
        this.isScanning = true;
        this.showScanBanner(true);
      }
    });

    this.eventSource.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.isScanning = true;
        this.showScanBanner(true);
        this.updateScanProgress(data);
        this.updateBadge();
      } catch (err) {}
    });

    this.eventSource.addEventListener('complete', (e) => {
      this.isScanning = false;
      this.showScanBanner(false);
      this.updateBadge();
      if (window.timelineManager && typeof window.timelineManager.refreshCurrentView === 'function') {
        window.timelineManager.refreshCurrentView();
      }
    });

    this.eventSource.addEventListener('stopped', (e) => {
      this.isScanning = false;
      this.showScanBanner(false);
      this.updateBadge();
    });

    this.eventSource.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.isScanning) {
          this.isScanning = true;
          this.showScanBanner(true);
          this.updateScanProgress(data.current || data);
        }
      } catch (err) {}
    });
  },

  showScanBanner(show) {
    const banner = document.getElementById('ai-scan-banner');
    if (banner) {
      banner.style.display = show ? 'block' : 'none';
    }
  },

  updateScanProgress(raw) {
    const data = (raw && raw.current) ? raw.current : (raw || {});
    const fill = document.getElementById('ai-scan-progress-fill');
    const countText = document.getElementById('ai-scan-count-text');
    const fileText = document.getElementById('ai-scan-file-text');
    const pctText = document.getElementById('ai-scan-percentage-text');
    const statusText = document.getElementById('ai-scan-status-text');

    const total = data.total || 0;
    const processed = data.processed || 0;
    const pct = data.percentage ?? (total > 0 ? Math.round((processed / total) * 100) : 0);
    const nsfwTotal = data.nsfwTotal ?? data.nsfwFound ?? 0;
    const fileName = data.fileName || data.currentFile || '';

    if (fill) fill.style.width = `${pct}%`;
    if (pctText) pctText.textContent = `${pct}%`;
    if (countText) countText.textContent = `${processed} / ${total} fotos`;
    if (fileText && fileName) fileText.textContent = fileName;
    if (statusText) {
      statusText.textContent = `Analizando con IA (${nsfwTotal} sensibles detectadas)...`;
    }
  },

  async startAiScan() {
    try {
      const res = await fetch('/api/nsfw/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: 16, threshold: 0.55 })
      });
      const data = await res.json();
      if (data.success) {
        this.showScanBanner(true);
        this.updateBadge();
      }
    } catch (e) {
      console.error('Error iniciando escaneo NSFW:', e);
    }
  },

  async stopAiScan() {
    try {
      await fetch('/api/nsfw/stop', { method: 'POST' });
      this.showScanBanner(false);
      this.updateBadge();
    } catch (e) {}
  },

  setupViewEvents() {
    const btnStart = document.getElementById('btn-start-ai-scan');
    if (btnStart) {
      btnStart.addEventListener('click', () => this.startAiScan());
    }

    const btnStop = document.getElementById('btn-stop-ai-scan');
    if (btnStop) {
      btnStop.addEventListener('click', () => this.stopAiScan());
    }
  },

  async loadNsfwView() {
    const container = document.getElementById('nsfw-grid-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Cargando fotos sensibles...</p></div>';
    await this.updateBadge();

    try {
      const res = await fetch('/api/photos?nsfw=nsfw_only&limit=120');
      const data = await res.json();

      if (!data.photos || data.photos.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <span class="material-symbols-outlined empty-icon" style="color: var(--success);">verified_user</span>
            <h3>No se encontraron fotos sensibles</h3>
            <p>Tu galeria esta libre de contenido marcado como NSFW o aun no has analizado tus fotos con la IA.</p>
            <button class="btn btn-primary" onclick="nsfwManagerClient.startAiScan()">
              <span class="material-symbols-outlined">psychology</span>
              Escanear Galeria con IA
            </button>
          </div>
        `;
        return;
      }

      let html = '<div class="photo-grid">';
      data.photos.forEach(photo => {
        const thumb = photo.thumbnail_path ? `/api/photos/${photo.id}/thumbnail` : `/api/photos/${photo.id}/raw`;
        const scorePct = Math.round((photo.nsfw_score || 0) * 100);
        html += `
          <div class="photo-card nsfw-card" data-id="${photo.id}">
            <div class="photo-img-wrap">
              <img src="${thumb}" alt="${photo.file_name}" loading="lazy" class="photo-thumb" onerror="this.src='/api/photos/${photo.id}/raw'">
              <span class="nsfw-badge-pill" title="Confianza IA: ${scorePct}%">
                <span class="material-symbols-outlined">warning</span>
                ${scorePct}% Sensible
              </span>
            </div>
            <div class="photo-card-info">
              <span class="photo-card-name" title="${photo.file_name}">${photo.file_name}</span>
              <button class="btn-icon btn-sm btn-override-nsfw" title="Marcar como Seguro (Falso positivo)" onclick="event.stopPropagation(); nsfwManagerClient.togglePhotoNsfw(${photo.id})">
                <span class="material-symbols-outlined">check_circle</span>
              </button>
            </div>
          </div>
        `;
      });
      html += '</div>';

      container.innerHTML = html;

      // Click para abrir en Lightbox
      container.querySelectorAll('.photo-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.id;
          if (window.lightbox) window.lightbox.open(id);
        });
      });

    } catch (e) {
      container.innerHTML = `<div class="error-msg">Error cargando fotos: ${e.message}</div>`;
    }
  },

  async togglePhotoNsfw(photoId) {
    try {
      const res = await fetch(`/api/photos/${photoId}/toggle-nsfw`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.updateBadge();
        this.loadNsfwView();
        if (window.timelineManager && typeof window.timelineManager.refreshCurrentView === 'function') {
          window.timelineManager.refreshCurrentView();
        }
      }
    } catch (e) {
      console.error('Error cambiando NSFW:', e);
    }
  }
};

window.nsfwManagerClient = nsfwManagerClient;
