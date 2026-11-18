import {
  getSavedAppsScriptUrl,
  getSavedAppsScriptConfig,
  saveAppsScriptConfig,
  clearAppsScriptUrlConfig,
  isValidServerAppsScriptUrl,
} from './appsScriptConfig.ts';

export interface ApiRequest {
  method: string;
  url: string;
  query: Record<string, string>;
  body: any;
  headers: Record<string, string | undefined>;
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: any;
}

const COOKIE_URL_KEY = 'dkb_as_url';
const COOKIE_SECRET_KEY = 'dkb_as_sec';
const COOKIE_LOCK_KEY = 'dkb_as_lock';
const ONE_YEAR_SECONDS = 31536000;

function parseCookiesFromHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function buildConfigSetCookies(
  req: ApiRequest,
  url: string,
  secretToken: string,
  locked: boolean
): string[] {
  const proto = String(req.headers?.['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = proto === 'https';
  const secureAttr = isHttps ? '; Secure' : '';
  const attrs = `Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secureAttr}`;
  const clearAttrs = `Path=/; Max-Age=0; SameSite=Lax${secureAttr}`;

  return [
    url
      ? `${COOKIE_URL_KEY}=${encodeURIComponent(url)}; ${attrs}`
      : `${COOKIE_URL_KEY}=; ${clearAttrs}`,
    secretToken
      ? `${COOKIE_SECRET_KEY}=${encodeURIComponent(secretToken)}; ${attrs}`
      : `${COOKIE_SECRET_KEY}=; ${clearAttrs}`,
    locked
      ? `${COOKIE_LOCK_KEY}=1; ${attrs}`
      : `${COOKIE_LOCK_KEY}=; ${clearAttrs}`,
  ];
}

export class JsonResponse {
  static ok(data: any, headers?: Record<string, string | string[]>): ApiResponse {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: data,
    };
  }

  static badRequest(message: string, details?: any): ApiResponse {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message, ...(details ? { details, ...details } : {}) },
    };
  }

  static serviceUnavailable(message: string, missingEnv: string[] = []): ApiResponse {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: message,
        configured: false,
        authMode: 'apps_script',
        missingEnv,
        savedAppsScriptUrl: getSavedAppsScriptUrl() || undefined,
      },
    };
  }
}

/**
 * Minimal static host helper API.
 * Seluruh operasi database Google Sheets, Google Drive, autentikasi, dan email
 * berjalan langsung melalui backend Google Apps Script Web App (doGet & doPost).
 */
export async function handleApiRoute(req: ApiRequest): Promise<ApiResponse> {
  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;
  const method = req.method.toUpperCase();

  if (pathname === '/api/apps-script-config') {
    const cookies = parseCookiesFromHeader(req.headers?.cookie);

    if (method === 'GET') {
      let cfg = getSavedAppsScriptConfig();
      const cookieUrl = String(cookies[COOKIE_URL_KEY] || '').trim();
      const cookieSec = String(cookies[COOKIE_SECRET_KEY] || '').trim();

      if ((!cfg.appsScriptUrl || !cfg.secretToken) && cookieUrl && isValidServerAppsScriptUrl(cookieUrl)) {
        const mergedUrl = cfg.appsScriptUrl || cookieUrl;
        const mergedSec = cfg.secretToken || cookieSec;
        if (mergedUrl && mergedSec) {
          cfg = saveAppsScriptConfig(mergedUrl, mergedSec);
        } else {
          cfg = { appsScriptUrl: mergedUrl, secretToken: mergedSec };
        }
      }

      const configured = Boolean(cfg.appsScriptUrl && cfg.secretToken);
      const headers: Record<string, string | string[]> = {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      };

      if (configured && (cookieUrl !== cfg.appsScriptUrl || cookieSec !== cfg.secretToken || cookies[COOKIE_LOCK_KEY] !== '1')) {
        headers['Set-Cookie'] = buildConfigSetCookies(req, cfg.appsScriptUrl, cfg.secretToken, true);
      }

      return JsonResponse.ok(
        {
          appsScriptUrl: cfg.appsScriptUrl,
          secretToken: cfg.secretToken,
          configured,
          locked: configured,
        },
        headers
      );
    }
    if (method === 'POST') {
      const rawUrl = String(req.body?.appsScriptUrl || '').trim();
      const rawSecret = req.body?.secretToken !== undefined ? String(req.body.secretToken).trim() : undefined;
      if (!isValidServerAppsScriptUrl(rawUrl)) {
        return JsonResponse.badRequest(
          'URL harus berupa alamat Web App Google Apps Script HTTPS yang valid (https://script.google.com/macros/s/.../exec).'
        );
      }
      const saved = saveAppsScriptConfig(rawUrl, rawSecret);
      const configured = Boolean(saved.appsScriptUrl && saved.secretToken);
      const setCookies = buildConfigSetCookies(req, saved.appsScriptUrl, saved.secretToken, configured);
      return JsonResponse.ok(
        {
          success: true,
          appsScriptUrl: saved.appsScriptUrl,
          configured,
          locked: configured,
        },
        {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Set-Cookie': setCookies,
        }
      );
    }
    if (method === 'DELETE') {
      clearAppsScriptUrlConfig();
      const clearCookies = buildConfigSetCookies(req, '', '', false);
      return JsonResponse.ok(
        { success: true, appsScriptUrl: '', configured: false, locked: false },
        {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Set-Cookie': clearCookies,
        }
      );
    }
    return JsonResponse.badRequest('Method tidak didukung untuk /api/apps-script-config.');
  }

  return JsonResponse.serviceUnavailable(
    'Backend aplikasi menggunakan Google Apps Script Web App. Atur URL Web App dan Token Rahasia (SECRET_TOKEN) di pengaturan koneksi.',
    ['APPS_SCRIPT_URL', 'SECRET_TOKEN']
  );
}
