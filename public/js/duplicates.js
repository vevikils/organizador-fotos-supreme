// public/js/duplicates.js
// Gestor inteligente de duplicados con selección masiva, eliminación en lote y paginación ultra-rápida

const DuplicatesView = {
  container: null,
  activeTab: 'exact', // 'exact' | 'similar'
  data: {
    exactGroups: [],
    similarGroups: [],
    exactCount: 0,
    similarCount: 0,
    reclaimableBytes: 0
  },
  selectedPhotoIds: new Set(),
  selectAllMode: false,
  pageSize: 40,
  renderedGroupCount: 40,
  isProcessing: false,

  init() {
    this.container = document.getElementById('duplicates-container');

    // Pestañas de duplicados exactos / similares
    const tabs = document.querySelectorAll('.tab-btn[data-dup-tab]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (this.isProcessing) return;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.dataset.dupTab;
        this.deselectAll();
        this.renderedGroupCount = this.pageSize;
        this.load();
      });
    });

    // Checkbox de seleccionar todos
    const selectAllCheckbox = document.getElementById('dup-select-all-checkbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', (e) => {
        this.toggleSelectAll(e.target.checked);
      });
    }

    // Botón de deseleccionar
    const btnDeselect = document.getElementById('dup-btn-deselect');
    if (btnDeselect) {
      btnDeselect.addEventListener('click', () => {
        this.deselectAll();
      });
    }

    // Botón de limpiar TODOS los duplicados (conservar las mejores)
    const btnCleanAll = document.getElementById('dup-btn-clean-all');
    if (btnCleanAll) {
      btnCleanAll.addEventListener('click', () => {
        this.openCleanAllModal();
      });
    }

    // Botón de eliminar seleccionados
    const btnDeleteSelected = document.getElementById('dup-btn-delete-selected');
    if (btnDeleteSelected) {
      btnDeleteSelected.addEventListener('click', () => {
        this.deleteSelected();
      });
    }

    // Botón cargar más
    const btnLoadMore = document.getElementById('dup-btn-load-more');
    if (btnLoadMore) {
      btnLoadMore.addEventListener('click', () => {
        this.loadMoreGroups();
      });
    }

    // Modal de confirmación masiva
    const modalClose = document.getElementById('dup-modal-btn-close');
    const modalCancel = document.getElementById('dup-modal-btn-cancel');
    const modalConfirm = document.getElementById('dup-modal-btn-confirm');
    const modalBackdrop = document.getElementById('modal-confirm-dup-clean');

    if (modalClose) modalClose.addEventListener('click', () => this.closeModal());
    if (modalCancel) modalCancel.addEventListener('click', () => this.closeModal());
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop && !this.isProcessing) this.closeModal();
      });
    }
    if (modalConfirm) {
      modalConfirm.addEventListener('click', () => {
        this.executeCleanAll();
      });
    }
  },

  async load() {
    try {
      this.container.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-outlined animate-spin" style="font-size: 40px; color: var(--accent-primary);">sync</span>
          <p style="margin-top: 12px;">Analizando duplicados...</p>
        </div>
      `;
      
      const res = await fetch(`/api/duplicates?tab=${this.activeTab}`);
      this.data = await res.json();

      document.getElementById('count-exact-dups').textContent = this.data.exactCount || 0;
      document.getElementById('count-similar-dups').textContent = this.data.similarCount || 0;

      const dupBadge = document.getElementById('dup-badge');
      const totalDups = (this.data.exactCount || 0) + (this.data.similarCount || 0);
      if (dupBadge) {
        if (totalDups > 0) {
          dupBadge.textContent = totalDups;
          dupBadge.style.display = 'inline-block';
        } else {
          dupBadge.style.display = 'none';
        }
      }

      const mb = ((this.data.reclaimableBytes || 0) / (1024 * 1024)).toFixed(1);
      const reclaimEl = document.getElementById('reclaim-size-text');
      if (reclaimEl) reclaimEl.textContent = `${mb} MB`;

      this.renderedGroupCount = this.pageSize;
      this.render();
      this.updateToolbar();
    } catch (err) {
      console.error('Error al cargar duplicados:', err);
      this.container.innerHTML = `
        <div class="empty-state text-danger">
          <span class="material-symbols-outlined">error</span>
          <p>Error al cargar duplicados: ${err.message}</p>
        </div>
      `;
    }
  },

  getCurrentGroups() {
    return this.activeTab === 'exact' ? (this.data.exactGroups || []) : (this.data.similarGroups || []);
  },

  // Retorna las fotos redundantes (todas excepto la mejor calidad en cada grupo)
  getRedundantPhotosInGroup(group) {
    if (!group || group.length < 2) return [];
    const sorted = [...group].sort((a, b) => 
      (b.width * b.height || b.file_size) - (a.width * a.height || a.file_size)
    );
    return sorted.slice(1);
  },

  getAllRedundantPhotos() {
    const groups = this.getCurrentGroups();
    const redundant = [];
    for (const group of groups) {
      const red = this.getRedundantPhotosInGroup(group);
      for (const p of red) redundant.push(p);
    }
    return redundant;
  },

  toggleSelectAll(checked) {
    this.selectAllMode = checked;
    this.selectedPhotoIds.clear();

    if (checked) {
      const allRedundant = this.getAllRedundantPhotos();
      for (const p of allRedundant) {
        this.selectedPhotoIds.add(p.id);
      }
    }

    // Actualizar elementos en el DOM visible
    const checkboxes = this.container.querySelectorAll('.dup-item-checkbox');
    checkboxes.forEach(cb => {
      const photoId = parseInt(cb.dataset.photoId, 10);
      cb.checked = checked;
      const itemEl = cb.closest('.dup-item');
      if (itemEl) {
        if (checked) itemEl.classList.add('selected');
        else itemEl.classList.remove('selected');
      }
    });

    const groupCheckboxes = this.container.querySelectorAll('.dup-group-checkbox');
    groupCheckboxes.forEach(gcb => {
      gcb.checked = checked;
    });

    this.updateToolbar();
  },

  deselectAll() {
    this.selectAllMode = false;
    this.selectedPhotoIds.clear();

    const selectAllCheckbox = document.getElementById('dup-select-all-checkbox');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;

    const checkboxes = this.container.querySelectorAll('.dup-item-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = false;
      const itemEl = cb.closest('.dup-item');
      if (itemEl) itemEl.classList.remove('selected');
    });

    const groupCheckboxes = this.container.querySelectorAll('.dup-group-checkbox');
    groupCheckboxes.forEach(gcb => {
      gcb.checked = false;
    });

    this.updateToolbar();
  },

  togglePhotoSelection(photoId, isChecked) {
    if (isChecked) {
      this.selectedPhotoIds.add(photoId);
    } else {
      this.selectedPhotoIds.delete(photoId);
      this.selectAllMode = false;
    }

    const itemEl = this.container.querySelector(`.dup-item[data-photo-id="${photoId}"]`);
    if (itemEl) {
      if (isChecked) itemEl.classList.add('selected');
      else itemEl.classList.remove('selected');
    }

    // Comprobar si todas las redundantes están seleccionadas
    const allRedundant = this.getAllRedundantPhotos();
    if (allRedundant.length > 0 && this.selectedPhotoIds.size === allRedundant.length) {
      this.selectAllMode = true;
    }

    this.updateToolbar();
  },

  toggleGroupSelection(groupIndex, isChecked) {
    const groups = this.getCurrentGroups();
    const group = groups[groupIndex];
    if (!group) return;

    const redundant = this.getRedundantPhotosInGroup(group);
    for (const p of redundant) {
      if (isChecked) {
        this.selectedPhotoIds.add(p.id);
      } else {
        this.selectedPhotoIds.delete(p.id);
        this.selectAllMode = false;
      }

      const itemEl = this.container.querySelector(`.dup-item[data-photo-id="${p.id}"]`);
      if (itemEl) {
        if (isChecked) itemEl.classList.add('selected');
        else itemEl.classList.remove('selected');
        const cb = itemEl.querySelector('.dup-item-checkbox');
        if (cb) cb.checked = isChecked;
      }
    }

    const allRedundant = this.getAllRedundantPhotos();
    if (allRedundant.length > 0 && this.selectedPhotoIds.size === allRedundant.length) {
      this.selectAllMode = true;
    }

    this.updateToolbar();
  },

  updateToolbar() {
    const allRedundant = this.getAllRedundantPhotos();
    const totalRedundant = allRedundant.length;
    const selectedCount = this.selectedPhotoIds.size;

    // Actualizar checkbox superior
    const selectAllCheckbox = document.getElementById('dup-select-all-checkbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = totalRedundant > 0 && selectedCount === totalRedundant;
      selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalRedundant;
    }

    const selectAllText = document.getElementById('dup-select-all-text');
    if (selectAllText) {
      selectAllText.textContent = totalRedundant > 0 
        ? `Seleccionar todas las copias redundantes (${totalRedundant.toLocaleString()})`
        : 'Seleccionar todas las copias';
    }

    // Calcular bytes seleccionados
    let selectedBytes = 0;
    for (const p of allRedundant) {
      if (this.selectedPhotoIds.has(p.id)) {
        selectedBytes += (p.file_size || 0);
      }
    }
    const selectedMb = (selectedBytes / (1024 * 1024)).toFixed(1);

    // Badge y botón deseleccionar
    const badge = document.getElementById('dup-selected-badge');
    const btnDeselect = document.getElementById('dup-btn-deselect');
    const btnDeleteSelected = document.getElementById('dup-btn-delete-selected');
    const btnDeleteSelectedText = document.getElementById('dup-btn-delete-selected-text');

    if (selectedCount > 0) {
      if (badge) {
        badge.textContent = `${selectedCount.toLocaleString()} seleccionadas (${selectedMb} MB)`;
        badge.style.display = 'inline-block';
      }
      if (btnDeselect) btnDeselect.style.display = 'inline-flex';
      if (btnDeleteSelected) {
        btnDeleteSelected.style.display = 'inline-flex';
        if (btnDeleteSelectedText) {
          btnDeleteSelectedText.textContent = `Eliminar seleccionadas (${selectedCount.toLocaleString()})`;
        }
      }
    } else {
      if (badge) badge.style.display = 'none';
      if (btnDeselect) btnDeselect.style.display = 'none';
      if (btnDeleteSelected) btnDeleteSelected.style.display = 'none';
    }

    // Botón Limpiar Todos los duplicados
    const btnCleanAll = document.getElementById('dup-btn-clean-all');
    const btnCleanAllText = document.getElementById('dup-btn-clean-all-text');
    if (btnCleanAll) {
      if (totalRedundant > 0) {
        btnCleanAll.style.display = 'inline-flex';
        const totalMb = ((this.data.reclaimableBytes || 0) / (1024 * 1024)).toFixed(1);
        if (btnCleanAllText) {
          btnCleanAllText.textContent = `⚡ Limpiar TODOS los duplicados (${totalMb} MB)`;
        }
      } else {
        btnCleanAll.style.display = 'none';
      }
    }
  },

  render() {
    this.container.innerHTML = '';
    const groups = this.getCurrentGroups();

    if (!groups || groups.length === 0) {
      this.container.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-outlined empty-icon" style="color: var(--accent-success);">check_circle</span>
          <h3>¡No hay fotos ${this.activeTab === 'exact' ? 'duplicadas exactas' : 'similares'}!</h3>
          <p>Tu biblioteca de fotos está optimizada y sin duplicados en esta categoría.</p>
        </div>
      `;
      const footer = document.getElementById('dup-footer');
      if (footer) footer.style.display = 'none';
      return;
    }

    const groupsToRender = groups.slice(0, this.renderedGroupCount);

    for (let idx = 0; idx < groupsToRender.length; idx++) {
      const group = groupsToRender[idx];
      const card = document.createElement('div');
      card.className = 'duplicate-group-card';
      card.dataset.groupIdx = idx;

      const sorted = [...group].sort((a, b) => 
        (b.width * b.height || b.file_size) - (a.width * a.height || a.file_size)
      );

      const redundantPhotos = sorted.slice(1);
      const allGroupRedundantSelected = redundantPhotos.length > 0 && 
        redundantPhotos.every(p => this.selectedPhotoIds.has(p.id));

      card.innerHTML = `
        <div class="dup-header">
          <label class="dup-group-select-label">
            <input type="checkbox" class="dup-group-checkbox" data-group-idx="${idx}" ${allGroupRedundantSelected ? 'checked' : ''}>
            <span><strong>Grupo #${idx + 1}</strong> &bull; ${group.length} copias encontradas</span>
          </label>
          <button class="btn btn-sm btn-danger" onclick="DuplicatesView.cleanGroup(${idx})">
            <span class="material-symbols-outlined">delete_sweep</span>
            Limpiar copias (Conservar la mejor)
          </button>
        </div>
        <div class="dup-photos-row" id="dup-row-${idx}"></div>
      `;

      // Checkbox a nivel de grupo
      const groupCb = card.querySelector('.dup-group-checkbox');
      groupCb.addEventListener('change', (e) => {
        this.toggleGroupSelection(idx, e.target.checked);
      });

      const rowEl = card.querySelector(`#dup-row-${idx}`);
      for (const [pIdx, photo] of sorted.entries()) {
        const isKeep = pIdx === 0;
        const isSelected = !isKeep && this.selectedPhotoIds.has(photo.id);

        const item = document.createElement('div');
        item.className = `dup-item ${isKeep ? 'keep' : ''} ${isSelected ? 'selected' : ''}`;
        item.dataset.photoId = photo.id;

        const mb = ((photo.file_size || 0) / (1024 * 1024)).toFixed(2);
        const dims = photo.width && photo.height ? `${photo.width}×${photo.height}` : 'N/A';

        item.innerHTML = `
          ${isKeep ? '<span class="dup-badge-keep">MEJOR CALIDAD</span>' : `
            <label class="dup-item-checkbox-container" title="Seleccionar para eliminar">
              <input type="checkbox" class="dup-item-checkbox" data-photo-id="${photo.id}" ${isSelected ? 'checked' : ''}>
            </label>
          `}
          <div style="aspect-ratio: 1; overflow: hidden; background: #000; cursor: pointer;">
            <img src="/api/photos/${photo.id}/thumbnail" alt="${photo.file_name}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/api/photos/${photo.id}/raw'"/>
          </div>
          <div class="dup-details">
            <div class="truncate" title="${photo.file_name}"><strong>${photo.file_name}</strong></div>
            <div>${dims} &bull; ${mb} MB</div>
            <div class="truncate" style="color: var(--text-tertiary);" title="${photo.file_path}">${photo.file_path}</div>
            ${!isKeep ? `
              <button class="btn btn-sm btn-secondary w-100 mt-1" onclick="DuplicatesView.deletePhoto(${photo.id})">
                Eliminar esta copia
              </button>
            ` : ''}
          </div>
        `;

        // Click en imagen abre lightbox
        item.querySelector('img').addEventListener('click', (e) => {
          e.stopPropagation();
          Lightbox.open([photo], 0);
        });

        // Evento de checkbox de copia redundante
        if (!isKeep) {
          const cb = item.querySelector('.dup-item-checkbox');
          cb.addEventListener('change', (e) => {
            this.togglePhotoSelection(photo.id, e.target.checked);
          });
        }

        rowEl.appendChild(item);
      }

      this.container.appendChild(card);
    }

    // Actualizar paginación / footer
    const footer = document.getElementById('dup-footer');
    const paginationInfo = document.getElementById('dup-pagination-info');
    const btnLoadMore = document.getElementById('dup-btn-load-more');

    if (footer) {
      if (groups.length > 0) {
        footer.style.display = 'flex';
        if (paginationInfo) {
          paginationInfo.textContent = `Mostrando ${groupsToRender.length.toLocaleString()} de ${groups.length.toLocaleString()} grupos de duplicados`;
        }
        if (btnLoadMore) {
          btnLoadMore.style.display = groupsToRender.length < groups.length ? 'inline-flex' : 'none';
        }
      } else {
        footer.style.display = 'none';
      }
    }
  },

  loadMoreGroups() {
    this.renderedGroupCount += this.pageSize;
    this.render();
    this.updateToolbar();
  },

  openCleanAllModal() {
    const groups = this.getCurrentGroups();
    const redundant = this.getAllRedundantPhotos();
    if (redundant.length === 0) return;

    let reclaimBytes = 0;
    for (const p of redundant) reclaimBytes += (p.file_size || 0);
    const reclaimMb = (reclaimBytes / (1024 * 1024)).toFixed(1);

    const titleEl = document.getElementById('dup-modal-title');
    const descEl = document.getElementById('dup-modal-desc');
    const groupsEl = document.getElementById('dup-modal-groups');
    const countEl = document.getElementById('dup-modal-count');
    const sizeEl = document.getElementById('dup-modal-size');
    const progressEl = document.getElementById('dup-modal-progress-container');
    const modalBackdrop = document.getElementById('modal-confirm-dup-clean');

    const tabName = this.activeTab === 'exact' ? 'duplicados exactos' : 'fotos similares o ráfagas';

    if (titleEl) titleEl.textContent = `Limpiar Todos los ${this.activeTab === 'exact' ? 'Duplicados Exactos' : 'Duplicados Similares'}`;
    if (descEl) descEl.innerHTML = `¿Estás seguro de que deseas limpiar todas las copias redundantes en <strong>${tabName}</strong>? Esta acción liberará espacio automáticamente conservando intacta la versión de máxima calidad de cada grupo.`;
    if (groupsEl) groupsEl.textContent = `${groups.length.toLocaleString()} grupos`;
    if (countEl) countEl.textContent = `${redundant.length.toLocaleString()} fotos redundantes`;
    if (sizeEl) sizeEl.textContent = `${reclaimMb} MB`;
    if (progressEl) progressEl.style.display = 'none';

    const confirmBtn = document.getElementById('dup-modal-btn-confirm');
    const confirmBtnText = document.getElementById('dup-modal-btn-confirm-text');
    if (confirmBtn) confirmBtn.disabled = false;
    if (confirmBtnText) confirmBtnText.textContent = 'Sí, Limpiar Todo';

    if (modalBackdrop) modalBackdrop.style.display = 'flex';
  },

  closeModal() {
    if (this.isProcessing) return;
    const modalBackdrop = document.getElementById('modal-confirm-dup-clean');
    if (modalBackdrop) modalBackdrop.style.display = 'none';
  },

  async executeCleanAll() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const progressEl = document.getElementById('dup-modal-progress-container');
    const confirmBtn = document.getElementById('dup-modal-btn-confirm');
    const confirmBtnText = document.getElementById('dup-modal-btn-confirm-text');

    if (progressEl) progressEl.style.display = 'block';
    if (confirmBtn) confirmBtn.disabled = true;
    if (confirmBtnText) confirmBtnText.textContent = 'Limpiando...';

    try {
      const res = await fetch('/api/duplicates/clean-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: this.activeTab })
      });
      const data = await res.json();

      if (data.success) {
        this.closeModal();
        this.deselectAll();
        const mb = ((data.reclaimedBytes || 0) / (1024 * 1024)).toFixed(1);
        alert(`¡Limpieza completada con éxito!\nSe eliminaron ${data.deletedCount.toLocaleString()} copias redundantes y se liberaron ${mb} MB de disco.`);
        await this.load();
        if (window.App && App.updateStats) App.updateStats();
      } else {
        alert('Error al limpiar duplicados: ' + (data.error || 'Desconocido'));
      }
    } catch (err) {
      alert('Error en la solicitud: ' + err.message);
    } finally {
      this.isProcessing = false;
      this.closeModal();
    }
  },

  async deleteSelected() {
    if (this.selectedPhotoIds.size === 0 || this.isProcessing) return;

    const count = this.selectedPhotoIds.size;
    const allRedundant = this.getAllRedundantPhotos();
    let reclaimBytes = 0;
    for (const p of allRedundant) {
      if (this.selectedPhotoIds.has(p.id)) reclaimBytes += (p.file_size || 0);
    }
    const mb = (reclaimBytes / (1024 * 1024)).toFixed(1);

    if (!confirm(`¿Eliminar las ${count.toLocaleString()} copias redundantes seleccionadas y liberar ${mb} MB?\n(Las fotos de mejor calidad se conservarán intactas).`)) {
      return;
    }

    this.isProcessing = true;
    const btn = document.getElementById('dup-btn-delete-selected');
    if (btn) btn.disabled = true;

    try {
      // Si están seleccionadas absolutamente todas las fotos redundantes, usamos clean-all que es instantáneo
      if (this.selectAllMode && count === allRedundant.length) {
        const res = await fetch('/api/duplicates/clean-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: this.activeTab })
        });
        const data = await res.json();
      } else {
        const ids = Array.from(this.selectedPhotoIds);
        const res = await fetch('/api/photos/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        const data = await res.json();
      }

      this.deselectAll();
      alert(`¡Listo! Se han eliminado ${count.toLocaleString()} fotos duplicadas seleccionadas.`);
      await this.load();
      if (window.App && App.updateStats) App.updateStats();
    } catch (err) {
      alert('Error al eliminar fotos seleccionadas: ' + err.message);
    } finally {
      this.isProcessing = false;
      if (btn) btn.disabled = false;
    }
  },

  async cleanGroup(groupIndex) {
    if (this.isProcessing) return;
    const groups = this.getCurrentGroups();
    const group = groups[groupIndex];
    if (!group || group.length < 2) return;

    const redundant = this.getRedundantPhotosInGroup(group);
    if (!confirm(`¿Eliminar ${redundant.length} copias redundantes de este grupo y conservar la mejor versión?`)) return;

    try {
      const ids = redundant.map(p => p.id);
      await fetch('/api/photos/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });

      for (const id of ids) this.selectedPhotoIds.delete(id);
      await this.load();
      if (window.App && App.updateStats) App.updateStats();
    } catch (err) {
      alert('Error al limpiar el grupo: ' + err.message);
    }
  },

  async deletePhoto(photoId) {
    if (this.isProcessing) return;
    if (!confirm('¿Eliminar esta copia?')) return;
    try {
      await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
      this.selectedPhotoIds.delete(photoId);
      await this.load();
      if (window.App && App.updateStats) App.updateStats();
    } catch (err) {
      alert('Error al eliminar la foto: ' + err.message);
    }
  }
};
