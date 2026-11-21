/**
 * Client API router khusus Google Apps Script Web App backend.
 * - Mengirim POST dengan Content-Type: text/plain;charset=utf-8 berisi JSON envelope
 *   { secretToken, token, route, method, query, body }.
 * - Mendukung doGet (via query string) dan doPost (via text/plain JSON) serta validasi SECRET_TOKEN wajib.
 * - Menyimpan URL & SECRET_TOKEN lintas-sesi (Vite Env, Server /api/apps-script-config,
 *   localStorage, sessionStorage, Cookie 1 tahun, dan IndexedDB) agar tidak perlu input ulang di Vercel.
 */

declare const __DKB_ENV_APPS_SCRIPT_URL__: string | undefined;
declare const __DKB_ENV_APPS_SCRIPT_SECRET__: string | undefined;

const APPS_SCRIPT_URL_KEY = 'dkb_apps_script_url';
const APPS_SCRIPT_SECRET_KEY = 'dkb_apps_script_secret';
const APPS_SCRIPT_LOCK_KEY = 'dkb_apps_script_locked';
const COOKIE_URL_KEY = 'dkb_as_url';
const COOKIE_SECRET_KEY = 'dkb_as_sec';
const COOKIE_LOCK_KEY = 'dkb_as_lock';
const IDB_NAME = 'dkb_config_db';
const IDB_STORE = 'kv';
const SESSION_STORAGE_KEY = 'dkb_session';

let memoryAppsScriptUrl = '';
let memoryAppsScriptSecret = '';
let memoryConfigLocked = false;
let hashConfigChecked = false;

function encodeBase64UrlUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64UrlUtf8(b64u: string): string {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function getBuildEnvAppsScriptUrl(): string {
  try {
    if (typeof __DKB_ENV_APPS_SCRIPT_URL__ === 'string' && __DKB_ENV_APPS_SCRIPT_URL__.trim()) {
      return __DKB_ENV_APPS_SCRIPT_URL__.trim();
    }
  } catch {}
  try {
    const v = String((import.meta as any)?.env?.VITE_APPS_SCRIPT_URL || '').trim();
    if (v) return v;
  } catch {}
  return '';
}

function getBuildEnvAppsScriptSecret(): string {
  try {
    if (typeof __DKB_ENV_APPS_SCRIPT_SECRET__ === 'string' && __DKB_ENV_APPS_SCRIPT_SECRET__.trim()) {
      return __DKB_ENV_APPS_SCRIPT_SECRET__.trim();
    }
  } catch {}
  try {
    const v = String((import.meta as any)?.env?.VITE_APPS_SCRIPT_SECRET_TOKEN || '').trim();
    if (v) return v;
  } catch {}
  return '';
}

function readCookie(name: string): string {
  try {
    if (typeof document === 'undefined' || !document.cookie) return '';
    const prefix = `${name}=`;
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
  } catch {}
  return '';
}

function writeCookie(name: string, value: string, maxAgeSeconds = 31536000): void {
  try {
    if (typeof document === 'undefined') return;
    const secure = typeof window !== 'undefined' && window.location?.protocol === 'https:' ? '; Secure' : '';
    if (!value) {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    } else {
      document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
    }
  } catch {}
}

function openConfigDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      const timer = setTimeout(() => resolve(null), 500);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        } catch {}
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve(req.result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(key: string): Promise<string> {
  const db = await openConfigDb();
  if (!db) return '';
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(typeof req.result === 'string' ? req.result : '');
        db.close();
      };
      req.onerror = () => {
        resolve('');
        db.close();
      };
    } catch {
      resolve('');
      try {
        db.close();
      } catch {}
    }
  });
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await openConfigDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      if (value) {
        store.put(value, key);
      } else {
        store.delete(key);
      }
      tx.oncomplete = () => {
        resolve();
        db.close();
      };
      tx.onerror = () => {
        resolve();
        db.close();
      };
    } catch {
      resolve();
      try {
        db.close();
      } catch {}
    }
  });
}

