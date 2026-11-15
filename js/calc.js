// Calcoli puri: quanti PF servono per bloccare una posizione e quanto si guadagna.
//
// Regola: dopo aver versato, chi viene scavalcato (o chiunque sotto) non deve poterti superare
// nemmeno versando tutti i PF che restano. A parità resta davanti chi è arrivato prima, cioè tu.
//
// Il rivale per ogni posizione si prende dal NUMERO DI POSIZIONE scritto sullo schermo, mai
// dall'ordine della lista: così un numero non letto o una classifica che parte da P4 non fa
// slittare i calcoli. Se il rivale non è visibile il risultato è "sconosciuto", mai "sicuro".

const isNonNegInt = (n) => Number.isInteger(n) && n >= 0;

/**
 * PF da aggiungere per bloccare la posizione contesa con `competitor`.
 * remaining = PF che mancano alla chiusura, mine = PF che hai già versato.
 */
export function lockCost({ remaining, competitor, mine = 0 }) {
  const add = Math.max(Math.ceil((remaining + competitor - mine) / 2), competitor + 1 - mine, 0);
  return { add, lockable: add <= remaining, alreadySafe: add === 0 };
}

export function withArc(base, arcPct) {
  return Math.round(base * (1 + arcPct));
}

function validate({ remaining, contributors, rewards, arcPct, positions }) {
  if (!isNonNegInt(remaining)) return 'I PF che mancano alla chiusura non sono validi (versati maggiori del totale?).';
  if (!Array.isArray(rewards)) return 'Premi del GE non trovati per questo livello.';
  if (typeof arcPct !== 'number' || !(arcPct >= 0)) return 'Bonus Arca non valido: controlla le impostazioni.';
  if (!Array.isArray(positions) || positions.length === 0) return 'Nessuna posizione da valutare.';
  for (const c of contributors ?? []) {
    if (!isNonNegInt(c.fp)) return `PF non validi per "${c.name || 'contribuente'}".`;
  }
  return null;
}

/** Problemi nella classifica letta che renderebbero il calcolo inaffidabile. */
export function rankingIssues(rows) {
  const issues = [];
  const owners = rows.filter((r) => r.isOwner || r.position == null);
  if (owners.length > 1) {
    issues.push(`Ci sono ${owners.length} righe senza numero di posizione (proprietari?): probabilmente un numero non è stato letto. Scrivilo nella colonna Pos.`);
  }
  const ranked = rows.filter((r) => !(r.isOwner || r.position == null)).sort((a, b) => a.position - b.position);
  for (let i = 1; i < ranked.length; i++) {
    const prev = ranked[i - 1];
    const cur = ranked[i];
    if (cur.position === prev.position) issues.push(`La posizione P${cur.position} compare due volte.`);
    else if (cur.position !== prev.position + 1) issues.push(`Manca la posizione P${prev.position + 1} tra P${prev.position} e P${cur.position}.`);
    else if (cur.fp > prev.fp) issues.push(`P${cur.position} ha più PF di P${prev.position}: l'ordine non torna, controlla i numeri.`);
  }
  return issues;
}

/**
 * Confronta la somma dei PF visibili (proprietario compreso) con i PF versati della barra.
 * complete: tornano; partial: manca qualcuno fuori schermo; mismatch/over: c'è un numero letto male.
 */
export function checkContributions(done, rows) {
  const sum = rows.reduce((s, r) => s + (Number(r.fp) || 0), 0);
  // "si vede tutto" solo se c'è il proprietario, una riga libera e tutte le posizioni da P1 fino a lei:
  // una classifica scorsa (proprietario o P1 fuori schermo) è solo parziale, non sbagliata
  const ranked = rows.filter((r) => !(r.isOwner || r.position == null));
  const seen = new Set(ranked.map((r) => r.position));
  const free = ranked.filter((r) => Number(r.fp) === 0).map((r) => r.position);
  const firstFree = free.length ? Math.min(...free) : null;
  const ownerVisible = rows.some((r) => r.isOwner || r.position == null);
  const allVisible = firstFree != null && ownerVisible
    && Array.from({ length: firstFree - 1 }, (_, i) => i + 1).every((k) => seen.has(k));
  let status;
  if (sum > done) status = 'over';
  else if (sum === done) status = 'complete';
  else status = allVisible ? 'mismatch' : 'partial';
  return { status, sum, done };
}

