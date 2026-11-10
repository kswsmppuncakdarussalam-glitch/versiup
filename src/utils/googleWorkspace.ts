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
  AppSettings,
} from '../types/index.js';

// Required Google Workspace scopes
export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Returns Google Cloud Console OAuth 2.0 Web Client ID
 * Priority: Custom configured -> Env var -> firebase-applet-config -> Fallback
 */
export const getGoogleClientId = (fallbackFromSettings?: string): string => {
  if (fallbackFromSettings && fallbackFromSettings.trim()) {
    return fallbackFromSettings.trim();
  }
  if (typeof window !== 'undefined') {
    const custom = (window as any).__DKB_GOOGLE_CLIENT_ID__ || localStorage.getItem('dkb_google_client_id');
    if (custom && custom.trim()) return custom.trim();
  }
  const envId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;
  if (envId && envId.trim()) return envId.trim();
  const configId = (firebaseConfig as any)?.oAuthClientId;
  if (configId && configId.trim()) return configId.trim();
  return '1050818791896-mi4qsashp76oedjfgqiagmph04osv40b.apps.googleusercontent.com';
};

export const setCustomGoogleClientId = (clientId: string) => {
  if (typeof window !== 'undefined') {
    if (clientId && clientId.trim()) {
      localStorage.setItem('dkb_google_client_id', clientId.trim());
      (window as any).__DKB_GOOGLE_CLIENT_ID__ = clientId.trim();
    } else {
      localStorage.removeItem('dkb_google_client_id');
      delete (window as any).__DKB_GOOGLE_CLIENT_ID__;
    }
  }
};

// Initialize Firebase App singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const firebaseAuth = getAuth(app);

// In-memory token cache (Do NOT store in localStorage/sessionStorage!)
let inMemoryAccessToken: string | null = null;
let isSigningIn = false;

export interface ConnectedGoogleAccount {
  email: string;
  name: string;
  photo?: string;
  uid: string;
  connectedAt: string;
}

export const getAccessToken = async (): Promise<string | null> => {
  return inMemoryAccessToken;
};

export const hasValidGoogleToken = (): boolean => {
  return Boolean(inMemoryAccessToken);
};

export const setInMemoryToken = (token: string | null) => {
  inMemoryAccessToken = token;
};

