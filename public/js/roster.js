// ============================================================
// roster.js – DLRG-Wachliste hochladen (CSV/PDF) und die Namensliste
//             dynamisch aus Startdatum + Anzahl Wachtage ableiten (Feature 31)
// ============================================================
//
// Ablauf:
//   1. User lädt die offizielle DLRG-Wachliste hoch (CSV oder PDF).
//   2. parseRosterCSV / parseRosterPDF liefern Roh-Zeilen
//      ({ nachname, vorname, job, quals, von, bis, status }).
//   3. normalizeRoster filtert auf "zugesagt", mappt Job→Rolle und Datum→ISO →
//      globales `roster` ([{ name, role, from, to }]).
//   4. applyRosterToWindow() baut people[] + tageweise Abwesenheiten neu auf,
//      ausgehend von `startDate` + `DAYS`. Wird bei jeder Datum-/Tage-Änderung
//      erneut aufgerufen → "dynamische" Namensliste.
//
// Erfahrung: importierte Personen starten als UNERFAHREN (bewusste Vorgabe –
// im Listen-Editor pro Person anpassbar). Rollen: WF→F, BF→B, RS→W.

// ── Reine Parser/Ableitungs-Funktionen (DOM-frei, testbar) ───────────────────

/** "07.08.2026" → "2026-08-07". Liefert '' bei ungültigem Format. */
function rosterDateToISO(s){
  if(!s) return '';
  const m = String(s).trim().match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if(!m) return '';
  const d = m[1].padStart(2,'0'), mo = m[2].padStart(2,'0'), y = m[3];
  return `${y}-${mo}-${d}`;
}

/** Job-Kürzel der Wachliste → interne Rolle. WF=Wachführer→F, BF=Bootsführer→B, RS→W. */
function rosterJobToRole(job){
  const j = String(job||'').trim().toUpperCase();
  if(j === 'WF') return 'F';
  if(j === 'BF') return 'B';
  return 'W';   // RS und alles Unbekannte → Wachgänger
}

/**
 * Parst die DLRG-Wachliste im CSV-Format (Semikolon-getrennt).
 * Findet die Kopfzeile (enthält Name/Vorname/Status) und mappt Spalten über die
 * Überschriften – robust gegen führende Metazeilen und nachgestellte Fußnoten.
 * @returns {Array<{nachname,vorname,job,quals,von,bis,status}>}
 */
function parseRosterCSV(text){
  const lines = String(text||'').replace(/\r/g,'').split('\n');
  // Kopfzeile suchen
  let headerIdx = -1, cols = null;
  for(let i = 0; i < lines.length; i++){
    const parts = lines[i].split(';').map(s => s.trim());
    const lower = parts.map(s => s.toLowerCase());
    if(lower.includes('name') && lower.includes('vorname') && lower.includes('status')){
      headerIdx = i;
      cols = parts;
      break;
    }
  }
  if(headerIdx < 0) return [];

  const idx = name => cols.findIndex(c => c.toLowerCase().startsWith(name));
  const iName   = idx('name');
  const iVor    = idx('vorname');
  const iJob    = idx('job');
  const iQuals  = idx('zusatz');
  const iVon    = idx('von');
  const iBis    = idx('bis');
  const iStatus = idx('status');

  const out = [];
  for(let i = headerIdx + 1; i < lines.length; i++){
    const raw = lines[i];
    if(!raw.trim()) continue;
    const f = raw.split(';');
    const get = j => (j >= 0 && j < f.length) ? f[j].trim() : '';
    const nachname = get(iName);
    const vorname  = get(iVor);
    const status   = get(iStatus).toLowerCase();
    // Eine echte Datenzeile hat einen Namen und einen erkennbaren Status.
    if(!nachname && !vorname) continue;
    if(status !== 'zugesagt' && status !== 'abgesagt') continue;
    out.push({
      nachname, vorname,
      job:    get(iJob),
      quals:  get(iQuals),
      von:    get(iVon),
      bis:    get(iBis),
      status,
    });
  }
  return out;
}