/**
 * Prima posizione libera: una riga "Ancora nessun contribuente", oppure, se la classifica è completa
 * (somma dei PF = barra), quella subito sotto l'ultima riga. Da lì in giù sono tutte libere.
 */
function firstFreePosition(ranked, complete) {
  const cands = ranked.filter((r) => Number(r.fp) === 0).map((r) => r.position);
  // classifica completa: libero da sotto l'ultima riga; senza righe (solo il proprietario) è libero tutto, da P1
  if (complete) cands.push(ranked.length ? Math.max(...ranked.map((r) => r.position)) + 1 : 1);
  return cands.length ? Math.min(...cands) : null;
}

/**
 * Posizioni che servono ancora per rispondere: quelle premiate non visibili e, se sei in una posizione
 * premiata, quella subito sotto di te (per sapere se sei al sicuro). Dice anche da che parte scorrere.
 * extra: altre posizioni richieste dal calcolo (needPosition delle righe "sconosciute").
 */
export function neededPositions(rows, rewards, { complete = false, extra = [] } = {}) {
  const clean = rows.map((r) => ({ ...r, fp: r.fp === '' || r.fp == null ? 0 : Number(r.fp) }));
  const ranked = clean.filter((r) => !(r.isOwner || r.position == null));
  const visible = new Set(ranked.map((r) => r.position));
  const firstFree = firstFreePosition(ranked, complete);
  const need = new Set([...missingPositions(clean, rewards, { complete }).missing, ...extra]);
  const me = ranked.find((r) => r.isMe && r.fp > 0);
  let meNeed = null;
  if (me && (rewards[me.position - 1] ?? 0) > 0) {
    const below = me.position + 1;
    if (!visible.has(below) && !(firstFree != null && below >= firstFree)) {
      need.add(below);
      meNeed = below;
    }
  }
  for (const k of visible) need.delete(k);
  const ks = [...need].sort((a, b) => a - b);
  if (!ks.length) return { ks, direction: null, meNeed: null };
  const lo = Math.min(...visible);
  const hi = Math.max(...visible);
  const up = ks.some((k) => k < lo);
  const down = ks.some((k) => k > hi);
  return { ks, direction: up && down ? 'both' : up ? 'up' : 'down', meNeed };
}

/**
 * Posizioni che danno un premio ma non si vedono nello screenshot, e da che parte scorrere per vederle.
 * Se è visibile una posizione libera, quelle sotto sono libere anche loro: non mancano.
 */
export function missingPositions(rows, rewards, { complete = false } = {}) {
  const ranked = rows.filter((r) => !(r.isOwner || r.position == null));
  const visible = new Set(ranked.map((r) => r.position));
  const firstFree = firstFreePosition(ranked, complete);
  const missing = [];
  rewards.forEach((reward, i) => {
    const k = i + 1;
    if (reward > 0 && !visible.has(k) && !(firstFree != null && k >= firstFree)) missing.push(k);
  });
  if (!missing.length) return { missing, direction: null };
  const lo = visible.size ? Math.min(...visible) : Infinity;
  const hi = visible.size ? Math.max(...visible) : -Infinity;
  const up = missing.some((k) => k < lo);
  const down = missing.some((k) => k > hi);
  return { missing, direction: up && down ? 'both' : up ? 'up' : 'down' };
}

/**
 * Valuta le posizioni richieste.
 * contributors: [{ name, fp, position, isOwner, isMe }] (position = numero sullo schermo, null per il proprietario).
 * rewards: premi base P1-P7 della riga L+1. positions: numeri di posizione da valutare.
 */
