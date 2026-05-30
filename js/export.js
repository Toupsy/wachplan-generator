// ============================================================
// export.js – CSV- und offizieller XLSX-Export
// ============================================================

// ── XLSX-Hilfskonstanten ─────────────────────────────────────────
// Zeilen und Spalten der eingebetteten DLRG-Vorlage (sheet1.xml)
const SLOT_ROWS_X  = [7, 9, 11, 13, 15, 17, 19];
const SLOT_NAMECOL = [43, 76, 109, 142];   // Namens-Spalten der 4 Blöcke
const HOUR_ROWS_X  = {
  '08:00':[23,24], '09:00':[25,26], '10:00':[27,28], '11:00':[29,30],
  '12:00':[31,32], '13:00':[33,34], '14:00':[35,36], '15:00':[37,38],
  '16:00':[39,40], '17:00':[41,42], '18:00':[43,44], '19:00':[45,46],
};
const STATION_COL_X = {
  '78/1':21, '9/12':27, '9/13':33, 'WF':39, 'WF2':45, 'HW':51, 'HW2':57,
  '78/2':63, '9/14':69, '9/15':75, '9/16':81, '78/3':87, '9/17':93,
  '9/18':99, '9/1':117, '9/2':123,
};
const FILL_HOURS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'];

// ── XLSX XML-Helfer ──────────────────────────────────────────────

