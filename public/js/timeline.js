// public/js/timeline.js
const Timeline = {
  container: null,
  scrubber: null,
  emptyState: null,
  currentPhotos: [],
  totalPhotos: 0,
  currentOffset: 0,
  pageSize: 100,
  isLoading: false,
  hasMore: true,
  currentFilters: {},
  hideTiny: true,

  init() {
    this.container = document.getElementById('timeline-container');
    this.scrubber = document.getElementById('timeline-scrubber');
    this.emptyState = document.getElementById('timeline-empty');

    this.container.addEventListener('scroll', () => {
      const scrollBottom = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight;
      if (scrollBottom < 400 && !this.isLoading && this.hasMore) {
        this.loadMore();
      }
      this.updateScrubberOnScroll();
    });

    const toggleTinyBtn = document.getElementById('btn-toggle-tiny-filter');
    if (toggleTinyBtn) {
      toggleTinyBtn.addEventListener('click', () => {
        this.hideTiny = !this.hideTiny;
        this.updateTinyFilterButton();
        this.load(this.currentFilters);
      });
    }

    this.container.addEventListener('click', (e) => {
      const clearAiBtn = e.target.closest('#btn-clear-ai-filter');
      if (clearAiBtn) {
        e.stopPropagation();
        delete this.currentFilters.is_ai;
        if (window.App && window.App.currentFilters) delete window.App.currentFilters.is_ai;
        this.load(this.currentFilters);
        return;
      }

      const clearTinyBtn = e.target.closest('#btn-clear-tiny-filter');
      if (clearTinyBtn) {
        e.stopPropagation();
        delete this.currentFilters.is_tiny;
        if (window.App && window.App.currentFilters) delete window.App.currentFilters.is_tiny;
        this.load(this.currentFilters);
        return;
      }

      const clearYearBtn = e.target.closest('#btn-clear-year-filter');
      if (clearYearBtn) {
        e.stopPropagation();
        delete this.currentFilters.year;
        if (window.App && window.App.currentFilters) delete window.App.currentFilters.year;
        this.load(this.currentFilters);
        return;
      }

      const clearPersonBtn = e.target.closest('#btn-clear-person-filter');
      if (clearPersonBtn) {
        e.stopPropagation();
        delete this.currentFilters.personId;
        if (window.App && window.App.currentFilters) delete window.App.currentFilters.personId;
        this.load(this.currentFilters);
        return;
      }

      const favBtn = e.target.closest('.photo-fav-btn');
      if (favBtn) {
        e.stopPropagation();
        const photoId = parseInt(favBtn.dataset.id, 10);
        this.toggleFavorite(photoId, favBtn);
        return;
      }

      const blurOverlay = e.target.closest('.nsfw-blur-overlay');
      if (blurOverlay) {
        e.stopPropagation();
        const card = blurOverlay.closest('.photo-card');
        const photoId = parseInt(card.dataset.id, 10);
        if (window.nsfwManagerClient) {
          window.nsfwManagerClient.toggleRevealPhoto(photoId, card);
        }
        return;
      }

      const card = e.target.closest('.photo-card');
      if (card) {
        if (card.classList.contains('nsfw-blurred')) {
          e.stopPropagation();
          const photoId = parseInt(card.dataset.id, 10);
          if (window.nsfwManagerClient) {
            window.nsfwManagerClient.toggleRevealPhoto(photoId, card);
          }
          return;
        }

        const photoId = parseInt(card.dataset.id, 10);
        const index = this.currentPhotos.findIndex(p => p.id === photoId);
        if (index !== -1) {
          Lightbox.open(this.currentPhotos, index);
        }
      }
    });
  },

  async load(filters = {}) {
    this.currentFilters = { ...filters };
    this.currentOffset = 0;
    this.currentPhotos = [];
    this.hasMore = true;
    this.container.innerHTML = '';
    this.renderFilterBanner();
    await this.loadMore();
    await this.loadScrubberYears();
  },

  renderFilterBanner() {
    let bannerHtml = '';
    if (this.currentFilters.year) {
      bannerHtml = `
        <div class="timeline-filter-banner" id="timeline-filter-banner">
          <div class="timeline-filter-chip">
            <span class="material-symbols-outlined">calendar_today</span>
            <span>Año: <strong>${this.currentFilters.year}</strong></span>
            <button class="btn-chip-close" id="btn-clear-year-filter" title="Ver todos los años">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      `;
    } else if (this.currentFilters.is_ai) {
      bannerHtml = `
        <div class="timeline-filter-banner" id="timeline-filter-banner">
          <div class="timeline-filter-chip" style="background: rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.4);">
            <span class="material-symbols-outlined" style="color: #a855f7;">auto_awesome</span>
            <span>Generado por IA: <strong>${this.totalPhotos.toLocaleString()} fotos</strong></span>
            <button class="btn-chip-close" id="btn-clear-ai-filter" title="Ver todas las fotos">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      `;
    } else if (this.currentFilters.is_tiny) {
      bannerHtml = `
        <div class="timeline-filter-banner" id="timeline-filter-banner">
          <div class="timeline-filter-chip" style="background: rgba(100, 116, 139, 0.15); border-color: rgba(100, 116, 139, 0.4);">
            <span class="material-symbols-outlined" style="color: #94a3b8;">photo_size_select_small</span>
            <span>Miniaturas & Archivos &lt; 1 KB: <strong>${this.totalPhotos.toLocaleString()} fotos</strong></span>
            <button class="btn-chip-close" id="btn-clear-tiny-filter" title="Ver todas las fotos">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      `;
    } else if (this.currentFilters.personId) {
      bannerHtml = `
        <div class="timeline-filter-banner" id="timeline-filter-banner">
          <div class="timeline-filter-chip">
            <span class="material-symbols-outlined">face</span>
            <span>Filtrado por persona</span>
            <button class="btn-chip-close" id="btn-clear-person-filter" title="Ver todas las fotos">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      `;
    }

    if (bannerHtml) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = bannerHtml;
      this.container.appendChild(wrapper.firstElementChild);
    }
  },

  async loadMore() {
    if (this.isLoading || !this.hasMore) return;
    this.isLoading = true;
    try {
      const safeMode = (window.nsfwManagerClient && window.nsfwManagerClient.getMode) ? window.nsfwManagerClient.getMode() : 'blur';
      const params = new URLSearchParams({
        limit: this.pageSize,
        offset: this.currentOffset,
        sort: (window.App && window.App.currentSort) || 'date_desc'
      });
      if (safeMode === 'hide') {
        params.append('nsfw', 'safe_only');
      }
      if (this.currentFilters.is_tiny) {
        params.append('is_tiny', '1');
      } else if (this.hideTiny) {
        params.append('exclude_tiny', '1');
      }

      for (const [key, val] of Object.entries(this.currentFilters)) {
        if (val !== null && val !== undefined && val !== '' && key !== 'is_tiny') {
          params.append(key, val);
        }
      }

      const res = await fetch(`/api/photos?${params.toString()}`);
      const data = await res.json();

      this.totalPhotos = data.total;
      this.currentOffset += data.photos.length;
      if (this.currentOffset >= data.total || data.photos.length === 0) {
        this.hasMore = false;
      }

      this.currentPhotos = [...this.currentPhotos, ...data.photos];
      this.renderChunk(data.photos);

      if (this.currentPhotos.length === 0) {
        if (this.emptyState) this.emptyState.style.display = 'flex';
      } else {
        if (this.emptyState) this.emptyState.style.display = 'none';
      }
    } catch (err) {
      console.error('Error al cargar fotos:', err);
    } finally {
      this.isLoading = false;
    }
  },

  renderChunk(photos) {
    if (!photos.length) return;
    const groups = {};
    for (const photo of photos) {
      let groupKey = 'Sin fecha';
      let title = 'Sin fecha';
      if (photo.year && photo.month) {
        const monthNames = [
          'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        const monthName = monthNames[photo.month - 1] || '';
        groupKey = `${photo.year}-${photo.month}`;
        title = `${monthName} de ${photo.year}`;
      }
      if (!groups[groupKey]) {
        groups[groupKey] = { title, year: photo.year, photos: [] };
      }
      groups[groupKey].photos.push(photo);
    }

    for (const [groupKey, group] of Object.entries(groups)) {
      let groupEl = document.getElementById(`timeline-group-${groupKey}`);
      let gridEl;

      if (!groupEl) {
        groupEl = document.createElement('div');
        groupEl.className = 'timeline-group';
        groupEl.id = `timeline-group-${groupKey}`;
        groupEl.dataset.year = group.year || '';

        const headerEl = document.createElement('div');
        headerEl.className = 'timeline-header';
        headerEl.innerHTML = `
          <h3 class="timeline-title">${group.title}</h3>
          <span class="timeline-count" id="group-count-${groupKey}"></span>
        `;

        gridEl = document.createElement('div');
        gridEl.className = 'photo-grid';
        gridEl.id = `photo-grid-${groupKey}`;

        groupEl.appendChild(headerEl);
        groupEl.appendChild(gridEl);
        this.container.appendChild(groupEl);
      } else {
        gridEl = document.getElementById(`photo-grid-${groupKey}`);
      }

      for (const photo of group.photos) {
        const card = this.createPhotoCard(photo);
        gridEl.appendChild(card);
      }

      const countEl = document.getElementById(`group-count-${groupKey}`);
      if (countEl && gridEl) {
        countEl.textContent = `${gridEl.children.length} fotos`;
      }
    }
  },

  createPhotoCard(photo) {
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.dataset.id = photo.id;

    const safeMode = (window.nsfwManagerClient && window.nsfwManagerClient.getMode) ? window.nsfwManagerClient.getMode() : 'blur';
    const isNsfw = photo.is_nsfw === 1;
    const isRevealed = window.nsfwManagerClient && window.nsfwManagerClient.isPhotoRevealed(photo.id);
    const shouldBlur = isNsfw && safeMode === 'blur' && !isRevealed;

    if (shouldBlur) {
      card.classList.add('nsfw-blurred');
    }

    const thumbUrl = `/api/photos/${photo.id}/thumbnail`;
    const isFav = photo.is_favorite === 1;

    let timeFormatted = '';
    if (photo.date_taken) {
      const d = new Date(photo.date_taken);
      timeFormatted = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    }

    let nsfwOverlayHtml = '';
    if (isNsfw) {
      const scorePct = Math.round((photo.nsfw_score || 0) * 100);
      if (safeMode === 'blur') {
        nsfwOverlayHtml = `
          <div class="nsfw-blur-overlay" title="Clic para ver foto sensible">
            <span class="material-symbols-outlined">visibility_off</span>
            <span class="blur-label">Sensible (${scorePct}%)</span>
            <span class="reveal-hint">Clic para ver</span>
          </div>
        `;
      } else if (safeMode === 'none') {
        nsfwOverlayHtml = `
          <div class="nsfw-badge-pill" title="IA detectó contenido sensible (${scorePct}%)">
            <span class="material-symbols-outlined">warning</span>
            <span>${scorePct}%</span>
          </div>
        `;
      }
    }

    card.innerHTML = `
      <img 
        src="${thumbUrl}" 
        alt="${photo.file_name}" 
        class="photo-thumb" 
        loading="lazy" 
        onerror="this.src='/api/photos/${photo.id}/raw'"
      />
      ${nsfwOverlayHtml}
      <div class="photo-overlay">
        <div class="photo-overlay-top">
          <button class="photo-fav-btn ${isFav ? 'active' : ''}" data-id="${photo.id}" title="Favorito">
            <span class="material-symbols-outlined">${isFav ? 'star' : 'star_border'}</span>
          </button>
        </div>
        <div class="photo-overlay-bottom">
          <span>${timeFormatted}</span>
          ${photo.city ? `<span>📍 ${photo.city}</span>` : ''}
        </div>
      </div>
    `;
    return card;
  },

  async toggleFavorite(photoId, favBtn) {
    try {
      const res = await fetch(`/api/photos/${photoId}/favorite`, { method: 'POST' });
      const data = await res.json();
      const icon = favBtn.querySelector('.material-symbols-outlined');
      if (data.is_favorite === 1) {
        favBtn.classList.add('active');
        icon.textContent = 'star';
      } else {
        favBtn.classList.remove('active');
        icon.textContent = 'star_border';
      }
      const p = this.currentPhotos.find(item => item.id === photoId);
      if (p) p.is_favorite = data.is_favorite;
      App.updateStats();
    } catch (err) {
      console.error(err);
    }
  },

  async loadScrubberYears() {
    try {
      const res = await fetch('/api/photos/timeline');
      const data = await res.json();
      if (!data.groups || !this.scrubber) return;

      const yearCounts = {};
      for (const g of data.groups) {
        if (g.year) {
          yearCounts[g.year] = (yearCounts[g.year] || 0) + (g.count || 0);
        }
      }

      const years = Object.keys(yearCounts).map(Number).sort((a, b) => b - a);
      this.scrubber.innerHTML = '';

      for (const year of years) {
        const item = document.createElement('div');
        item.className = 'scrubber-year';
        item.dataset.year = year;
        item.textContent = year;
        const count = yearCounts[year] || 0;
        item.title = `Año ${year} · ${count.toLocaleString('es-ES')} fotos (clic para saltar o filtrar)`;

        if (this.currentFilters.year && Number(this.currentFilters.year) === year) {
          item.classList.add('active');
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();

          // Si ya está activo ese año, toggle off para ver todos
          if (this.currentFilters.year && Number(this.currentFilters.year) === year) {
            delete this.currentFilters.year;
            if (window.App && window.App.currentFilters) delete window.App.currentFilters.year;
            this.load(this.currentFilters);
            return;
          }

          // Comprobar si el grupo ya está en el DOM actual
          const firstGroup = this.container.querySelector(`.timeline-group[data-year="${year}"]`);
          if (firstGroup && !this.currentFilters.year) {
            firstGroup.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this.highlightScrubberYear(year);
          } else {
            // Si no está en el DOM por la paginación, cargar filtrado directamente
            if (window.App && window.App.currentFilters) {
              window.App.currentFilters.year = year;
            }
            this.currentFilters.year = year;
            this.load(this.currentFilters);
          }
        });

        this.scrubber.appendChild(item);
      }
    } catch (err) {
      console.error('Error al cargar barra de cronología:', err);
    }
  },

  highlightScrubberYear(year) {
    if (!this.scrubber) return;
    this.scrubber.querySelectorAll('.scrubber-year').forEach(el => {
      el.classList.toggle('active', el.dataset.year === String(year));
    });
  },

  updateScrubberOnScroll() {
    if (!this.scrubber || !this.container || this.currentFilters.year) return;
    const groups = this.container.querySelectorAll('.timeline-group');
    if (!groups.length) return;

    const containerTop = this.container.getBoundingClientRect().top;
    let visibleYear = null;

    for (const group of groups) {
      const rect = group.getBoundingClientRect();
      if (rect.bottom > containerTop + 60) {
        visibleYear = group.dataset.year;
        break;
      }
    }

    if (visibleYear) {
      this.highlightScrubberYear(visibleYear);
    }
  },

  refreshCurrentView() {
    this.load(this.currentFilters);
  }
};

window.Timeline = Timeline;
window.timelineManager = Timeline;
