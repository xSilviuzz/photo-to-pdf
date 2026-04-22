/* ============================================================
   app.js — Stato globale, navigazione schermate, drag & drop
   griglia foto, gestione card, toolbar globale
   ============================================================ */

'use strict';

/* ══════════════════════════════════════════
   STATO GLOBALE
══════════════════════════════════════════ */
const App = {
  photos: [],          // Array di oggetti foto (vedi struttura sotto)
  selectedId: null,    // ID foto attualmente selezionata in sidebar
  pdfLayout: 1,        // Foto per pagina: 1 | 2 | 4
  pdfOrientation: 'portrait', // 'portrait' | 'landscape'
  pdfBlob: null,       // Blob PDF generato (usato per download/share)
  currentPreviewPage: 0,
  totalPreviewPages: 0,
};

/*
  Struttura di ogni oggetto in App.photos:
  {
    id:          string,        // univoco, generato da Date.now() + random
    file:        File,          // file originale
    originalSrc: string,        // data URL originale (mai modificato)
    currentSrc:  string,        // data URL con tutte le modifiche applicate
    name:        string,        // nome file
    exifDate:    Date|null,     // data scatto da EXIF
    isBlank:     boolean,       // true se pagina vuota
    history:     string[],      // stack undo (data URL)
    historyIdx:  number,        // indice corrente nello stack
    adjustments: {              // valori slider correnti
      brightness: 0,
      contrast:   0,
      saturation: 0,
      docMode:    false,
      watermark:  '',
    }
  }
*/

/* ══════════════════════════════════════════
   UTILITY
══════════════════════════════════════════ */

/** Genera un ID univoco */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Mostra un toast — tipo: 'success' | 'error' | 'info' */
function showToast(msg, tipo = 'info', durata = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = msg;
  toast.setAttribute('role', 'status');
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, durata);
}

/** Aggiorna il badge indicatore schermata nell'header */
function updateScreenIndicator(label) {
  document.getElementById('screen-indicator').textContent = label;
}

/** Mostra una schermata e nasconde le altre */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  const labels = {
    'screen-upload':  'Carica foto',
    'screen-editor':  'Editor',
    'screen-preview': 'Anteprima PDF',
  };
  updateScreenIndicator(labels[id] ?? '');
}

/** Legge un File e restituisce una Promise<string> (data URL) */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Restituisce il nome file senza estensione */
function fileBaseName(file) {
  return file.name.replace(/\.[^.]+$/, '');
}

/** Formatta la data corrente come stringa per il nome PDF */
function todayString() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

/* ══════════════════════════════════════════
   GESTIONE FOTO — AGGIUNTA
══════════════════════════════════════════ */

/** Elabora un array di File, li aggiunge ad App.photos e aggiorna la UI */
async function addFiles(files) {
  if (!files || files.length === 0) return;

  const fileArray = Array.from(files);
  const promises  = fileArray.map(async file => {
    const src = await fileToDataURL(file);
    const exifDate = await readExifDate(file).catch(() => null);

    const photo = {
      id:          uid(),
      file,
      originalSrc: src,
      currentSrc:  src,
      name:        fileBaseName(file),
      exifDate,
      isBlank:     false,
      history:     [src],
      historyIdx:  0,
      adjustments: {
        brightness: 0,
        contrast:   0,
        saturation: 0,
        docMode:    false,
        watermark:  '',
      },
    };
    return photo;
  });

  const newPhotos = await Promise.all(promises);
  App.photos.push(...newPhotos);

  // Salva la sessione
  saveSession();

  // Se è la prima foto → vai all'editor
  if (App.photos.length === newPhotos.length) {
    showScreen('screen-editor');
    // Imposta nome PDF di default
    const input = document.getElementById('input-pdf-name');
    if (input && !input.value) {
      input.value = `documento_${todayString()}`;
    }
  }

  renderGrid();
  showToast(`${newPhotos.length} foto aggiunta/e`, 'success');
}

/** Aggiunge una pagina vuota ad App.photos */
function addBlankPage() {
  const blank = {
    id:          uid(),
    file:        null,
    originalSrc: null,
    currentSrc:  null,
    name:        'Pagina vuota',
    exifDate:    null,
    isBlank:     true,
    history:     [],
    historyIdx:  0,
    adjustments: {
      brightness: 0,
      contrast:   0,
      saturation: 0,
      docMode:    false,
      watermark:  '',
    },
  };
  App.photos.push(blank);
  saveSession();
  renderGrid();
  showToast('Pagina vuota aggiunta', 'info');
}

/* ══════════════════════════════════════════
   RENDERING GRIGLIA
══════════════════════════════════════════ */

