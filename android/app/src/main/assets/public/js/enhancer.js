// public/js/enhancer.js
// Controlador de Restauración y Super-Resolución de Fotos Antiguas por IA

class PhotoEnhancer {
  constructor() {
    this.currentPhoto = null;
    this.currentJobId = null;
    this.pollTimer = null;
    this.isDragging = false;
    this.sliderPosition = 50;
    this.enhancedResult = null;
    this.initialized = false;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    if (this.initialized) return;
    const btnStart = document.getElementById('btn-start-enhance');
    const btnFooterStart = document.getElementById('btn-footer-start-enhance');
    if (!btnStart && !btnFooterStart) return;
    this.initialized = true;

    // Botones para cerrar modal
    const closeBtn = document.getElementById('btn-enhance-close');
    const cancelBtn = document.getElementById('btn-enh-cancel');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());

    // Botones para iniciar mejora (sidebar y footer)
    if (btnStart) btnStart.addEventListener('click', () => this.startEnhance());
    if (btnFooterStart) btnFooterStart.addEventListener('click', () => this.startEnhance());

    // Opciones de escala
    const scaleRadios = document.querySelectorAll('input[name="enhance-scale"]');
    scaleRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('.enhance-scale-pill').forEach(p => p.classList.remove('active'));
        radio.closest('.enhance-scale-pill')?.classList.add('active');
        this.updateTargetResolution();
      });
    });

    // Botones de acción post-mejora
    const saveCopyBtn = document.getElementById('btn-enh-save-copy');
    if (saveCopyBtn) saveCopyBtn.addEventListener('click', () => this.saveEnhanced('copy'));

    const replaceBtn = document.getElementById('btn-enh-replace');
    if (replaceBtn) replaceBtn.addEventListener('click', () => this.saveEnhanced('replace'));

    const downloadBtn = document.getElementById('btn-enh-download');
    if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadEnhanced());

    const reconfigBtn = document.getElementById('btn-enh-reconfigure');
    if (reconfigBtn) reconfigBtn.addEventListener('click', () => this.showConfigState());

    // Comparador deslizante
    this.initSliderListeners();
  }

  openModal(photo) {
    if (!photo) return;
    this.init();
    this.currentPhoto = photo;
    this.currentJobId = null;
    this.enhancedResult = null;
    if (this.pollTimer) clearInterval(this.pollTimer);

    const origW = photo.width || 0;
    const origH = photo.height || 0;
    const mp = origW && origH ? ((origW * origH) / 1000000).toFixed(1) : '--';

    const origResEl = document.getElementById('enh-orig-res');
    const origMpEl = document.getElementById('enh-orig-mp');
    if (origResEl) origResEl.textContent = origW && origH ? `${origW} × ${origH} px` : 'Desconocida';
    if (origMpEl) origMpEl.textContent = `${mp} MP`;

    // Selección inteligente de escala recomendada
    let defaultScale = 4;
    if (origW > 2500 || origH > 2500) {
      defaultScale = 1; // Si ya es 4K+, sugerir restaurar sin agrandar o 2x
    } else if (origW > 1280 || origH > 1280) {
      defaultScale = 2; // Si es mediana/grande, sugerir 2x
    } else {
      defaultScale = 4; // Si es baja resolución/antigua, 4x
    }

    const targetRadio = document.querySelector(`input[name="enhance-scale"][value="${defaultScale}"]`);
    if (targetRadio) {
      targetRadio.checked = true;
      document.querySelectorAll('.enhance-scale-pill').forEach(p => p.classList.remove('active'));
      targetRadio.closest('.enhance-scale-pill')?.classList.add('active');
    }

    // Consejo dinámico según tamaño
    const hintEl = document.getElementById('enh-scale-hint');
    if (hintEl) {
      if (origW > 2500 || origH > 2500) {
        hintEl.textContent = '💡 Foto en alta resolución (>4K). Se sugiere 1x para restaurar colores/grano o 2x para más detalle.';
        hintEl.style.display = 'block';
      } else if (origW > 1280 || origH > 1280) {
        hintEl.textContent = '💡 Se sugiere 2x HD para un balance óptimo de nitidez y velocidad.';
        hintEl.style.display = 'block';
      } else {
        hintEl.textContent = '💡 Excelente foto para Super-Resolución 4x Ultra HD.';
        hintEl.style.display = 'block';
      }
    }

    this.updateTargetResolution();

    // Vista previa con fallback
    const initialImg = document.getElementById('enh-initial-preview');
    if (initialImg) {
      initialImg.src = `/api/photos/${photo.id}/raw`;
      initialImg.onerror = () => {
        initialImg.src = `/api/photos/${photo.id}/thumbnail`;
      };
    }

    this.showConfigState();

    const modal = document.getElementById('modal-ai-enhance');
    if (modal) {
      modal.style.display = 'flex';
      modal.style.zIndex = '2500';
    }
  }

  closeModal() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const modal = document.getElementById('modal-ai-enhance');
    if (modal) modal.style.display = 'none';
  }

  updateTargetResolution() {
    if (!this.currentPhoto) return;
    const scale = parseInt(document.querySelector('input[name="enhance-scale"]:checked')?.value || '4', 10);
    const origW = this.currentPhoto.width || 0;
    const origH = this.currentPhoto.height || 0;

    const targetEl = document.getElementById('enh-target-res');
    if (targetEl) {
      if (origW && origH) {
        let targetW = origW * scale;
        let targetH = origH * scale;
        // Si excede 6144, mostrar que se optimizará
        if (Math.max(targetW, targetH) > 6144) {
          const ratio = 6144 / Math.max(targetW, targetH);
          targetW = Math.round(targetW * ratio);
          targetH = Math.round(targetH * ratio);
        }
        const targetMp = ((targetW * targetH) / 1000000).toFixed(1);
        targetEl.textContent = `${targetW} × ${targetH} px (${targetMp} MP)`;
      } else {
        targetEl.textContent = `Escalado ${scale}x`;
      }
    }
  }

  showConfigState() {
    document.getElementById('enhance-view-initial')?.style.setProperty('display', 'flex');
    document.getElementById('enhance-view-loading')?.style.setProperty('display', 'none');
    document.getElementById('enhance-view-compare')?.style.setProperty('display', 'none');

    // Botones de footer
    document.getElementById('btn-footer-start-enhance')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-start-enhance')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-enh-reconfigure')?.style.setProperty('display', 'none');
    document.getElementById('btn-enh-download')?.style.setProperty('display', 'none');
    document.getElementById('btn-enh-replace')?.style.setProperty('display', 'none');
    document.getElementById('btn-enh-save-copy')?.style.setProperty('display', 'none');
    document.getElementById('btn-enh-cancel')?.style.setProperty('display', 'inline-flex');

    const sidebar = document.querySelector('.enhance-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
  }

  async startEnhance() {
    if (!this.currentPhoto) return;

    const scale = parseInt(document.querySelector('input[name="enhance-scale"]:checked')?.value || '4', 10);
    const color_restore = document.getElementById('enh-opt-color')?.checked ?? true;
    const denoise = document.getElementById('enh-opt-denoise')?.checked ?? true;
    const unsharp = document.getElementById('enh-opt-unsharp')?.checked ?? true;
    const face_enhance = document.getElementById('enh-opt-face')?.checked ?? true;

    // Cambiar a estado cargando
    document.getElementById('enhance-view-initial')?.style.setProperty('display', 'none');
    document.getElementById('enhance-view-loading')?.style.setProperty('display', 'flex');
    document.getElementById('enhance-view-compare')?.style.setProperty('display', 'none');

    document.getElementById('btn-footer-start-enhance')?.style.setProperty('display', 'none');
    document.getElementById('btn-start-enhance')?.style.setProperty('display', 'none');

    this.updateProgressBar(5, 'Iniciando conexión con el motor de IA...');

    try {
      const res = await fetch(`/api/photos/${this.currentPhoto.id}/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale, color_restore, denoise, unsharp, face_enhance })
      });

      const data = await res.json();
      if (!data.success || !data.jobId) {
        throw new Error(data.error || 'Error al iniciar trabajo de mejora');
      }

      this.currentJobId = data.jobId;
      this.pollProgress();
    } catch (err) {
      alert('No se pudo procesar la mejora: ' + err.message);
      this.showConfigState();
    }
  }

  pollProgress() {
    if (this.pollTimer) clearInterval(this.pollTimer);

    this.pollTimer = setInterval(async () => {
      if (!this.currentJobId) return;
      try {
        const res = await fetch(`/api/enhance/status/${this.currentJobId}`);
        const job = await res.json();

        if (job.status === 'processing') {
          this.updateProgressBar(job.progress || 15, job.step || 'Procesando con IA...');
        } else if (job.status === 'completed') {
          clearInterval(this.pollTimer);
          this.updateProgressBar(100, '¡Completado con éxito!');
          setTimeout(() => this.showComparison(job.result), 300);
        } else if (job.status === 'error') {
          clearInterval(this.pollTimer);
          alert('Ocurrió un error en la mejora: ' + (job.error || 'Desconocido'));
          this.showConfigState();
        }
      } catch (e) {
        // Reintentar en siguiente ciclo
      }
    }, 350);
  }

  updateProgressBar(percent, stepText) {
    const bar = document.getElementById('enh-progress-bar');
    const text = document.getElementById('enh-progress-text');
    const step = document.getElementById('enh-status-step');

    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = `${percent}%`;
    if (step && stepText) step.textContent = stepText;
  }

  showComparison(result) {
    this.enhancedResult = result;

    document.getElementById('enhance-view-loading')?.style.setProperty('display', 'none');
    document.getElementById('enhance-view-compare')?.style.setProperty('display', 'flex');

    const origUrl = `/api/photos/${this.currentPhoto.id}/raw`;
    const enhancedUrl = result.previewUrl;

    const imgBefore = document.getElementById('enh-img-before');
    const imgAfter = document.getElementById('enh-img-after');

    if (imgBefore) imgBefore.src = origUrl;
    if (imgAfter) imgAfter.src = enhancedUrl;

    // Métricas
    const inDims = result.input_dims || {};
    const outDims = result.output_dims || {};
    const resText = inDims.width && outDims.width
      ? `📏 ${inDims.width}×${inDims.height} ➔ ${outDims.width}×${outDims.height} px`
      : 'Resolución aumentada';
    const scaleText = `✨ ${result.scale}x Super-Resolución`;
    const timeText = `⏱️ ${result.elapsed_seconds || '--'}s`;

    const metricRes = document.getElementById('enh-metric-res');
    const metricScale = document.getElementById('enh-metric-scale');
    const metricTime = document.getElementById('enh-metric-time');

    if (metricRes) metricRes.textContent = resText;
    if (metricScale) metricScale.textContent = scaleText;
    if (metricTime) metricTime.textContent = timeText;

    this.setSliderPosition(50);

    // Botones de footer
    document.getElementById('btn-enh-reconfigure')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-enh-download')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-enh-replace')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-enh-save-copy')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-footer-start-enhance')?.style.setProperty('display', 'none');
    document.getElementById('btn-enh-cancel')?.style.setProperty('display', 'none');
  }

  initSliderListeners() {
    const box = document.getElementById('compare-slider-box');
    if (!box) return;

    const onStart = (e) => {
      this.isDragging = true;
      this.updateSliderFromEvent(e);
    };

    const onMove = (e) => {
      if (!this.isDragging) return;
      this.updateSliderFromEvent(e);
    };

    const onEnd = () => {
      this.isDragging = false;
    };

    box.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    box.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  }

  updateSliderFromEvent(e) {
    const box = document.getElementById('compare-slider-box');
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
    const offset = clientX - rect.left;
    let percentage = (offset / rect.width) * 100;
    percentage = Math.max(0, Math.min(100, percentage));
    this.setSliderPosition(percentage);
  }

  setSliderPosition(percent) {
    this.sliderPosition = percent;
    const divider = document.getElementById('compare-divider');
    const beforeWrapper = document.getElementById('compare-before-wrapper');
    const box = document.getElementById('compare-slider-box');

    if (divider) divider.style.left = `${percent}%`;
    if (beforeWrapper) {
      beforeWrapper.style.width = `${percent}%`;
      const beforeImg = document.getElementById('enh-img-before');
      if (beforeImg && box) {
        beforeImg.style.width = `${box.clientWidth}px`;
        beforeImg.style.height = `${box.clientHeight}px`;
      }
    }
  }

  async saveEnhanced(mode) {
    if (!this.currentPhoto || !this.currentJobId) return;

    const confirmMsg = mode === 'replace'
      ? '¿Estás seguro de reemplazar la foto original? (Se creará una copia de seguridad .bak automática).'
      : '¿Guardar la foto mejorada en alta definición como una nueva copia?';

    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/photos/${this.currentPhoto.id}/save-enhanced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: this.currentJobId, mode })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Error al guardar');

      alert(mode === 'replace' 
        ? '¡Foto original reemplazada exitosamente por la versión en alta definición!'
        : '¡Nueva copia en alta definición guardada e indexada en tu biblioteca!'
      );

      this.closeModal();

      if (window.timeline && window.timeline.refresh) {
        window.timeline.refresh();
      }
    } catch (err) {
      alert('Error al guardar la foto: ' + err.message);
    }
  }

  downloadEnhanced() {
    if (!this.enhancedResult || !this.enhancedResult.previewUrl) return;
    const a = document.createElement('a');
    a.href = this.enhancedResult.previewUrl;
    const origName = this.currentPhoto ? this.currentPhoto.file_name : 'foto';
    a.download = `${origName.replace(/\.[^/.]+$/, "")}_HD_IA.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

window.enhancer = new PhotoEnhancer();
