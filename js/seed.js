// ============================================================
// seed.js – Beispiel-Datensatz (Standardbelegung beim Start)
// ============================================================

/**
 * Füllt people, towers, boats und dayState mit Beispieldaten.
 * Wird einmalig beim Laden der Seite aufgerufen.
 */
function seed(){
  const add = (name, role) => people.push({ id: ++uid, name, role });

  // Führungskräfte
  add('Anna', 'F'); add('Ben', 'F');

  // Bootsführer
  add('Clara', 'B'); add('David', 'B');

  // Erfahrene Wachgänger
  add('Emil',  'E'); add('Frieda', 'E'); add('Greta', 'E');
  add('Hugo',  'E'); add('Ida',    'E'); add('Jonas', 'E');

  // Unerfahrene Wachgänger
  add('Klara', 'U'); add('Lena', 'U'); add('Mara', 'U');
  add('Nils',  'U'); add('Ole',  'U'); add('Pia',  'U');

  // Türme
  const tN = { id: ++uid, name: 'Turm Nord', prio: 3, code: '' };
  const tS = { id: ++uid, name: 'Turm Süd',  prio: 2, code: '' };
  const tW = { id: ++uid, name: 'Turm West', prio: 1, code: '' };
  towers.push(tN, tS, tW);

  // Boot (dem Nord-Turm zugeordnet)
  boats.push({ id: ++uid, name: 'Boot 1', code: '', towerId: tN.id, prio: 3 });

  dayState = freshDayState();
  autoCodes();
}
