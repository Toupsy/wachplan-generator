// ============================================================
// export.js – XLSX- und CSV-Export
// ============================================================
// Export-Strategie: JSZip öffnet das Template als ZIP, patcht
// nur die Datenzellen im sheet1.xml per Regex (alle s="-Attribute
// und sonstiges Formatting bleiben 1:1 erhalten), und speichert
// das Ergebnis als neue Datei. SheetJS wird NUR noch für den
// CSV-Export und für buildAssignments verwendet.
// ============================================================

// ── Mapping-Konstanten ───────────────────────────────────────────
const SLOT_ROWS_X  = [7,9,11,13,15,17,19];
const SLOT_NAMECOL = [43,76,109,142];
const HOUR_ROWS_X  = {
  '08:00':[23,24],'09:00':[25,26],'10:00':[27,28],'11:00':[29,30],
  '12:00':[31,32],'13:00':[33,34],'14:00':[35,36],'15:00':[37,38],
  '16:00':[39,40],'17:00':[41,42],'18:00':[43,44],'19:00':[45,46],
};
// Template-Stationsspalten (Spaltennummern der 16 Stationsblöcke in Zeile 21)
const TEMPLATE_STATION_COLS = [21,27,33,39,45,51,57,63,69,75,81,87,93,99,117,123];

/** Erzeugt Stundenraster basierend auf serviceStartHour und serviceEndHour.
 * Clampt auf 08–19 (verfügbare HOUR_ROWS_X-Einträge), erzwingt end >= start.
 */
function fillHours(){
  const start = Math.max(8, Math.min(19, serviceStartHour|0));
  const end   = Math.max(start, Math.min(19, serviceEndHour|0));
  const out = [];
  for(let h = start; h <= end; h++) {
    out.push(String(h).padStart(2,'0') + ':00');
  }
  return out.filter(hr => HOUR_ROWS_X[hr]); // nur Stunden mit Template-Zeilen
}

/** Baut aus exportColumns eine Code→Spalte-Map. Wird zur Laufzeit aufgerufen. */
function getStationColX(){
  const map = {};
  TEMPLATE_STATION_COLS.forEach((col, i) => {
    const code = (exportColumns[i] || '').trim();
    if(code) map[code] = col;
  });
  return map;
}

// ── Hilfsfunktionen ──────────────────────────────────────────────

/** Spaltennummer → Excel-Buchstabe(n)  (1→A, 27→AA …) */
function colLetter(n){
  let s=''; while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);} return s;
}

/** 1-basierte Slot-Nr → Zellreferenz im Namens-Block */
function slotNameRef(nr){
  const b=Math.floor((nr-1)/7), i=(nr-1)%7;
  return colLetter(SLOT_NAMECOL[b])+SLOT_ROWS_X[i];
}