export const initGoogleAuth = (
  onSuccess?: (user: User, token: string) => void,
  onFailure?: () => void
) => {
  return onAuthStateChanged(firebaseAuth, async (user: User | null) => {
    if (user && inMemoryAccessToken) {
      if (onSuccess) onSuccess(user, inMemoryAccessToken);
    } else if (user && !inMemoryAccessToken) {
      // User is authenticated in Firebase Auth, mark active
      if (onSuccess) onSuccess(user, '');
    } else if (!user && !inMemoryAccessToken) {
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
 * Request Google OAuth token via Google Identity Services (GIS)
 * Uses Google Cloud Console OAuth 2.0 Web Client directly
 */
export const requestGoogleIdentityToken = async (
  promptSelectAccount: boolean = true,
  customClientId?: string,
  loginHint?: string
): Promise<{
  accessToken: string;
  accountInfo: ConnectedGoogleAccount;
  cancelled?: boolean;
}> => {
  const clientId = (customClientId && customClientId.trim()) || getGoogleClientId();
  if (!clientId) {
    throw new Error('Client ID OAuth Google Cloud Console tidak ditemukan. Masukkan Client ID pada Pengaturan Admin.');
  }

  await ensureGisLoaded();

  const google = (window as any).google;
  if (!google?.accounts?.oauth2) {
    throw new Error('Layanan Google Identity Services belum siap di browser. Harap periksa koneksi internet Anda atau muat ulang halaman.');
  }

  const effectiveHint = loginHint || 'kswsmp.puncakdarussalam@gmail.com';

  return new Promise((resolve, reject) => {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        prompt: promptSelectAccount ? 'select_account' : '',
        hint: effectiveHint,
        callback: async (tokenResponse: any) => {
          if (tokenResponse.error) {
            // User closed popup or cancelled
            if (
              tokenResponse.error === 'popup_closed_by_user' ||
              tokenResponse.error === 'cancelled' ||
              tokenResponse.error_subtype === 'user_cancel'
            ) {
              return resolve({ accessToken: '', accountInfo: null as any, cancelled: true });
            }
            if (tokenResponse.error === 'access_denied') {
              const desc = tokenResponse.error_description || '';
              return reject(new Error('Aplikasi Google belum diverifikasi / dibatasi tester (Error 403: access_denied). Silakan gunakan tab "Tautkan Email Langsung" untuk menautkan email tanpa Google Cloud Console.'));
            }
            if (tokenResponse.error === 'popup_blocked_by_browser' || tokenResponse.error_subtype === 'popup_blocked') {
              return reject(new Error('Popup Google diblokir peramban. Harap izinkan pop-up (jendela sembulan) untuk situs ini, atau buka aplikasi di tab baru.'));
            }
            const desc = tokenResponse.error_description || tokenResponse.error;
            if (typeof desc === 'string' && (desc.includes('origin_mismatch') || desc.includes('redirect_uri_mismatch') || desc.includes('origin'))) {
              const curOrig = typeof window !== 'undefined' ? window.location.origin : '';
              return reject(new Error(`Asal JavaScript (${curOrig}) belum terdaftar di Authorized JavaScript origins Google Cloud Console. Silakan buka console.cloud.google.com/apis/credentials dan tambahkan URL tersebut.`));
            }
            if (typeof desc === 'string' && (desc.includes('403') || desc.includes('access_denied') || desc.includes('test') || desc.includes('verification'))) {
              return reject(new Error('Aplikasi belum diverifikasi Google (Error 403). Gunakan opsi "Tautkan Email Langsung" di aplikasi untuk menghubungkan email tanpa ID Cloud Console.'));
            }
            return reject(new Error(desc || 'Otentikasi Google Cloud Console gagal.'));
          }

          const token = tokenResponse.access_token;
          if (!token) {
            return reject(new Error('Gagal menerima Access Token dari Google.'));
          }

          inMemoryAccessToken = token;

          // Bridge to Firebase Auth safely without domain restrictions or blocking errors
          try {
            const credential = GoogleAuthProvider.credential(null, token);
            await signInWithCredential(firebaseAuth, credential);
          } catch (fbAuthErr: any) {
            // Silently ignore any Firebase Auth domain issues since Google Identity Services is our primary provider
          }

          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${token}` },
            });
            const userData = await userRes.json();
            const accountInfo: ConnectedGoogleAccount = {
              email: userData.email || 'akun-google@sekolah.sch.id',
              name: userData.name || userData.email || 'Admin Google',
              photo: userData.picture || undefined,
              uid: userData.sub || `g_${Date.now()}`,
              connectedAt: new Date().toISOString(),
            };
            resolve({ accessToken: token, accountInfo });
          } catch {
            resolve({
              accessToken: token,
              accountInfo: {
                email: 'akun-google@sekolah.sch.id',
                name: 'Admin Akun Google',
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
            reject(new Error('Popup Google diblokir peramban. Harap izinkan pop-up untuk situs ini, atau buka di tab baru.'));
          } else {
            const msg = err?.message || err?.type || 'Gagal memproses otentikasi Google Cloud Console.';
            const curOrig = typeof window !== 'undefined' ? window.location.origin : '';
            if (typeof msg === 'string' && (msg.includes('403') || msg.includes('access_denied') || msg.includes('tester') || msg.includes('verification'))) {
              reject(new Error('Aplikasi Google belum diverifikasi (Error 403: access_denied). Gunakan opsi "Tautkan Email Langsung" di aplikasi untuk menghubungkan email tanpa ID Cloud Console.'));
            } else if (typeof msg === 'string' && (msg.includes('origin_mismatch') || msg.includes('origin') || msg.includes('400'))) {
              reject(new Error(`Asal JavaScript (${curOrig}) belum terdaftar di Google Cloud Console. Silakan buka console.cloud.google.com/apis/credentials dan tambahkan ke Authorized JavaScript origins.`));
            } else {
              reject(new Error(msg));
            }
          }
        },
      });

      client.requestAccessToken({
        prompt: promptSelectAccount ? 'select_account' : '',
        hint: effectiveHint,
      });
    } catch (err: any) {
      reject(err);
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
): Promise<{ user?: User; accessToken: string; accountInfo: ConnectedGoogleAccount; cancelled?: boolean }> => {
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
  inMemoryAccessToken = null;
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
  // 1. Search existing folder
  const query = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    if (searchRes.status === 401) {
      setInMemoryToken(null);
      throw new Error('Sesi otorisasi Google telah berakhir (401). Harap hubungkan ulang akun Google Anda.');
    }
    const err = await searchRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gagal mencari folder di Google Drive (${searchRes.status})`);
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
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gagal membuat folder di Google Drive (${createRes.status})`);
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
  const sheetTitles = ['Siswa', 'Kelas', 'Sesi_Presensi', 'Presensi', 'Izin_Keluar', 'Pelanggaran', 'Pengaturan'];
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
    const err = await createSheetRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gagal membuat spreadsheet Google (${createSheetRes.status})`);
  }

  const sheetData = await createSheetRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl = sheetData.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // 3. If folderId provided, move spreadsheet into folder
  if (folderId) {
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
  settings: AppSettings;
}

/**
 * Synchronize all tables into Google Sheets
 */
export const syncAllDataToGoogleSheets = async (
  accessToken: string,
  spreadsheetId: string,
  data: SyncDataPayload
): Promise<{ success: boolean; rowsUpdated: number }> => {
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

  const requiredSheets = ['Siswa', 'Kelas', 'Sesi_Presensi', 'Presensi', 'Izin_Keluar', 'Pelanggaran', 'Pengaturan'];
  const missingSheets = requiredSheets.filter((title) => !existingSheetTitles.includes(title));

  if (missingSheets.length > 0) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
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
      sess.late_tolerance_minutes,
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

  // 7. Format Pengaturan & Status
  const pengaturanRows = [
    ['Parameter Sistem', 'Nilai Saat Ini', 'Keterangan'],
    ['Nama Sekolah', data.settings.school_name, 'Nama identitas resmi sekolah'],
    ['Total Siswa Terdaftar', String(data.students.length), 'Jumlah siswa aktif & terdaftar'],
    ['Total Kelas', String(data.classes.length), 'Jumlah rombel kelas'],
    ['Total Catatan Presensi', String(data.attendance.length), 'Presensi tercatat di sistem'],
    ['Sinkron Terakhir', new Date().toLocaleString('id-ID'), 'Waktu sinkronisasi cloud real-time'],
    ['Mode Database', 'Google Sheets & Drive Terintegrasi', 'Database real-time cloud multi-device'],
  ];

  // Clear existing ranges then batch write
  const clearRanges = requiredSheets.map((title) => `${title}!A:Z`);
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ranges: clearRanges }),
  });

  // Batch update values
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: 'Siswa!A1', values: siswaRows },
          { range: 'Kelas!A1', values: kelasRows },
          { range: 'Sesi_Presensi!A1', values: sesiRows },
          { range: 'Presensi!A1', values: presensiRows },
          { range: 'Izin_Keluar!A1', values: izinRows },
          { range: 'Pelanggaran!A1', values: pelanggaranRows },
          { range: 'Pengaturan!A1', values: pengaturanRows },
        ],
      }),
    }
  );

  if (!writeRes.ok) {
    const err = await writeRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gagal menulis data ke Google Sheets (${writeRes.status})`);
  }

  const result = await writeRes.json();
  return {
    success: true,
    rowsUpdated: result.totalUpdatedRows || siswaRows.length + presensiRows.length,
  };
};
