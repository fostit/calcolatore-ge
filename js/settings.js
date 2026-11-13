// Impostazioni salvate SOLO sul telefono (localStorage). Ogni accesso è protetto:
// se il browser blocca la memoria, l'app funziona lo stesso e chiede di nuovo i dati.
const KEY = 'calc-ge-settings';

export function getSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      arcLevel: Number.isInteger(s.arcLevel) ? s.arcLevel : null,
      username: typeof s.username === 'string' ? s.username : '',
    };
  } catch {
    return { arcLevel: null, username: '' };
  }
}

export function saveSettings(partial) {
  const next = { ...getSettings(), ...partial };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // memoria non disponibile: le impostazioni valgono solo finché l'app resta aperta
  }
  return next;
}
