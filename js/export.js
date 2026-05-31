// ============================================================
// export.js – XLSX- und CSV-Export
// ============================================================
// Verwendet SheetJS (xlsx.full.min.js) statt des kaputten TEMPLATE_B64.
// Erzeugt zwei Sheets:
//   "Formular"  – schreibt in die exakt gleichen Zellreferenzen wie das
//                 ursprüngliche DLRG-Vorlage (EE3, C11…C19, AQ7…, etc.)
//   "Übersicht" – lesbare Tabelle für tägliche Nutzung
// ============================================================

// ── Mapping-Konstanten (identisch zur Originalvorlage) ──────────
const SLOT_ROWS_X  = [7,9,11,13,15,17,19];
const SLOT_NAMECOL = [43,76,109,142];
const HOUR_ROWS_X  = {
  '08:00':[23,24],'09:00':[25,26],'10:00':[27,28],'11:00':[29,30],
  '12:00':[31,32],'13:00':[33,34],'14:00':[35,36],'15:00':[37,38],
  '16:00':[39,40],'17:00':[41,42],'18:00':[43,44],'19:00':[45,46],
};
const STATION_COL_X = {
  '78/1':21,'9/12':27,'9/13':33,'WF':39,'WF2':45,'HW':51,'HW2':57,
  '78/2':63,'9/14':69,'9/15':75,'9/16':81,'78/3':87,'9/17':93,
  '9/18':99,'9/1':117,'9/2':123,
};
const FILL_HOURS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'];

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

/** Besetzungsdaten für einen Tag aufbereiten (code → [Nr, Nr]) */
function buildAssignments(dayIdx){
  const d = lastResult.schedule[dayIdx];
  const A = {};
  d.assign.forEach(slot => {
    if(slot.kind==='tower' && slot.code)
      A[slot.code] = slot.occupants.map(p=>personNr(p.id)).filter(n=>n!=null).slice(0,2);
    else if(slot.kind==='boat' && slot.code && slot.bootsf){
      const nr=personNr(slot.bootsf.id);
      if(nr!=null) A[slot.code]=[nr];
    }
  });
  const main = d.assign.find(s=>s.kind==='main');
  if(main){
    const f=main.fuehrung.map(p=>personNr(p.id)).filter(n=>n!=null);
    if(f.length)    A['WF'] =f.slice(0,2);
    if(f.length>2)  A['WF2']=f.slice(2,4);
    // Alle HW-Personen: Guards + Reserve (base) + überzählige BF
    const g=[...main.mainGuards,...main.base,...main.bootsfLeft]
      .map(p=>personNr(p.id)).filter(n=>n!=null);
    if(g.length)    A['HW'] =g.slice(0,2);
    if(g.length>2)  A['HW2']=g.slice(2,4);
    if(main.hwBoatSlot?.bootsf){
      const boCode = getBoat(main.hwBoatSlot.boatId)?.code;
      if(boCode){
        const nr=personNr(main.hwBoatSlot.bootsf.id);
        if(nr!=null) A[boCode]=[nr];
      }
    }
  }
  return A;
}

// ── Sheet 1: "Formular" (DLRG-kompatible Zellreferenzen) ─────────

function buildFormularSheet(dayIdx){
  if(typeof XLSX === 'undefined') return null;
  const ws  = {};
  const iso = computeDayDates()[dayIdx];

  // Datum (EE3)
  if(iso) ws['EE3'] = { v: excelSerial(iso), t:'n',
    z:'DD.MM.YYYY' };

  // Positionsbeschriftungen C11, C13, C15, C17, C19 (Feature 2)
  [11,13,15,17,19].forEach((row,i) => {
    const desc = positionDescriptions[i+3];
    if(desc) ws['C'+row] = { v: desc, t:'s' };
  });

  // Besetzungsliste (28 Slots)
  for(let n=1;n<=28;n++){
    const ref = slotNameRef(n);
    const p   = people[n-1];
    ws[ref]   = p ? { v: p.name||('Nr '+n), t:'s' } : { v:'', t:'s' };
  }

  // Stundenraster füllen
  const A = buildAssignments(dayIdx);
  FILL_HOURS.forEach(hr => {
    const [rt,rb] = HOUR_ROWS_X[hr];
    for(const code in A){
      const col  = STATION_COL_X[code]; if(!col) continue;
      const nums = A[code];
      if(nums[0]!=null) ws[colLetter(col)+rt]={ v:nums[0], t:'n' };
      if(nums[1]!=null) ws[colLetter(col)+rb]={ v:nums[1], t:'n' };
    }
  });

  // Sheet-Ausdehnung setzen
  ws['!ref'] = `A1:${colLetter(145)}50`;
  return ws;
}

