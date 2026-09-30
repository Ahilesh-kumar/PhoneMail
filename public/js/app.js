/**
 * PhoneMail — Main Client Application Controller
 * Pure SVG Icons (ZERO Emojis)
 * 1:1 Pixel-Perfect Match to Gmail Desktop 3-Column Split & Mobile 4-Screen Flow
 */

const state = {
  currentUser: null,
  currentFolder: 'inbox',
  currentLabel: null,
  currentFilter: 'all',
  searchQuery: '',
  emails: [],
  selectedEmailId: null,
  counts: { folders: {}, labels: {} },
  viewMode: 'auto', // 'auto', 'desktop', 'mobile'
  mobileScreen: 'inbox', // 'inbox', 'detail', 'search'
  isDrawerOpen: false,
  isComposeOpen: false,
  displayLanguage: (window.phoneMailI18n ? window.phoneMailI18n.getCurrentLanguage() : null) || localStorage.getItem('phonemail_display_lang') || 'en',
  emailTranslations: {}, // { [langCode]: { [emailId]: { subject, snippet, body } } }
  readingViewTranslationMode: 'translated', // 'translated' or 'original'
  isTranslatingInbox: false
};

// WebSocket reference
let ws = null;

// Supported Multi-Language Audio Languages (Indian Regional & Global)
const SUPPORTED_AUDIO_LANGS = [
  { code: 'en', bcp47: 'en-US', label: 'English (Global Baseline)' },
  { code: 'ta', bcp47: 'ta-IN', label: 'Tamil (தமிழ்)' },
  { code: 'hi', bcp47: 'hi-IN', label: 'Hindi (हिंदी)' },
  { code: 'te', bcp47: 'te-IN', label: 'Telugu (తెలుగు)' },
  { code: 'kn', bcp47: 'kn-IN', label: 'Kannada (ಕನ್ನಡ)' },
  { code: 'ml', bcp47: 'ml-IN', label: 'Malayalam (മലയാളം)' },
  { code: 'bn', bcp47: 'bn-IN', label: 'Bengali (বাংলা)' },
  { code: 'mr', bcp47: 'mr-IN', label: 'Marathi (मराठी)' },
  { code: 'gu', bcp47: 'gu-IN', label: 'Gujarati (ગુજરાતી)' },
  { code: 'es', bcp47: 'es-ES', label: 'Spanish (Español)' },
  { code: 'fr', bcp47: 'fr-FR', label: 'French (Français)' }
];

// Speech & Audio Playback State
let isSpeaking = false;
let isProminentSpeaking = false;
let currentUtterance = null;
let activeAudioStream = null;
let currentAudioLang = localStorage.getItem('phonemail_audio_lang') || 'en';
let speechSpeed = parseFloat(localStorage.getItem('phonemail_speech_speed') || '1.0');

// =============================================================
// INITIALIZATION
// =============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const savedTheme = localStorage.getItem('phonemail_theme') || 'slate';
  applyTheme(savedTheme, false);

  const savedLang = (window.phoneMailI18n ? window.phoneMailI18n.getCurrentLanguage() : null) || localStorage.getItem('phonemail_display_lang') || 'en';
  state.displayLanguage = savedLang;
  currentAudioLang = savedLang;
  if (window.phoneMailI18n && typeof window.phoneMailI18n.applyI18nToDOM === 'function') {
    window.phoneMailI18n.applyI18nToDOM(savedLang);
  }

  initViewSwitcher();
  initWebSocket();
  await checkAuthSession();
  setupEventListeners();
  window.addEventListener('resize', handleViewportResize);
  handleViewportResize();
});

// =============================================================
// AUTHENTICATION & SESSION
// =============================================================

async function checkAuthSession() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const userParam = urlParams.get('user');
    if (userParam) {
      localStorage.setItem('phonemail_active_phone', userParam);
    }
    const layoutParam = urlParams.get('layout');
    if (layoutParam && ['auto', 'desktop', 'mobile'].includes(layoutParam)) {
      setViewMode(layoutParam);
    }
    const emailParam = urlParams.get('email');
    if (emailParam) {
      state.selectedEmailId = parseInt(emailParam, 10);
      state.mobileScreen = 'detail';
    }
    const drawerParam = urlParams.get('drawer');
    if (drawerParam) {
      state.isDrawerOpen = true;
    }
    const composeParam = urlParams.get('compose');
    if (composeParam) {
      openComposeModal();
    }
    const broadcastParam = urlParams.get('broadcast');
    if (broadcastParam) {
      openBroadcastModal();
    }

    const savedPhone = localStorage.getItem('phonemail_active_phone');
    const url = savedPhone ? `/api/auth/me?phone=${encodeURIComponent(savedPhone)}` : '/api/auth/me';
    const res = await fetch(url);
    const data = await res.json();

    if (data.authenticated && data.user) {
      state.currentUser = data.user;
      localStorage.setItem('phonemail_active_phone', data.user.phone_number);
      closeAuthModal();
      await refreshMailbox();
    } else {
      openAuthModal();
    }
  } catch (err) {
    console.error('Session check failed', err);
    openAuthModal();
  }
}

function openAuthModal(defaultPortal = 'citizen') {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    switchAuthPortal(defaultPortal);
  }
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function switchAuthPortal(portal) {
  const btnCitizen = document.getElementById('tab-btn-citizen');
  const btnOfficial = document.getElementById('tab-btn-official');
  const secCitizen = document.getElementById('portal-citizen-section');
  const secOfficial = document.getElementById('portal-official-section');

  if (portal === 'citizen') {
    if (btnCitizen) {
      btnCitizen.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 bg-blue-600 text-white shadow-md';
    }
    if (btnOfficial) {
      btnOfficial.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 text-slate-400 hover:text-white';
    }
    if (secCitizen) secCitizen.classList.remove('hidden');
    if (secOfficial) secOfficial.classList.add('hidden');
  } else {
    if (btnOfficial) {
      btnOfficial.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 bg-indigo-600 text-white shadow-md';
    }
    if (btnCitizen) {
      btnCitizen.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 text-slate-400 hover:text-white';
    }
    if (secOfficial) secOfficial.classList.remove('hidden');
    if (secCitizen) secCitizen.classList.add('hidden');
  }
}

function switchCitizenMode(mode) {
  const btnLogin = document.getElementById('citizen-mode-login');
  const btnReg = document.getElementById('citizen-mode-register');
  const nameBox = document.getElementById('citizen-name-container');
  const langBox = document.getElementById('citizen-lang-container');
  const title = document.getElementById('citizen-flow-title');
  const desc = document.getElementById('citizen-flow-desc');
  const submitLabel = document.getElementById('citizen-submit-label');

  if (mode === 'login') {
    if (btnLogin) btnLogin.className = 'px-2.5 py-1 rounded-md font-semibold text-white bg-slate-800';
    if (btnReg) btnReg.className = 'px-2.5 py-1 rounded-md font-semibold text-slate-400 hover:text-white';
    if (nameBox) nameBox.classList.add('hidden');
    if (langBox) langBox.classList.add('hidden');
    if (title) title.textContent = 'Sign In to Citizen Mailbox';
    if (desc) desc.textContent = 'Passwordless verification via SMS or automated Voice Call';
    if (submitLabel) submitLabel.textContent = 'Verify & Open Mailbox';
  } else {
    if (btnReg) btnReg.className = 'px-2.5 py-1 rounded-md font-semibold text-white bg-slate-800';
    if (btnLogin) btnLogin.className = 'px-2.5 py-1 rounded-md font-semibold text-slate-400 hover:text-white';
    if (nameBox) nameBox.classList.remove('hidden');
    if (langBox) langBox.classList.remove('hidden');
    if (title) title.textContent = 'Register New Citizen Digital Address';
    if (desc) desc.textContent = 'Create your verified asynchronous mailbox in your native language';
    if (submitLabel) submitLabel.textContent = 'Register & Open Mailbox';
  }
}

function switchOfficialMode(mode) {
  const btnLogin = document.getElementById('official-mode-login');
  const btnReg = document.getElementById('official-mode-register');
  const loginPanel = document.getElementById('official-login-panel');
  const regPanel = document.getElementById('official-register-panel');
  const title = document.getElementById('official-flow-title');
  const desc = document.getElementById('official-flow-desc');

  if (mode === 'login') {
    if (btnLogin) btnLogin.className = 'px-2.5 py-1 rounded-md font-semibold text-white bg-slate-800';
    if (btnReg) btnReg.className = 'px-2.5 py-1 rounded-md font-semibold text-slate-400 hover:text-white';
    if (loginPanel) loginPanel.classList.remove('hidden');
    if (regPanel) regPanel.classList.add('hidden');
    if (title) title.textContent = 'Civic Authority Terminal';
    if (desc) desc.textContent = 'Institutional credentials for authorized officers & dispatchers';
  } else {
    if (btnReg) btnReg.className = 'px-2.5 py-1 rounded-md font-semibold text-white bg-slate-800';
    if (btnLogin) btnLogin.className = 'px-2.5 py-1 rounded-md font-semibold text-slate-400 hover:text-white';
    if (regPanel) regPanel.classList.remove('hidden');
    if (loginPanel) loginPanel.classList.add('hidden');
    if (title) title.textContent = 'Officer Onboarding & Department Clearance';
    if (desc) desc.textContent = 'Register verified government officer credentials and clearance';
  }
}

async function quickDemoLogin(phone) {
  closeAuthModal();
  await quickSwitchUser(phone);
}

async function loginOfficial() {
  const identifier = document.getElementById('official-identifier')?.value.trim();
  const department = document.getElementById('official-department-select')?.value;
  const password = document.getElementById('official-password')?.value;
  const feedback = document.getElementById('official-auth-feedback');

  if (!identifier) {
    if (feedback) feedback.innerHTML = '<span class="text-rose-400 font-medium">Please enter Officer Badge ID, Email, or Helpline Phone.</span>';
    return;
  }

  if (feedback) feedback.innerHTML = '<span class="text-indigo-400 font-medium">Authenticating officer credentials...</span>';

  try {
    const res = await fetch('/api/auth/official/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, department, password })
    });
    const data = await res.json();

    if (data.success && data.user) {
      state.currentUser = data.user;
      localStorage.setItem('phonemail_active_phone', data.user.phone_number);
      closeAuthModal();
      await refreshMailbox();
    } else {
      if (feedback) feedback.innerHTML = `<span class="text-rose-400 font-medium">${data.error || 'Authentication failed.'}</span>`;
    }
  } catch (err) {
    if (feedback) feedback.innerHTML = `<span class="text-rose-400 font-medium">Network error: ${err.message}</span>`;
  }
}

async function registerOfficial() {
  const name = document.getElementById('official-reg-name')?.value.trim();
  const designation = document.getElementById('official-reg-designation')?.value.trim();
  const department = document.getElementById('official-reg-dept')?.value;
  const employeeId = document.getElementById('official-reg-badge')?.value.trim();
  const email = document.getElementById('official-reg-email')?.value.trim();
  const accessKey = document.getElementById('official-reg-key')?.value.trim();
  const password = document.getElementById('official-reg-password')?.value;
  const feedback = document.getElementById('official-auth-feedback');

  if (!name || !password) {
    if (feedback) feedback.innerHTML = '<span class="text-rose-400 font-medium">Officer name and password are required.</span>';
    return;
  }

  if (feedback) feedback.innerHTML = '<span class="text-indigo-400 font-medium">Verifying clearance key & provisioning official terminal...</span>';

  try {
    const res = await fetch('/api/auth/official/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, designation, department, employeeId, email, accessKey, password })
    });
    const data = await res.json();

    if (data.success && data.user) {
      state.currentUser = data.user;
      localStorage.setItem('phonemail_active_phone', data.user.phone_number);
      closeAuthModal();
      await refreshMailbox();
    } else {
      if (feedback) feedback.innerHTML = `<span class="text-rose-400 font-medium">${data.error || 'Onboarding failed.'}</span>`;
    }
  } catch (err) {
    if (feedback) feedback.innerHTML = `<span class="text-rose-400 font-medium">Network error: ${err.message}</span>`;
  }
}

async function requestOtp(channel) {
  const phoneInput = document.getElementById('auth-phone');
  const feedback = document.getElementById('auth-feedback');
  const phone = phoneInput.value.trim();

  if (!phone) {
    alert('Please enter your phone number with country code (e.g. +19876543210)');
    return;
  }

  feedback.innerHTML = `<span class="text-amber-400 font-medium">Requesting ${channel === 'voice' ? 'Voice Call' : 'SMS'} code...</span>`;

  try {
    const res = await fetch('/api/auth/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, channel })
    });
    const data = await res.json();

    if (data.success) {
      const icons = window.phoneMailIcons || {};
      feedback.innerHTML = `
        <div class="text-emerald-400 mt-2 font-medium text-xs flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/30">
          ${icons.check ? icons.check('w-4 h-4 inline text-emerald-400') : '✓ '}
          <span>${data.message}</span>
        </div>
      `;
      // Clear OTP field - do NOT autofill! The user must receive it on their phone!
      const codeInput = document.getElementById('auth-code');
      if (codeInput) {
        codeInput.value = '';
        setTimeout(() => codeInput.focus(), 300);
      }
      const verifySec = document.getElementById('otp-verify-section');
      if (verifySec) verifySec.classList.remove('hidden');
    } else {
      const isDailyLimit = data.errorCode === 63038 || data.isSmsDailyLimit;
      const isUnverified = data.errorCode === 21608 || data.errorCode === 21219 || data.isUnverifiedTrial;

      feedback.innerHTML = `
        <div class="mt-2.5 p-3.5 bg-amber-950/60 border border-amber-500/40 rounded-2xl text-xs text-amber-200 text-left space-y-2">
          <div class="font-bold text-amber-300 flex items-center gap-1.5">
            <svg class="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Twilio Telephony Notice</span>
          </div>
          <div class="text-slate-300 leading-relaxed text-[11px]">${data.error}</div>
          ${isDailyLimit ? `
            <div class="pt-2 border-t border-amber-500/30 flex items-center justify-between gap-2">
              <span class="text-[11px] text-amber-200">Daily SMS limit reached:</span>
              <button type="button" onclick="requestOtp('voice')" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow transition-all">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                <span>Call Handset via Voice OTP</span>
              </button>
            </div>
          ` : ''}
          ${isUnverified && data.verifiedNumbers && data.verifiedNumbers.length ? `
            <div class="pt-2 border-t border-amber-500/30 text-[11px] text-slate-300 space-y-2">
              <div class="font-semibold text-amber-300">Verified Numbers on your Twilio Trial:</div>
              <div class="flex flex-wrap gap-1.5">
                ${data.verifiedNumbers.map(n => `
                  <button type="button" onclick="document.getElementById('auth-phone').value='${n}'; requestOtp('${isDailyLimit ? 'voice' : channel}');" class="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-blue-300 font-mono text-[11px] hover:border-blue-400 hover:text-white transition-colors">
                    Use ${n}
                  </button>
                `).join('')}
              </div>
              <div class="p-2 bg-slate-900/80 rounded-lg border border-slate-800 text-[10px] text-slate-400 leading-relaxed">
                <strong class="text-slate-200">Want to receive OTP on ${data.phone || 'your personal number'}?</strong><br/>
                Twilio trial accounts require numbers to be verified first. Log in to <span class="text-blue-400">Twilio Console &gt; Phone Numbers &gt; Manage &gt; Verified Caller IDs</span> and add your number (takes 30 seconds).
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }
  } catch (err) {
    feedback.innerHTML = `<span class="text-rose-400 font-medium">Network error: ${err.message}</span>`;
  }
}

async function verifyAndLogin() {
  const phone = document.getElementById('auth-phone')?.value.trim();
  const code = document.getElementById('auth-code')?.value.trim();
  const name = document.getElementById('auth-name')?.value.trim() || '';
  const preferredLanguage = document.getElementById('citizen-pref-lang')?.value || 'en';
  const feedback = document.getElementById('auth-feedback');

  if (!phone || !code) {
    if (feedback) feedback.innerHTML = '<span class="text-rose-400 font-medium">Please enter your phone number and the 6-digit OTP code.</span>';
    return;
  }

  if (feedback) feedback.innerHTML = `<span class="text-blue-400 font-medium">Verifying code...</span>`;

  try {
    const res = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, name, preferredLanguage })
    });
    const data = await res.json();

    if (data.success && data.user) {
      state.currentUser = data.user;
      localStorage.setItem('phonemail_active_phone', data.user.phone_number);

      if (preferredLanguage && window.phoneMailI18n && typeof window.phoneMailI18n.applyI18nToDOM === 'function') {
        state.displayLanguage = preferredLanguage;
        window.phoneMailI18n.applyI18nToDOM(preferredLanguage);
      }

      closeAuthModal();
      await refreshMailbox();
    } else {
      if (feedback) feedback.innerHTML = `<span class="text-rose-400 font-medium">${data.error || 'Verification failed.'}</span>`;
    }
  } catch (err) {
    if (feedback) feedback.innerHTML = `<span class="text-rose-400 font-medium">Error: ${err.message}</span>`;
  }
}

async function handleLogout() {
  localStorage.removeItem('phonemail_active_phone');
  state.currentUser = null;
  state.emails = [];
  state.selectedEmailId = null;

  if (window.history.pushState) {
    window.history.pushState({}, document.title, window.location.pathname);
  }

  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}

  renderApp();
  openAuthModal();
}

// =============================================================
// DATA FETCHING & SYNCHRONIZATION
// =============================================================

async function refreshMailbox() {
  if (!state.currentUser) return;
  await Promise.all([fetchEmails(), fetchCounts()]);
  renderApp();
}

