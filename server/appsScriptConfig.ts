import fs from 'fs';
import path from 'path';

const CONFIG_FILE_PATH = path.resolve(process.cwd(), '.apps-script-config.json');

let inMemoryAppsScriptUrl = '';

export function normalizeServerAppsScriptUrl(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function isValidServerAppsScriptUrl(raw?: string | null): boolean {
  const clean = normalizeServerAppsScriptUrl(raw);
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') return false;
    return parsed.hostname === 'script.google.com' || parsed.hostname === 'script.googleusercontent.com';
  } catch {
    return false;
  }
}

export function getSavedAppsScriptUrl(): string {
  if (inMemoryAppsScriptUrl && isValidServerAppsScriptUrl(inMemoryAppsScriptUrl)) {
    return inMemoryAppsScriptUrl;
  }

  const envUrl = normalizeServerAppsScriptUrl(
    process.env.APPS_SCRIPT_URL || process.env.VITE_APPS_SCRIPT_URL || ''
  );
  if (envUrl && isValidServerAppsScriptUrl(envUrl)) {
    inMemoryAppsScriptUrl = envUrl;
    return envUrl;
  }

  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const fromFile = normalizeServerAppsScriptUrl(parsed?.appsScriptUrl);
      if (fromFile && isValidServerAppsScriptUrl(fromFile)) {
        inMemoryAppsScriptUrl = fromFile;
        return fromFile;
      }
    }
  } catch {
    // Ignore read errors on read-only environments
  }

  return '';
}

export function saveAppsScriptUrlConfig(rawUrl: string): string {
  const clean = normalizeServerAppsScriptUrl(rawUrl);
  if (!isValidServerAppsScriptUrl(clean)) {
    throw new Error('URL Web App Google Apps Script tidak valid.');
  }

  inMemoryAppsScriptUrl = clean;
  process.env.APPS_SCRIPT_URL = clean;

  try {
    fs.writeFileSync(
      CONFIG_FILE_PATH,
      JSON.stringify({ appsScriptUrl: clean, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch {
    // Non-fatal in read-only serverless environments
  }

  return clean;
}

export function clearAppsScriptUrlConfig(): void {
  inMemoryAppsScriptUrl = '';
  delete process.env.APPS_SCRIPT_URL;
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      fs.unlinkSync(CONFIG_FILE_PATH);
    }
  } catch {
    // Non-fatal in read-only serverless environments
  }
}
