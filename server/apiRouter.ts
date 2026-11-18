import {
  getSavedAppsScriptUrl,
  saveAppsScriptUrlConfig,
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
  headers: Record<string, string>;
  body: any;
}

export class JsonResponse {
  static ok(data: any, headers?: Record<string, string>): ApiResponse {
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
    if (method === 'GET') {
      return JsonResponse.ok(
        { appsScriptUrl: getSavedAppsScriptUrl() },
        { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
      );
    }
    if (method === 'POST') {
      const rawUrl = String(req.body?.appsScriptUrl || '').trim();
      if (!isValidServerAppsScriptUrl(rawUrl)) {
        return JsonResponse.badRequest(
          'URL harus berupa alamat Web App Google Apps Script HTTPS yang valid (https://script.google.com/macros/s/.../exec).'
        );
      }
      const saved = saveAppsScriptUrlConfig(rawUrl);
      return JsonResponse.ok({ success: true, appsScriptUrl: saved });
    }
    if (method === 'DELETE') {
      clearAppsScriptUrlConfig();
      return JsonResponse.ok({ success: true, appsScriptUrl: '' });
    }
    return JsonResponse.badRequest('Method tidak didukung untuk /api/apps-script-config.');
  }

  return JsonResponse.serviceUnavailable(
    'Backend aplikasi menggunakan Google Apps Script Web App. Atur URL Web App dan Token Rahasia (SECRET_TOKEN) di pengaturan koneksi.',
    ['APPS_SCRIPT_URL', 'SECRET_TOKEN']
  );
}