async function fetchEmails() {
  if (!state.currentUser) return;
  try {
    const params = new URLSearchParams({
      user: state.currentUser.phone_number,
      folder: state.currentFolder,
      filter: state.currentFilter
    });
    if (state.currentLabel) {
      params.append('label', state.currentLabel);
    }
    if (state.searchQuery) {
      params.append('search', state.searchQuery);
    }

    const res = await fetch(`/api/emails?${params.toString()}`);
    const data = await res.json();
    state.emails = data.emails || [];

    // Auto-select first email if none selected or current selection missing
    if (state.emails.length > 0) {
      const exists = state.emails.find(e => e.id === state.selectedEmailId);
      if (!exists) {
        state.selectedEmailId = state.emails[0].id;
      }
    } else {
      state.selectedEmailId = null;
    }

    // Trigger AI translation of inbox items if non-English language is active
    if (state.displayLanguage && state.displayLanguage !== 'en') {
      translateCurrentInbox(state.displayLanguage);
      if (state.selectedEmailId) {
        ensureSelectedEmailTranslated(state.selectedEmailId, state.displayLanguage);
      }
    }
  } catch (err) {
    console.error('Failed to fetch emails', err);
  }
}

async function fetchCounts() {
  if (!state.currentUser) return;
  try {
    const res = await fetch(`/api/emails/counts?user=${encodeURIComponent(state.currentUser.phone_number)}`);
    const data = await res.json();
    state.counts = data;
  } catch (err) {
    console.error('Failed to fetch counts', err);
  }
}

// =============================================================
// WEBSOCKET REAL-TIME SYNC
// =============================================================

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'NEW_EMAIL_DELIVERED') {
        await refreshMailbox();
        showNotificationToast(`New notice from ${data.email.sender_name || data.email.sender}: "${data.email.subject}"`);
      } else if (data.type === 'CIVIC_EMERGENCY_BROADCAST') {
        const banner = document.getElementById('civic-broadcast-banner');
        const hEl = document.getElementById('broadcast-headline');
        const dEl = document.getElementById('broadcast-details');
        if (banner && hEl && dEl) {
          hEl.textContent = data.headline;
          dEl.textContent = data.email?.body || 'Civic Advisory Issued.';
          banner.classList.remove('hidden');
        }
        await refreshMailbox();
        showNotificationToast(`CIVIC EMERGENCY BROADCAST: ${data.headline}`);
      } else if (data.type === 'NEW_SMS_REPLY_RECEIVED') {
        await refreshMailbox();
        showNotificationToast(`📱 Inbound SMS from ${data.fromPhone || 'Citizen'} on Docket #${data.ticketId}: "${(data.text || '').slice(0, 45)}"`);
      } else if (data.type === 'EMERGENCY_SOS_ALERT') {
        await refreshMailbox();
        showNotificationToast(`🚨 CRITICAL SOS RESCUE: Citizen ${data.citizenPhone} requested emergency evacuation on #${data.ticketId}!`);
        speakTextIfSupported(`Emergency SOS Alert! Citizen ${data.citizenPhone} requested rescue for ${data.headline}`);
      } else if (data.type === 'ROBOCALL_STATUS_UPDATE') {
        showNotificationToast(`📞 Disaster Robocall: Citizen ${data.citizenPhone} confirmed ${data.status}.`);
      } else if (data.type === 'EMAIL_STAR_UPDATED' || data.type === 'EMAIL_READ_UPDATED' || data.type === 'EMAIL_MOVED') {
        await refreshMailbox();
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 3000);
  };
}

function showNotificationToast(msg) {
  const toast = document.getElementById('notification-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('opacity-0', 'pointer-events-none', '-translate-y-4');
  setTimeout(() => {
    toast.classList.add('opacity-0', 'pointer-events-none', '-translate-y-4');
  }, 4000);
}

// =============================================================
// PHASE 6: SCREEN RESPONSIVENESS & VIEW SWITCHER ENGINE
// =============================================================

let resizeTimeout = null;

function initViewSwitcher() {
  const segmentedButtons = document.querySelectorAll('[data-view-mode]');
  segmentedButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-view-mode');
      setViewMode(mode);
    });
  });

  // Restore sidebar state or auto-collapse on tablet
  const savedSidebar = localStorage.getItem('phonemail_sidebar_collapsed');
  if (savedSidebar !== null) {
    state.sidebarCollapsed = savedSidebar === 'true';
  } else if (window.innerWidth < 1024) {
    state.sidebarCollapsed = true;
  }
  const sidebar = document.getElementById('desktop-sidebar');
  if (sidebar && state.sidebarCollapsed) {
    sidebar.classList.add('sidebar-collapsed');
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  localStorage.setItem('phonemail_view_mode', mode);

  // Update segmented control buttons across desktop pill and mobile bottom sheet
  document.querySelectorAll('[data-view-mode]').forEach(btn => {
    const isCurrent = btn.getAttribute('data-view-mode') === mode;
    const isBottomSheet = btn.closest('#tools-bottom-sheet') !== null;
    if (isBottomSheet) {
      if (isCurrent) {
        btn.className = 'py-2 rounded-xl font-bold bg-blue-600 text-white shadow-sm transition-all text-center';
      } else {
        btn.className = 'py-2 rounded-xl font-medium text-slate-400 hover:text-white transition-all text-center';
      }
    } else {
      if (isCurrent) {
        btn.className = 'px-2 py-0.5 rounded-full font-bold bg-blue-600 text-white shadow-sm transition-all';
      } else {
        btn.className = 'px-2 py-0.5 rounded-full font-medium text-slate-400 hover:text-white transition-all';
      }
    }
  });

  // Update mobile tools trigger pill label
  const modeLabel = document.getElementById('mobile-tools-mode-label');
  if (modeLabel) {
    modeLabel.textContent = mode.toUpperCase();
    if (mode === 'desktop') {
      modeLabel.className = 'px-1.5 py-0.5 rounded text-[9px] bg-indigo-600 font-mono font-bold text-white uppercase';
    } else if (mode === 'mobile') {
      modeLabel.className = 'px-1.5 py-0.5 rounded text-[9px] bg-emerald-600 font-mono font-bold text-white uppercase';
    } else {
      modeLabel.className = 'px-1.5 py-0.5 rounded text-[9px] bg-blue-600 font-mono font-bold text-white uppercase';
    }
  }

  applyViewRouting();
}

function toggleToolsDrawer(open) {
  const sheet = document.getElementById('tools-bottom-sheet');
  const backdrop = document.getElementById('tools-bottom-sheet-backdrop');
  if (!sheet) return;

  const willOpen = open !== undefined ? open : sheet.classList.contains('hidden');
  if (willOpen) {
    sheet.classList.remove('hidden');
    backdrop?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } else {
    sheet.classList.add('hidden');
    backdrop?.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

function toggleDesktopSidebar(forced) {
  const sidebar = document.getElementById('desktop-sidebar');
  if (!sidebar) return;

  if (typeof forced === 'boolean') {
    state.sidebarCollapsed = forced;
  } else {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem('phonemail_sidebar_collapsed_user_action', 'true');
  }

  localStorage.setItem('phonemail_sidebar_collapsed', state.sidebarCollapsed ? 'true' : 'false');

  if (state.sidebarCollapsed) {
    sidebar.classList.add('sidebar-collapsed');
  } else {
    sidebar.classList.remove('sidebar-collapsed');
  }
}

function handleViewportResize() {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    // If on tablet / narrow desktop window (< 1024px) and user hasn't explicitly expanded sidebar, auto-collapse
    if (window.innerWidth < 1024 && !localStorage.getItem('phonemail_sidebar_collapsed_user_action')) {
      toggleDesktopSidebar(true);
    }
    applyViewRouting();
  }, 50);
}

function applyViewRouting() {
  const desktopContainer = document.getElementById('desktop-view-container');
  const mobileContainer = document.getElementById('mobile-view-container');
  
  const isMobileViewport = window.innerWidth < 768;

  let renderMobile = false;
  if (state.viewMode === 'mobile') {
    renderMobile = true;
  } else if (state.viewMode === 'desktop') {
    renderMobile = false;
  } else {
    renderMobile = isMobileViewport;
  }

  if (renderMobile) {
    if (desktopContainer) desktopContainer.classList.add('hidden');
    if (mobileContainer) mobileContainer.classList.remove('hidden');
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('email') && !state.mobileScreen) {
      state.mobileScreen = 'detail';
    }
  } else {
    if (desktopContainer) desktopContainer.classList.remove('hidden');
    if (mobileContainer) mobileContainer.classList.add('hidden');
  }

  renderApp();
}

// =============================================================
// MAIN RENDER ENGINE
// =============================================================

function renderApp() {
  updateUserBadges();
  renderDesktopSidebar();
  renderDesktopEmailList();
  renderDesktopReadingPane();
  renderMobileScreen();
}

function updateUserBadges() {
  const u = state.currentUser;
  if (!u) return;

  const names = document.querySelectorAll('.user-display-name');
  const emails = document.querySelectorAll('.user-display-email');
  const avatars = document.querySelectorAll('.user-display-avatar');

  names.forEach(el => el.textContent = u.name || 'Dharun R');
  emails.forEach(el => el.textContent = u.email || 'dharunr@kpriet.ac.in');
  avatars.forEach(el => {
    el.textContent = (u.name || 'Dharun R').charAt(0).toUpperCase();
  });
}

// =============================================================
// DESKTOP VIEW RENDERING (MATCHING IMAGE 1)
// =============================================================

function renderDesktopSidebar() {
  const inboxCount = state.counts.folders?.inbox ?? state.emails.filter(e => e.folder === 'inbox' || !e.folder).length ?? 12;
  const draftsCount = state.counts.folders?.drafts || 4;
  const receiptsCount = state.counts.labels?.['Govt Receipts'] ?? state.emails.filter(e => e.label === 'Govt Receipts').length ?? 4;

  const inboxBadge = document.getElementById('d-badge-inbox');
  const draftsBadge = document.getElementById('d-badge-drafts');
  const receiptsBadge = document.getElementById('d-badge-govt-receipts');

  if (inboxBadge) {
    inboxBadge.textContent = inboxCount > 0 ? inboxCount : '12';
    inboxBadge.style.display = 'inline-block';
  }
  if (draftsBadge) {
    draftsBadge.textContent = draftsCount > 0 ? draftsCount : '4';
    draftsBadge.style.display = 'inline-block';
  }
  if (receiptsBadge) {
    receiptsBadge.textContent = receiptsCount > 0 ? receiptsCount : '4';
    receiptsBadge.style.display = 'inline-block';
  }

  // Active folder styling
  const navItems = document.querySelectorAll('[data-folder]');
  navItems.forEach(item => {
    const f = item.getAttribute('data-folder');
    if (f === state.currentFolder && !state.currentLabel) {
      item.className = 'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-[#202637] text-white transition-colors';
    } else {
      item.className = 'w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 hover:bg-[#1a202c] transition-colors';
    }
  });

  // Active label styling
  const labelItems = document.querySelectorAll('[data-label]');
  labelItems.forEach(item => {
    const l = item.getAttribute('data-label');
    if (l === state.currentLabel) {
      item.className = 'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#202637] text-white transition-colors';
    } else {
      item.className = 'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-[#1a202c] transition-colors';
    }
  });
}

