// ============================================================
// dates.js – Datum-Berechnung für die 6 Plan-Tage
// ============================================================

/**
 * Gibt ein Array mit DAYS ISO-Datumsstrings zurück ('YYYY-MM-DD').
 * Wenn kein Startdatum gesetzt ist, werden leere Strings geliefert.
 */
function computeDayDates(){
  const r = Array(DAYS).fill('');
  if(!startDate) return r;
  const base = new Date(startDate + 'T00:00:00');
  if(isNaN(base.getTime())) return r;
  for(let d = 0; d < DAYS; d++){
    const dt = new Date(base.getTime() + d * 86400000);
    r[d] = dt.toISOString().slice(0, 10);
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
  return new Date(dates[d] + 'T00:00:00')
    .toLocaleDateString('de-DE', { weekday:'short', day:'2-digit', month:'2-digit' });
}
