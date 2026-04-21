/* ============================================================
   editor.js — Manipolazione immagini via Canvas API
   Aggiustamenti colori, preset, auto-enhance, undo/redo, crop
   ============================================================ */

'use strict';

/* ══════════════════════════════════════════
   UTILITY CANVAS
══════════════════════════════════════════ */

/**
 * Carica un data URL in un HTMLImageElement
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = src;
  });
}

/**
 * Disegna un'immagine su un canvas offscreen e restituisce i pixel (ImageData)
 * @param {HTMLImageElement} img
 * @returns {{ ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: ImageData }}
 */
function imageToCanvas(img) {
  const canvas    = document.createElement('canvas');
  canvas.width    = img.naturalWidth;
  canvas.height   = img.naturalHeight;
  const ctx       = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data      = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { ctx, canvas, data };
}

/**
 * Converte il canvas in data URL JPEG (qualità alta)
 * @param {HTMLCanvasElement} canvas
 * @returns {string}
 */
function canvasToDataURL(canvas) {
  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Clamp: mantiene un valore tra min e max
 */
function clamp(val, min = 0, max = 255) {
  return Math.max(min, Math.min(max, val));
}

/* ══════════════════════════════════════════
   PUSH HISTORY — salva stato nello stack undo
══════════════════════════════════════════ */

/**
 * Aggiunge il currentSrc corrente allo stack history della foto,
 * poi aggiorna currentSrc con il nuovo src.
 * Tronca il futuro se si era fatto undo prima.
 */
function pushHistory(photo, newSrc) {
  // Tronca eventuali stati "futuri" (dopo un undo)
  photo.history = photo.history.slice(0, photo.historyIdx + 1);

  // Limita lo stack a 20 passi per non sprecare memoria
  if (photo.history.length >= 20) {
    photo.history.shift();
  }

  photo.history.push(newSrc);
  photo.historyIdx = photo.history.length - 1;
  photo.currentSrc = newSrc;
}

/* ══════════════════════════════════════════
   UNDO / REDO / RESET
══════════════════════════════════════════ */

function undoPhoto(photo) {
  if (photo.historyIdx <= 0) return;
  photo.historyIdx--;
  photo.currentSrc = photo.history[photo.historyIdx];

  updateCardImage(photo);
  updateUndoRedoButtons(photo);
  saveSession();
}

function redoPhoto(photo) {
  if (photo.historyIdx >= photo.history.length - 1) return;
  photo.historyIdx++;
  photo.currentSrc = photo.history[photo.historyIdx];

  updateCardImage(photo);
  updateUndoRedoButtons(photo);
  saveSession();
}

function resetPhoto(photo) {
  photo.currentSrc  = photo.originalSrc;
  photo.history     = [photo.originalSrc];
  photo.historyIdx  = 0;
  photo.adjustments = {
    brightness: 0,
    contrast:   0,
    saturation: 0,
    docMode:    false,
    watermark:  '',
  };

  updateCardImage(photo);
  showSidebarEditor(photo);
  updateUndoRedoButtons(photo);
  saveSession();
  showToast('Foto ripristinata all\'originale', 'info');
}

/**
 * Aggiorna l'immagine nella card della griglia senza re-renderizzare tutto
 */
function updateCardImage(photo) {
  const card = document.querySelector(`.photo-card[data-id="${photo.id}"]`);
  if (!card) return;
  const img = card.querySelector('img');
  if (img) img.src = photo.currentSrc;
}

/* ══════════════════════════════════════════
   AGGIUSTAMENTI COLORI — CORE
══════════════════════════════════════════ */

/**
 * Applica brightness, contrast, saturation e docMode
 * al currentSrc della foto tramite Canvas API.
 * Parte SEMPRE dall'originalSrc per evitare degradazione qualità.
 */
async function applyAdjustments(photo) {
  const { brightness, contrast, saturation, docMode } = photo.adjustments;

  const img             = await loadImage(photo.originalSrc);
  const { ctx, canvas, data } = imageToCanvas(img);
  const pixels          = data.data; // Uint8ClampedArray RGBA

  for (let i = 0; i < pixels.length; i += 4) {
    let r = pixels[i];
    let g = pixels[i + 1];
    let b = pixels[i + 2];
    // alpha pixels[i+3] non toccare

    // ── Modalità documento: converti in scala di grigi prima ──
    if (docMode) {
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      r = g = b = gray;
    }

    // ── Saturazione ──
    // Converte in HSL, modifica S, riconverte
    if (saturation !== 0 && !docMode) {
      [r, g, b] = adjustSaturation(r, g, b, saturation);
    }

    // ── Brightness ──
    // Valore -100..+100 → mappa a -255..+255
    const bVal = Math.round((brightness / 100) * 255);
    r = clamp(r + bVal);
    g = clamp(g + bVal);
    b = clamp(b + bVal);

    // ── Contrasto ──
    // Formula standard: factor * (val - 128) + 128
    const cFactor = docMode
      ? (contrast + 50) / 100 * 2.5 + 0.5   // più aggressivo in doc mode
      : (contrast + 100) / 100;
    r = clamp(Math.round(cFactor * (r - 128) + 128));
    g = clamp(Math.round(cFactor * (g - 128) + 128));
    b = clamp(Math.round(cFactor * (b - 128) + 128));

    pixels[i]     = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }

  ctx.putImageData(data, 0, 0);
  const newSrc = canvasToDataURL(canvas);

  pushHistory(photo, newSrc);
  updateCardImage(photo);
  updateUndoRedoButtons(photo);
  saveSession();
}

/**
 * Regola la saturazione di un pixel RGB
 * @param {number} r @param {number} g @param {number} b
 * @param {number} amount — valore -100..+100
 * @returns {[number, number, number]}
 */
function adjustSaturation(r, g, b, amount) {
  // Converti RGB → HSL
  const rN = r / 255, gN = g / 255, bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l   = (max + min) / 2;
  let h, s;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN: h = ((gN - bN) / d + (gN < bN ? 6 : 0)) / 6; break;
      case gN: h = ((bN - rN) / d + 2) / 6; break;
      case bN: h = ((rN - gN) / d + 4) / 6; break;
    }
  }

  // Modifica saturazione
  const sNew = clamp(s + (amount / 100) * 0.5, 0, 1);

  // Converti HSL → RGB
  if (sNew === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const q = l < 0.5 ? l * (1 + sNew) : l + sNew - l * sNew;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h)       * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

