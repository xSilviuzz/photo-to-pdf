'use strict';

function readExifDate(file) {
  return new Promise((resolve) => {
    if (typeof EXIF === 'undefined') { resolve(null); return; }

    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        // Deve essere nel DOM per Exif.js
        img.style.display = 'none';
        document.body.appendChild(img);

        EXIF.getData(img, function() {
          const raw = EXIF.getTag(this, 'DateTimeOriginal')
                   || EXIF.getTag(this, 'DateTime')
                   || null;

          document.body.removeChild(img);

          if (!raw) { resolve(null); return; }

          try {
            const normalized = raw.replace(
              /^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'
            );
            const date = new Date(normalized);
            resolve(isNaN(date.getTime()) ? null : date);
          } catch {
            resolve(null);
          }
        });
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}