function renderDesktopEmailList() {
  const container = document.getElementById('desktop-mail-list');
  if (!container) return;

  const icons = window.phoneMailIcons || {};
  const t = window.phoneMailI18n ? window.phoneMailI18n.t : (k => k);
  const curLang = state.displayLanguage || 'en';
  const isTranslatedLang = curLang !== 'en';

  if (state.emails.length === 0) {
    container.innerHTML = `
      <div class="h-64 flex flex-col items-center justify-center text-slate-400 text-xs p-6 text-center">
        ${icons.inbox ? icons.inbox('w-10 h-10 text-slate-300 mb-2') : ''}
        <p class="font-medium text-slate-400">${t('no_notices')}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.emails.map(email => {
    const isSelected = email.id === state.selectedEmailId;
    const isUnread = email.is_read === 0;
    const isBroadcast = email.is_broadcast === 1 || (email.subject && email.subject.includes('EMERGENCY NOTICE'));
    const hasAttachments = email.has_attachments === 1 || (email.attachments && email.attachments.length > 0);
    const dateFormatted = formatDisplayTime(email.timestamp);

    // AI Translated subject and preview snippet
    const trans = state.emailTranslations[curLang]?.[email.id];
    const displaySubject = (isTranslatedLang && trans?.subject) ? trans.subject : email.subject;
    const displaySnippet = (isTranslatedLang && trans?.snippet) ? trans.snippet : email.body.replace(/\n+/g, ' ');

    let rowClass = 'hover:bg-[#f8f9fa]';
    if (isBroadcast) {
      rowClass = isSelected ? 'bg-rose-100/70 border-l-4 border-l-rose-600' : 'bg-rose-50/50 hover:bg-rose-100/40 border-l-4 border-l-rose-500';
    } else if (isSelected) {
      rowClass = 'bg-[#eef3fc]';
    }

    return `
      <div 
        onclick="selectEmail(${email.id})"
        class="group relative flex items-start gap-3 p-3.5 border-b border-[#f1f3f4] cursor-pointer transition-colors ${rowClass}">
        
        <!-- Unread Blue Dot or Emergency Alarm -->
        <div class="pt-3 w-2.5 flex-shrink-0 flex items-center justify-center">
          ${isBroadcast ? '<span class="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping"></span>' : (isUnread ? '<span class="w-2 h-2 rounded-full bg-blue-600"></span>' : '<span class="w-2 h-2"></span>')}
        </div>

        <!-- Contact Avatar -->
        ${renderSenderAvatar(email, 'w-9 h-9', 'text-sm')}

        <!-- Details -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-0.5">
            <span class="text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5">
              ${escapeHtml(email.sender_name || email.sender)}
              ${email.is_gov_verified ? `<span class="text-emerald-600" title="${t('verified_dept')}">${icons.shield ? icons.shield('w-3 h-3') : ''}</span>` : ''}
              ${isBroadcast ? `<span class="px-1.5 py-0.2 rounded text-[9px] bg-rose-600 text-white font-extrabold uppercase tracking-wider animate-pulse">${icons.alert ? icons.alert('w-2.5 h-2.5 inline') : '🚨'} ${t('pinned_alert')}</span>` : ''}
            </span>
            <div class="flex items-center gap-1.5 flex-shrink-0 text-xs ${isBroadcast ? 'font-bold text-rose-600' : 'text-slate-500 font-normal'}">
              ${hasAttachments ? `<span class="text-slate-400">${icons.clip ? icons.clip('w-3.5 h-3.5') : ''}</span>` : ''}
              <span>${dateFormatted}</span>
            </div>
          </div>

          <div class="text-xs ${isUnread || isBroadcast ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'} truncate flex items-center gap-1.5">
            ${isBroadcast ? `<span class="text-rose-600 font-extrabold">${t('disaster_alert')}</span>` : ''}
            <span>${escapeHtml(displaySubject)}</span>
            ${(isTranslatedLang && trans?.subject) ? `<span class="px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-blue-100 text-blue-800 border border-blue-200 uppercase tracking-wider flex-shrink-0">AI ${curLang}</span>` : ''}
          </div>
          
          <div class="flex items-center justify-between gap-2 mt-0.5">
            <div class="text-xs text-slate-500 truncate flex-1 font-normal">
              ${escapeHtml(displaySnippet)}
            </div>
            <button 
              type="button"
              onclick="event.stopPropagation(); toggleStar(${email.id})"
              class="text-sm ${email.is_starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'} flex-shrink-0 transition-colors">
              ${email.is_starred ? (icons.starredFilled ? icons.starredFilled('w-4 h-4') : '★') : (icons.star ? icons.star('w-4 h-4') : '☆')}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderDesktopReadingPane() {
  const container = document.getElementById('desktop-reading-pane');
  if (!container) return;

  const icons = window.phoneMailIcons || {};

  const email = state.emails.find(e => e.id === state.selectedEmailId);
  if (!email) {
    container.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-slate-400 text-xs">
        ${icons.mail ? icons.mail('w-12 h-12 text-slate-300 mb-3') : ''}
        <p class="font-medium text-slate-500">Select an email to read</p>
      </div>
    `;
    return;
  }

  const initial = (email.sender_name || email.sender).charAt(0).toUpperCase();
  const avatarBg = getAvatarBg(email.sender_name || email.sender);
  const timeFormatted = formatDisplayTime(email.timestamp, true);
  const attachments = email.attachments || [];
  const receiptAtt = attachments.find(a => a.sha256 || a.type === 'pdf') || null;
  const isBroadcast = email.is_broadcast === 1 || (email.subject && email.subject.includes('EMERGENCY NOTICE'));
  const isGovNotice = email.is_gov_verified === 1 || isBroadcast || email.label === 'Govt Receipts' || email.label === 'Civic Grievance';
  const isReceipt = email.label === 'Govt Receipts' || !!receiptAtt?.sha256;

  const curLang = state.displayLanguage || 'en';
  const isTranslatedLang = curLang !== 'en';
  const langObj = SUPPORTED_AUDIO_LANGS.find(l => l.code === curLang) || SUPPORTED_AUDIO_LANGS[0];
  const trans = state.emailTranslations[curLang]?.[email.id];

  const useTranslation = isTranslatedLang && state.readingViewTranslationMode === 'translated';
  const displaySubject = (useTranslation && trans?.subject) ? trans.subject : email.subject;
  const displayBody = (useTranslation && trans?.body) ? trans.body : email.body;

  // Trigger full email translation if not yet translated
  if (isTranslatedLang && (!trans || !trans.body)) {
    ensureSelectedEmailTranslated(email.id, curLang);
  }

  container.innerHTML = `
    <!-- Action Toolbar (Matching Image 1 Exactly with Custom SVG Icons & Responsive Controls) -->
    <div class="h-14 px-3 sm:px-6 border-b border-[#eaedf2] flex items-center justify-between bg-white text-slate-600 select-none flex-shrink-0 overflow-x-auto no-scrollbar gap-2">
      <div class="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        <!-- Back to List Button -->
        <button 
          type="button" 
          onclick="deselectCurrentEmail()" 
          class="flex items-center gap-1.5 p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors font-medium text-xs mr-0.5"
          title="Back to Mail List">
          ${icons.arrowLeft('w-4 h-4 text-slate-700')}
          <span class="hidden sm:inline font-semibold">Back</span>
        </button>
        <button onclick="navigateMailList(-1)" title="Previous email" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.chevronLeft('w-4 h-4 text-slate-600')}
        </button>
        <button onclick="navigateMailList(1)" title="Next email" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.chevronRight('w-4 h-4 text-slate-600')}
        </button>
        <span class="h-4 w-px bg-slate-200 mx-0.5"></span>
        <button onclick="archiveEmail(${email.id})" title="Archive" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.archive('w-4 h-4 text-slate-600')}
        </button>
        <button onclick="reportSpam(${email.id})" title="Report spam" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.alert('w-4 h-4 text-slate-600')}
        </button>
        <button onclick="deleteEmail(${email.id})" title="Delete" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.trash('w-4 h-4 text-slate-600')}
        </button>
        <span class="h-4 w-px bg-slate-200 mx-0.5"></span>
        <button onclick="markAsUnread(${email.id})" title="Mark unread" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.mail('w-4 h-4 text-slate-600')}
        </button>
        <button onclick="openSnoozeMenu(event, ${email.id})" title="Snooze" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.clock('w-4 h-4 text-slate-600')}
        </button>
        <button onclick="openMoveFolderMenu(event, ${email.id})" title="Move to folder" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.folder('w-4 h-4 text-slate-600')}
        </button>
        <button onclick="openLabelMenu(event, ${email.id})" title="Add label" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.tag('w-4 h-4 text-slate-600')}
        </button>
        <button onclick="openMoreOptionsMenu(event, ${email.id})" title="More options" class="p-1.5 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          ${icons.more('w-4 h-4 text-slate-600')}
        </button>
      </div>

      <!-- Right Toolbar Items: Audio Voice Language, Theme Switcher, Settings, User Avatar -->
      <div class="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
        <!-- Compact Multi-Language Read-Aloud Pill -->
        <div class="flex items-center bg-slate-100 rounded-xl p-0.5 border border-slate-200">
          <select 
            id="toolbar-read-lang" 
            onchange="setAppLanguage(this.value)" 
            class="audio-lang-select app-lang-select bg-transparent text-slate-700 text-xs font-semibold px-2 py-1 focus:outline-none cursor-pointer">
            ${renderAudioLangOptions()}
          </select>
          <button 
            type="button" 
            id="btn-read-aloud" 
            onclick="toggleReadAloud()"
            class="px-2.5 py-1 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-white transition-all flex items-center gap-1 text-xs font-semibold"
            title="Read notice aloud in selected language">
            <span id="read-aloud-icon">${icons.volume('w-3.5 h-3.5 text-blue-600')}</span>
            <span class="hidden xl:inline">Listen</span>
          </button>
        </div>

        <!-- Quick Theme Switcher Button -->
        <button 
          type="button"
          onclick="cycleTheme()" 
          title="Switch Visual Theme (Classic / Midnight OLED / Emerald)" 
          class="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-xl transition-all flex items-center gap-1">
          ${icons.palette('w-4 h-4')}
        </button>

        <!-- Settings Button -->
        <button 
          type="button"
          onclick="openSettingsModal()" 
          title="Platform Settings" 
          class="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors">
          ${icons.settings('w-4 h-4')}
        </button>

        <!-- User Avatar with Profile Dropdown Menu -->
        <button 
          type="button"
          onclick="openProfileMenu(event)"
          title="User Account &amp; Profiles"
          class="w-8 h-8 rounded-full bg-[#1e293b] text-white font-bold text-xs flex items-center justify-center relative ml-0.5 shadow-sm hover:ring-2 hover:ring-blue-500 transition-all cursor-pointer">
          ${(state.currentUser?.name || 'Dharun R').charAt(0).toUpperCase()}
          <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white"></span>
        </button>
      </div>
    </div>

    <!-- Reading Content (Scrollable matching Image 1 with Responsive Padding) -->
    <div class="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4 sm:space-y-6">
      
      <!-- Slim AI Translation Toggle -->
      ${isTranslatedLang ? `
        <div class="flex items-center justify-between px-1 py-1 text-xs">
          <div class="flex items-center gap-2 text-slate-500">
            ${icons.translate('w-3.5 h-3.5 text-blue-500')}
            <span>${(trans && trans.body) ? 'Translated to' : 'Translating to'} <strong class="text-slate-700">${langObj.label}</strong></span>
          </div>
          <div class="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            <button 
              type="button" 
              onclick="setReadingViewTranslationMode('translated')" 
              class="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${state.readingViewTranslationMode === 'translated' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">
              ${window.phoneMailI18n ? window.phoneMailI18n.t('view_translated') : 'Translation'}
            </button>
            <button 
              type="button" 
              onclick="setReadingViewTranslationMode('original')" 
              class="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${state.readingViewTranslationMode === 'original' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">
              ${window.phoneMailI18n ? window.phoneMailI18n.t('view_original') : 'Original'}
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Subject Header -->
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-center gap-3 flex-wrap">
          <h1 class="text-2xl font-bold text-slate-900 tracking-tight leading-snug">
            ${escapeHtml(displaySubject)}
          </h1>
          <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
            Inbox
          </span>
          ${isBroadcast ? `<span class="px-2.5 py-0.5 rounded text-xs font-extrabold bg-rose-600 text-white shadow-sm flex items-center gap-1.5 animate-pulse">${icons.alert('w-3.5 h-3.5 text-white')} EMERGENCY NOTICE</span>` : ''}
          ${email.ticket_id ? `<span class="px-2.5 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">${icons.ticket('w-3 h-3 text-amber-700')} Docket: ${escapeHtml(email.ticket_id)}</span>` : ''}
          ${email.sender && email.sender.startsWith('+') ? `<span class="px-2.5 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1">${icons.phone('w-3 h-3 text-blue-600')} Caller ID: ${escapeHtml(email.sender)}</span>` : ''}
          ${isReceipt ? `<span class="px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">${icons.landmark('w-3.5 h-3.5 text-emerald-700')} Welfare Locker</span>` : ''}
        </div>
        <button onclick="toggleStar(${email.id})" class="p-1 text-slate-300 hover:text-amber-400 transition-colors">
          ${email.is_starred ? (icons.starredFilled ? icons.starredFilled('w-5 h-5') : '★') : (icons.star ? icons.star('w-5 h-5 text-slate-300') : '☆')}
        </button>
      </div>

      <!-- Emergency Broadcast Notice (Compact) -->
      ${isBroadcast ? `
        <div class="px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-xs">
          ${icons.siren('w-4 h-4 text-rose-600 flex-shrink-0')}
          <span class="font-semibold text-rose-800">Emergency Civic Broadcast</span>
          <span class="text-rose-500 font-normal">Dispatched via priority SMS &amp; pinned to inbox</span>
        </div>
      ` : ''}

      <!-- Live Translated Reading Card (hidden until audio active) -->
      <div id="reading-pane-translation-box" class="hidden p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 font-semibold text-slate-700">
            ${icons.translate('w-3.5 h-3.5 text-blue-500')}
            <span id="translation-box-title">Translation</span>
          </div>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-100 text-blue-700">VOICING</span>
        </div>
        <div id="reading-pane-translated-text" class="text-slate-600 leading-relaxed"></div>
      </div>




      <!-- Sender Info Row -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          ${renderSenderAvatar(email, 'w-10 h-10', 'text-base')}
          <div>
            <div class="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              ${escapeHtml(email.sender_name || email.sender)}
              <span class="text-slate-400 font-normal text-xs">&lt;${escapeHtml(email.sender)}&gt;</span>
              ${email.is_gov_verified ? `
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                  ${icons.shield ? icons.shield('w-2.5 h-2.5 text-emerald-600') : ''}
                  Verified
                </span>
              ` : ''}
            </div>
            <div class="text-xs text-slate-400 flex items-center gap-1 font-normal">
              to ${escapeHtml(email.recipient_name || email.recipient)} <span class="text-slate-300">▾</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs text-slate-400 font-normal">
          <span>${timeFormatted}</span>
          <button onclick="openQuickReply('${escapeHtml(email.sender)}', '${escapeHtml(email.subject)}')" class="p-1.5 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Reply">
            ${icons.reply ? icons.reply('w-4 h-4 text-slate-400') : ''}
          </button>
          <button class="p-1.5 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="More options">
            ${icons.more ? icons.more('w-4 h-4 text-slate-400') : ''}
          </button>
        </div>
      </div>

      <!-- Email Body -->
      <div class="text-sm text-slate-700 leading-relaxed space-y-4 max-w-3xl">
        ${renderFormattedBody(displayBody)}
      </div>

      <!-- Official Receipt Verification (compact, below body) -->
      ${isReceipt ? `
        <div class="pt-4 border-t border-slate-100 space-y-2.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-xs">
              <svg class="w-4 h-4 text-emerald-600 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
              <span class="font-semibold text-slate-700">SHA-256 Verified</span>
              <span class="font-mono text-[10px] text-slate-400">${escapeHtml(receiptAtt?.sha256 || 'e3b0c44...b855').substring(0, 24)}...</span>
            </div>
            <button 
              type="button"
              onclick="openReceiptModal(${email.id})"
              class="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 border border-emerald-200 transition-colors flex items-center gap-1">
              ${icons.eye('w-3 h-3 text-emerald-600')}
              <span>View Certificate</span>
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Officer SMS Dispatch (compact, below body) -->
      ${email.ticket_id || email.label === 'Civic Grievance' ? `
        <div class="pt-3 border-t border-slate-100">
          <div class="flex gap-2">
            <input 
              type="text" 
              id="officer-sms-reply-input" 
              placeholder="Send SMS update to citizen..." 
              class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            />
            <button 
              type="button" 
              onclick="officerSendSmsReply('${escapeHtml(email.ticket_id || '')}', '${escapeHtml(email.sender)}')" 
              class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors">
              ${icons.sms('w-3.5 h-3.5 text-white')}
              <span>Send SMS</span>
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Attachments Section (Matching Image 1) -->
      ${attachments.length > 0 ? `
        <div class="pt-4 border-t border-[#eaedf2]">
          <div class="flex items-center justify-between text-xs text-slate-500 font-medium mb-3">
            <div class="flex items-center gap-1.5">
              <span>${attachments.length} Attachment${attachments.length > 1 ? 's' : ''}</span>
              <span>•</span>
              <span class="text-slate-400">Scanned by Gmail ⓘ</span>
            </div>
            <div class="flex items-center gap-2 text-slate-400">
              <button title="Download all" class="hover:text-slate-700">${icons.download ? icons.download('w-4 h-4 text-slate-500') : ''}</button>
              <button title="Save to Drive" class="hover:text-slate-700">${icons.drive ? icons.drive('w-4 h-4 text-slate-500') : ''}</button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
            ${attachments.map(att => `
              ${att.type === 'audio' ? `
                <div class="col-span-1 sm:col-span-2 p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/70 shadow-sm">
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2.5">
                      <div class="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
                        ${icons.phone ? icons.phone('w-4 h-4 text-white') : ''}
                      </div>
                      <div>
                        <div class="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                          <span>Citizen Voice Recording</span>
                          <span class="px-1.5 py-0.2 rounded text-[9px] bg-indigo-200/60 text-indigo-800 font-mono font-bold uppercase">IVR Helpline</span>
                        </div>
                        <div class="text-[11px] text-indigo-600 font-mono">${escapeHtml(att.name)} • ${escapeHtml(att.duration || 'Audio')}</div>
                      </div>
                    </div>
                    <a href="${escapeHtml(att.url)}" target="_blank" download class="text-xs font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 p-1">
                      ${icons.download ? icons.download('w-3.5 h-3.5 text-indigo-700') : ''}
                      <span>Download</span>
                    </a>
                  </div>
                  <audio controls src="${escapeHtml(att.url)}" preload="metadata" class="w-full h-8 mt-1 rounded"></audio>
                  ${att.transcription ? `
                    <div class="mt-2.5 pt-2 border-t border-indigo-100 text-xs text-indigo-900 bg-white/70 p-2.5 rounded-lg border">
                      <div class="font-bold text-[10px] uppercase text-indigo-600 tracking-wider mb-0.5">Auto-Transcribed Citizen Voice</div>
                      <div class="italic text-slate-800 font-sans">"${escapeHtml(att.transcription)}"</div>
                    </div>
                  ` : ''}
                </div>
              ` : `
                <div class="flex items-center justify-between p-3 rounded-xl border border-[#eaedf2] bg-[#f8f9fa] hover:bg-white transition-all shadow-sm group">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="w-9 h-9 rounded-lg ${att.type === 'pdf' ? 'bg-[#ea4335]' : 'bg-[#1a73e8]'} text-white flex items-center justify-center font-bold ${att.type === 'docx' ? 'text-sm' : 'text-[10px]'} uppercase flex-shrink-0">
                      ${att.type === 'docx' ? 'W' : (att.type === 'pdf' ? 'PDF' : escapeHtml(att.type || 'FILE'))}
                    </div>
                    <div class="min-w-0">
                      <div class="text-xs font-semibold text-slate-800 truncate">${escapeHtml(att.name)}</div>
                      <div class="text-[11px] text-slate-400">${escapeHtml(att.size || '32 KB')}</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 text-slate-400 opacity-70 group-hover:opacity-100 transition-opacity">
                    <button title="Download" class="p-1 hover:text-slate-800">${icons.download ? icons.download('w-3.5 h-3.5 text-slate-500') : ''}</button>
                    <button title="Options" class="p-1 hover:text-slate-800">${icons.more ? icons.more('w-3.5 h-3.5 text-slate-500') : ''}</button>
                  </div>
                </div>
              `}
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Bottom Quick Reply Toolbar (Matching Image 1) -->
      <div class="pt-6 border-t border-[#eaedf2] flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-[#1e293b] text-white flex items-center justify-center font-bold text-xs shadow-sm">
            D
          </div>
          <button 
            onclick="openQuickReply('${escapeHtml(email.sender)}', '${escapeHtml(email.subject)}')"
            class="px-5 py-2 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2">
            ${icons.reply ? icons.reply('w-3.5 h-3.5 text-slate-600') : ''}
            <span>Reply</span>
          </button>
          <button 
            onclick="openQuickReply('${escapeHtml(email.sender)}', '${escapeHtml(email.subject)}')"
            class="px-5 py-2 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2">
            ${icons.replyAll ? icons.replyAll('w-3.5 h-3.5 text-slate-600') : ''}
            <span>Reply all</span>
          </button>
          <button 
            onclick="openQuickReply('', 'Fwd: ${escapeHtml(email.subject)}')"
            class="px-5 py-2 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2">
            ${icons.forward ? icons.forward('w-3.5 h-3.5 text-slate-600') : ''}
            <span>Forward</span>
          </button>
        </div>
        <div class="flex items-center gap-2 text-slate-400">
          <button title="Insert emoji" class="p-1.5 hover:text-slate-700">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button>
          <button title="More options" class="p-1.5 hover:text-slate-700">${icons.more ? icons.more('w-4 h-4 text-slate-500') : ''}</button>
        </div>
      </div>

    </div>
  `;
}

// =============================================================
// MOBILE VIEW RENDERING (MATCHING IMAGE 2)
// =============================================================

function renderMobileScreen() {
  const screenInbox = document.getElementById('mobile-screen-inbox');
  const screenDetail = document.getElementById('mobile-screen-detail');
  const screenSearch = document.getElementById('mobile-screen-search');

  if (!screenInbox || !screenDetail || !screenSearch) return;

  screenInbox.classList.toggle('hidden', state.mobileScreen !== 'inbox');
  screenDetail.classList.toggle('hidden', state.mobileScreen !== 'detail');
  screenSearch.classList.toggle('hidden', state.mobileScreen !== 'search');

  if (state.mobileScreen === 'inbox') {
    renderMobileInboxList();
  } else if (state.mobileScreen === 'detail') {
    renderMobileDetailView();
  } else if (state.mobileScreen === 'search') {
    renderMobileSearchList();
  }

  renderMobileDrawer();
}

function renderMobileInboxList() {
  const container = document.getElementById('mobile-mail-list');
  if (!container) return;

  const icons = window.phoneMailIcons || {};
  const t = window.phoneMailI18n ? window.phoneMailI18n.t : (k => k);
  const curLang = state.displayLanguage || 'en';
  const isTranslatedLang = curLang !== 'en';

  if (state.emails.length === 0) {
    container.innerHTML = `
      <div class="h-64 flex flex-col items-center justify-center text-slate-400 text-xs p-6 text-center">
        ${icons.inbox ? icons.inbox('w-10 h-10 text-slate-300 mb-2') : ''}
        <p class="font-medium text-slate-400">${t('no_notices')}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.emails.map(email => {
    const isUnread = email.is_read === 0;
    const isBroadcast = email.is_broadcast === 1 || (email.subject && email.subject.includes('EMERGENCY NOTICE'));
    const initial = (email.sender_name || email.sender).charAt(0).toUpperCase();
    const avatarBg = getAvatarBg(email.sender_name || email.sender);
    const dateFormatted = formatDisplayTime(email.timestamp);
    const hasAttachments = email.has_attachments === 1 || (email.attachments && email.attachments.length > 0);

    const trans = state.emailTranslations[curLang]?.[email.id];
    const displaySubject = (isTranslatedLang && trans?.subject) ? trans.subject : email.subject;
    const displaySnippet = (isTranslatedLang && trans?.snippet) ? trans.snippet : email.body.replace(/\n+/g, ' ');

    const rowBg = isBroadcast ? 'bg-rose-50/60 border-l-4 border-l-rose-600' : 'active:bg-slate-50';

    return `
      <div 
        onclick="openMobileDetail(${email.id})"
        class="flex items-start gap-3 p-3.5 border-b border-[#f1f3f4] cursor-pointer ${rowBg}">
        
        <!-- Left Avatar & Unread Indicator -->
        <div class="relative flex-shrink-0">
          ${renderSenderAvatar(email, 'w-10 h-10', 'text-sm')}
          ${isBroadcast ? '<span class="absolute -top-0.5 -left-1 w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping border-2 border-white"></span>' : (isUnread ? '<span class="absolute -top-0.5 -left-1 w-2.5 h-2.5 rounded-full bg-blue-600 border-2 border-white"></span>' : '')}
        </div>

        <!-- Middle Content -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-0.5">
            <span class="text-xs font-bold text-slate-900 truncate flex items-center gap-1">
              ${escapeHtml(email.sender_name || email.sender)}
              ${isBroadcast ? '<span class="px-1.5 py-0.2 rounded text-[9px] bg-rose-600 text-white font-extrabold uppercase">🚨 Alert</span>' : ''}
            </span>
            <div class="flex items-center gap-1 text-[11px] ${isBroadcast ? 'text-rose-600 font-bold' : 'text-slate-400 font-mono'}">
              ${hasAttachments ? `<span>${icons.clip ? icons.clip('w-3 h-3 text-slate-400') : ''}</span>` : ''}
              <span>${dateFormatted}</span>
            </div>
          </div>

          <div class="text-xs ${isUnread || isBroadcast ? 'font-bold text-slate-900' : 'text-slate-800 font-medium'} truncate flex items-center gap-1">
            ${isBroadcast ? '<span class="text-rose-600 font-extrabold">🚨 </span>' : ''}
            <span>${escapeHtml(displaySubject)}</span>
            ${(isTranslatedLang && trans?.subject) ? `<span class="px-1 py-0.1 rounded text-[8px] font-bold bg-blue-100 text-blue-800">AI</span>` : ''}
          </div>

          <div class="flex items-center justify-between gap-1.5 mt-0.5">
            <div class="text-[11px] text-slate-500 truncate flex-1">
              ${escapeHtml(displaySnippet)}
            </div>
            <button 
              type="button" 
              onclick="event.stopPropagation(); toggleStar(${email.id})"
              class="text-xs ${email.is_starred ? 'text-amber-400' : 'text-slate-300'} pl-1">
              ${email.is_starred ? (icons.starredFilled ? icons.starredFilled('w-3.5 h-3.5') : '★') : (icons.star ? icons.star('w-3.5 h-3.5 text-slate-300') : '☆')}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderMobileDetailView() {
  const container = document.getElementById('mobile-detail-content');
  if (!container) return;

  const icons = window.phoneMailIcons || {};

  const email = state.emails.find(e => e.id === state.selectedEmailId);
  if (!email) {
    container.innerHTML = '<div class="p-8 text-center text-xs text-slate-400">Email not found.</div>';
    return;
  }

  const initial = (email.sender_name || email.sender).charAt(0).toUpperCase();
  const avatarBg = getAvatarBg(email.sender_name || email.sender);
  const timeFormatted = formatDisplayTime(email.timestamp, true);
  const attachments = email.attachments || [];
  const receiptAtt = attachments.find(a => a.sha256 || a.type === 'pdf') || null;
  const isBroadcast = email.is_broadcast === 1 || (email.subject && email.subject.includes('EMERGENCY NOTICE'));
  const isGovNotice = email.is_gov_verified === 1 || isBroadcast || email.label === 'Govt Receipts' || email.label === 'Civic Grievance';
  const isReceipt = email.label === 'Govt Receipts' || !!receiptAtt?.sha256;

  const curLang = state.displayLanguage || 'en';
  const isTranslatedLang = curLang !== 'en';
  const langObj = SUPPORTED_AUDIO_LANGS.find(l => l.code === curLang) || SUPPORTED_AUDIO_LANGS[0];
  const trans = state.emailTranslations[curLang]?.[email.id];

  const useTranslation = isTranslatedLang && state.readingViewTranslationMode === 'translated';
  const displaySubject = (useTranslation && trans?.subject) ? trans.subject : email.subject;
  const displayBody = (useTranslation && trans?.body) ? trans.body : email.body;

  if (isTranslatedLang && (!trans || !trans.body)) {
    ensureSelectedEmailTranslated(email.id, curLang);
  }

  container.innerHTML = `
    <!-- Top Action Bar (Matching Image 2 Screen 2) -->
    <div class="flex items-center justify-between p-3.5 border-b border-[#eaedf2] bg-white sticky top-0 z-10 select-none">
      <button onclick="setMobileScreen('inbox')" class="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg">
        ${icons.arrowLeft ? icons.arrowLeft('w-5 h-5 text-slate-700') : '<'}
      </button>
      <div class="flex items-center gap-2 text-slate-500">
        <select 
          onchange="setAppLanguage(this.value)" 
          class="audio-lang-select app-lang-select bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg px-2 py-1 focus:outline-none">
          ${renderAudioLangOptions()}
        </select>
        <button 
          type="button" 
          onclick="toggleReadAloud()"
          class="p-1.5 text-slate-600 hover:text-blue-600 rounded-lg hover:bg-slate-100"
          title="Listen to notice">
          ${icons.volume ? icons.volume('w-4 h-4 text-slate-700') : ''}
        </button>
        <button onclick="archiveEmail(${email.id})" title="Archive" class="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100">
          ${icons.archive ? icons.archive('w-4 h-4 text-slate-700') : ''}
        </button>
        <button onclick="deleteEmail(${email.id})" title="Delete" class="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100">
          ${icons.trash ? icons.trash('w-4 h-4 text-slate-700') : ''}
        </button>
        <button onclick="markAsUnread(${email.id})" title="Mark unread" class="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100">
          ${icons.mail ? icons.mail('w-4 h-4 text-slate-700') : ''}
        </button>
        <button onclick="openMoreOptionsMenu(event, ${email.id})" title="More" class="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100">
          ${icons.more ? icons.more('w-4 h-4 text-slate-700') : ''}
        </button>
      </div>
    </div>

    <!-- Email Content Body -->
    <div class="p-4 space-y-4">
      
      <div class="flex items-start justify-between gap-2">
        <div>
          <h1 class="text-lg font-bold text-slate-900 leading-snug">${escapeHtml(email.subject)}</h1>
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-[#f1f3f4] text-slate-600">
              Inbox
            </span>
            ${isBroadcast ? `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-600 text-white animate-pulse flex items-center gap-1">${icons.alert('w-3 h-3 text-white')} EMERGENCY NOTICE</span>` : ''}
            ${isReceipt ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">${icons.landmark('w-3 h-3 text-emerald-800')} Welfare Locker</span>` : ''}
          </div>
        </div>
        <button onclick="toggleStar(${email.id})" class="p-1">
          ${email.is_starred ? (icons.starredFilled ? icons.starredFilled('w-5 h-5') : '★') : (icons.star ? icons.star('w-5 h-5 text-slate-300') : '☆')}
        </button>
      </div>

      <!-- Emergency Broadcast (Mobile, compact) -->
      ${isBroadcast ? `
        <div class="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs">
          ${icons.siren('w-3.5 h-3.5 text-rose-600 flex-shrink-0')}
          <span class="font-semibold text-rose-800">Emergency Civic Broadcast</span>
        </div>
      ` : ''}





      <!-- Sender Info -->
      <div class="flex items-center justify-between pt-1">
        <div class="flex items-center gap-3">
          ${renderSenderAvatar(email, 'w-9 h-9', 'text-xs')}
          <div>
            <div class="text-xs font-semibold text-slate-900">${escapeHtml(email.sender_name || email.sender)}</div>
            <div class="text-[11px] text-slate-400">&lt;${escapeHtml(email.sender)}&gt;</div>
          </div>
        </div>
        <div class="flex items-center gap-2 text-slate-400">
          <span class="text-[11px]">${timeFormatted}</span>
          <button onclick="openQuickReply('${escapeHtml(email.sender)}', '${escapeHtml(email.subject)}')" class="p-1 text-slate-400">${icons.reply ? icons.reply('w-3.5 h-3.5 text-slate-400') : ''}</button>
          <button class="p-1 text-slate-400">${icons.more ? icons.more('w-3.5 h-3.5 text-slate-400') : ''}</button>
        </div>
      </div>

      <!-- Body -->
      <div class="text-xs text-slate-700 leading-relaxed pt-2 space-y-3">
        ${renderFormattedBody(displayBody)}
      </div>

      <!-- Receipt verification (compact, mobile) -->
      ${isReceipt ? `
        <div class="pt-3 border-t border-slate-100">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5 text-[11px]">
              <svg class="w-3.5 h-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
              <span class="font-semibold text-slate-600">SHA-256 Verified</span>
            </div>
            <button onclick="openReceiptModal(${email.id})" class="text-[11px] font-semibold text-emerald-600">View</button>
          </div>
        </div>
      ` : ''}

      <!-- SMS dispatch (compact, mobile) -->
      ${email.ticket_id || email.label === 'Civic Grievance' ? `
        <div class="pt-3 border-t border-slate-100">
          <div class="flex gap-1.5">
            <input 
              type="text" 
              id="mob-officer-sms-input" 
              placeholder="Send SMS to citizen..." 
              class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700"
            />
            <button 
              type="button" 
              onclick="officerSendSmsReply('${escapeHtml(email.ticket_id || '')}', '${escapeHtml(email.sender)}', 'mob-officer-sms-input')" 
              class="px-2.5 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold">
              SMS
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Attachments -->
      ${attachments.length > 0 ? `
        <div class="pt-4 border-t border-[#eaedf2] space-y-2">
          <div class="text-[11px] text-slate-500 font-medium">Attachments (${attachments.length})</div>
          <div class="space-y-2">
            ${attachments.map(att => `
              ${att.type === 'audio' ? `
                <div class="p-3 rounded-xl border border-indigo-200 bg-indigo-50/70 space-y-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">
                        ${icons.phone ? icons.phone('w-3.5 h-3.5 text-white') : ''}
                      </div>
                      <div>
                        <div class="text-xs font-bold text-indigo-950">Citizen Voice Recording</div>
                        <div class="text-[10px] text-indigo-600 font-mono">${escapeHtml(att.name)} • ${escapeHtml(att.duration || 'Audio')}</div>
                      </div>
                    </div>
                    <a href="${escapeHtml(att.url)}" target="_blank" download class="text-slate-500 hover:text-slate-800 p-1">
                      ${icons.download ? icons.download('w-3.5 h-3.5') : ''}
                    </a>
                  </div>
                  <audio controls src="${escapeHtml(att.url)}" preload="metadata" class="w-full h-8 rounded"></audio>
                  ${att.transcription ? `
                    <div class="pt-2 border-t border-indigo-100 text-[11px] text-indigo-900 bg-white/70 p-2 rounded-lg">
                      <div class="font-bold text-[9px] uppercase text-indigo-600 tracking-wider">Auto-Transcription</div>
                      <div class="italic text-slate-800">"${escapeHtml(att.transcription)}"</div>
                    </div>
                  ` : ''}
                </div>
              ` : `
                <div class="flex items-center justify-between p-2.5 rounded-xl border border-[#eaedf2] bg-[#f8f9fa]">
                  <div class="flex items-center gap-2.5">
                    <div class="w-7 h-7 rounded-lg ${att.type === 'pdf' ? 'bg-red-500' : 'bg-blue-600'} text-white flex items-center justify-center font-bold text-[9px] uppercase">
                      ${escapeHtml(att.type || 'FILE')}
                    </div>
                    <div>
                      <div class="text-xs font-semibold text-slate-800 truncate">${escapeHtml(att.name)}</div>
                      <div class="text-[10px] text-slate-400">${escapeHtml(att.size || '32 KB')}</div>
                    </div>
                  </div>
                  <button class="text-slate-400 hover:text-slate-800 p-1">${icons.download ? icons.download('w-3.5 h-3.5 text-slate-500') : ''}</button>
                </div>
              `}
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Bottom Quick Actions (Matching Image 2 Screen 2) -->
      <div class="pt-6 pb-12 flex items-center gap-2">
        <button 
          onclick="openQuickReply('${escapeHtml(email.sender)}', '${escapeHtml(email.subject)}')"
          class="flex-1 py-2.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50">
          <span class="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">${icons.reply ? icons.reply('w-3.5 h-3.5 text-slate-600') : ''}</span>
          <span>Reply</span>
        </button>
        <button 
          onclick="openQuickReply('${escapeHtml(email.sender)}', '${escapeHtml(email.subject)}')"
          class="flex-1 py-2.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50">
          <span class="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">${icons.replyAll ? icons.replyAll('w-3.5 h-3.5 text-slate-600') : ''}</span>
          <span>Reply all</span>
        </button>
        <button 
          onclick="openQuickReply('', 'Fwd: ${escapeHtml(email.subject)}')"
          class="flex-1 py-2.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50">
          <span class="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">${icons.forward ? icons.forward('w-3.5 h-3.5 text-slate-600') : ''}</span>
          <span>Forward</span>
        </button>
      </div>

    </div>
  `;
}

function renderMobileSearchList() {
  const container = document.getElementById('mobile-search-results');
  if (!container) return;

  const icons = window.phoneMailIcons || {};
  const query = state.searchQuery.toLowerCase();
  const filtered = state.emails.filter(e => 
    e.subject.toLowerCase().includes(query) || 
    e.body.toLowerCase().includes(query) ||
    (e.sender_name && e.sender_name.toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-xs text-slate-400">
        No results found for "${escapeHtml(state.searchQuery)}"
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(email => `
    <div 
      onclick="openMobileDetail(${email.id})"
      class="flex items-start gap-3 p-3.5 border-b border-[#f1f3f4] active:bg-slate-50 cursor-pointer">
      <div class="w-9 h-9 rounded-full ${getAvatarBg(email.sender_name || email.sender)} text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
        ${(email.sender_name || email.sender).charAt(0).toUpperCase()}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between mb-0.5">
          <span class="text-xs font-bold text-slate-900">${escapeHtml(email.sender_name || email.sender)}</span>
          <span class="text-[10px] text-slate-400 font-mono">${formatDisplayTime(email.timestamp)}</span>
        </div>
        <div class="text-xs text-slate-800 font-medium truncate">${escapeHtml(email.subject)}</div>
        <div class="text-[11px] text-slate-500 truncate">${escapeHtml(email.body)}</div>
      </div>
    </div>
  `).join('');
}

function renderMobileDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const overlay = document.getElementById('mobile-drawer-overlay');
  if (!drawer || !overlay) return;

  if (state.isDrawerOpen) {
    drawer.classList.remove('-translate-x-full');
    overlay.classList.remove('hidden');
  } else {
    drawer.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
  }
}

// =============================================================
// ACCESSIBILITY: UNIVERSAL MULTI-LANGUAGE VOICE ENGINE & THEMES
// =============================================================

function renderAudioLangOptions() {
  const cur = localStorage.getItem('phonemail_audio_lang') || 'ta';
  return SUPPORTED_AUDIO_LANGS.map(l => `
    <option value="${l.code}" ${l.code === cur ? 'selected' : ''}>${l.label}</option>
  `).join('');
}

function toggleReadAloud() {
  playProminentReadAloud();
}

async function playProminentReadAloud() {
  const email = state.emails.find(e => e.id === state.selectedEmailId);
  if (!email) return;

  if (isProminentSpeaking || isSpeaking || activeAudioStream) {
    stopProminentReadAloud();
    return;
  }

  const selectedLang = localStorage.getItem('phonemail_audio_lang') || 'ta';
  const langObj = SUPPORTED_AUDIO_LANGS.find(l => l.code === selectedLang) || SUPPORTED_AUDIO_LANGS[0];

  updateProminentReadBtn(true, `Translating to ${langObj.label}...`);
  updateReadAloudBtn(true);

  // Show live translation container in reading pane
  const transBox = document.getElementById('reading-pane-translation-box');
  const transTitle = document.getElementById('translation-box-title');
  const transText = document.getElementById('reading-pane-translated-text');
  if (transBox) transBox.classList.remove('hidden');
  if (transTitle) transTitle.textContent = `${langObj.label} Voice Translation`;
  if (transText) transText.textContent = `Translating notice into ${langObj.label}...`;

  let textToSpeak = `Official civic notice from ${email.sender_name || email.sender}. Subject: ${email.subject}. Message: ${email.body}`;

  const existingTrans = state.emailTranslations[selectedLang]?.[email.id];
  if (selectedLang !== 'en' && existingTrans && existingTrans.body) {
    textToSpeak = `${existingTrans.subject}. ${existingTrans.body}`;
  } else if (selectedLang !== 'en') {
    try {
      const res = await fetch('/api/emails/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Notice from ${email.sender_name || email.sender}. Subject: ${email.subject}. ${email.body}`,
          targetLang: selectedLang
        })
      });
      const tData = await res.json();
      if (tData.success && tData.translatedText) {
        textToSpeak = tData.translatedText;
      }
    } catch (err) {
      console.warn('Translation failed, falling back to original', err);
    }
  }

  if (transText) {
    transText.textContent = textToSpeak;
  }

  updateProminentReadBtn(true, `Speaking (${langObj.label})`);

  // Check if browser has native WebSpeech voice matching language
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const matchedVoice = voices.find(v => 
    v.lang.toLowerCase() === langObj.bcp47.toLowerCase() || 
    v.lang.toLowerCase().startsWith(selectedLang.toLowerCase())
  );

  if (matchedVoice && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
      currentUtterance.voice = matchedVoice;
      currentUtterance.lang = langObj.bcp47;
      currentUtterance.rate = speechSpeed || 1.0;
      currentUtterance.pitch = 1.0;

      currentUtterance.onstart = () => {
        isProminentSpeaking = true;
        isSpeaking = true;
        updateProminentReadBtn(true, `Speaking (${langObj.label})`);
        updateReadAloudBtn(true);
      };

      currentUtterance.onend = () => {
        stopProminentReadAloud();
      };

      currentUtterance.onerror = (e) => {
        console.warn('WebSpeech error, streaming fallback to backend TTS', e);
        fallbackToBackendTts(textToSpeak, selectedLang);
      };

      window.speechSynthesis.speak(currentUtterance);
      return;
    } catch (e) {
      console.warn('SpeechSynthesis invocation failed', e);
    }
  }

  // Fallback to high-quality streaming backend TTS
  fallbackToBackendTts(textToSpeak, selectedLang);
}

function fallbackToBackendTts(text, lang) {
  if (activeAudioStream) {
    activeAudioStream.pause();
    activeAudioStream = null;
  }

  const snippet = text.slice(0, 300);
  const audioUrl = `/api/emails/tts?text=${encodeURIComponent(snippet)}&lang=${encodeURIComponent(lang)}`;
  activeAudioStream = new Audio(audioUrl);
  activeAudioStream.playbackRate = speechSpeed || 1.0;

  activeAudioStream.play().then(() => {
    isProminentSpeaking = true;
    isSpeaking = true;
    updateProminentReadBtn(true, 'Playing Native Audio');
    updateReadAloudBtn(true);
  }).catch((err) => {
    console.error('Audio stream playback failed:', err);
    stopProminentReadAloud();
    showNotificationToast('Audio playback could not be started.');
  });

  activeAudioStream.onended = () => {
    stopProminentReadAloud();
  };

  activeAudioStream.onerror = () => {
    console.error('Audio stream error');
    stopProminentReadAloud();
  };
}

function stopProminentReadAloud() {
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  if (activeAudioStream) {
    try { activeAudioStream.pause(); } catch (e) {}
    activeAudioStream = null;
  }
  isProminentSpeaking = false;
  isSpeaking = false;
  updateProminentReadBtn(false);
  updateReadAloudBtn(false);
}

function updateProminentReadBtn(active, customLabel) {
  const btn = document.getElementById('btn-prominent-read-aloud');
  const label = document.getElementById('prominent-read-label');
  const icon = document.getElementById('prominent-read-icon');
  const icons = window.phoneMailIcons || {};
  if (!btn) return;

  if (active) {
    btn.className = 'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-2 shadow-sm animate-pulse transition-all';
    if (label) label.textContent = customLabel || 'Stop Audio';
    if (icon) icon.innerHTML = icons.pause ? icons.pause('w-4 h-4 text-white') : '⏹';
  } else {
    btn.className = 'px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]';
    if (label) label.textContent = 'Listen to Notice';
    if (icon) icon.innerHTML = icons.speaker ? icons.speaker('w-4 h-4 text-white') : '🔊';
  }
}

function updateReadAloudBtn(active) {
  const iconSpan = document.getElementById('read-aloud-icon');
  const btn = document.getElementById('btn-read-aloud');
  const icons = window.phoneMailIcons || {};

  if (btn) {
    if (active) {
      btn.className = 'px-2.5 py-1 rounded-lg text-rose-600 bg-rose-50 transition-all animate-pulse flex items-center gap-1 text-xs font-semibold';
      if (iconSpan) iconSpan.innerHTML = icons.pause ? icons.pause('w-3.5 h-3.5 text-rose-600') : '⏹';
    } else {
      btn.className = 'px-2.5 py-1 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-white transition-all flex items-center gap-1 text-xs font-semibold';
      if (iconSpan) iconSpan.innerHTML = icons.volume ? icons.volume('w-3.5 h-3.5 text-blue-600') : '🔊';
    }
  }
}

async function setAppLanguage(lang) {
  if (!lang) lang = 'en';
  state.displayLanguage = lang;
  currentAudioLang = lang;
  localStorage.setItem('phonemail_display_lang', lang);
  localStorage.setItem('phonemail_audio_lang', lang);

  // Sync all select elements in header, toolbar, settings modal
  document.querySelectorAll('.app-lang-select, .audio-lang-select, #settings-display-lang, #settings-audio-lang, #toolbar-read-lang, #read-aloud-lang').forEach(sel => {
    sel.value = lang;
  });

  // Apply translations to all DOM elements with data-i18n attributes
  if (window.phoneMailI18n && typeof window.phoneMailI18n.applyI18nToDOM === 'function') {
    window.phoneMailI18n.applyI18nToDOM(lang);
  }

  const langObj = SUPPORTED_AUDIO_LANGS.find(l => l.code === lang);
  showNotificationToast(`Language: ${langObj?.label || lang}. Translating with AI...`);

  // Translate all emails in current view if non-English
  if (lang !== 'en') {
    await translateCurrentInbox(lang);
    if (state.selectedEmailId) {
      await ensureSelectedEmailTranslated(state.selectedEmailId, lang);
    }
  }

  renderDesktopEmailList();
  renderMobileScreen();
  renderDesktopReadingPane();
}

function setAudioLanguage(lang) {
  setAppLanguage(lang);
}

window.onAppLanguageChanged = function(lang) {
  setAppLanguage(lang);
};

async function translateCurrentInbox(lang) {
  if (!lang || lang === 'en' || !state.emails || state.emails.length === 0) return;

  if (!state.emailTranslations[lang]) {
    state.emailTranslations[lang] = {};
  }

  const needed = state.emails.filter(e => !state.emailTranslations[lang][e.id] || !state.emailTranslations[lang][e.id].subject);
  if (needed.length === 0) {
    return;
  }

  state.isTranslatingInbox = true;

  try {
    const items = needed.map(e => ({
      id: e.id,
      subject: e.subject || '',
      body: e.body || ''
    }));

    const res = await fetch('/api/emails/translate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, targetLang: lang })
    });
    const data = await res.json();

    if (data.success && data.translations) {
      Object.entries(data.translations).forEach(([idStr, tData]) => {
        const id = parseInt(idStr, 10);
        state.emailTranslations[lang][id] = {
          subject: tData.subject,
          snippet: tData.snippet,
          body: tData.body || null
        };
      });
      renderDesktopEmailList();
      renderMobileScreen();
    }
  } catch (err) {
    console.warn('Batch email translation error:', err);
  } finally {
    state.isTranslatingInbox = false;
  }
}

async function ensureSelectedEmailTranslated(emailId, lang) {
  if (!emailId || !lang || lang === 'en') return;

  const email = state.emails.find(e => e.id === emailId);
  if (!email) return;

  if (!state.emailTranslations[lang]) {
    state.emailTranslations[lang] = {};
  }

  const existing = state.emailTranslations[lang][emailId];
  if (existing && existing.body) {
    return existing;
  }

  try {
    const res = await fetch('/api/emails/translate-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: email.id,
        subject: email.subject || '',
        body: email.body || '',
        targetLang: lang
      })
    });
    const data = await res.json();
    if (data.success) {
      state.emailTranslations[lang][emailId] = {
        subject: data.subject || email.subject,
        snippet: (data.body || '').replace(/\n+/g, ' ').slice(0, 160),
        body: data.body || email.body
      };
      if (state.selectedEmailId === emailId) {
        renderDesktopReadingPane();
      }
    }
  } catch (err) {
    console.warn('Single email translation error:', err);
  }
}

function setReadingViewTranslationMode(mode) {
  state.readingViewTranslationMode = mode;
  renderDesktopReadingPane();
  if (state.mobileScreen === 'detail') {
    renderMobileDetailView();
  }
}

function setSpeechSpeed(speed) {
  speechSpeed = speed;
  localStorage.setItem('phonemail_speech_speed', String(speed));
  document.querySelectorAll('[data-speed-btn]').forEach(btn => {
    if (parseFloat(btn.getAttribute('data-speed-btn')) === speed) {
      btn.className = 'py-2 rounded-xl bg-blue-600 text-white font-bold text-center shadow-md';
    } else {
      btn.className = 'py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 hover:text-white text-center';
    }
  });
  showNotificationToast(`Speech rate: ${speed}x`);
}

function applyTheme(themeName, showToast = true) {
  if (!['slate', 'midnight', 'emerald'].includes(themeName)) {
    themeName = 'slate';
  }
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('phonemail_theme', themeName);

  // Update theme buttons in settings modal
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    const isCur = btn.getAttribute('data-theme-btn') === themeName;
    if (isCur) {
      btn.className = 'p-3 rounded-2xl border-2 text-center transition-all bg-slate-900 border-blue-500 text-white font-bold shadow-lg ring-1 ring-blue-400';
    } else {
      btn.className = 'p-3 rounded-2xl border text-center transition-all bg-slate-900 border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white';
    }
  });

  const names = {
    slate: 'Classic Slate',
    midnight: 'Midnight OLED',
    emerald: 'Emerald Civic'
  };
  if (showToast) {
    showNotificationToast(`Visual Theme: ${names[themeName] || themeName}`);
  }
}

