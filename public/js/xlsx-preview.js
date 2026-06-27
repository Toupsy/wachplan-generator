// ============================================================
// xlsx-preview.js – Editierbare, stilgetreue XLSX-Vorschau
// ============================================================
// Rendert die TATSÄCHLICH generierte XLSX (per buildPatchedXlsxBytes
// aus export.js) originalgetreu als HTML-Tabelle: ExcelJS (lazy von
// cdnjs, nur beim ersten Öffnen der Vorschau) liefert Zellstile,
// verbundene Zellen, Spaltenbreiten, Zeilenhöhen und Bilder (Logo),
// die wir auf eine HTML-Tabelle übertragen. Datenzellen sind direkt
// editierbar; Änderungen landen in xlsxPreviewOverrides und fließen
// identisch in Download (exportOfficial) und Druck ein.
//
// Bewusst sitzungslokal: Overrides werden NICHT in den State
// serialisiert und in generate() geleert (Personen-Nummern können
// sich verschieben → Refs würden veralten).
// ============================================================

// { [dayIdx]: { [cellRef]: value } } – überdauert renderOutput()-Rebuilds.
const xlsxPreviewOverrides = {};

const EXCELJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';

/** Setzt/entfernt ein Override für eine Zelle. Leeres Tag-Objekt wird aufgeräumt. */
function _setPreviewOverride(dayIdx, ref, value, isChange){
  if(isChange){
    if(!xlsxPreviewOverrides[dayIdx]) xlsxPreviewOverrides[dayIdx] = {};
    xlsxPreviewOverrides[dayIdx][ref] = value;
  } else if(xlsxPreviewOverrides[dayIdx]){
    delete xlsxPreviewOverrides[dayIdx][ref];
    if(Object.keys(xlsxPreviewOverrides[dayIdx]).length === 0) delete xlsxPreviewOverrides[dayIdx];
  }
}

/** Leert alle Vorschau-Edits (Aufruf aus generate(), weil Nummern sich verschieben können). */
function clearXlsxPreviewOverrides(){
  for(const k of Object.keys(xlsxPreviewOverrides)) delete xlsxPreviewOverrides[k];
}

/** Lädt ExcelJS bei Bedarf (lazy, einmalig) von cdnjs. */
function ensureExcelJS(){
  return new Promise((resolve, reject) => {
    if(typeof ExcelJS !== 'undefined') return resolve();
    let s = document.getElementById('exceljs-cdn');
    if(!s){
      s = document.createElement('script');
      s.id = 'exceljs-cdn';
      s.src = EXCELJS_CDN;
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => resolve());
    s.addEventListener('error', () => reject(new Error('ExcelJS konnte nicht geladen werden. Bitte Seite neu laden.')));
    if(typeof ExcelJS !== 'undefined') resolve();
  });
}

/**
 * Rendert die XLSX-Vorschau des Tages in den Container.
 * @param {HTMLElement} container Ziel-Element (#xlsx-preview)
 * @param {number} dayIdx
 */
async function renderXlsxPreview(container, dayIdx){
  if(!container) return;
  if(!lastResult){ container.innerHTML = '<div class="xlsx-hint">Bitte zuerst einen Plan generieren.</div>'; return; }

  container.innerHTML = '<div class="xlsx-hint">Vorschau wird erzeugt …</div>';
  try {
    const overrides = xlsxPreviewOverrides[dayIdx];
    const { bytes, truncated } = await buildPatchedXlsxBytes(dayIdx, overrides);

    await ensureExcelJS();
    const themeOrder = await _readThemePalette(bytes);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.worksheets[0];
    if(!ws){ container.innerHTML = '<div class="xlsx-hint">Leeres Arbeitsblatt.</div>'; return; }

    const editable = getEditableCellRefs(dayIdx);
    const sheet = _worksheetToStyledSheet(ws, wb, themeOrder, editable, dayIdx);

    container.innerHTML = '';
    if(truncated){
      const warn = document.createElement('div');
      warn.className = 'xlsx-hint xlsx-hint-warn';
      warn.textContent = '⚠️ Mehr Stationsspalten benötigt als das Formular bietet – überzählige Stationen fehlen in Vorschau & Export.';
      container.appendChild(warn);
    }
    const wrap = document.createElement('div');
    wrap.className = 'xlsx-table-wrap';
    wrap.appendChild(sheet);
    container.appendChild(wrap);
  } catch(e){
    container.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'xlsx-hint xlsx-hint-warn';
    err.textContent = 'Vorschau fehlgeschlagen: ' + (e && e.message ? e.message : e);
    container.appendChild(err);
    console.error('XLSX Preview Error:', e);
  }
}

