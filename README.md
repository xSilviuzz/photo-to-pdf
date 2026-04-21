# 📄 Photo to PDF

App web client-side per convertire foto in PDF direttamente dal browser, senza pubblicità, senza server e senza caricare nulla online.

Sviluppata per uso personale, ottimizzata per mobile e desktop.

---

## ✨ Funzionalità

- 📁 Caricamento multiplo foto (drag & drop o click)
- 🔄 Rotazione libera e in passi da 90°
- ✂️ Ritaglio con rettangolo trascinabile
- 🎨 Correzione colori (luminosità, contrasto, saturazione)
- 🪄 Miglioramento automatico (auto-enhance)
- 📋 Preset: "Documento", "Foto naturale", "Notte"
- 🖤 Modalità Documento (B&N + contrasto alto)
- ↩️ Undo / Redo (frecce + Ctrl+Z / Ctrl+Y)
- 📅 Ordinamento automatico per data scatto (EXIF)
- 📐 Layout pagina: 1, 2 o 4 foto per pagina
- 📄 Orientamento pagina: verticale o orizzontale
- ➕ Aggiunta pagina vuota tra le foto
- 🔍 Anteprima PDF navigabile a slide
- 💾 Nome file personalizzabile
- 📤 Download + Condivisione diretta (WhatsApp, email, ecc.)
- 🔒 Tutto locale — nessun dato lascia il tuo dispositivo

---

## 🛠️ Tecnologie usate

| Libreria | Scopo |
|---|---|
| [jsPDF](https://github.com/parallax/jsPDF) | Generazione PDF |
| [PDF.js](https://mozilla.github.io/pdf.js/) | Anteprima PDF |
| [Exif.js](https://github.com/exif-js/exif-js) | Lettura metadati EXIF |
| Canvas API (nativa) | Manipolazione immagini |
| Web Share API (nativa) | Condivisione mobile |

Nessun framework JS (React, Vue, ecc.) — vanilla JavaScript puro.

---

## 📁 Struttura progetto
photo-to-pdf/
├── index.html # Entry point
├── css/
│ └── style.css # Stili e design system
├── js/
│ ├── app.js # Logica principale e stato
│ ├── editor.js # Rotazione, crop, colori
│ ├── pdf-export.js # Generazione e anteprima PDF
│ ├── exif.js # Lettura metadati EXIF
│ └── session.js # Salvataggio sessione
└── libs/ # Librerie CDN (opzionale copia locale)

---

## 🚀 Come usare

1. Clona o scarica la repo
2. Apri `index.html` nel browser
3. Nessuna installazione, nessun server necessario

```bash
git clone https://github.com/TUO-USERNAME/photo-to-pdf.git
cd photo-to-pdf
# Apri index.html nel browser
```

---

## 📱 Compatibilità

| Browser | Supporto |
|---|---|
| Chrome / Edge (desktop) | ✅ Completo |
| Firefox (desktop) | ✅ Completo |
| Safari (desktop) | ✅ Completo |
| Chrome (Android) | ✅ Completo |
| Safari (iOS) | ✅ (Web Share API supportata) |

---

## 🔮 Sviluppi futuri

- [ ] Esportazione in formato JPEG / PNG
- [ ] Supporto multi-lingua
- [ ] Tema colori personalizzabile

---

## 📝 Licenza

MIT License — libero uso personale e commerciale.