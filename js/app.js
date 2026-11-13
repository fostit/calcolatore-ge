// Collega l'interfaccia ai moduli di calcolo, dati e lettura.
import { loadData, getLevel, arcPct, listGe } from './data.js';
import { evaluate } from './calc.js';
import { parseScreen, mergeScreens, markMe } from './parse-screen.js';
import { getSettings, saveSettings } from './settings.js';

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
  state.settings = saveSettings({
    arcLevel: arcPct(state.data, lvl) != null ? lvl : state.settings.arcLevel,
    username: $('user-input').value.trim(),
  });
  renderHomeArc();
  if (state.form) {
    state.form.rows = markMe(state.form.rows, state.settings.username);
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
    const { readImage, getWorker } = await import('./ocr.js');
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
    startShotForm(merged);
  } catch (err) {
    show('home');
    homeError(err.message || 'Non sono riuscito a leggere lo screenshot.');
  }
  if (files.length > 2) homeError('Ho usato solo i primi due screenshot.');
}

async function cropOf(part) {
  if (!part?.bbox || part.img == null) return null;
  const { cropToDataUrl } = await import('./ocr.js');
  return cropToDataUrl(state.bitmaps[part.img], part.bbox);
}

async function startShotForm(m) {
  const rows = await Promise.all(m.rows.map(async (r) => ({ ...r, crop: await cropOf(r) })));
  state.form = {
    mode: 'shot',
    geKey: m.ge?.key ?? '',
    level: m.level?.value ?? '',
    done: m.bar?.done ?? '',
    totalRead: m.bar?.total ?? null,
    crops: { title: await cropOf(m.ge), level: await cropOf(m.level), bar: await cropOf(m.bar) },
    rows: markMe(rows, state.settings.username),
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
  state.form = { mode: 'manual', geKey: '', level: '', done: '', totalRead: null, crops: {}, rows: manualRows('', '') };
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
    const pos = r.isOwner ? '<span title="Proprietario">♛</span>' : r.position;
    const name = r.isOwner ? `${escapeHtml(r.name || 'Proprietario')} <small>(proprietario)</small>`
      : r.name ? escapeHtml(r.name) : (f.mode === 'manual' ? `Posizione ${r.position}` : 'Libera');
    const nameCls = r.name || r.isOwner ? 'name' : 'name empty';
    const star = r.isOwner ? '<span></span>'
      : `<button class="star" data-me="${i}" aria-label="Questa riga sono io" aria-pressed="${r.isMe}">${r.isMe ? '★' : '☆'}</button>`;
    return `<li class="${cls}">
      <span class="pos">${pos}</span>
      <span class="who"><span class="${nameCls}">${name}</span>${r.crop ? `<img class="crop" src="${r.crop}" alt="Riga letta nello screenshot">` : ''}</span>
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
  check.className = 'check';
  if (!f.geKey || f.level === '') {
    check.textContent = 'Scegli il GE e scrivi il livello attuale.';
  } else if (Number(f.level) + 1 > MAX_LEVEL) {
    check.className = 'check bad';
    check.textContent = `Livello ${Number(f.level) + 1}: è la fase Oro, per ora fuori portata.`;
  } else if (exp == null) {
    check.className = 'check bad';
    check.textContent = 'Livello non valido.';
  } else {
    const remaining = exp - toInt(f.done);
    const tail = remaining >= 0 ? `Mancano ${remaining} PF alla chiusura.` : 'I PF versati superano il costo: controlla i numeri.';
    if (f.mode === 'manual' || f.totalRead == null) {
      check.className = remaining >= 0 ? 'check ok' : 'check bad';
      check.textContent = `Costo del livello ${Number(f.level) + 1}: ${exp} PF. ${tail}`;
      ok = remaining >= 0;
    } else if (f.totalRead === exp) {
      check.className = remaining >= 0 ? 'check ok' : 'check bad';
      check.textContent = `✓ Il totale ${exp} coincide con il file. ${tail}`;
      ok = remaining >= 0;
    } else {
      check.className = 'check bad';
      check.textContent = `Lo screenshot dice ${f.totalRead} PF totali, il file ne prevede ${exp} per questo livello: controlla GE e livello.`;
      ok = state.override && remaining >= 0;
    }
  }
  $('override-wrap').hidden = !(f.mode === 'shot' && f.totalRead != null && exp != null && f.totalRead !== exp);
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
});
$('rows').addEventListener('click', (e) => {
  const star = e.target.closest('[data-me]');
  if (star) {
    const i = Number(star.dataset.me);
    const wasMe = state.form.rows[i].isMe;
    state.form.rows.forEach((r, j) => { r.isMe = j === i && !wasMe; });
    renderRows();
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
    contributors: f.rows.map((r) => ({ name: r.name, fp: toInt(r.fp), isOwner: r.isOwner, isMe: r.isMe })),
  });

  $('res-title').textContent = `${g.it}, livello ${Number(f.level)} → ${Number(f.level) + 1}`;
  $('res-meta').textContent = `Mancano ${remaining} PF. Arca livello ${state.settings.arcLevel}: premi ${fmtPct(pct)}.`;

  const cur = $('res-current');
  cur.hidden = !res.current;
  if (res.current) {
    cur.textContent = `Ora sei in P${res.current.position} con ${res.current.fp} PF: ` +
      (res.current.safe ? 'posizione già sicura.' : 'non è sicura, ti possono superare.');
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
$('btn-new').addEventListener('click', () => { state.form = null; show('home'); });

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
  if (state.settings.arcLevel == null) openSettings();
}

init();
