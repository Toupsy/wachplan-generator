// sidebar-layout.js – „⚙️ Plan-Einstellungen"-Modal (Sidebar-Offload)
// Öffnen/Schließen + Tab-Wechsel des Settings-Modals und Autosave-Kompensation:
// init.js bindet input/change für scheduleAutoSave() nur auf `.sidebar` – die ins Modal
// verschobenen Sektionen (Positionen, Export-Spalten, Fairness-Metriken, Algorithmus-
// Parameter, Dienstzeit, Seed) brauchen daher hier eigene gleichwertige Listener.
// Lädt NACH state-io.js (scheduleAutoSave existiert) und VOR init.js.

(function () {
  'use strict';

  const modal = document.getElementById('settings-modal');
  const openBtn = document.getElementById('btn-open-settings');
  const closeBtn = document.getElementById('settings-modal-close-btn');

  function openSettingsModal () {
    if (modal) modal.style.display = 'flex';
  }

  function closeSettingsModal () {
    if (modal) modal.style.display = 'none';
  }

  if (openBtn) openBtn.addEventListener('click', openSettingsModal);
  if (closeBtn) closeBtn.addEventListener('click', closeSettingsModal);

  if (modal) {
    // Klick auf den Overlay-Hintergrund schließt (gleiches Muster wie #share-modal/#plans-modal)
    modal.addEventListener('click', e => { if (e.target === modal) closeSettingsModal(); });

    // ── Tab-Wechsel (Allgemein / Export / Fairness / Planstatus) ──
    const tabs = modal.querySelectorAll('.settings-tab');
    const panels = modal.querySelectorAll('.settings-tab-panel');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        panels.forEach(p => p.classList.toggle('active', p.dataset.tabPanel === tab.dataset.tab));
      });
    });

    // ── Autosave-Kompensation für die aus der Sidebar verschobenen Sektionen ──
    // Programmatisches Setzen von .value löst kein input/change aus → nur echte Nutzer-Edits.
    const triggerAutoSave = () => {
      if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    };
    modal.addEventListener('input', triggerAutoSave);
    modal.addEventListener('change', triggerAutoSave);
  }

  // Global verfügbar machen (Konsistenz mit openMoveModal/openShareModal-Muster)
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;
})();
