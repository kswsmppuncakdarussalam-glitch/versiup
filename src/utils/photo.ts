import { apiFetch, hasCompleteAppsScriptConfig } from './apiClient.js';

/**
 * Utility kompresi foto di frontend (lebar maks 800 px, JPEG kualitas 70%)
 * dan pengambil gambar privat melalui endpoint Google Apps Script (tanpa folder Drive publik).
 */

export async function compressPhotoMax800Jpeg(
  input: File | Blob | string
): Promise<{ dataUrl: string; base64: string }> {
  let src = '';
  let revokeUrl = false;

  if (typeof input === 'string') {
    src = input.startsWith('data:') ? input : `data:image/jpeg;base64,${input}`;
  } else {
    src = URL.createObjectURL(input);
    revokeUrl = true;
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Gagal memuat gambar untuk kompresi.'));
      el.src = src;
    });

    const MAX_WIDTH = 800;
    let width = img.naturalWidth || img.width || 800;
    let height = img.naturalHeight || img.height || 600;

    if (width > MAX_WIDTH) {
      height = Math.max(1, Math.round((height * MAX_WIDTH) / width));
      width = MAX_WIDTH;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context tidak tersedia.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    return { dataUrl, base64 };
  } finally {
    if (revokeUrl) {
      URL.revokeObjectURL(src);
    }
  }
}

const driveBlobCache = new Map<string, string>();
const driveMissingCache = new Map<string, number>();
const MISSING_CACHE_TTL_MS = 60_000;

function getStoredAppToken(): string {
  try {
    const raw = localStorage.getItem('dkb_session');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === 'string' ? parsed.token : '';
  } catch {
    return '';
  }
}

async function refreshStoredAppToken(): Promise<string> {
  const currentTok = getStoredAppToken();
  if (!currentTok) return '';
  try {
    const res = await apiFetch('/api/auth?action=refresh_session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentTok}`,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.token) {
      window.dispatchEvent(new CustomEvent('dkb-app-token-refreshed', { detail: { token: data.token } }));
      return data.token as string;
    }
    if (res.status === 401 && (data?.unauthorizedToken || data?.googleDeploymentUnauthorized)) {
      window.dispatchEvent(new CustomEvent('dkb-apps-script-unauthorized', { detail: data }));
    }
  } catch {}
  return '';
}

function handlePhotoAuth401(data: any) {
  if (data?.unauthorizedToken || data?.googleDeploymentUnauthorized) {
    window.dispatchEvent(new CustomEvent('dkb-apps-script-unauthorized', { detail: data }));
  }
}

export function extractDriveFileId(val?: string | null): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('/')) {
    return '';
  }
  if (/^(https?:\/\/)/i.test(trimmed)) {
    const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
    if (fileMatch) return fileMatch[1];
    const queryMatch = trimmed.match(/drive\.google\.com\/(?:uc|open|thumbnail)\b[^#]*[?&]id=([a-zA-Z0-9_-]+)/i);
    if (queryMatch) return queryMatch[1];
    const lh3Match = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i);
    if (lh3Match) return lh3Match[1];
    return '';
  }
  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

export async function uploadPhotoToBackend(
  input: File | Blob | string,
  fileName?: string
): Promise<string> {
  const { base64 } = await compressPhotoMax800Jpeg(input);

  const sendUpload = async (appTokOverride?: string) => {
    const appToken = appTokOverride || getStoredAppToken();
    const res = await apiFetch('/api/photos', {
      method: 'POST',
      headers: {
        ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
      },
      body: JSON.stringify({
        base64,
        fileName: fileName || `foto_${Date.now()}.jpg`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  let { res, data } = await sendUpload();
  if (res.status === 401) {
    if (data?.unauthorizedToken || data?.googleDeploymentUnauthorized) {
      handlePhotoAuth401(data);
      throw new Error(data.error || 'Token rahasia atau deployment Apps Script ditolak.');
    }
    const nextTok = await refreshStoredAppToken();
    if (nextTok) {
      const retried = await sendUpload(nextTok);
      res = retried.res;
      data = retried.data;
    }
  }

  if (!res.ok || !data.fileId) {
    throw new Error(data.error || `Gagal mengunggah foto ke Google Drive (HTTP ${res.status}).`);
  }
  driveMissingCache.delete(data.fileId);
  return data.fileId;
}

export function isDirectPhotoUrl(val?: string | null): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (extractDriveFileId(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('blob:')
  );
}

function base64ToBlob(base64: string, mimeType = 'image/jpeg'): Blob {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const byteChars = atob(clean);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

/**
 * Mengambil foto privat dari Google Drive melalui endpoint Apps Script (/api/photos)
 * dan menyimpan Object URL di memori sehingga folder Google Drive tidak perlu publik.
 */
export async function fetchAuthorizedDrivePhotoUrl(fileId: string): Promise<string> {
  const trimmed = (fileId || '').trim();
  if (!trimmed) return '';
  if (isDirectPhotoUrl(trimmed)) return trimmed;

  const clean = extractDriveFileId(trimmed) || trimmed;
  const cached = driveBlobCache.get(clean);
  if (cached) return cached;

  const missingAt = driveMissingCache.get(clean);
  if (missingAt && Date.now() - missingAt < MISSING_CACHE_TTL_MS) {
    return '';
  }

  if (!hasCompleteAppsScriptConfig()) {
    return '';
  }

  try {
    const appToken = getStoredAppToken();
    const res = await apiFetch(`/api/photos?id=${encodeURIComponent(clean)}`, {
      method: 'GET',
      headers: {
        ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
      },
    });
    if (!res.ok) {
      if (res.status === 401) {
        const errData = await res.json().catch(() => ({}));
        handlePhotoAuth401(errData);
      } else if (res.status === 404 || res.status === 400) {
        driveMissingCache.set(clean, Date.now());
      }
      return '';
    }

    const data = await res.json().catch(() => ({}));
    if (data?.notFound) {
      driveMissingCache.set(clean, Date.now());
      return '';
    }
    if (data?.base64) {
      const blob = base64ToBlob(data.base64, data.mimeType || 'image/jpeg');
      const objectUrl = URL.createObjectURL(blob);
      driveBlobCache.set(clean, objectUrl);
      return objectUrl;
    }
    if (data?.dataUrl) {
      driveBlobCache.set(clean, data.dataUrl);
      return data.dataUrl;
    }
    return '';
  } catch {
    return '';
  }
}

export function resolvePhotoSrc(val?: string | null): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (isDirectPhotoUrl(trimmed)) {
    return trimmed;
  }
  const clean = extractDriveFileId(trimmed) || trimmed;
  const cached = driveBlobCache.get(clean);
  if (cached) return cached;
  return '';
}