/* ══════════════════════════════════════════
   PRESET COLORI
══════════════════════════════════════════ */

const PRESETS = {
  natural: {
    brightness: 0,
    contrast:   0,
    saturation: 0,
    docMode:    false,
  },
  document: {
    brightness: 10,
    contrast:   40,
    saturation: -100,
    docMode:    false,
  },
  night: {
    brightness: 40,
    contrast:   15,
    saturation: -10,
    docMode:    false,
  },
};

function applyPreset(photo, presetName) {
  const preset = PRESETS[presetName];
  if (!preset) return;

  photo.adjustments = { ...photo.adjustments, ...preset };

  // Aggiorna slider nella sidebar
  setSlider('brightness', preset.brightness);
  setSlider('contrast',   preset.contrast);
  setSlider('saturation', preset.saturation);
  document.getElementById('toggle-doc-mode').checked = preset.docMode ?? false;

  applyAdjustments(photo);
  showToast(`Preset "${presetName}" applicato`, 'info');
}

/* ══════════════════════════════════════════
   AUTO-ENHANCE — analisi istogramma
══════════════════════════════════════════ */

/**
 * Analizza l'istogramma dei pixel e calcola automaticamente
 * brightness e contrast ottimali, poi applica.
 */
async function autoEnhance(photo) {
  const img                   = await loadImage(photo.currentSrc);
  const { data }              = imageToCanvas(img);
  const pixels                = data.data;

  // Calcola luminosità media e deviazione standard
  let sum   = 0;
  let count = 0;
  const luminances = [];

  for (let i = 0; i < pixels.length; i += 4) {
    const lum = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
    luminances.push(lum);
    sum  += lum;
    count++;
  }

  const mean = sum / count;

  // Deviazione standard → misura del contrasto
  const variance = luminances.reduce((acc, l) => acc + (l - mean) ** 2, 0) / count;
  const stdDev   = Math.sqrt(variance);

  // Percentile 5° e 95° per auto-levels
  luminances.sort((a, b) => a - b);
  const p5  = luminances[Math.floor(count * 0.05)];
  const p95 = luminances[Math.floor(count * 0.95)];

  // Calcola correzioni
  // Brightness: sposta la media verso 128
  const targetMean  = 128;
  const brightAdj   = clamp(Math.round((targetMean - mean) * 0.6), -60, 60);

  // Contrast: se stdDev bassa → aumenta, se alta → non toccare
  const targetStdDev = 60;
  const contrastAdj  = stdDev < targetStdDev
    ? clamp(Math.round((targetStdDev - stdDev) * 0.8), 0, 50)
    : 0;

  // Saturazione: se p95-p5 range basso → foto piatta, aumenta un po'
  const range      = p95 - p5;
  const satAdj     = range < 100 ? 15 : 0;

  // Applica
  photo.adjustments.brightness = brightAdj;
  photo.adjustments.contrast   = contrastAdj;
  photo.adjustments.saturation = satAdj;

  // Aggiorna slider nella sidebar
  setSlider('brightness', brightAdj);
  setSlider('contrast',   contrastAdj);
  setSlider('saturation', satAdj);

  await applyAdjustments(photo);
  showToast('Foto migliorata automaticamente ✨', 'success');
}

