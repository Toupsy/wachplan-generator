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

  // ── 3. Hamburger-Menü (Mobile <768px) ──
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const hamburgerMenu = document.getElementById('hamburger-menu');
  const hamburgerOverlay = document.getElementById('hamburger-overlay');

  function closeHamburger() {
    if (!hamburgerMenu) return;
    hamburgerMenu.classList.remove('open');
    if (hamburgerOverlay) hamburgerOverlay.classList.remove('active');
    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'false');
  }

  function openHamburgerMenu() {
    if (!hamburgerMenu) return;
    hamburgerMenu.classList.add('open');
    if (hamburgerOverlay) hamburgerOverlay.classList.add('active');
    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'true');
  }

  function switchMobilePanel(idx) {
    document.querySelectorAll('.main-panel').forEach((p, i) => p.classList.toggle('mobile-active', i === idx));
    document.querySelectorAll('.ms-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
  }

  function scrollToOutputSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', () => {
      if (hamburgerMenu && hamburgerMenu.classList.contains('open')) {
        closeHamburger();
      } else {
        openHamburgerMenu();
      }
    });
  }

  if (hamburgerOverlay) {
    hamburgerOverlay.addEventListener('click', closeHamburger);
  }

  if (hamburgerMenu) {
    hamburgerMenu.querySelectorAll('.ham-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.hamAction;
        closeHamburger();

        if (action === 'info') {
          setInfoOpen(!infoBox || !infoBox.classList.contains('open'));
          if (infoBox) infoBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (action === 'config') {
          switchMobilePanel(0);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (action === 'plan') {
          switchMobilePanel(1);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (action === 'tower-stats') {
          switchMobilePanel(1);
          setTimeout(() => scrollToOutputSection('out-tower-stats'), 80);
        } else if (action === 'boat-stats') {
          switchMobilePanel(1);
          setTimeout(() => scrollToOutputSection('out-boat-stats'), 80);
        } else if (action === 'matrix') {
          switchMobilePanel(1);
          setTimeout(() => scrollToOutputSection('out-matrix'), 80);
        }
      });
    });
  }
})();
