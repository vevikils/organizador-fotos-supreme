// public/js/enhancer.js
// Controlador de Restauración y Super-Resolución de Fotos Antiguas por IA

class PhotoEnhancer {
  constructor() {
    this.currentPhoto = null;
    this.currentJobId = null;
    this.pollTimer = null;
    this.isDragging = false;
    this.sliderPosition = 50; // porcentaje 0 - 100
    this.enhancedResult = null;

    this.init();
  }

  init() {
    // Cerrar modal
    const closeBtn = document.getElementById('btn-enhance-close');
    const cancelBtn = document.getElementById('btn-enh-cancel');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());

    // Iniciar mejora
    const startBtn = document.getElementById('btn-start-enhance');
    if (startBtn) startBtn.addEventListener('click', () => this.startEnhance());

    // Cambiar escala en opciones
    const scaleRadios = document.querySelectorAll('input[name="enhance-scale"]');
    scaleRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        // Actualizar clase activa en pills
        document.querySelectorAll('.enhance-scale-pill').forEach(p => p.classList.remove('active'));
        radio.closest('.enhance-scale-pill')?.classList.add('active');
        this.updateTargetResolution();
      });
    });

    // Botones de guardado
    const saveCopyBtn = document.getElementById('btn-enh-save-copy');
    if (saveCopyBtn) saveCopyBtn.addEventListener('click', () => this.saveEnhanced('copy'));

    const replaceBtn = document.getElementById('btn-enh-replace');
    if (replaceBtn) replaceBtn.addEventListener('click', () => this.saveEnhanced('replace'));

    const downloadBtn = document.getElementById('btn-enh-download');
    if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadEnhanced());

    const reconfigBtn = document.getElementById('btn-enh-reconfigure');
    if (reconfigBtn) reconfigBtn.addEventListener('click', () => this.showConfigState());

    // Inicializar listeners del comparador deslizante
    this.initSliderListeners();
  }

  openModal(photo) {
    if (!photo) return;
    this.currentPhoto = photo;
    this.currentJobId = null;
    this.enhancedResult = null;
    if (this.pollTimer) clearInterval(this.pollTimer);

    // Rellenar información de la foto
    const origW = photo.width || 0;
    const origH = photo.height || 0;
    const mp = origW && origH ? ((origW * origH) / 1000000).toFixed(1) : '--';

    const origResEl = document.getElementById('enh-orig-res');
    const origMpEl = document.getElementById('enh-orig-mp');
    if (origResEl) origResEl.textContent = origW && origH ? `${origW} × ${origH} px` : 'Desconocida';
    if (origMpEl) origMpEl.textContent = `${mp} MP`;

    this.updateTargetResolution();

    // Vista previa inicial
    const initialImg = document.getElementById('enh-initial-preview');
    const photoUrl = `/api/photos/${photo.id}/view`;
    if (initialImg) initialImg.src = photoUrl;

    // Mostrar estado de configuración
    this.showConfigState();

    // Abrir modal
    const modal = document.getElementById('modal-ai-enhance');
    if (modal) modal.style.display = 'flex';
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
        const targetW = origW * scale;
        const targetH = origH * scale;
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

    // Pasar a estado Loading
    document.getElementById('enhance-view-initial')?.style.setProperty('display', 'none');
    document.getElementById('enhance-view-loading')?.style.setProperty('display', 'flex');
    document.getElementById('enhance-view-compare')?.style.setProperty('display', 'none');
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
        // reintentar en el siguiente ciclo
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

    const origUrl = `/api/photos/${this.currentPhoto.id}/view`;
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

    // Reiniciar posición del divisor al centro (50%)
    this.setSliderPosition(50);

    // Botones de footer
    document.getElementById('btn-enh-reconfigure')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-enh-download')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-enh-replace')?.style.setProperty('display', 'inline-flex');
    document.getElementById('btn-enh-save-copy')?.style.setProperty('display', 'inline-flex');
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
      // Asegurar que la imagen interior mantenga el tamaño del contenedor completo
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

      // Refrescar cronología o recargar foto en Lightbox si sigue abierto
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
