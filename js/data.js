// Tabelle dei GE (costi, premi P1-P7) e bonus dell'Arca, generate da tools/estrai_dati.py.

export function parseData(json) {
  return json;
}

export async function loadData(url = './data/dati-ge.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossibile caricare i dati dei GE (${res.status})`);
  return parseData(await res.json());
}

/** Costo e premi per raggiungere `level` (riga L+1 della schermata). null se fuori tabella (es. fase Oro). */
export function getLevel(data, key, level) {
  return data.ge[key]?.levels[String(level)] ?? null;
}

/** Bonus dell'Arca come frazione (0.19 = +19%). null se il livello non è in tabella. */
export function arcPct(data, arcLevel) {
  return data.arc[String(arcLevel)] ?? null;
}

export function listGe(data) {
  return Object.entries(data.ge).map(([key, g]) => ({ key, it: g.it, en: g.en }));
}