/**
 * Wandelt Roh-Zeilen (CSV oder PDF) in das globale roster-Format um:
 * filtert auf "zugesagt", mappt Job→Rolle, Datum→ISO.
 * @returns {Array<{name, role, from, to}>}
 */
function normalizeRoster(rawEntries){
  const out = [];
  (rawEntries||[]).forEach(e => {
    if(String(e.status||'').toLowerCase() !== 'zugesagt') return;
    const from = rosterDateToISO(e.von);
    const to   = rosterDateToISO(e.bis);
    if(!from || !to) return;
    const name = `${(e.vorname||'').trim()} ${(e.nachname||'').trim()}`.trim();
    if(!name) return;
    out.push({ name, role: rosterJobToRole(e.job), from, to: (to < from ? from : to) });
  });
  return out;
}

/**
 * Leitet aus dem roster + den konkreten Plan-Tagesdaten die Namensliste ab.
 * Personen werden über den Namen zusammengeführt (eine Person, auch wenn sie in
 * mehreren Wochenblöcken auftaucht). Pro Person:
 *   - aufgenommen, sobald ihre Verfügbarkeit den Plan-Zeitraum überlappt,
 *   - Rolle = die mit der größten Überlappung (Gleichstand: F vor B vor W),
 *   - absentDays = Plan-Tage, an denen die Person NICHT verfügbar ist.
 * @param {Array} rosterArr  – [{name, role, from, to}]
 * @param {Array<string>} dayDates – ISO-Datum pro Plan-Tag ('YYYY-MM-DD')
 * @returns {Array<{name, role, experienced, absentDays:number[]}>}
 */
function deriveRosterPeople(rosterArr, dayDates){
  const dates = (dayDates||[]).filter(Boolean);
  if(!dates.length) return [];
  const windowStart = dates[0], windowEnd = dates[dates.length - 1];

  const groups = new Map();   // key → { name, entries:[] }
  (rosterArr||[]).forEach(e => {
    if(!(e.from <= windowEnd && e.to >= windowStart)) return;   // keine Überlappung
    const key = e.name.toLowerCase();
    if(!groups.has(key)) groups.set(key, { name: e.name, entries: [] });
    groups.get(key).entries.push(e);
  });

  const roleRank = { F:0, B:1, W:2 };
  const result = [];
  groups.forEach(g => {
    const avail = new Set();          // Tag-Indizes mit Verfügbarkeit
    const roleOverlap = { F:0, B:0, W:0 };
    g.entries.forEach(e => {
      dayDates.forEach((d, di) => {
        if(d && d >= e.from && d <= e.to){
          avail.add(di);
          roleOverlap[e.role] = (roleOverlap[e.role]||0) + 1;
        }
      });
    });
    if(avail.size === 0) return;      // überlappt nur außerhalb der konkreten Tage

    // Rolle mit größter Überlappung (Gleichstand → F vor B vor W)
    let role = 'W', best = -1;
    ['F','B','W'].forEach(r => { if((roleOverlap[r]||0) > best){ best = roleOverlap[r]||0; role = r; } });

    const absentDays = [];
    for(let i = 0; i < dayDates.length; i++) if(!avail.has(i)) absentDays.push(i);

    result.push({ name: g.name, role, experienced: false, absentDays });
  });

  result.sort((a,b) => (roleRank[a.role] - roleRank[b.role]) || a.name.localeCompare(b.name, 'de'));
  return result;
}

// In Node-Testumgebung exportieren (Browser ignoriert das).
if(typeof module !== 'undefined' && module.exports){
  module.exports = { rosterDateToISO, rosterJobToRole, parseRosterCSV, normalizeRoster, deriveRosterPeople };
}

// ── PDF-Parsing (lädt pdf.js bei Bedarf von cdnjs) ───────────────────────────

