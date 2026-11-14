import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  Student,
  SchoolClass,
  AttendanceSession,
  AttendanceRecord,
  OutOfClassRecord,
  ViolationRecord,
  ViolationType,
  LeaveRequest,
  AppSettings,
  NotificationSettings,
} from '../types/index.js';

// Standard non-restricted Google Workspace scopes (avoids OAuth restricted-scope verification blocks)
export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Normalize & clean a pasted Google Cloud Console OAuth 2.0 Web Client ID
 */
export const normalizeGoogleClientId = (rawClientId: string): string => {
  return (rawClientId || '').replace(/[\s"'`]+/g, '').trim();
};

/**
 * Returns Google Cloud Console OAuth 2.0 Web Client ID
 * Priority: Explicit arg -> Window/LocalStorage registered JS ID -> Env var -> firebase-applet-config -> Fallback
 */
export const getGoogleClientId = (fallbackFromSettings?: string): string => {
  if (fallbackFromSettings && fallbackFromSettings.trim()) {
    return normalizeGoogleClientId(fallbackFromSettings);
  }
  if (typeof window !== 'undefined') {
    const custom = (window as any).__DKB_GOOGLE_CLIENT_ID__ || localStorage.getItem('dkb_google_client_id');
    if (custom && custom.trim()) return normalizeGoogleClientId(custom);
  }
  const envId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;
  if (envId && envId.trim()) return normalizeGoogleClientId(envId);
  const configId = (firebaseConfig as any)?.oAuthClientId;
  if (configId && configId.trim()) return normalizeGoogleClientId(configId);
  return '1050818791896-mi4qsashp76oedjfgqiagmph04osv40b.apps.googleusercontent.com';
};

export const setCustomGoogleClientId = (clientId: string) => {
  if (typeof window !== 'undefined') {
    const cleaned = normalizeGoogleClientId(clientId);
    if (cleaned) {
      localStorage.setItem('dkb_google_client_id', cleaned);
      (window as any).__DKB_GOOGLE_CLIENT_ID__ = cleaned;
      (window as any).__DKB_REGISTERED_JS_ORIGIN__ = window.location.origin;
    } else {
      localStorage.removeItem('dkb_google_client_id');
      delete (window as any).__DKB_GOOGLE_CLIENT_ID__;
    }
  }
};

/**
 * Automatically registers any pasted/saved Google Cloud Console Client ID into the browser
 * JavaScript runtime & Google Identity Services (GIS) client immediately (0ms).
 */
export const registerGoogleClientIdToJs = (
  rawClientId: string
): { clientId: string; origin: string; registeredInJs: boolean } => {
  const cleaned = normalizeGoogleClientId(rawClientId);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  setCustomGoogleClientId(cleaned);

  if (typeof window !== 'undefined' && cleaned) {
    (window as any).__DKB_GOOGLE_CLIENT_ID__ = cleaned;
    (window as any).__DKB_REGISTERED_JS_ORIGIN__ = origin;

    const tryBindGis = () => {
      const g = (window as any).google;
      if (g?.accounts?.oauth2) {
        try {
          (window as any).__DKB_GIS_TOKEN_CLIENT__ = g.accounts.oauth2.initTokenClient({
            client_id: cleaned,
            scope: SCOPES.join(' '),
            include_granted_scopes: true,
            callback: () => {},
          });
          (window as any).__DKB_GIS_REGISTERED_CLIENT_ID__ = cleaned;
        } catch {
          // Safe: actual signInWithGoogle call re-initializes cleanly with live callback
        }
      }
    };

    if ((window as any).google?.accounts?.oauth2) {
      tryBindGis();
    } else {
      ensureGisLoaded().then((loaded) => {
        if (loaded) tryBindGis();
      });
    }
  }

  return {
    clientId: cleaned,
    origin,
    registeredInJs: Boolean(cleaned),
  };
};

export const getJsRegisteredInfo = (): { clientId: string; origin: string; gisReady: boolean } => {
  if (typeof window === 'undefined') {
    return { clientId: '', origin: '', gisReady: false };
  }
  const clientId = (window as any).__DKB_GOOGLE_CLIENT_ID__ || localStorage.getItem('dkb_google_client_id') || '';
  const origin = (window as any).__DKB_REGISTERED_JS_ORIGIN__ || window.location.origin;
  const gisReady = Boolean(clientId) && Boolean((window as any).__DKB_GIS_REGISTERED_CLIENT_ID__ === clientId || (window as any).google?.accounts?.oauth2);
  return { clientId, origin, gisReady };
};

// Initialize Firebase App singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const firebaseAuth = getAuth(app);

// In-memory token cache (Do NOT store in localStorage/sessionStorage!)
let inMemoryAccessToken: string | null = null;
let inMemoryTokenExpiresAt = 0;
let isSigningIn = false;

export interface ConnectedGoogleAccount {
  email: string;
  name: string;
  photo?: string;
  uid: string;
  connectedAt: string;
}

export const getAccessToken = async (): Promise<string | null> => {
  if (!hasValidGoogleToken()) return null;
  return inMemoryAccessToken;
};

export const hasValidGoogleToken = (): boolean => {
  if (!inMemoryAccessToken) {
    return false;
  }
  if (inMemoryTokenExpiresAt > 0 && Date.now() >= inMemoryTokenExpiresAt - 60000) {
    return false;
  }
  return true;
};

export const getTokenExpiresInSeconds = (): number => {
  if (!inMemoryAccessToken || !inMemoryTokenExpiresAt) return 3500;
  return Math.max(60, Math.floor((inMemoryTokenExpiresAt - Date.now()) / 1000));
};

export const setInMemoryToken = (token: string | null, expiresInSeconds?: number) => {
  inMemoryAccessToken = token;
  if (!token) {
    inMemoryTokenExpiresAt = 0;
  } else {
    const ttl = typeof expiresInSeconds === 'number' && expiresInSeconds > 120 ? expiresInSeconds : 3500;
    inMemoryTokenExpiresAt = Date.now() + ttl * 1000;
  }
};

export const initGoogleAuth = (
  onSuccess?: (user: User, token: string) => void,
  onFailure?: () => void
) => {
  return onAuthStateChanged(firebaseAuth, async (user: User | null) => {
    if (user && hasValidGoogleToken() && inMemoryAccessToken) {
      if (onSuccess) onSuccess(user, inMemoryAccessToken);
    } else if (user && !inMemoryAccessToken) {
      if (onSuccess) onSuccess(user, '');
    } else if (!user && !isSigningIn && !inMemoryAccessToken) {
      inMemoryTokenExpiresAt = 0;
      if (onFailure) onFailure();
    }
  });
};

/**
 * Preloads Google Identity Services script if not already present
 */
export const ensureGisLoaded = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if ((window as any).google?.accounts?.oauth2) return true;

  return new Promise((resolve) => {
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      if ((window as any).google?.accounts?.oauth2) {
        return resolve(true);
      }
      existing.addEventListener('load', () => resolve(true));
      setTimeout(() => resolve(Boolean((window as any).google?.accounts?.oauth2)), 800);
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    }
  });
};

