// Calcoli puri: quanti PF servono per bloccare una posizione e quanto si guadagna.
//
// Regola: dopo aver versato, chi viene scavalcato (o chiunque sotto) non deve poterti superare
// nemmeno versando tutti i PF che restano. A parità resta davanti chi è arrivato prima, cioè tu.

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

/**
 * Valuta le posizioni richieste.
 * contributors: [{ name, fp, isOwner, isMe }] nell'ordine dello schermo.
 * rewards: premi base P1-P7 della riga L+1. positions: numeri di posizione da valutare.
 */
export function evaluate(input) {
  const error = validate(input);
  if (error) return { error, current: null, rows: [] };

  const { remaining, contributors = [], rewards, arcPct, positions } = input;
  const byFpDesc = (a, b) => b.fp - a.fp; // Array.sort è stabile: a parità vale l'ordine dello schermo
  const ranked = contributors.filter((c) => !c.isOwner);
  const me = ranked.find((c) => c.isMe) ?? null;
  const others = ranked.filter((c) => !c.isMe).sort(byFpDesc);
  const m = me ? me.fp : 0;
  const fpAt = (k) => others[k - 1]?.fp ?? 0; // k-esimo contribuente senza di me
  const rewardArc = (k) => withArc(rewards[k - 1] ?? 0, arcPct);

  let current = null;
  if (me && m > 0) {
    const p = [...ranked].sort(byFpDesc).indexOf(me) + 1;
    current = { position: p, fp: m, safe: lockCost({ remaining, competitor: fpAt(p), mine: m }).alreadySafe };
  }

  const rows = positions.map((k) => {
    const competitor = fpAt(k);
    const { add, lockable, alreadySafe } = lockCost({ remaining, competitor, mine: m });
    const above = k > 1 ? others[k - 2] : null;
    const reward = rewards[k - 1] ?? 0;
    return {
      position: k,
      competitor,
      add,
      lockable,
      alreadySafe,
      reward,
      rewardArc: rewardArc(k),
      balanceTotal: rewardArc(k) - (m + add),
      balanceVsStay: current?.safe && k < current.position ? rewardArc(k) - rewardArc(current.position) - add : null,
      mayEndAt: lockable && above && m + add > above.fp ? k - 1 : null,
      aboveCurrent: current ? k > current.position : false,
    };
  });

  return { current, rows };
}
