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
      const error = await response.json();
      throw new Error(error.error || 'Import fehlgeschlagen');
    }

    const result = await response.json();
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
