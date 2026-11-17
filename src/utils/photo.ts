import { getGoogleAccessToken } from './googleAuth.js';
import { apiFetch, getAppsScriptUrl } from './apiClient.js';

/**
 * Utility kompresi foto di frontend (lebar maks 800 px, JPEG kualitas 70%)
 * dan resolver sumber gambar (Google Drive fileId diproksi lewat /api/photos?id=... atau Apps Script).
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

export async function uploadPhotoToBackend(
  input: File | Blob | string,
  fileName?: string
): Promise<string> {
  const { base64 } = await compressPhotoMax800Jpeg(input);
  const googleToken = getGoogleAccessToken();
  const res = await apiFetch('/api/photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(googleToken ? { 'X-Google-Access-Token': googleToken } : {}),
    },
    body: JSON.stringify({
      base64,
      fileName: fileName || `foto_${Date.now()}.jpg`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.fileId) {
    throw new Error(data.error || `Gagal mengunggah foto ke Google Drive (HTTP ${res.status}).`);
  }
  return data.fileId;
}

const driveBlobCache = new Map<string, string>();

export function isDirectPhotoUrl(val?: string | null): boolean {
  if (!val) return false;
  const trimmed = val.trim();
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
 * Fetch Drive photo securely via Apps Script or X-Google-Access-Token and cache object URL in memory.
 */
export async function fetchAuthorizedDrivePhotoUrl(fileId: string): Promise<string> {
  const clean = fileId.trim();
  if (!clean) return '';
  if (isDirectPhotoUrl(clean)) return clean;

  const cached = driveBlobCache.get(clean);
  if (cached) return cached;

  const appsScriptUrl = getAppsScriptUrl();
  const googleToken = getGoogleAccessToken();
  if (!appsScriptUrl && !googleToken) {
    return `/api/photos?id=${encodeURIComponent(clean)}`;
  }

  const res = await apiFetch(`/api/photos?id=${encodeURIComponent(clean)}`, {
    method: 'GET',
    headers: googleToken ? { 'X-Google-Access-Token': googleToken } : {},
  });
  if (!res.ok) {
    return '';
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json') || appsScriptUrl) {
    const data = await res.json().catch(() => ({}));
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
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  driveBlobCache.set(clean, objectUrl);
  return objectUrl;
}

/**
 * Mengubah nilai ID file Drive menjadi URL proxy backend (/api/photos?id=<fileId>)
 * sambil mempertahankan URL preset SVG atau http(s)://.
 */
export function resolvePhotoSrc(val?: string | null): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (isDirectPhotoUrl(trimmed)) {
    return trimmed;
  }
  const cached = driveBlobCache.get(trimmed);
  if (cached) return cached;
  return `/api/photos?id=${encodeURIComponent(trimmed)}`;
}

