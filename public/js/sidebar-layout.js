// ── Sidebar-Layout: Progressive Disclosure (Basis / Erweitert) ──────────────
// Steuert den „🔧 Erweiterte Einstellungen"-Expander (Zustand in localStorage)
// und die ℹ️-Buttons, die die standardmäßig versteckten Hilfetexte (.info-box)
// pro Sidebar-Sektion ein-/ausblenden. Rein visuelle UI-Schicht – kein Eingriff
// in den Plan-State (state-io.js bleibt unberührt).
(function () {
  'use strict';

  var ADVANCED_LS_KEY = 'dlrg_sidebar_advanced';

  // ── Master-Toggle „Erweiterte Einstellungen" ──────────────────────────────
  function initAdvancedToggle() {
    var details = document.getElementById('advanced-settings');
    if (!details) return;

    // Gespeicherten Zustand wiederherstellen (Default: zugeklappt)
    try {
      if (localStorage.getItem(ADVANCED_LS_KEY) === '1') details.open = true;
    } catch (e) { /* localStorage nicht verfügbar → Default belassen */ }

    details.addEventListener('toggle', function () {
      try {
        localStorage.setItem(ADVANCED_LS_KEY, details.open ? '1' : '0');
      } catch (e) { /* ignorieren */ }
    });
  }

  // ── ℹ️-Toggle pro Sektion für die statischen Hilfetexte ───────────────────
  function initInfoToggles() {
    var sections = document.querySelectorAll('#sidebar-inner-panel .section');
    Array.prototype.forEach.call(sections, function (section) {
      // Nur direkte .info-box-Kinder zählen (dynamisch gerenderte Inhalte
      // in #people-edit / #algo-params-fields etc. bleiben unangetastet)
      var hasInfoBox = Array.prototype.some.call(section.children, function (el) {
        return el.classList && el.classList.contains('info-box');
      });
      if (!hasInfoBox) return;

      var label = section.querySelector('.section-label');
      if (!label || label.querySelector('.info-toggle-btn')) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'info-toggle-btn';
      btn.textContent = 'ℹ️';
      btn.title = 'Hinweis ein-/ausblenden';
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () {
        var shown = section.classList.toggle('show-info');
        btn.setAttribute('aria-expanded', shown ? 'true' : 'false');
      });
      label.appendChild(btn);
    });
  }

  initAdvancedToggle();
  initInfoToggles();
})();