export function normalizeAppsScriptUrl(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function isAppsScriptDevUrl(raw?: string | null): boolean {
  const clean = normalizeAppsScriptUrl(raw);
  return /\/dev(?:[?#].*)?$/i.test(clean);
}

export function isValidAppsScriptUrl(raw?: string | null): boolean {
  const clean = normalizeAppsScriptUrl(raw);
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') return false;
    return parsed.hostname === 'script.google.com' || parsed.hostname === 'script.googleusercontent.com';
  } catch {
    return false;
  }
}

export function getAppsScriptUrl(): string {
  if (memoryAppsScriptUrl && isValidAppsScriptUrl(memoryAppsScriptUrl) && !isAppsScriptDevUrl(memoryAppsScriptUrl)) {
    return memoryAppsScriptUrl;
  }
  try {
    const stored = normalizeAppsScriptUrl(localStorage.getItem(APPS_SCRIPT_URL_KEY));
    if (stored && isValidAppsScriptUrl(stored) && !isAppsScriptDevUrl(stored)) {
      memoryAppsScriptUrl = stored;
      return stored;
    }
  } catch {}
  try {
    const sessionStored = normalizeAppsScriptUrl(sessionStorage.getItem(APPS_SCRIPT_URL_KEY));
    if (sessionStored && isValidAppsScriptUrl(sessionStored) && !isAppsScriptDevUrl(sessionStored)) {
      memoryAppsScriptUrl = sessionStored;
      try {
        localStorage.setItem(APPS_SCRIPT_URL_KEY, sessionStored);
      } catch {}
      writeCookie(COOKIE_URL_KEY, sessionStored);
      return sessionStored;
    }
  } catch {}
  const cookieStored = normalizeAppsScriptUrl(readCookie(COOKIE_URL_KEY));
  if (cookieStored && isValidAppsScriptUrl(cookieStored) && !isAppsScriptDevUrl(cookieStored)) {
    memoryAppsScriptUrl = cookieStored;
    try {
      localStorage.setItem(APPS_SCRIPT_URL_KEY, cookieStored);
      sessionStorage.setItem(APPS_SCRIPT_URL_KEY, cookieStored);
    } catch {}
    return cookieStored;
  }
  const envUrl = normalizeAppsScriptUrl(getBuildEnvAppsScriptUrl());
  if (isValidAppsScriptUrl(envUrl) && !isAppsScriptDevUrl(envUrl)) {
    memoryAppsScriptUrl = envUrl;
    return envUrl;
  }
  return '';
}

export function setAppsScriptUrl(url: string): string {
  const normalized = normalizeAppsScriptUrl(url);
  memoryAppsScriptUrl = normalized;
  try {
    if (normalized) {
      localStorage.setItem(APPS_SCRIPT_URL_KEY, normalized);
    } else {
      localStorage.removeItem(APPS_SCRIPT_URL_KEY);
    }
  } catch {}
  try {
    if (normalized) {
      sessionStorage.setItem(APPS_SCRIPT_URL_KEY, normalized);
    } else {
      sessionStorage.removeItem(APPS_SCRIPT_URL_KEY);
    }
  } catch {}
  writeCookie(COOKIE_URL_KEY, normalized);
  void idbSet(APPS_SCRIPT_URL_KEY, normalized);
  return normalized;
}

export function clearAppsScriptUrl(): void {
  memoryAppsScriptUrl = '';
  try {
    localStorage.removeItem(APPS_SCRIPT_URL_KEY);
  } catch {}
  try {
    sessionStorage.removeItem(APPS_SCRIPT_URL_KEY);
  } catch {}
  writeCookie(COOKIE_URL_KEY, '');
  void idbSet(APPS_SCRIPT_URL_KEY, '');
}

export function getAppsScriptSecretToken(): string {
  if (memoryAppsScriptSecret) return memoryAppsScriptSecret;
  try {
    const stored = (localStorage.getItem(APPS_SCRIPT_SECRET_KEY) || '').trim();
    if (stored) {
      memoryAppsScriptSecret = stored;
      return stored;
    }
  } catch {}
  try {
    const sessionStored = (sessionStorage.getItem(APPS_SCRIPT_SECRET_KEY) || '').trim();
    if (sessionStored) {
      memoryAppsScriptSecret = sessionStored;
      try {
        localStorage.setItem(APPS_SCRIPT_SECRET_KEY, sessionStored);
      } catch {}
      writeCookie(COOKIE_SECRET_KEY, sessionStored);
      return sessionStored;
    }
  } catch {}
  const cookieSecret = readCookie(COOKIE_SECRET_KEY).trim();
  if (cookieSecret) {
    memoryAppsScriptSecret = cookieSecret;
    try {
      localStorage.setItem(APPS_SCRIPT_SECRET_KEY, cookieSecret);
      sessionStorage.setItem(APPS_SCRIPT_SECRET_KEY, cookieSecret);
    } catch {}
    return cookieSecret;
  }
  const envSecret = getBuildEnvAppsScriptSecret();
  if (envSecret) {
    memoryAppsScriptSecret = envSecret;
  }
  return envSecret;
}

export function setAppsScriptSecretToken(secretToken: string): string {
  const clean = (secretToken || '').trim();
  memoryAppsScriptSecret = clean;
  try {
    if (clean) {
      localStorage.setItem(APPS_SCRIPT_SECRET_KEY, clean);
    } else {
      localStorage.removeItem(APPS_SCRIPT_SECRET_KEY);
    }
  } catch {}
  try {
    if (clean) {
      sessionStorage.setItem(APPS_SCRIPT_SECRET_KEY, clean);
    } else {
      sessionStorage.removeItem(APPS_SCRIPT_SECRET_KEY);
    }
  } catch {}
  writeCookie(COOKIE_SECRET_KEY, clean);
  void idbSet(APPS_SCRIPT_SECRET_KEY, clean);
  return clean;
}

export function clearAppsScriptSecretToken(): void {
  memoryAppsScriptSecret = '';
  try {
    localStorage.removeItem(APPS_SCRIPT_SECRET_KEY);
  } catch {}
  try {
    sessionStorage.removeItem(APPS_SCRIPT_SECRET_KEY);
  } catch {}
  writeCookie(COOKIE_SECRET_KEY, '');
  void idbSet(APPS_SCRIPT_SECRET_KEY, '');
}

export function setAppsScriptConfigLocked(locked: boolean): boolean {
  memoryConfigLocked = Boolean(locked);
  const val = locked ? '1' : '';
  try {
    if (locked) {
      localStorage.setItem(APPS_SCRIPT_LOCK_KEY, '1');
    } else {
      localStorage.removeItem(APPS_SCRIPT_LOCK_KEY);
    }
  } catch {}
  try {
    if (locked) {
      sessionStorage.setItem(APPS_SCRIPT_LOCK_KEY, '1');
    } else {
      sessionStorage.removeItem(APPS_SCRIPT_LOCK_KEY);
    }
  } catch {}
  writeCookie(COOKIE_LOCK_KEY, val);
  void idbSet(APPS_SCRIPT_LOCK_KEY, val);
  return memoryConfigLocked;
}

export function isAppsScriptConfigLocked(): boolean {
  if (memoryConfigLocked) return true;
  try {
    if (localStorage.getItem(APPS_SCRIPT_LOCK_KEY) === '1') {
      memoryConfigLocked = true;
      return true;
    }
  } catch {}
  try {
    if (sessionStorage.getItem(APPS_SCRIPT_LOCK_KEY) === '1') {
      memoryConfigLocked = true;
      try {
        localStorage.setItem(APPS_SCRIPT_LOCK_KEY, '1');
      } catch {}
      writeCookie(COOKIE_LOCK_KEY, '1');
      return true;
    }
  } catch {}
  if (readCookie(COOKIE_LOCK_KEY) === '1') {
    memoryConfigLocked = true;
    try {
      localStorage.setItem(APPS_SCRIPT_LOCK_KEY, '1');
      sessionStorage.setItem(APPS_SCRIPT_LOCK_KEY, '1');
    } catch {}
    return true;
  }
  if (hasCompleteAppsScriptConfig()) {
    setAppsScriptConfigLocked(true);
    return true;
  }
  return false;
}

export function hasAppsScriptSecretToken(): boolean {
  return Boolean(getAppsScriptSecretToken());
}

export function getMissingClientConfig(): string[] {
  const missing: string[] = [];
  if (!getAppsScriptUrl()) missing.push('APPS_SCRIPT_URL');
  if (!getAppsScriptSecretToken()) missing.push('SECRET_TOKEN');
  return missing;
}

export function hasCompleteAppsScriptConfig(): boolean {
  return getMissingClientConfig().length === 0;
}

function getStoredSessionToken(): string {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    const tok = typeof parsed?.token === 'string' ? parsed.token.trim() : '';
    if (!tok || tok === 'null' || tok === 'undefined') return '';
    return tok;
  } catch {
    return '';
  }
}

export async function fetchServerAppsScriptConfig(): Promise<{
  appsScriptUrl: string;
  secretToken: string;
  locked: boolean;
}> {
  try {
    const res = await fetch('/api/apps-script-config', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return { appsScriptUrl: '', secretToken: '', locked: false };
    const data = await res.json().catch(() => ({}));
    const rawUrl = normalizeAppsScriptUrl(data?.appsScriptUrl);
    const validUrl = isValidAppsScriptUrl(rawUrl) && !isAppsScriptDevUrl(rawUrl) ? rawUrl : '';
    const secretToken = typeof data?.secretToken === 'string' ? data.secretToken.trim() : '';
    const locked = Boolean(data?.locked || (validUrl && secretToken));
    return { appsScriptUrl: validUrl, secretToken, locked };
  } catch {
    return { appsScriptUrl: '', secretToken: '', locked: false };
  }
}

export async function fetchServerAppsScriptUrl(): Promise<string> {
  const cfg = await fetchServerAppsScriptConfig();
  return cfg.appsScriptUrl;
}

export async function persistServerAppsScriptConfig(url: string, secretToken?: string): Promise<void> {
  try {
    await fetch('/api/apps-script-config', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appsScriptUrl: url,
        ...(secretToken !== undefined ? { secretToken } : {}),
      }),
    });
  } catch {
    // Non-fatal: penyimpanan browser (localStorage, cookie, IndexedDB) tetap aktif
  }
}

