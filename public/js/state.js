// ============================================================
// state.js – Konstanten und globaler Anwendungszustand
// ============================================================

let DAYS = 6;
const ROLE = { F:'Führung', B:'Bootsführer', W:'Wachgänger' };
const MAIN_ID = 0;

// Effektives Pairing-Level für den Algorithmus: Führungskräfte zählen als erfahren (E);
// Bootsführer (B) und Wachgänger (W) werden über das experienced-Flag zu 'E'/'U'.
// Ersetzt das frühere getEffectiveRole + bfLevel (Feature 13).
// Feature 251: Führung ('F') → immer 'E' (erfahren), ermöglicht HW-Optimierung (2 WF balancieren 3 unerfahrene)
function effLevel(p){
  if(p.role === 'F') return 'E';
  return p.experienced ? 'E' : 'U';
}

// CSS-Suffix für role-dot: F→f, B→b (Bootsführer bleibt visuell eigenständig),
// Wachgänger zeigen ihr Erfahrungslevel (erfahren→e/grün, unerfahren→u/grau).
function roleDot(p){
  if(p.role === 'F') return 'f';
  if(p.role === 'B') return 'b';
  return p.experienced ? 'e' : 'u';  // W
}

// Menschlich lesbares Rollen-Label inkl. Erfahrung (für Output/CSV/XLSX).
function roleLabel(p){
  if(p.role === 'F') return 'Führung';
  if(p.role === 'B') return p.experienced ? 'Bootsführer (erfahren)' : 'Bootsführer (unerfahren)';
  return p.experienced ? 'Erfahren' : 'Unerfahren';  // W
}

let uid = 0;
let randomSeed = 0;

// Stammdaten
let people   = [];   // [{ id, name, role:'F'|'B'|'W', experienced:bool, labels:'', enableLabels:true, wantsHW:bool }] (experienced gilt für B und W; F ignoriert. wantsHW nur für B: Wunsch auf ≥1 aktiven HW-Dienst bei BF-Überzahl. labels Komma-getrennt, enableLabels steuert Sichtbarkeit)
let towers   = [];   // [{ id, name, prio, code, slotCount, leaderCount, mainBeach:bool }] (mainBeach: Hauptstrand-Turm für fairen Ausgleich)
let boats    = [];   // [{ id, name, code, towerId, prio, slotCount }]

// Hauptwache-Konfiguration
let mainK    = 2;    // Anzahl Guard-Slots neben der Führung

// Dienstzeit-Konfiguration (Feature 15)
let serviceStartHour = 9;   // Default 09:00
let serviceEndHour   = 17;  // Default 17:00

// Pro-Tag-Status
let dayState = [];   // Array[DAYS] von { sick:Set, absent:Set, closed:Set, closedBoats:Set }
                     // sick   = außer Dienst → wird an der HW geführt (zählt im Plan/Export)
                     // absent = komplett abwesend → NICHT eingeplant, nicht im XLSX/Druck sichtbar

// Manuelle Zwangszuweisungen (Feature 3 & 4)
// forcedPlacements[day] = [{ personId, kind:'tower'|'boat'|'main', slotId }]
let forcedPlacements = [];

// Positionsbeschriftungen für den XLSX-Export (Feature 2)
// Entsprechen den Zellen C11, C13, C15, C17, C19 im DLRG-Formular
let positionDescriptions = { 3:'', 4:'', 5:'', 6:'', 7:'' };

// Fairness-Metriken Einstellungen
let fairnessMetricsDisplay = {
  hwBoatBalance: true,      // Zeige HW-Tage | Boot-Turm Balance
  towerDistribution: true,  // Zeige Durchschnitt verschiedene Türme
  boatPairingDiversity: true
};

// Fairness-Visualisierungen (Balkendiagramme) — standardmäßig aus
let fairnessChartsDisplay = {
  assignmentsPerPerson: false,
  hwDaysPerPerson: false,
  towerUtilization: false
};

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
    absent:      new Set(),
    closed:      new Set(),
    closedBoats: new Set(),
  }));
}

function freshForcedPlacements(){
  return Array.from({ length: DAYS }, () => []);
}

// Reset all global state to defaults (call on account switch)
function resetGlobalState() {
  DAYS = 6;
  uid = 0;
  randomSeed = 0;
  people = [];
  towers = [];
  boats = [];
  mainK = 2;
  serviceStartHour = 9;
  serviceEndHour = 17;
  dayState = freshDayState();
  forcedPlacements = freshForcedPlacements();
  positionDescriptions = { 3:'', 4:'', 5:'', 6:'', 7:'' };
  fairnessMetricsDisplay = {
    hwBoatBalance: true,
    towerDistribution: true,
    boatPairingDiversity: true
  };
  fairnessChartsDisplay = {
    assignmentsPerPerson: false,
    hwDaysPerPerson: false,
    towerUtilization: false
  };
  exportColumns = [];
  lastResult = null;
  activeDay = 0;
  startDate = '';
  currentPlanId = null;
  currentPlanName = 'Wachplan';
  console.log('✓ Global state reset');
}