export function evaluate(input) {
  const error = validate(input);
  if (error) return { error, current: null, rows: [] };

  const { remaining, contributors = [], rewards, arcPct, positions } = input;
  const ranked = contributors.filter((c) => !c.isOwner && c.position != null);
  const meRow = ranked.find((c) => c.isMe && c.fp > 0) ?? null;
  const m = meRow ? meRow.fp : 0;
  const p = meRow ? meRow.position : null;

  const fpByPos = new Map();
  for (const c of ranked) if (c !== meRow) fpByPos.set(c.position, c.fp);
  // da qui in giù sono tutte libere (riga vuota visibile, o classifica completa)
  const firstFree = firstFreePosition(ranked, input.complete === true);

  // PF di chi occuperebbe la posizione k se io non ci fossi (undefined = non visibile)
  const othersAt = (k) => {
    const label = p != null && p <= k ? k + 1 : k;
    if (fpByPos.has(label)) return { fp: fpByPos.get(label), label };
    if (firstFree != null && label >= firstFree) return { fp: 0, label };
    return { fp: undefined, label };
  };
  const rewardArc = (k) => withArc(rewards[k - 1] ?? 0, arcPct);

  let current = null;
  if (meRow) {
    const below = othersAt(p);
    current = {
      position: p,
      fp: m,
      safe: below.fp === undefined ? null : lockCost({ remaining, competitor: below.fp, mine: m }).alreadySafe,
    };
  }

  const rows = positions.map((k) => {
    const reward = rewards[k - 1] ?? 0;
    // "sei già più in alto" solo se la posizione attuale è sicura; altrimenti quelle sotto sono un ripiego da calcolare
    const aboveCurrent = current?.safe === true && k > p;
    const rival = othersAt(k);
    if (rival.fp === undefined) {
      return {
        position: k, competitor: null, unknown: true, needPosition: rival.label, add: null, lockable: false,
        alreadySafe: false, reward, rewardArc: rewardArc(k), balanceTotal: null, balanceVsStay: null, mayEndAt: null, locksHigher: null, aboveCurrent,
      };
    }
    const { add, lockable, alreadySafe } = lockCost({ remaining, competitor: rival.fp, mine: m });
    const above = k > 1 ? othersAt(k - 1) : { fp: undefined };
    // con gli stessi PF blocco già una posizione più alta? (es. GE quasi vuoto: costano tutte uguale)
    let locksHigher = null;
    for (let j = 1; j < k && lockable && !alreadySafe && locksHigher == null; j++) {
      const r = othersAt(j);
      if (r.fp !== undefined && lockCost({ remaining, competitor: r.fp, mine: m }).add <= add) locksHigher = j;
    }
    return {
      position: k,
      competitor: rival.fp,
      unknown: false,
      needPosition: null,
      add,
      lockable,
      alreadySafe,
      reward,
      rewardArc: rewardArc(k),
      balanceTotal: rewardArc(k) - (m + add),
      balanceVsStay: current?.safe === true && k < p ? rewardArc(k) - rewardArc(p) - add : null,
      mayEndAt: locksHigher == null && lockable && above.fp !== undefined && m + add > above.fp ? k - 1 : null,
      locksHigher,
      aboveCurrent,
    };
  });

  return { current, rows };
}

// ---------- Il mio GE (catena 1.9) ----------
//
// Simone è il proprietario: i membri della gilda pagano premio × 1,9 e non si scavalcano tra loro.
// Il pericolo sono i ninja (esterni). Un membro con c PF è al sicuro se n + R ≤ c, con n = PF del ninja
// più forte sotto di lui (0 = un esterno nuovo) e R = PF che mancano. A parità resta davanti chi c'era prima.