export async function persistServerAppsScriptUrl(url: string): Promise<void> {
  await persistServerAppsScriptConfig(url);
}

export async function clearServerAppsScriptUrl(): Promise<void> {
  try {
    await fetch('/api/apps-script-config', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch {
    // Non-fatal
  }
}

export function readAndApplyHashConfig(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#dkb_cfg=')) {
      hashConfigChecked = true;
      return false;
    }
    const rawEncoded = hash.slice('#dkb_cfg='.length).split('&')[0];
    if (!rawEncoded) return false;
    const decoded = JSON.parse(decodeBase64UrlUtf8(rawEncoded));
    const url = normalizeAppsScriptUrl(decoded?.u);
    const secret = String(decoded?.s || '').trim();
    if (isValidAppsScriptUrl(url) && !isAppsScriptDevUrl(url) && secret) {
      setAppsScriptUrl(url);
      setAppsScriptSecretToken(secret);
      setAppsScriptConfigLocked(true);
      hashConfigChecked = true;
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch {}
      void persistServerAppsScriptConfig(url, secret);
      return true;
    }
  } catch {
    // Abaikan hash rusak
  }
  hashConfigChecked = true;
  return false;
}

if (typeof window !== 'undefined') {
  readAndApplyHashConfig();
}

export function buildShareableDeviceConfigUrl(): string {
  if (typeof window === 'undefined') return '';
  const url = getAppsScriptUrl();
  const secret = getAppsScriptSecretToken();
  if (!url || !secret) return '';
  try {
    const encoded = encodeBase64UrlUtf8(JSON.stringify({ u: url, s: secret }));
    return `${window.location.origin}/#dkb_cfg=${encoded}`;
  } catch {
    return '';
  }
}

