// ── Sidebar-Layout: Sticky Quick-Nav (Scroll-Spy) + "?"-Hilfe-Toggles ────────
// Rein ergonomische Schicht über der bestehenden Sidebar:
// - Quick-Nav (#sidebar-quicknav): klick = Smooth-Scroll zur Sektion,
//   IntersectionObserver hält den aktiven Chip synchron (Scroll-Spy).
// - "?"-Buttons neben den Sektions-Labels klappen die statischen Info-Boxen
//   ein/aus (Standard: eingeklappt, Zustand nicht persistiert).
// - Berechnet Offsets für Sticky-Nav (Desktop: .sidebar-Scroller, Mobile:
//   Seite scrollt unter der .mobile-switch-Leiste).
// Verändert KEINE bestehenden Element-IDs und registriert keine Listener um,
// die init.js / user-info.js bereits gebunden haben.

(function(){
  'use strict';

  const innerPanel = document.getElementById('sidebar-inner-panel');
  const nav = document.getElementById('sidebar-quicknav');
  if(!innerPanel || !nav) return;

  const navButtons = Array.from(nav.querySelectorAll('.qn-btn'));
  const sections = navButtons
    .map(btn => document.getElementById(btn.dataset.target))
    .filter(Boolean);

  // user-info-header ist ausgeloggt display:none → aus dem Spy ausnehmen
  const visibleSections = () => sections.filter(s => s.offsetParent !== null);

  // ── Offsets: Sticky-Top (unter Mobile-Switch) + scroll-margin der Sektionen ──
  function updateOffsets(){
    let top = 0;
    const ms = document.querySelector('.mobile-switch');
    if(ms && window.matchMedia('(max-width: 900px)').matches){
      top = ms.offsetHeight;
    }
    nav.style.setProperty('--qn-top', top + 'px');
    innerPanel.style.setProperty('--qn-offset', (top + nav.offsetHeight + 8) + 'px');
  }

  // ── Scroll-Spy ──
  function setActive(id){
    navButtons.forEach(b => b.classList.toggle('active', b.dataset.target === id));
  }

  function recomputeActive(){
    const vis = visibleSections();
    if(!vis.length) return;
    const navBottom = nav.getBoundingClientRect().bottom;
    let current = vis[0];
    for(const s of vis){
      if(s.getBoundingClientRect().top <= navBottom + 24) current = s;
    }
    setActive(current.id);
  }

  // IntersectionObserver als Trigger; root:null berücksichtigt das Clipping
  // durch den .sidebar-Scroller (Desktop) UND den Viewport (Mobile).
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver(recomputeActive, { threshold: [0, .25, .5, .75, 1] });
    sections.forEach(s => io.observe(s));
  }
  // Feinere Updates beim Scrollen (rAF-gedrosselt, passive)
  let ticking = false;
  function onScroll(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; recomputeActive(); });
  }
  const scroller = document.querySelector('.sidebar');
  if(scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { updateOffsets(); recomputeActive(); });

  // ── Klick → Smooth-Scroll (scroll-margin-top regelt den Sticky-Offset) ──
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      let target = document.getElementById(btn.dataset.target);
      if(!target) return;
      if(target.offsetParent === null) target = visibleSections()[0] || target;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActive(btn.dataset.target);
    });
  });

  // ── "?"-Hilfe-Toggles: statische Info-Boxen pro Sektion einklappbar ──
  innerPanel.querySelectorAll('.section').forEach(section => {
    const boxes = section.querySelectorAll(':scope > .info-box');
    if(!boxes.length) return;
    boxes.forEach(b => b.classList.add('help-text'));
    const label = section.querySelector(':scope > .section-label');
    if(!label) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'help-toggle';
    btn.textContent = '?';
    btn.title = 'Hilfe ein-/ausblenden';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      const open = section.classList.toggle('show-help');
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
    label.appendChild(btn);
  });

  updateOffsets();
  recomputeActive();
})();