// ── Farb-/Stil-Helfer ─────────────────────────────────────────────

/** Liest die Theme-Farbpalette aus xl/theme/theme1.xml (für theme-Farbreferenzen). */
async function _readThemePalette(bytes){
  // Office-Default als Fallback (lt1,dk1,lt2,dk2,accent1..6 – in ExcelJS-theme-Index-Reihenfolge).
  let order = ['#FFFFFF','#000000','#E7E6E6','#44546A','#4472C4','#ED7D31','#A5A5A5','#FFC000','#5B9BD5','#70AD47'];
  try {
    const zip = await JSZip.loadAsync(bytes);
    const f = zip.file('xl/theme/theme1.xml');
    if(f){
      const xml = await f.async('string');
      const m = [...xml.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6])>\s*(?:<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"|<a:srgbClr val="([0-9A-Fa-f]{6})")/g)]
        .map(x => '#' + (x[2] || x[3]));
      // Dokumentreihenfolge: dk1,lt1,dk2,lt2,accent1..6 → ExcelJS-Index: 0 lt1,1 dk1,2 lt2,3 dk2,4 accent1..
      if(m.length >= 4) order = [m[1], m[0], m[3], m[2], m[4], m[5], m[6], m[7], m[8], m[9]].map(x => x || '#000000');
    }
  } catch(_){}
  return order;
}

/** Mischt eine Hex-Farbe Richtung Weiß (tint>0) oder Schwarz (tint<0). */
function _tintHex(hex, tint){
  if(!tint) return hex;
  let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const ap = v => tint > 0 ? Math.round(v + (255-v)*tint) : Math.round(v*(1+tint));
  const h  = v => ('0' + Math.max(0,Math.min(255,ap(v))).toString(16)).slice(-2);
  return '#' + h(r) + h(g) + h(b);
}

/** ExcelJS-Farbe ({argb}|{theme,tint}) → CSS-Hex (oder null). */
function _resolveColor(c, order){
  if(!c) return null;
  if(c.argb) return '#' + c.argb.slice(-6);
  if(typeof c.theme === 'number'){ const base = order[c.theme] || '#000000'; return _tintHex(base, c.tint || 0); }
  return null;
}

/** Excel-Rahmenstil → CSS-Kurzform. */
function _borderCss(style){
  switch(style){
    case 'thin': case 'hair': return '1px solid';
    case 'medium': return '2px solid';
    case 'thick': return '3px solid';
    case 'double': return '3px double';
    case 'dotted': return '1px dotted';
    case 'dashed': case 'mediumDashed': return '1px dashed';
    default: return style ? '1px solid' : '0';
  }
}

/** Anzeigetext einer ExcelJS-Zelle (Datum lokal formatiert, Formel-Ergebnis, RichText). */
function _cellDisplay(cell){
  const v = cell && cell.value;
  if(v == null) return '';
  if(v instanceof Date){
    const p = n => ('0'+n).slice(-2);
    return p(v.getUTCDate()) + '.' + p(v.getUTCMonth()+1) + '.' + v.getUTCFullYear();
  }
  if(typeof v === 'object'){
    if('result' in v) return v.result == null ? '' : String(v.result);
    if('richText' in v) return v.richText.map(t => t.text).join('');
    if('text' in v) return String(v.text);
    return cell.text != null ? String(cell.text) : '';
  }
  return String(v);
}