/* ══════════════════════════════════════════
   CROP — strumento di ritaglio interattivo
══════════════════════════════════════════ */

// Stato interno del crop
const CropState = {
  photo:       null,
  img:         null,
  canvas:      null,
  ctx:         null,
  scale:       1,       // fattore di scala canvas → immagine reale
  rect:        { x: 0, y: 0, w: 0, h: 0 }, // rettangolo corrente (in coord canvas)
  dragging:    false,
  resizing:    false,
  resizeHandle: null,   // 'tl'|'tr'|'bl'|'br'
  startX:      0,
  startY:      0,
  startRect:   null,
};

const HANDLE_SIZE = 10; // px, dimensione maniglie angolo

async function openCropModal(photo) {
  CropState.photo = photo;

  // DOPO
    const modal = document.getElementById('modal-crop');
    modal.classList.add('is-open');

    // Aspetta il prossimo frame — il modale deve essere visibile
    // prima che il canvas possa essere dimensionato correttamente
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = document.getElementById('crop-canvas');
    CropState.canvas = canvas;
    CropState.ctx    = canvas.getContext('2d');

    const img = await loadImage(photo.currentSrc);
    CropState.img = img;

    // Calcola dimensioni canvas basandosi sul modal ora visibile
    const modalBody = modal.querySelector('.modal-body');
    const maxW = Math.min(modalBody ? modalBody.clientWidth - 32 : window.innerWidth - 80, 700);
    const maxH = Math.min(window.innerHeight * 0.55, 600);
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);

    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    CropState.scale = scale;

  // Rettangolo iniziale = tutta l'immagine con margine 5%
  const margin = 0.05;
  CropState.rect = {
    x: canvas.width  * margin,
    y: canvas.height * margin,
    w: canvas.width  * (1 - margin * 2),
    h: canvas.height * (1 - margin * 2),
  };

  drawCrop();
  bindCropEvents();

  // Conferma crop
  const btnConfirm = document.getElementById('btn-crop-confirm');
  btnConfirm.replaceWith(btnConfirm.cloneNode(true)); // rimuove listener precedenti
  document.getElementById('btn-crop-confirm').addEventListener('click', () => confirmCrop());
}

function closeCropModal() {
  document.getElementById('modal-crop').classList.remove('is-open');
  unbindCropEvents();
  CropState.photo = null;
}

