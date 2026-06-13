// ============================================================
// layout-chrome.js – Layout-Chrome (Top-Bar + Sidebar)
// Zwei reine UI-Verbesserungen, ohne Eingriff in State/Plan:
//   1. Top-Bar (header) klappt beim Runterscrollen weg und
//      erscheint beim Hochscrollen / am Seitenanfang wieder.
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

  // ── 2. Top-Bar weg-scrollen ──
  const wrap = document.querySelector('.wrap');
  const output = document.getElementById('output-panel');
  let last = 0;

  function onScroll(top) {
    if (!wrap) return;
    if (top <= 4) {                       // am Anfang immer zeigen
      wrap.classList.remove('chrome-header-hidden');
    } else if (top > last + 6 && top > 60) { // runter → wegklappen
      wrap.classList.add('chrome-header-hidden');
    } else if (top < last - 6) {          // hoch → wieder zeigen
      wrap.classList.remove('chrome-header-hidden');
    }
    last = top;
  }

  // Desktop scrollt im Output-Panel, Mobile im Dokument.
  if (output) output.addEventListener('scroll', () => onScroll(output.scrollTop), { passive: true });
  window.addEventListener('scroll', () => onScroll(window.scrollY || document.documentElement.scrollTop || 0), { passive: true });
})();
