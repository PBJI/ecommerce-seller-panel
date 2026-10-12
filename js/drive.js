import { config, isDriveConfigured } from './config.js';

const DRIVE_REF_PREFIX = 'drive://';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let accessToken = '';
let tokenExpiresAt = 0;
let pendingTokenRequest = null;
let driveFolderId = null;
let hasGrantedDrive = false;
const imageObjectUrls = new Map();

export function isDriveReady() {
  return Boolean(accessToken && Date.now() < tokenExpiresAt - 60_000);
}

export function isDriveConfiguredForApp() {
  return isDriveConfigured();
}

export function getCachedImageUrl(fileId) {
  return imageObjectUrls.get(String(fileId || '')) || '';
}

export function loadGoogleIdentityServices() {
  if (!isDriveConfigured()) return Promise.resolve(false);
  if (window.google?.accounts?.oauth2) return Promise.resolve(true);
  return new Promise((resolve) => {
    let script = document.querySelector('script[data-merchant-drive-gis]');
    if (script) {
      script.addEventListener('load', () => resolve(Boolean(window.google?.accounts?.oauth2)), { once: true });
      script.addEventListener('error', () => resolve(false), { once: true });
      setTimeout(() => resolve(Boolean(window.google?.accounts?.oauth2)), 0);
      return;
    }
    script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.merchantDriveGis = 'true';
    script.onload = () => resolve(Boolean(window.google?.accounts?.oauth2));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

function setDriveStatus(message) {
  const el = document.getElementById('driveStatus');
  if (el) el.textContent = message;
}

function requestDriveToken() {
  if (!isDriveConfigured()) return Promise.reject(new Error('Set googleClientId in js/config.js before connecting Google Drive.'));
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error('Google Drive sign-in is still loading. Wait a moment and retry.'));
  if (pendingTokenRequest) return pendingTokenRequest;

  pendingTokenRequest = new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        pendingTokenRequest = null;
        if (response?.error || !response?.access_token) {
          reject(new Error(response?.error_description || response?.error || 'Google Drive permission was not granted.'));
          return;
        }
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
        hasGrantedDrive = true;
        setDriveStatus('Drive connected for this session');
        resolve(accessToken);
      },
      error_callback: (error) => {
        pendingTokenRequest = null;
        reject(new Error(error?.message || 'Google Drive authorization was closed or blocked.'));
      }
    });
    try {
      client.requestAccessToken({ prompt: hasGrantedDrive ? '' : 'consent' });
    } catch (error) {
      pendingTokenRequest = null;
      reject(error);
    }
  });
  return pendingTokenRequest;
}

export async function connectDrive() {
  if (!isDriveConfigured()) throw new Error('Set googleClientId in js/config.js before connecting Google Drive.');
  if (!window.google?.accounts?.oauth2) {
    const loaded = await loadGoogleIdentityServices();
    if (!loaded) throw new Error('Could not load Google Identity Services. Check your internet connection and retry.');
  }
  await requestDriveToken();
  setDriveStatus('Drive connected for this session');
  window.dispatchEvent(new CustomEvent('merchantdrive:connected'));
  return true;
}

async function apiRequest(url, options = {}) {
  const token = isDriveReady() ? accessToken : await requestDriveToken();
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error?.message || ''; } catch { /* API errors are not always JSON. */ }
    if (response.status === 401) {
      accessToken = '';
      tokenExpiresAt = 0;
      throw new Error('Google Drive session expired. Click Connect Drive and authorize it again.');
    }
    throw new Error(detail || `Google Drive returned HTTP ${response.status}.`);
  }
  return response.status === 204 ? null : response.json();
}

async function getOrCreatePhotoFolder() {
  if (driveFolderId) return driveFolderId;
  const query = encodeURIComponent("name = 'Merchant Desk Product Photos' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const found = await apiRequest(`https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=10&fields=files(id,name,mimeType)`);
  const folder = found.files?.[0];
  if (folder?.id) {
    driveFolderId = folder.id;
    return driveFolderId;
  }
  const created = await apiRequest('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Merchant Desk Product Photos', mimeType: 'application/vnd.google-apps.folder' })
  });
  if (!created?.id) throw new Error('Google Drive did not return a folder ID.');
  driveFolderId = created.id;
  return driveFolderId;
}

