// public/js/app.js
const App = {
  currentView: 'timeline',
  currentFilters: {},
  currentSort: 'date_desc',
  searchDebounceTimer: null,

  init() {
    Timeline.init();
    Lightbox.init();
    PlacesView.init();
    DuplicatesView.init();
    AlbumsView.init();
    ScannerUI.init();
    if (window.PeopleView) {
      window.PeopleView.init();
    }
    if (window.nsfwManagerClient) {
      window.nsfwManagerClient.init();
    }

    window.addEventListener('hashchange', () => this.handleRouting());
    this.handleRouting();

    this.initSearch();
    this.initTopControls();
    this.initTheme();
    this.updateStats();

    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        this.switchView(item.dataset.view);
      });
    });

    const mobileBtn = document.getElementById('btn-mobile-menu');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
      });
    }

    const btnReset = document.getElementById('btn-reset-all-filters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.clearAllFilters();
      });
    }
  },

  handleRouting() {
    const hash = window.location.hash.replace('#', '') || 'timeline';
    this.switchView(hash, false);
  },

  switchView(viewName, updateHash = true) {
    this.currentView = viewName;

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      if (item.dataset.view === viewName) item.classList.add('active');
      else item.classList.remove('active');
    });

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');

    const panels = document.querySelectorAll('.view-panel');
    panels.forEach(p => p.classList.remove('active'));

    const targetPanel = document.getElementById(`view-${viewName}`);
    if (targetPanel) targetPanel.classList.add('active');

    if (updateHash) window.location.hash = viewName;

    if (viewName === 'timeline') Timeline.load(this.currentFilters);
    else if (viewName === 'people') {
      if (window.PeopleView) window.PeopleView.load();
    }
    else if (viewName === 'places') PlacesView.load();
    else if (viewName === 'categories') this.loadCategoriesView();
    else if (viewName === 'colors') this.loadColorsView();
    else if (viewName === 'cameras') this.loadCamerasView();
    else if (viewName === 'favorites') this.loadFavoritesView();
    else if (viewName === 'albums') AlbumsView.load();
    else if (viewName === 'duplicates') DuplicatesView.load();
    else if (viewName === 'folders') ScannerUI.loadFolders();
    else if (viewName === 'nsfw') {
      if (window.nsfwManagerClient) window.nsfwManagerClient.loadNsfwView();
    }
  },

  reloadCurrentView() {
    this.switchView(this.currentView, false);
  },

  async loadCategoriesView() {
    const grid = document.getElementById('categories-grid');
    grid.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined animate-spin">sync</span></div>';

    try {
      const res = await fetch('/api/explore/categories');
      const data = await res.json();
      const categories = data.categories || [];
      grid.innerHTML = '';

      const labels = {
        photo: { name: 'Fotografías Estándar', icon: 'image' },
        screenshot: { name: 'Capturas de Pantalla', icon: 'screenshot' },
        panorama: { name: 'Panorámicas', icon: 'panorama' },
        portrait: { name: 'Retratos', icon: 'portrait' }
      };

      for (const cat of categories) {
        const info = labels[cat.category] || { name: cat.category, icon: 'category' };
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
          <img src="/api/photos/${cat.sample_photo_id}/thumbnail" alt="${info.name}" class="category-cover" onerror="this.src='/api/photos/${cat.sample_photo_id}/raw'"/>
          <div class="category-body">
            <div>
              <div class="category-name">${info.name}</div>
              <div class="category-count">${cat.count} fotos</div>
            </div>
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">${info.icon}</span>
          </div>
        `;
        card.addEventListener('click', () => {
          this.setFilter('category', cat.category, info.name);
          this.switchView('timeline');
        });
        grid.appendChild(card);
      }
    } catch (err) {}
  },

  async loadColorsView() {
    const grid = document.getElementById('colors-grid');
    grid.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined animate-spin">sync</span></div>';

    try {
      const res = await fetch('/api/explore/colors');
      const data = await res.json();
      const colors = data.colors || [];
      grid.innerHTML = '';

      const colorMap = {
        rojo: '#ea4335', naranja: '#fa7b17', amarillo: '#fbbc04', verde: '#34a853',
        cian: '#24c1e0', azul: '#4285f4', morado: '#a142f4', rosa: '#f439a0',
        blanco: '#ffffff', negro: '#202124', gris: '#80868b'
      };

      for (const c of colors) {
        const hex = colorMap[c.color_group] || c.sample_hex || '#4a90e2';
        const card = document.createElement('div');
        card.className = 'color-card';
        card.innerHTML = `
          <div class="color-swatch" style="background-color: ${hex};"></div>
          <div>
            <div style="font-size: 0.95rem; font-weight: 600; text-transform: capitalize;">${c.color_group}</div>
            <div style="font-size: 0.78rem; color: var(--text-tertiary);">${c.count} fotos</div>
          </div>
        `;
        card.addEventListener('click', () => {
          this.setFilter('color', c.color_group, `Color: ${c.color_group}`);
          this.switchView('timeline');
        });
        grid.appendChild(card);
      }
    } catch (err) {}
  },

  async loadCamerasView() {
    const grid = document.getElementById('cameras-grid');
    grid.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined animate-spin">sync</span></div>';

    try {
      const res = await fetch('/api/explore/cameras');
      const data = await res.json();
      const cameras = data.cameras || [];
      grid.innerHTML = '';

      for (const cam of cameras) {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
          <img src="/api/photos/${cam.sample_photo_id}/thumbnail" alt="${cam.camera}" class="category-cover" onerror="this.src='/api/photos/${cam.sample_photo_id}/raw'"/>
          <div class="category-body">
            <div>
              <div class="category-name">${cam.camera}</div>
              <div class="category-count">${cam.count} fotos</div>
            </div>
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">photo_camera</span>
          </div>
        `;
        card.addEventListener('click', () => {
          this.setFilter('camera', cam.camera, cam.camera);
          this.switchView('timeline');
        });
        grid.appendChild(card);
      }
    } catch (err) {}
  },

  async loadFavoritesView() {
    this.setFilter('favorite', 'true', 'Favoritos ★');
    this.switchView('timeline');
  },

  filterByLocation(city, country) {
    this.setFilter('city', city, `📍 ${city}`);
    this.switchView('timeline');
  },

  filterByAlbum(albumId, albumTitle) {
    this.setFilter('albumId', albumId, `Álbum: ${albumTitle}`);
    this.switchView('timeline');
  },

  setFilter(key, value, label) {
    this.currentFilters[key] = value;
    this.renderFilterChips();
  },

  removeFilter(key) {
    delete this.currentFilters[key];
    this.renderFilterChips();
    if (this.currentView === 'timeline') Timeline.load(this.currentFilters);
  },

  clearAllFilters() {
    this.currentFilters = {};
    const searchInput = document.getElementById('global-search-input');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('btn-clear-search');
    if (clearBtn) clearBtn.style.display = 'none';
    this.renderFilterChips();
    if (this.currentView === 'timeline') Timeline.load(this.currentFilters);
  },

  renderFilterChips() {
    const bar = document.getElementById('active-filters-bar');
    const list = document.getElementById('active-chips-list');
    if (!bar || !list) return;

    list.innerHTML = '';
    const keys = Object.keys(this.currentFilters);
    if (keys.length === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    for (const key of keys) {
      let val = this.currentFilters[key];
      let displayVal = val;
      if (key === 'year') displayVal = `Año: ${val}`;
      else if (key === 'personId') displayVal = `Persona filtrada`;

      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.innerHTML = `<span>${displayVal}</span><span class="material-symbols-outlined close-chip" onclick="App.removeFilter('${key}')">close</span>`;
      list.appendChild(chip);
    }
  },

  initSearch() {
    const searchInput = document.getElementById('global-search-input');
    const clearBtn = document.getElementById('btn-clear-search');
    if (!searchInput || !clearBtn) return;

    searchInput.addEventListener('input', () => {
      const val = searchInput.value.trim();
      clearBtn.style.display = val ? 'flex' : 'none';
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        if (val) this.currentFilters.search = val;
        else delete this.currentFilters.search;
        this.renderFilterChips();
        if (this.currentView !== 'timeline') this.switchView('timeline');
        else Timeline.load(this.currentFilters);
      }, 300);
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      delete this.currentFilters.search;
      this.renderFilterChips();
      if (this.currentView === 'timeline') Timeline.load(this.currentFilters);
    });
  },

  initTopControls() {
    const densityBtns = document.querySelectorAll('.density-btn');
    const mainWrapper = document.querySelector('.main-content');
    if (densityBtns && mainWrapper) {
      densityBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          densityBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const density = btn.dataset.density;
          mainWrapper.classList.remove('density-compact', 'density-normal', 'density-large');
          mainWrapper.classList.add(`density-${density}`);
        });
      });
    }

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        this.currentSort = sortSelect.value;
        if (this.currentView === 'timeline') Timeline.load(this.currentFilters);
      });
    }
  },

  initTheme() {
    const themeBtn = document.getElementById('btn-theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    if (!themeBtn || !themeIcon) return;

    const savedTheme = localStorage.getItem('photo_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeIcon.textContent = savedTheme === 'dark' ? 'light_mode' : 'dark_mode';

    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('photo_theme', next);
      themeIcon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
    });
  },

  async updateStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      const photoCountEl = document.getElementById('sidebar-photo-count');
      if (photoCountEl) photoCountEl.textContent = `${data.total_photos || 0} fotos`;

      const mb = ((data.total_size || 0) / (1024 * 1024)).toFixed(1);
      const gb = ((data.total_size || 0) / (1024 * 1024 * 1024)).toFixed(2);
      const sizeText = data.total_size > 1024 * 1024 * 1024 ? `${gb} GB` : `${mb} MB`;
      const storageSizeEl = document.getElementById('sidebar-storage-size');
      if (storageSizeEl) storageSizeEl.textContent = `${sizeText} indexados`;

      const dupBadge = document.getElementById('dup-badge');
      const totalDups = (data.exact_duplicates || 0) + (data.similar_duplicates || 0);
      if (dupBadge) {
        if (totalDups > 0) {
          dupBadge.textContent = totalDups;
          dupBadge.style.display = 'inline-block';
        } else {
          dupBadge.style.display = 'none';
        }
      }

      if (window.nsfwManagerClient) {
        window.nsfwManagerClient.updateBadge();
      }
    } catch (err) {}
  }
};

window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