function renderGrid() {
  const grid       = document.getElementById('photo-grid');
  const emptyState = document.getElementById('empty-state');

  grid.innerHTML = '';

  if (App.photos.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  App.photos.forEach((photo, index) => {
    const card = createCard(photo, index);
    grid.appendChild(card);
  });

  // Re-inizializza drag & drop sulle card
  initCardDragDrop();

  // Re-inizializza le icone Lucide sulle nuove card
  if (window.lucide) lucide.createIcons();
}

/** Crea l'elemento DOM di una foto card */
function createCard(photo, index) {
  const card = document.createElement('div');
  card.className = 'photo-card' + (photo.id === App.selectedId ? ' selected' : '');
  card.setAttribute('role', 'listitem');
  card.setAttribute('draggable', 'true');
  card.dataset.id = photo.id;
  card.setAttribute('aria-label',
    photo.isBlank ? 'Pagina vuota' : `Foto ${index + 1}: ${photo.name}`);

  if (photo.isBlank) {
    // Card pagina vuota
    card.innerHTML = `
      <div class="blank-page" style="
        aspect-ratio: 210/297;
        display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        gap:var(--space-2);">
        <i data-lucide="file" style="color:var(--color-text-faint);"
           aria-hidden="true"></i>
        <span style="font-size:var(--text-xs); color:var(--color-text-muted);">
          Pagina vuota
        </span>
      </div>
      <div class="badge-order" aria-hidden="true">${index + 1}</div>
      <div class="card-overlay">
        <div class="card-actions">
          <button class="btn btn-ghost btn-icon btn-card-delete"
                  data-id="${photo.id}"
                  aria-label="Rimuovi pagina vuota"
                  title="Rimuovi">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
  } else {
    // Card foto normale
    card.innerHTML = `
      <img src="${photo.currentSrc}"
           alt="Foto ${index + 1}: ${photo.name}"
           loading="lazy"
           style="width:100%; height:auto; display:block;" />
      <div class="badge-order" aria-hidden="true">${index + 1}</div>
      <div class="card-overlay">
        <div class="card-actions">
          <button class="btn btn-ghost btn-icon btn-card-delete"
                  data-id="${photo.id}"
                  aria-label="Rimuovi foto ${index + 1}"
                  title="Rimuovi">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
  }

  // Click sulla card → seleziona per la sidebar
  card.addEventListener('click', e => {
    if (e.target.closest('.btn-card-delete')) return;
    selectPhoto(photo.id);
  });

  // Bottone elimina
  card.querySelector('.btn-card-delete')
      .addEventListener('click', e => {
        e.stopPropagation();
        removePhoto(photo.id);
      });

  return card;
}

/* ══════════════════════════════════════════
   SELEZIONE FOTO (sidebar)
══════════════════════════════════════════ */

function selectPhoto(id) {
  App.selectedId = id;

  // Aggiorna bordo selezione sulle card
  document.querySelectorAll('.photo-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });

  const photo = App.photos.find(p => p.id === id);
  if (!photo || photo.isBlank) {
    showSidebarPlaceholder();
    return;
  }

  showSidebarEditor(photo);
}

function showSidebarPlaceholder() {
  document.getElementById('sidebar-placeholder').hidden = false;
  document.getElementById('sidebar-editor').hidden      = true;
}

function showSidebarEditor(photo) {
  document.getElementById('sidebar-placeholder').hidden = true;
  document.getElementById('sidebar-editor').hidden      = false;

  // Slider colori
  setSlider('brightness', photo.adjustments.brightness);
  setSlider('contrast',   photo.adjustments.contrast);
  setSlider('saturation', photo.adjustments.saturation);

  // Modalità documento
  document.getElementById('toggle-doc-mode').checked = photo.adjustments.docMode;

  // Filigrana
  document.getElementById('input-watermark').value = photo.adjustments.watermark;

  // Undo/Redo
  updateUndoRedoButtons(photo);
}

function setSlider(name, value) {
  const slider = document.getElementById(`slider-${name}`);
  const output = document.getElementById(`out-${name}`);
  if (slider) slider.value  = value;
  if (output) output.value  = value;
}

function updateUndoRedoButtons(photo) {
  document.getElementById('btn-undo').disabled = photo.historyIdx <= 0;
  document.getElementById('btn-redo').disabled = photo.historyIdx >= photo.history.length - 1;
}

/* ══════════════════════════════════════════
   RIMOZIONE FOTO
══════════════════════════════════════════ */

function removePhoto(id) {
  App.photos = App.photos.filter(p => p.id !== id);
  if (App.selectedId === id) {
    App.selectedId = null;
    showSidebarPlaceholder();
  }
  saveSession();
  renderGrid();

  if (App.photos.length === 0) {
    showScreen('screen-upload');
  }
}

/* ══════════════════════════════════════════
   DRAG & DROP — RIORDINO CARD
══════════════════════════════════════════ */

let dragSrcId = null;

function initCardDragDrop() {
  const grid = document.getElementById('photo-grid');

  // Distruggi istanza precedente se esiste
  if (App._sortable) {
    App._sortable.destroy();
    App._sortable = null;
  }

  // SortableJS gestisce sia mouse che touch
  App._sortable = Sortable.create(grid, {
    animation:     150,
    ghostClass:    'dragging',
    chosenClass:   'selected',
    delay:         100,       // ms di pressione prima di attivare il drag
    delayOnTouchOnly: true,   // delay solo su touch, su desktop immediato
    touchStartThreshold: 5,   // pixel di movimento prima di iniziare il drag

    onEnd(evt) {
      // Riordina App.photos in base al nuovo ordine DOM
      const newOrder = [];
      document.querySelectorAll('.photo-card').forEach(card => {
        const photo = App.photos.find(p => p.id === card.dataset.id);
        if (photo) newOrder.push(photo);
      });
      App.photos = newOrder;
      saveSession();

      // Aggiorna i badge numerici senza re-renderizzare tutto
      document.querySelectorAll('.photo-card').forEach((card, i) => {
        const badge = card.querySelector('.badge-order');
        if (badge) badge.textContent = i + 1;
      });
    }
  });
}

/* ══════════════════════════════════════════
   DRAG & DROP — ZONA UPLOAD
══════════════════════════════════════════ */

function initUploadZone() {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => addFiles(input.files));

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
  });
}

