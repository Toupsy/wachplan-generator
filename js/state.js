// ============================================================
// state.js – Konstanten und globaler Anwendungszustand
// ============================================================

// Unveränderliche Konfiguration
const DAYS = 6;
const DAYNAMES = ['Tag 1','Tag 2','Tag 3','Tag 4','Tag 5','Tag 6'];
const ROLE = { F:'Führung', B:'Bootsführer', E:'Erfahren', U:'Unerfahren' };
const MAIN_ID = 0;  // Pseudo-ID für die Hauptwache im Paar-Score

// Laufender ID-Zähler (wird bei jedem neuen Objekt inkrementiert)
let uid = 0;

// Zufalls-Seed für reproduzierbare Ergebnisse (0 = deaktiviert)
let randomSeed = 0;

// Stammdaten
let people   = [];   // [{ id, name, role }]
let towers   = [];   // [{ id, name, prio, code }]
let boats    = [];   // [{ id, name, code, towerId, prio }]

// Konfiguration Hauptwache (Anzahl Guard-Slots neben der Führung)
let mainK = 2;

// Pro-Tag-Status (Krank, manuell geschlossen, Boot außer Dienst)
let dayState = [];   // Array[DAYS] von { sick:Set, closed:Set, closedBoats:Set }

// Letztes Berechnungsergebnis (wird von renderOutput genutzt)
let lastResult = null;

// Aktuell angezeigter Tag-Tab
let activeDay = 0;

// Startdatum als ISO-String ('YYYY-MM-DD') oder leer
let startDate = '';