// ── Sheet 2: "Übersicht" (lesbare Tabelle) ────────────────────────

function buildUebersichtSheet(dayIdx){
  if(typeof XLSX === 'undefined') return null;
  const iso    = computeDayDates()[dayIdx];
  const d      = lastResult.schedule[dayIdx];
  const A      = buildAssignments(dayIdx);
  const aoa    = [];

  const add  = (...row) => aoa.push(row);
  const gap  = ()       => aoa.push([]);

  // Header
  add(['DLRG · Wachplan', '', dayLabel(dayIdx), iso||'']);
  gap();

  // Besetzungsliste
  add(['BESETZUNGSLISTE']);
  add(['Nr','Name','Funktion','Rolle']);
  people.forEach((p,i) => add(i+1, p.name, '', ROLE[p.role]));
  gap();

  // Positionsbeschriftungen
  add(['POSITIONSBESCHRIFTUNGEN (XLSX-Formular)']);
  add(['Pos.','Zelle','Bezeichnung']);
  for(let pos=3;pos<=7;pos++){
    add(pos, 'C'+(pos*2+5), positionDescriptions[pos]||'');
  }
  gap();

  // Stationszuweisung
  add(['STATIONSZUWEISUNG']);
  add(['Art','Station','Code','Prio','Person 1 Nr','Person 1 Name','Person 2 Nr','Person 2 Name']);
  d.assign.forEach(slot => {
    if(slot.kind==='tower'){
      const [n1,n2] = (A[slot.code]||[]);
      add('Turm', slot.tower, slot.code||'', slot.prio,
        n1||'', n1?people[n1-1]?.name||'':'',
        n2||'', n2?people[n2-1]?.name||'':'');
    } else if(slot.kind==='boat'){
      const [n1]    = (A[slot.code]||[]);
      add('Boot', slot.name, slot.code||'', slot.prio||'',
        n1||'', n1?people[n1-1]?.name||'':'', '', '');
    }
  });
  // Hauptwache
  const main = d.assign.find(s=>s.kind==='main');
  if(main){
    main.fuehrung.forEach(p  => add('HW','Hauptwache','WF', '', personNr(p.id)||'',p.name,'',''));
    [...main.mainGuards,...main.base,...main.bootsfLeft]
      .forEach(p => add('HW','Hauptwache','HW', '', personNr(p.id)||'',p.name,'',''));
    if(main.hwBoatSlot?.bootsf){
      const bo=getBoat(main.hwBoatSlot.boatId);
      add('HW-Boot', main.hwBoatSlot.name, bo?.code||'', '',
        personNr(main.hwBoatSlot.bootsf.id)||'', main.hwBoatSlot.bootsf.name,'','');
    }
  }
  gap();

  // Zeiteinteilung 09-17
  add(['ZEITEINTEILUNG 09:00–17:00']);
  const stCodes = Object.keys(STATION_COL_X).filter(c => A[c]);
  add(['Zeit', ...stCodes.map(c=>`${c} · ${people[(A[c][0]||1)-1]?.name||'?'}/${people[(A[c][1]||1)-1]?.name||'-'}`)]);
  FILL_HOURS.forEach(hr => {
    const row = [hr];
    stCodes.forEach(c => {
      const [n1,n2]=(A[c]||[]);
      row.push([n1,n2].filter(Boolean).join(', ')||'—');
    });
    add(...row);
  });

  return XLSX.utils.aoa_to_sheet(aoa);
}

// ── Offizieller XLSX-Export (mit Original-Template) ─────────────

