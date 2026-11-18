import fs from 'fs';
import path from 'path';
import os from 'os';

const PRIMARY_CONFIG_PATH = path.resolve(process.cwd(), '.apps-script-config.json');
const TMP_CONFIG_PATH = path.join(os.tmpdir(), '.dkb-apps-script-config.json');

let inMemoryAppsScriptUrl = '';
let inMemorySecretToken = '';

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

function readConfigFromFile(): { appsScriptUrl: string; secretToken: string } {
  for (const filePath of [PRIMARY_CONFIG_PATH, TMP_CONFIG_PATH]) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const url = normalizeServerAppsScriptUrl(parsed?.appsScriptUrl);
        const sec = String(parsed?.secretToken || '').trim();
        if (url || sec) {
          return {
            appsScriptUrl: isValidServerAppsScriptUrl(url) ? url : '',
            secretToken: sec,
          };
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  return { appsScriptUrl: '', secretToken: '' };
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

  const fromFile = readConfigFromFile();
  if (fromFile.appsScriptUrl && isValidServerAppsScriptUrl(fromFile.appsScriptUrl)) {
    inMemoryAppsScriptUrl = fromFile.appsScriptUrl;
    if (fromFile.secretToken && !inMemorySecretToken) {
      inMemorySecretToken = fromFile.secretToken;
    }
    return fromFile.appsScriptUrl;
  }

  return '';
}

export function getSavedAppsScriptSecretToken(): string {
  if (inMemorySecretToken) {
    return inMemorySecretToken;
  }

  const envSecret = String(
    process.env.APPS_SCRIPT_SECRET_TOKEN ||
      process.env.SECRET_TOKEN ||
      process.env.VITE_APPS_SCRIPT_SECRET_TOKEN ||
      ''
  ).trim();
  if (envSecret) {
    inMemorySecretToken = envSecret;
    return envSecret;
  }

  const fromFile = readConfigFromFile();
  if (fromFile.secretToken) {
    inMemorySecretToken = fromFile.secretToken;
    return fromFile.secretToken;
  }

  return '';
}

export function getSavedAppsScriptConfig(): { appsScriptUrl: string; secretToken: string } {
  return {
    appsScriptUrl: getSavedAppsScriptUrl(),
    secretToken: getSavedAppsScriptSecretToken(),
  };
}

export function saveAppsScriptConfig(rawUrl: string, rawSecretToken?: string): { appsScriptUrl: string; secretToken: string } {
  const clean = normalizeServerAppsScriptUrl(rawUrl);
  if (!isValidServerAppsScriptUrl(clean)) {
    throw new Error('URL Web App Google Apps Script tidak valid.');
  }

  const nextSecret =
    rawSecretToken !== undefined ? String(rawSecretToken).trim() : getSavedAppsScriptSecretToken();

  inMemoryAppsScriptUrl = clean;
  process.env.APPS_SCRIPT_URL = clean;
  if (nextSecret) {
    inMemorySecretToken = nextSecret;
    process.env.APPS_SCRIPT_SECRET_TOKEN = nextSecret;
  }

  const payload = JSON.stringify(
    {
      appsScriptUrl: clean,
      secretToken: nextSecret || undefined,
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );

  let wrotePrimary = false;
  try {
    fs.writeFileSync(PRIMARY_CONFIG_PATH, payload, 'utf8');
    wrotePrimary = true;
  } catch {
    // Vercel / read-only deployment root
  }

  if (!wrotePrimary) {
    try {
      fs.writeFileSync(TMP_CONFIG_PATH, payload, 'utf8');
    } catch {
      // Non-fatal
    }
  }

  return { appsScriptUrl: clean, secretToken: nextSecret };
}

export function clearAppsScriptUrlConfig(): void {
  inMemoryAppsScriptUrl = '';
  inMemorySecretToken = '';
  delete process.env.APPS_SCRIPT_URL;
  delete process.env.APPS_SCRIPT_SECRET_TOKEN;
  for (const filePath of [PRIMARY_CONFIG_PATH, TMP_CONFIG_PATH]) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Non-fatal
    }
  }
}
