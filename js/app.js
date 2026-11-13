// Collega l'interfaccia ai moduli di calcolo, dati e lettura.
import { loadData, getLevel, arcPct, listGe } from './data.js';
import { evaluate, rankingIssues, checkContributions } from './calc.js';
import { parseScreen, mergeScreens, markMe } from './parse-screen.js';
import { getSettings, saveSettings } from './settings.js';
// importato subito (non al primo uso): dopo un aggiornamento non si mescolano file vecchi e nuovi
import { readImage, getWorker, cropToDataUrl } from './ocr.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['home', 'busy', 'data', 'results'];
const MAX_LEVEL = 100;

const state = {
  data: null,
  geList: [],
  settings: getSettings(),
  bitmaps: [],
  form: null, // { mode, geKey, level, done, totalRead, crops, rows }
  override: false,
};

// ---------- navigazione ----------
function show(view) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  $('btn-back').hidden = !(view === 'data' || view === 'results');
  state.view = view;
  window.scrollTo(0, 0);
}

$('btn-back').addEventListener('click', () => show(state.view === 'results' ? 'data' : 'home'));

// ---------- impostazioni ----------
const fmtPct = (p) => `+${Math.round(p * 100)}%`;

function renderHomeArc() {
  const { arcLevel } = state.settings;
  const pct = arcLevel ? arcPct(state.data, arcLevel) : null;
  $('home-arc').innerHTML = pct != null
    ? `Arca al livello ${arcLevel}: premi ${fmtPct(pct)}. <button class="link" data-open-settings>Cambia</button>`
    : `Imposta il livello della tua Arca per calcolare i premi. <button class="link" data-open-settings>Imposta</button>`;
}

function openSettings() {
  $('arc-input').value = state.settings.arcLevel ?? '';
  $('user-input').value = state.settings.username;
  updateArcPreview();
  $('dlg-settings').returnValue = ''; // il tasto Indietro di Android chiude senza salvare
  $('dlg-settings').showModal();
}

function updateArcPreview() {
  const lvl = Number($('arc-input').value);
  const pct = Number.isInteger(lvl) ? arcPct(state.data, lvl) : null;
  $('arc-pct').textContent = pct != null ? `Bonus sui premi: ${fmtPct(pct)}` : 'Scrivi un livello da 1 a 200.';
}

$('btn-settings').addEventListener('click', openSettings);
document.addEventListener('click', (e) => { if (e.target.closest('[data-open-settings]')) openSettings(); });
$('arc-input').addEventListener('input', updateArcPreview);
$('dlg-settings').addEventListener('close', () => {
  if ($('dlg-settings').returnValue !== 'save') return;
  const lvl = Number($('arc-input').value);
  const oldUser = state.settings.username;
  state.settings = saveSettings({
    arcLevel: arcPct(state.data, lvl) != null ? lvl : state.settings.arcLevel,
    username: $('user-input').value.trim(),
  });
  renderHomeArc();
  if (state.form) {
    // la stella messa a mano resta: si ricalcola solo se è cambiato il nome, e solo per gli screenshot
    if (state.form.mode === 'shot' && state.settings.username !== oldUser) {
      state.form.rows = markMe(state.form.rows, state.settings.username);
    }
    if (state.view === 'data') renderData();
    if (state.view === 'results') renderResults();
  }
});

// ---------- lettura screenshot ----------
$('file-input').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) handleFiles(files);
});

function homeError(msg) {
  $('home-error').textContent = msg;
  $('home-error').hidden = !msg;
}

export async function handleFiles(files) {
  homeError('');
  const chosen = files.slice(0, 2);
  show('busy');
  try {
    $('busy-text').textContent = 'Preparo il lettore di testo…';
    await getWorker();
    const screens = [];
    state.bitmaps = [];
    for (const [i, f] of chosen.entries()) {
      $('busy-text').textContent = chosen.length > 1 ? `Leggo lo screenshot ${i + 1} di ${chosen.length}…` : 'Leggo lo screenshot…';
      const { raw, bitmap } = await readImage(f);
      state.bitmaps.push(bitmap);
      const s = parseScreen(raw, state.geList);
      for (const part of [s.ge, s.level, s.bar, ...s.rows]) if (part) part.img = i;
      screens.push(s);
    }
    const merged = mergeScreens(screens);
    if (merged.error) throw new Error(merged.error);
    await startShotForm(merged, files.length > 2 ? 'Ho usato solo i primi due screenshot.' : null);
  } catch (err) {
    show('home');
    homeError(err.message || 'Non sono riuscito a leggere lo screenshot.');
  }
}

