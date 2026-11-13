// Trasforma il testo letto nelle zone dello screenshot (vedi regions.js) nei dati della schermata del GE.
// Modulo puro: niente browser, niente Tesseract, così si testa con Node sui risultati salvati.

const ROW_BAND = 0.045; // metà altezza di una riga della classifica, in frazione dell'altezza dello screenshot
const MIN_SCORE = 0.7; // somiglianza minima per accettare il nome di un GE

export function normalize(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const similarity = (a, b) => (a || b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0);

/** Trova il GE più somigliante al testo letto (nome italiano o inglese). null se nessuno è abbastanza simile. */
export function matchGe(rawTitle, geList) {
  const t = normalize(rawTitle);
  let best = null;
  for (const g of geList) {
    const score = Math.max(similarity(t, normalize(g.it)), similarity(t, normalize(g.en)));
    if (!best || score > best.score) best = { key: g.key, score };
  }
  return best && best.score >= MIN_SCORE ? best : null;
}

const union = (boxes) => ({
  x0: Math.min(...boxes.map((b) => b.x0)),
  y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)),
  y1: Math.max(...boxes.map((b) => b.y1)),
});
const centerY = (b) => (b.y0 + b.y1) / 2;
const cleanText = (s) => s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.]+$/u, '').trim();

function parseTitle(lines, geList) {
  const line = [...lines].sort((a, b) => b.conf - a.conf)[0];
  if (!line) return { ge: null, phase: null };
  const [namePart, phasePart = ''] = line.text.split(/\s[-–—]\s/);
  const m = matchGe(namePart, geList);
  const phase = /\boro\b/.test(normalize(phasePart)) ? 'oro' : /\brame\b/.test(normalize(phasePart)) ? 'rame' : null;
  return { ge: m && { ...m, raw: namePart.trim(), bbox: line.bbox }, phase };
}

function parseBar(lines) {
  for (const l of lines) {
    const m = l.text.replace(/\s+/g, '').match(/(\d+)\/(\d+)/);
    if (m) return { done: Number(m[1]), total: Number(m[2]), bbox: l.bbox, conf: l.conf };
  }
  return null;
}

function parseLevel(lines) {
  for (const l of lines) {
    const m = l.text.match(/(\d+)/);
    if (m) {
      const w = l.words.find((x) => x.text.includes(m[1]));
      return { value: Number(m[1]), bbox: w?.bbox ?? l.bbox, conf: w?.conf ?? l.conf };
    }
  }
  return null;
}

