/**
 * Utility kompresi foto di frontend (lebar maks 800 px, JPEG kualitas 70%)
 * dan resolver sumber gambar (Google Drive fileId diproksi lewat /api/photos?id=...).
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
  const res = await fetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

/**
 * Mengubah nilai ID file Drive menjadi URL proxy backend (/api/photos?id=<fileId>)
 * sambil mempertahankan URL preset SVG atau http(s)://.
 */
export function resolvePhotoSrc(val?: string | null): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }
  // Drive fileId
  return `/api/photos?id=${encodeURIComponent(trimmed)}`;
}