/* ══════════════════════════════════════════
   TOOLBAR GLOBALE
══════════════════════════════════════════ */

function initToolbar() {
  // Aggiungi altre foto
  const btnAddMore  = document.getElementById('btn-add-more');
  const inputMore   = document.getElementById('file-input-more');
  btnAddMore.addEventListener('click', () => inputMore.click());
  inputMore.addEventListener('change', () => addFiles(inputMore.files));

  // Ordina per data EXIF
  document.getElementById('btn-sort-exif').addEventListener('click', () => {
    const withDate    = App.photos.filter(p => p.exifDate);
    const withoutDate = App.photos.filter(p => !p.exifDate);

    withDate.sort((a, b) => a.exifDate - b.exifDate);
    App.photos = [...withDate, ...withoutDate];

    saveSession();
    renderGrid();
    showToast('Foto ordinate per data di scatto', 'success');
  });

  // Aggiungi pagina vuota
  document.getElementById('btn-add-blank')
          .addEventListener('click', addBlankPage);

  // Layout pagina
  document.getElementById('select-layout').addEventListener('change', e => {
    App.pdfLayout = parseInt(e.target.value, 10);
  });

  // Orientamento pagina
  document.getElementById('select-orientation').addEventListener('change', e => {
    App.pdfOrientation = e.target.value;
  });

  // Bottone aggiungi dall'empty state
  document.getElementById('btn-empty-add')
          .addEventListener('click', () => {
            document.getElementById('file-input-more').click();
          });
}

/* ══════════════════════════════════════════
   FOOTER AZIONI
══════════════════════════════════════════ */