// Immediate pre-fetch on module load in browser
if (typeof window !== 'undefined') {
  ensureGisLoaded().catch(() => {});
}

/**
 * Checks if current origin is among default pre-registered origins for the AI Studio Cloud Console client
 */
export const isKnownCloudConsoleOrigin = (): boolean => {
  if (typeof window === 'undefined') return true;
  const origin = window.location.origin;
  return (
    origin.includes('asia-southeast1.run.app') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1')
  );
};

/**
 * Request Google OAuth 2.0 token via Google Identity Services (GIS)
 * Strictly uses Google Cloud Console OAuth 2.0 Web Client without bypasses.
 */
export const requestGoogleIdentityToken = async (
  promptSelectAccount: boolean = true,
  customClientId?: string,
  loginHint?: string
): Promise<{
  accessToken: string;
  accountInfo: ConnectedGoogleAccount;
  expiresIn?: number;
  cancelled?: boolean;
}> => {
  const curOrig = typeof window !== 'undefined' ? window.location.origin : '';
  const effectiveHint = loginHint || 'kswsmp.puncakdarussalam@gmail.com';
  const clientId = (customClientId && normalizeGoogleClientId(customClientId)) || getGoogleClientId();

  if (!clientId) {
    throw new Error('ID Cloud Console (OAuth 2.0 Web Client ID) belum diisi. Simpan ID Cloud di menu Admin terlebih dahulu.');
  }

  // Ensure Client ID is registered in browser JS runtime
  registerGoogleClientIdToJs(clientId);

  await ensureGisLoaded();

  const google = (window as any).google;
  if (!google?.accounts?.oauth2) {
    throw new Error(
      'Layanan Google OAuth 2.0 (Google Identity Services) gagal dimuat. Periksa koneksi internet atau muat ulang halaman.'
    );
  }

  return new Promise((resolve, reject) => {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        include_granted_scopes: true,
        prompt: promptSelectAccount ? 'select_account' : '',
        hint: effectiveHint,
        callback: async (tokenResponse: any) => {
          if (tokenResponse.error) {
            if (
              tokenResponse.error === 'popup_closed_by_user' ||
              tokenResponse.error === 'cancelled' ||
              tokenResponse.error_subtype === 'user_cancel'
            ) {
              return resolve({ accessToken: '', accountInfo: null as any, cancelled: true });
            }

            const desc = tokenResponse.error_description || tokenResponse.error || '';
            const isOriginErr =
              tokenResponse.error === 'origin_mismatch' ||
              (typeof desc === 'string' &&
                (desc.includes('origin_mismatch') ||
                  desc.includes('redirect_uri_mismatch') ||
                  desc.includes('origin')));

            if (isOriginErr) {
              return reject(
                new Error(
                  `OAuth 2.0 origin_mismatch (400): URL asal "${curOrig}" belum terdaftar pada Authorized JavaScript origins di Google Cloud Console untuk Client ID ini.`
                )
              );
            }

            if (
              tokenResponse.error === 'access_denied' ||
              (typeof desc === 'string' && (desc.includes('403') || desc.includes('access_denied')))
            ) {
              return reject(
                new Error(
                  `OAuth 2.0 access_denied (403): Akses ditolak atau aplikasi masih mode Testing di OAuth Consent Screen. Tambahkan ${effectiveHint} ke Test Users atau Publish App di Google Cloud Console.`
                )
              );
            }

            if (tokenResponse.error === 'popup_blocked_by_browser' || tokenResponse.error_subtype === 'popup_blocked') {
              return reject(
                new Error(
                  'Popup OAuth 2.0 Google diblokir peramban. Harap izinkan pop-up untuk situs ini atau buka aplikasi di Tab Baru.'
                )
              );
            }

            return reject(new Error(desc || 'Otentikasi OAuth 2.0 Google Cloud Console gagal.'));
          }

          const token = tokenResponse.access_token;
          if (!token) {
            return reject(new Error('Gagal menerima Access Token OAuth 2.0 dari Google.'));
          }

          const expiresIn = Number(tokenResponse.expires_in) || 3500;
          setInMemoryToken(token, expiresIn);

          // Bridge to Firebase Auth safely without blocking OAuth 2.0 token usage
          try {
            const credential = GoogleAuthProvider.credential(null, token);
            await signInWithCredential(firebaseAuth, credential);
          } catch {
            // Firebase Auth optional domain sync; GIS OAuth 2.0 token handles Drive & Sheets directly
          }

          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${token}` },
            });
            const userData = await userRes.json();
            const accountInfo: ConnectedGoogleAccount = {
              email: userData.email || effectiveHint,
              name: userData.name || userData.email || 'Kesiswaan SMP Puncak Darussalam',
              photo: userData.picture || undefined,
              uid: userData.sub || `g_${Date.now()}`,
              connectedAt: new Date().toISOString(),
            };
            resolve({ accessToken: token, accountInfo, expiresIn });
          } catch {
            resolve({
              accessToken: token,
              expiresIn,
              accountInfo: {
                email: effectiveHint,
                name: 'Kesiswaan SMP Puncak Darussalam',
                uid: `g_${Date.now()}`,
                connectedAt: new Date().toISOString(),
              },
            });
          }
        },
        error_callback: (err: any) => {
          console.warn('[GIS Error Callback]:', err);
          if (err?.type === 'popup_closed' || err?.type === 'user_cancel') {
            resolve({ accessToken: '', accountInfo: null as any, cancelled: true });
          } else if (err?.type === 'popup_blocked') {
            reject(
              new Error(
                'Popup OAuth 2.0 Google diblokir peramban. Harap izinkan pop-up untuk situs ini atau buka aplikasi di Tab Baru.'
              )
            );
          } else {
            const msg = err?.message || err?.type || '';
            const isOriginErr =
              typeof msg === 'string' &&
              (msg.includes('origin_mismatch') || msg.includes('redirect_uri_mismatch') || msg.includes('origin'));

            if (isOriginErr) {
              reject(
                new Error(
                  `OAuth 2.0 origin_mismatch (400): Daftarkan "${curOrig}" pada Authorized JavaScript origins di Google Cloud Console.`
                )
              );
            } else {
              reject(new Error(msg || 'Gagal memproses otentikasi Google OAuth 2.0.'));
            }
          }
        },
      });

      client.requestAccessToken({
        prompt: promptSelectAccount ? 'select_account' : '',
        hint: effectiveHint,
      });
    } catch (err: any) {
      reject(new Error(err?.message || 'Gagal memulai permintaan otentikasi Google OAuth 2.0.'));
    }
  });
};

/**
 * Sign in with Google using Google Cloud Console OAuth 2.0 Web Client (Google Identity Services).
 * Connects directly to Google Accounts with select_account prompt and eliminates all Firebase unauthorized-domain errors.
 */
export const signInWithGoogle = async (
  promptSelectAccount: boolean = true,
  customClientId?: string,
  loginHint?: string
): Promise<{
  user?: User;
  accessToken: string;
  accountInfo: ConnectedGoogleAccount;
  expiresIn?: number;
  cancelled?: boolean;
}> => {
  try {
    isSigningIn = true;
    const gisResult = await requestGoogleIdentityToken(promptSelectAccount, customClientId, loginHint);

    if (gisResult.cancelled || !gisResult.accessToken) {
      return {
        accessToken: '',
        accountInfo: null as any,
        cancelled: true,
      };
    }

    return {
      user: firebaseAuth.currentUser || undefined,
      accessToken: gisResult.accessToken,
      accountInfo: gisResult.accountInfo,
      expiresIn: gisResult.expiresIn,
      cancelled: false,
    };
  } finally {
    isSigningIn = false;
  }
};

/**
 * Disconnect Google Account and clear in-memory token
 */
export const disconnectGoogleAccount = async () => {
  try {
    await signOut(firebaseAuth);
  } catch (e) {
    console.warn('[Firebase signOut warning]:', e);
  }
  setInMemoryToken(null);
};

// ==========================================
// GOOGLE DRIVE & GOOGLE SHEETS API UTILITIES
// ==========================================

const FOLDER_NAME = 'DISIPLIN KITA BISA - Database Sekolah';
const SPREADSHEET_NAME = 'Database Presensi & Kedisiplinan - DISIPLIN KITA BISA';

/**
 * Find or create dedicated Google Drive folder
 */
export const getOrCreateDriveFolder = async (
  accessToken: string
): Promise<{ folderId: string; folderUrl: string }> => {
  if (!accessToken) {
    const errObj: any = new Error('Token OAuth 2.0 Google belum aktif untuk mengakses Google Drive.');
    errObj.statusCode = 401;
    throw errObj;
  }

  // 1. Search existing folder
  const query = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    if (searchRes.status === 401) {
      setInMemoryToken(null);
    }
    const err = await searchRes.json().catch(() => ({}));
    const errObj: any = new Error(err.error?.message || `Gagal mengakses Google Drive (${searchRes.status}).`);
    errObj.statusCode = searchRes.status;
    throw errObj;
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    const existing = searchData.files[0];
    return {
      folderId: existing.id,
      folderUrl: existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`,
    };
  }

  // 2. Create folder if not found
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Folder basis data otomatis DISIPLIN KITA BISA (Presensi, Siswa, Rekapitulasi)',
    }),
  });

  if (!createRes.ok) {
    if (createRes.status === 401) {
      setInMemoryToken(null);
    }
    const err = await createRes.json().catch(() => ({}));
    const errObj: any = new Error(err.error?.message || `Gagal membuat folder Google Drive (${createRes.status}).`);
    errObj.statusCode = createRes.status;
    throw errObj;
  }

  const newFolder = await createRes.json();
  return {
    folderId: newFolder.id,
    folderUrl: newFolder.webViewLink || `https://drive.google.com/drive/folders/${newFolder.id}`,
  };
};