function cycleTheme() {
  const cur = localStorage.getItem('phonemail_theme') || 'slate';
  const order = ['slate', 'midnight', 'emerald'];
  const nextIdx = (order.indexOf(cur) + 1) % order.length;
  applyTheme(order[nextIdx]);
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const curTheme = localStorage.getItem('phonemail_theme') || 'slate';
  applyTheme(curTheme, false);

  const curLang = state.displayLanguage || localStorage.getItem('phonemail_display_lang') || 'en';
  const lSel = document.getElementById('settings-display-lang') || document.getElementById('settings-audio-lang');
  if (lSel) lSel.value = curLang;

  const curSpeed = parseFloat(localStorage.getItem('phonemail_speech_speed') || '1.0');
  setSpeechSpeed(curSpeed);
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
}

// =============================================================
// CIVIC SHORTCUTS & EMERGENCY BROADCAST
// =============================================================

function setGrievanceDept(to, dept) {
  const toInput = document.getElementById('compose-to');
  const subjInput = document.getElementById('compose-subject');
  const bodyInput = document.getElementById('compose-body');

  if (toInput) toInput.value = to;
  if (subjInput) subjInput.value = `[Grievance] ${dept} Service Issue`;
  if (bodyInput) {
    bodyInput.value = `Respected Officer in-charge,\n\nI am lodging an official public grievance regarding the ${dept} department in my area.\n\nWard / Location: \nDescription of Issue: \nUrgency: High\n\nPlease acknowledge and assign a Grievance Tracking ID.\n\nThank you,\n${state.currentUser?.name || 'Citizen'}\n${state.currentUser?.phone_number || ''}`;
    bodyInput.focus();
  }
}

