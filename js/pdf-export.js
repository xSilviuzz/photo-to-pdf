/* ============================================================
   pdf-export.js — Generazione PDF, anteprima e download
   Usa jsPDF (CDN) per creare il PDF e PDF.js per l'anteprima
   ============================================================ */

'use strict';

/* ══════════════════════════════════════════
   COSTANTI
══════════════════════════════════════════ */

// Dimensioni A4 in mm
const A4 = { w: 210, h: 297 };

// Margine di default in mm
const MARGIN = 8;

// Qualità JPEG nel PDF (0-1)
const PDF_QUALITY = 0.92;

/* ══════════════════════════════════════════
   UTILITY
══════════════════════════════════════════ */

/**
 * Carica un data URL in un HTMLImageElement
 * (ridefinita qui per indipendenza dal modulo editor)
 */
function pdfLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img  = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = src;
  });
}

/**
 * Comprime un data URL in JPEG se è PNG/WEBP,
 * per ridurre il peso del PDF finale.
 * @param {string} src — data URL originale
 * @param {number} quality — 0..1
 * @returns {Promise<string>} — data URL JPEG
 */
async function compressToJpeg(src, quality = PDF_QUALITY) {
  // Se è già JPEG non ricodificare
  if (src.startsWith('data:image/jpeg')) return src;

  const img    = await pdfLoadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx    = canvas.getContext('2d');

  // Sfondo bianco (PNG trasparente → bianco nel PDF)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Calcola x, y, w, h per centrare un'immagine
 * in un'area disponibile (con aspect ratio preservato).
 *
 * @param {number} imgW  larghezza immagine (px)
 * @param {number} imgH  altezza immagine (px)
 * @param {number} areaW larghezza area disponibile (mm)
 * @param {number} areaH altezza area disponibile (mm)
 * @returns {{ x, y, w, h }} — coordinate e dimensioni in mm
 */
function fitInArea(imgW, imgH, areaW, areaH) {
  const imgRatio  = imgW / imgH;
  const areaRatio = areaW / areaH;

  let w, h;
  if (imgRatio > areaRatio) {
    // Immagine più larga → scala per larghezza
    w = areaW;
    h = areaW / imgRatio;
  } else {
    // Immagine più alta → scala per altezza
    h = areaH;
    w = areaH * imgRatio;
  }

  // Centra nell'area
  const x = (areaW - w) / 2;
  const y = (areaH - h) / 2;

  return { x, y, w, h };
}

/**
 * Disegna il testo filigrana in fondo alla pagina
 * @param {jsPDF} doc
 * @param {string} text
 * @param {number} pageW  larghezza pagina mm
 * @param {number} pageH  altezza pagina mm
 */
function drawWatermark(doc, text, pageW, pageH) {
  if (!text || !text.trim()) return;
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.text(
    text.trim(),
    pageW / 2,
    pageH - 3,
    { align: 'center' }
  );
  // Resetta colore testo
  doc.setTextColor(0, 0, 0);
}

/* ══════════════════════════════════════════
   RACCOLTA FOTO — prepara i dati per il PDF
══════════════════════════════════════════ */

/**
 * Restituisce l'array di "slot" da mettere nel PDF.
 * Ogni slot è { src, watermark } oppure { isBlank, watermark }.
 * Tiene conto del layout (1/2/4 per pagina).
 */
function collectSlots() {
  return App.photos.map(photo => ({
    src:       photo.isBlank ? null : photo.currentSrc,
    isBlank:   photo.isBlank,
    watermark: photo.adjustments.watermark ?? '',
  }));
}

/**
 * Raggruppa gli slot in pagine in base al layout scelto.
 * Layout 1 → ogni slot è una pagina
 * Layout 2 → 2 slot per pagina (colonne)
 * Layout 4 → 4 slot per pagina (griglia 2x2)
 *
 * @param {Array} slots
 * @param {number} perPage — 1 | 2 | 4
 * @returns {Array<Array>} — array di pagine, ognuna è un array di slot
 */
function groupIntoPages(slots, perPage) {
  const pages = [];
  for (let i = 0; i < slots.length; i += perPage) {
    pages.push(slots.slice(i, i + perPage));
  }
  return pages;
}

/* ══════════════════════════════════════════
   GENERAZIONE PDF
══════════════════════════════════════════ */

/**
 * Genera il PDF completo e lo salva in App.pdfBlob.
 * Chiamata da app.js → btn-generate-pdf.
 */
async function generatePDFPreview() {
  const { jsPDF } = window.jspdf;

  const orientation = App.pdfOrientation; // 'portrait' | 'landscape'
  const perPage     = App.pdfLayout;      // 1 | 2 | 4

  // Dimensioni pagina in mm
  const pageW = orientation === 'portrait' ? A4.w : A4.h;
  const pageH = orientation === 'portrait' ? A4.h : A4.w;

  const doc    = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const slots  = collectSlots();
  const pages  = groupIntoPages(slots, perPage);

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    if (pageIdx > 0) doc.addPage();

    const pageSlots = pages[pageIdx];

    // Calcola aree disponibili per ogni slot nella pagina
    const areas = getSlotAreas(perPage, pageW, pageH);

    for (let slotIdx = 0; slotIdx < pageSlots.length; slotIdx++) {
      const slot = pageSlots[slotIdx];
      const area = areas[slotIdx];
      if (!area) continue;

      if (slot.isBlank || !slot.src) {
        // Pagina/slot vuoto — niente da disegnare
        continue;
      }

      // Comprimi in JPEG
      const jpegSrc = await compressToJpeg(slot.src);

      // Carica per leggere dimensioni reali
      const img = await pdfLoadImage(jpegSrc);

      // Calcola posizione centrata nell'area
      const fit = fitInArea(
        img.naturalWidth, img.naturalHeight,
        area.w, area.h
      );

      // Disegna nel PDF
      doc.addImage(
        jpegSrc,
        'JPEG',
        area.x + fit.x,
        area.y + fit.y,
        fit.w,
        fit.h,
        undefined,
        'FAST'
      );
    }

    // Filigrana: usa quella del primo slot della pagina (se presente)
    const firstSlot = pageSlots[0];
    if (firstSlot?.watermark) {
      drawWatermark(doc, firstSlot.watermark, pageW, pageH);
    }
  }

  // Salva il blob in App per download/share
  App.pdfBlob = doc.output('blob');

  // Avvia rendering anteprima
  await renderPDFPreview(App.pdfBlob, pages.length);
}