/**
 * Find or create dedicated Google Spreadsheet in the app's Drive folder
 */
export const getOrCreateSpreadsheet = async (
  accessToken: string,
  folderId?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string; isNew: boolean }> => {
  if (!accessToken) {
    const errObj: any = new Error('Token OAuth 2.0 Google belum aktif untuk mengakses Google Sheets.');
    errObj.statusCode = 401;
    throw errObj;
  }
  // 1. Search existing spreadsheet (scoped to folder first, then global)
  const baseQuery = `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  if (folderId) {
    const scopedQuery = `${baseQuery} and '${folderId}' in parents`;
    const scopedRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(scopedQuery)}&fields=files(id,name,webViewLink)`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (scopedRes.status === 401) {
      setInMemoryToken(null);
      const errObj: any = new Error('Sesi OAuth Google berakhir (401).');
      errObj.statusCode = 401;
      throw errObj;
    }

    if (scopedRes.ok) {
      const scopedData = await scopedRes.json();
      if (scopedData.files && scopedData.files.length > 0) {
        const existing = scopedData.files[0];
        return {
          spreadsheetId: existing.id,
          spreadsheetUrl: existing.webViewLink || `https://docs.google.com/spreadsheets/d/${existing.id}/edit`,
          isNew: false,
        };
      }
    }
  }

  // 1b. Search across user's files if not found inside specific folder
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(baseQuery)}&fields=files(id,name,webViewLink)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (searchRes.status === 401) {
    setInMemoryToken(null);
    const errObj: any = new Error('Sesi OAuth Google berakhir (401).');
    errObj.statusCode = 401;
    throw errObj;
  }

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      const existing = searchData.files[0];
      if (folderId) {
        try {
          await fetch(
            `https://www.googleapis.com/drive/v3/files/${existing.id}?addParents=${folderId}&fields=id,parents`,
            {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
        } catch {}
      }
      return {
        spreadsheetId: existing.id,
        spreadsheetUrl: existing.webViewLink || `https://docs.google.com/spreadsheets/d/${existing.id}/edit`,
        isNew: false,
      };
    }
  }

  // 2. Create spreadsheet with default sheets
  const sheetTitles = [
    'Siswa',
    'Kelas',
    'Sesi_Presensi',
    'Presensi',
    'Izin_Keluar',
    'Pelanggaran',
    'Izin_Tidak_Masuk',
    'Jenis_Pelanggaran',
    'Pengaturan',
  ];
  const createSheetRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: SPREADSHEET_NAME,
      },
      sheets: sheetTitles.map((title) => ({
        properties: {
          title,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
      })),
    }),
  });

  if (!createSheetRes.ok) {
    if (createSheetRes.status === 401) {
      setInMemoryToken(null);
    }
    const err = await createSheetRes.json().catch(() => ({}));
    const errorObj: any = new Error(err.error?.message || `Gagal membuat spreadsheet Google (${createSheetRes.status})`);
    errorObj.statusCode = createSheetRes.status;
    throw errorObj;
  }

  const sheetData = await createSheetRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl = sheetData.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // 3. If folderId provided, move spreadsheet into folder
  if (folderId && folderId !== 'folder_kesiswaan_puncak_darussalam') {
    try {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${folderId}&fields=id,parents`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
    } catch (e) {
      console.warn('[Google Workspace] Could not move spreadsheet into folder:', e);
    }
  }

  return {
    spreadsheetId,
    spreadsheetUrl,
    isNew: true,
  };
};

export interface SyncDataPayload {
  students: Student[];
  classes: SchoolClass[];
  sessions: AttendanceSession[];
  attendance: AttendanceRecord[];
  outOfClass: OutOfClassRecord[];
  violations: ViolationRecord[];
  leaveRequests?: LeaveRequest[];
  violationTypes?: ViolationType[];
  settings: AppSettings;
  notificationSettings?: NotificationSettings;
}

const DRIVE_BACKUP_FILENAME = 'DISIPLIN_KITA_BISA_Database_Realtime.json';

/**
 * Create or update a real-time JSON database snapshot inside the dedicated Google Drive folder
 */
export const syncDriveBackupFile = async (
  accessToken: string,
  folderId: string | undefined,
  existingFileId: string | undefined,
  data: SyncDataPayload
): Promise<{ fileId: string; fileUrl: string }> => {
  if (!accessToken) {
    const errObj: any = new Error('Token OAuth 2.0 Google belum aktif untuk menulis cadangan Google Drive.');
    errObj.statusCode = 401;
    throw errObj;
  }

  const validFolderId =
    folderId && folderId !== 'folder_kesiswaan_puncak_darussalam' ? folderId : undefined;

  const snapshotJson = JSON.stringify(
    {
      app: 'DISIPLIN KITA BISA',
      syncedAt: new Date().toISOString(),
      schoolName: data.settings.school_name,
      counts: {
        students: data.students.length,
        classes: data.classes.length,
        sessions: data.sessions.length,
        attendance: data.attendance.length,
        outOfClass: data.outOfClass.length,
        violations: data.violations.length,
        leaveRequests: data.leaveRequests?.length || 0,
        violationTypes: data.violationTypes?.length || 0,
      },
      data: {
        settings: data.settings,
        notification_settings: data.notificationSettings,
        classes: data.classes,
        sessions: data.sessions,
        students: data.students,
        violation_types: data.violationTypes || [],
        attendance: data.attendance,
        out_of_class: data.outOfClass,
        violations: data.violations,
        leave_requests: data.leaveRequests || [],
      },
    },
    null,
    2
  );

  let targetFileId = existingFileId && existingFileId !== 'backup_kesiswaan_puncak_darussalam' ? existingFileId : '';

  if (!targetFileId) {
    const queryStr = validFolderId
      ? `name='${DRIVE_BACKUP_FILENAME}' and '${validFolderId}' in parents and trashed=false`
      : `name='${DRIVE_BACKUP_FILENAME}' and trashed=false`;
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(queryStr)}&fields=files(id,webViewLink)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (searchRes.status === 401) {
      setInMemoryToken(null);
      const errObj: any = new Error('Sesi OAuth Google berakhir (401).');
      errObj.statusCode = 401;
      throw errObj;
    }
    if (searchRes.ok) {
      const searchJson = await searchRes.json().catch(() => ({}));
      if (searchJson.files && searchJson.files.length > 0) {
        targetFileId = searchJson.files[0].id;
      }
    }
  }

  if (targetFileId) {
    const updateRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${targetFileId}?uploadType=media&fields=id,webViewLink`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: snapshotJson,
      }
    );
    if (updateRes.status === 401) {
      setInMemoryToken(null);
      const errObj: any = new Error('Sesi OAuth Google berakhir (401).');
      errObj.statusCode = 401;
      throw errObj;
    }
    if (updateRes.ok) {
      const updated = await updateRes.json().catch(() => ({}));
      return {
        fileId: updated.id || targetFileId,
        fileUrl: updated.webViewLink || `https://drive.google.com/file/d/${targetFileId}/view`,
      };
    }
    if (updateRes.status !== 404 && updateRes.status !== 403) {
      const errObj: any = new Error(`Gagal memperbarui file Drive (${updateRes.status})`);
      errObj.statusCode = updateRes.status;
      throw errObj;
    }
    // If 404/403, fall through to create a new file
  }

  const boundary = `dkb_drive_${Date.now()}`;
  const metadata: Record<string, any> = {
    name: DRIVE_BACKUP_FILENAME,
    mimeType: 'application/json',
    description: 'Cadangan basis data real-time otomatis DISIPLIN KITA BISA',
  };
  if (validFolderId) {
    metadata.parents = [validFolderId];
  }

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${snapshotJson}\r\n` +
    `--${boundary}--`;

  const createRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (createRes.status === 401) {
    setInMemoryToken(null);
    const errObj: any = new Error('Sesi OAuth Google berakhir (401).');
    errObj.statusCode = 401;
    throw errObj;
  }

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    const errObj: any = new Error(errData.error?.message || `Gagal menyimpan file cadangan Drive (${createRes.status})`);
    errObj.statusCode = createRes.status;
    throw errObj;
  }

  const created = await createRes.json();
  return {
    fileId: created.id,
    fileUrl: created.webViewLink || `https://drive.google.com/file/d/${created.id}/view`,
  };
};

