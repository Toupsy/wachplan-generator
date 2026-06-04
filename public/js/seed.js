// ============================================================
// seed.js – Beispiel-Datensatz (Standardbelegung beim Start)
// ============================================================

/**
 * Füllt towers, boats und dayState mit Standarddaten.
 * Keine Menschen eingetragen - müssen manuell hinzugefügt werden.
 */
function seed(){
  // Keine Wachgänger im Template
  people = [];
  uid = 0;

  // Türme
  const t78 = { id: ++uid, name: 'Turm 78', prio: 1, code: '', slotCount: 2, leaderCount: 0 };
  const t9 = { id: ++uid, name: 'Turm 9', prio: 2, code: '', slotCount: 2, leaderCount: 0 };
  towers.push(t78, t9);

  // Boote für Turm 78
  boats.push({ id: ++uid, name: 'Boot 78/1', code: '', towerId: t78.id, prio: 1, slotCount: 1 });

  // Boote für Turm 9
  boats.push({ id: ++uid, name: 'Boot 9/12', code: '', towerId: t9.id, prio: 1, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 9/13', code: '', towerId: t9.id, prio: 2, slotCount: 1 });

  // Stationscodes für XLSX-Export
  exportColumns = [
    '78/1', '9/12', '9/13', '', 'WF', 'HW', '',
    '', '', '', '', '', '', ''
  ];

  dayState = freshDayState();
  autoCodes();
}