export async function copyTextSafe(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Lanjut ke fallback textarea
  }
  try {
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Boolean(ok);
    }
  } catch {
    // Ignore
  }
  return false;
}

export async function hydrateAppsScriptConfig(): Promise<{
  appsScriptUrl: string;
  secretToken: string;
  locked: boolean;
}> {
  if (!hashConfigChecked) {
    readAndApplyHashConfig();
  }
  let currentUrl = getAppsScriptUrl();
  let currentSecret = getAppsScriptSecretToken();

  if (!currentUrl || !currentSecret) {
    const [idbUrlRaw, idbSecRaw, serverCfg] = await Promise.all([
      !currentUrl ? idbGet(APPS_SCRIPT_URL_KEY) : Promise.resolve(''),
      !currentSecret ? idbGet(APPS_SCRIPT_SECRET_KEY) : Promise.resolve(''),
      fetchServerAppsScriptConfig(),
    ]);

    const idbUrl = normalizeAppsScriptUrl(idbUrlRaw);
    const validIdbUrl = isValidAppsScriptUrl(idbUrl) && !isAppsScriptDevUrl(idbUrl) ? idbUrl : '';
    const resolvedUrl = currentUrl || serverCfg.appsScriptUrl || validIdbUrl;
    const resolvedSecret = currentSecret || serverCfg.secretToken || idbSecRaw.trim();

    if (resolvedUrl && resolvedUrl !== currentUrl) {
      currentUrl = setAppsScriptUrl(resolvedUrl);
    } else if (currentUrl) {
      setAppsScriptUrl(currentUrl);
    }

    if (resolvedSecret && resolvedSecret !== currentSecret) {
      currentSecret = setAppsScriptSecretToken(resolvedSecret);
    } else if (currentSecret) {
      setAppsScriptSecretToken(currentSecret);
    }

    if (currentUrl && currentSecret) {
      setAppsScriptConfigLocked(true);
      // Jika client sudah punya config namun server /api belum punya (misal cold-start instance baru), sinkronkan diam-diam
      if (!serverCfg.appsScriptUrl || !serverCfg.secretToken) {
        void persistServerAppsScriptConfig(currentUrl, currentSecret);
      }
    }
  } else {
    // Pastikan 4 lapis + kunci permanen tetap sinkron
    setAppsScriptUrl(currentUrl);
    setAppsScriptSecretToken(currentSecret);
    setAppsScriptConfigLocked(true);
    void persistServerAppsScriptConfig(currentUrl, currentSecret);
  }

  return {
    appsScriptUrl: currentUrl,
    secretToken: currentSecret,
    locked: Boolean(currentUrl && currentSecret) || isAppsScriptConfigLocked(),
  };
}