async function cropOf(part) {
  if (!part?.bbox || part.img == null) return null;
  return cropToDataUrl(state.bitmaps[part.img], part.bbox);
}

async function startShotForm(m, notice = null) {
  const rows = await Promise.all(m.rows.map(async (r) => ({ ...r, crop: await cropOf(r) })));
  state.form = {
    mode: 'shot',
    geKey: m.ge?.key ?? '',
    level: m.level?.value ?? '',
    done: m.bar?.done ?? '',
    totalRead: m.bar?.total ?? null,
    crops: { title: await cropOf(m.ge), level: await cropOf(m.level), bar: await cropOf(m.bar) },
    rows: markMe(rows, state.settings.username),
    unsure: { level: (m.level?.conf ?? 0) < 80, done: (m.bar?.conf ?? 0) < 80 },
    notice,
  };
  state.override = false;
  renderData();
  show('data');
}

// ---------- inserimento manuale ----------
function rewardedPositions(geKey, level) {
  const lv = geKey && level !== '' ? getLevel(state.data, geKey, Number(level) + 1) : null;
  return lv ? Math.max(1, lv.fp.filter((x) => x > 0).length) : 5;
}

function manualRows(geKey, level, previous = []) {
  const n = rewardedPositions(geKey, level);
  return Array.from({ length: n }, (_, i) => {
    const old = previous.find((r) => r.position === i + 1);
    return old ?? { position: i + 1, name: '', fp: '', isOwner: false, isMe: false, crop: null, uncertain: false };
  });
}

$('btn-manual').addEventListener('click', () => {
  state.form = { mode: 'manual', geKey: '', level: '', done: '', totalRead: null, crops: {}, rows: manualRows('', ''), unsure: {} };
  state.override = false;
  renderData();
  show('data');
});

// ---------- schermata dati ----------
const toInt = (v) => (v === '' || v == null ? 0 : Number(v));

function expectedCost(f) {
  if (!f.geKey || f.level === '') return null;
  return getLevel(state.data, f.geKey, Number(f.level) + 1)?.cost ?? null;
}

function setCrop(id, src) {
  $(id).hidden = !src;
  if (src) $(id).src = src;
}