/* ── Disegno crop overlay ── */
function drawCrop() {
  const { ctx, canvas, img, rect } = CropState;

  // Immagine di sfondo
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Overlay scuro fuori dal rect
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // "Taglia" la zona selezionata — mostra immagine chiara dentro il rect
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Bordo rettangolo
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  // Griglia rule-of-thirds (3x3)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth   = 0.5;
  for (let i = 1; i < 3; i++) {
    // Verticali
    ctx.beginPath();
    ctx.moveTo(rect.x + rect.w * i / 3, rect.y);
    ctx.lineTo(rect.x + rect.w * i / 3, rect.y + rect.h);
    ctx.stroke();
    // Orizzontali
    ctx.beginPath();
    ctx.moveTo(rect.x,          rect.y + rect.h * i / 3);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h * i / 3);
    ctx.stroke();
  }

  // Maniglie agli angoli
  ctx.fillStyle = '#ffffff';
  const hs = HANDLE_SIZE;
  [
    [rect.x,            rect.y],
    [rect.x + rect.w - hs, rect.y],
    [rect.x,            rect.y + rect.h - hs],
    [rect.x + rect.w - hs, rect.y + rect.h - hs],
  ].forEach(([hx, hy]) => {
    ctx.fillRect(hx, hy, hs, hs);
  });
}

/* ── Rilevamento handle ── */
function getHandle(x, y) {
  const { rect } = CropState;
  const hs       = HANDLE_SIZE + 4; // area cliccabile leggermente più grande

  if (x >= rect.x && x <= rect.x + hs &&
      y >= rect.y && y <= rect.y + hs)                          return 'tl';
  if (x >= rect.x + rect.w - hs && x <= rect.x + rect.w &&
      y >= rect.y && y <= rect.y + hs)                          return 'tr';
  if (x >= rect.x && x <= rect.x + hs &&
      y >= rect.y + rect.h - hs && y <= rect.y + rect.h)        return 'bl';
  if (x >= rect.x + rect.w - hs && x <= rect.x + rect.w &&
      y >= rect.y + rect.h - hs && y <= rect.y + rect.h)        return 'br';
  return null;
}

/* ── Coordinate mouse/touch relative al canvas ── */
function getCanvasPos(e) {
  const canvas = CropState.canvas;
  const bounds = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / bounds.width;
  const scaleY = canvas.height / bounds.height;
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - bounds.left) * scaleX,
    y: (src.clientY - bounds.top)  * scaleY,
  };
}

/* ── Event handlers crop ── */
function onCropPointerDown(e) {
  e.preventDefault();
  const { x, y } = getCanvasPos(e);
  const handle   = getHandle(x, y);

  if (handle) {
    CropState.resizing     = true;
    CropState.resizeHandle = handle;
  } else if (
    x >= CropState.rect.x && x <= CropState.rect.x + CropState.rect.w &&
    y >= CropState.rect.y && y <= CropState.rect.y + CropState.rect.h
  ) {
    CropState.dragging = true;
  }

  CropState.startX    = x;
  CropState.startY    = y;
  CropState.startRect = { ...CropState.rect };
}

function onCropPointerMove(e) {
  e.preventDefault();
  if (!CropState.dragging && !CropState.resizing) return;

  const { x, y }        = getCanvasPos(e);
  const dx              = x - CropState.startX;
  const dy              = y - CropState.startY;
  const { canvas }      = CropState;
  const sr              = CropState.startRect;
  const minSize         = 30;

  if (CropState.dragging) {
    CropState.rect.x = clamp(sr.x + dx, 0, canvas.width  - sr.w);
    CropState.rect.y = clamp(sr.y + dy, 0, canvas.height - sr.h);
  }

  if (CropState.resizing) {
    let { x: rx, y: ry, w: rw, h: rh } = sr;

    switch (CropState.resizeHandle) {
      case 'tl':
        rx = clamp(sr.x + dx, 0, sr.x + sr.w - minSize);
        ry = clamp(sr.y + dy, 0, sr.y + sr.h - minSize);
        rw = sr.x + sr.w - rx;
        rh = sr.y + sr.h - ry;
        break;
      case 'tr':
        ry = clamp(sr.y + dy, 0, sr.y + sr.h - minSize);
        rw = clamp(sr.w + dx, minSize, canvas.width  - sr.x);
        rh = sr.y + sr.h - ry;
        break;
      case 'bl':
        rx = clamp(sr.x + dx, 0, sr.x + sr.w - minSize);
        rw = sr.x + sr.w - rx;
        rh = clamp(sr.h + dy, minSize, canvas.height - sr.y);
        break;
      case 'br':
        rw = clamp(sr.w + dx, minSize, canvas.width  - sr.x);
        rh = clamp(sr.h + dy, minSize, canvas.height - sr.y);
        break;
    }

    CropState.rect = { x: rx, y: ry, w: rw, h: rh };
  }

  drawCrop();
}

