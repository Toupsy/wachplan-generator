// ── Sidebar-Tab-Layout ────────────────────────────────────────────
// Schaltet die Sidebar-Bereiche (👥 Team / 🗼 Stationen / ⚙️ Einstellungen /
// 📋 Plan) über die sticky Tab-Leiste oben in der Sidebar um. Alle Sektionen
// bleiben dauerhaft im DOM (nur per CSS-Klasse ein-/ausgeblendet), damit alle
// Event-Listener und die Autosave-Delegation auf `.sidebar` intakt bleiben.
// Der aktive Tab wird in localStorage persistiert (reiner UI-Zustand, NICHT
// Teil des Plan-States / state-io.js).

(function(){
  'use strict';

  const STORAGE_KEY = 'dlrg_sidebar_tab';
  const TAB_NAMES = ['team', 'stationen', 'einstellungen', 'plan'];

  /** Aktiviert den Tab `name` (Button-Highlight + Pane-Sichtbarkeit) und
   *  merkt ihn sich in localStorage. Unbekannte Namen fallen auf 'team' zurück. */
  function activateSidebarTab(name){
    if(TAB_NAMES.indexOf(name) === -1) name = TAB_NAMES[0];

    document.querySelectorAll('#sidebar-tabs .sidebar-tab').forEach(btn => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    TAB_NAMES.forEach(t => {
      const pane = document.getElementById('sidebar-tab-' + t);
      if(pane) pane.classList.toggle('active', t === name);
    });

    try { localStorage.setItem(STORAGE_KEY, name); }
    catch(e) { /* Privacy-Modus / Storage voll → Tab funktioniert trotzdem */ }
  }

  // Klick-Handler für die Tab-Buttons
  document.querySelectorAll('#sidebar-tabs .sidebar-tab').forEach(btn => {
    btn.addEventListener('click', () => activateSidebarTab(btn.dataset.tab));
  });

  // Beim Laden: zuletzt aktiven Tab wiederherstellen (Default: Team)
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); }
  catch(e) { /* localStorage nicht verfügbar */ }
  activateSidebarTab(saved || TAB_NAMES[0]);

  // Global verfügbar machen (z.B. für andere Module oder die Konsole)
  window.activateSidebarTab = activateSidebarTab;
})();