function renderData() {
  const f = state.form;
  $('data-title').textContent = f.mode === 'manual' ? 'Inserisci i dati' : 'Controlla i dati';
  $('ge-select').innerHTML = `<option value="">Scegli…</option>` +
    state.geList.map((g) => `<option value="${g.key}"${g.key === f.geKey ? ' selected' : ''}>${g.it}</option>`).join('');
  $('level-input').value = f.level;
  $('done-input').value = f.done;
  $('level-input').classList.toggle('unsure', !!f.unsure.level);
  $('done-input').classList.toggle('unsure', !!f.unsure.done);
  setCrop('crop-title', f.crops.title);
  setCrop('crop-level', f.crops.level);
  setCrop('crop-bar', f.crops.bar);
  $('rows-hint').hidden = false;
  renderRows();
  renderCheck();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderRows() {
  const f = state.form;
  $('rows').innerHTML = f.rows.map((r, i) => {
    const cls = ['row', r.uncertain ? 'uncertain' : '', r.isMe ? 'me' : ''].join(' ');
    const pos = f.mode === 'manual' ? `<span class="pos">${r.position}</span>`
      : `<input class="pos" type="number" inputmode="numeric" min="1" max="99" data-pos="${i}" value="${r.isOwner ? '' : r.position}" placeholder="♛" aria-label="Posizione (vuoto = proprietario)">`;
    const name = r.isOwner ? `${escapeHtml(r.name || 'Proprietario')} <small>(proprietario)</small>`
      : r.name ? escapeHtml(r.name) : (f.mode === 'manual' ? `Posizione ${r.position}` : 'Libera');
    const nameCls = r.name || r.isOwner ? 'name' : 'name empty';
    const conflict = r.conflictFp != null ? ` <small>(nell'altro screenshot: ${r.conflictFp})</small>` : '';
    const star = r.isOwner ? '<span></span>'
      : `<button class="star" data-me="${i}" aria-label="Questa riga sono io" aria-pressed="${r.isMe}">${r.isMe ? '★' : '☆'}</button>`;
    return `<li class="${cls}">
      ${pos}
      <span class="who"><span class="${nameCls}">${name}${conflict}</span>${r.crop ? `<img class="crop" src="${r.crop}" alt="Riga letta nello screenshot">` : ''}</span>
      <input type="number" inputmode="numeric" min="0" data-fp="${i}" value="${r.fp}" aria-label="PF di ${escapeHtml(r.name || 'posizione ' + r.position)}" placeholder="0">
      ${star}
    </li>`;
  }).join('');
}

function renderCheck() {
  const f = state.form;
  const exp = expectedCost(f);
  const check = $('total-check');
  let ok = false;
  let showOverride = false;
  check.className = 'check';
  if (!f.geKey || f.level === '') {
    check.textContent = 'Scegli il GE e scrivi il livello attuale.';
  } else if (Number(f.level) + 1 > MAX_LEVEL) {
    check.className = 'check bad';
    check.textContent = `Livello ${Number(f.level) + 1}: è la fase Oro, per ora fuori portata.`;
  } else if (exp == null) {
    check.className = 'check bad';
    check.textContent = 'Livello non valido.';
  } else if (f.done !== '' && (!Number.isInteger(Number(f.done)) || Number(f.done) < 0)) {
    check.className = 'check bad';
    check.textContent = 'I PF già versati devono essere un numero intero, senza virgole.';
  } else if (f.done === '') {
    check.className = 'check bad';
    check.textContent = f.mode === 'shot'
      ? 'Barra non letta: scrivi i PF già versati (il numero prima della / nella barra verde).'
      : 'Scrivi i PF già versati (il numero prima della / nella barra verde).';
  } else {
    const remaining = exp - Number(f.done);
    const good = []; // conferme
    const problems = []; // dati che non tornano: servono correzione o conferma esplicita
    const notes = []; // avvisi che non bloccano
    if (remaining < 0) {
      problems.push(`I PF versati (${f.done}) superano il costo del livello (${exp}): controlla GE, livello e PF versati.`);
    } else if (f.mode === 'manual') {
      good.push(`Costo del livello ${Number(f.level) + 1}: ${exp} PF. Mancano ${remaining} PF alla chiusura.`);
    } else if (f.totalRead == null) {
      problems.push(`Non ho letto il totale nella barra, quindi non posso verificare GE e livello. Il file prevede ${exp} PF: controllali tu.`);
    } else if (f.totalRead !== exp) {
      problems.push(`Lo screenshot dice ${f.totalRead} PF totali, il file ne prevede ${exp} per questo livello: controlla GE e livello.`);
    } else {
      good.push(`✓ Il totale ${exp} coincide con il file. Mancano ${remaining} PF alla chiusura.`);
    }
    problems.push(...rankingIssues(f.rows.map((r) => ({ ...r, fp: toInt(r.fp) }))));
    if (f.mode === 'shot' && remaining >= 0) {
      const c = checkContributions(Number(f.done), f.rows.map((r) => ({ ...r, fp: toInt(r.fp) })));
      if (c.status === 'complete') good.push(`✓ La classifica torna con la barra (${c.sum} PF).`);
      else if (c.status === 'partial') notes.push(`Non vedo tutta la classifica (visibili ${c.sum} PF su ${c.done}): le posizioni sotto l'ultima riga non si possono verificare.`);
      else problems.push(`La somma dei PF in classifica (${c.sum}) non torna con i PF versati (${c.done}): c'è un numero letto male. Controlla le righe e la barra.`);
    }
    if (f.notice) notes.push(f.notice);
    if (f.unsure.level || f.unsure.done) notes.push('Lettura incerta di livello o PF versati: controllali con il ritaglio.');
    check.className = problems.length ? 'check bad' : 'check ok';
    check.innerHTML = [...problems, ...notes, ...good].map((t) => `<span class="check-line">${escapeHtml(t)}</span>`).join('');
    ok = remaining >= 0 && (problems.length === 0 || state.override);
    showOverride = problems.length > 0 && remaining >= 0;
  }
  $('override-wrap').hidden = !showOverride;
  if (!showOverride) state.override = false;
  $('override').checked = state.override;
  $('btn-calc').disabled = !ok;
}

$('ge-select').addEventListener('change', (e) => {
  state.form.geKey = e.target.value;
  if (state.form.mode === 'manual') { state.form.rows = manualRows(state.form.geKey, state.form.level, state.form.rows); renderRows(); }
  renderCheck();
});
$('level-input').addEventListener('input', (e) => {
  state.form.level = e.target.value === '' ? '' : Number(e.target.value);
  if (state.form.mode === 'manual') { state.form.rows = manualRows(state.form.geKey, state.form.level, state.form.rows); renderRows(); }
  renderCheck();
});
$('done-input').addEventListener('input', (e) => { state.form.done = e.target.value === '' ? '' : Number(e.target.value); renderCheck(); });
$('override').addEventListener('change', (e) => { state.override = e.target.checked; renderCheck(); });

$('rows').addEventListener('input', (e) => {
  const i = e.target.dataset.fp;
  if (i == null) return;
  state.form.rows[i].fp = e.target.value === '' ? '' : Number(e.target.value);
  state.form.rows[i].uncertain = false;
  e.target.closest('.row').classList.remove('uncertain');
  renderCheck();
});
// numero di posizione corretto a mano: vuoto = proprietario
$('rows').addEventListener('change', (e) => {
  const i = e.target.dataset.pos;
  if (i == null) return;
  const row = state.form.rows[i];
  const v = e.target.value.trim();
  row.position = v === '' ? null : Number(v);
  row.isOwner = v === '';
  if (row.isOwner) row.isMe = false;
  renderRows();
  renderCheck();
});
$('rows').addEventListener('click', (e) => {
  const star = e.target.closest('[data-me]');
  if (star) {
    const i = Number(star.dataset.me);
    const wasMe = state.form.rows[i].isMe;
    state.form.rows.forEach((r, j) => { r.isMe = j === i && !wasMe; });
    renderRows();
    renderCheck();
    return;
  }
  const crop = e.target.closest('.crop');
  if (crop) zoom(crop.src);
});
for (const id of ['crop-title', 'crop-level', 'crop-bar']) $(id).addEventListener('click', (e) => { e.preventDefault(); zoom(e.target.src); });

function zoom(src) {
  $('zoom-img').src = src;
  $('dlg-zoom').showModal();
}

// ---------- calcolo e risultati ----------
$('btn-calc').addEventListener('click', () => {
  if (state.settings.arcLevel == null) { openSettings(); return; }
  renderResults();
  show('results');
});

function signed(n) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

function renderResults() {
  const f = state.form;
  const g = state.data.ge[f.geKey];
  const lv = getLevel(state.data, f.geKey, Number(f.level) + 1);
  const pct = arcPct(state.data, state.settings.arcLevel) ?? 0;
  const remaining = lv.cost - toInt(f.done);
  const positions = f.mode === 'manual'
    ? f.rows.map((r) => r.position)
    : [...new Set(f.rows.filter((r) => !r.isOwner && r.position != null).map((r) => r.position))].sort((a, b) => a - b);
  const res = evaluate({
    remaining,
    arcPct: pct,
    positions,
    rewards: lv.fp,
    contributors: f.rows.map((r) => ({
      name: r.name, fp: toInt(r.fp), isOwner: r.isOwner, isMe: r.isMe, position: r.isOwner ? null : r.position,
    })),
  });

  $('res-title').textContent = `${g.it}, livello ${Number(f.level)} → ${Number(f.level) + 1}`;
  $('res-meta').textContent = `Mancano ${remaining} PF. Arca livello ${state.settings.arcLevel}: premi ${fmtPct(pct)}.`;

  $('res-override').hidden = !state.override;
  const cur = $('res-current');
  cur.hidden = !res.current;
  if (res.current) {
    cur.textContent = `Ora sei in P${res.current.position} con ${res.current.fp} PF: ` +
      (res.current.safe === true ? 'posizione già sicura.'
        : res.current.safe === false ? 'non è sicura, ti possono superare.'
          : `non so se è sicura: serve vedere anche P${res.current.position + 1}.`);
  }

  if (res.error) {
    $('results').innerHTML = `<li class="error">${escapeHtml(res.error)}</li>`;
    return;
  }

  const me = !!res.current;
  $('results').innerHTML = res.rows.map((r) => {
    const p = `<span class="p">P${r.position}</span>`;
    if (r.reward === 0) {
      return `<li class="res off"><div class="res-main">${p}<span class="why">Nessun premio PF per questa posizione</span></div></li>`;
    }
    if (r.aboveCurrent) {
      return `<li class="res off"><div class="res-main">${p}<span class="why">Sei già più in alto</span></div></li>`;
    }
    if (r.unknown) {
      return `<li class="res off unknown"><div class="res-main">${p}<span class="why">Non calcolabile: serve vedere chi è in P${r.needPosition}. Fai uno screenshot che la mostri.</span></div></li>`;
    }
    if (!r.lockable) {
      return `<li class="res off"><div class="res-main">${p}<span class="why">Non bloccabile: ${me ? 'dovresti aggiungere' : 'servono'} ${r.add} PF, ne mancano solo ${remaining}</span></div></li>`;
    }
    const cls = r.balanceTotal > 0 ? 'pos' : r.balanceTotal < 0 ? 'neg' : 'zero';
    const notes = [];
    if (r.alreadySafe) notes.push('Sei già al sicuro qui: non serve versare altro.');
    if (r.mayEndAt) notes.push(`Potresti salire in P${r.mayEndAt}, ma non è garantito.`);
    if (r.balanceVsStay != null) notes.push(`Rispetto a restare in P${res.current.position}: ${signed(r.balanceVsStay)} PF.`);
    if (me && !r.alreadySafe) notes.push(`Saldo calcolato su tutti i tuoi PF (${res.current.fp} già versati + ${r.add}).`);
    return `<li class="res ${cls}">
      <div class="res-main">
        ${p}
        <span class="num">${r.add}<small>${me ? 'da aggiungere' : 'da versare'}</small></span>
        <span class="num">${r.rewardArc}<small>base ${r.reward}</small></span>
        <span class="num saldo">${signed(r.balanceTotal)}</span>
      </div>
      ${notes.map((n) => `<p class="note">${n}</p>`).join('')}
    </li>`;
  }).join('');
}

$('btn-edit').addEventListener('click', () => show('data'));
$('btn-new').addEventListener('click', () => {
  if (state.reloadPending) { location.reload(); return; }
  state.form = null;
  show('home');
});

// ---------- avvio ----------
async function init() {
  try {
    state.data = await loadData();
  } catch (err) {
    homeError(err.message);
    return;
  }
  state.geList = listGe(state.data);
  renderHomeArc();
  show('home');
  registerServiceWorker();
  const shared = await takeSharedFiles();
  if (state.settings.arcLevel == null) openSettings();
  if (shared.length) handleFiles(shared);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* senza service worker l'app funziona solo online */ });
  // è arrivata una versione nuova: ricarico, ma solo dalla home per non perdere i dati che stai controllando
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // prima installazione: niente da ricaricare
    if (state.view === 'home') location.reload();
    else state.reloadPending = true;
  });
}

/** Screenshot arrivati dal menu Condividi: il service worker li ha messi da parte, qui li riprendo e li cancello. */
async function takeSharedFiles() {
  if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return [];
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('calc-ge-shared');
    const files = [];
    const keys = (await cache.keys()).sort((a, b) => Number(a.url.split("/").pop()) - Number(b.url.split("/").pop()));
    for (const req of keys) {
      const res = await cache.match(req);
      const blob = await res.blob();
      files.push(new File([blob], `condiviso-${files.length + 1}.png`, { type: blob.type || 'image/png' }));
      await cache.delete(req);
    }
    return files;
  } catch {
    homeError('Non sono riuscito a ricevere lo screenshot condiviso: sceglilo con il pulsante qui sotto.');
    return [];
  }
}

init();