export interface ApiFetchOptions {
  appsScriptUrlOverride?: string;
  secretTokenOverride?: string;
}

function parseUrlAndQuery(inputUrl: string): { route: string; query: Record<string, string> } {
  const parsed = new URL(inputUrl, 'https://local.invalid');
  const query: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { route: parsed.pathname, query };
}

function getHeaderValue(headers: HeadersInit | undefined, name: string): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(name) || headers.get(target) || '';
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => String(k).toLowerCase() === target);
    return found ? String(found[1]) : '';
  }
  const obj = headers as Record<string, string>;
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) {
      return String(obj[k] || '');
    }
  }
  return '';
}

function createSyntheticJsonResponse(payload: any, httpStatusFallback = 200): Response {
  const status = Number(payload?._status ?? payload?.statusCode ?? httpStatusFallback) || 200;
  const serialized = JSON.stringify(payload ?? {});
  return new Response(serialized, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

/**
 * Mengirim permintaan API langsung ke Google Apps Script Web App (`doPost`)
 * dengan `Content-Type: text/plain;charset=utf-8` berisi JSON `{ secretToken, token, route, method, query, body }`.
 */
export async function apiFetch(
  inputUrl: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {}
): Promise<Response> {
  if (inputUrl === '/api/apps-script-config') {
    return fetch(inputUrl, init);
  }

  const scriptUrl = normalizeAppsScriptUrl(options.appsScriptUrlOverride ?? getAppsScriptUrl());
  const secretToken = String(options.secretTokenOverride ?? getAppsScriptSecretToken()).trim();

  const missingClient: string[] = [];
  if (!scriptUrl) missingClient.push('APPS_SCRIPT_URL');
  if (!secretToken) missingClient.push('SECRET_TOKEN');

  if (missingClient.length > 0) {
    return createSyntheticJsonResponse(
      {
        _status: 503,
        configured: false,
        authMode: 'apps_script',
        missingClientConfig: missingClient,
        missingEnv: missingClient,
        error: `Konfigurasi koneksi Apps Script belum lengkap (${missingClient.join(', ')} masih kosong).`,
      },
      503
    );
  }

  const authHeader = getHeaderValue(init.headers, 'authorization');
  const explicitToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  const fallbackToken =
    explicitToken && explicitToken !== 'null' && explicitToken !== 'undefined'
      ? explicitToken
      : getStoredSessionToken();

  const method = (init.method || 'GET').toUpperCase();
  const { route, query } = parseUrlAndQuery(inputUrl);

  let parsedBody: any = undefined;
  if (typeof init.body === 'string' && init.body.trim()) {
    try {
      parsedBody = JSON.parse(init.body);
    } catch {
      parsedBody = init.body;
    }
  } else if (init.body !== undefined) {
    parsedBody = init.body;
  }

  const envelope = {
    secretToken,
    token: fallbackToken,
    route,
    method,
    query,
    body: parsedBody,
  };

  const timeoutController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutTimer = timeoutController
    ? setTimeout(() => {
        timeoutController.abort();
      }, 30000)
    : null;

  let res: Response;
  try {
    res = await fetch(scriptUrl, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(envelope),
      ...(timeoutController ? { signal: timeoutController.signal } : {}),
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Koneksi ke Google Apps Script terlalu lama (timeout). Periksa internet perangkat Anda.');
    }
    throw err;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }

  const rawText = await res.text();
  let jsonData: any = null;
  try {
    jsonData = rawText ? JSON.parse(rawText) : {};
  } catch {
    const looksHtml = rawText.trim().startsWith('<');
    if (res.status === 401 || res.status === 403 || looksHtml) {
      return createSyntheticJsonResponse(
        {
          _status: 401,
          googleDeploymentUnauthorized: true,
          error:
            'Google Apps Script menolak akses (401 Unauthorized / HTML). Pastikan Web App di-deploy dengan URL /exec, "Jalankan sebagai: Saya", dan "Yang memiliki akses: Siapa saja (Anyone)".',
        },
        401
      );
    }
    throw new Error('Respons Google Apps Script bukan JSON yang valid.');
  }

  return createSyntheticJsonResponse(jsonData, res.status);
}

/**
 * Menguji endpoint doGet di Google Apps Script Web App.
 */
export async function callAppsScriptGet(
  route: string,
  query: Record<string, string> = {},
  options: ApiFetchOptions = {}
): Promise<Response> {
  const scriptUrl = normalizeAppsScriptUrl(options.appsScriptUrlOverride ?? getAppsScriptUrl());
  const secretToken = String(options.secretTokenOverride ?? getAppsScriptSecretToken()).trim();

  if (!scriptUrl || !secretToken) {
    const missingClient: string[] = [];
    if (!scriptUrl) missingClient.push('APPS_SCRIPT_URL');
    if (!secretToken) missingClient.push('SECRET_TOKEN');
    return createSyntheticJsonResponse(
      {
        _status: 503,
        configured: false,
        missingClientConfig: missingClient,
        error: `Konfigurasi koneksi Apps Script belum lengkap (${missingClient.join(', ')}).`,
      },
      503
    );
  }

  const params = new URLSearchParams();
  params.set('route', route);
  params.set('secretToken', secretToken);
  const appTok = getStoredSessionToken();
  if (appTok) params.set('token', appTok);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }

  const targetUrl = `${scriptUrl}?${params.toString()}`;
  const res = await fetch(targetUrl, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
  });

  const rawText = await res.text();
  let jsonData: any = null;
  try {
    jsonData = rawText ? JSON.parse(rawText) : {};
  } catch {
    return createSyntheticJsonResponse(
      {
        _status: 401,
        googleDeploymentUnauthorized: true,
        error:
          'Endpoint doGet Apps Script tidak mengembalikan JSON (periksa deployment Web App /exec dan akses Anyone).',
      },
      401
    );
  }
  return createSyntheticJsonResponse(jsonData, res.status);
}

