// ============================================================
// autoCodes.js – Automatische Stationscodes + TagesStatus-Reset
// ============================================================

/**
 * Vergibt Stationscodes (z. B. "9/12") an Türme und "78/x" an Boote,
 * sofern das jeweilige Code-Feld noch leer ist.
 * Bereits vergebene Codes werden dabei übersprungen.
 */
function autoCodes(){
  const tCodes = ['9/12','9/13','9/14','9/15','9/16','9/17','9/18','9/1','9/2'];
  const usedT  = new Set(towers.map(t => t.code).filter(Boolean));
  towers.forEach(t => {
    if(!t.code){
      for(const c of tCodes){
        if(!usedT.has(c)){ t.code = c; usedT.add(c); break; }
      }
    }
  });

  const usedB = new Set(boats.map(b => b.code).filter(Boolean));
  boats.forEach(b => {
    if(!b.code){
      for(let n = 1; n < 99; n++){
        const c = '78/' + n;
        if(!usedB.has(c)){ b.code = c; usedB.add(c); break; }
      }
    }
  });
}

/**
 * Erzeugt einen leeren dayState-Array für alle DAYS Tage.
 * Jeder Tag hat eigene Sets für kranke Personen, manuell
 * geschlossene Türme und Boote außer Dienst.
 */
function freshDayState(){
  return Array.from({ length: DAYS }, () => ({
    sick:        new Set(),
    absent:      new Set(),
    closed:      new Set(),
    closedBoats: new Set(),
  }));
}