/**
 * Calcola le aree (x, y, w, h) in mm per ogni slot nella pagina,
 * in base al numero di foto per pagina.
 *
 * @param {number} perPage
 * @param {number} pageW mm
 * @param {number} pageH mm
 * @returns {Array<{x,y,w,h}>}
 */
function getSlotAreas(perPage, pageW, pageH) {
  const m = MARGIN; // margine esterno
  const g = 4;      // gap tra slot mm

  if (perPage === 1) {
    return [{
      x: m,
      y: m,
      w: pageW - m * 2,
      h: pageH - m * 2,
    }];
  }

  if (perPage === 2) {
    // Due colonne affiancate
    const slotW = (pageW - m * 2 - g) / 2;
    const slotH = pageH - m * 2;
    return [
      { x: m,              y: m, w: slotW, h: slotH },
      { x: m + slotW + g,  y: m, w: slotW, h: slotH },
    ];
  }

  if (perPage === 4) {
    // Griglia 2x2
    const slotW = (pageW - m * 2 - g) / 2;
    const slotH = (pageH - m * 2 - g) / 2;
    return [
      { x: m,             y: m,             w: slotW, h: slotH },
      { x: m + slotW + g, y: m,             w: slotW, h: slotH },
      { x: m,             y: m + slotH + g, w: slotW, h: slotH },
      { x: m + slotW + g, y: m + slotH + g, w: slotW, h: slotH },
    ];
  }

  return [];
}

/* ══════════════════════════════════════════
   ANTEPRIMA PDF — rendering con PDF.js
══════════════════════════════════════════ */

/**
 * Renderizza l'anteprima del PDF appena generato.
 * Usa PDF.js per convertire ogni pagina in canvas.
 * @param {Blob} blob — PDF blob
 * @param {number} totalPages — numero pagine atteso
 */
async function renderPDFPreview(blob, totalPages) {
  // Configura PDF.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  } else {
    showToast('PDF.js non disponibile, anteprima non renderizzata', 'error');
    return;
  }

  // Converti blob in ArrayBuffer per PDF.js
  const arrayBuffer = await blob.arrayBuffer();
  const pdfDoc      = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  App.totalPreviewPages  = pdfDoc.numPages;
  App.currentPreviewPage = 0;
  App._pdfDoc            = pdfDoc; // salva riferimento per navigazione

  // Genera miniature per tutte le pagine
  await renderAllThumbnails(pdfDoc);

  // Aspetta che la schermata anteprima sia visibile prima di misurare il container
  await new Promise(resolve => {
    const screen = document.getElementById('screen-preview');
    if (screen && screen.classList.contains('active')) {
      resolve();
    } else {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }
  });

  await renderPreviewPage(0);

  // Aggiorna navigazione
  updatePreviewNav();
}

/**
 * Renderizza una singola pagina nell'area di anteprima principale.
 * @param {number} pageIdx — indice 0-based
 */
