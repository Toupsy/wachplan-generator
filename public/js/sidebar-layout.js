// ============================================================
// sidebar-layout.js – Master-Detail Drill-Down der Sidebar
// Home-Menü mit Live-Zusammenfassungen → Detail-Ansicht pro
// Kategorie ("Settings-App"-Muster). Reine UI-Schicht:
// alle Sektionen bleiben statisch im DOM (Listener aus init.js,
// user-info.js etc. bleiben gültig), nur die Sichtbarkeit wird
// über .sb-active auf den .sb-view-Wrappern umgeschaltet.
// Letzte Ansicht wird in localStorage persistiert (kein Eingriff
// in state-io.js / Plan-Serialisierung).
// ============================================================

(function () {
  'use strict';

  const VIEW_STORAGE_KEY = 'dlrg_sidebar_view';
  const panel = document.getElementById('sidebar-inner-panel');
  if (!panel) return;

  const views = Array.from(panel.querySelectorAll('.sb-view'));
  const viewNames = views.map(v => v.dataset.sbView);

  function currentView() {
    const active = views.find(v => v.classList.contains('sb-active'));
    return active ? active.dataset.sbView : 'home';
  }

  // ── Mini-Router: genau eine Ansicht sichtbar ──
  function showView(name) {
    if (viewNames.indexOf(name) === -1) name = 'home';
    views.forEach(v => v.classList.toggle('sb-active', v.dataset.sbView === name));
    try { localStorage.setItem(VIEW_STORAGE_KEY, name); } catch (e) { /* private mode */ }
    const scroller = panel.closest('.sidebar');
    if (scroller && scroller.scrollTop) scroller.scrollTop = 0;
  }

  panel.querySelectorAll('.sb-card[data-sb-target]').forEach(card => {
    card.addEventListener('click', () => showView(card.dataset.sbTarget));
  });
  panel.querySelectorAll('.sb-back').forEach(btn => {
    btn.addEventListener('click', () => showView('home'));
  });

  // ── Live-Zusammenfassungen auf den Home-Karten ──
  function setSum(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function plural(n, singular, pluralWord) {
    return n + ' ' + (n === 1 ? singular : pluralWord);
  }

  function countChecked(ids) {
    return ids.filter(id => {
      const el = document.getElementById(id);
      return el && el.checked;
    }).length;
  }

  function updateSummaries() {
    try {
      if (typeof people !== 'undefined' && Array.isArray(people)) {
        const f = people.filter(p => p.role === 'F').length;
        const b = people.filter(p => p.role === 'B').length;
        setSum('sb-sum-people', plural(people.length, 'Person', 'Personen') + ' · ' + f + ' F · ' + b + ' BF');
      }
      if (typeof towers !== 'undefined' && Array.isArray(towers)) {
        const mainKEl = document.getElementById('main-k');
        const k = mainKEl ? (parseInt(mainKEl.value, 10) || 0) : 0;
        setSum('sb-sum-towers', plural(towers.length, 'Turm', 'Türme') + ' · HW +' + k + ' Slots');
      }
      if (typeof boats !== 'undefined' && Array.isArray(boats)) {
        setSum('sb-sum-boats', plural(boats.length, 'Boot', 'Boote'));
      }
      if (typeof positionDescriptions !== 'undefined' && typeof exportColumns !== 'undefined') {
        const pos = Object.values(positionDescriptions || {}).filter(v => v && String(v).trim()).length;
        const cols = (exportColumns || []).filter(c => c && String(c).trim()).length;
        setSum('sb-sum-positions', pos + ' Positionen · ' + cols + ' XLSX-Spalten');
      }
      const metrics = countChecked(['metric-hw-balance', 'metric-tower-dist', 'metric-boat-pairing']);
      const charts = countChecked(['chart-assignments', 'chart-hw-days', 'chart-tower-util']);
      setSum('sb-sum-fairness', metrics + ' Metriken · ' + charts + ' Charts aktiv');
      const sh = document.getElementById('service-start-hour');
      const eh = document.getElementById('service-end-hour');
      const seedEl = document.getElementById('seed-input');
      if (sh && eh && seedEl) {
        const pad = v => String(parseInt(v, 10) || 0).padStart(2, '0');
        const seedVal = parseInt(seedEl.value, 10) || 0;
        setSum('sb-sum-options', pad(sh.value) + '–' + pad(eh.value) + ' Uhr · Seed ' + (seedVal === 0 ? 'aus' : seedVal));
      }
      const ind = document.getElementById('autosave-indicator');
      const indText = ind ? ind.textContent.trim() : '';
      setSum('sb-sum-storage', indText || 'JSON-Export · Import · Autosave');
      const unameEl = document.getElementById('user-info-username');
      const uname = unameEl ? unameEl.textContent.trim() : '';
      setSum('sb-sum-account', (uname && uname !== '-') ? 'Angemeldet als ' + uname : 'Nicht angemeldet');
    } catch (e) { /* Zusammenfassungen sind rein kosmetisch – nie blockieren */ }
  }

  // Konto-Karte spiegelt die Sichtbarkeit von #user-info-header
  // (user-info.js togglet dort style.display – das bleibt unangetastet).
  function syncAccountCard() {
    const header = document.getElementById('user-info-header');
    const card = document.getElementById('sb-card-account');
    if (!header || !card) return;
    const desired = header.style.display === 'none' ? 'none' : '';
    if (card.style.display !== desired) card.style.display = desired;
    if (desired === 'none' && currentView() === 'account') showView('home');
  }

  // ── Updates: Sidebar-Eingaben + Re-Renders (innerHTML-Replace
  // durch render-sidebar.js) via MutationObserver, entprellt. ──
  let pending = 0;
  function scheduleUpdate() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      updateSummaries();
      syncAccountCard();
    }, 120);
  }
  panel.addEventListener('input', scheduleUpdate);
  panel.addEventListener('change', scheduleUpdate);
  new MutationObserver(scheduleUpdate).observe(panel, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style']
  });

  // ── Letzte Ansicht wiederherstellen + Initialzustand ──
  let initial = 'home';
  try { initial = localStorage.getItem(VIEW_STORAGE_KEY) || 'home'; } catch (e) { /* ignore */ }
  showView(initial);
  updateSummaries();
  syncAccountCard();
})();
