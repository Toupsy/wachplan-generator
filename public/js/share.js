// ============================================================
// share.js – Plan mit anderen Usern teilen (Mitbearbeiter verwalten)
// Auswahl per exaktem Benutzernamen (privacy-freundlich: keine User-Enumeration).
// Nutzt currentPlanId (state-io.js), autoSave, escapeHtml, showToast.
// ============================================================

function _setShareMsg(text, ok) {
  const el = document.getElementById('share-msg');
  if (el) { el.textContent = text || ''; el.style.color = ok ? 'var(--green)' : 'var(--coral)'; }
}

async function openShareModal() {
  const modal = document.getElementById('share-modal');
  if (!modal) return;
  _setShareMsg('');
  const input = document.getElementById('share-username');
  if (input) input.value = '';
  // Zuvor angezeigtes Token nicht über das Schließen hinaus stehen lassen
  const reveal = document.getElementById('public-link-reveal');
  if (reveal) reveal.style.display = 'none';
  const urlInput = document.getElementById('public-link-url');
  if (urlInput) urlInput.value = '';

  // Plan muss serverseitig existieren, damit er eine ID zum Teilen hat
  if (typeof currentPlanId === 'undefined' || currentPlanId === null) {
    if (typeof autoSave === 'function') { try { await autoSave(); } catch (e) {} }
  }
  if (currentPlanId === null) {
    _setShareMsg('Bitte zuerst einen Plan erstellen (generieren), dann teilen.');
    document.getElementById('share-list').innerHTML = '';
    document.getElementById('share-add-row').style.display = 'none';
    modal.style.display = 'flex';
    return;
  }

  modal.style.display = 'flex';
  await loadShares();
  if (input) input.focus();
}

function closeShareModal() {
  const m = document.getElementById('share-modal');
  if (m) m.style.display = 'none';
}