/**
 * Synchronize all tables into Google Sheets
 */
export const syncAllDataToGoogleSheets = async (
  accessToken: string,
  spreadsheetId: string,
  data: SyncDataPayload
): Promise<{ success: boolean; rowsUpdated: number }> => {
  if (!accessToken || !spreadsheetId || spreadsheetId === 'spreadsheet_kesiswaan_puncak_darussalam') {
    const errObj: any = new Error('Token OAuth 2.0 atau ID Google Spreadsheet belum aktif.');
    errObj.statusCode = 401;
    throw errObj;
  }

  // Ensure the sheets exist in spreadsheet
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) {
    if (metaRes.status === 401) {
      setInMemoryToken(null);
      const errorObj: any = new Error('Sesi otorisasi Google telah berakhir (401). Harap klik "Hubungkan OAuth 2.0 Google" untuk memperbarui sesi.');
      errorObj.statusCode = 401;
      throw errorObj;
    }
    const err = await metaRes.json().catch(() => ({}));
    const errorObj: any = new Error(err.error?.message || `Gagal membaca Google Spreadsheet (${metaRes.status}).`);
    errorObj.statusCode = metaRes.status;
    throw errorObj;
  }

  const metaData = await metaRes.json();
  const existingSheetTitles: string[] = (metaData.sheets || []).map((s: any) => s.properties?.title);

  const requiredSheets = [
    'Siswa',
    'Kelas',
    'Sesi_Presensi',
    'Presensi',
    'Izin_Keluar',
    'Pelanggaran',
    'Izin_Tidak_Masuk',
    'Jenis_Pelanggaran',
    'Pengaturan',
  ];
  const missingSheets = requiredSheets.filter((title) => !existingSheetTitles.includes(title));

  if (missingSheets.length > 0) {
    const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: missingSheets.map((title) => ({
          addSheet: {
            properties: {
              title,
              gridProperties: { frozenRowCount: 1 },
            },
          },
        })),
      }),
    });
    if (addRes.status === 401) {
      setInMemoryToken(null);
      const errorObj: any = new Error('Sesi otorisasi Google berakhir (401).');
      errorObj.statusCode = 401;
      throw errorObj;
    }
  }

  // 1. Format Siswa rows
  const siswaRows = [
    ['NIS', 'Nama Siswa', 'Kelas', 'Jenis Kelamin', 'RFID UID', 'Kode Kartu/NIS', 'Nama Orang Tua', 'Email Orang Tua', 'Status Keaktifan'],
    ...data.students.map((s) => [
      s.nis,
      s.name,
      s.class_id,
      s.gender === 'L' ? 'Laki-laki' : 'Perempuan',
      s.rfid_uid || '-',
      s.card_code || s.nis,
      s.parent_name || '-',
      s.parent_email || '-',
      s.nis ? 'Aktif' : 'Nonaktif',
    ]),
  ];

  // 2. Format Kelas rows
  const kelasRows = [
    ['ID Kelas', 'Nama Kelas', 'Tingkat', 'Jurusan', 'Nama Wali Kelas', 'Email Wali Kelas (Notifikasi Otomatis)'],
    ...data.classes.map((c) => [
      c.id,
      c.name,
      c.grade,
      c.major,
      c.homeroom_teacher_name || '-',
      c.homeroom_teacher_email || '-',
    ]),
  ];

  // 3. Format Sesi rows
  const sesiRows = [
    ['ID Sesi', 'Nama Sesi', 'Jam Mulai', 'Batas Tepat Waktu', 'Jam Selesai', 'Toleransi Terlambat (Menit)', 'Hari Aktif (0=Min,1=Sen..)', 'Status'],
    ...data.sessions.map((sess) => [
      sess.id,
      sess.name,
      sess.start_time,
      sess.on_time_limit,
      sess.end_time,
      sess.late_tolerance_minutes ?? 0,
      (sess.active_days || [1, 2, 3, 4, 5]).join(', '),
      sess.is_active ? 'Aktif' : 'Nonaktif',
    ]),
  ];

  // 4. Format Presensi rows (most recent first)
  const studentMap = new Map(data.students.map((s) => [s.nis, s]));
  const presensiRows = [
    ['ID Presensi', 'Tanggal', 'Jam Pemindaian', 'NIS', 'Nama Siswa', 'Kelas', 'ID Sesi', 'Status Kehadiran', 'Terlambat (Menit)', 'Metode Scan', 'ID Perangkat', 'Catatan'],
    ...data.attendance.slice(0, 1500).map((a) => {
      const student = studentMap.get(a.student_id);
      return [
        a.id,
        a.date,
        a.timestamp ? new Date(a.timestamp).toLocaleTimeString('id-ID') : '-',
        a.student_id,
        student?.name || '-',
        student?.class_id || '-',
        a.session_id,
        a.status,
        a.late_minutes || 0,
        a.method || 'rfid',
        a.device_id || 'utama',
        a.notes || '',
      ];
    }),
  ];

  // 5. Format Izin Keluar rows
  const izinRows = [
    ['ID Izin', 'NIS', 'Nama Siswa', 'Kelas', 'Jenis Izin', 'Waktu Mulai', 'Batas Waktu', 'Waktu Kembali', 'Durasi (Menit)', 'Terlambat (Menit)', 'Status Izin', 'Metode Kembali', 'Catatan'],
    ...data.outOfClass.slice(0, 1000).map((o) => {
      const student = studentMap.get(o.student_id);
      return [
        o.id,
        o.student_id,
        student?.name || '-',
        o.class_id,
        o.type,
        new Date(o.started_at).toLocaleString('id-ID'),
        new Date(o.due_at).toLocaleTimeString('id-ID'),
        o.returned_at ? new Date(o.returned_at).toLocaleTimeString('id-ID') : '-',
        o.duration_minutes,
        o.late_return_minutes || 0,
        o.status,
        o.return_method || '-',
        o.return_notes || '',
      ];
    }),
  ];

  // 6. Format Pelanggaran rows
  const pelanggaranRows = [
    ['ID Pelanggaran', 'Tanggal & Waktu', 'NIS', 'Nama Siswa', 'Kelas', 'Jenis Pelanggaran', 'Kategori', 'Poin', 'Lokasi Kejadian', 'Petugas Pencatat', 'Keterangan'],
    ...data.violations.slice(0, 1000).map((v) => {
      const student = studentMap.get(v.student_id);
      return [
        v.id,
        new Date(v.recorded_at).toLocaleString('id-ID'),
        v.student_id,
        student?.name || '-',
        v.class_id,
        v.type_name,
        v.category,
        v.points,
        v.location || '-',
        v.recorded_by || 'Admin',
        v.notes || '',
      ];
    }),
  ];

  // 7. Format Izin Tidak Masuk (Leave Requests)
  const leaveRows = [
    ['ID Pengajuan', 'NIS', 'Nama Siswa', 'Kelas', 'Jenis', 'Tanggal Mulai', 'Tanggal Selesai', 'Alasan', 'Status', 'Diproses Oleh'],
    ...(data.leaveRequests || []).slice(0, 1000).map((lr) => {
      const student = studentMap.get(lr.student_id);
      return [
        lr.id,
        lr.student_id,
        student?.name || '-',
        lr.class_id,
        lr.type,
        lr.start_date,
        lr.end_date,
        lr.reason,
        lr.status,
        lr.approved_by || '-',
      ];
    }),
  ];

  // 8. Format Jenis Pelanggaran
  const violationTypeRows = [
    ['ID', 'Kode', 'Nama Pelanggaran/Prestasi', 'Kategori', 'Poin Default', 'Status Aktif', 'Keterangan'],
    ...(data.violationTypes || []).map((vt) => [
      vt.id,
      vt.code,
      vt.name,
      vt.category,
      vt.default_points,
      vt.is_active ? 'Aktif' : 'Nonaktif',
      vt.description || '',
    ]),
  ];

  // 9. Format Pengaturan & Status (menyimpan ID Cloud Console + Folder + Spreadsheet + Email di Sheet)
  const resolvedClientId = getGoogleClientId(data.settings.google_client_id);
  const emailNotifActive =
    data.settings.toggle_email_notifications !== false && data.notificationSettings?.email_enabled !== false;
  const pengaturanRows = [
    ['Parameter Sistem', 'Nilai Saat Ini', 'Keterangan'],
    ['ID Cloud Console (Client ID)', resolvedClientId, 'OAuth 2.0 Web Client ID tersimpan otomatis di aplikasi & sheet'],
    ['Nama Sekolah', data.settings.school_name, 'Nama identitas resmi sekolah'],
    ['Email Google Terhubung (OAuth 2.0)', data.settings.google_account_email || '-', 'Akun Google Drive & Sheets sekolah'],
    ['Nama Akun Google', data.settings.google_account_name || '-', 'Nama profil akun Google OAuth 2.0'],
    ['ID Folder Google Drive', data.settings.google_drive_folder_id || '-', 'Folder penyimpanan otomatis database JSON'],
    ['ID Google Spreadsheet', spreadsheetId, 'ID Google Spreadsheet database 9 lembar kerja'],
    ['Total Siswa Terdaftar', data.students.length, 'Jumlah siswa aktif & terdaftar'],
    ['Total Kelas', data.classes.length, 'Jumlah rombel kelas'],
    ['Total Sesi Presensi', data.sessions.length, 'Jumlah sesi jadwal presensi'],
    ['Total Jenis Pelanggaran', data.violationTypes?.length || 0, 'Jumlah master aturan pelanggaran/prestasi'],
    ['Total Catatan Presensi', data.attendance.length, 'Presensi tercatat di sistem'],
    ['Total Izin Keluar', data.outOfClass.length, 'Izin keluar kelas tercatat'],
    ['Total Pelanggaran & Prestasi', data.violations.length, 'Catatan kedisiplinan'],
    ['Notifikasi Email Orang Tua', emailNotifActive ? 'Aktif (Otomatis)' : 'Nonaktif', 'Pengiriman pemberitahuan otomatis tanpa klik manual'],
    [
      'Rekap Mingguan Wali Kelas',
      data.notificationSettings?.weekly_recap_enabled !== false
        ? `Aktif (Hari ${data.notificationSettings?.weekly_recap_day ?? 5}, Jam ${data.notificationSettings?.weekly_recap_time || '15:00'})`
        : 'Nonaktif',
      'Pengiriman otomatis ke wali kelas per sesi',
    ],
    ['Sinkron Terakhir', new Date().toLocaleString('id-ID'), 'Waktu sinkronisasi cloud otomatis real-time'],
    ['Mode Database', 'Google OAuth 2.0 + Drive & Sheets Otomatis Real-Time', 'Sinkronisasi otomatis setiap perubahan data'],
  ];

  // Clear existing ranges then batch write
  const clearRanges = requiredSheets.map((title) => `${title}!A:Z`);
  const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ranges: clearRanges }),
  });

  if (!clearRes.ok) {
    if (clearRes.status === 401) {
      setInMemoryToken(null);
    }
    if (clearRes.status === 401 || clearRes.status === 403 || clearRes.status === 404) {
      const errData = await clearRes.json().catch(() => ({}));
      const errorObj: any = new Error(errData.error?.message || `Gagal membersihkan Google Sheets (${clearRes.status}).`);
      errorObj.statusCode = clearRes.status;
      throw errorObj;
    }
  }

  // Batch update values using RAW to preserve NIS leading zeros and exact HH:mm time strings
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          { range: 'Siswa!A1', values: siswaRows },
          { range: 'Kelas!A1', values: kelasRows },
          { range: 'Sesi_Presensi!A1', values: sesiRows },
          { range: 'Presensi!A1', values: presensiRows },
          { range: 'Izin_Keluar!A1', values: izinRows },
          { range: 'Pelanggaran!A1', values: pelanggaranRows },
          { range: 'Izin_Tidak_Masuk!A1', values: leaveRows },
          { range: 'Jenis_Pelanggaran!A1', values: violationTypeRows },
          { range: 'Pengaturan!A1', values: pengaturanRows },
        ],
      }),
    }
  );

  if (!writeRes.ok) {
    if (writeRes.status === 401) {
      setInMemoryToken(null);
    }
    const errData = await writeRes.json().catch(() => ({}));
    const errorObj: any = new Error(errData.error?.message || `Gagal menulis Google Sheets (${writeRes.status})`);
    errorObj.statusCode = writeRes.status;
    throw errorObj;
  }

  const result = await writeRes.json().catch(() => ({}));
  return {
    success: true,
    rowsUpdated: result.totalUpdatedRows || siswaRows.length + presensiRows.length + pelanggaranRows.length,
  };
};