async function exportOfficial(dayIdx){
  if(typeof XLSX === 'undefined'){
    alert('SheetJS lädt noch – bitte kurz warten (Internetverbindung nötig).');
    return;
  }
  if(!lastResult){ alert('Bitte zuerst Plan generieren.'); return; }

  let wb;
  if(typeof TEMPLATE_B64 !== 'undefined' && TEMPLATE_B64){
    // Template laden und Zellen überschreiben (cellStyles bewahrt Formatierung)
    wb = XLSX.read(TEMPLATE_B64, { type: 'base64', cellStyles: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    _fillTemplateSheet(ws, dayIdx);
    // Übersicht anhängen (neues Sheet)
    const ws2 = buildUebersichtSheet(dayIdx);
    if(ws2){
      // Vorhandenes Übersicht-Sheet ersetzen oder neu anlegen
      const existing = wb.SheetNames.indexOf('Übersicht');
      if(existing >= 0) wb.SheetNames.splice(existing, 1);
      XLSX.utils.book_append_sheet(wb, ws2, 'Übersicht');
    }
  } else {
    // Fallback: leere Sheets
    wb  = XLSX.utils.book_new();
    const ws1 = buildFormularSheet(dayIdx);
    const ws2 = buildUebersichtSheet(dayIdx);
    if(ws1) XLSX.utils.book_append_sheet(wb, ws1, 'Formular');
    if(ws2) XLSX.utils.book_append_sheet(wb, ws2, 'Übersicht');
  }

  const iso = computeDayDates()[dayIdx];
  const fn  = (iso||('Tag'+(dayIdx+1)))+'_Wachplan.xlsx';
  const out = XLSX.write(wb, { bookType:'xlsx', type:'array', cellStyles: true });
  const blob= new Blob([out], { type:'application/octet-stream' });
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(blob);
  a.download= fn;
  a.click();
}

/**
 * Schreibt einen Wert in eine Zelle und bewahrt dabei den bestehenden Style
 * aus dem Template.
 */
function _setCell(ws, ref, value, type){
  const existing = ws[ref] || {};
  ws[ref] = { ...existing, v: value, t: type };
  // z (format string) nur setzen wenn nicht schon vorhanden
  if(type === 'n' && !existing.z) ws[ref].z = '0';
}

/** Schreibt Wachplan-Daten direkt in das geladene Template-Worksheet. */
function _fillTemplateSheet(ws, dayIdx){
  const iso = computeDayDates()[dayIdx];
  if(iso){
    const existing = ws['EE3'] || {};
    ws['EE3'] = { ...existing, v: excelSerial(iso), t:'n', z:'DD.MM.YYYY' };
  }

  [11,13,15,17,19].forEach((row,i) => {
    const desc = positionDescriptions[i+3];
    if(desc) _setCell(ws, 'C'+row, desc, 's');
  });

  for(let n=1;n<=28;n++){
    const ref = slotNameRef(n);
    const p   = people[n-1];
    _setCell(ws, ref, p ? (p.name || ('Nr '+n)) : '', 's');
  }

  const A = buildAssignments(dayIdx);
  FILL_HOURS.forEach(hr => {
    const [rt,rb] = HOUR_ROWS_X[hr];
    for(const code in A){
      const col  = STATION_COL_X[code]; if(!col) continue;
      const nums = A[code];
      if(nums[0]!=null) _setCell(ws, colLetter(col)+rt, nums[0], 'n');
      if(nums[1]!=null) _setCell(ws, colLetter(col)+rb, nums[1], 'n');
    }
  });
}

// ── CSV-Export ───────────────────────────────────────────────────

function exportCSV(){
  const {schedule}=lastResult;
  const rows=[['Tag','Standort','Code','Typ','Position','Person','Rolle']];
  schedule.forEach(d=>{
    const dn=dayLabel(d.day);
    d.assign.forEach(slot=>{
      if(slot.kind==='main'){
        slot.fuehrung.forEach(p   =>rows.push([dn,slot.tower,'','Zentrale','Führung',p.name,ROLE[p.role]]));
        slot.mainGuards.forEach(p =>rows.push([dn,slot.tower,'','Zentrale','Wache',p.name,ROLE[p.role]]));
        slot.base.forEach(p       =>rows.push([dn,slot.tower,'','Zentrale','Reserve',p.name,ROLE[p.role]]));
        slot.bootsfLeft.forEach(p =>rows.push([dn,slot.tower,'','Zentrale','Bootsf. frei',p.name,ROLE[p.role]]));
        if(slot.hwBoatSlot?.bootsf)
          rows.push([dn,slot.hwBoatSlot.name,getBoat(slot.hwBoatSlot.boatId)?.code||'','HW-Boot','Bootsführer',slot.hwBoatSlot.bootsf.name,ROLE[slot.hwBoatSlot.bootsf.role]]);
        slot.sick.forEach(p       =>rows.push([dn,slot.tower,'','Zentrale','KRANK',p.name,ROLE[p.role]]));
      } else if(slot.kind==='tower'){
        slot.occupants.forEach(p  =>rows.push([dn,slot.tower,slot.code||'','Turm','Wachgänger',p.name,ROLE[p.role]]));
      } else if(slot.kind==='boat'&&slot.bootsf){
        rows.push([dn,slot.name,slot.code||'','Boot','Bootsführer',slot.bootsf.name,ROLE[slot.bootsf.role]]);
      }
    });
    [...d.manualClosed,...d.personnelClosed].forEach(t=>rows.push([dn,t.name,t.code||'','Turm','GESCHLOSSEN','','']));
    [...d.boatsManualClosed,...d.boatsClosedTower,...d.boatsNoBootsf].forEach(b=>rows.push([dn,b.name,b.code||'','Boot','GESCHLOSSEN','','']));
  });
  const csv =rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const a   =document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='wachplan_6tage.csv'; a.click();
}
