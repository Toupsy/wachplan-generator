// ============================================================
// state.js – Konstanten und globaler Anwendungszustand
// ============================================================

let DAYS = 6;
const ROLE = { F:'Führung', B:'Bootsführer', E:'Erfahren', U:'Unerfahren' };
const MAIN_ID = 0;

let uid = 0;
let randomSeed = 0;

// Stammdaten
let people   = [];   // [{ id, name, role }]
let towers   = [];   // [{ id, name, prio, code, slotCount }]
let boats    = [];   // [{ id, name, code, towerId, prio, slotCount }]

// Hauptwache-Konfiguration
let mainK    = 2;    // Anzahl Guard-Slots neben der Führung
let hwBoatId = null; // Boot das der Hauptwache zugeordnet ist (Feature 6)

// Pro-Tag-Status
let dayState = [];   // Array[DAYS] von { sick:Set, closed:Set, closedBoats:Set }

// Manuelle Zwangszuweisungen (Feature 3 & 4)
// forcedPlacements[day] = [{ personId, kind:'tower'|'boat'|'main', slotId }]
let forcedPlacements = [];

// Positionsbeschriftungen für den XLSX-Export (Feature 2)
// Entsprechen den Zellen C11, C13, C15, C17, C19 im DLRG-Formular
let positionDescriptions = { 3:'', 4:'', 5:'', 6:'', 7:'' };

// XLSX-Stationsspalten: 16 Einträge, jeder ein Stations-Code (oder '') für die
// Template-Spalten U, AA, AG, AM, AS, AY, BE, BK, BQ, BW, CC, CI, CO, CU, DM, DS
// Leer ('') = Spalte bleibt im Export unbeschriftet
let exportColumns = [];

// Letztes Berechnungsergebnis
let lastResult = null;
let activeDay  = 0;
let startDate  = '';

// ── Konstruktoren ────────────────────────────────────────────────

function freshDayState(){
  return Array.from({ length: DAYS }, () => ({
    sick:        new Set(),
    closed:      new Set(),
    closedBoats: new Set(),
  }));
}

function freshForcedPlacements(){
  return Array.from({ length: DAYS }, () => []);
}
