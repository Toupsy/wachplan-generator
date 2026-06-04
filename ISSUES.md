# UI/UX Probleme - Wachplan-Generator

Dokumentation von Problemen identifiziert in der Testumgebung und Code-Analyse.

---

## Issue 1: BF-Wachgänger × Button nicht aligned

**Priorität:** Medium  
**Bereich:** Sidebar Personen-Konfiguration (`public/js/render-sidebar.js`)

### Problem
Bei Bootsführern (BF) wird ein zusätzliches Dropdown-Feld "BF-Level" (BF-E/BF-U) angezeigt. Dies verursacht, dass der × Button (Delete) nicht in der gleichen Zeile ausgerichtet ist wie bei anderen Rollen (z.B. Führung).

### Struktur aktuell:
- **Führung:** Name | Rolle-Dropdown | × Button
- **Bootsführer:** Name | Rolle-Dropdown | BF-Level-Dropdown | × Button (rutscht raus!)

### Erwartetes Verhalten
Der × Button sollte immer in der gleichen Zeile und Position sein, unabhängig von der Rolle oder zusätzlichen Feldern.

### Mögliche Lösungen
1. **Besseres Layout:** CSS Grid oder Flexbox mit fester Spalten-Breite anpassen
2. **BF-Level in Modal:** BF-Level-Auswahl in ein Popover/Modal verschieben
3. **Kompakteres Dropdown:** BF-Level direkt im Rolle-Dropdown integrieren (z.B. "Bootsführer (E)" / "Bootsführer (U)")

### Code-Referenz
- `render-sidebar.js`, Zeilen 20-23

---

## Issue 2: Unklar beschriftete Turm-Kapazitäten (Wachgänger vs. Führungskräfte)

**Priorität:** High  
**Bereich:** Sidebar Turm-Konfiguration (`public/js/render-sidebar.js`)

### Problem
Bei der Turm-Konfiguration gibt es zwei Spinner nebeneinander:
- **Slot Spinner (Zahlenwert 1):** Anzahl normaler Wachgänger (`slotCount`)
- **Leader Spinner (👔 Symbol):** Anzahl benötigter Führungskräfte (`leaderCount`)

Diese sind optisch nicht ausreichend unterschieden und verwirren Nutzer über:
1. Welche Zahl bedeutet was?
2. Sind BEIDE Zahlen immer notwendig?

### Erwartetes Verhalten
- Klare Beschriftung: "Wachgänger" vs. "Führungskräfte"
- **Leader Spinner sollte nur mit Checkbox aktivierbar sein**, wenn Führungskräfte benötigt werden
- Bessere Icons/Labels für visuelle Unterscheidung

### Beispiel-UI
```
Turm 78
┌─────────────────────────────────────┐
│ Name: [Turm 78]  Code: [9/12]       │
│ Prio: [1]                           │
│                                     │
│ 👥 Wachgänger (slotCount):          │
│    [−] 2 [+]                        │
│                                     │
│ ☑ 👔 Führungskräfte benötigt:       │
│    [−] 0 [+]                        │
│    (nur wenn aktiviert)             │
└─────────────────────────────────────┘
```

### Code-Referenz
- `render-sidebar.js`, Zeilen 72-82

---

## Issue 3: Zu viele Boote generiert (Standard-Konfiguration)

**Priorität:** High  
**Bereich:** Daten/Algorithmus oder Seed-Logik

### Problem
In der Testumgebung werden 9 Boote generiert (Boot 78/1, 78/2, 9/12-9/18), obwohl die Standard-Konfiguration normalerweise nur wenige (2-3) Boote haben sollte.

**Beobachtungen:**
- Tägliche Ausgabe zeigt: "BOOT AUSSER DIENST" mit 9 Booten
- Warnung: "Personalmangel - geschlossen: Turm 78, Turm 9" deutet auf zu viele Slots hin
- Jeder Turm hat 2-6 Boote zugeordnet

