// public/js/nsfw.js
// Gestor de Clasificación y Modo Seguro (IA NSFW) para Móvil Standalone

const NsfwManager = {
  eventSource: null,
  isScanning: false,
  pollTimer: null,
  currentMode: 'blur',

  init() {
    this.setupSafeModeDropdown();
    this.setupViewEvents();
    this.connectEventStream();
    this.updateBadge();
  },

  setupSafeModeDropdown() {
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

    const options = dropdown.querySelectorAll('.safe-option');
    options.forEach(opt => {
      opt.addEventListener('click', () => {
        const mode = opt.dataset.mode;
        this.setMode(mode);
      });
    });
  },

  setMode(mode) {
    this.currentMode = mode;
    document.body.dataset.safeMode = mode;
    this.updateDropdownUI(mode);
    if (window.Timeline && typeof window.Timeline.refreshCurrentView === 'function') {
      window.Timeline.refreshCurrentView();
    }
  },

  updateDropdownUI(mode) {
    const btn = document.getElementById('btn-safe-mode');
    if (!btn) return;

    btn.className = `safe-mode-btn mode-${mode}`;
    const label = btn.querySelector('.safe-label');
    const icon = btn.querySelector('.safe-icon');

    if (mode === 'blur') {
      if (label) label.textContent = 'Modo Seguro: Desenfoque';
      if (icon) icon.textContent = 'blur_on';
    } else if (mode === 'hide') {
      if (label) label.textContent = 'Modo Seguro: Ocultar';
      if (icon) icon.textContent = 'visibility_off';
    } else {
      if (label) label.textContent = 'Modo Seguro: Desactivado';
      if (icon) icon.textContent = 'blur_off';
    }

    const dropdown = document.getElementById('safe-mode-dropdown');
    if (dropdown) {
      dropdown.querySelectorAll('.safe-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.mode === mode);
      });
    }
  },

  async updateBadge() {
    try {
      const res = await fetch('/api/nsfw/stats');
      if (!res.ok) return;
      const data = await res.json();
      const stats = data.stats || {};

      const count = stats.nsfw_photos || 0;
      const badge = document.getElementById('nsfw-badge');
      if (badge) {
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }

      const statNsfw = document.getElementById('stat-nsfw-total');
      const statSfw = document.getElementById('stat-sfw-total');
      const statPending = document.getElementById('stat-pending-total');
      if (statNsfw) statNsfw.textContent = count;
      if (statSfw) statSfw.textContent = stats.sfw_photos || 0;
      if (statPending) statPending.textContent = stats.unclassified_photos || 0;
    } catch (e) {}
  },

  connectEventStream() {
    if (this.eventSource) return;

    try {
      this.eventSource = new EventSource('/api/nsfw/stream');

      this.eventSource.addEventListener('start', (e) => {
        this.isScanning = true;
        this.showScanBanner(true);
      });

      this.eventSource.addEventListener('progress', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.isScanning = true;
          this.showScanBanner(true);
          this.updateScanProgress(data);
        } catch (err) {}
      });

      this.eventSource.addEventListener('complete', () => this.finishScan());
      this.eventSource.addEventListener('stopped', () => this.finishScan());
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

  showScanBanner(show) {
    const banner = document.getElementById('ai-scan-banner');
    if (banner) {
      banner.style.display = show ? 'block' : 'none';
    }
    const btnStart = document.getElementById('btn-start-ai-scan');
    if (btnStart) {
      btnStart.disabled = show;
      btnStart.style.opacity = show ? '0.6' : '1';
    }
  },

  updateScanProgress(data) {
    if (!data) return;
    const processed = data.processed || 0;
    const total = data.total || 0;
    const nsfwTotal = data.nsfwTotal || 0;

    const countText = document.getElementById('ai-scan-count-text');
    const percentText = document.getElementById('ai-scan-percentage-text');
    const progressFill = document.getElementById('ai-scan-progress-fill');

    // Live update stats cards
    const statNsfw = document.getElementById('stat-nsfw-total');
    if (statNsfw) statNsfw.textContent = nsfwTotal;
    const statSfw = document.getElementById('stat-sfw-total');
    if (statSfw) statSfw.textContent = Math.max(0, processed - nsfwTotal);
    const statPending = document.getElementById('stat-pending-total');
    if (statPending && total >= processed) statPending.textContent = Math.max(0, total - processed);
    const statusText = document.getElementById('ai-scan-status-text');

    const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

    if (countText) countText.textContent = `${processed} / ${total} fotos (${nsfwTotal} sensibles)`;
    if (percentText) percentText.textContent = `${pct}%`;
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (statusText) statusText.textContent = `Analizando privacidad en tu móvil... (${nsfwTotal} detectadas)`;
  },

  async startAiScan() {
    try {
      this.isScanning = true;
      this.showScanBanner(true);
      this.updateScanProgress({ processed: 0, total: 10, nsfwTotal: 0 });

      await fetch('/api/nsfw/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/nsfw/status');
          const data = await res.json();
          if (data && data.current) {
            this.updateScanProgress(data.current);
            if (!data.isScanning && data.current.processed >= data.current.total && data.current.total > 0) {
              this.finishScan();
            }
          }
        } catch (err) {}
      }, 700);

    } catch (e) {
      this.finishScan();
    }
  },

  async stopAiScan() {
    try {
      await fetch('/api/nsfw/stop', { method: 'POST' });
    } catch (e) {}
    this.finishScan();
  },

  finishScan() {
    this.isScanning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.showScanBanner(false);
    this.updateBadge();
    this.loadNsfwView();
  },

  async loadNsfwView() {
    const container = document.getElementById('nsfw-grid-container');
    if (!container) return;

    try {
      const res = await fetch('/api/photos?nsfw=nsfw_only&limit=120');
      const data = await res.json();
      const photos = Array.isArray(data) ? data : (data.photos || []);

      this.updateBadge();

      if (photos.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <span class="material-symbols-outlined empty-icon" style="color: #10b981;">verified_user</span>
            <h3>No se detectó contenido sensible</h3>
            <p>Todas tus fotos analizadas son seguras, o aún no has ejecutado el análisis en el teléfono.</p>
            <button class="btn btn-primary btn-pill" onclick="NsfwManager.startAiScan()">
              <span class="material-symbols-outlined">shield</span>
              Analizar Fotos con IA
            </button>
          </div>
        `;
        return;
      }

      let html = '<div class="photo-grid">';
      photos.forEach(photo => {
        const thumb = `/api/photos/${photo.id}/thumbnail`;
        html += `
          <div class="photo-card" data-id="${photo.id}">
            <img src="${thumb}" alt="${photo.file_name}" loading="lazy" class="photo-thumb" onerror="this.style.opacity=0.4">
            <span class="nsfw-badge-pill" style="position: absolute; top: 6px; right: 6px; background: rgba(239, 68, 68, 0.85); color: #fff; border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; font-weight: 700;">
              Sensible
            </span>
          </div>
        `;
      });
      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.photo-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.id;
          if (window.Lightbox) window.Lightbox.open(id);
        });
      });
    } catch (e) {
      container.innerHTML = `<div class="error-msg">Error cargando fotos sensibles: ${e.message}</div>`;
    }
  }
};

window.NsfwManager = NsfwManager;
document.addEventListener('DOMContentLoaded', () => NsfwManager.init());
