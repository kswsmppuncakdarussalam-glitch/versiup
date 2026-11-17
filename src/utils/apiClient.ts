/**
 * Client API router supporting both:
 * 1. Google Apps Script Web App backend (CORS-simple POST text/plain & JSON envelope)
 * 2. Local Express / Vercel /api/* endpoints (with Google Workspace OAuth headers)
 */

const APPS_SCRIPT_URL_KEY = 'dkb_apps_script_url';
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

export function captureAppsScriptUrlFromLocation(): string {
  if (typeof window === 'undefined') return '';
  try {
    const currentUrl = new URL(window.location.href);
    let paramUrl =
      currentUrl.searchParams.get('script') ||
      currentUrl.searchParams.get('appsScript') ||
      currentUrl.searchParams.get('apps_script') ||
      '';

    if (!paramUrl && currentUrl.hash) {
      const hashQuery = currentUrl.hash.replace(/^#/, '');
      const hashParams = new URLSearchParams(hashQuery);
      paramUrl =
        hashParams.get('script') ||
        hashParams.get('appsScript') ||
        hashParams.get('apps_script') ||
        '';
    }

    const normalized = normalizeAppsScriptUrl(paramUrl);
    if (normalized && isValidAppsScriptUrl(normalized) && !isAppsScriptDevUrl(normalized)) {
      setAppsScriptUrl(normalized);
      currentUrl.searchParams.delete('script');
      currentUrl.searchParams.delete('appsScript');
      currentUrl.searchParams.delete('apps_script');
      if (currentUrl.hash && /(?:script|appsScript|apps_script)=/i.test(currentUrl.hash)) {
        currentUrl.hash = '';
      }
      try {
        window.history.replaceState({}, document.title, currentUrl.toString());
      } catch {}
      return normalized;
    }
  } catch {}
  return '';
}

export function getAppsScriptUrl(): string {
  const fromLocation = captureAppsScriptUrlFromLocation();
  if (fromLocation) return fromLocation;

  try {
    const stored = normalizeAppsScriptUrl(localStorage.getItem(APPS_SCRIPT_URL_KEY));
    if (stored && !isAppsScriptDevUrl(stored)) return stored;
  } catch {}
  try {
    const sessionStored = normalizeAppsScriptUrl(sessionStorage.getItem(APPS_SCRIPT_URL_KEY));
    if (sessionStored && !isAppsScriptDevUrl(sessionStored)) {
      try {
        localStorage.setItem(APPS_SCRIPT_URL_KEY, sessionStored);
      } catch {}
      return sessionStored;
    }
  } catch {}
  const envUrl = normalizeAppsScriptUrl((import.meta as any)?.env?.VITE_APPS_SCRIPT_URL);
  return envUrl;
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
    // Non-fatal fallback: localStorage still retains URL
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
  forceLocalApi?: boolean;
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
 * Drop-in replacement for window.fetch('/api/...', init) that automatically
 * dispatches to Google Apps Script Web App when configured, using CORS simple requests
 * (Content-Type: text/plain;charset=utf-8, credentials: omit) so Apps Script does not fail on preflight OPTIONS.
 */
export async function apiFetch(
  inputUrl: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {}
): Promise<Response> {
  const scriptUrl = options.forceLocalApi
    ? ''
    : normalizeAppsScriptUrl(options.appsScriptUrlOverride ?? getAppsScriptUrl());

  const authHeader = getHeaderValue(init.headers, 'authorization');
  const explicitToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  const fallbackToken = explicitToken && explicitToken !== 'null' && explicitToken !== 'undefined'
    ? explicitToken
    : getStoredSessionToken();

  if (!scriptUrl || !inputUrl.startsWith('/api')) {
    if (fallbackToken && !authHeader && inputUrl.startsWith('/api')) {
      const nextHeaders = new Headers(init.headers || {});
      nextHeaders.set('Authorization', `Bearer ${fallbackToken}`);
      return fetch(inputUrl, { ...init, headers: nextHeaders });
    }
    return fetch(inputUrl, init);
  }

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
    route,
    method,
    query,
    token: fallbackToken,
    body: parsedBody,
  };

  // Use text/plain;charset=utf-8 + credentials:'omit' for reliable cross-origin Apps Script POST from Vercel
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
          _status: res.status === 401 || res.status === 403 ? 401 : 502,
          googleDeploymentUnauthorized: true,
          error:
            'Google Apps Script menolak akses (401 Unauthorized / HTML). Pastikan Web App di-deploy dengan URL /exec, "Jalankan sebagai: Saya", dan "Yang memiliki akses: Siapa saja (Anyone)".',
        },
        401
      );
    }
    throw new Error('Respons Google Apps Script tidak valid.');
  }

  return createSyntheticJsonResponse(jsonData, res.status);
}

export async function testAppsScriptConnection(
  rawUrl: string
): Promise<{ ok: boolean; message: string; data?: any }> {
  const cleanUrl = normalizeAppsScriptUrl(rawUrl);
  if (!isValidAppsScriptUrl(cleanUrl)) {
    return {
      ok: false,
      message: 'URL harus berupa alamat Web App Google Apps Script HTTPS yang valid (https://script.google.com/macros/s/.../exec).',
    };
  }
  if (isAppsScriptDevUrl(cleanUrl)) {
    return {
      ok: false,
      message: 'URL berakhiran /dev adalah tautan uji coba pribadi dan selalu memicu 401 Unauthorized. Gunakan URL Deployment Produksi yang berakhiran /exec dengan akses "Siapa saja (Anyone)".',
    };
  }

  try {
    const res = await apiFetch(
      '/api/setup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appsScriptUrl: cleanUrl }),
      },
      { appsScriptUrlOverride: cleanUrl }
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
      message: `Terhubung ke Google Apps Script (${data.emailConnected ? 'GmailApp & Sheets/Drive siap' : 'Sheets/Drive siap'}).`,
      data,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Gagal menghubungi Web App Google Apps Script.',
    };
  }
}