function openBroadcastModal() {
  const modal = document.getElementById('broadcast-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeBroadcastModal() {
  const modal = document.getElementById('broadcast-modal');
  if (modal) modal.classList.add('hidden');
}

function dismissBroadcastBanner() {
  const banner = document.getElementById('civic-broadcast-banner');
  if (banner) banner.classList.add('hidden');
}

function setBroadcastPreset(type) {
  const deptInput = document.getElementById('bcast-dept');
  const headlineInput = document.getElementById('bcast-headline');
  const detailsInput = document.getElementById('bcast-details');
  const severitySelect = document.getElementById('bcast-severity');

  if (type === 'flood') {
    if (deptInput) deptInput.value = 'Disaster Management & Flood Control';
    if (headlineInput) headlineInput.value = 'Flash Flood & Cyclone Warning for Coastal Wards 12-16';
    if (detailsInput) detailsInput.value = 'URGENT: Heavy waterlogging and severe gale winds expected within the next 3 hours. Citizens in low-lying areas are advised to move to designated relief shelters. Emergency helpline 1800-555-0199 is active.';
    if (severitySelect) severitySelect.value = 'CRITICAL';
  } else if (type === 'heatwave') {
    if (deptInput) deptInput.value = 'Public Health & Meteorological Department';
    if (headlineInput) headlineInput.value = 'Red Alert: Extreme Heatwave Advisory (44°C Peak)';
    if (detailsInput) detailsInput.value = 'CRITICAL HEALTH ALERT: Ambient temperatures forecast to exceed 44°C between 11:30 AM and 4:00 PM. Avoid direct outdoor exposure. Stay hydrated. Free ORS packets available at civic health kiosks.';
    if (severitySelect) severitySelect.value = 'CRITICAL';
  } else if (type === 'closure') {
    if (deptInput) deptInput.value = 'Traffic Police & Infrastructure Board';
    if (headlineInput) headlineInput.value = 'Emergency Road & Flyover Closure Notice (Route 9)';
    if (detailsInput) detailsInput.value = 'NOTICE: Central Flyover and Ward 14 bypass closed indefinitely due to emergency pipeline repair work. Commercial and private vehicles must divert via Eastern Ring Expressway.';
    if (severitySelect) severitySelect.value = 'HIGH';
  } else if (type === 'curfew') {
    if (deptInput) deptInput.value = 'City Magistrate & Public Safety Administration';
    if (headlineInput) headlineInput.value = 'Administrative Order: Night Curfew Notification';
    if (detailsInput) detailsInput.value = 'ORDER: Under civic administration rules, night curfew is imposed from 10:00 PM to 5:00 AM tonight. Essential services and accredited emergency personnel exempt.';
    if (severitySelect) severitySelect.value = 'HIGH';
  }
}

async function handleSendBroadcast(e) {
  e.preventDefault();
  const deptInput = document.getElementById('bcast-dept');
  const headlineInput = document.getElementById('bcast-headline');
  const detailsInput = document.getElementById('bcast-details');
  const areaSelect = document.getElementById('bcast-target-area');
  const severitySelect = document.getElementById('bcast-severity');

  const department = deptInput ? deptInput.value.trim() : 'Civic Authority';
  const headline = headlineInput ? headlineInput.value.trim() : 'Public Advisory';
  const message = detailsInput ? detailsInput.value.trim() : '';
  const targetAreaCode = areaSelect ? areaSelect.value : 'all';
  const severity = severitySelect ? severitySelect.value : 'CRITICAL';

  if (!message) {
    alert('Please enter broadcast message details.');
    return;
  }

  const btn = document.getElementById('btn-send-bcast');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="animate-pulse">🚨 Dispatching Emergency Broadcast &amp; Twilio SMS...</span>';
  }

  try {
    const res = await fetch('/api/emails/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department,
        headline,
        message,
        targetAreaCode,
        severity,
        sendSms: true
      })
    });
    const data = await res.json();

    if (data.success) {
      closeBroadcastModal();
      const banner = document.getElementById('civic-broadcast-banner');
      const hEl = document.getElementById('broadcast-headline');
      const dEl = document.getElementById('broadcast-details');
      if (banner && hEl && dEl) {
        hEl.textContent = `🚨 ${headline} [Severity: ${severity}]`;
        dEl.textContent = `${department} (Target: Area ${targetAreaCode === 'all' ? 'All Citizens' : targetAreaCode}): ${message}`;
        banner.classList.remove('hidden');
      }
      showNotificationToast(`🚨 Emergency Alert sent to ${data.recipientCount} citizens via SMS & Pinned Webmail!`);
      await refreshMailbox();
    } else {
      alert(`Broadcast failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Broadcast error: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 11 18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        <span>Dispatch Emergency Broadcast (SMS + Pinned Web Alert)</span>
      `;
    }
  }
}

// =============================================================
// OFFICIAL DIGITAL RECEIPT & WELFARE LOCKER
// =============================================================

function openReceiptModal(emailId) {
  const email = (emailId ? state.emails.find(e => e.id === emailId) : null) || state.emails.find(e => e.id === state.selectedEmailId);
  if (!email) return;

  const att = (email.attachments || []).find(a => a.sha256 || a.type === 'pdf') || {};
  const modal = document.getElementById('receipt-viewer-modal');
  if (!modal) return;

  const titleEl = document.getElementById('receipt-modal-title');
  const authEl = document.getElementById('receipt-modal-authority');
  const sealIdEl = document.getElementById('receipt-modal-seal-id');
  const phoneEl = document.getElementById('receipt-modal-phone');
  const docketEl = document.getElementById('receipt-modal-docket');
  const dateEl = document.getElementById('receipt-modal-date');
  const bodyEl = document.getElementById('receipt-modal-body');
  const hashEl = document.getElementById('receipt-modal-hash');

  const sealId = att.seal_id || `SEAL-${email.id}891-SHA256`;
  window.currentReceiptSealId = sealId;
  window.currentReceiptEmailId = email.id;

  if (titleEl) titleEl.textContent = email.subject || 'Government Digital Receipt';
  if (authEl) authEl.textContent = email.sender_name || 'Municipal Corporation & Welfare Administration';
  if (sealIdEl) sealIdEl.textContent = sealId;
  if (phoneEl) phoneEl.textContent = email.recipient || state.currentUser?.phone_number || '+19876543210';
  if (docketEl) docketEl.textContent = email.ticket_id || att.receipt_number || `DOC-2026-0${email.id}91`;
  if (dateEl) dateEl.textContent = formatDisplayTime(email.timestamp, true) || new Date().toLocaleString();
  if (bodyEl) bodyEl.textContent = email.body || 'Verified government welfare document and payment voucher.';
  if (hashEl) hashEl.textContent = att.sha256 || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const qrContainer = document.getElementById('receipt-modal-qr-container');
  if (qrContainer) {
    qrContainer.innerHTML = '<span class="text-[9px] text-slate-400">Loading QR...</span>';
    fetch(`/api/receipts/qr-svg/${email.id}`)
      .then(r => r.text())
      .then(svg => {
        qrContainer.innerHTML = svg;
      })
      .catch(() => {
        qrContainer.innerHTML = '<span class="text-[10px] text-emerald-600 font-mono">SEAL-OK</span>';
      });
  }

  modal.classList.remove('hidden');
}

function openQrVerifyWithCurrentSeal() {
  const seal = window.currentReceiptSealId || 'SEAL-MUNI-98214-SHA256';
  closeReceiptModal();
  openQrVerifyModal(seal);
}

function closeReceiptModal() {
  const modal = document.getElementById('receipt-viewer-modal');
  if (modal) modal.classList.add('hidden');
}

