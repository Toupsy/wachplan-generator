# DLRG Wachplan-Generator

Single-Page Application zur automatischen Generierung fairer Wachpläne für Wasserrettungsdienste der **DLRG** (Deutsche Lebens-Rettungs-Gesellschaft).

Erstellt automatisch Wachpläne für **1–14 Tage** mit optimierter Fairness-Rotation und kann als offizielles **DLRG-XLSX-Formular** exportiert werden.

---

## Features

### Core
- ✅ Automatische Wachplangeneration (1–14 Tage)
- ✅ Faire Rotation über Türme, Boote, Hauptwache
- ✅ XLSX-Export (DLRG-Formular-kompatibel)
- ✅ CSV-Export
- ✅ Drag-and-Drop Umplatzierung mit Zukunfts-Neuberechnung
- ✅ Transparente Zwangszuweisungen (visuell ohne Stats-Impact)
- ✅ Effektive Zwangszuweisungen (mit Stats-Impact)

### Fairness-Algorithmus
- ✅ Akkumulierte Statistiken über alle Tage
- ✅ HW-Balance Metriken (Hauptwache vs. Tower-mit-Boot)
- ✅ Turm-Verteilung Diversität
- ✅ Boot-Paarungen Vielfalt
- ✅ 2-Tage-Folge-Regel (Konsekutive Turm-Zuweisung vermeiden)
- ✅ Metriken-Toggles (Nutzer kontrolliert, welche Stats sichtbar)
- ✅ Pro-Person Tower-Statistik Tabelle

### Konfigurierbarkeit
- ✅ Variable Slot-Kapazität pro Turm (1–10 Plätze)
- ✅ Variable Slot-Kapazität pro Boot (1–3 Plätze)
- ✅ HW-Boot-Auswahl (welches Boot gehört zur Hauptwache)
- ✅ Hauptwache Guard-Slots (k-Guard Kapazität)
- ✅ XLSX-Spalten-Mapping (16 Stationen konfigurierbar)
- ✅ Positionsbeschriftungen (Pos. 3–7 im XLSX anpassbar)

### Deployment
- ✅ Vanilla-JS (kein Framework, keine Build-Abhängigkeiten)
- ✅ Docker-Support (NAS-ready)
- ✅ Autosave zu localStorage
- ✅ JSON-Import/Export für Backups

---

## Quick Start

### Lokal (Node.js)

```bash
# Dependencies installieren
npm install

# Server starten (Port 3000)
npm start

# Browser öffnen
http://localhost:3000
```

### Docker (NAS/Server)

```bash
# Image bauen + Container starten
docker-compose up -d

# Browser öffnen
http://nas-ip:3000

# Logs anschauen
docker-compose logs -f wachplan
```

Siehe [DOCKER.md](./DOCKER.md) für vollständiges Setup-Guide.

---

## Technologie-Stack

| Layer | Tech |
|-------|------|
| **Frontend** | Vanilla-JS + HTML5 + CSS3 (Dark Theme) |
| **Server** | Node.js + Express.js |
| **Database** | localStorage (client-side) |
| **Export** | JSZip (XLSX-XML-Patching) |
| **Deploy** | Docker + docker-compose |

---

## Dateistruktur

```
.
├── Wachplan-Generator.html   – Main SPA + Layout + CSS
├── js/
│   ├── state.js              – Globale Datenstrukturen
│   ├── utils.js              – Helfer (escapeHtml, Toast, etc.)
│   ├── dates.js              – Datumsberechnung
│   ├── autoCodes.js          – Auto-Stationscodes
│   ├── seed.js               – Beispieldaten
│   ├── generate.js           – ⭐ Kern-Algorithmus (Fairness)
│   ├── render-sidebar.js     – Sidebar UI
│   ├── render-output.js      – Ausgabe-Panel + Stats
│   ├── export.js             – XLSX/CSV-Export
│   ├── move.js               – Verschiebungs-Modal + D&D
│   ├── state-io.js           – Import/Export/Autosave
│   └── init.js               – Event-Listener + Startup
├── Wachplan Template.xlsx    – DLRG-Formular (wird gepatcht)
├── package.json              – Node.js dependencies
├── server.js                 – Express.js Server
├── Dockerfile                – Docker Image
├── docker-compose.yml        – Orchestration
└── DOCKER.md                 – Docker Setup-Guide
```

---

## Algorithmus-Überblick

### Fairness-Metriken

Jede Person wird als Punkt im 4D-Raum betrachtet:
1. **Total Days** – Einsatztage (Fairness primary)
2. **HW Visits** – Hauptwache-Tage (sollte ausgewogen sein)
3. **Tower With Boat Days** – Turm-Tage mit aktivem Boot (stressig → limitieren)
4. **Boat Captain Pairings** – Häufigkeit derselben Boot-Fahrer (Diversität fördern)

### Scoring (bestPair)

Beim Zuweisen von Paaren (2er Türm-Slots) zu einem Turm wird Score minimiert:

```
score += person.total                    // primary: weniger Einsätze bekommen höhere Priorität
score += person.towerVisits * 30         // Turm-Wiederholungs-Penalty
score += pairRepeatCount * 120           // 2er-Paare nicht zu oft zusammen
score += consecutiveTowerPenalty * 200   // Nicht 2 Tage hintereinander gleicher Turm
score -= hwVisits * 60                   // Bonus für Personen mit vielen HW-Tagen
score += boatVisits * 50                 // Boot-Balance (als Penalty wenn viele Boot-Tage)
score += surplusBFPenalty * 800          // Bootsführer-Schutz (nicht in aktive Boote)
```