function parseRows(listLines, positionLines, height) {
  const band = ROW_BAND * height;
  const lines = listLines
    .map((l) => ({ ...l, clean: cleanText(l.text) }))
    .filter((l) => l.clean.length >= 2);
  const used = new Set();
  const rows = [];

  // righe con "NNN Punti Forge"
  for (const l of lines) {
    const m = l.clean.match(/(\d[\d.]*)\s*Pun/i);
    if (!m) continue;
    used.add(l);
    const before = cleanText(l.clean.slice(0, m.index));
    rows.push({
      fp: Number(m[1].replace(/\./g, '')),
      conf: l.conf,
      parts: before.length >= 2 ? [{ y: l.bbox.y0, text: before }] : [],
      boxes: [l.bbox],
      cy: centerY(l.bbox),
      empty: false,
    });
  }

  // posizioni libere: "Ancora nessun" + "contribuente" sulla riga sotto (se manca, la riga è tagliata: si scarta)
  for (const l of lines) {
    if (used.has(l) || !/(anc\w*\s+n)|nessun/i.test(l.clean)) continue;
    const next = lines.find((x) => !used.has(x) && x !== l && /contri/i.test(x.clean) && x.bbox.y0 > l.bbox.y0 && x.bbox.y0 - l.bbox.y1 < band);
    used.add(l);
    if (!next) continue;
    used.add(next);
    const box = union([l.bbox, next.bbox]);
    rows.push({ fp: 0, conf: 100, parts: [], boxes: [box], cy: centerY(box), empty: true });
  }

  // righe con solo testo: pezzi di nomi andati a capo
  for (const l of lines) {
    if (used.has(l) || /\d/.test(l.clean) && /pun/i.test(l.clean)) continue;
    const row = rows.filter((r) => !r.empty).sort((a, b) => Math.abs(a.cy - centerY(l.bbox)) - Math.abs(b.cy - centerY(l.bbox)))[0];
    if (row && Math.abs(row.cy - centerY(l.bbox)) < band && l.conf >= 50) {
      row.parts.push({ y: l.bbox.y0, text: l.clean });
      row.boxes.push(l.bbox);
    }
  }

  // numeri di posizione: si abbinano alla riga con il centro più vicino
  const positions = positionLines.flatMap((l) => l.words)
    .filter((w) => /^\d{1,2}$/.test(w.text))
    .map((w) => ({ n: Number(w.text), bbox: w.bbox, cy: centerY(w.bbox) }));
  for (const p of positions) {
    const row = [...rows].sort((a, b) => Math.abs(a.cy - p.cy) - Math.abs(b.cy - p.cy))[0];
    if (row && Math.abs(row.cy - p.cy) < band && row.position == null) {
      row.position = p.n;
      row.boxes.push(p.bbox);
    }
  }

  const result = rows
    .filter((r) => !(r.empty && r.position == null)) // una posizione libera senza numero non ha senso
    .sort((a, b) => a.cy - b.cy)
    .map((r) => ({
      position: r.position ?? null,
      name: r.parts.sort((a, b) => a.y - b.y).map((p) => p.text).join(' '),
      fp: r.fp,
      isOwner: r.position == null,
      isMe: false,
      bbox: union(r.boxes),
      conf: r.conf,
      uncertain: r.conf < 80,
    }));

  // controllo di coerenza: la classifica deve essere in ordine decrescente
  const ranked = result.filter((r) => !r.isOwner).sort((a, b) => a.position - b.position);
  ranked.forEach((r, i) => {
    if (i > 0 && (r.fp > ranked[i - 1].fp || r.position === ranked[i - 1].position)) r.uncertain = true;
  });
  return result;
}

/** raw = risultato di readRegions(); geList = listGe(data). */
export function parseScreen(raw, geList) {
  const { ge, phase } = parseTitle(raw.title ?? [], geList);
  const bar = parseBar(raw.bar ?? []);
  if (!ge && !bar) {
    return { error: 'Non riconosco la finestra di un GE in questo screenshot.', ge: null, level: null, bar: null, rows: [] };
  }
  if (phase === 'oro') {
    return { error: 'Questo GE è in fase Oro: per ora l\'app gestisce solo la fase Rame.', ge, level: null, bar, rows: [] };
  }
  return {
    ge,
    level: parseLevel(raw.level ?? []),
    bar,
    rows: parseRows(raw.list ?? [], raw.positions ?? [], raw.height),
  };
}

/** Unisce 1-2 screenshot dello stesso GE (es. classifica scorsa). */
export function mergeScreens(screens) {
  const failed = screens.find((s) => s.error);
  if (failed) return failed;
  const [first, ...rest] = screens;
  for (const s of rest) {
    const sameGe = !first.ge || !s.ge || first.ge.key === s.ge.key;
    const sameBar = !first.bar || !s.bar || (first.bar.done === s.bar.done && first.bar.total === s.bar.total);
    if (!sameGe || !sameBar) {
      return { error: 'Gli screenshot non sono dello stesso GE (o il GE è cambiato tra uno e l\'altro).', ge: null, level: null, bar: null, rows: [] };
    }
  }
  const key = (r) => (r.position != null ? `p${r.position}` : `o${r.name}|${r.fp}`);
  const seen = new Set();
  const rows = [];
  for (const s of screens) {
    for (const r of s.rows) {
      if (seen.has(key(r))) continue;
      seen.add(key(r));
      rows.push(r);
    }
  }
  return {
    ge: screens.find((s) => s.ge)?.ge ?? null,
    level: screens.find((s) => s.level)?.level ?? null,
    bar: screens.find((s) => s.bar)?.bar ?? null,
    rows,
  };
}

/** Segna come "io" la riga il cui nome è ESATTAMENTE il nome utente (maiuscole escluse). */
export function markMe(rows, username) {
  const u = (username ?? '').trim().toLowerCase();
  return rows.map((r) => ({ ...r, isMe: !!u && !r.isOwner && (r.name ?? '').trim().toLowerCase() === u }));
}
