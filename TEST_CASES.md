# Wachplan-Generator – Test Cases

## Test-Basis: Beispiel-Daten
- 8 Personen: 2 Führung (F), 2 Bootsführer (B), 2 Erfahren (E), 2 Unerfahren (U)
- 3 Türme: T12 (Prio 5), T34 (Prio 3), T56 (Prio 1)
- 3 Boote: Boot-T12, Boot-T34, Boot-Frei
- 6 Tage
- mainK = 2

---

## 1. **Basis-Algorithmus**
- [ ] Plan generieren → alle 6 Tage mit Personen besetzt
- [ ] Fairness-Rotation: Personen sollten ähnlich oft eingesetzt werden
- [ ] E+U Mischung: Keine UU-Kombinationen außer bei Notwendigkeit
- [ ] Tower-Besetzung: Jeder offene Tower hat 2 Personen
- [ ] Boot-Besetzung: Jedes Boot hat 1 Bootsführer

---

## 2. **Zwangszuweisungen (forcedPlacements)**
- [ ] Effective (transparent=false): Person aus Pool entfernt, Folgetage beeinflussen
  - Person A auf Tag 1 zu Tower T12 fixieren
  - Person A sollte NICHT in anderen Türmen Tag 1 auftauchen
  - Tag 2: Person A sollte weniger oft wieder in Türmen auftauchen (Stats erhöht)
- [ ] Transparent (transparent=true): Person bleibt im Pool, nur Anzeige überschrieben
  - Person B auf Tag 2 zu Tower T34 fixieren (transparent=true)
  - Tag 3: Person B sollte GLEICH oft in Türmen auftauchen (Stats unverändert)

---

## 3. **Krank-Meldungen (dayState.sick)**
- [ ] Person krank Tag 2 → erscheint nicht in Türmen/Booten Tag 2
- [ ] Kranke Person in HW-Überlauf angezeigt
- [ ] Mehrere kranke Personen → Plan passt sich an

---

## 4. **Turm-Schließung (dayState.closed)**
- [ ] Tower T12 auf Tag 3 schließen → keine Besetzung auf T12 Tag 3
- [ ] Boote an geschlossenem Tower → Fehler-Badge "Boot zu (Turm zu)"
- [ ] Alternativ-Türme füllen sich

---

## 5. **Boot-Schließung (dayState.closedBoats)**
- [ ] Boot auf Tag 2 außer Dienst → nicht besetzt Tag 2
- [ ] Bootsführer geht nicht an dieses Boot → geht zu andere Boot oder HW

---

## 6. **HW-Boot (Feature 6)**
- [ ] HW-Boot konfigurieren → erscheint in Tagen
- [ ] HW-Boot mit Bootsführer → Code-Spalte benutzt
- [ ] HW-Boot keine BF verfügbar → Warn-Badge

---

## 7. **Export-Struktur (buildAssignments)**
- [ ] exportColumns konfiguriert (z.B. [78/1, 9/12, '', WF, HW, ..., HW2])
- [ ] Überlauf > 2 Personen → inline nächste Spalte
- [ ] HW mit >2 Personen + HW2 konfiguriert → Split auf HW/HW2
- [ ] HW ohne HW2 → alle in HW inline

---

## 8. **CSV-Export**
- [ ] Alle Tage exportiert
- [ ] Alle Slot-Typen (Tower, Boot, HW, HW-Boot, geschlossen) präsent
- [ ] Kranke Personen mit KRANK-Badge
- [ ] Zwangsweise fixierte Personen korrekt gelistet

---

## 9. **XLSX-Export (wenn Template verfügbar)**
- [ ] Template lädt
- [ ] Datum in EE3
- [ ] Personennamen in Namensblöcke (C7, C9, C11, ...)
- [ ] Stationscodes in Spalte 21
- [ ] Personennummern in Stundenraster (09:00–17:00)
- [ ] Overflow-Paare inline daneben

---

## 10. **State Import/Export**
- [ ] `exportStateJSON()` → JSON mit allen Daten
- [ ] `importStateJSON()` → alles wiederhergestellt
- [ ] Fehlende Felder in altem Export → Defaults
- [ ] localStorage Autosave → automatisch geladen beim Reload

---

## 11. **Bewegung (move.js)**
- [ ] Person zwischen Türmen tauschen → Statistik korrekt
- [ ] Person zu Hauptwache → entfernt aus Tower
- [ ] Person zu Boot → Bootsführer-Rolle überprüft
- [ ] "Folgetage neu berechnen" an/aus → transparent-Flag wirkt

---

## 12. **UI-Interaktion**
- [ ] Krank-Chip klicken → Plan neu berechnet
- [ ] Turm-Schließung klicken → Plan neu berechnet
- [ ] Fixierungen löschen → Plan neu berechnet
- [ ] Tab-Wechsel → richtige Tages-Ansicht

---

## 13. **Edge Cases**
- [ ] Nur 1 Erfahren, Rest Unerfahren → UU-Warnung
- [ ] Alle Bootsführer krank → Fehler-Badge
- [ ] Zu wenig Personen → Felder leer lassen
- [ ] Max 28 Personen → alle in Namensblock passen
- [ ] 14 Tage → alles funktioniert

---

## Test-Status (nach Optimierungen)
- [x] Syntaktische Überprüfung
- [ ] Funktionale Tests (braucht Server)