/** ISO-Datum → Excel-Seriennummer */
function excelSerial(iso){
  const [y,m,d]=iso.split('-').map(Number);
  return Math.round((Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/86400000);
}

// personNr() ist in utils.js definiert (wird vor export.js geladen).

/** Besetzungsdaten für einen Tag aufbereiten (code → [Nr, Nr]) */
/**
 * Besetzungsdaten für einen Tag aufbereiten.
 * Türme: alle Besatzer (kein slice) – Überlauf >2 wird in _patchSheetXml direkt daneben platziert.
 * Kranke: werden der HW-Liste zugerechnet und erscheinen im Export bei HW.
 * HW-Overflow: wird automatisch über adjacent columns in _patchSheetXml gehandelt (keine HW2 nötig).
 */
function buildAssignments(dayIdx){
  const d = lastResult.schedule[dayIdx];
  const A = {};
  d.assign.forEach(slot => {
    if(slot.kind==='tower' && slot.code)
      A[slot.code] = slot.occupants.map(p=>personNr(p.id)).filter(n=>n!=null);
    else if(slot.kind==='boat' && slot.code && slot.occupants?.length){
      const nums = slot.occupants.map(p=>personNr(p.id)).filter(n=>n!=null);
      if(nums.length) A[slot.code] = nums;
    }
  });
  const main = d.assign.find(s=>s.kind==='main');
  if(main){
    const f=main.fuehrung.map(p=>personNr(p.id)).filter(n=>n!=null);
    if(f.length)    A['WF'] =f.slice(0,2);
    if(f.length>2)  A['WF2']=f.slice(2,4);
    const allHW=[...main.mainGuards,...main.base,...main.bootsfLeft,...(main.sick||[])]
      .map(p=>personNr(p.id)).filter(n=>n!=null);
    if(allHW.length)   A['HW']  = allHW; // alle HW → Overflow inline via _patchSheetXml

    if(main.hwBoatSlot?.bootsf){
      const boCode = getBoat(main.hwBoatSlot.boatId)?.code;
      if(boCode) A[boCode] = [personNr(main.hwBoatSlot.bootsf.id)].filter(n=>n!=null);
    }
  }
  return A;
}

// ── Template-Lade-Logik ───────────────────────────────────────────
const TEMPLATE_LS_KEY = 'dlrg_wachplan_template_b64';

function _templateFromCache(){
  try {
    const b64 = localStorage.getItem(TEMPLATE_LS_KEY);
    if(!b64) return null;
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } catch(_){ return null; }
}

async function _loadTemplate(){
  try {
    const r = await fetch('Wachplan Template.xlsx');
    if(!r.ok) throw new Error('Template nicht verfügbar');
    const arr = new Uint8Array(await r.arrayBuffer());
    _cacheTemplate(arr);
    return arr;
  } catch(e){
    const cached = _templateFromCache();
    if(cached) return cached;
    throw e;
  }
}

function _cacheTemplate(arr){
  try {
    let b64 = '';
    const chunk = 9000;   // Vielfaches von 3 → kein ==-Padding in Zwischen-Chunks
    for(let i = 0; i < arr.length; i += chunk)
      b64 += btoa(String.fromCharCode(...arr.subarray(i, i + chunk)));
    localStorage.setItem(TEMPLATE_LS_KEY, b64);
  } catch(_){}
}

// ── XML-Patch-Logik ───────────────────────────────────────────────
// Wir patchen ausschließlich die sheet1.xml im ZIP.
// Alle anderen Dateien (styles.xml, drawings, sharedStrings …)
// bleiben unverändert → Farben, Rahmen, Bilder, Schutz bleiben erhalten.

function _escXml(s){
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Sammelt Patches für batch-weise Anwendung.
 * @returns {Map} ref → {type, value}
 */
function _createPatchMap(){
  return new Map();
}

/**
 * Wendet alle Patches aus einer Map mit einem Durchlauf an.
 * Findet alle <c r="...">-Zellen, schlägt in der Map nach, ersetzt Wert.
 * Fehlende Zellen werden separat gesammelt und gebündelt eingefügt.
 *
 * @param {string} xml       – worksheet XML
 * @param {Map}   patchMap   – ref → {type, value}
 * @returns {string}         – gepatchtes XML
 */
function _applyPatches(xml, patchMap){
  if(patchMap.size === 0) return xml;

  const missing = [];
  let result = xml;

  // Ein globaler Durchlauf über alle vorhandenen <c r="...">`-Zellen
  const cellRegex = /(<c [^>]*?r="([A-Z0-9]+)"[^>]*?)(?:(\/?>)|>([\s\S]*?)<\/c>)/g;

  result = result.replace(cellRegex, (match, openAttrs, ref, selfClose, content) => {
    const patch = patchMap.get(ref);
    if(!patch) return match;  // Keine Änderung für diese Zelle

    const { type, value } = patch;
    // Vorhandenes t="-Attribut entfernen (wird ggf. neu gesetzt)
    const attrs = openAttrs.replace(/\s+t="[^"]*"/, '');

    if(type === 'n')
      return `${attrs}><v>${value}</v></c>`;
    else
      return `${attrs} t="inlineStr"><is><t>${_escXml(value)}</t></is></c>`;
  });

  // Fehlende Zellen sammeln
  patchMap.forEach((patch, ref) => {
    // Prüfe ob ref in result existiert
    const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const testRe = new RegExp(`<c [^>]*?r="${esc}"[^>]*?(?:\\/>|>)`);
    if(!testRe.test(result)){
      missing.push({ ref, ...patch });
    }
  });

  // Fehlende Zellen einfügen
  if(missing.length > 0){
    result = _insertMissingCells(result, missing);
  }

  return result;
}

/**
 * Fügt fehlende Zellen gebündelt ein (pro Zeile gruppiert, spalten-sortiert).
 * Wahrung der OOXML-Spezifikation: Zellen innerhalb einer Zeile müssen
 * in aufsteigender Spalten-Reihenfolge angeordnet sein.
 */
function _insertMissingCells(xml, missing){
  if(!missing.length) return xml;

  // Nach Zeilennummern gruppieren
  const byRow = {};
  missing.forEach(({ ref, type, value }) => {
    const rowNum = ref.match(/\d+/)[0];
    if(!byRow[rowNum]) byRow[rowNum] = [];
    byRow[rowNum].push({ ref, type, value });
  });

  let result = xml;

  // Pro Zeile Zellen am richtigen Ort einfügen
  Object.entries(byRow).forEach(([rowNum, cells]) => {
    // Sortiere fehlende Zellen nach Spalten-Nummer (aufsteigend)
    cells.sort((a, b) => _colToNum(a.ref.replace(/\d+/, '')) - _colToNum(b.ref.replace(/\d+/, '')));

    const rowRe = new RegExp(`(<row [^>]*?r="${rowNum}"[^>]*>)([\\s\\S]*?)(</row>)`);
    if(rowRe.test(result)){
      result = result.replace(rowRe, (_, open, content, close) => {
        let newContent = content;

        // Für jede fehlende Zelle, bestimme die spalten-sortierte Einfüge-Position
        cells.forEach(({ ref, type, value }) => {
          const missingColNum = _colToNum(ref.replace(/\d+/, ''));
          const cellStr = type === 'n'
            ? `<c r="${ref}"><v>${value}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t>${_escXml(value)}</t></is></c>`;

          // Suche die erste existierende Zelle in newContent mit höherem Spalten-Index
          const cellRegex = /<c [^>]*?r="([A-Z0-9]+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
          let m;
          let insertPos = newContent.length; // Default: am Ende der Zeile
          while((m = cellRegex.exec(newContent)) !== null){
            const existingColNum = _colToNum(m[1].replace(/\d+/, ''));
            if(existingColNum > missingColNum){
              // Füge VOR dieser Zelle ein (spalten-sortiert)
              insertPos = m.index;
              break;
            }
          }

          newContent = newContent.slice(0, insertPos) + cellStr + newContent.slice(insertPos);
        });

        return open + newContent + close;
      });
    } else {
      // Zeile existiert nicht – neu erstellen
      const cellStrs = cells.map(({ ref, type, value }) =>
        type === 'n'
          ? `<c r="${ref}"><v>${value}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t>${_escXml(value)}</t></is></c>`
      ).join('');

      // Vor der nächsten höheren Zeilennummer einfügen
      let inserted = false;
      result = result.replace(/<row /g, (match, offset) => {
        if(inserted) return match;
        const rn = result.slice(offset).match(/r="(\d+)"/);
        if(rn && +rn[1] > +rowNum){
          inserted = true;
          return `<row r="${rowNum}">${cellStrs}</row><row `;
        }
        return match;
      });
    }
  });

  return result;
}

function _colToNum(col){
  let n = 0;
  for(const ch of col.toUpperCase()) n = n*26 + (ch.charCodeAt(0)-64);
  return n;
}

/**
 * Hauptfunktion: Sammelt alle Patches und wendet sie mit einem Durchlauf an.
 */
function _patchSheetXml(xml, dayIdx){
  const patches = _createPatchMap();

  // ── Datum ────────────────────────────────────────────────────
  const iso = computeDayDates()[dayIdx];
  if(iso) patches.set('EE3', { type: 'n', value: excelSerial(iso) });

  // ── Besetzungsliste (Namen 1–28) ─────────────────────────────
  for(let n = 1; n <= 28; n++){
    const ref = slotNameRef(n);
    const p   = people[n-1];
    patches.set(ref, { type: 's', value: p ? (p.name||'') : '' });
  }

  // ── Positionsbeschriftungen ──────────────────────────────────
  [11,13,15,17,19].forEach((row, i) => {
    const desc = positionDescriptions[i+3];
    if(desc) patches.set('C'+row, { type: 's', value: desc });
  });

  // ── Effektives Spalten-Layout ────────────────────────────────────
  // Iteriert exportColumns der Reihe nach; leere Slots werden übersprungen.
  // Hat eine Station >2 Personen, belegt der Überlauf die nächste Template-Spalte
  // direkt rechts – alle nachfolgenden Stationen rücken entsprechend nach rechts.
  const A = buildAssignments(dayIdx);
  const effectiveCols = [];   // { col:number, code:string, nums:[nr,...] }
  let tplIdx = 0;

  for(const rawCode of exportColumns){
    const code = (rawCode || '').trim();
    if(!code) continue;
    if(tplIdx >= TEMPLATE_STATION_COLS.length) break;

    const nums = A[code] || [];
    effectiveCols.push({ col: TEMPLATE_STATION_COLS[tplIdx++], code, nums: nums.slice(0, 2) });

    // Overflow-Spalten direkt nebeneinander (Person 3, 4, 5 … in Paaren)
    for(let i = 2; i < nums.length; i += 2){
      if(tplIdx >= TEMPLATE_STATION_COLS.length) break;
      effectiveCols.push({ col: TEMPLATE_STATION_COLS[tplIdx++], code, nums: nums.slice(i, i + 2) });
    }
  }

  // Stationscodes in Zeile 21 + Stundendaten schreiben
  effectiveCols.forEach(({ col, code, nums }) => {
    patches.set(colLetter(col)+'21', { type: 's', value: code });
    fillHours().forEach(hr => {
      const [rt, rb] = HOUR_ROWS_X[hr];
      if(nums[0] != null) patches.set(colLetter(col)+rt, { type: 'n', value: nums[0] });
      if(nums[1] != null) patches.set(colLetter(col)+rb, { type: 'n', value: nums[1] });
    });
  });

  // HW-Überlauf: Personen 5+ (inkl. Kranke) → verbleibende Template-Spalten
  const main = lastResult.schedule[dayIdx].assign.find(s => s.kind === 'main');
  if(main){
    const allHWNrs = [...main.mainGuards, ...main.base, ...main.bootsfLeft, ...(main.sick||[])]
      .map(p => personNr(p.id)).filter(n => n != null);
    const overflowHW = allHWNrs.slice(4);
    for(let i = 0; i < overflowHW.length; i += 2){
      if(tplIdx >= TEMPLATE_STATION_COLS.length) break;
      const col = TEMPLATE_STATION_COLS[tplIdx++];
      patches.set(colLetter(col)+'21', { type: 's', value: 'HW' });
      const nr1 = overflowHW[i], nr2 = overflowHW[i+1];
      fillHours().forEach(hr => {
        const [rt, rb] = HOUR_ROWS_X[hr];
        if(nr1 != null) patches.set(colLetter(col)+rt, { type: 'n', value: nr1 });
        if(nr2 != null) patches.set(colLetter(col)+rb, { type: 'n', value: nr2 });
      });
    }
  }

  return _applyPatches(xml, patches);
}

// ── Offizieller XLSX-Export ───────────────────────────────────────

async function exportOfficial(dayIdx){
  if(!lastResult){ alert('Bitte zuerst Plan generieren.'); return; }

  if(people.length > 28){
    const ok = confirm(
      `⚠️ Das DLRG-Formular fasst nur 28 Personen im Namensblock.\n` +
      `Aktuell sind ${people.length} Personen erfasst – Personen 29+ erscheinen ` +
      `als Nummer ohne Namenszuordnung.\n\nTrotzdem exportieren?`
    );
    if(!ok) return;
  }

  if(typeof JSZip === 'undefined'){
    alert('JSZip lädt noch – bitte kurz warten.');
    return;
  }

  try {
    const arr = await _loadTemplate();
    const zip  = await JSZip.loadAsync(arr);

    // Sheet-Pfad ermitteln (i.d.R. sheet1.xml)
    const sheetPath = Object.keys(zip.files)
      .filter(f => f.match(/xl\/worksheets\/sheet\d+\.xml$/))
      .sort()[0] || 'xl/worksheets/sheet1.xml';

    const origXml    = await zip.file(sheetPath).async('string');
    const patchedXml = _patchSheetXml(origXml, dayIdx);
    zip.file(sheetPath, patchedXml);

    const out  = await zip.generateAsync({ type:'uint8array', compression:'DEFLATE' });
    const iso  = computeDayDates()[dayIdx];
    const fn   = (iso || ('Tag'+(dayIdx+1))) + '_Wachplan.xlsx';
    const blob = new Blob([out], { type:'application/octet-stream' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = fn;
    a.click();
  } catch(e){
    alert('Export fehlgeschlagen: ' + e.message);
    console.error('XLSX Export Error:', e);
  }
}

// ── CSV-Export ───────────────────────────────────────────────────

function exportCSV(){
  const {schedule}=lastResult;
  const rows=[['Tag','Standort','Code','Typ','Position','Person','Rolle','Labels']];
  schedule.forEach(d=>{
    const dn=dayLabel(d.day);
    d.assign.forEach(slot=>{
      if(slot.kind==='main'){
        slot.fuehrung.forEach(p   =>rows.push([dn,slot.tower,'','Zentrale','Führung',p.name,roleLabel(p),p.labels||'']));
        slot.mainGuards.forEach(p =>rows.push([dn,slot.tower,'','Zentrale','HW-Wache',p.name,roleLabel(p),p.labels||'']));
        slot.base.forEach(p       =>rows.push([dn,slot.tower,'','Zentrale','HW',p.name,roleLabel(p),p.labels||'']));
        slot.bootsfLeft.forEach(p =>rows.push([dn,slot.tower,'','Zentrale','Bootsf. HW',p.name,roleLabel(p),p.labels||'']));
        if(slot.hwBoatSlot?.bootsf)
          rows.push([dn,slot.hwBoatSlot.name,getBoat(slot.hwBoatSlot.boatId)?.code||'','HW-Boot','Bootsführer',slot.hwBoatSlot.bootsf.name,roleLabel(slot.hwBoatSlot.bootsf),slot.hwBoatSlot.bootsf.labels||'']);
        slot.sick.forEach(p       =>rows.push([dn,slot.tower,'','Zentrale','A. D.',p.name,roleLabel(p),p.labels||'']));
      } else if(slot.kind==='tower'){
        slot.occupants.forEach(p  =>rows.push([dn,slot.tower,slot.code||'','Turm','Wachgänger',p.name,roleLabel(p),p.labels||'']));
      } else if(slot.kind==='boat' && slot.occupants && slot.occupants.length > 0){
        slot.occupants.forEach(p  =>rows.push([dn,slot.name,slot.code||'','Boot','Bootsführer',p.name,roleLabel(p),p.labels||'']));
      }
    });
    [...d.manualClosed,...d.personnelClosed].forEach(t=>rows.push([dn,t.name,t.code||'','Turm','GESCHLOSSEN','','','']));
    [...d.boatsManualClosed,...d.boatsClosedTower,...d.boatsNoBootsf].forEach(b=>rows.push([dn,b.name,b.code||'','Boot','GESCHLOSSEN','','','']));
  });
  const csv =rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const a   =document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='wachplan.csv'; a.click();
}

// ── CSV-Export Fairness-Statistik ───────────────────────────────

function exportStatsCSV(){
  if(!lastResult?.stats){ showToast('Erst einen Plan generieren'); return; }
  const { stats } = lastResult;
  const header = ['Nr','Person','Rolle','Einsätze gesamt','HW-Tage','Türme (unique)','Turmbesuche gesamt','Boot-Tage','Tage Turm+Boot'];
  const rows = [header];
  people.forEach((p, i) => {
    const s = stats[p.id] || {};
    const towerVisits   = s.towerVisits || {};
    const uniqueTowers  = Object.keys(towerVisits).length;
    const totalTowerVis = Object.values(towerVisits).reduce((a,b)=>a+b,0);
    const boatDays      = Object.values(s.boatVisits || {}).reduce((a,b)=>a+b,0);
    rows.push([
      i+1, p.name, roleLabel(p),
      s.total || 0, s.hwVisits || 0,
      uniqueTowers, totalTowerVis,
      boatDays, s.towerWithBoatDays || 0
    ]);
  });
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿'+csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wachplan-statistik.csv';
  a.click();
}

// ── iCalendar (.ics) Export pro Person ───────────────────────────

/** Generiert UUID v4 (für VEVENT-UIDs). */
function _generateUUID(){
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/** Konvertiert lokales Datum und Uhrzeit zu iCalendar FORMAT (YYYYMMDDTHHMMSS). */
function _toICalDateTime(dateStr, hour, minute = 0){
  const [y, m, d] = dateStr.split('-').map(Number);
  const padZero = (n) => String(n).padStart(2, '0');
  return `${y}${padZero(m)}${padZero(d)}T${padZero(hour)}${padZero(minute)}00`;
}

/** Escaped iCalendar TEXT-Werte (Komma, Semikolon, Backslash, Zeilenumbruch). */
function _escapeICalText(s){
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Exportiert den Wachplan einer Person als .ics-Datei.
 * Sammelt alle Tage, an denen die Person Dienst hat, und erzeugt ein VEVENT pro Dienst.
 */
function exportPersonalICS(personId){
  if(!lastResult){ showToast('Erst einen Plan generieren'); return; }
  if(!startDate){ showToast('Startdatum erforderlich'); return; }

  const person = people.find(p => p.id === personId);
  if(!person){ showToast('Person nicht gefunden'); return; }

  const dayDates = computeDayDates();
  const events = [];

  lastResult.schedule.forEach((day, dayIdx) => {
    const dateStr = dayDates[dayIdx];
    if(!dateStr) return;

    const dayServices = [];

    day.assign.forEach(slot => {
      // Türme
      if(slot.kind === 'tower'){
        const hasPersonId = slot.occupants.some(p => p.id === personId);
        if(hasPersonId){
          dayServices.push({
            station: slot.tower,
            code: slot.code || '',
            type: 'Turm'
          });
        }
      }
      // Boote
      else if(slot.kind === 'boat' && slot.occupants){
        const hasPersonId = slot.occupants.some(p => p.id === personId);
        if(hasPersonId){
          dayServices.push({
            station: slot.name,
            code: slot.code || '',
            type: 'Boot'
          });
        }
      }
      // Hauptwache (Führung, Wache, Bootsführer, etc.)
      else if(slot.kind === 'main'){
        const inFuehrung  = slot.fuehrung.some(p => p.id === personId);
        const inGuards    = slot.mainGuards.some(p => p.id === personId);
        const inBase      = slot.base.some(p => p.id === personId);
        const inBootsfLeft = slot.bootsfLeft.some(p => p.id === personId);
        const inHWBoat    = slot.hwBoatSlot?.bootsf?.id === personId;
        const isSick      = slot.sick?.some(p => p.id === personId);

        if(inFuehrung || inGuards || inBase || inBootsfLeft){
          dayServices.push({
            station: 'Hauptwache',
            code: 'HW',
            type: 'Wache'
          });
        }
        if(inHWBoat){
          const boatName = slot.hwBoatSlot?.name || 'HW-Boot';
          const boatCode = slot.hwBoatSlot?.code || '';
          dayServices.push({
            station: boatName,
            code: boatCode,
            type: 'Boot'
          });
        }
        // Kranke werden NICHT als Event exportiert
      }
    });

    // Pro Dienst an diesem Tag ein VEVENT
    dayServices.forEach(svc => {
      const uid = _generateUUID();
      const dtstart = _toICalDateTime(dateStr, serviceStartHour);
      const dtend   = _toICalDateTime(dateStr, serviceEndHour);
      const summary = `${svc.station} (${svc.type})`;
      const location = svc.code;
      const description = `${svc.type} Dienst: ${svc.station}`;

      events.push({
        uid, dtstart, dtend, summary, location, description
      });
    });
  });

  // iCalendar-Format
  let ics = 'BEGIN:VCALENDAR\r\n';
  ics += 'VERSION:2.0\r\n';
  ics += 'PRODID:-//DLRG Wachplan Generator//EN\r\n';
  ics += 'CALSCALE:GREGORIAN\r\n';
  ics += `X-WR-CALNAME:Wachplan - ${_escapeICalText(person.name)}\r\n`;
  ics += 'BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin\r\n';
  ics += 'BEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\n';
  ics += 'BEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\n';
  ics += 'END:VTIMEZONE\r\n';

  events.forEach(e => {
    ics += 'BEGIN:VEVENT\r\n';
    ics += `UID:${e.uid}\r\n`;
    ics += `DTSTART:${e.dtstart}\r\n`;
    ics += `DTEND:${e.dtend}\r\n`;
    ics += `SUMMARY:${_escapeICalText(e.summary)}\r\n`;
    if(e.location) ics += `LOCATION:${_escapeICalText(e.location)}\r\n`;
    ics += `DESCRIPTION:${_escapeICalText(e.description)}\r\n`;
    ics += `DTSTAMP:${_toICalDateTime(new Date().toISOString().slice(0,10), new Date().getHours(), new Date().getMinutes())}\r\n`;
    ics += 'END:VEVENT\r\n';
  });

  ics += 'END:VCALENDAR';

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wachplan-${person.name.replace(/\s+/g, '-').toLowerCase()}.ics`;
  a.click();

  showToast(`📅 Kalender-Export für ${person.name} heruntergeladen`);
}