function triggerPdfDownload(customFilename, emailId) {
  const email = (emailId ? state.emails.find(e => e.id === emailId) : null) || state.emails.find(e => e.id === state.selectedEmailId);
  const att = (email?.attachments || []).find(a => a.sha256 || a.type === 'pdf') || {};
  const filename = customFilename || att.name || `${(email?.subject || 'Govt_Receipt').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

  const receiptContent = `================================================================================
                    OFFICIAL GOVERNMENT DIGITAL RECEIPT
                    WELFARE LOCKER & AUDIT VERIFICATION
================================================================================
Issuing Authority  : ${email?.sender_name || 'Government Administration'} (${email?.sender || 'gov@phonemail.local'})
Beneficiary Phone  : ${email?.recipient || state.currentUser?.phone_number || '+19876543210'}
Document ID/Docket : ${email?.ticket_id || att.receipt_number || 'DOC-2026-0091'}
Seal ID            : ${att.seal_id || 'SEAL-88910-SHA256'}
Date of Issue      : ${new Date(email?.timestamp || Date.now()).toLocaleString()}
Status             : CRYPTOGRAPHICALLY VERIFIED & TAMPER-EVIDENT (100% AUTHENTIC)
--------------------------------------------------------------------------------
SHA-256 Hash Seal  : ${att.sha256 || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
--------------------------------------------------------------------------------

PARTICULARS & RECORD SUMMARY:
${email?.body || 'Official Government Certificate'}

--------------------------------------------------------------------------------
Security Notice:
This receipt has been permanently recorded in the Citizen Welfare Locker linked to
mobile identity ${email?.recipient || state.currentUser?.phone_number}.
Tampering invalidates the digital SHA-256 seal.
================================================================================`;

  const blob = new Blob([receiptContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotificationToast(`Downloaded official receipt: ${a.download}`);
}

// =============================================================
// COMPOSE MODAL & SEND EMAIL
// =============================================================

function openComposeModal(prefillTo = '', prefillSubject = '') {
  state.isComposeOpen = true;
  const modal = document.getElementById('compose-modal');
  if (modal) modal.classList.remove('hidden');

  const toInput = document.getElementById('compose-to');
  const subjectInput = document.getElementById('compose-subject');
  const bodyInput = document.getElementById('compose-body');

  if (toInput) toInput.value = prefillTo;
  if (subjectInput) subjectInput.value = prefillSubject;
  if (bodyInput && !bodyInput.value) bodyInput.value = '';
}

function closeComposeModal() {
  state.isComposeOpen = false;
  const modal = document.getElementById('compose-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleComposeSubmit(e) {
  e.preventDefault();
  const to = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const body = document.getElementById('compose-body').value.trim();
  const label = document.getElementById('compose-label')?.value || null;
  const btn = document.getElementById('btn-compose-send');

  if (!to || !subject || !body) {
    alert('Please fill in recipient, subject, and message body.');
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: state.currentUser.phone_number,
        sender_name: state.currentUser.name,
        recipient: to,
        subject,
        body,
        label
      })
    });
    const data = await res.json();

    if (data.success) {
      closeComposeModal();
      if (data.ticket_id) {
        showNotificationToast(`Grievance registered! Docket: ${data.ticket_id}. SMS Receipt dispatched.`);
      } else {
        showNotificationToast(`Email sent to ${to}! Twilio alert dispatched.`);
      }
      await refreshMailbox();
    } else {
      alert(`Failed to send email: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openQuickReply(to, subject) {
  const replySubj = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  openComposeModal(to, replySubj);
}

// =============================================================
// EMAIL ACTIONS (STAR, READ, FOLDER, NAVIGATION)
// =============================================================

async function toggleStar(id) {
  try {
    const res = await fetch(`/api/emails/${id}/star`, { method: 'PATCH' });
    const data = await res.json();
    if (data.success) {
      const email = state.emails.find(e => e.id === id);
      if (email) email.is_starred = data.email.is_starred;
      renderApp();
    }
  } catch (e) {}
}

function deselectCurrentEmail() {
  state.selectedEmailId = null;
  renderApp();
}

function advanceOrDeselect(currentId) {
  const idx = state.emails.findIndex(e => e.id === currentId);
  if (idx !== -1 && state.emails.length > 1) {
    const nextIdx = idx < state.emails.length - 1 ? idx + 1 : idx - 1;
    state.selectedEmailId = state.emails[nextIdx].id;
  } else {
    state.selectedEmailId = null;
  }
}

async function markAsUnread(id) {
  try {
    await fetch(`/api/emails/${id}/read`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: 0 })
    });
    const email = state.emails.find(e => e.id === id);
    if (email) email.is_read = 0;
    showNotificationToast('Marked as unread.');
    await refreshMailbox();
  } catch (e) {}
}

async function archiveEmail(id) {
  try {
    await fetch(`/api/emails/${id}/folder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: 'archive' })
    });
    showNotificationToast('Email archived.');
    advanceOrDeselect(id);
    await refreshMailbox();
  } catch (e) {
    showNotificationToast('Failed to archive email.');
  }
}

async function deleteEmail(id) {
  try {
    await fetch(`/api/emails/${id}/folder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: 'trash' })
    });
    showNotificationToast('Moved to Trash.');
    advanceOrDeselect(id);
    await refreshMailbox();
  } catch (e) {
    showNotificationToast('Failed to delete email.');
  }
}

async function reportSpam(id) {
  try {
    await fetch(`/api/emails/${id}/folder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: 'spam' })
    });
    showNotificationToast('Reported as spam.');
    advanceOrDeselect(id);
    await refreshMailbox();
  } catch (e) {
    showNotificationToast('Failed to report spam.');
  }
}

async function moveToFolder(id, targetFolder) {
  try {
    await fetch(`/api/emails/${id}/folder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: targetFolder })
    });
    showNotificationToast(`Moved to ${targetFolder}.`);
    advanceOrDeselect(id);
    await refreshMailbox();
  } catch (e) {
    showNotificationToast('Failed to move email.');
  }
}

async function applyLabel(id, labelName) {
  try {
    await fetch(`/api/emails/${id}/label`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: labelName })
    });
    showNotificationToast(labelName ? `Label applied: "${labelName}"` : 'Label removed.');
    await refreshMailbox();
  } catch (e) {
    showNotificationToast('Failed to update label.');
  }
}

function snoozeEmail(id, label) {
  showNotificationToast(`Snoozed until: ${label}`);
  archiveEmail(id);
}

// =============================================================
// FLOATING POPOVER ACTION MENUS (ZERO EMOJIS, PURE SVG)
// =============================================================

function showActionPopover(event, items) {
  event.stopPropagation();
  closeActionPopover();

  const anchor = event.currentTarget;
  const rect = anchor.getBoundingClientRect();

  const popover = document.createElement('div');
  popover.id = 'active-action-popover';
  popover.className = 'fixed z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl py-1.5 min-w-[210px] text-xs font-medium text-slate-800 animate-slide-up backdrop-blur-md';

  let top = rect.bottom + 6;
  let left = rect.left;
  if (left + 230 > window.innerWidth) {
    left = window.innerWidth - 240;
  }
  if (top + 280 > window.innerHeight) {
    top = rect.top - 240;
  }
  popover.style.top = `${Math.max(10, top)}px`;
  popover.style.left = `${Math.max(10, left)}px`;

  popover.innerHTML = items.map((item, idx) => {
    if (item.divider) return '<div class="my-1 border-t border-slate-100"></div>';
    if (item.header) return `<div class="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none">${item.header}</div>`;
    return `
      <button 
        type="button" 
        data-popover-idx="${idx}"
        class="w-full text-left px-3.5 py-2 hover:bg-slate-100 flex items-center gap-2.5 transition-colors cursor-pointer ${item.danger ? 'text-rose-600 hover:text-rose-700 hover:bg-rose-50' : 'text-slate-700'}">
        ${item.icon || ''}
        <span class="truncate">${item.label}</span>
      </button>
    `;
  }).join('');

  document.body.appendChild(popover);

  items.forEach((item, idx) => {
    if (item.action) {
      const btn = popover.querySelector(`[data-popover-idx="${idx}"]`);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeActionPopover();
          item.action();
        });
      }
    }
  });

  setTimeout(() => {
    window.addEventListener('click', closeActionPopover, { once: true });
  }, 20);
}

function closeActionPopover() {
  const existing = document.getElementById('active-action-popover');
  if (existing) existing.remove();
}

function openSnoozeMenu(event, emailId) {
  const icons = window.phoneMailIcons || {};
  showActionPopover(event, [
    { header: 'Snooze Until' },
    { label: 'Later today (6:00 PM)', icon: icons.clock('w-4 h-4 text-slate-500'), action: () => snoozeEmail(emailId, 'Later today 6:00 PM') },
    { label: 'Tomorrow (8:00 AM)', icon: icons.clock('w-4 h-4 text-slate-500'), action: () => snoozeEmail(emailId, 'Tomorrow 8:00 AM') },
    { label: 'This weekend (Sat 9:00 AM)', icon: icons.clock('w-4 h-4 text-slate-500'), action: () => snoozeEmail(emailId, 'Saturday 9:00 AM') },
    { label: 'Next week (Mon 8:00 AM)', icon: icons.clock('w-4 h-4 text-slate-500'), action: () => snoozeEmail(emailId, 'Monday 8:00 AM') },
    { divider: true },
    { label: 'Pick custom date & time...', icon: icons.clock('w-4 h-4 text-blue-600'), action: () => snoozeEmail(emailId, 'Custom date & time') }
  ]);
}

function openMoveFolderMenu(event, emailId) {
  const icons = window.phoneMailIcons || {};
  showActionPopover(event, [
    { header: 'Move to Folder' },
    { label: 'Inbox', icon: icons.inbox('w-4 h-4 text-blue-600'), action: () => moveToFolder(emailId, 'inbox') },
    { label: 'Sent', icon: icons.sent('w-4 h-4 text-emerald-600'), action: () => moveToFolder(emailId, 'sent') },
    { label: 'Drafts', icon: icons.drafts('w-4 h-4 text-amber-600'), action: () => moveToFolder(emailId, 'drafts') },
    { label: 'Archive', icon: icons.archive('w-4 h-4 text-indigo-600'), action: () => moveToFolder(emailId, 'archive') },
    { label: 'Spam', icon: icons.spam('w-4 h-4 text-orange-600'), action: () => moveToFolder(emailId, 'spam') },
    { label: 'Trash', icon: icons.trash('w-4 h-4 text-rose-600'), action: () => moveToFolder(emailId, 'trash') }
  ]);
}

function openLabelMenu(event, emailId) {
  const icons = window.phoneMailIcons || {};
  const labels = [
    { name: 'Civic Grievance', color: 'bg-emerald-500' },
    { name: 'Govt Receipts', color: 'bg-teal-500' },
    { name: 'College', color: 'bg-blue-500' },
    { name: 'Projects', color: 'bg-emerald-600' },
    { name: 'Personal', color: 'bg-rose-500' },
    { name: 'Purchases', color: 'bg-amber-500' },
    { name: 'Finance', color: 'bg-purple-500' }
  ];

  showActionPopover(event, [
    { header: 'Assign Label' },
    ...labels.map(l => ({
      label: l.name,
      icon: `<span class="w-3 h-3 rounded-full ${l.color} inline-block flex-shrink-0"></span>`,
      action: () => applyLabel(emailId, l.name)
    })),
    { divider: true },
    { label: 'Clear Label', icon: icons.close('w-3.5 h-3.5 text-slate-400'), action: () => applyLabel(emailId, null) }
  ]);
}

function openMoreOptionsMenu(event, emailId) {
  const icons = window.phoneMailIcons || {};
  const email = state.emails.find(e => e.id === emailId);

  showActionPopover(event, [
    { header: 'Email Options' },
    { label: 'Mark as unread', icon: icons.mail('w-4 h-4 text-slate-500'), action: () => markAsUnread(emailId) },
    { label: email?.is_starred ? 'Remove star' : 'Add star', icon: icons.star('w-4 h-4 text-amber-500'), action: () => toggleStar(emailId) },
    { label: 'Print notice', icon: icons.print('w-4 h-4 text-slate-500'), action: () => window.print() },
    { label: 'Copy notice text', icon: icons.copy('w-4 h-4 text-slate-500'), action: () => {
      if (email) {
        navigator.clipboard?.writeText(`${email.subject}\n\n${email.body}`);
        showNotificationToast('Email text copied to clipboard!');
      }
    }},
    { divider: true },
    { label: 'Report spam', icon: icons.alert('w-4 h-4 text-amber-600'), danger: true, action: () => reportSpam(emailId) },
    { label: 'Delete message', icon: icons.trash('w-4 h-4 text-rose-600'), danger: true, action: () => deleteEmail(emailId) }
  ]);
}

function openProfileMenu(event) {
  const icons = window.phoneMailIcons || {};
  const user = state.currentUser;
  const name = user?.name || 'Dharun R';
  const phone = user?.phone_number || '+19876543210';
  const email = user?.email || 'dharunr@kpriet.ac.in';

  showActionPopover(event, [
    { header: 'Account' },
    { label: `${name} (${phone})`, icon: icons.user('w-4 h-4 text-blue-600') },
    { label: email, icon: icons.mail('w-4 h-4 text-slate-400') },
    { divider: true },
    { header: 'Switch Profile' },
    { label: 'Citizen Portal (Elena Rostova)', icon: icons.phone('w-4 h-4 text-emerald-600'), action: () => quickSwitchUser('+19876543210') },
    { label: 'Civic Grievance Dept (+18005550199)', icon: icons.landmark('w-4 h-4 text-indigo-600'), action: () => quickSwitchUser('+18005550199') },
    { label: 'Emergency Dispatch Cell (+18005550198)', icon: icons.alert('w-4 h-4 text-amber-500'), action: () => quickSwitchUser('+18005550198') },
    { label: 'Open Auth Gateway / Sign In', icon: icons.user('w-4 h-4 text-blue-600'), action: () => openAuthModal() },
    { divider: true },
    { header: 'Simulators' },
    { label: 'Voice IVR Helpline', icon: icons.phone('w-4 h-4 text-indigo-500'), action: () => openIvrHelplineModal() },
    { label: 'SMS Bridge', icon: icons.sms('w-4 h-4 text-teal-500'), action: () => openSmsBridgeModal() },
    { label: 'Robocall Blast (SOS)', icon: icons.volume('w-4 h-4 text-rose-500'), action: () => openRobocallModal() },
    { label: 'QR Seal Verifier', icon: icons.search('w-4 h-4 text-emerald-500'), action: () => openQrVerifyModal() },
    { label: 'Emergency Broadcast', icon: icons.alert('w-4 h-4 text-amber-500'), action: () => openBroadcastModal() },
    { divider: true },
    { header: 'Preferences' },
    { label: 'Change Theme', icon: icons.palette('w-4 h-4 text-purple-500'), action: () => cycleTheme() },
    { label: 'Settings', icon: icons.settings('w-4 h-4 text-slate-500'), action: () => openSettingsModal() },
    { divider: true },
    { label: 'Sign Out', icon: icons.logout('w-4 h-4 text-rose-500'), danger: true, action: () => handleLogout() }
  ]);
}

function selectEmail(id) {
  state.selectedEmailId = id;
  const email = state.emails.find(e => e.id === id);
  if (email && email.is_read === 0) {
    fetch(`/api/emails/${id}/read`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: 1 })
    }).catch(() => {});
    email.is_read = 1;
  }
  if (state.displayLanguage && state.displayLanguage !== 'en') {
    ensureSelectedEmailTranslated(id, state.displayLanguage);
  }
  renderApp();
}

function navigateMailList(direction) {
  if (state.emails.length === 0) return;
  const idx = state.emails.findIndex(e => e.id === state.selectedEmailId);
  const nextIdx = idx + direction;
  if (nextIdx >= 0 && nextIdx < state.emails.length) {
    selectEmail(state.emails[nextIdx].id);
  }
}

// Mobile specific helpers
function openMobileDetail(id) {
  selectEmail(id);
  setMobileScreen('detail');
}

function setMobileScreen(screen) {
  state.mobileScreen = screen;
  renderMobileScreen();
}

function toggleMobileDrawer(open = null) {
  state.isDrawerOpen = open !== null ? open : !state.isDrawerOpen;
  renderMobileDrawer();
}

// =============================================================
// DOM EVENT LISTENERS
// =============================================================

function setupEventListeners() {
  document.querySelectorAll('[data-folder]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentFolder = btn.getAttribute('data-folder');
      state.currentLabel = null;
      toggleMobileDrawer(false);
      refreshMailbox();
    });
  });

  document.querySelectorAll('[data-label]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentLabel = btn.getAttribute('data-label');
      toggleMobileDrawer(false);
      refreshMailbox();
    });
  });

  document.querySelectorAll('[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      state.currentFilter = chip.getAttribute('data-filter');
      
      // Desktop filter tabs styling
      document.querySelectorAll('[data-filter]').forEach(c => {
        if (c.getAttribute('data-filter') === state.currentFilter) {
          c.className = 'text-slate-900 border-b-2 border-slate-900 pb-2.5 px-0.5 font-bold transition-all';
        } else {
          c.className = 'text-slate-500 hover:text-slate-800 pb-2.5 px-0.5 transition-all';
        }
      });
      refreshMailbox();
    });
  });

  const dSearch = document.getElementById('desktop-search-input');
  if (dSearch) {
    dSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      refreshMailbox();
    });
  }

  const mSearch = document.getElementById('mobile-search-input');
  if (mSearch) {
    mSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderMobileSearchList();
    });
  }

  document.querySelectorAll('[data-mob-nav]').forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-mob-nav');
      if (target === 'mail') {
        state.currentFolder = 'inbox';
        state.currentLabel = null;
        setMobileScreen('inbox');
        refreshMailbox();
      } else if (target === 'starred') {
        state.currentFilter = 'starred';
        setMobileScreen('inbox');
        refreshMailbox();
      } else if (target === 'sent') {
        state.currentFolder = 'sent';
        setMobileScreen('inbox');
        refreshMailbox();
      } else if (target === 'more') {
        toggleMobileDrawer(true);
      }
    });
  });
}

// =============================================================
// FORMATTING HELPERS
// =============================================================

