// ============================================================
// Login Modal - Authentication UI
// Login, Ersteinrichtung, Selbstregistrierung (mit optionalem
// reCAPTCHA v3 + E-Mail-Verifizierung) und Passwort-Reset.
// ============================================================

// Status aus GET /api/auth/registration-status:
// { enabled, requiresCode, emailVerification, passwordReset, captchaSiteKey }
let _authStatus = { enabled: false, requiresCode: false, emailVerification: false, passwordReset: false, captchaSiteKey: null };
let _resetToken = null; // Token aus ?reset=… (Passwort-Reset-Link)

async function initLoginModal() {
  // Load config before anything else
  const configLoaded = await loadConfig();
  if (!configLoaded) {
    console.warn('⚠️ Failed to load config, will use defaults');
  }

  // Check if running in preview environment (skip login)
  const environment = window.WORKER_ENVIRONMENT || 'production';
  if (environment === 'preview') {
    console.log('ℹ️ Running in preview mode - skipping authentication');
    hideLoginModal();
    if (typeof initAfterAuth === 'function') {
      await initAfterAuth();
    }
    return;
  }

  // URL-Parameter aus E-Mail-Links auswerten (vor Session-Check, damit ein
  // Reset-Link auch bei bestehender Session funktioniert)
  const urlParams = new URLSearchParams(window.location.search);
  const resetParam = urlParams.get('reset');
  const verifiedParam = urlParams.get('verified');
  if (resetParam || verifiedParam !== null) {
    // Parameter aus der URL entfernen (Token nicht in History/Bookmarks lassen)
    urlParams.delete('reset'); urlParams.delete('verified');
    const rest = urlParams.toString();
    history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : ''));
  }

  try {
    const regResponse = await fetch('/api/auth/registration-status', { credentials: 'include' });
    _authStatus = await regResponse.json();
  } catch (error) {
    console.error('Registration status check failed:', error);
  }
  if (_authStatus.captchaSiteKey) loadCaptchaScript(_authStatus.captchaSiteKey);

  if (resetParam) {
    showResetView(resetParam);
    return;
  }

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

  showLoginModal(_authStatus);

  // Feedback nach Klick auf den Bestätigungslink aus der Mail
  if (verifiedParam === '1') {
    setLoginInfo('✓ E-Mail bestätigt – Sie können sich jetzt anmelden.');
  } else if (verifiedParam === '0') {
    setLoginError('Bestätigungslink ungültig oder abgelaufen. Beim Login kann eine neue Mail angefordert werden.');
  }
}

// ───────────────────────────────────────────────────────────
// reCAPTCHA v3 (nur wenn der Server einen Site-Key liefert)
// ───────────────────────────────────────────────────────────
function loadCaptchaScript(siteKey) {
  if (document.getElementById('recaptcha-script')) return;
  const s = document.createElement('script');
  s.id = 'recaptcha-script';
  s.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(siteKey);
  document.head.appendChild(s);
  // Hinweistexte (Google-Attribution) einblenden
  document.querySelectorAll('.captcha-hint').forEach(el => { el.style.display = 'block'; });
}

// Liefert ein reCAPTCHA-Token für die angegebene Action, oder null wenn
// CAPTCHA deaktiviert ist. Wirft, wenn das Script (noch) nicht geladen ist.
async function getCaptchaToken(action) {
  if (!_authStatus.captchaSiteKey) return null;
  if (typeof grecaptcha === 'undefined') {
    throw new Error('Bot-Schutz lädt noch – bitte kurz warten und erneut versuchen');
  }
  await new Promise(resolve => grecaptcha.ready(resolve));
  return grecaptcha.execute(_authStatus.captchaSiteKey, { action });
}

// ───────────────────────────────────────────────────────────
// View-Umschaltung (alle Views liegen in #login-modal)
// ───────────────────────────────────────────────────────────
const AUTH_VIEWS = ['login-view', 'setup-view', 'register-view', 'forgot-view', 'reset-view', 'auth-info-view'];

function showAuthView(viewId) {
  const loginModal = document.getElementById('login-modal');
  if (loginModal) loginModal.style.display = 'flex';
  AUTH_VIEWS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === viewId) ? 'block' : 'none';
  });
}

function setLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.style.color = 'var(--coral)'; el.textContent = msg; }
}

function setLoginInfo(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.style.color = 'var(--sea-bright)'; el.textContent = msg; }
}

