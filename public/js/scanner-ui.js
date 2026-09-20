// public/js/scanner-ui.js
// Gestor de Álbumes del Dispositivo Móvil

const ScannerUI = {
  init() {
    this.setupEvents();
    this.loadFolders();
  },

  setupEvents() {
    const btnRescan = document.getElementById('btn-rescan-folders');
    if (btnRescan) {
      btnRescan.addEventListener('click', () => this.rescanDevice());
    }
  },

  async rescanDevice() {
    const btn = document.getElementById('btn-rescan-folders');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span> Escaneando...';
    }

    try {
      await fetch('/api/folders/rescan', { method: 'POST' });
      await new Promise(r => setTimeout(r, 1500));
      await this.loadFolders();
      if (window.App) window.App.updateStats();
    } catch (e) {
      console.error(e);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined">sync</span> Re-escanear Móvil';
      }
    }
  },

  async loadFolders() {
    const listEl = document.getElementById('folders-list');
    if (!listEl) return;

    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      const folders = data.folders || [];

      if (folders.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <span class="material-symbols-outlined empty-icon" style="color: #3b82f6;">folder_off</span>
            <h3>No se encontraron carpetas con fotos</h3>
            <p>Pulsa el botón de arriba para iniciar el escaneo de tu teléfono.</p>
          </div>
        `;
        return;
      }

      let html = '';
      for (const f of folders) {
        const thumbUrl = f.sample_photo_id ? `/api/photos/${f.sample_photo_id}/thumbnail` : '/icons/icon.png';
        html += `
          <div class="device-folder-card" data-category="${f.name}">
            <div class="device-folder-cover">
              <img src="${thumbUrl}" alt="${f.name}" loading="lazy" class="folder-cover-img" onerror="this.src='/icons/icon.png'">
              <div class="folder-icon-badge">
                <span class="material-symbols-outlined">${f.icon || 'folder'}</span>
              </div>
            </div>
            <div class="device-folder-details">
              <h4 class="device-folder-name">${f.name}</h4>
              <span class="device-folder-count">${f.photo_count} fotos</span>
            </div>
          </div>
        `;
      }
      listEl.innerHTML = html;

      listEl.querySelectorAll('.device-folder-card').forEach(card => {
        card.addEventListener('click', () => {
          const category = card.dataset.category;
          if (window.App) {
            window.App.setFilter('category', category, category);
            window.App.switchView('timeline');
          }
        });
      });

    } catch (err) {
      listEl.innerHTML = `<div class="error-msg">Error cargando carpetas: ${err.message}</div>`;
    }
  }
};

window.ScannerUI = ScannerUI;
document.addEventListener('DOMContentLoaded', () => ScannerUI.init());