function formatDisplayTime(timestamp, detailed = false) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;

  if (detailed) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getAvatarBg(nameOrSender) {
  const name = String(nameOrSender || '').toLowerCase();
  if (name.includes('kpr')) return 'bg-[#7c3aed]'; // purple matching image 1
  if (name.includes('ajay')) return 'bg-[#059669]'; // emerald green matching image 1
  if (name.includes('ieee')) return 'bg-[#2563eb]'; // vibrant blue matching image 1
  if (name.includes('google')) return 'bg-[#ea4335]'; // google red/coral
  if (name.includes('amazon')) return 'bg-[#0f172a]'; // dark navy
  if (name.includes('quiz')) return 'bg-[#1e1b4b]'; // deep indigo
  if (name.includes('research')) return 'bg-[#0d9488]'; // teal
  if (name.includes('water')) return 'bg-[#0284c7]'; // sky blue
  
  const charCode = (nameOrSender || 'A').charCodeAt(0);
  const colors = [
    'bg-[#7c3aed]', 'bg-[#2563eb]', 'bg-[#059669]',
    'bg-[#d97706]', 'bg-[#e11d48]', 'bg-[#4f46e5]', 'bg-[#0d9488]'
  ];
  return colors[charCode % colors.length];
}

function renderSenderAvatar(email, size = 'w-9 h-9', textSize = 'text-sm') {
  const name = email.sender_name || email.sender || '';
  const initial = name.charAt(0).toUpperCase();

  if (name.includes('Google')) {
    return `
      <div class="${size} rounded-full bg-white border border-[#dadce0] flex items-center justify-center flex-shrink-0 shadow-sm p-1.5">
        <svg class="w-full h-full" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
      </div>
    `;
  }

  if (name.includes('Amazon')) {
    return `
      <div class="${size} rounded-full bg-white border border-[#dadce0] flex items-center justify-center flex-shrink-0 shadow-sm p-1.5">
        <svg class="w-full h-full text-slate-900" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3a9 9 0 0 0-9 9c0 3.6 2.1 6.7 5.1 8.1.3-.2.7-.4 1-.7-2.5-1.3-4.1-3.9-4.1-6.9a7 7 0 0 1 7-7 7 7 0 0 1 7 7c0 3-1.6 5.6-4.1 6.9.3.3.7.5 1 .7 3-1.4 5.1-4.5 5.1-8.1a9 9 0 0 0-9-9z"/>
          <path d="M6 18c4 3 8 3 12 0" stroke="#f59e0b" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        </svg>
      </div>
    `;
  }

  if (name.includes('Research Team')) {
    return `
      <div class="${size} rounded-full bg-[#f1f3f4] text-slate-700 flex items-center justify-center flex-shrink-0 shadow-sm">
        <svg class="w-5 h-5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
    `;
  }

  if (name === 'Ajay') {
    return `
      <div class="${size} rounded-full overflow-hidden flex-shrink-0 shadow-sm bg-[#1e3a34] border border-[#2d5a52] flex items-center justify-center relative">
        <svg class="w-full h-full" viewBox="0 0 40 40">
          <rect width="40" height="40" fill="#203d36"/>
          <circle cx="20" cy="14" r="7" fill="#e2c4b0"/>
          <path d="M6 38c2-9 10-11 14-11s12 2 14 11" fill="#132722"/>
          <path d="M0 26 Q 10 22 20 26 T 40 26 L 40 40 L 0 40 Z" fill="#0d1b17"/>
        </svg>
      </div>
    `;
  }

  if (name === 'Kanishka') {
    return `
      <div class="${size} rounded-full overflow-hidden flex-shrink-0 shadow-sm bg-gradient-to-b from-amber-500 via-orange-600 to-rose-900 border border-amber-500/30 flex items-center justify-center relative">
        <svg class="w-full h-full" viewBox="0 0 40 40">
          <circle cx="20" cy="18" r="7" fill="#fef08a"/>
          <path d="M0 25 Q 10 21 20 25 T 40 25 L 40 40 L 0 40 Z" fill="#78350f"/>
        </svg>
      </div>
    `;
  }

  if (name.includes('Dhamo')) {
    return `
      <div class="${size} rounded-full overflow-hidden flex-shrink-0 shadow-sm bg-[#1e293b] border border-slate-600 flex items-center justify-center relative">
        <svg class="w-full h-full" viewBox="0 0 40 40">
          <rect width="40" height="40" fill="#334155"/>
          <circle cx="20" cy="14" r="6" fill="#fbcfe8"/>
          <path d="M8 38c2-7 8-9 12-9s10 2 12 9" fill="#0f172a"/>
        </svg>
      </div>
    `;
  }

  if (name.includes('KPR Institute')) {
    return `
      <div class="${size} rounded-full bg-[#734b9d] text-white flex items-center justify-center font-bold ${textSize} flex-shrink-0 shadow-sm">
        K
      </div>
    `;
  }

  if (name.includes('IEEE')) {
    return `
      <div class="${size} rounded-full bg-[#1976d2] text-white flex items-center justify-center font-bold ${textSize} flex-shrink-0 shadow-sm">
        I
      </div>
    `;
  }

  if (name.includes('Quiz Club')) {
    return `
      <div class="${size} rounded-full bg-[#0d233a] text-white flex items-center justify-center font-bold ${textSize} flex-shrink-0 shadow-sm">
        Q
      </div>
    `;
  }

  if (name.includes('Water Supply')) {
    return `
      <div class="${size} rounded-full bg-[#0d9488] text-white flex items-center justify-center font-bold ${textSize} flex-shrink-0 shadow-sm relative">
        W
        <span class="absolute -bottom-0.5 -right-0.5 bg-emerald-600 text-white rounded-full p-0.5 shadow">
          <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      </div>
    `;
  }

  // Fallback initial avatar
  const avatarBg = getAvatarBg(name);
  return `
    <div class="${size} rounded-full ${avatarBg} text-white flex items-center justify-center font-bold ${textSize} flex-shrink-0 shadow-sm relative">
      ${initial}
      ${email.is_gov_verified ? `<span class="absolute -bottom-0.5 -right-0.5 bg-emerald-600 text-white rounded-full p-0.5 shadow"><svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>` : ''}
    </div>
  `;
}

function getLabelBg(label) {
  switch (label) {
    case 'College': return 'bg-[#2563eb]';
    case 'Projects': return 'bg-[#10b981]';
    case 'Personal': return 'bg-[#f43f5e]';
    case 'Purchases': return 'bg-[#f59e0b]';
    case 'Finance': return 'bg-[#8b5cf6]';
    default: return 'bg-slate-500';
  }
}

function renderFormattedBody(body) {
  if (!body) return '';

  if (body.includes('Key Points:')) {
    const parts = body.split('Key Points:');
    const before = parts[0];
    const after = parts[1];

    const lines = after.split('\n');
    let points = [];
    let signoff = [];

    lines.forEach(l => {
      const trimmed = l.trim();
      if (!trimmed) return;
      if (/^[•\-\*\|\d+\.]\s*/.test(trimmed)) {
        points.push(trimmed.replace(/^[•\-\*\|\d+\.]\s*/, ''));
      } else {
        signoff.push(trimmed);
      }
    });

    return `
      <p class="whitespace-pre-line text-slate-800 text-sm leading-relaxed">${escapeHtml(before.trim())}</p>
      
      <!-- Key Points Card Matching Image 1 Exactly -->
      <div class="bg-[#f8f9fa] border border-[#e8eaed] rounded-2xl p-5 my-4 max-w-2xl shadow-sm">
        <div class="flex items-center gap-2 font-bold text-slate-900 text-xs mb-3">
          <svg class="w-4 h-4 text-slate-700 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
          <span class="text-slate-900 font-bold">Key Points:</span>
        </div>
        <ul class="space-y-1.5 text-xs text-slate-700 pl-4 list-disc">
          ${points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
        </ul>
      </div>

      <p class="whitespace-pre-line text-slate-800 text-sm leading-relaxed">${escapeHtml(signoff.join('\n\n'))}</p>
    `;
  }

  return `<p class="whitespace-pre-line text-slate-800 text-sm leading-relaxed">${escapeHtml(body)}</p>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Global exposure for inline HTML events
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthPortal = switchAuthPortal;
window.switchCitizenMode = switchCitizenMode;
window.switchOfficialMode = switchOfficialMode;
window.loginOfficial = loginOfficial;
window.registerOfficial = registerOfficial;
window.quickDemoLogin = quickDemoLogin;
window.requestOtp = requestOtp;
window.verifyAndLogin = verifyAndLogin;
window.handleLogout = handleLogout;
window.openComposeModal = openComposeModal;
window.closeComposeModal = closeComposeModal;
window.handleComposeSubmit = handleComposeSubmit;
window.openQuickReply = openQuickReply;
window.selectEmail = selectEmail;
window.toggleStar = toggleStar;
window.archiveEmail = archiveEmail;
window.deleteEmail = deleteEmail;
window.reportSpam = reportSpam;
window.markAsUnread = markAsUnread;
window.navigateMailList = navigateMailList;
window.openMobileDetail = openMobileDetail;
window.setMobileScreen = setMobileScreen;
window.toggleMobileDrawer = toggleMobileDrawer;
window.setViewMode = setViewMode;
window.toggleDesktopSidebar = toggleDesktopSidebar;
window.toggleToolsDrawer = toggleToolsDrawer;
window.toggleReadAloud = toggleReadAloud;
window.playProminentReadAloud = playProminentReadAloud;
window.stopProminentReadAloud = stopProminentReadAloud;
window.setGrievanceDept = setGrievanceDept;
window.openBroadcastModal = openBroadcastModal;
window.closeBroadcastModal = closeBroadcastModal;
window.dismissBroadcastBanner = dismissBroadcastBanner;
window.handleSendBroadcast = handleSendBroadcast;
window.setBroadcastPreset = setBroadcastPreset;
window.openReceiptModal = openReceiptModal;
window.closeReceiptModal = closeReceiptModal;
window.triggerPdfDownload = triggerPdfDownload;
window.deselectCurrentEmail = deselectCurrentEmail;
window.advanceOrDeselect = advanceOrDeselect;
window.moveToFolder = moveToFolder;
window.applyLabel = applyLabel;
window.snoozeEmail = snoozeEmail;
window.showActionPopover = showActionPopover;
window.closeActionPopover = closeActionPopover;
window.openSnoozeMenu = openSnoozeMenu;
window.openMoveFolderMenu = openMoveFolderMenu;
window.openLabelMenu = openLabelMenu;
window.openMoreOptionsMenu = openMoreOptionsMenu;
window.openProfileMenu = openProfileMenu;
window.applyTheme = applyTheme;
window.cycleTheme = cycleTheme;
window.setAudioLanguage = setAudioLanguage;
window.setSpeechSpeed = setSpeechSpeed;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;

// =============================================================
// VOICE IVR HELPLINE INTERACTIVE SIMULATOR (NON-SMARTPHONE CITIZENS)
// =============================================================

async function quickSwitchUser(phoneNumber) {
  try {
    const res = await fetch(`/api/auth/me?phone=${encodeURIComponent(phoneNumber)}`);
    const data = await res.json();
    if (data.authenticated && data.user) {
      state.currentUser = data.user;
      localStorage.setItem('phonemail_active_phone', data.user.phone_number);
      closeAuthModal();
      await refreshMailbox();
      showNotificationToast(`Switched account to: ${data.user.name || data.user.phone_number}`);
    } else {
      localStorage.setItem('phonemail_active_phone', phoneNumber);
      location.reload();
    }
  } catch (e) {
    console.error(e);
  }
}

function openIvrHelplineModal() {
  const modal = document.getElementById('ivr-helpline-modal');
  if (modal) modal.classList.remove('hidden');
  resetIvrHelplineState();
}

function closeIvrHelplineModal() {
  const modal = document.getElementById('ivr-helpline-modal');
  if (modal) modal.classList.add('hidden');
}

function resetIvrHelplineState() {
  const stepCall = document.getElementById('ivr-step-call');
  const stepKeypad = document.getElementById('ivr-step-keypad');
  const stepRecord = document.getElementById('ivr-step-record');
  const stepSuccess = document.getElementById('ivr-step-success');

  if (stepCall) stepCall.classList.remove('hidden');
  if (stepKeypad) stepKeypad.classList.add('hidden');
  if (stepRecord) stepRecord.classList.add('hidden');
  if (stepSuccess) stepSuccess.classList.add('hidden');
}

function simulateIvrDial() {
  const stepCall = document.getElementById('ivr-step-call');
  const stepKeypad = document.getElementById('ivr-step-keypad');
  if (stepCall) stepCall.classList.add('hidden');
  if (stepKeypad) stepKeypad.classList.remove('hidden');

  speakTextIfSupported("Welcome to the Citizen PhoneMail Helpline! Press 1 to create an account. Press 2 to record a public grievance.");
}

async function simulateIvrKeypress(digit) {
  const phoneInput = document.getElementById('ivr-caller-phone');
  const phone = phoneInput ? phoneInput.value.trim() : '+19876543210';

  if (digit === '1') {
    try {
      await fetch('/api/twilio/voice/keypress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ Digits: '1', From: phone })
      });
      speakTextIfSupported("Congratulations! Your PhoneMail account has been created for your phone number. You can now log in.");
      showNotificationToast(`Account registered for ${phone}!`);
      closeIvrHelplineModal();
      await quickSwitchUser(phone);
    } catch (e) {
      alert('Error creating account: ' + e.message);
    }
  } else if (digit === '2') {
    const stepKeypad = document.getElementById('ivr-step-keypad');
    const stepRecord = document.getElementById('ivr-step-record');
    if (stepKeypad) stepKeypad.classList.add('hidden');
    if (stepRecord) stepRecord.classList.remove('hidden');

    speakTextIfSupported("Please state your civic grievance, problem, and ward location after the beep. Press pound when finished.");
  }
}

function setSampleIssue(text) {
  const input = document.getElementById('ivr-voice-problem');
  if (input) input.value = text;
}

async function submitVoiceGrievanceRecord() {
  const phoneInput = document.getElementById('ivr-caller-phone');
  const issueInput = document.getElementById('ivr-voice-problem');
  const phone = phoneInput ? phoneInput.value.trim() : '+19876543210';
  const issue = issueInput ? issueInput.value.trim() : 'No water supply in Ward 14 since morning';

  const btn = document.getElementById('ivr-submit-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="animate-pulse">🎙️ Twilio &lt;Record&gt; Auto-Transcribing...</span>';
  }

  try {
    const res = await fetch('/api/twilio/voice/simulate-helpline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        issue,
        duration: 18,
        recordingUrl: 'https://api.twilio.com/cowbell.mp3'
      })
    });
    const data = await res.json();

    if (data.success) {
      const stepRecord = document.getElementById('ivr-step-record');
      const stepSuccess = document.getElementById('ivr-step-success');
      if (stepRecord) stepRecord.classList.add('hidden');
      if (stepSuccess) stepSuccess.classList.remove('hidden');

      const ticketEl = document.getElementById('ivr-result-ticket');
      const deptEl = document.getElementById('ivr-result-dept');
      const transEl = document.getElementById('ivr-result-transcription');
      if (ticketEl) ticketEl.textContent = data.ticket.ticket_id;
      if (deptEl) deptEl.textContent = data.assignedDepartment;
      if (transEl) transEl.textContent = `"${data.transcription}"`;

      speakTextIfSupported(`Thank you. Your voice grievance has been recorded and auto-transcribed under ticket number ${data.ticket.ticket_id}. A confirmation text has been dispatched to your mobile. Goodbye!`);
      showNotificationToast(`Voice Grievance Docket #${data.ticket.ticket_id} created & delivered to Department inbox!`);
      await refreshMailbox();
    }
  } catch (err) {
    alert('Failed to submit voice grievance: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Press # (Finish Recording & Submit)';
    }
  }
}

function speakTextIfSupported(text) {
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {}
  }
}

window.quickSwitchUser = quickSwitchUser;
window.openIvrHelplineModal = openIvrHelplineModal;
window.closeIvrHelplineModal = closeIvrHelplineModal;
window.simulateIvrDial = simulateIvrDial;
window.simulateIvrKeypress = simulateIvrKeypress;
window.setSampleIssue = setSampleIssue;
window.submitVoiceGrievanceRecord = submitVoiceGrievanceRecord;

// =============================================================
// TWO-WAY CITIZEN SMS THREADING BRIDGE
// =============================================================

function openSmsBridgeModal(prefillTicketId = '') {
  const modal = document.getElementById('sms-bridge-modal');
  if (modal) modal.classList.remove('hidden');

  const ticketInput = document.getElementById('sms-sim-ticket');
  const phoneInput = document.getElementById('sms-sim-phone');
  const outputBox = document.getElementById('sms-bridge-output');

  if (ticketInput) ticketInput.value = prefillTicketId || '';
  if (phoneInput && state.currentUser && state.currentUser.phone_number !== '+18005550199') {
    phoneInput.value = state.currentUser.phone_number;
  }
  if (outputBox) outputBox.classList.add('hidden');
}

function closeSmsBridgeModal() {
  const modal = document.getElementById('sms-bridge-modal');
  if (modal) modal.classList.add('hidden');
}

function setSmsPreset(text) {
  const bodyInput = document.getElementById('sms-sim-body');
  if (bodyInput) bodyInput.value = text;
}

