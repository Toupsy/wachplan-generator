// ============================================================
// seed.js – Beispiel-Datensatz (Standardbelegung beim Start)
// ============================================================

/**
 * Füllt towers, boats, people und dayState mit Standarddaten.
 * Beispielkonfiguration mit 7 Türmen, 3 Booten, 2 Führungskräften, 3 BF und 17 WG.
 */
function seed(){
  people = [];
  uid = 0;

  // 7 Türme: 9/12 bis 9/18
  const t912 = { id: ++uid, name: 'Turm 9/12', prio: 1, code: '', slotCount: 2, leaderCount: 0 };
  const t913 = { id: ++uid, name: 'Turm 9/13', prio: 2, code: '', slotCount: 2, leaderCount: 0 };
  const t914 = { id: ++uid, name: 'Turm 9/14', prio: 3, code: '', slotCount: 2, leaderCount: 0 };
  const t915 = { id: ++uid, name: 'Turm 9/15', prio: 4, code: '', slotCount: 2, leaderCount: 0 };
  const t916 = { id: ++uid, name: 'Turm 9/16', prio: 5, code: '', slotCount: 2, leaderCount: 0 };
  const t917 = { id: ++uid, name: 'Turm 9/17', prio: 6, code: '', slotCount: 2, leaderCount: 0 };
  const t918 = { id: ++uid, name: 'Turm 9/18', prio: 7, code: '', slotCount: 2, leaderCount: 0 };
  towers.push(t912, t913, t914, t915, t916, t917, t918);

  // 3 Boote mit Zuordnungen
  boats.push({ id: ++uid, name: 'Boot 78/1', code: '', towerId: t912.id, prio: 1, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 78/2', code: '', towerId: t914.id, prio: 2, slotCount: 1 });
  boats.push({ id: ++uid, name: 'Boot 78/3', code: '', towerId: t917.id, prio: 3, slotCount: 1 });

  // 2 Führungskräfte (F)
  people.push({ id: ++uid, name: 'Führung 1', role: 'F', experienced: false });
  people.push({ id: ++uid, name: 'Führung 2', role: 'F', experienced: false });

  // 3 Bootsführer: 2 erfahren, 1 unerfahren
  people.push({ id: ++uid, name: 'BF 1', role: 'B', experienced: true });
  people.push({ id: ++uid, name: 'BF 2', role: 'B', experienced: true });
  people.push({ id: ++uid, name: 'BF 3', role: 'B', experienced: false });

  // 17 Wachgänger: 7 erfahren, 10 unerfahren
  for (let i = 1; i <= 7; i++) {
    people.push({ id: ++uid, name: `WG E${i}`, role: 'W', experienced: true });
  }
  for (let i = 1; i <= 10; i++) {
    people.push({ id: ++uid, name: `WG U${i}`, role: 'W', experienced: false });
  }

  // Stationscodes für XLSX-Export
  exportColumns = [
    '78/1', '78/2', '78/3', '', 'WF', 'HW', '',
    '', '', '', '', '', '', ''
  ];

  dayState = freshDayState();
  autoCodes();
}
