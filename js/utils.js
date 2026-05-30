// ============================================================
// utils.js – Allgemeine Hilfsfunktionen
// ============================================================

/** HTML-Sonderzeichen escapen (für sichere innerHTML-Nutzung). */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/** Kurze Toast-Benachrichtigung am unteren Bildschirmrand. */
function showToast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/**
 * Deterministischer Pseudo-Zufallswert im Bereich [0, 1).
 * Gleicher seed + n liefert immer dasselbe Ergebnis.
 */
function seededRand(seed, n){
  let s = (seed * 1664525 + n * 22695477 + 1013904223) & 0x7fffffff;
  return (s % 100000) / 100000;
}

/** Seed-Badge in der Sidebar aktualisieren. */
function updateSeedDisplay(){
  const el = document.getElementById('seed-display');
  if(!el) return;
  el.style.display = randomSeed ? '' : 'none';
  if(randomSeed) el.textContent = '🎲 Seed ' + randomSeed;
}

// --- Lookup-Helfer für Stammdaten ---

/** Person anhand ID suchen. */
const getP    = id => people.find(p => p.id === id);

/** Turm anhand ID suchen. */
const getT    = id => towers.find(t => t.id === id);

/** Boot anhand ID suchen. */
const getBoat = id => boats.find(b => b.id === id);

/**
 * 1-basierte Nummer einer Person in der Besetzungsliste.
 * Gibt null zurück, wenn die Person nicht gefunden wird
 * (verhindert, dass der XLSX-Export "0" schreibt).
 */
function personNr(id){
  const i = people.findIndex(p => p.id === id);
  return i < 0 ? null : i + 1;
}