/**
 * Baut aus einer ExcelJS-Worksheet die stilgetreue Vorschau (Tabelle + Logo-Overlays).
 * @returns {HTMLElement} positionierter Wrapper (.xlsx-sheet) mit <table> + <img>-Overlays
 */
function _worksheetToStyledSheet(ws, wb, order, editable, dayIdx){
  const dim = ws.dimensions || {};
  const maxC = dim.right  || ws.columnCount || 1;
  const maxR = dim.bottom || ws.rowCount || 1;

  // Merges → verdeckte Zellen + Spans (1-basiert wie ExcelJS).
  const covered = new Set();   // "r,c"
  const spanMap = {};          // "r,c" (Top-Left) → { rs, cs }
  (ws.model.merges || []).forEach(rng => {
    const m = _decodeA1Range(rng); if(!m) return;
    spanMap[m.top + ',' + m.left] = { rs: m.bottom - m.top + 1, cs: m.right - m.left + 1 };
    for(let r = m.top; r <= m.bottom; r++)
      for(let c = m.left; c <= m.right; c++)
        if(!(r === m.top && c === m.left)) covered.add(r + ',' + c);
  });

  // Spaltenbreiten / Zeilenhöhen (px) – auch für die Bild-Positionierung wiederverwendet.
  const colPx = [0];
  for(let c = 1; c <= maxC; c++){ const w = ws.getColumn(c).width; colPx[c] = w ? Math.round(w*7+5) : 30; }
  const rowPx = [0];
  for(let r = 1; r <= maxR; r++){ const h = ws.getRow(r).height; rowPx[r] = h ? Math.round(h*96/72) : 18; }

  const table = document.createElement('table');
  table.className = 'xlsx-preview-table';
  table.dataset.dayIdx = dayIdx;

  const colgroup = document.createElement('colgroup');
  for(let c = 1; c <= maxC; c++){ const col = document.createElement('col'); col.style.width = colPx[c] + 'px'; colgroup.appendChild(col); }
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');
  for(let r = 1; r <= maxR; r++){
    const tr = document.createElement('tr');
    tr.style.height = rowPx[r] + 'px';
    for(let c = 1; c <= maxC; c++){
      if(covered.has(r + ',' + c)) continue;
      const cell = ws.getCell(r, c);
      const addr = cell.address;
      const td = document.createElement('td');
      td.dataset.ref = addr;

      const span = spanMap[r + ',' + c];
      if(span){ if(span.rs > 1) td.rowSpan = span.rs; if(span.cs > 1) td.colSpan = span.cs; }

      const st = cell.style || {};
      const f  = st.font || {};
      const al = st.alignment || {};
      const b  = st.border || {};
      const fill = (st.fill && st.fill.type === 'pattern' && st.fill.pattern && st.fill.pattern !== 'none')
        ? _resolveColor(st.fill.fgColor, order) : null;
      const parts = [
        'border-top:'    + _borderCss(b.top    && b.top.style)    + ' ' + (_resolveColor(b.top    && b.top.color,    order) || '#000'),
        'border-bottom:' + _borderCss(b.bottom && b.bottom.style) + ' ' + (_resolveColor(b.bottom && b.bottom.color, order) || '#000'),
        'border-left:'   + _borderCss(b.left   && b.left.style)   + ' ' + (_resolveColor(b.left   && b.left.color,   order) || '#000'),
        'border-right:'  + _borderCss(b.right  && b.right.style)  + ' ' + (_resolveColor(b.right  && b.right.color,  order) || '#000'),
        'color:' + (_resolveColor(f.color, order) || '#000'),
        'font-size:' + Math.round(f.size || 10) + 'px',
        'font-family:' + (f.name ? "'" + f.name + "'," : '') + 'Arial,sans-serif',
        'text-align:' + (al.horizontal || 'left'),
        'vertical-align:' + (al.vertical === 'middle' ? 'middle' : (al.vertical || 'bottom')),
        'white-space:' + (al.wrapText ? 'normal' : 'nowrap'),
      ];
      if(fill) parts.push('background:' + fill);
      if(f.bold) parts.push('font-weight:700');
      if(f.italic) parts.push('font-style:italic');
      td.style.cssText = parts.join(';');

      const val = _cellDisplay(cell);
      td.textContent = val;

      if(editable.has(addr)){
        td.classList.add('xlsx-cell-edit');
        td.contentEditable = 'true';
        td.spellcheck = false;
        td.dataset.orig = val;
        td.addEventListener('blur', _onCellBlur);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  // Wrapper (positioniert) für Logo-Overlays.
  const sheet = document.createElement('div');
  sheet.className = 'xlsx-sheet';
  sheet.appendChild(table);

  // Bilder (Logo) absolut über das Raster legen.
  const cumX = c => { let x = 0; for(let i = 1; i < c; i++) x += colPx[i] || 0; return x; };
  const cumY = r => { let y = 0; for(let i = 1; i < r; i++) y += rowPx[i] || 0; return y; };
  const media = wb.model.media || [];
  const images = (typeof ws.getImages === 'function') ? ws.getImages() : [];
  images.forEach(im => {
    const m = media[im.imageId]; if(!m || !m.buffer) return;
    const tl = im.range.tl, br = im.range.br;
    const EMU = 9525;
    const x = cumX(Math.floor(tl.nativeCol) + 1) + (tl.nativeColOff ? tl.nativeColOff / EMU : 0);
    const y = cumY(Math.floor(tl.nativeRow) + 1) + (tl.nativeRowOff ? tl.nativeRowOff / EMU : 0);
    let w = 80, h = 60;
    if(br){
      const x2 = cumX(Math.floor(br.nativeCol) + 1) + (br.nativeColOff ? br.nativeColOff / EMU : 0);
      const y2 = cumY(Math.floor(br.nativeRow) + 1) + (br.nativeRowOff ? br.nativeRowOff / EMU : 0);
      w = Math.max(16, x2 - x); h = Math.max(16, y2 - y);
    }
    let b64 = '';
    try { b64 = _u8ToBase64(m.buffer); } catch(_){ return; }
    const img = document.createElement('img');
    img.className = 'xlsx-sheet-img';
    img.src = 'data:image/' + (m.extension || 'png') + ';base64,' + b64;
    img.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    sheet.appendChild(img);
  });

  return sheet;
}

/** Uint8Array/Buffer → base64 (chunked, vermeidet Stack-Overflow bei großen Bildern). */
function _u8ToBase64(buf){
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; const chunk = 0x8000;
  for(let i = 0; i < arr.length; i += chunk) s += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  return btoa(s);
}

/** "U21:AA22" → { top, left, bottom, right } (1-basiert). */
function _decodeA1Range(s){
  const m = String(s).match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
  if(!m) return null;
  const col = a => { let n = 0; for(const ch of a) n = n*26 + (ch.charCodeAt(0)-64); return n; };
  return { left: col(m[1]), top: +m[2], right: col(m[3]), bottom: +m[4] };
}

/** Speichert eine editierte Zelle als Override (nur bei echter Änderung). */
function _onCellBlur(e){
  const td = e.currentTarget;
  const tbl = td.closest('table.xlsx-preview-table');
  const dayIdx = tbl ? +tbl.dataset.dayIdx : activeDay;
  const ref = td.dataset.ref;
  // contentEditable fügt teils geschützte Leerzeichen (U+00A0) ein → normalisieren,
  // sonst greift die numerische Override-Erkennung in _patchSheetXml nicht.
  const value = td.textContent.replace(/ /g, ' ').trim();
  const isChange = value !== (td.dataset.orig || '');
  _setPreviewOverride(dayIdx, ref, value, isChange);
}

/** Download aus der Vorschau: identisch zum offiziellen Export (nutzt dieselben Overrides). */
function downloadXlsxFromPreview(dayIdx){
  exportOfficial(dayIdx);
}

/** Druckt nur das Vorschau-Raster (Querformat via body.print-xlsx). */
function printXlsxPreview(){
  document.body.classList.add('print-xlsx');
  window.print();
  setTimeout(() => document.body.classList.remove('print-xlsx'), 100);
}