/** Quota 1,9 di una posizione: per difetto, con interi (30 → 57, mai 56 per errori di virgola). */
export function ownGeQuota(base) {
  return Math.floor((base * 19) / 10);
}

const rankedRows = (rows) => rows
  .map((r, index) => ({ ...r, index, fp: Number(r.fp) || 0 }))
  .filter((r) => !r.isOwner && r.position != null);

/**
 * Posizioni da vedere prima di poter calcolare: servono tutte quelle da P1 fino alla prima libera.
 * Se la prima libera non si vede (classifica tagliata in basso), serve la posizione subito sotto.
 */
export function ownGeNeed(rows, { complete = false } = {}) {
  const ranked = rankedRows(rows);
  const visible = new Set(ranked.map((r) => r.position));
  const firstFree = firstFreePosition(ranked, complete);
  if (firstFree == null) {
    return { ks: [visible.size ? Math.max(...visible) + 1 : 1], direction: 'down' };
  }
  const ks = [];
  for (let k = 1; k < firstFree; k++) if (!visible.has(k)) ks.push(k);
  if (!ks.length) return { ks, direction: null };
  const lo = Math.min(...visible);
  const hi = Math.max(...visible);
  const up = ks.some((k) => k < lo);
  const down = ks.some((k) => k > hi);
  return { ks, direction: up && down ? 'both' : up ? 'up' : 'down' };
}

/**
 * Quanti PF deve versare il proprietario perché i membri siano al sicuro dai ninja.
 * contributors: [{ name, fp, position, isOwner, ninja, cover }]. Le righe con 0 PF sono posizioni libere.
 * cover = spunta "Copri" (true/false scelti da Simone; assente = accesa solo se ha versato almeno la quota 1,9
 * di una posizione con premio). Chi non è coperto non viene protetto e, se non è un ninja, non è una minaccia.
 */
export function planOwnGe({ remaining, rewards, contributors = [], complete = false }) {
  const quotas = rewards.map(ownGeQuota);
  const need = ownGeNeed(contributors, { complete });
  if (need.ks.length) {
    return { quotas, need, members: null, protectNow: null, next: null, protectAndPrepare: null, nextWouldClose: null };
  }
  const ranked = rankedRows(contributors).sort((a, b) => a.position - b.position);
  const occupied = ranked.filter((r) => r.fp > 0);
  let limitNow = Infinity; // R*1: quanti PF possono restare con tutti i presenti al sicuro
  const members = occupied.map((r) => {
    const ninja = !!r.ninja;
    const quota = quotas[r.position - 1] ?? 0;
    const underQuota = r.fp < quota;
    const base = { index: r.index, position: r.position, name: r.name, fp: r.fp, ninja, quota, underQuota };
    if (ninja) return { ...base, covered: false, safe: null, impossible: false };
    const covered = typeof r.cover === 'boolean' ? r.cover : quota > 0 && !underQuota;
    const threat = Math.max(0, ...occupied.filter((o) => o.ninja && o.position > r.position).map((o) => o.fp));
    const room = r.fp - threat;
    const impossible = room <= 0; // si protegge solo chiudendo il GE: lo si esclude dal calcolo
    if (covered && !impossible) limitNow = Math.min(limitNow, room);
    return { ...base, covered, safe: threat + remaining <= r.fp, impossible };
  });
  const firstFree = firstFreePosition(ranked, complete);
  const next = firstFree != null && (rewards[firstFree - 1] ?? 0) > 0
    ? { position: firstFree, quota: quotas[firstFree - 1] }
    : null;
  const protectNow = Math.max(0, remaining - limitNow);
  if (!next) return { quotas, need, members, protectNow, next, protectAndPrepare: null, nextWouldClose: false };
  const limit = Math.min(limitNow, 2 * next.quota);
  return {
    quotas,
    need,
    members,
    protectNow,
    next,
    protectAndPrepare: Math.max(0, remaining - limit),
    nextWouldClose: Math.min(remaining, limit) < next.quota,
  };
}