function safeFileName(name, mimeType = 'image/jpeg') {
  const clean = String(name || 'product-photo').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 120) || 'product-photo';
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(clean)) return clean;
  const extension = ({ 'image/jpeg':'jpg', 'image/png':'png', 'image/gif':'gif', 'image/webp':'webp', 'image/avif':'avif' })[mimeType] || 'jpg';
  return `${clean}.${extension}`;
}

async function imageSourceToBlob(item) {
  let blob;
  if (item?.file instanceof Blob) {
    blob = item.file;
  } else {
    const src = String(item?.src || '');
    if (!src || src.startsWith(DRIVE_REF_PREFIX)) throw new Error('The image has no uploadable source. Re-add it or choose it from Drive-backed drafts.');
    let response;
    try { response = await fetch(src); }
    catch { throw new Error('Could not read one image. Use a local file or a direct image URL that allows browser access (CORS).'); }
    if (!response.ok) throw new Error('Could not read one image to upload to Drive. Use a local image or a CORS-enabled image URL.');
    blob = await response.blob();
  }
  if (!blob.type.startsWith('image/')) throw new Error('One selected source did not return an image.');
  if (blob.size > 20 * 1024 * 1024) throw new Error('A photo is over the Drive upload limit for this prototype (20 MB).');
  return blob;
}

function rememberImage(fileId, blob) {
  const previous = imageObjectUrls.get(String(fileId));
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(blob);
  imageObjectUrls.set(String(fileId), url);
  return url;
}

async function uploadOneImage(item, folderId) {
  const blob = await imageSourceToBlob(item);
  const fileName = safeFileName(item.name || item.file?.name, blob.type);
  const boundary = `merchantdesk_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = { name: fileName, mimeType: blob.type, parents: [folderId] };
  const multipart = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${blob.type}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`
  ]);
  const result = await apiRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart
  });
  if (!result?.id) throw new Error(`Google Drive did not confirm the upload for ${fileName}.`);
  const previewUrl = rememberImage(result.id, blob);
  return {
    id: result.id,
    name: result.name || fileName,
    mimeType: result.mimeType || blob.type,
    webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
    previewUrl,
    sourceIndex: Number.isInteger(item.sourceIndex) ? item.sourceIndex : (Number.isInteger(item.formIndex) ? item.formIndex : undefined)
  };
}

export async function uploadImages(images) {
  if (!Array.isArray(images) || !images.length) throw new Error('Add at least one photo first.');
  if (!isDriveConfigured()) throw new Error('Set googleClientId in js/config.js before connecting Google Drive.');
  if (!window.google?.accounts?.oauth2) {
    const loaded = await loadGoogleIdentityServices();
    if (!loaded) throw new Error('Could not load Google Identity Services. Check your internet connection and retry.');
  }
  const token = isDriveReady() ? accessToken : await requestDriveToken();
  if (!token) throw new Error('Google Drive permission was not granted.');
  const folderId = await getOrCreatePhotoFolder();
  const results = [];
  for (const image of images) results.push(await uploadOneImage(image, folderId));
  window.dispatchEvent(new CustomEvent('merchantdrive:images-ready'));
  return results;
}

async function cacheOneImage(fileId) {
  const id = String(fileId || '');
  if (!id) return '';
  if (imageObjectUrls.has(id)) return imageObjectUrls.get(id);
  const token = isDriveReady() ? accessToken : await requestDriveToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    if (response.status === 401) { accessToken = ''; tokenExpiresAt = 0; }
    throw new Error(`Could not load Drive photo ${id} (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`Drive file ${id} is not an image.`);
  return rememberImage(id, blob);
}

export async function cacheImages(fileIds) {
  const ids = [...new Set((fileIds || []).map(String).filter(Boolean))];
  const failures = [];
  for (const id of ids) {
    try { await cacheOneImage(id); }
    catch (error) { failures.push({ id, message: error.message || String(error) }); }
  }
  window.dispatchEvent(new CustomEvent('merchantdrive:images-ready'));
  return { loaded: ids.length - failures.length, failures };
}

export function clearDriveSession() {
  accessToken = '';
  tokenExpiresAt = 0;
  driveFolderId = null;
  hasGrantedDrive = false;
  for (const url of imageObjectUrls.values()) URL.revokeObjectURL(url);
  imageObjectUrls.clear();
  setDriveStatus('Drive not connected');
}
