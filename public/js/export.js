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
 * Setzt den Wert einer Zelle im XML-String.
 * Sucht <c r="REF" ...> (self-closing oder mit Inhalt) und ersetzt nur den Inhalt;
 * alle anderen Attribute (s=, ...) bleiben unberührt.
 *
 * @param {string}  xml   – worksheet XML
 * @param {string}  ref   – Zellreferenz, z.B. "AQ7"
 * @param {'n'|'s'} type  – 'n' = Zahl, 's' = Inline-String
 * @param {*}       value – zu schreibender Wert
 */
function _patchCell(xml, ref, type, value){
  const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Findet self-closing: <c r="REF" .../> oder mit Inhalt: <c r="REF" ...>...</c>
  const re = new RegExp(`(<c [^>]*?r="${esc}"[^>]*?)(?:\\/>|>(?:[\\s\\S]*?)<\\/c>)`);
  if(!re.test(xml)){
    // Zelle existiert nicht → in die passende Zeile einfügen
    return _insertCell(xml, ref, type, value);
  }
  return xml.replace(re, (_, openAttrs) => {
    // Vorhandenes t="-Attribut entfernen (wird ggf. neu gesetzt)
    const attrs = openAttrs.replace(/\s+t="[^"]*"/, '');
    if(type === 'n')
      return `${attrs}><v>${value}</v></c>`;
    else
      return `${attrs} t="inlineStr"><is><t>${_escXml(value)}</t></is></c>`;
  });
}

/**
 * Fügt eine Zelle in die passende Zeile ein, falls sie im Template fehlt.
 * Hängt sie am Ende der Zeile ein (oder erstellt eine neue Zeile).
 */
function _insertCell(xml, ref, type, value){
  const rowNum  = ref.match(/\d+/)[0];
  const colStr  = ref.replace(/\d+/, '');
  const colNum  = _colToNum(colStr);

  const newCell = type === 'n'
    ? `<c r="${ref}"><v>${value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${_escXml(value)}</t></is></c>`;

  // Versuche, in vorhandene Zeile einzufügen
  const rowRe = new RegExp(`(<row [^>]*?r="${rowNum}"[^>]*>)([\\s\\S]*?)(</row>)`);
  if(rowRe.test(xml)){
    return xml.replace(rowRe, (_, open, content, close) => {
      // Richtige Position innerhalb der Zeile finden (nach Spalte sortiert)
      const insertRe = /<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
      let insertPos = content.length;
      let m;
      while((m = insertRe.exec(content)) !== null){
        if(_colToNum(m[1]) > colNum){ insertPos = m.index; break; }
      }
      return open + content.slice(0, insertPos) + newCell + content.slice(insertPos) + close;
    });
  }

  // Zeile fehlt komplett – vor der nächsten Zeile einfügen
  const nextRowRe = new RegExp(`(<row [^>]*?r="(\\d+)"[^>]*>)`);
  let inserted = false;
  const result = xml.replace(/<row /g, (match, offset) => {
    if(inserted) return match;
    const rn = xml.slice(offset).match(/r="(\d+)"/);
    if(rn && +rn[1] > +rowNum){
      inserted = true;
      return `<row r="${rowNum}"><c r="${ref}"${type==='n'?'':'  t="inlineStr"'}>${type==='n'?`<v>${value}</v>`:`<is><t>${_escXml(value)}</t></is>`}</c></row><row `;
    }
    return match;
  });
  return result;
}

function _colToNum(col){
  let n = 0;
  for(const ch of col.toUpperCase()) n = n*26 + (ch.charCodeAt(0)-64);
  return n;
}

/**
 * Hauptfunktion: Baut alle Patches und wendet sie auf das XML an.
 */
function _patchSheetXml(xml, dayIdx){
  let x = xml;

  // ── Datum ────────────────────────────────────────────────────
  const iso = computeDayDates()[dayIdx];
  if(iso) x = _patchCell(x, 'EE3', 'n', excelSerial(iso));

  // ── Besetzungsliste (Namen 1–28) ─────────────────────────────
  for(let n = 1; n <= 28; n++){
    const ref = slotNameRef(n);
    const p   = people[n-1];
    x = _patchCell(x, ref, 's', p ? (p.name||'') : '');
  }

  // ── Positionsbeschriftungen ──────────────────────────────────
  [11,13,15,17,19].forEach((row, i) => {
    const desc = positionDescriptions[i+3];
    if(desc) x = _patchCell(x, 'C'+row, 's', desc);
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
    x = _patchCell(x, colLetter(col)+'21', 's', code);
    fillHours().forEach(hr => {
      const [rt, rb] = HOUR_ROWS_X[hr];
      if(nums[0] != null) x = _patchCell(x, colLetter(col)+rt, 'n', nums[0]);
      if(nums[1] != null) x = _patchCell(x, colLetter(col)+rb, 'n', nums[1]);
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
      x = _patchCell(x, colLetter(col)+'21', 's', 'HW');
      const nr1 = overflowHW[i], nr2 = overflowHW[i+1];
      fillHours().forEach(hr => {
        const [rt, rb] = HOUR_ROWS_X[hr];
        if(nr1 != null) x = _patchCell(x, colLetter(col)+rt, 'n', nr1);
        if(nr2 != null) x = _patchCell(x, colLetter(col)+rb, 'n', nr2);
      });
    }
  }

  return x;
}

// ── Offizieller XLSX-Export ───────────────────────────────────────

async function exportOfficial(dayIdx){
  if(!lastResult){ alert('Bitte zuerst Plan generieren.'); return; }

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
