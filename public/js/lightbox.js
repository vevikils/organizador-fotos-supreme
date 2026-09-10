// public/js/lightbox.js
const Lightbox = {
  modal: null,
  imageEl: null,
  photos: [],
  currentIndex: 0,
  currentRotation: 0,
  zoomLevel: 1,
  miniMap: null,
  miniMarker: null,
  isDrawerOpen: false,

  init() {
    this.modal = document.getElementById('lightbox-modal');
    this.imageEl = document.getElementById('lb-main-image');

    document.getElementById('lb-btn-prev').addEventListener('click', () => this.prev());
    document.getElementById('lb-btn-next').addEventListener('click', () => this.next());
    document.getElementById('lb-btn-close').addEventListener('click', () => this.close());
    document.getElementById('lightbox-backdrop').addEventListener('click', () => this.close());
    document.getElementById('lb-btn-favorite').addEventListener('click', () => this.toggleFavorite());
    document.getElementById('lb-btn-rotate').addEventListener('click', () => this.rotate());
    document.getElementById('lb-btn-info').addEventListener('click', () => this.toggleInfoDrawer());
    document.getElementById('lb-info-close').addEventListener('click', () => this.closeInfoDrawer());
    document.getElementById('lb-btn-open-explorer').addEventListener('click', () => this.openInExplorer());
    document.getElementById('btn-exif-open-folder').addEventListener('click', () => this.openInExplorer());
    document.getElementById('lb-btn-delete').addEventListener('click', () => this.deleteCurrentPhoto());

    const toggleNsfwBtn = document.getElementById('btn-exif-toggle-nsfw');
    if (toggleNsfwBtn) {
      toggleNsfwBtn.addEventListener('click', () => this.toggleNsfw());
    }

    window.addEventListener('keydown', (e) => {
      if (this.modal.style.display === 'none') return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this.prev();
      else if (e.key === 'ArrowRight') this.next();
      else if (e.key === 'f' || e.key === 'F') this.toggleFavorite();
      else if (e.key === 'i' || e.key === 'I') this.toggleInfoDrawer();
    });

    this.imageEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) this.zoomLevel = Math.min(this.zoomLevel + 0.2, 3);
      else this.zoomLevel = Math.max(this.zoomLevel - 0.2, 0.6);
      this.updateTransform();
    });
  },

  async open(photosOrId, index = 0) {
    if (typeof photosOrId === 'number' || typeof photosOrId === 'string') {
      const photoId = parseInt(photosOrId, 10);
      try {
        const res = await fetch(`/api/photos/${photoId}`);
        const photo = await res.json();
        this.photos = [photo];
        this.currentIndex = 0;
      } catch (e) {
        return;
      }
    } else if (Array.isArray(photosOrId) && photosOrId.length > 0) {
      this.photos = photosOrId;
      this.currentIndex = index;
    } else {
      return;
    }
    this.currentRotation = 0;
    this.zoomLevel = 1;
    this.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    this.renderCurrent();
  },

  close() {
    this.modal.style.display = 'none';
    document.body.style.overflow = '';
    this.imageEl.src = '';
    this.closeInfoDrawer();
  },

  prev() {
    this.currentIndex = this.currentIndex > 0 ? this.currentIndex - 1 : this.photos.length - 1;
    this.currentRotation = 0;
    this.zoomLevel = 1;
    this.renderCurrent();
  },

  next() {
    this.currentIndex = this.currentIndex < this.photos.length - 1 ? this.currentIndex + 1 : 0;
    this.currentRotation = 0;
    this.zoomLevel = 1;
    this.renderCurrent();
  },

  rotate() {
    this.currentRotation = (this.currentRotation + 90) % 360;
    this.updateTransform();
  },

  updateTransform() {
    this.imageEl.style.transform = `rotate(${this.currentRotation}deg) scale(${this.zoomLevel})`;
  },

  async renderCurrent() {
    const photo = this.photos[this.currentIndex];
    if (!photo) return;

    this.imageEl.src = `/api/photos/${photo.id}/raw`;
    this.updateTransform();

    document.getElementById('lb-filename').textContent = photo.file_name;
    let dateStr = '--';
    if (photo.date_taken) {
      const d = new Date(photo.date_taken);
      dateStr = d.toLocaleDateString('es-ES', { 
        weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    }
    document.getElementById('lb-date').textContent = dateStr;

    const favIcon = document.getElementById('lb-fav-icon');
    if (photo.is_favorite === 1) {
      favIcon.textContent = 'star';
      favIcon.style.color = 'var(--accent-star)';
    } else {
      favIcon.textContent = 'star_border';
      favIcon.style.color = '#ffffff';
    }

    this.renderExifInfo(photo, dateStr);
  },

  renderExifInfo(photo, dateStr) {
    document.getElementById('exif-datetime').textContent = dateStr;
    const timesOfDay = { morning: 'Mañana', afternoon: 'Tarde', golden_hour: 'Hora Dorada / Atardecer', night: 'Noche' };
    document.getElementById('exif-time-of-day').textContent = timesOfDay[photo.time_of_day] || 'Estándar';

    document.getElementById('exif-dimensions').textContent = photo.width && photo.height ? `${photo.width} × ${photo.height} px` : '--';
    const mb = (photo.file_size / (1024 * 1024)).toFixed(2);
    document.getElementById('exif-filesize').textContent = `${mb} MB`;

    document.getElementById('exif-camera').textContent = photo.camera_model || photo.camera_make || 'Cámara desconocida';
    document.getElementById('exif-lens').textContent = photo.lens_model || 'Lente estándar';

    document.getElementById('exif-aperture').textContent = photo.aperture ? `f/${photo.aperture}` : 'f/--';
    document.getElementById('exif-shutter').textContent = photo.shutter_speed || '--s';
    document.getElementById('exif-focal').textContent = photo.focal_length ? `${Math.round(photo.focal_length)}mm` : '--mm';
    document.getElementById('exif-iso').textContent = photo.iso ? `ISO ${photo.iso}` : 'ISO --';

    const locSection = document.getElementById('exif-location-section');
    if (photo.latitude && photo.longitude) {
      locSection.style.display = 'block';
      document.getElementById('exif-location-name').textContent = photo.location_name || `${photo.city || 'Ubicación'}, ${photo.country || ''}`;
      document.getElementById('exif-coordinates').textContent = `${photo.latitude.toFixed(4)}, ${photo.longitude.toFixed(4)}`;
      this.renderMiniMap(photo.latitude, photo.longitude);
    } else {
      locSection.style.display = 'none';
    }

    const catLabels = {
      screenshot: 'Captura de pantalla', panorama: 'Panorámica', document: 'Documento / Recibo',
      portrait: 'Retrato', night: 'Foto Nocturna', photo: 'Fotografía'
    };
    document.getElementById('exif-category-chip').textContent = catLabels[photo.category] || 'Fotografía';

    const colorDot = document.getElementById('exif-color-dot');
    colorDot.style.backgroundColor = photo.dominant_color || '#4a90e2';
    document.getElementById('exif-color-name').textContent = photo.color_group ? photo.color_group.toUpperCase() : 'COLOR';

    const filepathEl = document.getElementById('exif-filepath');
    filepathEl.textContent = photo.file_path;
    filepathEl.title = photo.file_path;

    const nsfwBadge = document.getElementById('exif-nsfw-badge');
    if (nsfwBadge) {
      if (photo.is_nsfw === 1) {
        const scorePct = Math.round((photo.nsfw_score || 0) * 100);
        nsfwBadge.textContent = `🔞 Sensible (${scorePct}%)`;
        nsfwBadge.className = 'badge badge-nsfw';
        nsfwBadge.style.backgroundColor = '#ea4335';
        nsfwBadge.style.color = '#fff';
      } else if (photo.nsfw_checked === 1) {
        nsfwBadge.textContent = '🛡️ Segura / SFW';
        nsfwBadge.className = 'badge';
        nsfwBadge.style.backgroundColor = 'var(--accent-success, #34a853)';
        nsfwBadge.style.color = '#fff';
      } else {
        nsfwBadge.textContent = '⏳ No analizada';
        nsfwBadge.className = 'badge';
        nsfwBadge.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        nsfwBadge.style.color = 'var(--text-secondary)';
      }
    }
  },

  renderMiniMap(lat, lon) {
    const mapEl = document.getElementById('lb-mini-map');
    if (!window.L) return;
    if (!this.miniMap) {
      this.miniMap = L.map(mapEl, { attributionControl: false, zoomControl: false, dragging: false }).setView([lat, lon], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(this.miniMap);
      this.miniMarker = L.marker([lat, lon]).addTo(this.miniMap);
    } else {
      this.miniMap.setView([lat, lon], 12);
      this.miniMarker.setLatLng([lat, lon]);
      setTimeout(() => this.miniMap.invalidateSize(), 200);
    }
  },

  toggleInfoDrawer() {
    const drawer = document.getElementById('lightbox-info-drawer');
    this.isDrawerOpen = !this.isDrawerOpen;
    if (this.isDrawerOpen) {
      drawer.classList.add('open');
      if (this.miniMap) setTimeout(() => this.miniMap.invalidateSize(), 300);
    } else {
      drawer.classList.remove('open');
    }
  },

  closeInfoDrawer() {
    this.isDrawerOpen = false;
    document.getElementById('lightbox-info-drawer').classList.remove('open');
  },

  async toggleFavorite() {
    const photo = this.photos[this.currentIndex];
    if (!photo) return;
    try {
      const res = await fetch(`/api/photos/${photo.id}/favorite`, { method: 'POST' });
      const data = await res.json();
      photo.is_favorite = data.is_favorite;
      const favIcon = document.getElementById('lb-fav-icon');
      favIcon.textContent = data.is_favorite === 1 ? 'star' : 'star_border';
      favIcon.style.color = data.is_favorite === 1 ? 'var(--accent-star)' : '#ffffff';
      App.updateStats();
    } catch (err) {}
  },

  async openInExplorer() {
    const photo = this.photos[this.currentIndex];
    if (!photo) return;
    if (window.electronAPI && window.electronAPI.showInFolder) {
      window.electronAPI.showInFolder(photo.file_path);
    } else {
      await fetch(`/api/photos/${photo.id}/open-folder`, { method: 'POST' });
    }
  },

  async deleteCurrentPhoto() {
    const photo = this.photos[this.currentIndex];
    if (!photo) return;
    if (!confirm(`¿Eliminar "${photo.file_name}" del catálogo?`)) return;

    try {
      await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' });
      this.photos.splice(this.currentIndex, 1);
      if (this.photos.length === 0) {
        this.close();
      } else {
        if (this.currentIndex >= this.photos.length) this.currentIndex = this.photos.length - 1;
        this.renderCurrent();
      }
      App.reloadCurrentView();
    } catch (err) {}
  },

  async toggleNsfw() {
    const photo = this.photos[this.currentIndex];
    if (!photo) return;
    try {
      const res = await fetch(`/api/photos/${photo.id}/toggle-nsfw`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.photo) {
        photo.is_nsfw = data.photo.is_nsfw;
        photo.nsfw_checked = data.photo.nsfw_checked;
        photo.nsfw_score = data.photo.nsfw_score;
        this.renderExifInfo(photo, document.getElementById('exif-datetime').textContent);
        if (window.nsfwManagerClient) window.nsfwManagerClient.updateBadge();
        const card = document.querySelector(`.photo-card[data-id="${photo.id}"]`);
        if (card) {
          if (photo.is_nsfw === 1) card.classList.add('nsfw-blurred');
          else card.classList.remove('nsfw-blurred');
        }
      }
    } catch (err) {
      console.error('Error al alternar NSFW:', err);
    }
  }
};

window.Lightbox = Lightbox;
window.lightbox = Lightbox;
