// ============================================================
// Login Modal - Authentication UI
// ============================================================

async function initLoginModal() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (response.ok) {
      hideLoginModal();
      return;
    }
  } catch (error) {
    console.error('Session check failed:', error);
  }

  // Check if first-time setup is needed
  try {
    const setupResponse = await fetch('/api/auth/needs-setup', { credentials: 'include' });
    const setupData = await setupResponse.json();
    if (setupData.needsSetup) {
      showSetupModal();
      return;
    }
  } catch (error) {
    console.error('Setup check failed:', error);
  }

  showLoginModal();
}

function showLoginModal() {
  document.getElementById('login-modal').style.display = 'flex';
  document.getElementById('login-view').style.display = 'block';
  document.getElementById('setup-view').style.display = 'none';
  document.getElementById('login-form').addEventListener('submit', handleLogin);
}

function showSetupModal() {
  document.getElementById('login-modal').style.display = 'flex';
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('setup-view').style.display = 'block';
  document.getElementById('setup-form').addEventListener('submit', handleSetup);
}

async function hideLoginModal() {
  document.getElementById('login-modal').style.display = 'none';
  if (typeof initAfterAuth === 'function') {
    await initAfterAuth();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const data = await response.json();
      errorEl.textContent = data.error || 'Login fehlgeschlagen';
      return;
    }

    const data = await response.json();
    if (typeof updateUserInfo === 'function') await updateUserInfo();
    hideLoginModal();
  } catch (error) {
    errorEl.textContent = 'Netzwerkfehler';
  }
}

async function handleSetup(e) {
  e.preventDefault();
  const username = document.getElementById('setup-username').value;
  const password = document.getElementById('setup-password').value;
  const password2 = document.getElementById('setup-password2').value;
  const errorEl = document.getElementById('setup-error');

  if (password !== password2) {
    errorEl.textContent = 'Passwörter stimmen nicht überein';
    return;
  }
  if (password.length < 8) {
    errorEl.textContent = 'Passwort muss mindestens 8 Zeichen haben';
    return;
  }

  try {
    const response = await fetch('/api/auth/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const data = await response.json();
      errorEl.textContent = data.error || 'Setup fehlgeschlagen';
      return;
    }

    // Auto-login after setup
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    if (typeof updateUserInfo === 'function') await updateUserInfo();
    hideLoginModal();
  } catch (error) {
    errorEl.textContent = 'Netzwerkfehler';
  }
}

// REMOVED: initLoginModal() wird jetzt von init.js aufgerufen, nachdem initAfterAuth definiert ist
// Siehe init.js Zeile ~248 für den eigentlichen Aufruf
