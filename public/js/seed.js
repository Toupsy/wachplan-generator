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
  const t78 = { id: ++uid, name: 'Turm 78', prio: 1, code: '', slotCount: 2 };
  const t9 = { id: ++uid, name: 'Turm 9', prio: 2, code: '', slotCount: 2 };
  towers.push(t78, t9);

  // Boote für Turm 78
  boats.push({ id: ++uid, name: 'Boot 78/1', code: '', towerId: t78.id, prio: 1, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 78/2', code: '', towerId: t78.id, prio: 2, slotCount: 1 });

  // Boote für Turm 9
  boats.push({ id: ++uid, name: 'Boot 9/12', code: '', towerId: t9.id, prio: 1, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 9/13', code: '', towerId: t9.id, prio: 2, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 9/14', code: '', towerId: t9.id, prio: 3, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 9/15', code: '', towerId: t9.id, prio: 4, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 9/16', code: '', towerId: t9.id, prio: 5, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 9/17', code: '', towerId: t9.id, prio: 6, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 9/18', code: '', towerId: t9.id, prio: 7, slotCount: 1 });

  // Stationscodes für XLSX-Export
  exportColumns = [
    '78/1', '9/12', '9/13', '', 'WF', 'HW', '',
    '78/2', '9/14', '9/15', '9/16', '78/1', '9/17', '9/18'
  ];

  dayState = freshDayState();
  autoCodes();
}
