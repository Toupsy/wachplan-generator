// ============================================================
// dates.js – Datum-Berechnung für die 6 Plan-Tage
// ============================================================

/**
 * Gibt ein Array mit DAYS ISO-Datumsstrings zurück ('YYYY-MM-DD').
 *
 * Bugfix: Frühere Version nutzte Date.toISOString() (UTC), was in
 * Zeitzonen östlich von UTC zu einem Off-by-one-Fehler führte
 * (z.B. UTC+2: Mitternacht lokal = 22:00 UTC → falscher Vortag).
 * Jetzt wird ausschließlich lokale Datumsarithmetik verwendet.
 */
function computeDayDates(){
  const r = Array(DAYS).fill('');
  if(!startDate) return r;
  const [y, m, d] = startDate.split('-').map(Number);
  if(!y || !m || !d) return r;
  for(let i = 0; i < DAYS; i++){
    const dt = new Date(y, m - 1, d + i);   // lokale Zeit, kein UTC-Shift
    r[i] = dt.getFullYear() + '-'
      + String(dt.getMonth() + 1).padStart(2, '0') + '-'
      + String(dt.getDate()).padStart(2, '0');
  }
  return r;
}

/**
 * Lesbares Label für Tag d.
 * Mit Startdatum: "Mo, 02.07." – ohne: "Tag 1" usw.
 */
function dayLabel(d){
  const dates = computeDayDates();
  if(!dates[d]) return DAYNAMES[d];
  const [y, mo, day] = dates[d].split('-').map(Number);
  return new Date(y, mo - 1, day)
    .toLocaleDateString('de-DE', { weekday:'short', day:'2-digit', month:'2-digit' });
}