### Mögliche Ursachen
1. Seed-Daten (`seed.js`) enthält zu viele Boote
2. `autoFillExportColumns()` generiert fälschlicherweise zusätzliche Boote
3. Importierte/cached Daten von früheren Tests

### Erwartetes Verhalten
- Standard-Konfiguration sollte 2-3 Boote haben (z.B. Boot 78/1, Boot 78/2)
- Nicht 9 verschiedene Boot-Nummern

### Aktionen
- [ ] Seed-Daten überprüfen (`public/js/seed.js`)
- [ ] Boote-Generierungs-Logik überprüfen
- [ ] localStorage cache löschen und neu testen

---

## Issue 4: "Nur diesen Tag drucken" zeigt nur Statistik statt Zuordnung

**Priorität:** High  
**Bereich:** Print-Funktionalität (`public/js/render-output.js`)

### Problem
Knopf "Diesen Tag drucken" (zu sehen oben rechts neben "Alle Tage drucken") gibt nur die **Statistik-Bar** aus:
- Statistiken (Paare, Wiederholungen, U+U, etc.)
- Keine **Tages-Zuordnungen** (Türme, Boote, Personen)

Erwartet: Gleiche Ausgabe wie "Alle Tage drucken", aber nur für einen Tag.

### Erwartetes Verhalten
"Nur diesen Tag drucken" sollte:
1. Die Turm-Karten für den aktuellen Tag zeigen
2. Die Boot-Zuordnungen zeigen
3. Die Personen-Verteilung zeigen
4. (Optional) Statistiken einblenden

**Nicht:** Nur Statistiken zeigen.

### Code-Referenz
Wahrscheinlich in `render-output.js` bei Print-CSS oder Print-Logik
- `.out-extras { display:none !important; }` beim Druck?
- Falscher Bereich wird als printable markiert?

---

## Issue 5: Führungskräfte-Spinner nicht intuitiv

**Priorität:** Medium  
**Bereich:** UX/Interaction Design

### Problem
Der "Leader Spinner" (👔) hat kein beschreibendes Label oder ist nicht selbsterklärend.

### Kontext
- Der Nutzer muss manuell herausfinden, dass "👔" Führungskräfte bedeutet
- Es ist unklar, ob dieser Spinner immer relevant ist oder optional

### Erwartetes Verhalten
- **Label hinzufügen:** "Führungskräfte auf diesem Turm"
- **Checkbox + Spinner:** Spinner nur aktiv wenn Checkbox aktiviert
- **Tooltip/Hilfe:** Kurze Erklärung was "Führungskräfte" bedeutet

---

## Zusammenfassung nach Priorität

### 🔴 Hoch Priorität (blockt User)
- **Issue 3:** Zu viele Boote → verwirrt Nutzer über reale Konfiguration
- **Issue 4:** Print-Funktion kaputt → wichtig für Druck-Workflow
- **Issue 2:** Unklar beschriftete Kapazitäten → User macht Fehler bei Konfiguration

### 🟡 Mittlere Priorität
- **Issue 1:** UI Alignment → unprofessionell wirkend
- **Issue 5:** UX Intuitivität → nutzer frustrieren

---

## Test-Schritte für Validierung

```bash
# 1. Lokale Umgebung aufsetzen
npm start

# 2. Standard-Seed testen
- localStorage löschen
- App neuladen
- Boote-Anzahl überprüfen (sollte 2-3 sein, nicht 9)

# 3. BF Personen-Zeile testen
- Führung hinzufügen → × aligned
- Bootsführer hinzufügen → × aligned?

# 4. Druck testen
- "Alle Tage drucken" → zeigt Turm-Karten?
- "Nur diesen Tag drucken" → zeigt Turm-Karten?

# 5. Turm-Konfiguration
- Führungskräfte Spinner testen
- Ist es klar, welche Zahl was ist?
```