function showLoginModal(regStatus = _authStatus) {
  _authStatus = regStatus || _authStatus;
  showAuthView('login-view');
  setLoginError('');

  const loginForm = document.getElementById('login-form');
  const registerLinkText = document.getElementById('register-link-text');
  const forgotLinkText = document.getElementById('forgot-link-text');
  // addEventListener mit derselben benannten Funktion ist idempotent
  if (loginForm) loginForm.addEventListener('submit', handleLogin);

  // Show registration link if enabled
  if (_authStatus.enabled && registerLinkText) {
    registerLinkText.innerHTML = 'Noch kein Account? <button type="button" id="show-register-btn" style="background:none;border:none;color:var(--sea-bright);cursor:pointer;text-decoration:underline;font-size:inherit">Jetzt registrieren</button>';
    const showRegisterBtn = document.getElementById('show-register-btn');
    if (showRegisterBtn) {
      showRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showRegisterView(_authStatus);
      });
    }
  }

  // „Passwort vergessen?" nur wenn der Server Mails versenden kann
  if (_authStatus.passwordReset && forgotLinkText) {
    forgotLinkText.innerHTML = '<button type="button" id="show-forgot-btn" style="background:none;border:none;color:var(--sea-bright);cursor:pointer;text-decoration:underline;font-size:inherit">Passwort vergessen?</button>';
    const showForgotBtn = document.getElementById('show-forgot-btn');
    if (showForgotBtn) {
      showForgotBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showForgotView();
      });
    }
  }
}

function showSetupModal() {
  showAuthView('setup-view');
  const setupForm = document.getElementById('setup-form');
  if (setupForm) setupForm.addEventListener('submit', handleSetup);
}

async function hideLoginModal() {
  const loginModal = document.getElementById('login-modal');
  if(loginModal) loginModal.style.display = 'none';
  // Clear localStorage when user logs in to prevent loading another user's data
  try {
    localStorage.removeItem('dlrg_wachplan_autosave');
    console.log('✓ Local storage cleared on login');
  } catch(e) {}
  // Reset all global state to prevent data from previous user
  if (typeof resetGlobalState === 'function') {
    resetGlobalState();
  }
  if (typeof initAfterAuth === 'function') {
    await initAfterAuth();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');
  const rememberEl = document.getElementById('login-remember');
  const errorEl = document.getElementById('login-error');

  if(!usernameEl || !passwordEl || !errorEl) {
    console.error('Login form elements not found');
    return;
  }

  const username = usernameEl.value;
  const password = passwordEl.value;
  const rememberMe = rememberEl?.checked ?? false;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, rememberMe })
    });

    if (!response.ok) {
      const data = await response.json();
      if (data.code === 'email_unverified') {
        // Account existiert, E-Mail aber unbestätigt → Resend anbieten
        errorEl.style.color = 'var(--coral)';
        errorEl.innerHTML = 'E-Mail-Adresse noch nicht bestätigt. <button type="button" id="resend-verify-btn" style="background:none;border:none;color:var(--sea-bright);cursor:pointer;text-decoration:underline;font-size:inherit">Mail erneut senden</button>';
        const resendBtn = document.getElementById('resend-verify-btn');
        if (resendBtn) resendBtn.addEventListener('click', () => resendVerification(username));
        return;
      }
      setLoginError(data.error || 'Login fehlgeschlagen');
      return;
    }

    const data = await response.json();
    if (typeof updateUserInfo === 'function') await updateUserInfo();
    hideLoginModal();
  } catch (error) {
    setLoginError('Netzwerkfehler: ' + error.message);
  }
}

async function resendVerification(username) {
  try {
    await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username })
    });
    setLoginInfo('Falls ein unbestätigter Account existiert, wurde eine neue Bestätigungs-E-Mail gesendet.');
  } catch (error) {
    setLoginError('Netzwerkfehler: ' + error.message);
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
  if (password.length < 10) {
    errorEl.textContent = 'Passwort muss mindestens 10 Zeichen haben';
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

function showRegisterView(regStatus = _authStatus) {
  showAuthView('register-view');
  const registerForm = document.getElementById('register-form');
  const registerCodeField = document.getElementById('register-code-field');
  const emailEl = document.getElementById('register-email');

  // Show code field only if code is required
  if(registerCodeField) {
    registerCodeField.style.display = regStatus.requiresCode ? 'block' : 'none';
  }

  // E-Mail ist Pflicht, sobald der Server Verifizierungsmails versendet
  if (emailEl) {
    emailEl.required = !!regStatus.emailVerification;
    emailEl.placeholder = regStatus.emailVerification ? 'E-Mail' : 'E-Mail (optional)';
  }

  if(registerForm) registerForm.addEventListener('submit', handleRegister);

  const backBtn = document.getElementById('back-to-login-btn');
  if(backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showLoginModal(regStatus);
    });
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const usernameEl = document.getElementById('register-username');
  const passwordEl = document.getElementById('register-password');
  const password2El = document.getElementById('register-password2');
  const emailEl = document.getElementById('register-email');
  const codeEl = document.getElementById('register-code');
  const privacyEl = document.getElementById('register-privacy');
  const errorEl = document.getElementById('register-error');

  if(!usernameEl || !passwordEl || !password2El || !errorEl) {
    console.error('Register form elements not found');
    return;
  }

  const username = usernameEl.value;
  const password = passwordEl.value;
  const password2 = password2El.value;
  const email = emailEl?.value || '';
  const code = codeEl?.value || '';
  const acceptedPrivacy = privacyEl?.checked ?? false;

  // Validate passwords match
  if (password !== password2) {
    errorEl.textContent = 'Passwörter stimmen nicht überein';
    return;
  }

  // Validate password length
  if (password.length < 10) {
    errorEl.textContent = 'Passwort muss mindestens 10 Zeichen haben';
    return;
  }

  // E-Mail Pflicht bei aktiver Verifizierung
  if (_authStatus.emailVerification && !email) {
    errorEl.textContent = 'E-Mail-Adresse erforderlich';
    return;
  }

  // Validate privacy acceptance
  if (!acceptedPrivacy) {
    errorEl.textContent = 'Datenschutzhinweis muss akzeptiert werden';
    return;
  }

  try {
    const payload = { username, password, password2, email, acceptedPrivacy };
    if (code) payload.code = code;
    const captchaToken = await getCaptchaToken('register');
    if (captchaToken) payload.captchaToken = captchaToken;

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      errorEl.textContent = data.error || 'Registrierung fehlgeschlagen';
      return;
    }

    if (data.verificationRequired) {
      // Kein Auto-Login: erst E-Mail bestätigen
      showAuthInfo('📧 Bestätigungs-E-Mail gesendet', 'Bitte prüfen Sie Ihr Postfach und klicken Sie auf den Bestätigungslink (24 h gültig). Danach können Sie sich anmelden.');
      return;
    }

    if (typeof updateUserInfo === 'function') await updateUserInfo();
    hideLoginModal();
  } catch (error) {
    if(errorEl) errorEl.textContent = error.message.startsWith('Bot-Schutz') ? error.message : ('Netzwerkfehler: ' + error.message);
  }
}