async function renderPreviewPage(pageIdx) {
  if (!App._pdfDoc) return;

  const pdfDoc     = App._pdfDoc;
  const page       = await pdfDoc.getPage(pageIdx + 1);
  const mainCanvas = document.getElementById('preview-canvas');
  const container  = document.getElementById('preview-slide');

  const containerW = container.clientWidth || window.innerWidth - 32;
  const viewport0  = page.getViewport({ scale: 1 });

  const dpr    = window.devicePixelRatio || 1;
  const scale  = containerW / viewport0.width;
  const viewport = page.getViewport({ scale });

  // Canvas fisico = dimensioni * dpr (alta risoluzione)
  mainCanvas.width  = Math.floor(viewport.width  * dpr);
  mainCanvas.height = Math.floor(viewport.height * dpr);

  // CSS = dimensioni logiche (normali)
  mainCanvas.style.width  = Math.floor(viewport.width)  + 'px';
  mainCanvas.style.height = Math.floor(viewport.height) + 'px';

  container.style.aspectRatio = `${viewport0.width} / ${viewport0.height}`;

  const ctx = mainCanvas.getContext('2d');
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

  // transform scala il contesto per il dpr — metodo ufficiale PDF.js
  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;

  await page.render({
    canvasContext: ctx,
    viewport,
    transform,
  }).promise;

  App.currentPreviewPage = pageIdx;
  updatePreviewNav();

  document.querySelectorAll('.preview-thumb').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === pageIdx);
  });
}

/**
 * Genera le miniature di tutte le pagine e le inserisce nel DOM.
 * @param {PDFDocumentProxy} pdfDoc
 */
async function renderAllThumbnails(pdfDoc) {
  const container = document.getElementById('preview-thumbnails');
  container.innerHTML = '';

  for (let i = 0; i < pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i + 1);
    const dpr  = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: 0.2 * dpr });

    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'preview-thumb' + (i === 0 ? ' active' : '');
    thumbDiv.setAttribute('role', 'listitem');
    thumbDiv.setAttribute('aria-label', `Pagina ${i + 1}`);
    thumbDiv.setAttribute('tabindex', '0');
    thumbDiv.title = `Pagina ${i + 1}`;

    const thumbCanvas         = document.createElement('canvas');
    thumbCanvas.width         = viewport.width;
    thumbCanvas.height        = viewport.height;
    thumbCanvas.style.width   = '100%';
    thumbCanvas.style.height  = '100%';

    const ctx = thumbCanvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    thumbDiv.appendChild(thumbCanvas);
    thumbDiv.addEventListener('click', () => renderPreviewPage(i));
    thumbDiv.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        renderPreviewPage(i);
      }
    });

    container.appendChild(thumbDiv);
  }
}

/**
 * Aggiorna il contatore pagine e lo stato dei bottoni freccia.
 */
function updatePreviewNav() {
  const total   = App.totalPreviewPages;
  const current = App.currentPreviewPage;

  document.getElementById('page-counter').textContent =
    `Pagina ${current + 1} di ${total}`;

  document.getElementById('btn-prev-page').disabled = current <= 0;
  document.getElementById('btn-next-page').disabled = current >= total - 1;
}

/* ══════════════════════════════════════════
   DOWNLOAD PDF
══════════════════════════════════════════ */

/**
 * Scarica il PDF salvato in App.pdfBlob.
 * Usa un blob URL per il download — compatibile con tutti i browser.
 */
function downloadPDF() {
  if (!App.pdfBlob) {
    showToast('Nessun PDF generato. Torna all\'editor e premi "Genera anteprima PDF".', 'error');
    return;
  }

  const name = getPDFName();
  const url  = URL.createObjectURL(App.pdfBlob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoca l'URL dopo il download per liberare memoria
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  showToast(`PDF scaricato: ${name}`, 'success');
}

/* ══════════════════════════════════════════
   CONDIVISIONE — Web Share API
══════════════════════════════════════════ */

/**
 * Condivide il PDF tramite Web Share API (mobile).
 * Visibile solo se navigator.share è disponibile.
 */
async function sharePDF() {
  if (!App.pdfBlob) {
    showToast('Genera prima il PDF', 'error');
    return;
  }

  if (!navigator.share) {
    showToast('Condivisione non supportata su questo browser', 'error');
    return;
  }

  const name = getPDFName();
  const file = new File([App.pdfBlob], name, { type: 'application/pdf' });

  // Verifica che il browser supporti la condivisione di file
  if (navigator.canShare && !navigator.canShare({ files: [file] })) {
    // Fallback: condividi solo il nome senza file
    try {
      await navigator.share({ title: name, text: `Documento PDF: ${name}` });
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast('Errore durante la condivisione', 'error');
      }
    }
    return;
  }

  try {
    await navigator.share({
      title: name,
      files: [file],
    });
    showToast('PDF condiviso con successo', 'success');
  } catch (err) {
    // AbortError = utente ha chiuso il pannello di condivisione → normale
    if (err.name !== 'AbortError') {
      console.error('Share error:', err);
      showToast('Errore durante la condivisione', 'error');
    }
  }
}

/* ══════════════════════════════════════════
   UTILITY NOME FILE
══════════════════════════════════════════ */

/**
 * Legge il nome del PDF dall'input, aggiunge .pdf se manca.
 * @returns {string}
 */
function getPDFName() {
  const input = document.getElementById('input-pdf-name');
  let name    = input?.value?.trim() || `documento_${todayString()}`;

  // Rimuovi caratteri non validi nei nomi file
  name = name.replace(/[/\\?%*:|"<>]/g, '-');

  // Aggiungi estensione se mancante
  if (!name.toLowerCase().endsWith('.pdf')) {
    name += '.pdf';
  }

  return name;
}