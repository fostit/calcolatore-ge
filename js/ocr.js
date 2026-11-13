// Lettura degli screenshot nel browser, tutta offline: Tesseract e la lingua italiana sono dentro l'app.
import { readRegions } from './regions.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (globalThis.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Impossibile caricare il lettore di testo'));
    document.head.appendChild(s);
  });
}

/** Il worker si crea una volta sola e si riusa (la prima creazione richiede qualche secondo). */
export function getWorker() {
  workerPromise ??= (async () => {
    await loadScript(BASE + 'tesseract.min.js');
    return globalThis.Tesseract.createWorker('ita', 1, {
      workerPath: BASE + 'worker.min.js',
      corePath: BASE,
      langPath: BASE.replace(/\/$/, ''),
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: false,
    });
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

function toCanvas(prepped) {
  const c = document.createElement('canvas');
  c.width = prepped.width;
  c.height = prepped.height;
  c.getContext('2d').putImageData(new ImageData(prepped.data, prepped.width, prepped.height), 0, 0);
  return c;
}

/** Legge uno screenshot (File o Blob). Restituisce il testo per zona e l'immagine per i ritagli. */
export async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const worker = await getWorker();
  const raw = await readRegions(worker, img, toCanvas);
  return { raw, width: bitmap.width, height: bitmap.height, bitmap };
}

/** Ritaglio di una zona dello screenshot, per mostrarlo accanto al dato letto. */
export function cropToDataUrl(bitmap, bbox, pad = 6) {
  const x = Math.max(0, bbox.x0 - pad);
  const y = Math.max(0, bbox.y0 - pad);
  const w = Math.min(bitmap.width, bbox.x1 + pad) - x;
  const h = Math.min(bitmap.height, bbox.y1 + pad) - y;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.85);
}