function initFooter() {
  // Torna a upload
  document.getElementById('btn-back-upload').addEventListener('click', () => {
    if (confirm('Vuoi tornare indietro? Le foto rimarranno caricate.')) {
      showScreen('screen-upload');
    }
  });

  // Genera PDF → vai all'anteprima
  document.getElementById('btn-generate-pdf').addEventListener('click', async () => {
    if (App.photos.filter(p => !p.isBlank).length === 0) {
      showToast('Aggiungi almeno una foto prima di generare il PDF', 'error');
      return;
    }
    const btn = document.getElementById('btn-generate-pdf');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" aria-hidden="true"></i> Generazione...';
    if (window.lucide) lucide.createIcons();

    try {
      await generatePDFPreview();
      showScreen('screen-preview');
    } catch (err) {
      console.error(err);
      showToast('Errore nella generazione del PDF', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="file-text" aria-hidden="true"></i> Genera anteprima PDF';
      if (window.lucide) lucide.createIcons();
    }
  });

  // Torna all'editor dall'anteprima
  document.getElementById('btn-back-editor').addEventListener('click', () => {
    showScreen('screen-editor');
  });

  // Download PDF
  document.getElementById('btn-download').addEventListener('click', downloadPDF);

  // Condividi (Web Share API)
  const btnShare = document.getElementById('btn-share');
  if (navigator.share && navigator.canShare) {
    btnShare.hidden = false;
    btnShare.addEventListener('click', sharePDF);
  }
}

/* ══════════════════════════════════════════
   SIDEBAR — SLIDER COLORI
══════════════════════════════════════════ */

function initSidebarControls() {

  // Slider: aggiorna output + applica
  ['brightness', 'contrast', 'saturation'].forEach(name => {
    const slider = document.getElementById(`slider-${name}`);
    const output = document.getElementById(`out-${name}`);

    slider.addEventListener('input', () => {
      output.value = slider.value;
      const photo = getSelectedPhoto();
      if (!photo) return;
      photo.adjustments[name] = parseInt(slider.value, 10);
      applyAdjustments(photo);
    });
  });

  // Modalità documento
  document.getElementById('toggle-doc-mode').addEventListener('change', e => {
    const photo = getSelectedPhoto();
    if (!photo) return;
    photo.adjustments.docMode = e.target.checked;
    applyAdjustments(photo);
  });

  // Filigrana
  document.getElementById('input-watermark').addEventListener('input', e => {
    const photo = getSelectedPhoto();
    if (!photo) return;
    photo.adjustments.watermark = e.target.value;
    // Non richiede re-render canvas, viene usata nella generazione PDF
  });

  // Preset
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const photo = getSelectedPhoto();
      if (!photo) return;
      applyPreset(photo, btn.dataset.preset);
    });
  });

  // Auto-enhance
  document.getElementById('btn-auto-enhance').addEventListener('click', () => {
    const photo = getSelectedPhoto();
    if (!photo) return;
    autoEnhance(photo);
  });

  // Undo
  document.getElementById('btn-undo').addEventListener('click', () => {
    const photo = getSelectedPhoto();
    if (!photo) return;
    undoPhoto(photo);
  });

  // Redo
  document.getElementById('btn-redo').addEventListener('click', () => {
    const photo = getSelectedPhoto();
    if (!photo) return;
    redoPhoto(photo);
  });

  // Ripristina
  document.getElementById('btn-reset').addEventListener('click', () => {
    const photo = getSelectedPhoto();
    if (!photo) return;
    if (confirm('Ripristinare la foto all\'originale? Tutte le modifiche andranno perse.')) {
      resetPhoto(photo);
    }
  });

  // Crop
  document.getElementById('btn-crop').addEventListener('click', () => {
    const photo = getSelectedPhoto();
    if (!photo) return;
    openCropModal(photo);
  });

    // Rotazione
  document.getElementById('btn-rotate-ccw')
          .addEventListener('click', () => {
            const photo = getSelectedPhoto();
            if (photo) rotatePhoto(photo, -90);
          });

  document.getElementById('btn-rotate-cw')
          .addEventListener('click', () => {
            const photo = getSelectedPhoto();
            if (photo) rotatePhoto(photo, 90);
          });

  document.getElementById('btn-rotate-180')
          .addEventListener('click', () => {
            const photo = getSelectedPhoto();
            if (photo) rotatePhoto(photo, 180);
          });
}

/* ══════════════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════════════ */

function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ignora se si sta scrivendo in un input
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    const photo = getSelectedPhoto();

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (photo) undoPhoto(photo);
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Z')) {
      e.preventDefault();
      if (photo) redoPhoto(photo);
    }
  });
}

/* ══════════════════════════════════════════
   HELPER — FOTO SELEZIONATA
══════════════════════════════════════════ */

function getSelectedPhoto() {
  if (!App.selectedId) return null;
  return App.photos.find(p => p.id === App.selectedId) ?? null;
}

/* ══════════════════════════════════════════
   NAVIGAZIONE ANTEPRIMA PDF
══════════════════════════════════════════ */

function initPreviewNav() {
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (App.currentPreviewPage > 0) {
      App.currentPreviewPage--;
      renderPreviewPage(App.currentPreviewPage);
    }
  });

  document.getElementById('btn-next-page').addEventListener('click', () => {
    if (App.currentPreviewPage < App.totalPreviewPages - 1) {
      App.currentPreviewPage++;
      renderPreviewPage(App.currentPreviewPage);
    }
  });
}

/* ══════════════════════════════════════════
   INIT — PUNTO DI INGRESSO
══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // Inizializza Lucide icons
  if (window.lucide) lucide.createIcons();

  // Inizializza moduli
  initUploadZone();
  initToolbar();
  initFooter();
  initSidebarControls();
  initKeyboardShortcuts();
  initPreviewNav();

  // Ripristina sessione salvata (se presente)
  restoreSession();

  // Se c'erano foto in sessione → vai direttamente all'editor
  if (App.photos.length > 0) {
    showScreen('screen-editor');
    renderGrid();
    showToast('Sessione precedente ripristinata', 'info');
  }

  // Modale crop — chiudi
  document.getElementById('btn-close-crop')
          .addEventListener('click', closeCropModal);
  document.getElementById('btn-crop-cancel')
          .addEventListener('click', closeCropModal);

  // Chiudi modale crop cliccando fuori
  document.getElementById('modal-crop')
          .addEventListener('click', e => {
            if (e.target === e.currentTarget) closeCropModal();
          });
});