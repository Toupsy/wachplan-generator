/* =========================================================
 * sidebar-layout.js — Akkordeon-Sidebar
 * Einklappbare <details class="acc-section">-Sektionen mit
 * Live-Zähler-Badges. Der Auf-/Zu-Status jeder Sektion wird
 * als reine UI-Präferenz in localStorage persistiert
 * (KEIN Plan-State, kein state-io.js / STATE_VERSION).
 * ========================================================= */

const ACC_STORAGE_KEY = 'dlrg_sidebar_acc';

function _accSections(){
  return Array.from(document.querySelectorAll('details.acc-section[data-acc]'));
}

/* Gespeicherten Auf-/Zu-Status laden ({ key: bool } oder null) */
function _accLoadState(){
  try{
    const raw = localStorage.getItem(ACC_STORAGE_KEY);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : null;
  }catch(e){ return null; }
}

function _accSaveState(){
  const state = {};
  _accSections().forEach(d => { state[d.dataset.acc] = d.open; });
  try{ localStorage.setItem(ACC_STORAGE_KEY, JSON.stringify(state)); }
  catch(e){ /* Quota / Private Mode → Präferenz wird einfach nicht gemerkt */ }
}

/* Zähler-Badges in den Summary-Headern aktualisieren */
function updateAccCounts(){
  const set = (key, text) => {
    const el = document.querySelector('details.acc-section[data-acc="' + key + '"] .acc-count');
    if(el) el.textContent = text;
  };
  if(typeof people !== 'undefined') set('people', String(people.length));
  if(typeof towers !== 'undefined') set('towers', String(towers.length));
  if(typeof boats  !== 'undefined') set('boats',  String(boats.length));
  if(typeof positionDescriptions !== 'undefined' && positionDescriptions){
    const filled = Object.values(positionDescriptions).filter(v => (v || '').trim()).length;
    set('positions', filled + '/5');
  }
  if(typeof exportColumns !== 'undefined' && Array.isArray(exportColumns)){
    const filled = exportColumns.filter(c => (c || '').trim()).length;
    set('export-columns', filled + '/' + exportColumns.length);
  }
  const fairnessChecks = document.querySelectorAll('#section-fairness-metrics input[type=checkbox]');
  if(fairnessChecks.length){
    const on = Array.from(fairnessChecks).filter(c => c.checked).length;
    set('fairness', on + '/' + fairnessChecks.length);
  }
  if(typeof DAYS !== 'undefined') set('schedule', DAYS + (DAYS === 1 ? ' Tag' : ' Tage'));
}

(function initSidebarAccordion(){
  const sections = _accSections();
  if(!sections.length) return;

  // 1) Persistierten Auf-/Zu-Status anwenden (Default aus dem HTML:
  //    "Wachgänger" + "Datum & Generierung" offen, Rest zu)
  const stored = _accLoadState();
  if(stored){
    sections.forEach(d => {
      if(Object.prototype.hasOwnProperty.call(stored, d.dataset.acc)){
        d.open = !!stored[d.dataset.acc];
      }
    });
  }
  sections.forEach(d => d.addEventListener('toggle', _accSaveState));

  // 2) Alle auf-/zuklappen
  const expandAll = document.getElementById('acc-expand-all');
  const collapseAll = document.getElementById('acc-collapse-all');
  if(expandAll)   expandAll.onclick   = () => _accSections().forEach(d => { d.open = true; });
  if(collapseAll) collapseAll.onclick = () => _accSections().forEach(d => { d.open = false; });

  // 3) Badges live halten:
  //    - Re-Renders (komplettes innerHTML-Replace durch render-sidebar.js)
  //      via MutationObserver auf den Listen-Containern
  //    - direkte Eingaben (Tageanzahl, Fairness-Checkboxen …) via
  //      input/change-Delegation auf der Sidebar
  let _accUpdateScheduled = false;
  const scheduleAccUpdate = () => {
    if(_accUpdateScheduled) return;
    _accUpdateScheduled = true;
    requestAnimationFrame(() => { _accUpdateScheduled = false; updateAccCounts(); });
  };
  ['people-edit', 'tower-cfg', 'boat-cfg', 'pos-desc-fields', 'export-col-fields'].forEach(id => {
    const el = document.getElementById(id);
    if(el) new MutationObserver(scheduleAccUpdate).observe(el, { childList: true });
  });
  const sidebarEl = document.querySelector('.sidebar');
  if(sidebarEl){
    sidebarEl.addEventListener('input',  scheduleAccUpdate);
    sidebarEl.addEventListener('change', scheduleAccUpdate);
  }
  updateAccCounts();
})();