export async function testAppsScriptConnection(
  rawUrl: string,
  rawSecretToken?: string
): Promise<{ ok: boolean; message: string; data?: any }> {
  const cleanUrl = normalizeAppsScriptUrl(rawUrl);
  const cleanSecret = String(rawSecretToken ?? getAppsScriptSecretToken()).trim();

  if (!isValidAppsScriptUrl(cleanUrl)) {
    return {
      ok: false,
      message:
        'URL harus berupa alamat Web App Google Apps Script HTTPS yang valid (https://script.google.com/macros/s/.../exec).',
    };
  }
  if (isAppsScriptDevUrl(cleanUrl)) {
    return {
      ok: false,
      message:
        'URL berakhiran /dev adalah tautan uji coba pribadi dan selalu memicu 401 Unauthorized. Gunakan URL Deployment Produksi yang berakhiran /exec dengan akses "Siapa saja (Anyone)".',
    };
  }
  if (!cleanSecret) {
    return {
      ok: false,
      message: 'Token Rahasia (SECRET_TOKEN) wajib diisi agar sesuai dengan Script Properties di Apps Script.',
    };
  }

  try {
    const res = await apiFetch(
      '/api/setup',
      {
        method: 'POST',
        body: JSON.stringify({ appsScriptUrl: cleanUrl }),
      },
      { appsScriptUrlOverride: cleanUrl, secretTokenOverride: cleanSecret }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return {
        ok: false,
        message: data.error || `Koneksi Apps Script gagal (status ${res.status}).`,
        data,
      };
    }
    return {
      ok: true,
      message: `Terhubung ke Google Apps Script (${data.driveConfigured ? 'Sheets, Drive & GmailApp siap' : 'Sheets siap, cek DRIVE_FOLDER_ID'}).`,
      data,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Gagal menghubungi Web App Google Apps Script.',
    };
  }
}

