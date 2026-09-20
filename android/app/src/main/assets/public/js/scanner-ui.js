// public/js/scanner-ui.js
const ScannerUI = {
  modal: null,
  eventSource: null,
  isScanning: false,

  init() {
    this.modal = document.getElementById('scanner-modal');

    document.getElementById('btn-close-scanner-modal').addEventListener('click', () => this.closeModal());
    document.getElementById('btn-pause-scan').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-cancel-scan').addEventListener('click', () => this.cancelScan());

    document.getElementById('btn-quick-scan').addEventListener('click', () => this.startScan());
    const emptyBtn = document.getElementById('btn-empty-scan');
    if (emptyBtn) emptyBtn.addEventListener('click', () => this.startScan());

    document.getElementById('btn-browse-folder').addEventListener('click', () => this.browseFolder());
    document.getElementById('btn-add-folder').addEventListener('click', () => this.addCustomFolder());

    this.connectSSE();
    this.loadFolders();
  },

  connectSSE() {
    if (this.eventSource) this.eventSource.close();
    this.eventSource = new EventSource('/api/scanner/stream');

    this.eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'progress' || payload.type === 'status') {
          this.updateProgress(payload.data);
        } else if (payload.type === 'complete') {
          this.onComplete(payload.data);
        }
      } catch (err) {}
    };

    this.eventSource.onerror = () => setTimeout(() => this.connectSSE(), 3000);
  },

  async startScan(folderPath = null) {
    try {
      this.openModal();
      document.getElementById('scan-modal-title').textContent = 'Escaneando fotos...';
      document.getElementById('scan-modal-icon').className = 'material-symbols-outlined modal-icon animate-spin';

      const res = await fetch('/api/scanner/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
      const data = await res.json();
      if (!data.success && data.error) {
        alert(data.error);
        this.closeModal();
      }
    } catch (err) {
      this.closeModal();
    }
  },

  updateProgress(stats) {
    if (!stats) return;
    this.isScanning = stats.isScanning;

    const quickBtn = document.getElementById('btn-quick-scan');
    if (stats.isScanning) {
      quickBtn.querySelector('.material-symbols-outlined').classList.add('animate-spin');
    } else {
      quickBtn.querySelector('.material-symbols-outlined').classList.remove('animate-spin');
    }

    const total = stats.totalFound || 0;
    const scanned = stats.scanned || 0;
    const pct = total > 0 ? Math.min(Math.round((scanned / total) * 100), 100) : 0;

    document.getElementById('scan-progress-bar').style.width = `${pct}%`;
    document.getElementById('scan-count-text').textContent = `${scanned} / ${total} analizadas`;
    document.getElementById('scan-percent-text').textContent = `${pct}%`;

    if (stats.currentFile) {
      document.getElementById('scan-current-file').textContent = `Procesando: ${stats.currentFile}`;
    }

    document.getElementById('scan-added-count').textContent = stats.added || 0;
    document.getElementById('scan-updated-count').textContent = stats.updated || 0;
    document.getElementById('scan-errors-count').textContent = stats.errors || 0;

    const pauseBtn = document.getElementById('btn-pause-scan');
    if (stats.isPaused) {
      pauseBtn.textContent = 'Reanudar';
      document.getElementById('scan-modal-title').textContent = 'Escaneo en Pausa';
      document.getElementById('scan-modal-icon').className = 'material-symbols-outlined modal-icon';
    } else {
      pauseBtn.textContent = 'Pausar';
    }
  },

  onComplete(stats) {
    this.isScanning = false;
    document.getElementById('scan-modal-title').textContent = '¡Escaneo Completado!';
    document.getElementById('scan-modal-icon').className = 'material-symbols-outlined modal-icon';
    document.getElementById('scan-modal-icon').textContent = 'check_circle';
    document.getElementById('scan-modal-icon').style.color = 'var(--accent-success)';
    document.getElementById('scan-current-file').textContent = `Se procesaron exitosamente ${stats.scanned} imágenes.`;

    App.updateStats();
    App.reloadCurrentView();
    this.loadFolders();

    setTimeout(() => {
      this.closeModal();
      document.getElementById('scan-modal-icon').textContent = 'sync';
      document.getElementById('scan-modal-icon').style.color = 'var(--accent-primary)';
    }, 2500);
  },

  async togglePause() {
    const pauseBtn = document.getElementById('btn-pause-scan');
    if (pauseBtn.textContent === 'Pausar') {
      await fetch('/api/scanner/pause', { method: 'POST' });
    } else {
      await fetch('/api/scanner/resume', { method: 'POST' });
    }
  },

  async cancelScan() {
    await fetch('/api/scanner/cancel', { method: 'POST' });
    this.closeModal();
  },

  openModal() { this.modal.style.display = 'flex'; },
  closeModal() { this.modal.style.display = 'none'; },

  async loadFolders() {
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      const folders = data.folders || [];
      const listEl = document.getElementById('folders-list');
      listEl.innerHTML = '';

      if (folders.length === 0) {
        listEl.innerHTML = '<p style="color: var(--text-tertiary); font-size: 0.85rem;">No hay carpetas añadidas aún.</p>';
        return;
      }

      for (const f of folders) {
        const row = document.createElement('div');
        row.className = 'folder-row';
        row.innerHTML = `
          <div class="folder-path-info">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">folder</span>
            <div>
              <div class="folder-path-text">${f.path}</div>
              <div class="folder-count-text">${f.photo_count || 0} fotos &bull; Último escaneo: ${f.last_scanned ? new Date(f.last_scanned).toLocaleString('es-ES') : 'Pendiente'}</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm btn-secondary" onclick="ScannerUI.startScan('${f.path.replace(/\\/g, '\\\\')}')" title="Escanear">
              <span class="material-symbols-outlined">sync</span>
            </button>
            <button class="btn btn-sm btn-secondary" onclick="ScannerUI.removeFolder(${f.id})" title="Quitar">
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        `;
        listEl.appendChild(row);
      }
    } catch (err) {}
  },

  async browseFolder() {
    if (window.electronAPI && window.electronAPI.selectFolder) {
      const selected = await window.electronAPI.selectFolder();
      if (selected) document.getElementById('custom-folder-path').value = selected;
    } else {
      const promptVal = prompt('Introduce la ruta de la carpeta (ej: C:\\Users\\tu_usuario\\Pictures):');
      if (promptVal) document.getElementById('custom-folder-path').value = promptVal.trim();
    }
  },

  async addCustomFolder() {
    const input = document.getElementById('custom-folder-path');
    const folderPath = input.value.trim();
    if (!folderPath) return alert('Selecciona una carpeta.');

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        input.value = '';
        await this.loadFolders();
        if (confirm(`Carpeta añadida. ¿Iniciar escaneo de "${folderPath}" ahora?`)) {
          this.startScan(folderPath);
        }
      }
    } catch (err) {}
  },

  async removeFolder(folderId) {
    if (!confirm('¿Dejar de monitorear esta carpeta?')) return;
    try {
      await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      await this.loadFolders();
    } catch (err) {}
  }
};
