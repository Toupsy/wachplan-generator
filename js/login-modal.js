// ============================================================
// Login Modal - Authentication UI
// Angezeigt vor der SPA, wenn Nutzer nicht authentifiziert ist
// ============================================================

async function initLoginModal() {
  // Prüfe aktuelle Session
  try {
    const response = await fetch('/api/auth/me');
    if (response.ok) {
      // Nutzer ist bereits angemeldet, Modal verstecken
      hideLoginModal();
      return;
    }
  } catch (error) {
    console.error('Session check failed:', error);
  }

  // Nutzer nicht angemeldet, Modal anzeigen
  showLoginModal();
}

function showLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal) {
    modal.style.display = 'flex';
  }

  // Event Listener für Login-Form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
}

async function hideLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal) {
    modal.style.display = 'none';
  }

  // Starte SPA (initAfterAuth ist jetzt async)
  if (typeof initAfterAuth === 'function') {
    await initAfterAuth();
  }
}

async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById('login-username')?.value;
  const password = document.getElementById('login-password')?.value;
  const errorEl = document.getElementById('login-error');

  if (!username || !password) {
    if (errorEl) errorEl.textContent = 'Username und Passwort erforderlich';
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const data = await response.json();
      if (errorEl) errorEl.textContent = data.error || 'Login fehlgeschlagen';
      return;
    }

    const data = await response.json();
    console.log('✓ Login erfolgreich:', data.username);

    // Update user info
    if (typeof updateUserInfo === 'function') {
      updateUserInfo();
    }

    // Modal schließen und SPA laden
    hideLoginModal();
  } catch (error) {
    console.error('Login error:', error);
    if (errorEl) errorEl.textContent = 'Netzwerkfehler';
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLoginModal);
} else {
  initLoginModal();
}
