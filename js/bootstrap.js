import { config, isSupabaseConfigured, isDriveConfigured } from './config.js';
import { getSupabase, fetchWorkspaceState, saveWorkspaceState } from './supabase.js';
import * as MerchantDrive from './drive.js';

window.MerchantDrive = MerchantDrive;

const STORE_KEY = 'merchant-desk-cloud-v1';
const $ = (id) => document.getElementById(id);
const gateStatus = $('authStatus');
const gateNotice = $('authSetupNotice');
const signInButton = $('googleSignInBtn');
let appStartedFor = null;
let cloudAvailable = true;
let latestQueuedState = null;
let syncTimer = null;
let saving = false;
let saveAgain = false;

function status(message, kind = '') {
  if (!gateStatus) return;
  gateStatus.textContent = message;
  gateStatus.classList.toggle('error', kind === 'error');
}

function setSyncStatus(message, state = 'ready') {
  const pill = $('syncStatus');
  const label = $('syncStatusText');
  if (pill) pill.dataset.state = state;
  if (label) label.textContent = message;
}

function localCacheFor(userId) {
  try {
    const raw = localStorage.getItem(`${STORE_KEY}:${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Could not read local workspace cache.', error);
    return null;
  }
}

function appRedirectUrl() {
  // Works for both username.github.io and username.github.io/repository/ deployments.
  return `${window.location.origin}${window.location.pathname}`;
}

function showSetupNotice() {
  if (!gateNotice) return;
  gateNotice.classList.add('visible');
  gateNotice.textContent = 'Setup needed: add your Supabase project URL and publishable/anon key in js/config.js, then configure Google as a Supabase Auth provider. Run supabase/schema.sql in the Supabase SQL Editor. Google Drive image storage also needs the Google web OAuth client ID and Drive API enabled.';
}

async function signInWithGoogle() {
  const supabase = getSupabase();
  if (!supabase) return status('Supabase is not configured yet. See the setup message below.', 'error');
  signInButton.disabled = true;
  status('Redirecting to Google…');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: appRedirectUrl(),
      queryParams: { prompt: 'select_account' }
    }
  });
  if (error) {
    signInButton.disabled = false;
    status(`Google sign-in failed: ${error.message}`, 'error');
  }
}

function setAccount(user) {
  const email = user.email || user.user_metadata?.full_name || 'Google account';
  const emailElement = $('accountEmail');
  const avatar = $('accountAvatar');
  if (emailElement) emailElement.textContent = email;
  if (avatar) {
    const initials = (user.user_metadata?.full_name || email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    avatar.textContent = initials || 'G';
    avatar.title = email;
  }
  const driveButton = $('driveConnectBtn');
  if (driveButton) {
    driveButton.disabled = !isDriveConfigured();
    driveButton.title = isDriveConfigured() ? 'Connect Drive to save and display product photos' : 'Configure googleClientId in js/config.js first';
  }
  const imageDriveButton = $('saveImageDriveBtn');
  if (imageDriveButton) imageDriveButton.disabled = !isDriveConfigured();
}

async function startApplication(user) {
  if (!user || appStartedFor === user.id) return;
  appStartedFor = user.id;
  window.MERCHANT_DESK_USER_ID = user.id;
  window.MERCHANT_DESK_USER = user;
  document.body.classList.remove('authenticated');
  status('Loading your workspace…');
  let remoteRecord = null;
  let loadError = null;
  try {
    remoteRecord = await fetchWorkspaceState(user.id);
  } catch (error) {
    loadError = error;
    cloudAvailable = false;
    console.error('Cloud workspace could not be loaded.', error);
  }
  const localState = localCacheFor(user.id);
  const remoteState = remoteRecord?.state || null;
  const localUpdated = Date.parse(localState?._updatedAt || '') || 0;
  const remoteUpdated = Date.parse(remoteRecord?.updated_at || remoteState?._updatedAt || '') || 0;
  // If the tab closed before its debounced cloud save completed, restore the newer local snapshot and sync it on boot.
  window.MERCHANT_DESK_INITIAL_STATE = (localState && localUpdated > remoteUpdated) ? localState : (remoteState || localState || null);
  window.MERCHANT_DESK_CLOUD_AVAILABLE = cloudAvailable;
  setAccount(user);
  document.body.classList.add('authenticated');
  status('Signed in. Loading Merchant Desk…');
  if (!isDriveConfigured()) {
    const ds = $('driveStatus');
    if (ds) ds.textContent = 'Drive setup needed';
  } else {
    // Load GIS before the workspace appears, so the later permission prompt starts directly from a click.
    await MerchantDrive.loadGoogleIdentityServices();
  }
  bindWorkspaceControls();
  try {
    await import('./app.js');
    if (loadError) {
      setSyncStatus('Cloud unavailable', 'error');
      status(`Signed in, but cloud data could not load. The local cache is open. Check the SQL setup and network. ${loadError.message}`, 'error');
    } else {
      setSyncStatus('Cloud connected', 'ready');
      status('');
    }
  } catch (error) {
    console.error('Merchant Desk failed to start.', error);
    document.body.classList.remove('authenticated');
    appStartedFor = null;
    status(`App startup failed: ${error.message || error}`, 'error');
  }
}

function bindWorkspaceControls() {
  $('signOutBtn')?.addEventListener('click', async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const button = $('signOutBtn');
    button.disabled = true;
    await flushCloudSave(true);
    MerchantDrive.clearDriveSession();
    const { error } = await supabase.auth.signOut();
    if (error) {
      button.disabled = false;
      setSyncStatus('Sign-out failed', 'error');
      return;
    }
    window.location.reload();
  });
  $('driveConnectBtn')?.addEventListener('click', async () => {
    const button = $('driveConnectBtn');
    if (!isDriveConfigured()) return;
    button.disabled = true;
    try {
      await MerchantDrive.connectDrive();
      const driveStatus = $('driveStatus');
      if (driveStatus) driveStatus.textContent = 'Drive connected for this session';
      const syncText = $('syncStatusText');
      if (syncText && syncText.textContent === 'Cloud connected') setSyncStatus('Cloud connected', 'ready');
    } catch (error) {
      console.error(error);
      if ($('driveStatus')) $('driveStatus').textContent = 'Drive connection failed';
      window.toast?.(`Drive connection failed: ${error.message || 'try again'}`);
    } finally {
      button.disabled = false;
    }
  });
}

function queueCloudSave(state, userId) {
  if (!userId || userId !== window.MERCHANT_DESK_USER_ID) return;
  latestQueuedState = { state: structuredClone(state), userId };
  saveAgain = true;
  setSyncStatus(cloudAvailable ? 'Changes pending' : 'Local backup only', cloudAvailable ? 'syncing' : 'error');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => flushCloudSave(false), 700);
}

async function flushCloudSave(force) {
  clearTimeout(syncTimer);
  if (saving) {
    if (force) saveAgain = true;
    return;
  }
  if (!latestQueuedState) return;
  saving = true;
  try {
    while (latestQueuedState) {
      const item = latestQueuedState;
      latestQueuedState = null;
      saveAgain = false;
      setSyncStatus('Syncing…', 'syncing');
      await saveWorkspaceState(item.userId, item.state);
      cloudAvailable = true;
      if (!saveAgain && !latestQueuedState) setSyncStatus('Synced', 'ready');
    }
  } catch (error) {
    console.error('Cloud sync failed.', error);
    cloudAvailable = false;
    setSyncStatus('Sync failed · local saved', 'error');
    // Keep latest state in memory so a later online event or user edit can retry it.
    window.MERCHANT_DESK_CLOUD_ERROR = error.message || String(error);
    if (!latestQueuedState && window.MERCHANT_DESK_USER_ID) {
      latestQueuedState = { state: localCacheFor(window.MERCHANT_DESK_USER_ID), userId: window.MERCHANT_DESK_USER_ID };
      if (!latestQueuedState.state) latestQueuedState = null;
    }
  } finally {
    saving = false;
    if (latestQueuedState && cloudAvailable) setTimeout(() => flushCloudSave(false), 50);
  }
}

window.addEventListener('merchantdesk:state-change', event => {
  queueCloudSave(event.detail?.state, event.detail?.userId);
});
window.addEventListener('online', () => {
  if (!latestQueuedState && window.MERCHANT_DESK_USER_ID) {
    const state = localCacheFor(window.MERCHANT_DESK_USER_ID);
    if (state) latestQueuedState = { state, userId: window.MERCHANT_DESK_USER_ID };
  }
  if (latestQueuedState) {
    cloudAvailable = true;
    flushCloudSave(false);
  }
});

signInButton?.addEventListener('click', signInWithGoogle);

async function boot() {
  if (!isSupabaseConfigured()) {
    showSetupNotice();
    status('Add your Supabase URL and public key in js/config.js to enable sign-in.', 'error');
    return;
  }
  if (!isDriveConfigured()) {
    // Google Drive remains optional; the app can be used without setting a Drive OAuth client.
    if (gateNotice) {
      gateNotice.classList.add('visible');
      gateNotice.textContent = 'Saving local product photo files requires Google Drive. Configure the Google web OAuth client ID in js/config.js and enable the Google Drive API. Supabase stores product metadata and Drive references only.';
    }
  }
  signInButton.disabled = false;
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    status(`Could not read your sign-in session: ${error.message}`, 'error');
    return;
  }
  if (data.session?.user) await startApplication(data.session.user);
  else status('Sign in with Google to open your workspace.');

  supabase.auth.onAuthStateChange((event, session) => {
    // Defer work out of the auth callback to avoid blocking Supabase's internal auth lock.
    setTimeout(() => {
      if (session?.user) startApplication(session.user);
      else if (event === 'SIGNED_OUT') window.location.reload();
    }, 0);
  });
}

boot().catch(error => {
  console.error(error);
  status(`Startup error: ${error.message || error}`, 'error');
});
