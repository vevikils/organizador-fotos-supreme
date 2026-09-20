// public/js/people.js
// Gestor de Clasificación por Personas y Reconocimiento Facial

const PeopleView = {
  eventSource: null,
  isScanning: false,
  persons: [],

  init() {
    this.setupViewEvents();
    this.connectEventStream();
  },

  connectEventStream() {
    if (this.eventSource) return;

    this.eventSource = new EventSource('/api/faces/stream');

    this.eventSource.addEventListener('start', (e) => {
      this.isScanning = true;
      this.showScanBanner(true);
      try {
        const data = JSON.parse(e.data);
        this.updateScanProgress(data);
      } catch (err) {}
    });

    this.eventSource.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.isScanning = true;
        this.showScanBanner(true);
        this.updateScanProgress(data);
      } catch (err) {}
    });

    this.eventSource.addEventListener('clustering', (e) => {
      const statusText = document.getElementById('faces-scan-status-text');
      if (statusText) {
        statusText.textContent = 'Agrupando caras similares en personas con IA...';
      }
    });

    this.eventSource.addEventListener('complete', (e) => {
      this.isScanning = false;
      this.showScanBanner(false);
      this.load();
    });

    this.eventSource.addEventListener('stopped', (e) => {
      this.isScanning = false;
      this.showScanBanner(false);
      this.load();
    });

    this.eventSource.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.isScanning) {
          this.isScanning = true;
          this.showScanBanner(true);
          this.updateScanProgress(data.current);
        }
      } catch (err) {}
    });
  },

  setupViewEvents() {
    const btnStart = document.getElementById('btn-start-faces-scan');
    if (btnStart) {
      btnStart.addEventListener('click', () => this.startScan());
    }

    const btnStop = document.getElementById('btn-stop-faces-scan');
    if (btnStop) {
      btnStop.addEventListener('click', () => this.stopScan());
    }
  },

  showScanBanner(show) {
    const banner = document.getElementById('faces-scan-banner');
    if (banner) {
      banner.style.display = show ? 'block' : 'none';
    }
  },

  updateScanProgress(raw) {
    const data = (raw && raw.current) ? raw.current : (raw || {});
    const fill = document.getElementById('faces-scan-progress-fill');
    const countText = document.getElementById('faces-scan-count-text');
    const fileText = document.getElementById('faces-scan-file-text');
    const pctText = document.getElementById('faces-scan-percentage-text');
    const statusText = document.getElementById('faces-scan-status-text');

    const total = data.total || 0;
    const processed = data.processed || 0;
    const pct = data.percentage ?? (total > 0 ? Math.round((processed / total) * 100) : 0);
    const facesFound = data.facesFound || data.faces_found || 0;
    const fileName = data.fileName || data.currentFile || data.current_file || '';

    if (fill) fill.style.width = `${pct}%`;
    if (pctText) pctText.textContent = `${pct}%`;
    if (countText) countText.textContent = `${processed} / ${total} fotos`;
    if (fileText && fileName) fileText.textContent = fileName;
    if (statusText) {
      statusText.textContent = `Detectando caras (${facesFound} encontradas)...`;
    }
  },

  async startScan() {
    try {
      const res = await fetch('/api/faces/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: 20 })
      });
      const data = await res.json();
      if (data.success) {
        this.showScanBanner(true);
      }
    } catch (e) {
      console.error('Error iniciando escaneo facial:', e);
    }
  },

  async stopScan() {
    try {
      await fetch('/api/faces/stop', { method: 'POST' });
      this.showScanBanner(false);
    } catch (e) {}
  },

  async load() {
    const container = document.getElementById('people-grid-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Cargando personas reconocidas...</p></div>';

    try {
      const [personsRes, statsRes] = await Promise.all([
        fetch('/api/faces/persons'),
        fetch('/api/faces/stats')
      ]);

      const personsData = await personsRes.json();
      const statsData = await statsRes.json();

      this.persons = personsData.persons || [];
      const stats = statsData.stats || {};

      const statTotalPersons = document.getElementById('stat-total-persons');
      const statTotalFaces = document.getElementById('stat-total-faces');
      const statPendingFaces = document.getElementById('stat-pending-faces');
      if (statTotalPersons) statTotalPersons.textContent = stats.total_persons || this.persons.length || 0;
      if (statTotalFaces) statTotalFaces.textContent = stats.total_faces || 0;
      if (statPendingFaces) statPendingFaces.textContent = stats.unscanned_photos || 0;

      if (this.persons.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <span class="material-symbols-outlined empty-icon" style="color: var(--accent-primary);">face</span>
            <h3>No hay personas agrupadas todavía</h3>
            <p>Utiliza la Inteligencia Artificial para escanear tus fotos, detectar rostros y agrupar automáticamente a las mismas personas.</p>
            <button class="btn btn-primary" onclick="PeopleView.startScan()">
              <span class="material-symbols-outlined">psychology</span>
              Escanear Personas con IA
            </button>
          </div>
        `;
        return;
      }

      let html = '<div class="people-grid">';
      this.persons.forEach(person => {
        const avatar = person.cover_crop_path || '/icons/default_avatar.png';
        html += `
          <div class="person-card" data-id="${person.id}">
            <div class="person-avatar-wrap">
              <img 
                src="${avatar}" 
                alt="${person.name}" 
                class="person-avatar" 
                loading="lazy" 
                onerror="this.src='/api/photos/${person.sample_photo_id}/thumbnail'"
              />
              <span class="person-badge-count">
                <span class="material-symbols-outlined">photo</span>
                ${person.photo_count}
              </span>
            </div>
            <div class="person-info">
              <h4 class="person-name" title="Clic para renombrar">${person.name}</h4>
              <p class="person-count">${person.photo_count} ${person.photo_count === 1 ? 'foto' : 'fotos'}</p>
            </div>
            <button class="btn-icon btn-rename-person" title="Renombrar persona" onclick="event.stopPropagation(); PeopleView.promptRename(${person.id}, '${person.name.replace(/'/g, "\\'")}')">
              <span class="material-symbols-outlined">edit</span>
            </button>
          </div>
        `;
      });
      html += '</div>';

      container.innerHTML = html;

      // Click para abrir la galería de fotos de esa persona
      container.querySelectorAll('.person-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.id;
          this.openPersonPhotos(id);
        });
      });

    } catch (e) {
      container.innerHTML = `<div class="error-msg">Error cargando personas: ${e.message}</div>`;
    }
  },

  openPersonPhotos(personId) {
    if (window.App) {
      window.App.currentFilters = { personId: Number(personId) };
      window.App.switchView('timeline');
    }
  },

  async promptRename(personId, currentName) {
    const newName = prompt(`Introduce el nombre para esta persona:`, currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    try {
      const res = await fetch(`/api/faces/persons/${personId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        this.load();
      }
    } catch (err) {
      alert(`Error al renombrar: ${err.message}`);
    }
  }
};

window.PeopleView = PeopleView;
