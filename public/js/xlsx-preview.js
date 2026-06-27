// ============================================================
// xlsx-preview.js – Editierbare XLSX-Vorschau
// ============================================================
// Rendert die TATSÄCHLICH generierte XLSX (per buildPatchedXlsxBytes
// aus export.js) mit SheetJS in eine HTML-Tabelle. Datenzellen sind
// direkt editierbar; Änderungen landen in xlsxPreviewOverrides und
// fließen identisch in Download (exportOfficial) und Druck ein.
//
// Bewusst sitzungslokal: Overrides werden NICHT in den State
// serialisiert und in generate() geleert (Personen-Nummern können
// sich verschieben → Refs würden veralten).
// ============================================================

// { [dayIdx]: { [cellRef]: value } } – überdauert renderOutput()-Rebuilds.
const xlsxPreviewOverrides = {};

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
    if(typeof XLSX === 'undefined') throw new Error('SheetJS (XLSX) ist nicht geladen.');

    const overrides = xlsxPreviewOverrides[dayIdx];
    const { bytes, truncated } = await buildPatchedXlsxBytes(dayIdx, overrides);

    const wb = XLSX.read(bytes, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if(!ws || !ws['!ref']){ container.innerHTML = '<div class="xlsx-hint">Leeres Arbeitsblatt.</div>'; return; }

    const editable = getEditableCellRefs(dayIdx);
    const table = _worksheetToTable(ws, editable, dayIdx);

    container.innerHTML = '';
    if(truncated){
      const warn = document.createElement('div');
      warn.className = 'xlsx-hint xlsx-hint-warn';
      warn.textContent = '⚠️ Mehr Stationsspalten benötigt als das Formular bietet – überzählige Stationen fehlen in Vorschau & Export.';
      container.appendChild(warn);
    }
    const wrap = document.createElement('div');
    wrap.className = 'xlsx-table-wrap';
    wrap.appendChild(table);
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

/** Baut aus einer SheetJS-Worksheet eine <table> (Merges, Spaltenbreiten, editierbare Zellen). */
function _worksheetToTable(ws, editable, dayIdx){
  const range  = XLSX.utils.decode_range(ws['!ref']);
  const merges = ws['!merges'] || [];
  const cols   = ws['!cols'] || [];

  // Verdeckte Merge-Zellen + Top-Left-Spans bestimmen.
  const covered = new Set();   // "r,c" innerhalb eines Merges (außer Top-Left)
  const spanMap = {};          // "r,c" (Top-Left) → { rs, cs }
  merges.forEach(m => {
    spanMap[m.s.r + ',' + m.s.c] = { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 };
    for(let r = m.s.r; r <= m.e.r; r++)
      for(let c = m.s.c; c <= m.e.c; c++)
        if(!(r === m.s.r && c === m.s.c)) covered.add(r + ',' + c);
  });

  const table = document.createElement('table');
  table.className = 'xlsx-preview-table';

  // Spaltenbreiten aus !cols (Fidelity).
  const colgroup = document.createElement('colgroup');
  for(let c = range.s.c; c <= range.e.c; c++){
    const col = document.createElement('col');
    const info = cols[c];
    const wpx = info && (info.wpx || (info.width ? Math.round(info.width * 7) : 0));
    if(wpx) col.style.width = wpx + 'px';
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');
  for(let r = range.s.r; r <= range.e.r; r++){
    const tr = document.createElement('tr');
    for(let c = range.s.c; c <= range.e.c; c++){
      if(covered.has(r + ',' + c)) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      const td = document.createElement('td');
      td.dataset.ref = addr;

      const span = spanMap[r + ',' + c];
      if(span){ if(span.rs > 1) td.rowSpan = span.rs; if(span.cs > 1) td.colSpan = span.cs; }

      const val = cell ? (cell.w != null ? cell.w : (cell.v != null ? cell.v : '')) : '';
      td.textContent = String(val);

      if(editable.has(addr)){
        td.classList.add('xlsx-cell-edit');
        td.contentEditable = 'true';
        td.spellcheck = false;
        td.dataset.orig = String(val);
        td.addEventListener('blur', _onCellBlur);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  table.dataset.dayIdx = dayIdx;
  return table;
}

/** Speichert eine editierte Zelle als Override (nur bei echter Änderung). */
function _onCellBlur(e){
  const td = e.currentTarget;
  const tbl = td.closest('table.xlsx-preview-table');
  const dayIdx = tbl ? +tbl.dataset.dayIdx : activeDay;
  const ref = td.dataset.ref;
  // contentEditable fügt teils geschützte Leerzeichen (U+00A0) ein → normalisieren,
  // sonst greift die numerische Override-Erkennung in _patchSheetXml nicht.
  const value = td.textContent.replace(/ /g, ' ').trim();
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
