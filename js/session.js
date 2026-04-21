/* ============================================================
   session.js — Salvataggio e ripristino sessione
   Usa sessionStorage per sopravvivere a ricariche accidentali.
   NON usa localStorage (bloccato in iframe sandbox).
   ============================================================ */

'use strict';

const SESSION_KEY = 'photo_to_pdf_session';

/**
 * Salva lo stato corrente di App.photos in sessionStorage.
 * Le immagini (data URL) vengono salvate — attenzione al limite
 * di ~5MB di sessionStorage. Per file grandi potrebbe fallire
 * silenziosamente: gestiamo l'errore senza bloccare l'app.
 */
function saveSession() {
  try {
    const payload = {
      photos: App.photos.map(p => ({
        id:          p.id,
        originalSrc: p.originalSrc,
        currentSrc:  p.currentSrc,
        name:        p.name,
        exifDate:    p.exifDate ? p.exifDate.toISOString() : null,
        isBlank:     p.isBlank,
        history:     p.history,
        historyIdx:  p.historyIdx,
        adjustments: p.adjustments,
      })),
      pdfLayout:      App.pdfLayout,
      pdfOrientation: App.pdfOrientation,
      pdfName:        document.getElementById('input-pdf-name')?.value ?? '',
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch (err) {
    // Quota superata (foto troppo grandi) — ignora silenziosamente
    console.warn('sessionStorage: impossibile salvare la sessione.', err.message);
  }
}

/**
 * Ripristina App.photos e le impostazioni PDF da sessionStorage.
 * Chiamata una volta sola all'avvio in app.js → DOMContentLoaded.
 */
function restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;

    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.photos)) return;

    // Ricostruisce gli oggetti foto (il campo `file` non è serializzabile,
    // viene lasciato null — non serve dopo il caricamento iniziale)
    App.photos = payload.photos.map(p => ({
      id:          p.id,
      file:        null,
      originalSrc: p.originalSrc,
      currentSrc:  p.currentSrc,
      name:        p.name,
      exifDate:    p.exifDate ? new Date(p.exifDate) : null,
      isBlank:     p.isBlank ?? false,
      history:     p.history   ?? [p.currentSrc],
      historyIdx:  p.historyIdx ?? 0,
      adjustments: p.adjustments ?? {
        brightness: 0,
        contrast:   0,
        saturation: 0,
        docMode:    false,
        watermark:  '',
      },
    }));

    // Ripristina impostazioni PDF
    if (payload.pdfLayout) {
      App.pdfLayout = payload.pdfLayout;
      const sel = document.getElementById('select-layout');
      if (sel) sel.value = payload.pdfLayout;
    }

    if (payload.pdfOrientation) {
      App.pdfOrientation = payload.pdfOrientation;
      const sel = document.getElementById('select-orientation');
      if (sel) sel.value = payload.pdfOrientation;
    }

    if (payload.pdfName) {
      const input = document.getElementById('input-pdf-name');
      if (input) input.value = payload.pdfName;
    }

  } catch (err) {
    // Sessione corrotta → ignora e riparte da zero
    console.warn('sessionStorage: sessione non valida, riparto da zero.', err.message);
    sessionStorage.removeItem(SESSION_KEY);
  }
}

/**
 * Cancella la sessione salvata.
 * Chiamala se vuoi aggiungere in futuro un bottone "Nuova sessione".
 */
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}