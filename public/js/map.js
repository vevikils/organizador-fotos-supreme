// public/js/map.js
const PlacesView = {
  map: null,
  markersLayer: null,
  citiesGrid: null,

  init() {
    this.citiesGrid = document.getElementById('cities-grid');
  },

  async load() {
    if (!window.L) return;
    const mapEl = document.getElementById('places-map');
    if (!this.map) {
      this.map = L.map(mapEl, { center: [40.4168, -3.7038], zoom: 3, scrollWheelZoom: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(this.map);
      this.markersLayer = L.layerGroup().addTo(this.map);
    } else {
      setTimeout(() => this.map.invalidateSize(), 200);
    }
    await this.fetchLocations();
  },

  async fetchLocations() {
    try {
      const res = await fetch('/api/explore/locations');
      const data = await res.json();
      const locations = data.locations || [];

      this.markersLayer.clearLayers();
      this.citiesGrid.innerHTML = '';

      if (locations.length === 0) {
        this.citiesGrid.innerHTML = `
          <div class="empty-state" style="grid-column: 1/-1; height: 180px;">
            <span class="material-symbols-outlined empty-icon">location_off</span>
            <p>No se encontraron fotos con coordenadas GPS registradas.</p>
          </div>
        `;
        return;
      }

      const bounds = [];
      for (const loc of locations) {
        if (loc.latitude && loc.longitude) {
          bounds.push([loc.latitude, loc.longitude]);
          const marker = L.marker([loc.latitude, loc.longitude]);
          marker.bindPopup(`
            <div style="text-align: center; font-family: sans-serif;">
              <strong>${loc.city}</strong>
              <div style="font-size: 0.8rem; color: #666;">${loc.country}</div>
              <div style="font-size: 0.85rem; font-weight: bold; margin-top: 4px; color: #1a73e8;">${loc.count} fotos</div>
              <button onclick="App.filterByLocation('${loc.city}', '${loc.country}')" style="margin-top: 6px; padding: 4px 10px; background: #1a73e8; color: #fff; border: none; border-radius: 8px; cursor: pointer;">Ver fotos</button>
            </div>
          `);
          this.markersLayer.addLayer(marker);
        }

        const card = document.createElement('div');
        card.className = 'city-card';
        card.innerHTML = `
          <img src="/api/photos/${loc.sample_photo_id}/thumbnail" alt="${loc.city}" class="city-thumb" onerror="this.src='/api/photos/${loc.sample_photo_id}/raw'"/>
          <div class="city-info">
            <h4>${loc.city}</h4>
            <p>${loc.country} &bull; <strong>${loc.count} fotos</strong></p>
          </div>
        `;
        card.addEventListener('click', () => App.filterByLocation(loc.city, loc.country));
        this.citiesGrid.appendChild(card);
      }

      if (bounds.length > 0 && this.map) {
        this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      }
    } catch (err) {}
  }
};