/** Spaltennummer → Excel-Buchstabe(n) (1→A, 27→AA …) */
function colLetter(n){
  let s = '';
  while(n > 0){ const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** 1-basierte Slot-Nummer → Zellreferenz im Namens-Block. */
function slotNameRef(nr){
  const b = Math.floor((nr - 1) / 7), i = (nr - 1) % 7;
  return colLetter(SLOT_NAMECOL[b]) + SLOT_ROWS_X[i];
}

/** ISO-Datum → Excel-Seriennummer. */
function excelSerial(iso){
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** XML-Sonderzeichen escapen. */
function xmlEsc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/** Regex für eine einzelne Zelle in sheet1.xml. */
function cellRegex(ref){
  return new RegExp('<c r="' + ref + '"(?:\\s+s="(\\d+)")?(?:\\s+t="[^"]*")?\\s*(?:/>|>[\\s\\S]*?</c>)');
}

/** Style-Attribut und alten XML-String einer Zelle ermitteln. */
function getStyle(xml, ref){ const m = xml.match(cellRegex(ref)); return { s:(m&&m[1])?m[1]:null, old:m?m[0]:null }; }

/** Zahlenwert in Zelle schreiben. */
function setNum(xml, ref, val){
  const { s, old } = getStyle(xml, ref);
  const sa = s ? ` s="${s}"` : '';
  const nu = `<c r="${ref}"${sa}><v>${val}</v></c>`;
  return old ? xml.replace(old, nu) : xml;
}

/** Text in Zelle schreiben (inlineStr). */
function setStr(xml, ref, txt){
  const { s, old } = getStyle(xml, ref);
  const sa = s ? ` s="${s}"` : '';
  const nu = `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(txt)}</t></is></c>`;
  return old ? xml.replace(old, nu) : xml;
}

/** Zelle leeren (nur Style-Attribut behalten). */
function clearCell(xml, ref){
  const { s, old } = getStyle(xml, ref);
  if(!old) return xml;
  const sa = s ? ` s="${s}"` : '';
  return xml.replace(old, `<c r="${ref}"${sa}/>`);
}

// ── Besetzungsdaten aufbereiten ──────────────────────────────────

/**
 * Baut ein Mapping von Stationscode → [Nr, Nr] für einen Tag auf.
 * Die Nummern entsprechen den 1-basierten Slot-Positionen in der Vorlage.
 */
function buildAssignments(dayIdx){
  const d = lastResult.schedule[dayIdx];
  const A = {};

  d.assign.forEach(slot => {
    if(slot.kind === 'tower' && slot.code)
      A[slot.code] = slot.occupants.map(p => personNr(p.id)).filter(n => n != null).slice(0, 2);
    else if(slot.kind === 'boat' && slot.code && slot.bootsf){
      const nr = personNr(slot.bootsf.id);
      if(nr != null) A[slot.code] = [nr];
    }
  });

  const main = d.assign.find(s => s.kind === 'main');
  if(main){
    const f = main.fuehrung.map(p => personNr(p.id)).filter(n => n != null);
    if(f.length)     A['WF']  = f.slice(0, 2);
    if(f.length > 2) A['WF2'] = f.slice(2, 4);
    const g = main.mainGuards.map(p => personNr(p.id)).filter(n => n != null);
    if(g.length)     A['HW']  = g.slice(0, 2);
    if(g.length > 2) A['HW2'] = g.slice(2, 4);
  }
  return A;
}

// ── Offizieller XLSX-Export ──────────────────────────────────────

/**
 * Befüllt die eingebettete DLRG-Vorlage (TEMPLATE_B64) über reine
 * XML-Bearbeitung mit JSZip und lädt die fertige Datei herunter.
 *
 * @param {number} dayIdx  Index des zu exportierenden Tages (0-basiert)
 */
async function exportOfficial(dayIdx){
  if(typeof JSZip === 'undefined'){
    alert('JSZip lädt noch – bitte kurz warten und erneut versuchen (Internetverbindung nötig).');
    return;
  }
  if(!lastResult){ alert('Bitte zuerst einen Plan generieren.'); return; }

  // Vorlage aus Base64 laden
  const bin   = atob(TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);
  let xml = await zip.file('xl/worksheets/sheet1.xml').async('string');

  // 1) Datum
  const iso = computeDayDates()[dayIdx];
  if(iso) xml = setNum(xml, 'EE3', excelSerial(iso));

  // 2) Besetzungsliste (bis zu 28 Slots)
  for(let n = 1; n <= 28; n++){
    const ref = slotNameRef(n);
    const p   = people[n - 1];
    xml = p ? setStr(xml, ref, p.name || ('Nr ' + n)) : clearCell(xml, ref);
  }

  // 3) Stundenraster leeren
  for(const hr in HOUR_ROWS_X){
    const [rt, rb] = HOUR_ROWS_X[hr];
    for(const code in STATION_COL_X){
      const col = STATION_COL_X[code];
      xml = clearCell(xml, colLetter(col) + rt);
      xml = clearCell(xml, colLetter(col) + rb);
    }
  }

  // 4) Zuweisungen 09–17 Uhr eintragen
  const Ass = buildAssignments(dayIdx);
  FILL_HOURS.forEach(hr => {
    const [rt, rb] = HOUR_ROWS_X[hr];
    for(const code in Ass){
      const col  = STATION_COL_X[code];
      if(!col) continue;
      const nums = Ass[code];
      if(nums[0] != null) xml = setNum(xml, colLetter(col) + rt, nums[0]);
      if(nums[1] != null) xml = setNum(xml, colLetter(col) + rb, nums[1]);
    }
  });

  zip.file('xl/worksheets/sheet1.xml', xml);
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const fn = (iso || ('Tag' + (dayIdx + 1))) + '_Wachplan.xlsx';
  const a  = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = fn;
  a.click();
}

// ── CSV-Export ───────────────────────────────────────────────────

/** Exportiert den kompletten 6-Tage-Plan als UTF-8 CSV-Datei. */
function exportCSV(){
  const { schedule } = lastResult;
  const rows = [['Tag','Standort','Code','Typ','Position','Person','Rolle']];

  schedule.forEach(d => {
    const dn = dayLabel(d.day);
    d.assign.forEach(slot => {
      if(slot.kind === 'main'){
        slot.fuehrung.forEach(p   => rows.push([dn, slot.tower, '', 'Zentrale', 'Führung',        p.name, ROLE[p.role]]));
        slot.mainGuards.forEach(p => rows.push([dn, slot.tower, '', 'Zentrale', 'Wache',           p.name, ROLE[p.role]]));
        slot.base.forEach(p       => rows.push([dn, slot.tower, '', 'Zentrale', 'Reserve',         p.name, ROLE[p.role]]));
        slot.bootsfLeft.forEach(p => rows.push([dn, slot.tower, '', 'Zentrale', 'Bootsf. frei',    p.name, ROLE[p.role]]));
        slot.sick.forEach(p       => rows.push([dn, slot.tower, '', 'Zentrale', 'KRANK',           p.name, ROLE[p.role]]));
      } else if(slot.kind === 'tower'){
        slot.occupants.forEach(p  => rows.push([dn, slot.tower, slot.code||'', 'Turm', 'Wachgänger', p.name, ROLE[p.role]]));
      } else if(slot.kind === 'boat' && slot.bootsf){
        rows.push([dn, slot.name, slot.code||'', 'Boot', 'Bootsführer', slot.bootsf.name, ROLE[slot.bootsf.role]]);
      }
    });
    [...d.manualClosed,   ...d.personnelClosed].forEach(t =>
      rows.push([dn, t.name, t.code||'', 'Turm', 'GESCHLOSSEN', '', '']));
    [...d.boatsManualClosed, ...d.boatsClosedTower, ...d.boatsNoBootsf].forEach(b =>
      rows.push([dn, b.name, b.code||'', 'Boot', 'GESCHLOSSEN', '', '']));
  });

  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'wachplan_6tage.csv';
  a.click();
}

// ── XLSX-Vorlage (Base64) ────────────────────────────────────────
// Die eingebettete DLRG-Vorlage als Base64-String.
// Diesen Wert aus der Originaldatei nicht verändern!
const TEMPLATE_B64 = "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";
