/**
 * Client API router supporting both:
 * 1. Google Apps Script Web App backend (CORS-simple POST text/plain & JSON envelope)
 * 2. Local Express / Vercel /api/* endpoints (with Google Workspace OAuth headers)
 */

const APPS_SCRIPT_URL_KEY = 'dkb_apps_script_url';

export function normalizeAppsScriptUrl(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
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
    if (stored) return stored;
  } catch {}
  try {
    const sessionStored = normalizeAppsScriptUrl(sessionStorage.getItem(APPS_SCRIPT_URL_KEY));
    if (sessionStored) {
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

export async function fetchServerAppsScriptUrl(): Promise<string> {
  try {
    const res = await fetch('/api/apps-script-config', {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    const url = normalizeAppsScriptUrl(data?.appsScriptUrl);
    return isValidAppsScriptUrl(url) ? url : '';
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
 * (Content-Type: text/plain;charset=utf-8) so Apps Script does not fail on preflight OPTIONS.
 */
export async function apiFetch(
  inputUrl: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {}
): Promise<Response> {
  const scriptUrl = options.forceLocalApi
    ? ''
    : normalizeAppsScriptUrl(options.appsScriptUrlOverride ?? getAppsScriptUrl());

  if (!scriptUrl || !inputUrl.startsWith('/api')) {
    return fetch(inputUrl, init);
  }

  const method = (init.method || 'GET').toUpperCase();
  const { route, query } = parseUrlAndQuery(inputUrl);
  const authHeader = getHeaderValue(init.headers, 'authorization');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();

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
    token,
    body: parsedBody,
  };

  // Use text/plain;charset=utf-8 to avoid browser CORS preflight (Apps Script has no doOptions)
  const res = await fetch(scriptUrl, {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(envelope),
  });

  const rawText = await res.text();
  let jsonData: any = {};
  try {
    jsonData = rawText ? JSON.parse(rawText) : {};
  } catch {
    const looksHtml = rawText.trim().startsWith('<');
    throw new Error(
      looksHtml
        ? 'URL Google Apps Script mengembalikan HTML (bukan JSON). Pastikan Web App di-deploy dengan akses "Siapa saja (Anyone)" dan menggunakan URL /exec.'
        : 'Respons Google Apps Script tidak valid.'
    );
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

  try {
    const res = await apiFetch('/api/setup', { method: 'GET' }, { appsScriptUrlOverride: cleanUrl });
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