**Niedrigster Score gewinnt.**

### Ablauf pro Tag

1. **Hauptwache** – k-Guard-Slots + Overflow-Verwaltung
2. **Türme** – Sequenziell nach Priorität, Paare via bestPair
3. **Boote** – Bootsführer-Zuordnung mit Fairness-Sortierung
4. **HW-Boot** (optional) – Dedizierter Captain falls hwBoatId aktiv
5. **Transparente Zuweisungen** – visuelle Overlays nach Algorithmus

### Seed-basierte Konstellationen

Verschiedene Day-1-Starts mit identischer Folge-Fairness:
```bash
Seed 0:   Standard-Plan
Seed 1:   Klara,Jonas,Ole,Lena,Hugo,Ida auf Türme (Tag 1)
Seed 5:   Frieda,Lena,Klara,Emil,Hugo,Greta auf Türme (Tag 1)
Alle:     Identische Fairness über 6 Tage (acc-stats gleichen sich aus)
```

---

## Verschiebung (Move Feature)

### Case 1: Transparent (kein Haken)
- Person wird NUR visuell verschoben
- Stats bleiben unverändert
- Folgetage: komplett gleich wie Original

### Case 2: Effektiv (mit Haken "Folgetage neu berechnen")
- Tag heute: direktes Schedule-Update (kein generate)
- Ida von 9/12 → 9/13 → 9/12 bleibt mit 1 Person, 9/13 hat 3 Personen
- `generate(dayIdx+1)`: Folgetage mit neuen Stats frisch berechnet
- Vorherige Tage: unverändert

---

## XLSX-Export

### Strategie
Template als ZIP laden (JSZip), nur `xl/worksheets/sheet1.xml` per Regex patchen → **Styles/Farben/Bilder bleiben erhalten**.

### Was wird gepatcht
- `EE3` → Datum (Excel-Seriennummer)
- `slotNameRef(1..28)` → Personennamen
- `C11,C13,C15,C17,C19` → Positionsbeschriftungen
- Zeile 21 + Stundendaten → Slot-Map-Strategie
- HW-Overflow → Personen 5+ (inkl. Kranke) in verbleibende Slots

### 16 Stationsspalten
- Türme (mit zugewiesenen Booten)
- Freie Boote
- Wachführung (WF, WF2)
- Hauptwache (HW, HW2)
- **Reihenfolge konfigurierbar** via Drag-and-Drop

---

## Testing

### Browser-Preview + Invarianten-Check

```javascript
// Nach generate():
const invariants = {
  noDuplicates: /* jede Person max 1× pro Tag pro Slot */,
  noSick: /* kranke nicht eingeteilt */,
  noClosedTowers: /* geschlossene Türme nicht belegt */,
  slotCapacity: /* slotCount eingehalten */,
};
```

### Bekannte Test-Szenarien

- ✅ Baseline 6d/14d
- ✅ 1 Tag, alle Personen, 0 Personen
- ✅ Kranke Menschen
- ✅ Geschlossene Türme/Boote
- ✅ Boot außer Dienst → BF zum Turm
- ✅ Zwangszuweisungen (transparent/effektiv)
- ✅ Drag-and-Drop auf allen Tags
- ✅ Fuzz-Test 100× zufällige Muster

---

## Browser-Support

| Browser | Status |
|---------|--------|
| Chrome/Edge | ✅ |
| Firefox | ✅ |
| Safari | ✅ |
| Mobile | ⚠️ (Touch-D&D funktioniert, aber unoptimiert) |

---

## Performance

**Baseline:** ~20 ms für 28 Personen × 14 Tage (Maximalszenario)

Bei Regression >100 ms: Hot-Loop in `bestPair` prüfen (O(n²) über Guard-Pool).

---

## Bekannte Constraints

- Max. **28 Personen** im XLSX-Namensblock (4 Blöcke × 7 Zeilen)
- Max. **16 Stationsspalten** im Template
- Paarungs-Matrix nur bei 2–18 E/U-Personen sichtbar
- DAYS: 1–14 (veränderbar zur Laufzeit)
- Turm slotCount: 1–10
- Boot slotCount: 1–3

---

## Development

### Lokale Änderungen testen

```bash
# Terminal 1: Server starten
npm start

# Terminal 2: Code editieren + Browser F5 drücken
code Wachplan-Generator.html

# Browser: http://localhost:3000
```

### CLAUDE.md aktualisieren

Nach jedem Feature/Bugfix:
```bash
# CLAUDE.md im Projektstamm updaten
# (wird automatisch von Claude geladen)
```

---

## Git-Workflow

```bash
# Feature-Branch
git checkout -b feature/my-feature
git commit -m "..."
git push origin feature/my-feature

# PR gegen main via gh CLI
gh pr create --title "..." --body "..."
```

---

## Lizenz

MIT

---

## Support / Kontakt

- **Issues:** GitHub Issues
- **Questions:** Discussion Forum
- **NAS-Deployment:** Siehe [DOCKER.md](./DOCKER.md)

---

**Viel Erfolg mit der DLRG Wachplangeneration! 🎯**
