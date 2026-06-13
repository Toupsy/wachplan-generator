// ============================================================
// layout-chrome.js – Layout-Chrome (Top-Bar + Sidebar)
// Zwei reine UI-Verbesserungen, ohne Eingriff in State/Plan:
//   1. Top-Bar zeigt nur den Titel; Badges + Beschreibung
//      stecken in einem einklappbaren Info-Kästchen (ℹ-Button).
//   2. Sidebar lässt sich ein-/ausklappen (Desktop ≥901px);
//      Zustand wird in localStorage persistiert.
// Auf Mobile (<900px) übernimmt der vorhandene Tab-Switch das
// Umschalten – die Sidebar-Buttons sind dort per CSS ausgeblendet.
// ============================================================

(function () {
  'use strict';

  // ── 1. Sidebar ein-/ausklappen ──
  const SIDEBAR_KEY = 'dlrg_sidebar_collapsed';
  const panels = document.querySelector('.main-panels');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  const expandBtn = document.getElementById('sidebar-expand-btn');

  function setCollapsed(collapsed) {
    if (!panels) return;
    panels.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (e) { /* private mode */ }
  }

  if (collapseBtn) collapseBtn.addEventListener('click', () => setCollapsed(true));
  if (expandBtn) expandBtn.addEventListener('click', () => setCollapsed(false));

  let initCollapsed = false;
  try { initCollapsed = localStorage.getItem(SIDEBAR_KEY) === '1'; } catch (e) { /* ignore */ }
  setCollapsed(initCollapsed);

  // ── 2. Info-Kästchen ein-/ausklappen ──
  const INFO_KEY = 'dlrg_header_info_open';
  const infoToggle = document.getElementById('info-toggle');
  const infoBox = document.getElementById('header-info');

  function setInfoOpen(open) {
    if (!infoToggle || !infoBox) return;
    infoBox.classList.toggle('open', open);
    infoToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem(INFO_KEY, open ? '1' : '0'); } catch (e) { /* private mode */ }
  }

  if (infoToggle && infoBox) {
    infoToggle.addEventListener('click', () => {
      setInfoOpen(!infoBox.classList.contains('open'));
    });
    let initOpen = false;
    try { initOpen = localStorage.getItem(INFO_KEY) === '1'; } catch (e) { /* ignore */ }
    setInfoOpen(initOpen);
  }
})();