export interface SystemCheckResult {
  checkedAt: string;
  ok: boolean;
  clientConfigured: boolean;
  emptyClientKeys: string[];
  emptyBackendKeys: string[];
  tokenAuthorized: boolean;
  tokenError?: string;
  doPostOk: boolean;
  doGetOk: boolean;
  sheets: {
    ok: boolean;
    configured: boolean;
    spreadsheetName: string;
    tabsCount: number;
    expectedTabs: number;
    missingTabs: string[];
    error: string;
  };
  drive: {
    ok: boolean;
    configured: boolean;
    folderName: string;
    error: string;
  };
  gmail: {
    ok: boolean;
    senderEmail: string;
  };
  serverTime?: string;
}

/**
 * Menguji koneksi langsung ke Google Sheets & Google Drive via Apps Script
 * serta mengembalikan daftar bagian konfigurasi yang masih kosong (TANPA menampilkan nilainya).
 */
export async function runAppsScriptSystemCheck(): Promise<SystemCheckResult> {
  const emptyClientKeys = getMissingClientConfig();
  const checkedAt = new Date().toISOString();

  const defaultResult: SystemCheckResult = {
    checkedAt,
    ok: false,
    clientConfigured: emptyClientKeys.length === 0,
    emptyClientKeys,
    emptyBackendKeys: [],
    tokenAuthorized: false,
    doPostOk: false,
    doGetOk: false,
    sheets: {
      ok: false,
      configured: false,
      spreadsheetName: '',
      tabsCount: 0,
      expectedTabs: 13,
      missingTabs: [],
      error: emptyClientKeys.length > 0 ? 'Koneksi klien ke Apps Script belum lengkap.' : '',
    },
    drive: {
      ok: false,
      configured: false,
      folderName: '',
      error: emptyClientKeys.length > 0 ? 'Koneksi klien ke Apps Script belum lengkap.' : '',
    },
    gmail: {
      ok: false,
      senderEmail: '',
    },
  };

  if (emptyClientKeys.length > 0) {
    return defaultResult;
  }

  try {
    const [postRes, getRes] = await Promise.all([
      apiFetch('/api/system-check', { method: 'POST', body: JSON.stringify({}) }),
      callAppsScriptGet('/api/system-check').catch(() => null),
    ]);

    const postData = await postRes.json().catch(() => ({}));
    const getData = getRes ? await getRes.json().catch(() => ({})) : null;

    if (postRes.status === 401 || postData?.unauthorizedToken || postData?.googleDeploymentUnauthorized) {
      const backendMissing = Array.isArray(postData?.missingConfig)
        ? (postData.missingConfig as string[])
        : [];
      return {
        ...defaultResult,
        tokenAuthorized: false,
        tokenError: postData?.error || 'Token rahasia ditolak oleh Google Apps Script (401 Unauthorized).',
        emptyBackendKeys: backendMissing,
        sheets: {
          ...defaultResult.sheets,
          error: postData?.error || 'Ditolak karena token rahasia atau deployment Web App.',
        },
        drive: {
          ...defaultResult.drive,
          error: postData?.error || 'Ditolak karena token rahasia atau deployment Web App.',
        },
      };
    }

    const emptyBackendKeys = Array.isArray(postData?.missingConfig)
      ? (postData.missingConfig as string[])
      : [];

    const sheetsOk = Boolean(postData?.sheets?.ok);
    const driveOk = Boolean(postData?.drive?.ok);
    const doPostOk = postRes.ok;
    const doGetOk = Boolean(getRes && getRes.ok && getData && !getData.unauthorizedToken);

    return {
      checkedAt,
      ok:
        emptyClientKeys.length === 0 &&
        emptyBackendKeys.length === 0 &&
        sheetsOk &&
        driveOk &&
        doPostOk,
      clientConfigured: true,
      emptyClientKeys: [],
      emptyBackendKeys,
      tokenAuthorized: true,
      doPostOk,
      doGetOk,
      sheets: {
        ok: sheetsOk,
        configured: Boolean(postData?.sheets?.configured),
        spreadsheetName: String(postData?.sheets?.spreadsheetName || ''),
        tabsCount: Number(postData?.sheets?.tabsCount || 0),
        expectedTabs: Number(postData?.sheets?.expectedTabs || 13),
        missingTabs: Array.isArray(postData?.sheets?.missingTabs) ? postData.sheets.missingTabs : [],
        error: String(postData?.sheets?.error || ''),
      },
      drive: {
        ok: driveOk,
        configured: Boolean(postData?.drive?.configured),
        folderName: String(postData?.drive?.folderName || ''),
        error: String(postData?.drive?.error || ''),
      },
      gmail: {
        ok: Boolean(postData?.gmail?.ok),
        senderEmail: String(postData?.gmail?.senderEmail || ''),
      },
      serverTime: postData?.serverTime,
    };
  } catch (err: any) {
    return {
      ...defaultResult,
      tokenError: err?.message || 'Gagal menghubungi endpoint Google Apps Script.',
      sheets: {
        ...defaultResult.sheets,
        error: err?.message || 'Gagal menghubungi Google Apps Script.',
      },
      drive: {
        ...defaultResult.drive,
        error: err?.message || 'Gagal menghubungi Google Apps Script.',
      },
    };
  }
}