let _pdfjsPromise = null;
function loadPdfJsLib(){
  if(typeof window !== 'undefined' && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(_pdfjsPromise) return _pdfjsPromise;
  const VER = '3.11.174';
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + VER + '/';
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = base + 'pdf.min.js';
    s.onload = () => {
      if(!window.pdfjsLib){ reject(new Error('pdf.js nicht verfügbar')); return; }
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; } catch(e){}
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { _pdfjsPromise = null; reject(new Error('pdf.js konnte nicht geladen werden (Internetverbindung nötig)')); };
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}

/** Gruppiert pdf.js-Textelemente zeilenweise (gleiche y-Position) und sortiert je Zeile nach x. */
function _pdfGroupLines(items){
  const toks = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  let cur = null;
  toks.forEach(t => {
    if(!cur || Math.abs(cur.y - t.y) > 3){
      cur = { y: t.y, toks: [t] };
      lines.push(cur);
    } else {
      cur.toks.push(t);
    }
  });
  lines.forEach(l => l.toks.sort((a, b) => a.x - b.x));
  return lines.map(l => l.toks);
}

/** Erkennt aus einer Kopfzeile die Spalten-Anker (x-Position je Überschrift). */
function _pdfDetectColumns(lineToks){
  const lower = lineToks.map(t => t.str.trim().toLowerCase());
  if(!(lower.includes('name') && lower.includes('vorname') && lower.some(s => s.startsWith('status')))) return null;
  const keyFor = s => {
    const l = s.trim().toLowerCase();
    if(l === 'name') return 'nachname';
    if(l === 'vorname') return 'vorname';
    if(l === 'job') return 'job';
    if(l.startsWith('zusatz')) return 'quals';
    if(l === 'von') return 'von';
    if(l === 'bis') return 'bis';
    if(l.startsWith('status')) return 'status';
    return null;   // Anker ohne Zielfeld (nur als Spaltengrenze)
  };
  return lineToks.map(t => ({ key: keyFor(t.str), x: t.x })).sort((a, b) => a.x - b.x);
}

/** Verteilt die Tokens einer Datenzeile auf die Spalten-Anker und baut eine Roh-Zeile. */
function _pdfBucketRow(lineToks, columns){
  const buckets = columns.map(() => []);
  lineToks.forEach(t => {
    let ci = 0;
    for(let i = 0; i < columns.length; i++){ if(columns[i].x <= t.x + 2) ci = i; else break; }
    buckets[ci].push(t.str);
  });
  const row = {};
  columns.forEach((c, i) => { if(c.key) row[c.key] = (row[c.key] ? row[c.key] + ' ' : '') + buckets[i].join(' ').trim(); });
  const status = String(row.status||'').toLowerCase().trim();
  const isStatus = status === 'zugesagt' || status === 'abgesagt';
  const hasDates = rosterDateToISO(row.von) && rosterDateToISO(row.bis);
  if(!isStatus || !hasDates) return null;
  return {
    nachname: (row.nachname||'').trim(),
    vorname:  (row.vorname||'').trim(),
    job:      (row.job||'').trim(),
    quals:    (row.quals||'').trim(),
    von:      (row.von||'').trim(),
    bis:      (row.bis||'').trim(),
    status,
  };
}

/** Liest die Wachliste aus einem PDF (ArrayBuffer) → Roh-Zeilen. */
async function parseRosterPDF(arrayBuffer){
  const pdfjs = await loadPdfJsLib();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let columns = null;
  const rows = [];
  for(let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines = _pdfGroupLines(tc.items);
    for(const line of lines){
      const maybeCols = _pdfDetectColumns(line);
      if(maybeCols){ columns = maybeCols; continue; }
      if(!columns) continue;
      const row = _pdfBucketRow(line, columns);
      if(row) rows.push(row);
    }
  }
  return rows;
}

// ── Integration (UI / State) ─────────────────────────────────────────────────

/** Statuszeile + Buttons der Wachlisten-Karte aktualisieren. */
function updateRosterIndicator(){
  const status = document.getElementById('roster-status');
  const clearBtn = document.getElementById('btn-roster-clear');
  const loaded = typeof roster !== 'undefined' && roster.length > 0;
  if(status){
    status.style.display = loaded ? '' : 'none';
    if(loaded) status.textContent = `📋 Wachliste geladen: ${roster.length} zugesagte Einträge`;
  }
  if(clearBtn) clearBtn.style.display = loaded ? '' : 'none';
}

/**
 * Baut people[] + tageweise Abwesenheiten neu aus dem roster auf,
 * ausgehend von startDate + DAYS. Kern der "dynamischen" Namensliste.
 */
function applyRosterToWindow(){
  if(typeof roster === 'undefined' || !roster.length) return;
  if(!startDate){ showToast('Bitte zuerst ein Startdatum wählen', true); return; }

  const dayDates = computeDayDates();
  const derived = deriveRosterPeople(roster, dayDates);

  if(!derived.length){
    showToast('⚠️ Keine Person der Wachliste ist im gewählten Zeitraum verfügbar – Startdatum/Tage prüfen', true);
    return;
  }

  // Neue people[] mit frischen IDs
  people = derived.map(d => ({ id: ++uid, name: d.name, role: d.role, experienced: !!d.experienced, enableLabels: true }));

  // Zwangszuweisungen referenzieren alte IDs → zurücksetzen
  forcedPlacements = freshForcedPlacements();

  // dayState neu aufbauen: sick/absent leeren, Turm-/Boot-Schließungen je Tag erhalten
  const old = dayState || [];
  dayState = Array.from({ length: DAYS }, (_, i) => ({
    sick:        new Set(),
    absent:      new Set(),
    closed:      new Set(old[i] ? old[i].closed : []),
    closedBoats: new Set(old[i] ? old[i].closedBoats : []),
  }));

  // Tageweise Abwesenheiten setzen (außerhalb der persönlichen Verfügbarkeit)
  let absCount = 0;
  derived.forEach((d, i) => {
    const pid = people[i].id;
    d.absentDays.forEach(day => { if(dayState[day]){ dayState[day].absent.add(pid); absCount++; } });
  });

  if(activeDay >= DAYS) activeDay = 0;

  renderPeople();
  if(lastResult) generate();
  updateRosterIndicator();
  scheduleAutoSave();

  showToast(`✅ ${people.length} Personen aus Wachliste übernommen`
    + (absCount > 0 ? ` · ${absCount} Abwesenheits-Tag${absCount === 1 ? '' : 'e'}` : ''));
}

/** Hochgeladene Datei verarbeiten (CSV oder PDF). */
async function handleRosterFile(file){
  if(!file) return;
  try {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    let raw;
    if(isPdf){
      showToast('⏳ PDF wird gelesen …');
      const buf = await file.arrayBuffer();
      raw = await parseRosterPDF(buf);
    } else {
      const text = await file.text();
      raw = parseRosterCSV(text);
    }
    const norm = normalizeRoster(raw);
    if(!norm.length){
      showToast('Keine zugesagten Einträge gefunden – bitte Datei/Format prüfen', true);
      return;
    }
    roster = norm;

    // Falls noch kein Startdatum gesetzt: frühesten Verfügbarkeitsbeginn vorschlagen
    if(!startDate){
      const minFrom = roster.reduce((m, r) => (!m || r.from < m) ? r.from : m, '');
      if(minFrom){
        startDate = minFrom;
        const sd = document.getElementById('start-date');
        if(sd) sd.value = startDate;
      }
    }

    updateRosterIndicator();
    applyRosterToWindow();
  } catch(e){
    console.error('Wachlisten-Import fehlgeschlagen:', e);
    showToast('Fehler beim Lesen der Datei: ' + (e && e.message ? e.message : e), true);
  }
}

/** Hochgeladene Wachliste wieder verwerfen. */
function clearRoster(){
  roster = [];
  updateRosterIndicator();
  scheduleAutoSave();
  showToast('🗑️ Wachliste entfernt – Namensliste bleibt erhalten');
}
