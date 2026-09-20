// public/js/people.js
// Gestor de Clasificación por Personas y Reconocimiento Facial (Android Standalone)

const PeopleView = {
  eventSource: null,
  isScanning: false,
  pollTimer: null,
  persons: [],

  init() {
    this.setupViewEvents();
    this.connectEventStream();
  },

  connectEventStream() {
    if (this.eventSource) return;

    try {
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

      this.eventSource.addEventListener('complete', (e) => {
        this.finishScan();
      });

      this.eventSource.addEventListener('stopped', (e) => {
        this.finishScan();
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
    } catch (e) {
      console.log('SSE fallback to polling');
    }
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
    const btnStart = document.getElementById('btn-start-faces-scan');
    if (btnStart) {
      btnStart.disabled = show;
      btnStart.style.opacity = show ? '0.6' : '1';
    }
  },

  updateScanProgress(data) {
    if (!data) return;
    const processed = data.processed || 0;
    const total = data.total || 0;
    const faces = data.faces || 0;
    const people = data.people || 0;

    const countText = document.getElementById('faces-scan-count-text');
    const percentText = document.getElementById('faces-scan-percentage-text');
    const progressFill = document.getElementById('faces-scan-progress-fill');
    const statusText = document.getElementById('faces-scan-status-text');

    const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

    if (countText) countText.textContent = `${processed} / ${total} fotos (${faces} caras)`;
    if (percentText) percentText.textContent = `${pct}%`;
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (statusText) statusText.textContent = `Detectando rostros en tu móvil... (${faces} caras encontradas)`;

    const statFaces = document.getElementById('stat-total-faces');
    const statPersons = document.getElementById('stat-total-persons');
    if (statFaces && faces > 0) statFaces.textContent = faces;
    if (statPersons && people > 0) statPersons.textContent = people;
  },

  async startScan() {
    try {
      this.isScanning = true;
      this.showScanBanner(true);
      this.updateScanProgress({ processed: 0, total: 10, faces: 0, people: 0 });

      await fetch('/api/faces/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      // Active status polling loop
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/faces/status');
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
      console.error(e);
      this.finishScan();
    }
  },

  async stopScan() {
    try {
      await fetch('/api/faces/stop', { method: 'POST' });
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
    this.load();
  },

  async load() {
    const container = document.getElementById('faces-grid-container');
    if (!container) return;

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
            <span class="material-symbols-outlined empty-icon" style="color: #6366f1;">face</span>
            <h3>No hay personas agrupadas todavía</h3>
            <p>Utiliza la Inteligencia Artificial para escanear las fotos de tu teléfono, detectar rostros y agrupar automáticamente a tus personas.</p>
            <button class="btn btn-primary btn-pill" onclick="PeopleView.startScan()">
              <span class="material-symbols-outlined">psychology</span>
              Escanear Personas con IA
            </button>
          </div>
        `;
        return;
      }

      let html = '<div class="people-grid">';
      this.persons.forEach(person => {
        const thumbUrl = `/api/photos/${person.sample_photo_id}/thumbnail`;
        html += `
          <div class="person-card" data-id="${person.id}">
            <div class="person-avatar-wrap">
              <img 
                src="${thumbUrl}" 
                alt="${person.name}" 
                class="person-avatar" 
                loading="lazy" 
                onerror="this.style.opacity=0.4"
              />
              <span class="person-badge-count">
                <span class="material-symbols-outlined">photo</span>
                ${person.photo_count}
              </span>
            </div>
            <div class="person-info">
              <h4 class="person-name">${person.name}</h4>
              <p class="person-count">${person.photo_count} ${person.photo_count === 1 ? 'foto' : 'fotos'}</p>
            </div>
            <button class="btn-icon btn-rename-person" title="Renombrar persona" onclick="event.stopPropagation(); PeopleView.promptRename(${person.id}, '${person.name.replace(/'/g, "\'")}')">
              <span class="material-symbols-outlined">edit</span>
            </button>
          </div>
        `;
      });
      html += '</div>';

      container.innerHTML = html;

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
document.addEventListener('DOMContentLoaded', () => PeopleView.init());
