/**
 * Client API router khusus Google Apps Script Web App backend.
 * - Mengirim POST dengan Content-Type: text/plain;charset=utf-8 berisi JSON envelope
 *   { secretToken, token, route, method, query, body }.
 * - Mendukung doGet (via query string) dan doPost (via text/plain JSON) serta validasi SECRET_TOKEN wajib.
 */

const APPS_SCRIPT_URL_KEY = 'dkb_apps_script_url';
const APPS_SCRIPT_SECRET_KEY = 'dkb_apps_script_secret';
const SESSION_STORAGE_KEY = 'dkb_session';

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
  try {
    const stored = normalizeAppsScriptUrl(localStorage.getItem(APPS_SCRIPT_URL_KEY));
    if (stored && isValidAppsScriptUrl(stored) && !isAppsScriptDevUrl(stored)) return stored;
  } catch {}
  try {
    const sessionStored = normalizeAppsScriptUrl(sessionStorage.getItem(APPS_SCRIPT_URL_KEY));
    if (sessionStored && isValidAppsScriptUrl(sessionStored) && !isAppsScriptDevUrl(sessionStored)) {
      try {
        localStorage.setItem(APPS_SCRIPT_URL_KEY, sessionStored);
      } catch {}
      return sessionStored;
    }
  } catch {}
  const envUrl = normalizeAppsScriptUrl((import.meta as any)?.env?.VITE_APPS_SCRIPT_URL);
  return isValidAppsScriptUrl(envUrl) && !isAppsScriptDevUrl(envUrl) ? envUrl : '';
}

export function setAppsScriptUrl(url: string): string {
  const normalized = normalizeAppsScriptUrl(url);
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
  return normalized;
}

export function clearAppsScriptUrl(): void {
  try {
    localStorage.removeItem(APPS_SCRIPT_URL_KEY);
  } catch {}
  try {
    sessionStorage.removeItem(APPS_SCRIPT_URL_KEY);
  } catch {}
}

export function getAppsScriptSecretToken(): string {
  try {
    const stored = (localStorage.getItem(APPS_SCRIPT_SECRET_KEY) || '').trim();
    if (stored) return stored;
  } catch {}
  try {
    const sessionStored = (sessionStorage.getItem(APPS_SCRIPT_SECRET_KEY) || '').trim();
    if (sessionStored) {
      try {
        localStorage.setItem(APPS_SCRIPT_SECRET_KEY, sessionStored);
      } catch {}
      return sessionStored;
    }
  } catch {}
  const envSecret = String((import.meta as any)?.env?.VITE_APPS_SCRIPT_SECRET_TOKEN || '').trim();
  return envSecret;
}

export function setAppsScriptSecretToken(secretToken: string): string {
  const clean = (secretToken || '').trim();
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
  return clean;
}

export function clearAppsScriptSecretToken(): void {
  try {
    localStorage.removeItem(APPS_SCRIPT_SECRET_KEY);
  } catch {}
  try {
    sessionStorage.removeItem(APPS_SCRIPT_SECRET_KEY);
  } catch {}
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

export async function fetchServerAppsScriptUrl(): Promise<string> {
  try {
    const res = await fetch('/api/apps-script-config', {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    const url = normalizeAppsScriptUrl(data?.appsScriptUrl);
    return isValidAppsScriptUrl(url) && !isAppsScriptDevUrl(url) ? url : '';
  } catch {
    return '';
  }
}

export async function persistServerAppsScriptUrl(url: string): Promise<void> {
  try {
    await fetch('/api/apps-script-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appsScriptUrl: url }),
    });
  } catch {
    // Non-fatal: localStorage tetap menyimpan URL secara permanen di browser
  }
}

export async function clearServerAppsScriptUrl(): Promise<void> {
  try {
    await fetch('/api/apps-script-config', {
      method: 'DELETE',
    });
  } catch {
    // Non-fatal
  }
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

  const res = await fetch(scriptUrl, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(envelope),
  });

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