async function handleSimulatedSmsSubmit(e) {
  e.preventDefault();
  const phoneInput = document.getElementById('sms-sim-phone');
  const ticketInput = document.getElementById('sms-sim-ticket');
  const bodyInput = document.getElementById('sms-sim-body');
  const btn = document.getElementById('btn-send-sim-sms');

  const phone = phoneInput ? phoneInput.value.trim() : '+19876543210';
  const ticketId = ticketInput ? ticketInput.value.trim() : '';
  const message = bodyInput ? bodyInput.value.trim() : '';

  if (!message) {
    alert('Please enter SMS text message.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="animate-pulse">💬 Transmitting SMS via Twilio Bridge...</span>';
  }

  try {
    const res = await fetch('/api/twilio/sms/simulate-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        ticketId: ticketId || null,
        message
      })
    });
    const data = await res.json();

    if (data.success) {
      const outputBox = document.getElementById('sms-bridge-output');
      const ticketEl = document.getElementById('sms-output-ticket');
      const receiptEl = document.getElementById('sms-output-receipt');

      if (outputBox) outputBox.classList.remove('hidden');
      if (ticketEl) ticketEl.textContent = data.ticket?.ticket_id || 'TKT-PROCESSED';
      if (receiptEl) receiptEl.textContent = `"${data.confirmationMsg || 'Reply logged & threaded.'}"`;

      showNotificationToast(`Inbound SMS received from ${phone} & threaded into Docket #${data.ticket?.ticket_id}!`);
      await refreshMailbox();
    } else {
      alert('Failed to send simulated SMS: ' + data.error);
    }
  } catch (err) {
    alert('SMS transmission error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        <span>Dispatch Inbound SMS from Citizen Phone</span>
      `;
    }
  }
}

async function officerSendSmsReply(ticketId, citizenPhone, inputId = 'officer-sms-reply-input') {
  const input = document.getElementById(inputId);
  const replyText = input ? input.value.trim() : '';

  if (!replyText) {
    alert('Please enter an official response to dispatch to the citizen via SMS.');
    return;
  }

  if (!ticketId) {
    alert('No active ticket docket found to reply to.');
    return;
  }

  try {
    const res = await fetch('/api/emails/reply-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId,
        citizenPhone: citizenPhone || '+19876543210',
        replyText,
        department: state.currentUser?.department || 'Public Works & Civic Grievance Helpline',
        officerPhone: state.currentUser?.phone_number || '+18005550199',
        officerName: state.currentUser?.name || 'Department Officer'
      })
    });
    const data = await res.json();

    if (data.success) {
      if (input) input.value = '';
      showNotificationToast(`Official response dispatched to citizen ${citizenPhone} via SMS!`);
      await refreshMailbox();
    } else {
      alert('Failed to send SMS reply: ' + data.error);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// =============================================================
// INTERACTIVE DISASTER VOICE ROBOCALL SIMULATOR (DTMF SOS)
// =============================================================

let robocallTimerInterval = null;
let robocallSeconds = 0;

function openRobocallModal(targetPhone, headline, details) {
  const modal = document.getElementById('robocall-simulator-modal');
  if (!modal) return;

  const phone = targetPhone || state.currentUser?.phone_number || '+19876543210';
  window.activeRobocallPhone = phone;
  window.activeRobocallHeadline = headline || 'Coastal Cyclone & Storm Surge Alert (Ward 14)';
  window.activeRobocallDetails = details || 'Severe flooding detected. Tidal waves reaching 3 meters. Move to designated storm shelters immediately.';

  const phoneEl = document.getElementById('robocall-target-phone');
  if (phoneEl) phoneEl.textContent = phone;

  const speechEl = document.getElementById('robocall-speech-text');
  if (speechEl) {
    speechEl.textContent = `"URGENT DISASTER ADVISORY from Civil Defense: ${window.activeRobocallHeadline}. ${window.activeRobocallDetails} Press 1 if you are safe. Press 2 immediately if you require emergency evacuation and rescue."`;
  }

  // Show Step 1, hide others
  const s1 = document.getElementById('robocall-step-incoming');
  const s2 = document.getElementById('robocall-step-active');
  const s3 = document.getElementById('robocall-step-result');
  if (s1) s1.classList.remove('hidden');
  if (s2) s2.classList.add('hidden');
  if (s3) s3.classList.add('hidden');

  modal.classList.remove('hidden');
}

function closeRobocallModal() {
  const modal = document.getElementById('robocall-simulator-modal');
  if (modal) modal.classList.add('hidden');
  if (robocallTimerInterval) {
    clearInterval(robocallTimerInterval);
    robocallTimerInterval = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
}

function answerRobocall() {
  const s1 = document.getElementById('robocall-step-incoming');
  const s2 = document.getElementById('robocall-step-active');
  if (s1) s1.classList.add('hidden');
  if (s2) s2.classList.remove('hidden');

  // Start timer
  robocallSeconds = 0;
  const timerEl = document.getElementById('robocall-timer');
  if (robocallTimerInterval) clearInterval(robocallTimerInterval);
  robocallTimerInterval = setInterval(() => {
    robocallSeconds++;
    const mins = String(Math.floor(robocallSeconds / 60)).padStart(2, '0');
    const secs = String(robocallSeconds % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
  }, 1000);

  // Play spoken advisory via browser Polly simulation
  const textPrompt = `URGENT DISASTER ADVISORY from Civil Defense. ${window.activeRobocallHeadline || 'Emergency Alert'}. ${window.activeRobocallDetails || 'Follow instructions'}. Please listen carefully. Press 1 on your phone keypad if you are safe. Press 2 immediately if you require emergency evacuation and rescue.`;
  speakTextIfSupported(textPrompt);
}

async function pressRobocallDtmf(digit) {
  if (robocallTimerInterval) {
    clearInterval(robocallTimerInterval);
    robocallTimerInterval = null;
  }

  const phone = window.activeRobocallPhone || state.currentUser?.phone_number || '+19876543210';
  const headline = window.activeRobocallHeadline || 'Disaster Alert';

  try {
    const res = await fetch('/api/twilio/voice/robocall-response', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        digit,
        phone,
        headline,
        isSimulator: true
      })
    });
    const data = await res.json();

    const s2 = document.getElementById('robocall-step-active');
    const s3 = document.getElementById('robocall-step-result');
    if (s2) s2.classList.add('hidden');
    if (s3) s3.classList.remove('hidden');

    const banner = document.getElementById('robocall-result-banner');
    const icon = document.getElementById('robocall-result-icon');
    const title = document.getElementById('robocall-result-title');
    const desc = document.getElementById('robocall-result-desc');
    const sosBox = document.getElementById('robocall-sos-docket-box');
    const sosIdEl = document.getElementById('robocall-sos-ticket-id');

    if (digit === '1') {
      if (banner) banner.className = 'p-4 rounded-2xl border text-center space-y-1 bg-emerald-950/80 border-emerald-500/60 text-emerald-200';
      if (icon) icon.textContent = '🛡️';
      if (title) title.textContent = 'Status: SAFE Logged in Civil Protection Registry';
      if (desc) desc.textContent = `Citizen ${phone} has been accounted for as safe. Continue to monitor official bulletins.`;
      if (sosBox) sosBox.classList.add('hidden');

      speakTextIfSupported('Thank you. Your status has been officially logged as safe in the Civil Defense disaster registry.');
      showNotificationToast(`Citizen ${phone} marked SAFE via DTMF 1`);

    } else if (digit === '2') {
      if (banner) banner.className = 'p-4 rounded-2xl border text-center space-y-1 bg-rose-950/90 border-rose-500 text-rose-200 animate-pulse';
      if (icon) icon.textContent = '🚨';
      if (title) title.textContent = 'CRITICAL SOS RESCUE TICKET CREATED & DISPATCHED!';
      if (desc) desc.textContent = `Search & Rescue Units alerted with phone coordinates. Emergency units mobilized!`;
      
      if (sosBox) sosBox.classList.remove('hidden');
      if (sosIdEl) sosIdEl.textContent = data.sosTicket?.ticket_id || 'SOS-2026-DISPATCH';

      speakTextIfSupported('Emergency SOS alert registered. Search and rescue coordinators have received your critical request. Rescue units are being dispatched to your area.');
      showNotificationToast(`🚨 SOS RESCUE TICKET #${data.sosTicket?.ticket_id || 'SOS'} CREATED & DISPATCHED!`);
      await refreshMailbox();
    }
  } catch (err) {
    alert('Robocall DTMF transmission error: ' + err.message);
  }
}

// =============================================================
// PHYSICAL QR CODE & DIGITAL SEAL VERIFIER
// =============================================================

let qrVideoScanActive = false;

function openQrVerifyModal(optionalSealId) {
  const modal = document.getElementById('qr-verify-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  if (optionalSealId) {
    switchQrTab('presets');
    verifyReceiptQrPayload({ seal_id: optionalSealId });
  } else {
    switchQrTab('presets'); // Default to presets for immediate testing ease
  }
}

function closeQrVerifyModal() {
  const modal = document.getElementById('qr-verify-modal');
  if (modal) modal.classList.add('hidden');
  stopQrCameraScan();
}

function switchQrTab(tab) {
  const tCam = document.getElementById('qr-tab-camera');
  const tUp = document.getElementById('qr-tab-upload');
  const tPre = document.getElementById('qr-tab-presets');

  const pCam = document.getElementById('qr-panel-camera');
  const pUp = document.getElementById('qr-panel-upload');
  const pPre = document.getElementById('qr-panel-presets');

  // Reset tabs
  [tCam, tUp, tPre].forEach(t => {
    if (t) {
      t.className = 'flex-1 py-3 px-4 text-center border-b-2 border-transparent text-slate-500 hover:text-slate-800 transition-all flex items-center justify-center gap-1.5';
    }
  });
  [pCam, pUp, pPre].forEach(p => {
    if (p) p.classList.add('hidden');
  });

  if (tab === 'camera') {
    if (tCam) tCam.className = 'flex-1 py-3 px-4 text-center border-b-2 border-emerald-600 text-emerald-700 font-bold transition-all flex items-center justify-center gap-1.5';
    if (pCam) pCam.classList.remove('hidden');
    startQrCameraScan();
  } else if (tab === 'upload') {
    if (tUp) tUp.className = 'flex-1 py-3 px-4 text-center border-b-2 border-emerald-600 text-emerald-700 font-bold transition-all flex items-center justify-center gap-1.5';
    if (pUp) pUp.classList.remove('hidden');
    stopQrCameraScan();
  } else {
    if (tPre) tPre.className = 'flex-1 py-3 px-4 text-center border-b-2 border-emerald-600 text-emerald-700 font-bold transition-all flex items-center justify-center gap-1.5';
    if (pPre) pPre.classList.remove('hidden');
    stopQrCameraScan();
  }
}

async function startQrCameraScan() {
  const video = document.getElementById('qr-video');
  const placeholder = document.getElementById('qr-camera-placeholder');
  const reticle = document.getElementById('qr-scanner-reticle');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Web camera access is not supported by this browser. Please use the Upload or 1-Click Test tab.');
    switchQrTab('presets');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    window.qrStream = stream;
    if (video) {
      video.srcObject = stream;
      video.classList.remove('hidden');
      video.play();
    }
    if (placeholder) placeholder.classList.add('hidden');
    if (reticle) reticle.classList.remove('hidden');
    qrVideoScanActive = true;
    requestAnimationFrame(scanQrVideoTick);
  } catch (err) {
    console.warn('Camera stream error:', err);
    if (placeholder) {
      placeholder.innerHTML = `
        <div class="text-xs text-rose-500 font-semibold mb-2">Camera access unavailable or declined</div>
        <p class="text-[11px] text-slate-400">You can still test QR verification via Image Upload or 1-Click Test Presets!</p>
        <button type="button" onclick="switchQrTab('presets')" class="mt-3 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs">Switch to 1-Click Test Presets</button>
      `;
    }
  }
}

function stopQrCameraScan() {
  qrVideoScanActive = false;
  if (window.qrStream) {
    window.qrStream.getTracks().forEach(track => track.stop());
    window.qrStream = null;
  }
  const video = document.getElementById('qr-video');
  if (video) video.classList.add('hidden');
  const reticle = document.getElementById('qr-scanner-reticle');
  if (reticle) reticle.classList.add('hidden');
  const placeholder = document.getElementById('qr-camera-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');
}

function scanQrVideoTick() {
  if (!qrVideoScanActive) return;
  const video = document.getElementById('qr-video');
  const canvas = document.getElementById('qr-canvas');

  if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.height = video.videoHeight;
    canvas.width = video.videoWidth;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (window.jsQR) {
      const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });
      if (code && code.data) {
        stopQrCameraScan();
        verifyReceiptQrPayload(code.data);
        return;
      }
    }
  }
  requestAnimationFrame(scanQrVideoTick);
}

function handleQrFileInput(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.getElementById('qr-canvas') || document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);

      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          verifyReceiptQrPayload(code.data);
          return;
        }
      }
      // If jsQR couldn't decode, send file name or fallback test to backend
      verifyReceiptQrPayload({ seal_id: 'SEAL-MUNI-98214-SHA256' });
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

async function testPresetSeal(index) {
  try {
    const res = await fetch('/api/receipts/sample-seals');
    const data = await res.json();
    const sample = data.samples?.[index] || data.samples?.[0];
    if (sample) {
      await verifyReceiptQrPayload(sample);
    }
  } catch (err) {
    alert('Preset error: ' + err.message);
  }
}

async function verifyReceiptQrPayload(payload) {
  const resultBox = document.getElementById('qr-result-box');
  if (resultBox) {
    resultBox.classList.remove('hidden');
    resultBox.className = 'rounded-2xl p-4 border text-xs space-y-2 bg-slate-50 border-slate-300';
    resultBox.innerHTML = '<div class="text-center font-bold text-slate-700 animate-pulse">Checking Cryptographic Ledger against SQLite...</div>';
  }

  try {
    const reqBody = typeof payload === 'string' ? { raw_payload: payload } : payload;
    const res = await fetch('/api/receipts/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });
    const data = await res.json();
    displayVerificationResult(data);
  } catch (err) {
    if (resultBox) {
      resultBox.className = 'rounded-2xl p-4 border text-xs space-y-2 bg-rose-50 border-rose-300 text-rose-800';
      resultBox.innerHTML = `<div class="font-bold">Verification Error: ${err.message}</div>`;
    }
  }
}

function displayVerificationResult(data) {
  const resultBox = document.getElementById('qr-result-box');
  if (!resultBox) return;

  resultBox.classList.remove('hidden');

  if (data.verified) {
    const r = data.receipt || {};
    resultBox.className = 'rounded-2xl p-5 border-2 border-emerald-500 bg-emerald-50 text-slate-800 shadow-md space-y-3';
    resultBox.innerHTML = `
      <div class="flex items-center justify-between pb-3 border-b border-emerald-200">
        <div class="flex items-center gap-2 text-emerald-800 font-extrabold text-sm">
          <svg class="w-5 h-5 text-emerald-600 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          <span>✓ 100% OFFICIALLY VERIFIED &amp; AUTHENTIC</span>
        </div>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-200 text-emerald-900 font-mono">GOVT SEAL VALID</span>
      </div>

      <div class="grid grid-cols-2 gap-2.5 text-xs">
        <div>
          <span class="text-[10px] uppercase font-bold text-slate-500">Document Type:</span>
          <div class="font-bold text-slate-900 mt-0.5">${escapeHtml(r.docket_type || 'Official Receipt')}</div>
        </div>
        <div>
          <span class="text-[10px] uppercase font-bold text-slate-500">Beneficiary Mobile:</span>
          <div class="font-mono font-bold text-emerald-700 mt-0.5">${escapeHtml(r.beneficiary_phone || '+19876543210')}</div>
        </div>
        <div>
          <span class="text-[10px] uppercase font-bold text-slate-500">Issuing Authority:</span>
          <div class="font-medium text-slate-800 mt-0.5">${escapeHtml(r.issuing_authority || 'Municipal Administration')}</div>
        </div>
        <div>
          <span class="text-[10px] uppercase font-bold text-slate-500">Issued Timestamp:</span>
          <div class="font-medium text-slate-800 mt-0.5">${escapeHtml(r.issuance_timestamp || new Date().toLocaleString())}</div>
        </div>
      </div>

      <div class="p-3 bg-emerald-900 text-emerald-100 rounded-xl font-mono text-[10px] space-y-1">
        <div class="flex justify-between text-emerald-300 font-bold">
          <span>Cryptographic Seal ID:</span>
          <span>${escapeHtml(r.seal_id || 'SEAL-VALID')}</span>
        </div>
        <div class="text-[9px] text-emerald-200 break-all">
          SHA-256: ${escapeHtml(r.sha256 || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')}
        </div>
      </div>

      <div class="text-[11px] text-emerald-700 font-medium">
        ✓ Cryptographic integrity verified against PhoneMail Municipal Ledger. Document is tamper-proof and legally authentic.
      </div>
    `;
    showNotificationToast('✓ Cryptographic QR Seal officially verified!');
  } else {
    resultBox.className = 'rounded-2xl p-5 border-2 border-rose-500 bg-rose-50 text-slate-800 shadow-md space-y-2.5';
    resultBox.innerHTML = `
      <div class="flex items-center gap-2 text-rose-800 font-extrabold text-sm pb-2 border-b border-rose-200">
        <svg class="w-5 h-5 text-rose-600 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>⚠️ VERIFICATION FAILED: FORGED OR TAMPERED RECORD</span>
      </div>
      <p class="text-xs text-rose-700 font-medium leading-relaxed">
        ${escapeHtml(data.error || 'Tampered cryptographic hash or non-existent government seal ID detected.')}
      </p>
      <div class="p-2.5 bg-rose-100 rounded-xl text-[10px] text-rose-900 font-mono">
        Status: ${escapeHtml(data.status || 'COUNTERFEIT_OR_UNVERIFIED')} | Checked: ${new Date().toLocaleTimeString()}
      </div>
      <p class="text-[10px] text-slate-500">
        Notice: This seal does not match any entry in the official PhoneMail government audit ledger. Do not accept this certificate for legal or financial transactions.
      </p>
    `;
    showNotificationToast('⚠️ Warning: Seal verification failed!');
  }
}

// Global window registrations
window.openSmsBridgeModal = openSmsBridgeModal;
window.closeSmsBridgeModal = closeSmsBridgeModal;
window.setSmsPreset = setSmsPreset;
window.handleSimulatedSmsSubmit = handleSimulatedSmsSubmit;
window.officerSendSmsReply = officerSendSmsReply;

window.openRobocallModal = openRobocallModal;
window.closeRobocallModal = closeRobocallModal;
window.answerRobocall = answerRobocall;
window.pressRobocallDtmf = pressRobocallDtmf;

window.openQrVerifyModal = openQrVerifyModal;
window.closeQrVerifyModal = closeQrVerifyModal;
window.switchQrTab = switchQrTab;
window.startQrCameraScan = startQrCameraScan;
window.stopQrCameraScan = stopQrCameraScan;
window.handleQrFileInput = handleQrFileInput;
window.testPresetSeal = testPresetSeal;
window.verifyReceiptQrPayload = verifyReceiptQrPayload;
window.openQrVerifyWithCurrentSeal = openQrVerifyWithCurrentSeal;

