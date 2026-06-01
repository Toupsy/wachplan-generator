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

  // Türme (slotCount = Anzahl Personen pro Turm)
  const tN = { id: ++uid, name: '9/12', prio: 3, code: '', slotCount: 2 };
  const tS = { id: ++uid, name: '9/13',  prio: 2, code: '', slotCount: 2 };
  const tW = { id: ++uid, name: '9/14', prio: 1, code: '', slotCount: 2 };
  towers.push(tN, tS, tW);

  // Boot (slotCount = Anzahl Personen pro Boot, normalerweise 1 Bootsführer)
  boats.push({ id: ++uid, name: 'Boot 1', code: '', towerId: tN.id, prio: 3, slotCount: 1 });

  dayState = freshDayState();
  autoCodes();
}