async function loadShares() {
  const listEl = document.getElementById('share-list');
  const addRow = document.getElementById('share-add-row');
  const sub = document.getElementById('share-modal-sub');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem">Lädt…</div>';

  try {
    const res = await fetch(`/api/plans/${currentPlanId}/shares`, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { listEl.innerHTML = ''; _setShareMsg(data.error || 'Konnte Freigaben nicht laden.'); return; }

    // Nur der Eigentümer darf verwalten
    if (addRow) addRow.style.display = data.isOwner ? 'flex' : 'none';
    if (sub) sub.textContent = data.isOwner
      ? 'Gib den genauen Benutzernamen ein, mit dem du diesen Plan gemeinsam bearbeiten möchtest.'
      : `Dieser Plan gehört „${data.ownerName}". Du bist Mitbearbeiter.`;

    const rows = [];
    // Eigentümer-Zeile
    rows.push(_shareRow(`👑 ${escapeHtml(data.ownerName)}`, 'Eigentümer', null, false));
    // Mitbearbeiter (mit Rolle)
    (data.collaborators || []).forEach(c => {
      const roleLbl = c.role === 'view' ? '👁 Nur ansehen' : '✏️ Bearbeiten';
      rows.push(_shareRow(`🧑 ${escapeHtml(c.username)}`, roleLbl, c.userId, data.isOwner));
    });
    listEl.innerHTML = rows.join('');

    // Remove-Buttons verdrahten
    listEl.querySelectorAll('[data-remove-user]').forEach(btn => {
      btn.onclick = () => removeCollaborator(+btn.dataset.removeUser, btn.dataset.username);
    });

    // Beobachter-Link-Bereich nur dem Eigentümer zeigen
    const pubSection = document.getElementById('public-link-section');
    if (pubSection) {
      pubSection.style.display = data.isOwner ? 'block' : 'none';
      if (data.isOwner) loadPublicLinks();
    }
  } catch (e) {
    listEl.innerHTML = '';
    _setShareMsg('Netzwerkfehler beim Laden.');
  }
}

// ── Beobachter-Links (Nur-Ansicht ohne Login, 7 Tage gültig) ──────────

/** Baut die volle Beobachter-URL aus einem Token. */
function _publicLinkUrl(token) {
  return `${window.location.origin}/?view=${token}`;
}

async function loadPublicLinks() {
  const listEl = document.getElementById('public-link-list');
  if (!listEl) return;
  try {
    const res = await fetch(`/api/plans/${currentPlanId}/public-links`, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { listEl.innerHTML = ''; return; }
    const links = data.links || [];
    if (!links.length) {
      listEl.innerHTML = '<div style="color:var(--text-dim);font-size:.78rem">Kein aktiver Link.</div>';
      return;
    }
    listEl.innerHTML = links.map(l => {
      const exp = new Date(l.expires_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--deep);border:1px solid var(--line);border-radius:6px;padding:8px 10px">
        <div style="font-size:.8rem;color:var(--text)">🔗 Aktiver Link</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:.68rem;color:var(--text-dim)">gültig bis ${exp}</span>
          <button class="ghost-btn" data-revoke-link="${l.id}" title="Link zurückziehen"
            style="border-color:var(--coral);color:var(--coral);font-size:.72rem;padding:4px 8px">✕</button>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('[data-revoke-link]').forEach(btn => {
      btn.onclick = () => revokePublicLink(+btn.dataset.revokeLink);
    });
  } catch (e) {
    listEl.innerHTML = '';
  }
}

async function createPublicLink() {
  const btn = document.getElementById('public-link-create-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/plans/${currentPlanId}/public-link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { _setShareMsg(data.error || 'Link konnte nicht erstellt werden.'); return; }

    const url = _publicLinkUrl(data.token);
    const reveal = document.getElementById('public-link-reveal');
    const urlInput = document.getElementById('public-link-url');
    if (urlInput) urlInput.value = url;
    if (reveal) reveal.style.display = 'block';
    if (urlInput) { urlInput.focus(); urlInput.select(); }
    if (typeof showToast === 'function') showToast('✓ Beobachter-Link erstellt (7 Tage gültig)');
    await loadPublicLinks();
  } catch (e) {
    _setShareMsg('Netzwerkfehler.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function copyPublicLink() {
  const urlInput = document.getElementById('public-link-url');
  if (!urlInput || !urlInput.value) return;
  try {
    await navigator.clipboard.writeText(urlInput.value);
    if (typeof showToast === 'function') showToast('📋 Link kopiert');
  } catch (e) {
    // Fallback für Browser ohne Clipboard-API / unsicheren Kontext
    urlInput.select();
    try { document.execCommand('copy'); if (typeof showToast === 'function') showToast('📋 Link kopiert'); }
    catch (_) { _setShareMsg('Konnte nicht automatisch kopieren – bitte manuell markieren.'); }
  }
}

async function revokePublicLink(linkId) {
  if (!confirm('Diesen Beobachter-Link zurückziehen? Er funktioniert danach nicht mehr.')) return;
  try {
    const res = await fetch(`/api/plans/${currentPlanId}/public-link/${linkId}`, {
      method: 'DELETE', credentials: 'include'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { _setShareMsg(data.error || 'Zurückziehen fehlgeschlagen.'); return; }
    if (typeof showToast === 'function') showToast('Link zurückgezogen');
    const reveal = document.getElementById('public-link-reveal');
    if (reveal) reveal.style.display = 'none';
    await loadPublicLinks();
  } catch (e) {
    _setShareMsg('Netzwerkfehler.');
  }
}

function _shareRow(label, roleLabel, removeUserId, canRemove) {
  const removeBtn = (removeUserId !== null && canRemove)
    ? `<button class="ghost-btn" data-remove-user="${removeUserId}" data-username="${label.replace(/^🧑 /, '')}"
         style="border-color:var(--coral);color:var(--coral);font-size:.72rem;padding:4px 8px" title="Entfernen">✕</button>`
    : '';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--deep);border:1px solid var(--line);border-radius:6px;padding:8px 10px">
    <div style="font-size:.86rem;color:var(--text)">${label}</div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:.68rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em">${roleLabel}</span>
      ${removeBtn}
    </div>
  </div>`;
}

async function addCollaborator() {
  const input = document.getElementById('share-username');
  const username = (input ? input.value : '').trim();
  if (!username) { _setShareMsg('Bitte einen Benutzernamen eingeben.'); return; }
  const roleSel = document.getElementById('share-role');
  const role = roleSel ? roleSel.value : 'edit';

  const btn = document.getElementById('share-add-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/plans/${currentPlanId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, role })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { _setShareMsg(data.error || 'Teilen fehlgeschlagen.'); return; }
    _setShareMsg(`✓ Mit „${username}" geteilt.`, true);
    if (typeof showToast === 'function') showToast(`✓ Geteilt mit „${username}"`);
    if (input) input.value = '';
    await loadShares();
  } catch (e) {
    _setShareMsg('Netzwerkfehler.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function removeCollaborator(userId, username) {
  if (!confirm(`Zugriff von „${username}" auf diesen Plan entfernen?`)) return;
  try {
    const res = await fetch(`/api/plans/${currentPlanId}/share/${userId}`, {
      method: 'DELETE', credentials: 'include'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { _setShareMsg(data.error || 'Entfernen fehlgeschlagen.'); return; }
    if (typeof showToast === 'function') showToast(`Zugriff von „${username}" entfernt`);
    await loadShares();
  } catch (e) {
    _setShareMsg('Netzwerkfehler.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('btn-share-plan');
  if (openBtn) openBtn.onclick = openShareModal;
  const closeBtn = document.getElementById('share-modal-close-btn');
  if (closeBtn) closeBtn.onclick = closeShareModal;
  const addBtn = document.getElementById('share-add-btn');
  if (addBtn) addBtn.onclick = addCollaborator;
  const pubCreateBtn = document.getElementById('public-link-create-btn');
  if (pubCreateBtn) pubCreateBtn.onclick = createPublicLink;
  const pubCopyBtn = document.getElementById('public-link-copy-btn');
  if (pubCopyBtn) pubCopyBtn.onclick = copyPublicLink;
  const modal = document.getElementById('share-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeShareModal(); });
  const input = document.getElementById('share-username');
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') addCollaborator(); });
});
