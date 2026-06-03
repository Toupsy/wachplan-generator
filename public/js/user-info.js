// ============================================================
// user-info.js – User-Authentifizierung & Admin-Panel
// Verwaltet User-Info Header und Admin-Panel Links
// ============================================================

let currentUser = null;

/**
 * Aktualisiere User-Info Header nach Login
 */
async function updateUserInfo() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (!response.ok) {
      hideUserInfo();
      return;
    }

    const data = await response.json();
    currentUser = data;

    // Zeige User-Info Header
    const header = document.getElementById('user-info-header');
    if (header) {
      header.style.display = '';
      document.getElementById('user-info-username').textContent = data.username;

      // Zeige Admin-Panel Button nur für Admins
      const adminBtn = document.getElementById('btn-admin-panel');
      if (adminBtn) {
        adminBtn.style.display = data.isAdmin ? '' : 'none';
      }

      // Zeige Import-Plans Button
      const importPlansBtn = document.getElementById('btn-import-plans');
      if (importPlansBtn) {
        importPlansBtn.style.display = '';
      }
    }
  } catch (error) {
    console.error('Update user info error:', error);
  }
}

/**
 * Verstecke User-Info Header (nicht angemeldet)
 */
function hideUserInfo() {
  const header = document.getElementById('user-info-header');
  if (header) {
    header.style.display = 'none';
  }
}

/**
 * Logout Handler
 */
async function logout() {
  if (!confirm('Wirklich abmelden?')) {
    return;
  }

  try {
    // Clear localStorage before logout to prevent data leakage to next user
    try {
      localStorage.removeItem('dlrg_wachplan_autosave');
      console.log('✓ Local storage cleared on logout');
    } catch(e) {}

    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (response.ok) {
      window.location.href = '/';
    } else {
      alert('Logout fehlgeschlagen');
    }
  } catch (error) {
    console.error('Logout error:', error);
    alert('Logout fehlgeschlagen');
  }
}

/**
 * Admin-Panel öffnen (separater Server auf Port 3001)
 */
function openAdminPanel() {
  // Bestimme Admin-Panel URL basierend auf aktuellem Host
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const adminUrl = `${protocol}//${hostname}:3001`;
  window.open(adminUrl, '_blank');
}

/**
 * Import alte Pläne von JSON-Datei
 */
async function importPlans(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const plansToImport = [];

  try {
    // Lese alle Dateien
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await file.text();
      const content = JSON.parse(text);

      // Wenn es ein einzelner Plan ist
      if (content.version && content.people) {
        plansToImport.push({
          name: file.name.replace('.json', ''),
          state: content
        });
      }
      // Wenn es ein Array von Plänen ist
      else if (Array.isArray(content)) {
        content.forEach((plan, idx) => {
          if (plan.version && plan.people) {
            plansToImport.push({
              name: plan.name || `Importierter Plan ${idx + 1}`,
              state: plan
            });
          }
        });
      }
    }

    if (plansToImport.length === 0) {
      showToast('Keine gültigen Pläne in den Dateien gefunden', true);
      return;
    }

    // Sende zum Server
    const response = await fetch('/api/import/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ plans: plansToImport })
    });

    if (!response.ok) {
      let error;
      try {
        error = await response.json();
      } catch (parseError) {
        throw new Error('Import fehlgeschlagen (Server error)');
      }
      throw new Error(error.error || 'Import fehlgeschlagen');
    }

    let result;
    try {
      result = await response.json();
    } catch (parseError) {
      throw new Error('Ungültige Server-Response');
    }
    showToast(`✓ ${result.imported} Plan(e) erfolgreich importiert`);

    // Zeige Fehler falls vorhanden
    if (result.errors && result.errors.length > 0) {
      console.warn('Import errors:', result.errors);
      showToast(`⚠️ ${result.errors.length} Fehler beim Import`, true);
    }

    // Reset file input
    event.target.value = '';
  } catch (error) {
    console.error('Import plans error:', error);
    showToast(error.message, true);
    event.target.value = '';
  }
}

/**
 * Passwort-ändern-Modal öffnen/schließen
 */
function openPwModal() {
  ['pw-current', 'pw-new', 'pw-new2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  _setPwMsg('');
  const m = document.getElementById('pw-modal');
  if (m) m.style.display = 'flex';
  const cur = document.getElementById('pw-current');
  if (cur) cur.focus();
}
function closePwModal() {
  const m = document.getElementById('pw-modal');
  if (m) m.style.display = 'none';
}
function _setPwMsg(text, ok) {
  const el = document.getElementById('pw-modal-msg');
  if (el) { el.textContent = text || ''; el.style.color = ok ? 'var(--green)' : 'var(--coral)'; }
}

/**
 * Eigenes Passwort ändern → PUT /api/auth/password
 */
async function submitPasswordChange() {
  const current = document.getElementById('pw-current').value;
  const next = document.getElementById('pw-new').value;
  const next2 = document.getElementById('pw-new2').value;

  if (!current || !next) { _setPwMsg('Bitte alle Felder ausfüllen.'); return; }
  if (next.length < 8) { _setPwMsg('Neues Passwort: mindestens 8 Zeichen.'); return; }
  if (next !== next2) { _setPwMsg('Die neuen Passwörter stimmen nicht überein.'); return; }

  const btn = document.getElementById('pw-modal-confirm');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPassword: current, newPassword: next })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { _setPwMsg(data.error || 'Änderung fehlgeschlagen.'); return; }
    _setPwMsg('✓ Passwort geändert.', true);
    if (typeof showToast === 'function') showToast('✓ Passwort geändert');
    setTimeout(closePwModal, 900);
  } catch (e) {
    _setPwMsg('Netzwerkfehler.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Initialisiere User-Info Funktionalität
 */
document.addEventListener('DOMContentLoaded', () => {
  // Update user info
  updateUserInfo();

  // Logout Button
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.onclick = logout;
  }

  // Passwort-ändern Button + Modal
  const changePwBtn = document.getElementById('btn-change-password');
  if (changePwBtn) changePwBtn.onclick = openPwModal;
  const pwCloseBtn = document.getElementById('pw-modal-close-btn');
  if (pwCloseBtn) pwCloseBtn.onclick = closePwModal;
  const pwConfirmBtn = document.getElementById('pw-modal-confirm');
  if (pwConfirmBtn) pwConfirmBtn.onclick = submitPasswordChange;
  const pwModal = document.getElementById('pw-modal');
  if (pwModal) pwModal.addEventListener('click', e => { if (e.target === pwModal) closePwModal(); });
  const pwNew2 = document.getElementById('pw-new2');
  if (pwNew2) pwNew2.addEventListener('keydown', e => { if (e.key === 'Enter') submitPasswordChange(); });

  // Admin Panel Button
  const adminBtn = document.getElementById('btn-admin-panel');
  if (adminBtn) {
    adminBtn.onclick = openAdminPanel;
  }

  // Import Plans Button
  const importPlansBtn = document.getElementById('btn-import-plans');
  const importPlansInput = document.getElementById('import-plans-file-input');
  if (importPlansBtn && importPlansInput) {
    importPlansBtn.onclick = () => importPlansInput.click();
    importPlansInput.onchange = importPlans;
  }
});