function onCropPointerUp(e) {
  e.preventDefault();
  CropState.dragging  = false;
  CropState.resizing  = false;
  CropState.resizeHandle = null;
}

function bindCropEvents() {
  const canvas = CropState.canvas;
  canvas.addEventListener('mousedown',  onCropPointerDown);
  canvas.addEventListener('mousemove',  onCropPointerMove);
  canvas.addEventListener('mouseup',    onCropPointerUp);
  canvas.addEventListener('touchstart', onCropPointerDown, { passive: false });
  canvas.addEventListener('touchmove',  onCropPointerMove, { passive: false });
  canvas.addEventListener('touchend',   onCropPointerUp,   { passive: false });
}

function unbindCropEvents() {
  const canvas = document.getElementById('crop-canvas');
  if (!canvas) return;
  canvas.removeEventListener('mousedown',  onCropPointerDown);
  canvas.removeEventListener('mousemove',  onCropPointerMove);
  canvas.removeEventListener('mouseup',    onCropPointerUp);
  canvas.removeEventListener('touchstart', onCropPointerDown);
  canvas.removeEventListener('touchmove',  onCropPointerMove);
  canvas.removeEventListener('touchend',   onCropPointerUp);
}

/* ── Applica il crop all'immagine reale ── */
async function confirmCrop() {
  const { photo, rect, scale, img } = CropState;
  if (!photo) return;

  // Converti coordinate canvas → coordinate immagine reale
  const realX = Math.round(rect.x / scale);
  const realY = Math.round(rect.y / scale);
  const realW = Math.round(rect.w / scale);
  const realH = Math.round(rect.h / scale);

  // Disegna solo la zona ritagliata su un canvas nuovo
  const outCanvas    = document.createElement('canvas');
  outCanvas.width    = realW;
  outCanvas.height   = realH;
  const outCtx       = outCanvas.getContext('2d');

  outCtx.drawImage(img, realX, realY, realW, realH, 0, 0, realW, realH);
  const newSrc = canvasToDataURL(outCanvas);

  pushHistory(photo, newSrc);
  updateCardImage(photo);
  updateUndoRedoButtons(photo);
  saveSession();

  closeCropModal();
  showToast('Ritaglio applicato', 'success');
}

/* ══════════════════════════════════════════
   ROTAZIONE
══════════════════════════════════════════ */

/**
 * Ruota un'immagine di `degrees` gradi (90, -90, 180)
 * e salva il risultato in history.
 */
async function rotatePhoto(photo, degrees) {
  const img    = await loadImage(photo.currentSrc);
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');

  const w = img.naturalWidth;
  const h = img.naturalHeight;

  // Per 90° e -90° larghezza e altezza si scambiano
  if (degrees === 90 || degrees === -90) {
    canvas.width  = h;
    canvas.height = w;
  } else {
    canvas.width  = w;
    canvas.height = h;
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);

  const newSrc = canvasToDataURL(canvas);
  pushHistory(photo, newSrc);
  updateCardImage(photo);
  updateUndoRedoButtons(photo);
  saveSession();
  showToast(`Foto ruotata di ${degrees}°`, 'info');
}