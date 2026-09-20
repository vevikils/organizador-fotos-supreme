// public/js/albums.js
const AlbumsView = {
  grid: null,
  modal: null,

  init() {
    this.grid = document.getElementById('albums-grid');
    this.modal = document.getElementById('album-modal');

    document.getElementById('btn-create-album').addEventListener('click', () => this.openCreateModal());
    document.getElementById('btn-close-album-modal').addEventListener('click', () => this.closeModal());
    document.getElementById('btn-cancel-album').addEventListener('click', () => this.closeModal());
    document.getElementById('btn-save-album').addEventListener('click', () => this.saveAlbum());
  },

  async load() {
    try {
      const res = await fetch('/api/albums');
      const data = await res.json();
      const albums = data.albums || [];
      this.grid.innerHTML = '';

      if (albums.length === 0) {
        this.grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1/-1;">
            <span class="material-symbols-outlined empty-icon">photo_album</span>
            <h3>No tienes álbumes creados</h3>
            <p>Crea tu primer álbum para organizar tus fotos favoritas por temática o evento.</p>
            <button class="btn btn-primary" onclick="AlbumsView.openCreateModal()">
              <span class="material-symbols-outlined">add</span>
              Crear Álbum
            </button>
          </div>
        `;
        return;
      }

      for (const album of albums) {
        const card = document.createElement('div');
        card.className = 'category-card';
        const coverSrc = album.sample_thumb ? `/cache/thumbnails/${album.sample_thumb.split('/').pop()}` : '';

        card.innerHTML = `
          <div style="height: 160px; background: var(--bg-surface-active); display: flex; align-items: center; justify-content: center; overflow: hidden;">
            ${coverSrc ? `<img src="${coverSrc}" style="width:100%; height:100%; object-fit: cover;" onerror="this.style.display='none'">` : '<span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-tertiary);">photo_album</span>'}
          </div>
          <div class="category-body">
            <div>
              <div class="category-name">${album.title}</div>
              <div class="category-count">${album.photo_count || 0} fotos</div>
            </div>
            <button class="btn-icon" onclick="event.stopPropagation(); AlbumsView.deleteAlbum(${album.id}, '${album.title}')" title="Eliminar">
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        `;
        card.addEventListener('click', () => App.filterByAlbum(album.id, album.title));
        this.grid.appendChild(card);
      }
    } catch (err) {}
  },

  openCreateModal() {
    document.getElementById('album-title-input').value = '';
    document.getElementById('album-desc-input').value = '';
    this.modal.style.display = 'flex';
    document.getElementById('album-title-input').focus();
  },

  closeModal() {
    this.modal.style.display = 'none';
  },

  async saveAlbum() {
    const title = document.getElementById('album-title-input').value.trim();
    const desc = document.getElementById('album-desc-input').value.trim();
    if (!title) return alert('Introduce un nombre para el álbum.');

    try {
      const res = await fetch('/api/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: desc })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal();
        await this.load();
        App.updateStats();
      }
    } catch (err) {}
  },

  async deleteAlbum(albumId, title) {
    if (!confirm(`¿Eliminar el álbum "${title}"?`)) return;
    try {
      await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
      await this.load();
      App.updateStats();
    } catch (err) {}
  }
};
