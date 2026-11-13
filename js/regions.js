// Zone della finestra del GE da leggere, in frazioni dello screenshot (layout fisso del gioco
// su telefono in orizzontale), e pre-trattamento per il lettore di testo.
// Funziona su un'immagine RGBA grezza { data, width, height }, quindi gira uguale nel browser e in Node.

export const REGIONS = {
  // testo chiaro su fondo scuro → mode 'bright'
  title: { x0: 0.25, y0: 0.025, x1: 0.75, y1: 0.105, mode: 'bright', scale: 1.5, psm: '7' },
  bar: { x0: 0.38, y0: 0.29, x1: 0.62, y1: 0.345, mode: 'bright', scale: 2, psm: '7', whitelist: '0123456789/' },
  // testo scuro su fondo dorato → mode 'dark'
  level: { x0: 0.26, y0: 0.335, x1: 0.36, y1: 0.385, mode: 'dark', scale: 2, psm: '7' },
  list: { x0: 0.335, y0: 0.555, x1: 0.585, y1: 0.97, mode: 'bright', scale: 2, psm: '6' },
  positions: { x0: 0.245, y0: 0.555, x1: 0.295, y1: 0.97, mode: 'bright', scale: 2, psm: '6', whitelist: '0123456789' },
};

const THRESHOLD = { bright: 150, dark: 110 };

/** Rettangolo in pixel di una zona. */
export function regionRect(region, width, height) {
  const x = Math.round(region.x0 * width);
  const y = Math.round(region.y0 * height);
  return { x, y, w: Math.round(region.x1 * width) - x, h: Math.round(region.y1 * height) - y };
}

/**
 * Ritaglia la zona, la ingrandisce e la rende in bianco e nero con il testo NERO su fondo bianco.
 * Restituisce { data, width, height, rect, scale } dove rect è la zona nell'immagine originale.
 */
export function prepRegion(img, region) {
  const rect = regionRect(region, img.width, img.height);
  const s = region.scale;
  const W = Math.round(rect.w * s);
  const H = Math.round(rect.h * s);
  const out = new Uint8ClampedArray(W * H * 4);
  const thr = THRESHOLD[region.mode];
  for (let Y = 0; Y < H; Y++) {
    const sy = Math.min(img.height - 1, rect.y + Math.floor(Y / s));
    for (let X = 0; X < W; X++) {
      const sx = Math.min(img.width - 1, rect.x + Math.floor(X / s));
      const i = (sy * img.width + sx) * 4;
      const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      const isText = region.mode === 'bright' ? lum > thr : lum < thr;
      const v = isText ? 0 : 255;
      const o = (Y * W + X) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H, rect, scale: s };
}

/** Riporta un riquadro letto nella zona ingrandita alle coordinate dello screenshot originale. */
export function toOriginal(bbox, prepped) {
  const { rect, scale } = prepped;
  return {
    x0: Math.round(rect.x + bbox.x0 / scale),
    y0: Math.round(rect.y + bbox.y0 / scale),
    x1: Math.round(rect.x + bbox.x1 / scale),
    y1: Math.round(rect.y + bbox.y1 / scale),
  };
}

/**
 * Legge tutte le zone con un worker Tesseract già creato.
 * toInput(prepped) converte l'immagine pre-trattata in qualcosa che Tesseract accetta
 * (canvas nel browser, buffer PNG in Node).
 * Restituisce le righe lette per zona, con riquadri nelle coordinate originali.
 */
export async function readRegions(worker, img, toInput) {
  const raw = { width: img.width, height: img.height };
  for (const [name, region] of Object.entries(REGIONS)) {
    const prepped = prepRegion(img, region);
    await worker.setParameters({
      tessedit_pageseg_mode: region.psm,
      tessedit_char_whitelist: region.whitelist ?? '',
    });
    const { data } = await worker.recognize(await toInput(prepped), {}, { blocks: true, text: true });
    const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    raw[name] = lines.map((l) => ({
      text: l.text.trim(),
      conf: Math.round(l.confidence),
      bbox: toOriginal(l.bbox, prepped),
      words: l.words.map((w) => ({ text: w.text, conf: Math.round(w.confidence), bbox: toOriginal(w.bbox, prepped) })),
    }));
  }
  return raw;
}
