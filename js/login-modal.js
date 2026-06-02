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
  const loginModal = document.getElementById('login-modal');
  const loginView = document.getElementById('login-view');
  const setupView = document.getElementById('setup-view');
  const loginForm = document.getElementById('login-form');

  if(loginModal) loginModal.style.display = 'flex';
  if(loginView) loginView.style.display = 'block';
  if(setupView) setupView.style.display = 'none';
  if(loginForm) loginForm.addEventListener('submit', handleLogin);
}

function showSetupModal() {
  const loginModal = document.getElementById('login-modal');
  const loginView = document.getElementById('login-view');
  const setupView = document.getElementById('setup-view');
  const setupForm = document.getElementById('setup-form');

  if(loginModal) loginModal.style.display = 'flex';
  if(loginView) loginView.style.display = 'none';
  if(setupView) setupView.style.display = 'block';
  if(setupForm) setupForm.addEventListener('submit', handleSetup);
}

async function hideLoginModal() {
  const loginModal = document.getElementById('login-modal');
  if(loginModal) loginModal.style.display = 'none';
  // Clear localStorage when user logs in to prevent loading another user's data
  try {
    localStorage.removeItem('dlrg_wachplan_autosave');
    console.log('✓ Local storage cleared on login');
  } catch(e) {}
  if (typeof initAfterAuth === 'function') {
    await initAfterAuth();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');

  if(!usernameEl || !passwordEl || !errorEl) {
    console.error('Login form elements not found');
    return;
  }

  const username = usernameEl.value;
  const password = passwordEl.value;

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
    if(errorEl) errorEl.textContent = 'Netzwerkfehler: ' + error.message;
  }
}

async function handleSetup(e) {
  e.preventDefault();
  const usernameEl = document.getElementById('setup-username');
  const passwordEl = document.getElementById('setup-password');
  const password2El = document.getElementById('setup-password2');
  const errorEl = document.getElementById('setup-error');

  if(!usernameEl || !passwordEl || !password2El || !errorEl) {
    console.error('Setup form elements not found');
    return;
  }

  const username = usernameEl.value;
  const password = passwordEl.value;
  const password2 = password2El.value;

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
    if(errorEl) errorEl.textContent = 'Netzwerkfehler: ' + error.message;
  }
}

// REMOVED: initLoginModal() wird jetzt von init.js aufgerufen, nachdem initAfterAuth definiert ist
// Siehe init.js Zeile ~248 für den eigentlichen Aufruf