/**
 * Full automatic orchestrator: ensures Drive Folder, Drive JSON Backup File, and 9-tab Google Spreadsheet
 * exist and are synchronized together, with automatic 403/404 self-healing.
 */
export const syncAllDataToDriveAndSheets = async (
  accessToken: string,
  payload: SyncDataPayload
): Promise<{
  folderId: string;
  folderUrl: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  backupFileId: string;
  backupFileUrl: string;
  rowsUpdated: number;
}> => {
  let folderId = payload.settings.google_drive_folder_id || '';
  let folderUrl = payload.settings.google_drive_folder_url || '';
  let spreadsheetId = payload.settings.google_sheet_id || '';
  let spreadsheetUrl = payload.settings.google_sheet_url || '';
  let backupFileId = payload.settings.google_drive_backup_file_id || '';
  let backupFileUrl = payload.settings.google_drive_backup_file_url || '';

  if (!folderId || folderId === 'folder_kesiswaan_puncak_darussalam') {
    const folder = await getOrCreateDriveFolder(accessToken);
    folderId = folder.folderId;
    folderUrl = folder.folderUrl;
  }

  if (!spreadsheetId || spreadsheetId === 'spreadsheet_kesiswaan_puncak_darussalam') {
    const sheet = await getOrCreateSpreadsheet(accessToken, folderId);
    spreadsheetId = sheet.spreadsheetId;
    spreadsheetUrl = sheet.spreadsheetUrl;
  }

  const runBoth = async (targetFolderId: string, targetFolderUrl: string, targetSheetId: string, targetSheetUrl: string, targetBackupId?: string) => {
    const enrichedPayload: SyncDataPayload = {
      ...payload,
      settings: {
        ...payload.settings,
        google_client_id: getGoogleClientId(payload.settings.google_client_id),
        google_drive_folder_id: targetFolderId,
        google_drive_folder_url: targetFolderUrl,
        google_sheet_id: targetSheetId,
        google_sheet_url: targetSheetUrl,
      },
    };
    const [sheetsResult, driveResult] = await Promise.all([
      syncAllDataToGoogleSheets(accessToken, targetSheetId, enrichedPayload),
      syncDriveBackupFile(accessToken, targetFolderId, targetBackupId, enrichedPayload),
    ]);
    return { sheetsResult, driveResult };
  };

  try {
    const resolvedFolderUrl = folderUrl || `https://drive.google.com/drive/folders/${folderId}`;
    const resolvedSheetUrl = spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    const { sheetsResult, driveResult } = await runBoth(folderId, resolvedFolderUrl, spreadsheetId, resolvedSheetUrl, backupFileId);
    return {
      folderId,
      folderUrl: resolvedFolderUrl,
      spreadsheetId,
      spreadsheetUrl: resolvedSheetUrl,
      backupFileId: driveResult.fileId,
      backupFileUrl: driveResult.fileUrl,
      rowsUpdated: sheetsResult.rowsUpdated,
    };
  } catch (err: any) {
    // Self-heal if sheet or folder was deleted / inaccessible (403/404)
    if (
      err?.statusCode === 403 ||
      err?.statusCode === 404 ||
      err?.message?.includes('403') ||
      err?.message?.includes('404') ||
      err?.message?.includes('permission')
    ) {
      const folder = await getOrCreateDriveFolder(accessToken);
      const sheet = await getOrCreateSpreadsheet(accessToken, folder.folderId);
      const { sheetsResult, driveResult } = await runBoth(folder.folderId, folder.folderUrl, sheet.spreadsheetId, sheet.spreadsheetUrl, undefined);
      return {
        folderId: folder.folderId,
        folderUrl: folder.folderUrl,
        spreadsheetId: sheet.spreadsheetId,
        spreadsheetUrl: sheet.spreadsheetUrl,
        backupFileId: driveResult.fileId,
        backupFileUrl: driveResult.fileUrl,
        rowsUpdated: sheetsResult.rowsUpdated,
      };
    }
    throw err;
  }
};