// ───────────────────────────────────────────────────────────
// Passwort vergessen / Reset
// ───────────────────────────────────────────────────────────
function showForgotView() {
  showAuthView('forgot-view');
  const form = document.getElementById('forgot-form');
  if (form) form.addEventListener('submit', handleForgot);
  const backBtn = document.getElementById('forgot-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => showLoginModal());
}

async function handleForgot(e) {
  e.preventDefault();
  const emailEl = document.getElementById('forgot-email');
  const errorEl = document.getElementById('forgot-error');
  if (!emailEl || !errorEl) return;

  try {
    const payload = { email: emailEl.value };
    const captchaToken = await getCaptchaToken('password_reset');
    if (captchaToken) payload.captchaToken = captchaToken;

    const response = await fetch('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      errorEl.textContent = data.error || 'Anfrage fehlgeschlagen';
      return;
    }
    showAuthInfo('📧 Reset-Link angefordert', 'Falls ein Account mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet (60 Minuten gültig).');
  } catch (error) {
    errorEl.textContent = error.message.startsWith('Bot-Schutz') ? error.message : ('Netzwerkfehler: ' + error.message);
  }
}

function showResetView(token) {
  _resetToken = token;
  showAuthView('reset-view');
  const form = document.getElementById('reset-form');
  if (form) form.addEventListener('submit', handleReset);
  const backBtn = document.getElementById('reset-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => showLoginModal());
}

async function handleReset(e) {
  e.preventDefault();
  const passwordEl = document.getElementById('reset-password');
  const password2El = document.getElementById('reset-password2');
  const errorEl = document.getElementById('reset-error');
  if (!passwordEl || !password2El || !errorEl) return;

  const password = passwordEl.value;
  const password2 = password2El.value;

  if (password !== password2) {
    errorEl.textContent = 'Passwörter stimmen nicht überein';
    return;
  }
  if (password.length < 10) {
    errorEl.textContent = 'Passwort muss mindestens 10 Zeichen haben';
    return;
  }

  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token: _resetToken, password, password2 })
    });
    const data = await response.json();
    if (!response.ok) {
      errorEl.textContent = data.error || 'Passwort-Reset fehlgeschlagen';
      return;
    }
    _resetToken = null;
    showLoginModal();
    setLoginInfo('✓ Passwort geändert – bitte mit dem neuen Passwort anmelden.');
  } catch (error) {
    errorEl.textContent = 'Netzwerkfehler: ' + error.message;
  }
}

// ───────────────────────────────────────────────────────────
// Info-View (Erfolgsmeldungen mit „Zurück zum Login")
// ───────────────────────────────────────────────────────────
function showAuthInfo(title, text) {
  showAuthView('auth-info-view');
  const titleEl = document.getElementById('auth-info-title');
  const textEl = document.getElementById('auth-info-text');
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;
  const backBtn = document.getElementById('auth-info-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => showLoginModal());
}

// REMOVED: initLoginModal() wird jetzt von init.js aufgerufen, nachdem initAfterAuth definiert ist
// Siehe init.js Zeile ~248 für den eigentlichen Aufruf
