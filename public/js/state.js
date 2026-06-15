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

// Beobachter-Modus (view-only): role-dot OHNE Erfahrungs-Unterscheidung.
// Wachgänger → neutraler 'w'-Punkt, damit erfahren/unerfahren nicht erkennbar ist.
function roleDotSafe(p){
  if(p.role === 'F') return 'f';
  if(p.role === 'B') return 'b';
  return 'w';  // W: erfahren/unerfahren nicht unterscheidbar
}

// Beobachter-Modus (view-only): Rollen-Label ohne Erfahrungs-Angabe.
function roleLabelSafe(p){
  if(p.role === 'F') return 'Führung';
  if(p.role === 'B') return 'Bootsführer';
  return 'Wachgänger';  // W
}

let uid = 0;
let randomSeed = 0;

// ── Algorithmus-Parameter (Scoring-Gewichte) ─────────────────────────────────
// Alle Gewichte die der Fairness-Algorithmus in generate.js verwendet.
// Kann vom User angepasst werden; Defaults sind empirisch für typische DLRG-Wachen optimiert.
function defaultAlgoParams(){
  return {
    // Turm-Rotation & Fairness
    pairRepeatWeight:        250,   // Strafe pro Wiederholung desselben Paares
    towerVisitWeight:        200,   // Strafe pro Wiederholungsbesuch desselben Turms
    consecutiveTowerPenalty: 200,   // Strafe wenn jemand heute denselben Turm wie gestern hat
    totalFairnessWeight:      10,   // Gewicht für Gesamteinsatz-Ausgleich
    beachBalanceWeight:       60,   // Strand-Ausgleich: Strafe pro Überhang-Tag
    // E/U-Mischung
    uuPenaltyTower:         1000,   // Zwei Unerfahrene auf einem Turm
    uuPenaltyHW:             300,   // Zwei Unerfahrene an der HW (erlaubt, geringere Strafe)
    eePenaltyNormal:          40,   // Zwei Erfahrene (wenn Erfahrene nicht knapp)
    eePenaltyReserve:       1500,   // Zwei Erfahrene (wenn Erfahrene knapp)
    reserveExpPenalty:      5000,   // Erfahrener an HW wenn Türme ihn brauchen
    // Hauptwache
    hwVisitWeightTower:       60,   // HW-Tage → Turm-Bonus (pro HW-Tag)
    hwVisitWeightHW:          60,   // HW-Tage → HW-Strafe (pro HW-Tag)
    hwWishBonusEarly:        600,   // BF-HW-Wunsch Bonus (früh, >2 Tage vor Ende)
    hwWishBonusNear:        6000,   // BF-HW-Wunsch Bonus (2 Tage vor Ende)
    // BF-Schutz
    surplusBfActivePenalty:  800,   // Überzahl-BF auf Turm mit aktivem Boot
    surplusBfClosedBonus:    350,   // Überzahl-BF Bonus auf Turm ohne aktives Boot
    towerBoatHeavyPenalty:   150,   // Beide Personen boot-lastig → Strafe
    leaderBonus:             100,   // Führungskraft auf Turm mit leaderCount > 0
    // Boote
    boatVisitWeight:          50,   // Strafe pro Besuch desselben Bootes
    boatHwBonus:              10,   // HW-Tage → Bonus bei Boot-Zuweisung
    boatRotationBase:       1000,   // Boot-Rotations-Basisstrafe pro Lookback-Schritt
  };
}
let algoParams = defaultAlgoParams();

// Stammdaten
let people   = [];   // [{ id, name, role:'F'|'B'|'W', experienced:bool, labels:'', enableLabels:true, wantsHW:bool }] (experienced gilt für B und W; F ignoriert. wantsHW nur für B: Wunsch auf ≥1 aktiven HW-Dienst bei BF-Überzahl. labels Komma-getrennt, enableLabels steuert Sichtbarkeit)
// Hochgeladene DLRG-Wachliste (Feature 31): Roh-Verfügbarkeiten aller zugesagten Personen.
// [{ name, role:'F'|'B'|'W', from:'YYYY-MM-DD', to:'YYYY-MM-DD' }]. Aus dieser Liste leitet
// applyRosterToWindow() die people[] + tageweisen Abwesenheiten dynamisch aus startDate + DAYS ab.
let roster   = [];
// Manuelle Korrekturen an roster-abgeleiteten Personen, die ein Neu-Ableiten überleben sollen
// (z.B. Rolle/Erfahrung von Hand geändert). Key = normalisierter Name → { role?, experienced?,
// wantsHW?, labels?, enableLabels? } (nur explizit geänderte Felder). Feature 31.
let rosterOverrides = {};
let towers   = [];   // [{ id, name, prio, code, slotCount, leaderCount, mainBeach:bool }] (mainBeach: Hauptstrand-Turm für fairen Ausgleich)
let boats    = [];   // [{ id, name, code, towerId, prio, slotCount }]

// Hauptwache-Konfiguration
let mainK    = 2;    // Anzahl Guard-Slots neben der Führung
// Feature: BF-an-HW-Pflicht. Wenn true UND es echte BF-Überzahl gibt, soll an jedem Tag
// mindestens EIN überzähliger Bootsführer einen aktiven HW-Dienst bekommen
// (z.B. 3 HW-Slots → 2 Wachgänger + 1 BF). Default aus.
let requireBfAtHw = false;

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

// Fairness-Visualisierungen (Balkendiagramme)
let fairnessChartsDisplay = {
  assignmentsPerPerson: true,   // Einsätze gesamt pro Person
  hwDaysPerPerson: true,        // HW-Tage pro Person
  towerUtilization: true        // Turmauslastung
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
  roster = [];
  rosterOverrides = {};
  towers = [];
  boats = [];
  mainK = 2;
  requireBfAtHw = false;
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
    assignmentsPerPerson: true,
    hwDaysPerPerson: true,
    towerUtilization: true
  };
  exportColumns = [];
  algoParams = defaultAlgoParams();
  lastResult = null;
  activeDay = 0;
  startDate = '';
  currentPlanId = null;
  currentPlanName = 'Wachplan';
  currentPlanCanEdit = true;   // Default: eigener/neuer Plan ist bearbeitbar (Beobachter-Modus aus)
  console.log('✓ Global state reset');
}
