import { google, sheets_v4, drive_v3 } from 'googleapis';
import bcrypt from 'bcryptjs';
import { Readable } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import { buildSessionRecapData } from './sessionHelper.ts';
import type {
  User,
  UserRole,
  Student,
  SchoolClass,
  AttendanceSession,
  AttendanceRecord,
  OutOfClassRecord,
  ViolationType,
  ViolationRecord,
  LeaveRequest,
  AppSettings,
  NotificationSettings,
  NotificationLog,
  AuditLog,
} from './types.ts';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
];

const DEFAULT_SPREADSHEET_ID = '14MkgrDI6iFV4J8b5rS_LkUZrHtYX_zzuGJUihjKdxU4';
const DEFAULT_DRIVE_FOLDER_ID = '1vHFHbjW2E8Zo_-nuft4ns1NonyXcQY7K';

export const SHEET_TABS = {
  SISWA: 'Siswa',
  KELAS: 'Kelas',
  SESI_PRESENSI: 'Sesi_Presensi',
  REKAP_PER_SESI: 'Rekap_Per_Sesi',
  PRESENSI: 'Presensi',
  IZIN_KELUAR: 'Izin_Keluar',
  PELANGGARAN: 'Pelanggaran',
  IZIN_TIDAK_MASUK: 'Izin_Tidak_Masuk',
  JENIS_PELANGGARAN: 'Jenis_Pelanggaran',
  PENGATURAN: 'Pengaturan',
  USERS: 'Users',
  NOTIFIKASI_LOG: 'Notifikasi_Log',
  LOG: 'Log',
} as const;

export const SHEET_HEADERS: Record<string, string[]> = {
  [SHEET_TABS.SISWA]: [
    'id',
    'nis',
    'nisn',
    'name',
    'class_id',
    'gender',
    'rfid_uid',
    'card_code',
    'photo_url',
    'parent_name',
    'parent_email',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.KELAS]: [
    'id',
    'name',
    'grade',
    'major',
    'homeroom_teacher_name',
    'homeroom_teacher_email',
    'quota_limit',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.SESI_PRESENSI]: [
    'id',
    'name',
    'start_time',
    'on_time_limit',
    'end_time',
    'active_days',
    'late_tolerance_minutes',
    'is_active',
    'is_override',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.REKAP_PER_SESI]: [
    'id',
    'tanggal',
    'session_id',
    'session_name',
    'rentang_waktu',
    'total_siswa',
    'hadir',
    'terlambat',
    'izin',
    'sakit',
    'alpha',
    'belum_presensi',
    'persen_hadir',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.PRESENSI]: [
    'id',
    'student_id',
    'session_id',
    'date',
    'timestamp',
    'status_presensi',
    'late_minutes',
    'method',
    'device_id',
    'photo_id',
    'notes',
    'audited_by',
    'audit_reason',
    'version',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.IZIN_KELUAR]: [
    'id',
    'student_id',
    'class_id',
    'type',
    'duration_minutes',
    'started_at',
    'due_at',
    'returned_at',
    'actual_minutes',
    'late_return_minutes',
    'return_method',
    'status_izin',
    'return_notes',
    'audited_by',
    'audit_reason',
    'idempotency_key',
    'version',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.PELANGGARAN]: [
    'id',
    'student_id',
    'class_id',
    'violation_type_id',
    'type_name',
    'category',
    'points',
    'notes',
    'location',
    'evidence_photo_url',
    'recorded_by',
    'recorded_at',
    'version',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.IZIN_TIDAK_MASUK]: [
    'id',
    'student_id',
    'class_id',
    'type',
    'start_date',
    'end_date',
    'reason',
    'letter_file_url',
    'status_persetujuan',
    'approved_by',
    'approved_at',
    'rejection_reason',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.JENIS_PELANGGARAN]: [
    'id',
    'code',
    'name',
    'category',
    'default_points',
    'is_active',
    'description',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.PENGATURAN]: [
    'id',
    'tipe',
    'json_data',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.USERS]: [
    'id',
    'role',
    'name',
    'class_id',
    'email',
    'password_hash',
    'label',
    'token_version',
    'is_active',
    'created_at',
    'updated_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.NOTIFIKASI_LOG]: [
    'id',
    'timestamp',
    'student_id',
    'student_name',
    'recipient_email',
    'trigger_type',
    'status_kirim',
    'error_message',
    'created_at',
    'status',
    'diubah_pada',
  ],
  [SHEET_TABS.LOG]: [
    'id',
    'waktu',
    'pengguna',
    'id_data',
    'tabel',
    'aksi',
    'nilai_lama',
    'nilai_baru',
    'reason',
    'status',
    'diubah_pada',
  ],
};

export class SheetsConfigError extends Error {
  public readonly missingEnv: string[];
  public readonly statusCode = 503;

  constructor(missingEnv: string[], message?: string) {
    super(
      message ||
        `Konfigurasi Google Service Account / Spreadsheet belum lengkap di environment variable server: ${missingEnv.join(', ')}`
    );
    this.name = 'SheetsConfigError';
    this.missingEnv = missingEnv;
  }
}

export class GoogleAuthExpiredError extends Error {
  public readonly statusCode = 401;
  public readonly googleAuthExpired = true;

  constructor(message = 'Sesi akses Google berakhir. Silakan masuk kembali dengan Google.') {
    super(message);
    this.name = 'GoogleAuthExpiredError';
  }
}

export class ConflictError extends Error {
  public readonly statusCode = 409;
  public readonly current: any;

  constructor(message: string, current: any) {
    super(message);
    this.name = 'ConflictError';
    this.current = current;
  }
}

export class DriveNotFoundError extends Error {
  public readonly statusCode = 404;

  constructor(message = 'Foto tidak ditemukan atau tidak memiliki akses di Google Drive.') {
    super(message);
    this.name = 'DriveNotFoundError';
  }
}

export function extractDriveFileId(raw?: string | null): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const mFile = s.match(/\/file\/d\/([a-zA-Z0-9_-]{8,200})/i);
  if (mFile?.[1]) return mFile[1];
  const mD = s.match(/\/d\/([a-zA-Z0-9_-]{8,200})/i);
  if (mD?.[1]) return mD[1];
  const mQuery = s.match(/[?&]id=([a-zA-Z0-9_-]{8,200})/i);
  if (mQuery?.[1]) return mQuery[1];
  if (/^[a-zA-Z0-9_-]{8,200}$/.test(s)) return s;
  return '';
}

function colIndexToLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function parseBool(v: any, defaultVal = false): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'ya' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'tidak' || s === 'no') return false;
  return defaultVal;
}

function parseNum(v: any, defaultVal = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultVal;
}

function parseJsonArray<T>(v: any, fallback: T[]): T[] {
  if (Array.isArray(v)) return v;
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function defaultSettings(nowIso: string): AppSettings {
  return {
    school_name: 'DISIPLIN KITA BISA — SMK NEGERI',
    logo_url: '',
    background_url: '',
    accent_color: '#0f172a',
    theme: 'light',
    tts_enabled: true,
    tts_rate: 1.0,
    tts_pitch: 1.0,
    tts_volume: 1.0,
    tts_template_present: 'Selamat datang, {nama}. Anda tercatat hadir tepat waktu.',
    tts_template_late: 'Perhatian, {nama}. Anda terlambat {menit} menit. Segera ke kelas.',
    tts_template_out_of_class: 'Izin keluar tercatat untuk {nama}. Batas waktu {durasi} menit.',
    tts_template_overdue: 'Peringatan, {nama} telah melebihi batas waktu izin keluar kelas.',
    discipline_late_weight: 2,
    discipline_alpha_weight: 10,
    discipline_late_return_weight: 3,
    discipline_full_attendance_bonus: 5,
    out_of_class_max_per_class: 2,
    out_of_class_max_per_student_daily: 3,
    out_of_class_bak_duration: 5,
    out_of_class_bab_duration: 10,
    out_of_class_other_duration: 15,
    toggle_allow_edit_violation_points: true,
    toggle_email_notifications: true,
    toggle_kiosk_mode: false,
    auto_session_switch: true,
    auto_session_switch_notify: true,
    updated_at: nowIso,
    diubah_pada: nowIso,
  };
}

function defaultNotificationSettings(nowIso: string): NotificationSettings {
  return {
    email_enabled: true,
    trigger_late: true,
    trigger_alpha: true,
    trigger_leave: true,
    trigger_violation: true,
    trigger_warning_threshold: true,
    trigger_overdue_out_of_class: true,
    warning_threshold_points: 25,
    subject_template: 'Pemberitahuan Kedisiplinan Siswa: {nama_siswa} ({kelas})',
    body_template:
      'Yth. Orang Tua/Wali dari {nama_siswa},\n\nKami menginformasikan catatan kedisiplinan siswa pada tanggal {tanggal} pukul {jam}:\nStatus / Kejadian: {status}\nSekolah: {nama_sekolah}\n\nTerima kasih atas kerja samanya.',
    weekly_recap_enabled: false,
    weekly_recap_day: 5,
    weekly_recap_time: '15:00',
    weekly_recap_last_sent: '',
    updated_at: nowIso,
    diubah_pada: nowIso,
  };
}

function defaultSessions(nowIso: string): AttendanceSession[] {
  return [
    {
      id: 'sesi_pagi',
      name: 'Presensi Masuk Pagi',
      start_time: '06:00',
      on_time_limit: '07:00',
      end_time: '08:00',
      active_days: [1, 2, 3, 4, 5, 6],
      late_tolerance_minutes: 0,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'sesi_jam_pertama',
      name: 'Jam Pelajaran Pertama',
      start_time: '08:01',
      on_time_limit: '08:15',
      end_time: '11:45',
      active_days: [1, 2, 3, 4, 5, 6],
      late_tolerance_minutes: 0,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'sesi_zuhur',
      name: 'Sholat Zuhur & Siang',
      start_time: '11:46',
      on_time_limit: '12:30',
      end_time: '13:30',
      active_days: [1, 2, 3, 4, 5, 6],
      late_tolerance_minutes: 0,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'sesi_pulang',
      name: 'Presensi Pulang Sekolah',
      start_time: '13:31',
      on_time_limit: '15:00',
      end_time: '17:30',
      active_days: [1, 2, 3, 4, 5, 6],
      late_tolerance_minutes: 0,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
  ];
}

function defaultClasses(nowIso: string): SchoolClass[] {
  return [
    {
      id: '10-RPL-1',
      name: '10 RPL 1',
      grade: '10',
      major: 'Rekayasa Perangkat Lunak',
      homeroom_teacher_name: 'Wali Kelas 10 RPL 1',
      homeroom_teacher_email: '',
      quota_limit: 2,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: '11-RPL-1',
      name: '11 RPL 1',
      grade: '11',
      major: 'Rekayasa Perangkat Lunak',
      homeroom_teacher_name: 'Wali Kelas 11 RPL 1',
      homeroom_teacher_email: '',
      quota_limit: 2,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
  ];
}

function defaultViolationTypes(nowIso: string): ViolationType[] {
  return [
    {
      id: 'vt_ringan_atribut',
      code: 'P-01',
      name: 'Atribut Seragam Tidak Lengkap',
      category: 'ringan',
      default_points: 5,
      is_active: true,
      description: 'Tidak memakai dasi, ikat pinggang, atau badge sekolah.',
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'vt_sedang_bolospkl',
      code: 'P-02',
      name: 'Meninggalkan Pelajaran Tanpa Izin',
      category: 'sedang',
      default_points: 15,
      is_active: true,
      description: 'Keluar kelas atau area sekolah tanpa izin guru/petugas piket.',
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'vt_berat_perkelahian',
      code: 'P-03',
      name: 'Berkelahi / Kekerasan',
      category: 'berat',
      default_points: 50,
      is_active: true,
      description: 'Terlibat perkelahian atau tindakan kekerasan fisik.',
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'vt_prestasi_lomba',
      code: 'PR-01',
      name: 'Prestasi Akademik / Non-Akademik',
      category: 'prestasi',
      default_points: 15,
      is_active: true,
      description: 'Meraih juara atau mengharumkan nama sekolah.',
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
  ];
}

function defaultUsers(nowIso: string): User[] {
  return [
    {
      id: 'user_duty_main',
      role: 'duty',
      name: 'Petugas Piket Utama',
      label: 'Gerbang Utama & Pos Piket',
      password_hash: bcrypt.hashSync('piket123', 10),
      token_version: 1,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'user_homeroom_master',
      role: 'homeroom',
      name: 'Wali Kelas Umum',
      label: 'Sandi Bersama Seluruh Wali Kelas',
      password_hash: bcrypt.hashSync('walikelas123', 10),
      token_version: 1,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'user_student_affairs',
      role: 'student_affairs',
      name: 'Bagian Kesiswaan & Tatib',
      label: 'Tim Kesiswaan',
      password_hash: bcrypt.hashSync('kesiswaan123', 10),
      token_version: 1,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
    {
      id: 'user_admin_main',
      role: 'admin',
      name: 'Administrator Sekolah',
      label: 'Admin Sistem',
      password_hash: bcrypt.hashSync('admin123', 10),
      token_version: 1,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    },
  ];
}

interface RawSheetRows {
  rows: Record<string, string>[];
}

export interface FullSheetDatabase {
  students: Student[];
  classes: SchoolClass[];
  sessions: AttendanceSession[];
  attendance: AttendanceRecord[];
  out_of_class: OutOfClassRecord[];
  violations: ViolationRecord[];
  violation_types: ViolationType[];
  leave_requests: LeaveRequest[];
  users: User[];
  settings: AppSettings;
  notification_settings: NotificationSettings;
  notification_logs: NotificationLog[];
  audit_logs: AuditLog[];
  rekap_per_sesi: any[];
}

export class SheetsDatabaseService {
  private readonly oauthTokenStorage = new AsyncLocalStorage<string>();

  public runWithOAuthToken<T>(token: string | undefined, fn: () => Promise<T>): Promise<T> {
    const clean = (token || '').trim();
    if (!clean) return fn();
    return this.oauthTokenStorage.run(clean, fn);
  }

  public getOAuthAccessToken(): string | undefined {
    const clean = (this.oauthTokenStorage.getStore() || '').trim();
    return clean || undefined;
  }

  private getCredentials(): {
    clientEmail: string;
    privateKey: string;
    spreadsheetId: string;
    driveFolderId: string;
    oauthToken: string;
  } {
    const oauthToken = (this.oauthTokenStorage.getStore() || '').trim();
    let clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    let rawKey = (process.env.GOOGLE_PRIVATE_KEY || '').trim();

    // Support optional combined GOOGLE_SERVICE_ACCOUNT_JSON env var
    const rawJson = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
    if ((!clientEmail || !rawKey) && rawJson) {
      try {
        const jsonText = rawJson.startsWith('{')
          ? rawJson
          : Buffer.from(rawJson, 'base64').toString('utf8');
        const parsed = JSON.parse(jsonText);
        if (!clientEmail && parsed.client_email) clientEmail = String(parsed.client_email).trim();
        if (!rawKey && parsed.private_key) rawKey = String(parsed.private_key).trim();
      } catch {
        // Ignore malformed optional JSON
      }
    }

    // Strip surrounding quotes if pasted with JSON quotes
    if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
      rawKey = rawKey.slice(1, -1);
    }
    let privateKey = rawKey.replace(/\\n/g, '\n').trim();
    if (privateKey && !privateKey.includes('BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(privateKey)) {
      try {
        const decoded = Buffer.from(privateKey, 'base64').toString('utf8');
        if (decoded.includes('BEGIN')) {
          privateKey = decoded.replace(/\\n/g, '\n').trim();
        }
      } catch {}
    }

    let spreadsheetId = (process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID).trim();
    const sheetUrlMatch = spreadsheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (sheetUrlMatch?.[1]) {
      spreadsheetId = sheetUrlMatch[1];
    } else {
      spreadsheetId = spreadsheetId.split(/[?#/\s]/)[0].trim();
    }

    let driveFolderId = (process.env.DRIVE_FOLDER_ID || DEFAULT_DRIVE_FOLDER_ID).trim();
    const folderUrlMatch = driveFolderId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderUrlMatch?.[1]) {
      driveFolderId = folderUrlMatch[1];
    } else {
      driveFolderId = driveFolderId.split(/[?#/\s]/)[0].trim();
    }

    return { clientEmail, privateKey, spreadsheetId, driveFolderId, oauthToken };
  }

  public checkConfig(requireDrive = false): { configured: boolean; missingEnv: string[] } {
    const creds = this.getCredentials();
    const missingEnv: string[] = [];
    if (!creds.oauthToken) {
      if (!creds.clientEmail) missingEnv.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
      if (!creds.privateKey) missingEnv.push('GOOGLE_PRIVATE_KEY');
    }
    if (!creds.spreadsheetId) missingEnv.push('SPREADSHEET_ID');
    if (requireDrive && !creds.driveFolderId && !creds.oauthToken) missingEnv.push('DRIVE_FOLDER_ID');
    return {
      configured: missingEnv.length === 0,
      missingEnv,
    };
  }

  public getFullEnvStatus(): {
    configured: boolean;
    sheetsConfigured: boolean;
    driveConfigured: boolean;
    missingEnv: string[];
    spreadsheetConfigured: boolean;
    driveFolderConfigured: boolean;
    hasServiceAccount: boolean;
    authMode: 'google_oauth' | 'service_account' | 'unconfigured';
    requiresGoogleSignIn: boolean;
  } {
    const creds = this.getCredentials();
    const hasServiceAccount = Boolean(creds.clientEmail && creds.privateKey);
    const hasGoogleOAuth = Boolean(creds.oauthToken);
    const authMode: 'google_oauth' | 'service_account' | 'unconfigured' = hasGoogleOAuth
      ? 'google_oauth'
      : hasServiceAccount
      ? 'service_account'
      : 'unconfigured';

    const missingSheets: string[] = [];
    if (!hasGoogleOAuth) {
      if (!creds.clientEmail) missingSheets.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
      if (!creds.privateKey) missingSheets.push('GOOGLE_PRIVATE_KEY');
    }
    if (!creds.spreadsheetId) missingSheets.push('SPREADSHEET_ID');

    const missingAll = [...missingSheets];
    if (!creds.driveFolderId && !hasGoogleOAuth) missingAll.push('DRIVE_FOLDER_ID');

    const sheetsConfigured = missingSheets.length === 0;
    const driveConfigured = sheetsConfigured && (Boolean(creds.driveFolderId) || hasGoogleOAuth);

    return {
      configured: missingAll.length === 0,
      sheetsConfigured,
      driveConfigured,
      missingEnv: missingAll,
      spreadsheetConfigured: Boolean(creds.spreadsheetId),
      driveFolderConfigured: Boolean(creds.driveFolderId) || hasGoogleOAuth,
      hasServiceAccount,
      authMode,
      requiresGoogleSignIn: !hasServiceAccount && !hasGoogleOAuth,
    };
  }

  private createClients(requireDrive = false): {
    sheets: sheets_v4.Sheets;
    drive: drive_v3.Drive;
    spreadsheetId: string;
    driveFolderId: string;
    isOAuthMode: boolean;
  } {
    const check = this.checkConfig(requireDrive);
    if (!check.configured) {
      throw new SheetsConfigError(check.missingEnv);
    }
    const creds = this.getCredentials();
    if (creds.oauthToken) {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: creds.oauthToken });
      return {
        sheets: google.sheets({ version: 'v4', auth: oauth2Client }),
        drive: google.drive({ version: 'v3', auth: oauth2Client }),
        spreadsheetId: creds.spreadsheetId,
        driveFolderId: creds.driveFolderId,
        isOAuthMode: true,
      };
    }

    const auth = new google.auth.JWT({
      email: creds.clientEmail,
      key: creds.privateKey,
      scopes: SCOPES,
    });
    return {
      sheets: google.sheets({ version: 'v4', auth }),
      drive: google.drive({ version: 'v3', auth }),
      spreadsheetId: creds.spreadsheetId,
      driveFolderId: creds.driveFolderId,
      isOAuthMode: false,
    };
  }

  private async withRetry429<T>(fn: () => Promise<T>): Promise<T> {
    const delays = [1000, 2500, 5000];
    let lastErr: any;
    const inOAuthMode = Boolean(this.oauthTokenStorage.getStore());
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const status = err?.code || err?.status || err?.response?.status;
        const msg = String(err?.message || '').toLowerCase();

        if (
          inOAuthMode &&
          (status === 401 ||
            msg.includes('invalid credentials') ||
            msg.includes('invalid authentication credentials') ||
            msg.includes('request had invalid authentication'))
        ) {
          throw new GoogleAuthExpiredError();
        }

        const is429 =
          status === 429 ||
          msg.includes('quota') ||
          msg.includes('rate limit') ||
          msg.includes('resource_exhausted') ||
          msg.includes('too many requests');

        if (!is429 || attempt === delays.length) {
          throw err;
        }
        const waitMs = delays[attempt];
        console.warn(`[Sheets 429 Retry ${attempt + 1}/${delays.length}] Waiting ${waitMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastErr;
  }

  /**
   * Ensure all 13 tabs exist and have exact header rows (row 1).
   */
  public async ensureSheetsAndHeaders(): Promise<void> {
    const { sheets, spreadsheetId } = this.createClients(false);
    const meta = await this.withRetry429(() =>
      sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title,sheets.properties.sheetId',
      })
    );

    const existingTitles = new Set(
      (meta.data.sheets || []).map((s) => s.properties?.title || '').filter(Boolean)
    );

    const allTabs = Object.values(SHEET_TABS);
    const missingTabs = allTabs.filter((t) => !existingTitles.has(t));

    if (missingTabs.length > 0) {
      await this.withRetry429(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: missingTabs.map((title) => ({
              addSheet: {
                properties: {
                  title,
                  gridProperties: { frozenRowCount: 1 },
                },
              },
            })),
          },
        })
      );
    }

    // Verify header row 1 across all tabs in one batchGet
    const headerRanges = allTabs.map((t) => `${t}!1:1`);
    const headerRes = await this.withRetry429(() =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: headerRanges,
      })
    );

    const updates: sheets_v4.Schema$ValueRange[] = [];
    (headerRes.data.valueRanges || []).forEach((vr, idx) => {
      const tabName = allTabs[idx];
      const expected = SHEET_HEADERS[tabName];
      const existingRow = vr.values?.[0] || [];
      const needsHeader =
        existingRow.length < expected.length ||
        expected.some((col, cIdx) => String(existingRow[cIdx] || '').trim() !== col);

      if (needsHeader) {
        updates.push({
          range: `${tabName}!A1:${colIndexToLetter(expected.length - 1)}1`,
          values: [expected],
        });
      }
    });

    if (updates.length > 0) {
      await this.withRetry429(() =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: updates,
          },
        })
      );
    }
  }

  private rowsToObjects(tabName: string, values: any[][] | undefined): Record<string, string>[] {
    if (!values || values.length <= 1) return [];
    const expectedHeaders = SHEET_HEADERS[tabName];
    const sheetHeaders = (values[0] || []).map((h) => String(h || '').trim());
    const headers = sheetHeaders.length >= expectedHeaders.length ? sheetHeaders : expectedHeaders;

    const list: Record<string, string>[] = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const obj: Record<string, string> = {};
      let hasAnyVal = false;
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c] || expectedHeaders[c];
        if (!key) continue;
        const val = row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
        if (val !== '') hasAnyVal = true;
        obj[key] = val;
      }
      if (hasAnyVal && obj.id) {
        list.push(obj);
      }
    }
    return list;
  }

  private objectToRowArray(tabName: string, obj: Record<string, any>): any[] {
    const headers = SHEET_HEADERS[tabName];
    return headers.map((h) => {
      const val = obj[h];
      if (val === undefined || val === null) return '';
      if (Array.isArray(val) || typeof val === 'object') return JSON.stringify(val);
      return val;
    });
  }

  /**
   * Read a single sheet tab and return raw objects + row positions (1-based sheet row).
   */
  private async readTabWithRowNumbers(
    tabName: string
  ): Promise<{ rowNumber: number; data: Record<string, string> }[]> {
    const { sheets, spreadsheetId } = this.createClients(false);
    const headers = SHEET_HEADERS[tabName];
    const range = `${tabName}!A:${colIndexToLetter(headers.length - 1)}`;

    let values: any[][] | undefined;
    try {
      const res = await this.withRetry429(() =>
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        })
      );
      values = res.data.values || undefined;
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('unable to parse range')) {
        await this.ensureSheetsAndHeaders();
        const retryRes = await this.withRetry429(() =>
          sheets.spreadsheets.values.get({ spreadsheetId, range })
        );
        values = retryRes.data.values || undefined;
      } else {
        throw err;
      }
    }

    if (!values || values.length <= 1) return [];
    const results: { rowNumber: number; data: Record<string, string> }[] = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const obj: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        obj[headers[c]] = row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
      }
      if (obj.id) {
        results.push({ rowNumber: i + 1, data: obj });
      }
    }
    return results;
  }

  /**
   * Append rows directly to a Google Sheet tab (Column A = id).
   */
  private async appendRows(tabName: string, rowObjects: Record<string, any>[]): Promise<void> {
    if (rowObjects.length === 0) return;
    const { sheets, spreadsheetId } = this.createClients(false);
    const headers = SHEET_HEADERS[tabName];
    const range = `${tabName}!A:${colIndexToLetter(headers.length - 1)}`;
    const values = rowObjects.map((o) => this.objectToRowArray(tabName, o));

    try {
      await this.withRetry429(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values },
        })
      );
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('unable to parse range')) {
        await this.ensureSheetsAndHeaders();
        await this.withRetry429(() =>
          sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values },
          })
        );
      } else {
        throw err;
      }
    }
  }

  /**
   * Partial cell update: finds row by Column A `id`, validates `diubah_pada` for optimistic locking,
   * and updates ONLY changed cells using spreadsheets.values.batchUpdate.
   */
  private async updateRowPartial(params: {
    tabName: string;
    id: string;
    newRowObj: Record<string, any>;
    expectedUpdatedAt?: string;
    forceOverwrite?: boolean;
    actorName?: string;
    reason?: string;
    skipLog?: boolean;
  }): Promise<{ updated: boolean; oldObj?: Record<string, string> }> {
    const { tabName, id, newRowObj, expectedUpdatedAt, forceOverwrite, actorName, reason, skipLog } = params;
    const { sheets, spreadsheetId } = this.createClients(false);
    const headers = SHEET_HEADERS[tabName];
    const rows = await this.readTabWithRowNumbers(tabName);
    const match = rows.find((r) => r.data.id === id);

    if (!match || match.data.status === 'dihapus') {
      return { updated: false };
    }

    const existing = match.data;

    if (
      !forceOverwrite &&
      expectedUpdatedAt &&
      existing.diubah_pada &&
      existing.diubah_pada !== expectedUpdatedAt
    ) {
      throw new ConflictError(
        'Data sudah diubah oleh pengguna lain sebelum Anda menyimpan. Silakan muat ulang atau konfirmasi timpa.',
        existing
      );
    }

    const nowIso = new Date().toISOString();
    const targetRow: Record<string, any> = {
      ...existing,
      ...newRowObj,
      id,
      status: newRowObj.status || existing.status || 'aktif',
      diubah_pada: newRowObj.diubah_pada || nowIso,
      ...(headers.includes('updated_at') ? { updated_at: newRowObj.updated_at || nowIso } : {}),
    };

    const cellUpdates: sheets_v4.Schema$ValueRange[] = [];
    const oldDiff: Record<string, any> = {};
    const newDiff: Record<string, any> = {};

    headers.forEach((col, colIdx) => {
      const oldValStr = existing[col] ?? '';
      const rawNewVal = targetRow[col];
      const newValStr =
        rawNewVal === undefined || rawNewVal === null
          ? ''
          : Array.isArray(rawNewVal) || typeof rawNewVal === 'object'
          ? JSON.stringify(rawNewVal)
          : String(rawNewVal);

      if (oldValStr !== newValStr) {
        const colLetter = colIndexToLetter(colIdx);
        cellUpdates.push({
          range: `${tabName}!${colLetter}${match.rowNumber}`,
          values: [[Array.isArray(rawNewVal) || typeof rawNewVal === 'object' ? newValStr : (rawNewVal ?? '')]],
        });
        if (col !== 'diubah_pada' && col !== 'updated_at') {
          oldDiff[col] = oldValStr;
          newDiff[col] = newValStr;
        }
      }
    });

    if (cellUpdates.length > 0) {
      await this.withRetry429(() =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: cellUpdates,
          },
        })
      );

      if (!skipLog && Object.keys(newDiff).length > 0) {
        await this.appendLog({
          waktu: nowIso,
          pengguna: actorName || 'Sistem',
          id_data: id,
          tabel: tabName,
          aksi: 'edit',
          nilai_lama: JSON.stringify(oldDiff),
          nilai_baru: JSON.stringify(newDiff),
          reason: reason || '',
        });
      }
    }

    return { updated: true, oldObj: existing };
  }

  /**
   * Soft Delete: sets ONLY `status = 'dihapus'` and `diubah_pada` without removing physical rows.
   */
  private async softDeleteRow(params: {
    tabName: string;
    id: string;
    actorName?: string;
    reason?: string;
  }): Promise<boolean> {
    const { tabName, id, actorName, reason } = params;
    const { sheets, spreadsheetId } = this.createClients(false);
    const headers = SHEET_HEADERS[tabName];
    const rows = await this.readTabWithRowNumbers(tabName);
    const match = rows.find((r) => r.data.id === id && r.data.status !== 'dihapus');
    if (!match) return false;

    const nowIso = new Date().toISOString();
    const cellUpdates: sheets_v4.Schema$ValueRange[] = [];

    const statusColIdx = headers.indexOf('status');
    const changedColIdx = headers.indexOf('diubah_pada');
    const updatedColIdx = headers.indexOf('updated_at');

    if (statusColIdx >= 0) {
      cellUpdates.push({
        range: `${tabName}!${colIndexToLetter(statusColIdx)}${match.rowNumber}`,
        values: [['dihapus']],
      });
    }
    if (changedColIdx >= 0) {
      cellUpdates.push({
        range: `${tabName}!${colIndexToLetter(changedColIdx)}${match.rowNumber}`,
        values: [[nowIso]],
      });
    }
    if (updatedColIdx >= 0) {
      cellUpdates.push({
        range: `${tabName}!${colIndexToLetter(updatedColIdx)}${match.rowNumber}`,
        values: [[nowIso]],
      });
    }

    if (cellUpdates.length > 0) {
      await this.withRetry429(() =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: cellUpdates,
          },
        })
      );
    }

    await this.appendLog({
      waktu: nowIso,
      pengguna: actorName || 'Petugas',
      id_data: id,
      tabel: tabName,
      aksi: 'hapus',
      nilai_lama: JSON.stringify(match.data),
      nilai_baru: JSON.stringify({ status: 'dihapus' }),
      reason: reason || 'Soft delete',
    });

    return true;
  }

  public async appendLog(entry: {
    waktu?: string;
    pengguna: string;
    id_data: string;
    tabel: string;
    aksi: 'tambah' | 'edit' | 'hapus' | string;
    nilai_lama?: string;
    nilai_baru?: string;
    reason?: string;
  }): Promise<void> {
    const nowIso = entry.waktu || new Date().toISOString();
    const id = `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await this.appendRows(SHEET_TABS.LOG, [
      {
        id,
        waktu: nowIso,
        pengguna: entry.pengguna || 'Sistem',
        id_data: entry.id_data,
        tabel: entry.tabel,
        aksi: entry.aksi,
        nilai_lama: entry.nilai_lama || '',
        nilai_baru: entry.nilai_baru || '',
        reason: entry.reason || '',
        status: 'aktif',
        diubah_pada: nowIso,
      },
    ]);
  }

  // ==================== PHOTO STORAGE VIA PRIVATE GOOGLE DRIVE v3 ====================

  private async ensureAppDriveFolder(drive: drive_v3.Drive): Promise<string> {
    const folderName = 'DISIPLIN KITA BISA - Foto';
    const existing = await this.withRetry429(() =>
      drive.files.list({
        q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id,name)',
        pageSize: 1,
      })
    );
    const foundId = existing.data.files?.[0]?.id;
    if (foundId) return foundId;

    const created = await this.withRetry429(() =>
      drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      })
    );
    if (!created.data.id) {
      throw new Error('Gagal membuat folder foto di Google Drive.');
    }
    return created.data.id;
  }

  public async uploadPhotoToDrive(base64Input: string, fileName: string): Promise<string> {
    const { drive, driveFolderId } = this.createClients(true);
    let cleanBase64 = (base64Input || '').trim();
    let mimeType = 'image/jpeg';

    const match = cleanBase64.match(/^data:([^;]+);base64,(.+)$/i);
    if (match) {
      mimeType = match[1] || 'image/jpeg';
      cleanBase64 = match[2];
    } else {
      cleanBase64 = cleanBase64.replace(/^data:[^;]*;base64,/i, '');
    }

    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length === 0) {
      throw new Error('Data foto kosong atau tidak valid.');
    }

    const createInFolder = async (folderId?: string) => {
      return await this.withRetry429(() =>
        drive.files.create({
          requestBody: {
            name: fileName || `foto_${Date.now()}.jpg`,
            ...(folderId ? { parents: [folderId] } : {}),
          },
          media: {
            mimeType,
            body: Readable.from(buffer),
          },
          fields: 'id',
          supportsAllDrives: true,
        })
      );
    };

    let res;
    try {
      if (driveFolderId) {
        res = await createInFolder(driveFolderId);
      } else {
        const appFolderId = await this.ensureAppDriveFolder(drive);
        res = await createInFolder(appFolderId);
      }
    } catch (err: any) {
      if (err instanceof GoogleAuthExpiredError) throw err;
      const status = err?.code || err?.status || err?.response?.status;
      const msg = String(err?.message || '').toLowerCase();
      if (status === 403 || status === 404 || msg.includes('not found') || msg.includes('permission') || msg.includes('insufficient')) {
        try {
          const appFolderId = await this.ensureAppDriveFolder(drive);
          res = await createInFolder(appFolderId);
        } catch (fallbackErr: any) {
          if (fallbackErr instanceof GoogleAuthExpiredError) throw fallbackErr;
          res = await createInFolder(undefined);
        }
      } else {
        throw err;
      }
    }

    const fileId = res.data.id;
    if (!fileId) {
      throw new Error('Gagal mendapatkan ID file setelah mengunggah ke Google Drive.');
    }
    return fileId;
  }

  public async getPhotoFromDrive(fileIdOrUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const cleanId = extractDriveFileId(fileIdOrUrl);
    if (!cleanId) {
      throw new DriveNotFoundError('ID file Drive tidak valid.');
    }
    const { drive } = this.createClients(false);

    try {
      const metaRes = await this.withRetry429(() =>
        drive.files.get({
          fileId: cleanId,
          fields: 'id,mimeType,name,trashed',
          supportsAllDrives: true,
        })
      );

      if (metaRes.data.trashed) {
        throw new DriveNotFoundError('Foto sudah dihapus di Google Drive.');
      }

      const mediaRes = await this.withRetry429(() =>
        drive.files.get(
          {
            fileId: cleanId,
            alt: 'media',
            supportsAllDrives: true,
          },
          { responseType: 'arraybuffer' }
        )
      );

      return {
        buffer: Buffer.from(mediaRes.data as ArrayBuffer),
        mimeType: metaRes.data.mimeType || 'image/jpeg',
      };
    } catch (err: any) {
      if (err instanceof GoogleAuthExpiredError || err instanceof DriveNotFoundError) {
        throw err;
      }
      const status = err?.code || err?.status || err?.response?.status;
      const msg = String(err?.message || '').toLowerCase();
      if (status === 404 || status === 403 || msg.includes('file not found') || msg.includes('not found')) {
        throw new DriveNotFoundError('Foto tidak ditemukan atau tidak memiliki akses di Google Drive.');
      }
      throw err;
    }
  }

  /**
   * Read the entire database directly from Google Sheets in ONE batchGet call.
   * Seeds default Users, Sessions, Classes, ViolationTypes, and Settings if the spreadsheet is brand new.
   */
  public async getFullDatabase(): Promise<FullSheetDatabase> {
    const { sheets, spreadsheetId } = this.createClients(false);
    const allTabs = Object.values(SHEET_TABS);
    const ranges = allTabs.map((t) => {
      const cols = SHEET_HEADERS[t];
      return `${t}!A:${colIndexToLetter(cols.length - 1)}`;
    });

    let valueRanges: sheets_v4.Schema$ValueRange[] = [];
    try {
      const res = await this.withRetry429(() =>
        sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges })
      );
      valueRanges = res.data.valueRanges || [];
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('unable to parse range')) {
        await this.ensureSheetsAndHeaders();
        const retryRes = await this.withRetry429(() =>
          sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges })
        );
        valueRanges = retryRes.data.valueRanges || [];
      } else {
        throw err;
      }
    }

    const rawByTab = new Map<string, Record<string, string>[]>();
    allTabs.forEach((tab, idx) => {
      const vr = valueRanges[idx];
      rawByTab.set(tab, this.rowsToObjects(tab, vr?.values as any[][] | undefined));
    });

    // Check if brand-new sheet (Users or Pengaturan completely missing)
    const nowIso = new Date().toISOString();
    let seeded = false;

    const rawUsers = rawByTab.get(SHEET_TABS.USERS) || [];
    if (rawUsers.length === 0) {
      await this.ensureSheetsAndHeaders();
      const users = defaultUsers(nowIso);
      await this.appendRows(
        SHEET_TABS.USERS,
        users.map((u) => ({ ...u, status: 'aktif', diubah_pada: nowIso }))
      );
      seeded = true;
    }

    const rawSettings = rawByTab.get(SHEET_TABS.PENGATURAN) || [];
    if (rawSettings.length === 0) {
      const s = defaultSettings(nowIso);
      const n = defaultNotificationSettings(nowIso);
      await this.appendRows(SHEET_TABS.PENGATURAN, [
        { id: 'app_settings', tipe: 'app', json_data: JSON.stringify(s), status: 'aktif', diubah_pada: nowIso },
        { id: 'notification_settings', tipe: 'notification', json_data: JSON.stringify(n), status: 'aktif', diubah_pada: nowIso },
      ]);
      seeded = true;
    }

    const rawSessions = rawByTab.get(SHEET_TABS.SESI_PRESENSI) || [];
    if (rawSessions.length === 0) {
      const sess = defaultSessions(nowIso);
      await this.appendRows(
        SHEET_TABS.SESI_PRESENSI,
        sess.map((s) => ({ ...s, active_days: JSON.stringify(s.active_days), status: 'aktif', diubah_pada: nowIso }))
      );
      seeded = true;
    }

    const rawClasses = rawByTab.get(SHEET_TABS.KELAS) || [];
    if (rawClasses.length === 0) {
      const cls = defaultClasses(nowIso);
      await this.appendRows(
        SHEET_TABS.KELAS,
        cls.map((c) => ({ ...c, status: 'aktif', diubah_pada: nowIso }))
      );
      seeded = true;
    }

    const rawVTypes = rawByTab.get(SHEET_TABS.JENIS_PELANGGARAN) || [];
    if (rawVTypes.length === 0) {
      const vts = defaultViolationTypes(nowIso);
      await this.appendRows(
        SHEET_TABS.JENIS_PELANGGARAN,
        vts.map((v) => ({ ...v, status: 'aktif', diubah_pada: nowIso }))
      );
      seeded = true;
    }

    if (seeded) {
      const reRes = await this.withRetry429(() =>
        sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges })
      );
      (reRes.data.valueRanges || []).forEach((vr, idx) => {
        rawByTab.set(allTabs[idx], this.rowsToObjects(allTabs[idx], vr?.values as any[][] | undefined));
      });
    }

    const activeFilter = (r: Record<string, string>) => r.status !== 'dihapus';

    const students: Student[] = (rawByTab.get(SHEET_TABS.SISWA) || [])
      .filter(activeFilter)
      .map((r) => ({
        nis: r.nis || r.id,
        nisn: r.nisn || '',
        name: r.name || '',
        class_id: r.class_id || '',
        gender: r.gender === 'P' ? 'P' : 'L',
        rfid_uid: r.rfid_uid || '',
        card_code: r.card_code || r.rfid_uid || '',
        photo_url: r.photo_url || '',
        parent_name: r.parent_name || '',
        parent_email: r.parent_email || '',
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const classes: SchoolClass[] = (rawByTab.get(SHEET_TABS.KELAS) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        name: r.name || r.id,
        grade: r.grade || '10',
        major: r.major || '',
        homeroom_teacher_name: r.homeroom_teacher_name || '',
        homeroom_teacher_email: r.homeroom_teacher_email || '',
        quota_limit: parseNum(r.quota_limit, 2),
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const sessions: AttendanceSession[] = (rawByTab.get(SHEET_TABS.SESI_PRESENSI) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        name: r.name || r.id,
        start_time: r.start_time || '06:00',
        on_time_limit: r.on_time_limit || '07:00',
        end_time: r.end_time || '08:00',
        active_days: parseJsonArray<number>(r.active_days, [1, 2, 3, 4, 5, 6]),
        late_tolerance_minutes: parseNum(r.late_tolerance_minutes, 0),
        is_active: parseBool(r.is_active, true),
        is_override: parseBool(r.is_override, false),
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const attendance: AttendanceRecord[] = (rawByTab.get(SHEET_TABS.PRESENSI) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        student_id: r.student_id,
        session_id: r.session_id,
        date: r.date,
        timestamp: r.timestamp || r.created_at || nowIso,
        status: (r.status_presensi as any) || 'Hadir',
        late_minutes: parseNum(r.late_minutes, 0),
        method: (r.method as any) || 'barcode',
        device_id: r.device_id || 'kiosk_main',
        photo_id: r.photo_id || '',
        notes: r.notes || '',
        audited_by: r.audited_by || '',
        audit_reason: r.audit_reason || '',
        version: parseNum(r.version, 1),
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const out_of_class: OutOfClassRecord[] = (rawByTab.get(SHEET_TABS.IZIN_KELUAR) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        student_id: r.student_id,
        class_id: r.class_id,
        type: (r.type as any) || 'BAK',
        duration_minutes: parseNum(r.duration_minutes, 5),
        started_at: r.started_at || nowIso,
        due_at: r.due_at || nowIso,
        returned_at: r.returned_at || undefined,
        actual_minutes: r.actual_minutes ? parseNum(r.actual_minutes, 0) : undefined,
        late_return_minutes: parseNum(r.late_return_minutes, 0),
        return_method: (r.return_method as any) || undefined,
        status: (r.status_izin as any) || 'active',
        return_notes: r.return_notes || undefined,
        audited_by: r.audited_by || undefined,
        audit_reason: r.audit_reason || undefined,
        idempotency_key: r.idempotency_key || r.id,
        version: parseNum(r.version, 1),
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const violations: ViolationRecord[] = (rawByTab.get(SHEET_TABS.PELANGGARAN) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        student_id: r.student_id,
        class_id: r.class_id,
        violation_type_id: r.violation_type_id,
        type_name: r.type_name,
        category: (r.category as any) || 'ringan',
        points: parseNum(r.points, 0),
        notes: r.notes || '',
        location: r.location || '',
        evidence_photo_url: r.evidence_photo_url || '',
        recorded_by: r.recorded_by || 'Petugas',
        recorded_at: r.recorded_at || r.created_at || nowIso,
        version: parseNum(r.version, 1),
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const violation_types: ViolationType[] = (rawByTab.get(SHEET_TABS.JENIS_PELANGGARAN) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        code: r.code || '',
        name: r.name || '',
        category: (r.category as any) || 'ringan',
        default_points: parseNum(r.default_points, 5),
        is_active: parseBool(r.is_active, true),
        description: r.description || '',
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const leave_requests: LeaveRequest[] = (rawByTab.get(SHEET_TABS.IZIN_TIDAK_MASUK) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        student_id: r.student_id,
        class_id: r.class_id,
        type: (r.type as any) || 'Izin',
        start_date: r.start_date,
        end_date: r.end_date,
        reason: r.reason || '',
        letter_file_url: r.letter_file_url || undefined,
        status: (r.status_persetujuan as any) || 'pending',
        approved_by: r.approved_by || undefined,
        approved_at: r.approved_at || undefined,
        rejection_reason: r.rejection_reason || undefined,
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const users: User[] = (rawByTab.get(SHEET_TABS.USERS) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        role: (r.role as UserRole) || 'duty',
        name: r.name || '',
        class_id: r.class_id || undefined,
        email: r.email || undefined,
        password_hash: r.password_hash || '',
        label: r.label || '',
        token_version: parseNum(r.token_version, 1),
        is_active: parseBool(r.is_active, true),
        created_at: r.created_at || nowIso,
        updated_at: r.updated_at || r.diubah_pada || nowIso,
        diubah_pada: r.diubah_pada || r.updated_at || nowIso,
      }));

    const settingsRows = (rawByTab.get(SHEET_TABS.PENGATURAN) || []).filter(activeFilter);
    const appSettingsRow = settingsRows.find((r) => r.id === 'app_settings');
    const notifSettingsRow = settingsRows.find((r) => r.id === 'notification_settings');

    let settings = defaultSettings(nowIso);
    if (appSettingsRow?.json_data) {
      try {
        settings = {
          ...settings,
          ...JSON.parse(appSettingsRow.json_data),
          updated_at: appSettingsRow.diubah_pada || settings.updated_at,
          diubah_pada: appSettingsRow.diubah_pada || settings.diubah_pada,
        };
      } catch {}
    }

    let notification_settings = defaultNotificationSettings(nowIso);
    if (notifSettingsRow?.json_data) {
      try {
        notification_settings = {
          ...notification_settings,
          ...JSON.parse(notifSettingsRow.json_data),
          updated_at: notifSettingsRow.diubah_pada || notification_settings.updated_at,
          diubah_pada: notifSettingsRow.diubah_pada || notification_settings.diubah_pada,
        };
      } catch {}
    }

    const notification_logs: NotificationLog[] = (rawByTab.get(SHEET_TABS.NOTIFIKASI_LOG) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        timestamp: r.timestamp || nowIso,
        student_id: r.student_id,
        student_name: r.student_name,
        recipient_email: r.recipient_email,
        trigger_type: r.trigger_type,
        status: (r.status_kirim as any) || 'sent',
        error_message: r.error_message || undefined,
        created_at: r.created_at || nowIso,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const audit_logs: AuditLog[] = (rawByTab.get(SHEET_TABS.LOG) || [])
      .filter(activeFilter)
      .map((r) => ({
        id: r.id,
        timestamp: r.waktu || r.diubah_pada || nowIso,
        actor_name: r.pengguna || 'Sistem',
        actor_role: 'user',
        action: r.aksi || 'edit',
        entity: r.tabel || '-',
        entity_id: r.id_data || '-',
        old_values: r.nilai_lama || undefined,
        new_values: r.nilai_baru || undefined,
        reason: r.reason || undefined,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const rekap_per_sesi = (rawByTab.get(SHEET_TABS.REKAP_PER_SESI) || []).filter(activeFilter);

    return {
      students,
      classes,
      sessions,
      attendance,
      out_of_class,
      violations,
      violation_types,
      leave_requests,
      users,
      settings,
      notification_settings,
      notification_logs,
      audit_logs,
      rekap_per_sesi,
    };
  }

  // ==================== REPOSITORY METHODS (DIRECT SHEETS READ/WRITE) ====================

  public async getUsers(): Promise<User[]> {
    const db = await this.getFullDatabase();
    return db.users;
  }

  public async findDutyUsers(): Promise<User[]> {
    const users = await this.getUsers();
    return users.filter((u) => u.role === 'duty' && u.is_active);
  }

  public async findUserByRole(role: UserRole): Promise<User | undefined> {
    const users = await this.getUsers();
    return users.find((u) => u.role === role && u.is_active);
  }

  public async saveUser(user: User, actorName = 'Admin'): Promise<User> {
    const nowIso = new Date().toISOString();
    const record = {
      ...user,
      created_at: user.created_at || nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
      status: 'aktif',
    };
    const res = await this.updateRowPartial({
      tabName: SHEET_TABS.USERS,
      id: user.id,
      newRowObj: record,
      forceOverwrite: true,
      actorName,
      reason: 'Simpan akun pengguna',
    });
    if (!res.updated) {
      await this.appendRows(SHEET_TABS.USERS, [record]);
      await this.appendLog({
        waktu: nowIso,
        pengguna: actorName,
        id_data: user.id,
        tabel: SHEET_TABS.USERS,
        aksi: 'tambah',
        nilai_baru: JSON.stringify({ id: user.id, role: user.role, name: user.name }),
      });
    }
    return record;
  }

  public async deleteUser(id: string, actorName = 'Admin'): Promise<boolean> {
    return this.softDeleteRow({ tabName: SHEET_TABS.USERS, id, actorName, reason: 'Hapus akun pengguna' });
  }

  public async getStudents(): Promise<Student[]> {
    const db = await this.getFullDatabase();
    return db.students;
  }

  public async findStudentByCode(code: string): Promise<Student | undefined> {
    const clean = (code || '').trim().toLowerCase();
    if (!clean) return undefined;
    const students = await this.getStudents();
    return students.find(
      (s) =>
        s.nis.toLowerCase() === clean ||
        s.rfid_uid.toLowerCase() === clean ||
        s.card_code.toLowerCase() === clean
    );
  }

  public async saveStudent(
    student: Student & { expected_updated_at?: string; forceOverwrite?: boolean },
    actorName = 'Petugas'
  ): Promise<Student> {
    const nowIso = new Date().toISOString();
    const expectedUpdatedAt = student.expected_updated_at;
    const forceOverwrite = student.forceOverwrite;

    const cleanStudent: Student = {
      nis: String(student.nis).trim(),
      nisn: String(student.nisn || '').trim(),
      name: String(student.name).trim(),
      class_id: String(student.class_id).trim(),
      gender: student.gender === 'P' ? 'P' : 'L',
      rfid_uid: String(student.rfid_uid || '').trim(),
      card_code: String(student.card_code || student.rfid_uid || '').trim(),
      photo_url: String(student.photo_url || '').trim(),
      parent_name: String(student.parent_name || '').trim(),
      parent_email: String(student.parent_email || '').trim(),
      created_at: student.created_at || nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const rowPayload = {
      id: cleanStudent.nis,
      ...cleanStudent,
      status: 'aktif',
    };

    const updated = await this.updateRowPartial({
      tabName: SHEET_TABS.SISWA,
      id: cleanStudent.nis,
      newRowObj: rowPayload,
      expectedUpdatedAt,
      forceOverwrite,
      actorName,
      reason: 'Simpan data siswa',
    });

    if (!updated.updated) {
      await this.appendRows(SHEET_TABS.SISWA, [rowPayload]);
      await this.appendLog({
        waktu: nowIso,
        pengguna: actorName,
        id_data: cleanStudent.nis,
        tabel: SHEET_TABS.SISWA,
        aksi: 'tambah',
        nilai_baru: JSON.stringify(cleanStudent),
      });
    }

    return cleanStudent;
  }

  public async batchSaveStudents(
    incomingStudents: Partial<Student>[],
    actorName = 'Admin'
  ): Promise<{ inserted: number; updated: number; classesCreated: number }> {
    const nowIso = new Date().toISOString();
    const { sheets, spreadsheetId } = this.createClients(false);

    // 1. Auto-create missing classes in ONE batch append
    const existingClassRows = await this.readTabWithRowNumbers(SHEET_TABS.KELAS);
    const activeClassMap = new Map<string, string>();
    for (const cr of existingClassRows) {
      if (cr.data.status !== 'dihapus' && cr.data.id) {
        activeClassMap.set(cr.data.id.trim().toLowerCase(), cr.data.id.trim());
      }
    }

    const newClassesToAppend: Record<string, any>[] = [];
    for (const s of incomingStudents) {
      const cid = String(s?.class_id || '').trim();
      if (!cid) continue;
      const norm = cid.toLowerCase();
      if (!activeClassMap.has(norm)) {
        let grade = '10';
        const gMatch = cid.match(/^(10|11|12)/i) || cid.match(/^(X|XI|XII)\b/i);
        if (gMatch) {
          const gUp = gMatch[1].toUpperCase();
          grade = gUp === 'X' ? '10' : gUp === 'XI' ? '11' : gUp === 'XII' ? '12' : gUp;
        }
        const majorParts = cid.split('-');
        const major = majorParts.length > 1 ? majorParts[1].trim() : 'Umum';
        newClassesToAppend.push({
          id: cid,
          name: cid,
          grade,
          major: major || 'Umum',
          homeroom_teacher_name: `Wali Kelas ${cid}`,
          homeroom_teacher_email: `${cid.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sekolah.sch.id`,
          quota_limit: 2,
          created_at: nowIso,
          updated_at: nowIso,
          status: 'aktif',
          diubah_pada: nowIso,
        });
        activeClassMap.set(norm, cid);
      }
    }
    if (newClassesToAppend.length > 0) {
      await this.appendRows(SHEET_TABS.KELAS, newClassesToAppend);
    }

    // 2. Read Siswa tab ONCE and collect all row updates into a single batchUpdate
    const existingRows = await this.readTabWithRowNumbers(SHEET_TABS.SISWA);
    const existingMap = new Map(existingRows.map((r) => [r.data.id, r]));
    const headers = SHEET_HEADERS[SHEET_TABS.SISWA];
    const lastColLetter = colIndexToLetter(headers.length - 1);

    const toAppend: Record<string, any>[] = [];
    const batchRowUpdates: sheets_v4.Schema$ValueRange[] = [];
    let updatedCount = 0;

    for (const s of incomingStudents) {
      if (!s.nis || !s.name || !s.class_id) continue;
      const nis = String(s.nis).trim();
      const rawClassId = String(s.class_id).trim();
      const resolvedClassId = activeClassMap.get(rawClassId.toLowerCase()) || rawClassId;
      const existing = existingMap.get(nis);
      const hasActiveExisting = Boolean(existing && existing.data.status !== 'dihapus');
      const preservedPhoto =
        String(s.photo_url || '').trim() ||
        (hasActiveExisting ? String(existing!.data.photo_url || '').trim() : '');

      const record: Student & { id: string; status: string } = {
        id: nis,
        nis,
        nisn: String(s.nisn || '').trim(),
        name: String(s.name).trim(),
        class_id: resolvedClassId,
        gender: s.gender === 'P' ? 'P' : 'L',
        rfid_uid: String(s.rfid_uid || `RFID-${nis}`).trim(),
        card_code: String(s.card_code || s.rfid_uid || nis).trim(),
        photo_url: preservedPhoto,
        parent_name: String(s.parent_name || '').trim(),
        parent_email: String(s.parent_email || '').trim(),
        created_at: (hasActiveExisting && existing!.data.created_at) || s.created_at || nowIso,
        updated_at: nowIso,
        diubah_pada: nowIso,
        status: 'aktif',
      };

      if (hasActiveExisting) {
        const oldData = existing!.data;
        const hasRealChanges = headers.some((col) => {
          if (col === 'updated_at' || col === 'diubah_pada') return false;
          const oldVal = oldData[col] ?? '';
          const newVal = String((record as any)[col] ?? '');
          return oldVal !== newVal;
        });

        if (hasRealChanges) {
          batchRowUpdates.push({
            range: `${SHEET_TABS.SISWA}!A${existing!.rowNumber}:${lastColLetter}${existing!.rowNumber}`,
            values: [this.objectToRowArray(SHEET_TABS.SISWA, record)],
          });
          existing!.data = record as any;
          updatedCount++;
        }
      } else {
        toAppend.push(record);
        existingMap.set(nis, { rowNumber: -1, data: record as any });
      }
    }

    if (batchRowUpdates.length > 0) {
      for (let i = 0; i < batchRowUpdates.length; i += 250) {
        const slice = batchRowUpdates.slice(i, i + 250);
        await this.withRetry429(() =>
          sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: 'RAW',
              data: slice,
            },
          })
        );
      }
    }

    if (toAppend.length > 0) {
      await this.appendRows(SHEET_TABS.SISWA, toAppend);
    }

    if (toAppend.length > 0 || updatedCount > 0 || newClassesToAppend.length > 0) {
      await this.appendLog({
        waktu: nowIso,
        pengguna: actorName,
        id_data: `batch_${toAppend.length + updatedCount}`,
        tabel: SHEET_TABS.SISWA,
        aksi: 'tambah',
        nilai_baru: JSON.stringify({
          inserted: toAppend.length,
          updated: updatedCount,
          classesCreated: newClassesToAppend.length,
          sample: toAppend.slice(0, 3).map((x) => x.nis),
        }),
        reason: 'Impor Excel/CSV batch',
      });
    }

    return { inserted: toAppend.length, updated: updatedCount, classesCreated: newClassesToAppend.length };
  }

  public async deleteStudent(nis: string, actorName = 'Admin'): Promise<boolean> {
    return this.softDeleteRow({
      tabName: SHEET_TABS.SISWA,
      id: nis,
      actorName,
      reason: 'Hapus siswa',
    });
  }

  public async deleteStudents(nisses: string[], actorName = 'Admin'): Promise<number> {
    let count = 0;
    for (const nis of nisses) {
      const ok = await this.deleteStudent(nis, actorName);
      if (ok) count++;
    }
    return count;
  }

  public async clearAllStudents(actorName = 'Admin'): Promise<number> {
    const rows = await this.readTabWithRowNumbers(SHEET_TABS.SISWA);
    const active = rows.filter((r) => r.data.status !== 'dihapus');
    for (const r of active) {
      await this.softDeleteRow({
        tabName: SHEET_TABS.SISWA,
        id: r.data.id,
        actorName,
        reason: 'Kosongkan data siswa',
      });
    }
    return active.length;
  }

  public async getClasses(): Promise<SchoolClass[]> {
    const db = await this.getFullDatabase();
    return db.classes;
  }

  public async saveClass(
    cls: SchoolClass & { expected_updated_at?: string; forceOverwrite?: boolean },
    actorName = 'Admin'
  ): Promise<SchoolClass> {
    const nowIso = new Date().toISOString();
    const clean: SchoolClass = {
      id: String(cls.id).trim(),
      name: String(cls.name || cls.id).trim(),
      grade: String(cls.grade || '10').trim(),
      major: String(cls.major || '').trim(),
      homeroom_teacher_name: String(cls.homeroom_teacher_name || '').trim(),
      homeroom_teacher_email: String(cls.homeroom_teacher_email || '').trim(),
      quota_limit: parseNum(cls.quota_limit, 2),
      created_at: cls.created_at || nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const updated = await this.updateRowPartial({
      tabName: SHEET_TABS.KELAS,
      id: clean.id,
      newRowObj: { ...clean, status: 'aktif' },
      expectedUpdatedAt: cls.expected_updated_at,
      forceOverwrite: cls.forceOverwrite,
      actorName,
      reason: 'Simpan kelas',
    });

    if (!updated.updated) {
      await this.appendRows(SHEET_TABS.KELAS, [{ ...clean, status: 'aktif' }]);
      await this.appendLog({
        waktu: nowIso,
        pengguna: actorName,
        id_data: clean.id,
        tabel: SHEET_TABS.KELAS,
        aksi: 'tambah',
        nilai_baru: JSON.stringify(clean),
      });
    }
    return clean;
  }

  public async deleteClass(id: string, actorName = 'Admin'): Promise<boolean> {
    return this.softDeleteRow({
      tabName: SHEET_TABS.KELAS,
      id,
      actorName,
      reason: 'Hapus kelas',
    });
  }

  public async getSessions(): Promise<AttendanceSession[]> {
    const db = await this.getFullDatabase();
    return db.sessions;
  }

  public async saveSession(
    sess: AttendanceSession & { expected_updated_at?: string; forceOverwrite?: boolean },
    actorName = 'Admin'
  ): Promise<AttendanceSession> {
    const nowIso = new Date().toISOString();
    const clean: AttendanceSession = {
      id: String(sess.id || `sesi_${Date.now()}`).trim(),
      name: String(sess.name).trim(),
      start_time: String(sess.start_time || '06:00').trim(),
      on_time_limit: String(sess.on_time_limit || '07:00').trim(),
      end_time: String(sess.end_time || '08:00').trim(),
      active_days: Array.isArray(sess.active_days) ? sess.active_days : [1, 2, 3, 4, 5, 6],
      late_tolerance_minutes: parseNum(sess.late_tolerance_minutes, 0),
      is_active: sess.is_active !== false,
      is_override: Boolean(sess.is_override),
      created_at: sess.created_at || nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const rowPayload = {
      ...clean,
      active_days: JSON.stringify(clean.active_days),
      status: 'aktif',
    };

    const updated = await this.updateRowPartial({
      tabName: SHEET_TABS.SESI_PRESENSI,
      id: clean.id,
      newRowObj: rowPayload,
      expectedUpdatedAt: sess.expected_updated_at,
      forceOverwrite: sess.forceOverwrite,
      actorName,
      reason: 'Simpan sesi presensi',
    });

    if (!updated.updated) {
      await this.appendRows(SHEET_TABS.SESI_PRESENSI, [rowPayload]);
      await this.appendLog({
        waktu: nowIso,
        pengguna: actorName,
        id_data: clean.id,
        tabel: SHEET_TABS.SESI_PRESENSI,
        aksi: 'tambah',
        nilai_baru: JSON.stringify(clean),
      });
    }

    return clean;
  }

  public async deleteSession(id: string, actorName = 'Admin'): Promise<boolean> {
    return this.softDeleteRow({
      tabName: SHEET_TABS.SESI_PRESENSI,
      id,
      actorName,
      reason: 'Hapus sesi presensi',
    });
  }

  public async getAttendance(): Promise<AttendanceRecord[]> {
    const db = await this.getFullDatabase();
    return db.attendance;
  }

  private attendanceToRow(r: AttendanceRecord): Record<string, any> {
    return {
      id: r.id,
      student_id: r.student_id,
      session_id: r.session_id,
      date: r.date,
      timestamp: r.timestamp,
      status_presensi: r.status,
      late_minutes: r.late_minutes,
      method: r.method,
      device_id: r.device_id,
      photo_id: r.photo_id || '',
      notes: r.notes || '',
      audited_by: r.audited_by || '',
      audit_reason: r.audit_reason || '',
      version: r.version || 1,
      created_at: r.created_at,
      updated_at: r.updated_at,
      status: 'aktif',
      diubah_pada: r.diubah_pada || r.updated_at,
    };
  }

  /**
   * Append batch of attendance records directly to Google Sheets (stateless, with 429 retry).
   * Rejects duplicate attendance on the same day.
   */
  public async appendAttendanceBatch(
    records: AttendanceRecord[],
    actorName = 'Sistem Presensi'
  ): Promise<{
    saved: AttendanceRecord[];
    rejectedDuplicates: { student_id: string; date: string; session_id: string; reason: string }[];
  }> {
    if (records.length === 0) {
      return { saved: [], rejectedDuplicates: [] };
    }

    const existingRows = await this.readTabWithRowNumbers(SHEET_TABS.PRESENSI);
    const activeExisting = existingRows.filter((r) => r.data.status !== 'dihapus').map((r) => r.data);

    // Same-day duplicate check (checks student_id + date, and also tracks within the incoming batch)
    const existingSameDayKeys = new Set(
      activeExisting.map((r) => `${r.student_id}::${r.date}::${r.session_id}`)
    );
    const existingAnySessionDayKeys = new Set(
      activeExisting.map((r) => `${r.student_id}::${r.date}`)
    );

    const sessions = await this.getSessions();
    const multiSessionActive = sessions.filter((s) => s.is_active).length > 1;

    const toInsert: AttendanceRecord[] = [];
    const rejectedDuplicates: { student_id: string; date: string; session_id: string; reason: string }[] = [];

    for (const rec of records) {
      const exactKey = `${rec.student_id}::${rec.date}::${rec.session_id}`;
      const dayKey = `${rec.student_id}::${rec.date}`;

      // Reject same day + session duplicate always; if single active session mode, also reject any same-day duplicate
      const isDuplicate = multiSessionActive
        ? existingSameDayKeys.has(exactKey)
        : existingSameDayKeys.has(exactKey) || existingAnySessionDayKeys.has(dayKey);

      if (isDuplicate) {
        rejectedDuplicates.push({
          student_id: rec.student_id,
          date: rec.date,
          session_id: rec.session_id,
          reason: `Presensi ganda ditolak: siswa NIS ${rec.student_id} sudah tercatat presensi hari ini (${rec.date}).`,
        });
        continue;
      }

      existingSameDayKeys.add(exactKey);
      existingAnySessionDayKeys.add(dayKey);
      toInsert.push(rec);
    }

    if (toInsert.length > 0) {
      await this.appendRows(
        SHEET_TABS.PRESENSI,
        toInsert.map((r) => this.attendanceToRow(r))
      );

      for (const r of toInsert) {
        await this.appendLog({
          waktu: r.created_at,
          pengguna: actorName,
          id_data: r.id,
          tabel: SHEET_TABS.PRESENSI,
          aksi: 'tambah',
          nilai_baru: JSON.stringify({
            student_id: r.student_id,
            session_id: r.session_id,
            date: r.date,
            status: r.status,
          }),
        });
      }

      // Update Rekap_Per_Sesi sheet silently
      this.syncSessionRecapSheet(toInsert[0].date).catch((e) =>
        console.warn('[Rekap_Per_Sesi Sync Warning]:', e?.message || e)
      );
    }

    return { saved: toInsert, rejectedDuplicates };
  }

  public async updateAttendance(
    id: string,
    updates: Partial<AttendanceRecord>,
    actorName: string,
    reason: string,
    expectedUpdatedAt?: string,
    forceOverwrite = false
  ): Promise<AttendanceRecord | null> {
    const nowIso = new Date().toISOString();
    const rowPatch: Record<string, any> = {
      ...(updates.status ? { status_presensi: updates.status } : {}),
      ...(updates.late_minutes !== undefined ? { late_minutes: updates.late_minutes } : {}),
      ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
      audited_by: actorName,
      audit_reason: reason,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const res = await this.updateRowPartial({
      tabName: SHEET_TABS.PRESENSI,
      id,
      newRowObj: rowPatch,
      expectedUpdatedAt,
      forceOverwrite,
      actorName,
      reason,
    });

    if (!res.updated || !res.oldObj) return null;

    const merged: AttendanceRecord = {
      id: res.oldObj.id,
      student_id: res.oldObj.student_id,
      session_id: res.oldObj.session_id,
      date: res.oldObj.date,
      timestamp: res.oldObj.timestamp,
      status: (updates.status || res.oldObj.status_presensi) as any,
      late_minutes:
        updates.late_minutes !== undefined ? updates.late_minutes : parseNum(res.oldObj.late_minutes, 0),
      method: (res.oldObj.method as any) || 'manual',
      device_id: res.oldObj.device_id,
      photo_id: res.oldObj.photo_id,
      notes: updates.notes !== undefined ? updates.notes : res.oldObj.notes,
      audited_by: actorName,
      audit_reason: reason,
      version: parseNum(res.oldObj.version, 1) + 1,
      created_at: res.oldObj.created_at,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    this.syncSessionRecapSheet(merged.date).catch(() => {});
    return merged;
  }

  public async deleteAttendance(id: string, actorName: string, reason: string): Promise<boolean> {
    const ok = await this.softDeleteRow({
      tabName: SHEET_TABS.PRESENSI,
      id,
      actorName,
      reason,
    });
    return ok;
  }

  public async syncSessionRecapSheet(targetDate?: string): Promise<void> {
    const db = await this.getFullDatabase();
    const dateStr = targetDate || new Date().toISOString().split('T')[0];
    const recap = buildSessionRecapData({
      sessions: db.sessions,
      classes: db.classes,
      students: db.students,
      attendance: db.attendance,
      targetDate: dateStr,
    });

    const existingRows = await this.readTabWithRowNumbers(SHEET_TABS.REKAP_PER_SESI);
    const existingById = new Map(existingRows.map((r) => [r.data.id, r]));
    const nowIso = new Date().toISOString();

    const toAppend: Record<string, any>[] = [];
    for (const s of recap.sessionSummaries) {
      const id = `${dateStr}_${s.sessionId}`;
      const rowObj = {
        id,
        tanggal: dateStr,
        session_id: s.sessionId,
        session_name: s.sessionName,
        rentang_waktu: s.timeRange,
        total_siswa: s.totalStudents,
        hadir: s.hadir,
        terlambat: s.terlambat,
        izin: s.izin,
        sakit: s.sakit,
        alpha: s.alpha,
        belum_presensi: s.belumPresensi,
        persen_hadir: `${s.attendancePercent}%`,
        status: 'aktif',
        diubah_pada: nowIso,
      };
      if (existingById.has(id)) {
        await this.updateRowPartial({
          tabName: SHEET_TABS.REKAP_PER_SESI,
          id,
          newRowObj: rowObj,
          forceOverwrite: true,
          skipLog: true,
        });
      } else {
        toAppend.push(rowObj);
      }
    }

    if (toAppend.length > 0) {
      await this.appendRows(SHEET_TABS.REKAP_PER_SESI, toAppend);
    }
  }

  // ==================== OUT OF CLASS ====================

  public async getOutOfClass(): Promise<OutOfClassRecord[]> {
    const db = await this.getFullDatabase();
    return db.out_of_class;
  }

  public async autoCloseOverdueOutOfClass(): Promise<void> {
    const db = await this.getFullDatabase();
    const now = Date.now();
    for (const rec of db.out_of_class) {
      if (rec.status === 'active' || rec.status === 'overdue') {
        const dueMs = new Date(rec.due_at).getTime();
        if (now - dueMs > 2 * 60 * 60 * 1000) {
          const nowIso = new Date().toISOString();
          await this.updateRowPartial({
            tabName: SHEET_TABS.IZIN_KELUAR,
            id: rec.id,
            newRowObj: {
              status_izin: 'auto_closed',
              returned_at: nowIso,
              return_method: 'auto_closed',
              updated_at: nowIso,
              diubah_pada: nowIso,
            },
            forceOverwrite: true,
            actorName: 'Sistem',
            reason: 'Auto-close izin keluar lewat 2 jam',
          });
        }
      }
    }
  }

  public async startOutOfClass(
    record: OutOfClassRecord,
    actorName = 'Petugas Piket'
  ): Promise<{ success: boolean; error?: string; record?: OutOfClassRecord }> {
    const db = await this.getFullDatabase();
    const active = db.out_of_class.filter((r) => r.status === 'active' || r.status === 'overdue');

    if (active.some((r) => r.student_id === record.student_id)) {
      return { success: false, error: 'Siswa ini sedang memiliki izin keluar yang masih aktif.' };
    }

    const cls = db.classes.find((c) => c.id === record.class_id);
    const maxPerClass = cls?.quota_limit || db.settings.out_of_class_max_per_class || 2;
    const classActiveCount = active.filter((r) => r.class_id === record.class_id).length;

    if (classActiveCount >= maxPerClass) {
      return {
        success: false,
        error: `Kuota izin keluar untuk kelas ${record.class_id} penuh (${classActiveCount}/${maxPerClass} siswa sedang di luar).`,
      };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const studentDailyCount = db.out_of_class.filter(
      (r) => r.student_id === record.student_id && r.started_at.startsWith(todayStr)
    ).length;
    const maxDaily = db.settings.out_of_class_max_per_student_daily || 3;

    if (studentDailyCount >= maxDaily) {
      return {
        success: false,
        error: `Batas harian izin keluar siswa (${maxDaily}x/hari) telah tercapai.`,
      };
    }

    const nowIso = new Date().toISOString();
    const rowObj = {
      id: record.id,
      student_id: record.student_id,
      class_id: record.class_id,
      type: record.type,
      duration_minutes: record.duration_minutes,
      started_at: record.started_at,
      due_at: record.due_at,
      returned_at: '',
      actual_minutes: '',
      late_return_minutes: 0,
      return_method: '',
      status_izin: 'active',
      return_notes: '',
      audited_by: '',
      audit_reason: '',
      idempotency_key: record.idempotency_key,
      version: 1,
      created_at: nowIso,
      updated_at: nowIso,
      status: 'aktif',
      diubah_pada: nowIso,
    };

    await this.appendRows(SHEET_TABS.IZIN_KELUAR, [rowObj]);
    await this.appendLog({
      waktu: nowIso,
      pengguna: actorName,
      id_data: record.id,
      tabel: SHEET_TABS.IZIN_KELUAR,
      aksi: 'tambah',
      nilai_baru: JSON.stringify(record),
    });

    return { success: true, record };
  }

  public async confirmOutOfClassReturn(
    id: string,
    returnMethod: 'click' | 'manual' | 'auto_closed',
    notes: string | undefined,
    actorName: string,
    auditReason?: string,
    expectedUpdatedAt?: string,
    forceOverwrite = false
  ): Promise<{ success: boolean; error?: string; alreadyReturned?: boolean; record?: OutOfClassRecord }> {
    const db = await this.getFullDatabase();
    const existing = db.out_of_class.find((r) => r.id === id);
    if (!existing) {
      return { success: false, error: 'Catatan izin keluar tidak ditemukan.' };
    }
    if (existing.status === 'returned' || existing.status === 'auto_closed') {
      return { success: true, alreadyReturned: true, record: existing };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const startedMs = new Date(existing.started_at).getTime();
    const dueMs = new Date(existing.due_at).getTime();
    const actualMinutes = Math.max(1, Math.round((now.getTime() - startedMs) / 60000));
    const lateReturnMinutes = Math.max(0, Math.round((now.getTime() - dueMs) / 60000));

    await this.updateRowPartial({
      tabName: SHEET_TABS.IZIN_KELUAR,
      id,
      newRowObj: {
        status_izin: 'returned',
        returned_at: nowIso,
        actual_minutes: actualMinutes,
        late_return_minutes: lateReturnMinutes,
        return_method: returnMethod,
        return_notes: notes || '',
        audited_by: actorName,
        audit_reason: auditReason || '',
        updated_at: nowIso,
        diubah_pada: nowIso,
      },
      expectedUpdatedAt,
      forceOverwrite,
      actorName,
      reason: auditReason || 'Konfirmasi kembali ke kelas',
    });

    const updatedRecord: OutOfClassRecord = {
      ...existing,
      status: 'returned',
      returned_at: nowIso,
      actual_minutes: actualMinutes,
      late_return_minutes: lateReturnMinutes,
      return_method: returnMethod,
      return_notes: notes,
      audited_by: actorName,
      audit_reason: auditReason,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    return { success: true, record: updatedRecord };
  }

  // ==================== VIOLATIONS & TYPES ====================

  public async getViolationTypes(): Promise<ViolationType[]> {
    const db = await this.getFullDatabase();
    return db.violation_types;
  }

  public async saveViolationType(
    vtype: ViolationType & { expected_updated_at?: string; forceOverwrite?: boolean },
    actorName = 'Admin'
  ): Promise<ViolationType> {
    const nowIso = new Date().toISOString();
    const clean: ViolationType = {
      id: String(vtype.id || `vt_${Date.now()}`).trim(),
      code: String(vtype.code).trim(),
      name: String(vtype.name).trim(),
      category: vtype.category,
      default_points: parseNum(vtype.default_points, 5),
      is_active: vtype.is_active !== false,
      description: String(vtype.description || '').trim(),
      created_at: vtype.created_at || nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const updated = await this.updateRowPartial({
      tabName: SHEET_TABS.JENIS_PELANGGARAN,
      id: clean.id,
      newRowObj: { ...clean, status: 'aktif' },
      expectedUpdatedAt: vtype.expected_updated_at,
      forceOverwrite: vtype.forceOverwrite,
      actorName,
      reason: 'Simpan jenis pelanggaran',
    });

    if (!updated.updated) {
      await this.appendRows(SHEET_TABS.JENIS_PELANGGARAN, [{ ...clean, status: 'aktif' }]);
      await this.appendLog({
        waktu: nowIso,
        pengguna: actorName,
        id_data: clean.id,
        tabel: SHEET_TABS.JENIS_PELANGGARAN,
        aksi: 'tambah',
        nilai_baru: JSON.stringify(clean),
      });
    }
    return clean;
  }

  public async deleteViolationType(id: string, actorName = 'Admin'): Promise<boolean> {
    return this.softDeleteRow({
      tabName: SHEET_TABS.JENIS_PELANGGARAN,
      id,
      actorName,
      reason: 'Hapus jenis pelanggaran',
    });
  }

  public async getViolations(): Promise<ViolationRecord[]> {
    const db = await this.getFullDatabase();
    return db.violations;
  }

  public async recordViolation(record: ViolationRecord, actorName = 'Petugas'): Promise<ViolationRecord> {
    const nowIso = record.created_at || new Date().toISOString();
    const clean: ViolationRecord = {
      ...record,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };
    await this.appendRows(SHEET_TABS.PELANGGARAN, [{ ...clean, status: 'aktif' }]);
    await this.appendLog({
      waktu: nowIso,
      pengguna: actorName,
      id_data: clean.id,
      tabel: SHEET_TABS.PELANGGARAN,
      aksi: 'tambah',
      nilai_baru: JSON.stringify(clean),
    });
    return clean;
  }

  public async deleteViolation(id: string, actorName: string, reason: string): Promise<boolean> {
    return this.softDeleteRow({
      tabName: SHEET_TABS.PELANGGARAN,
      id,
      actorName,
      reason,
    });
  }

  // ==================== LEAVE REQUESTS ====================

  public async getLeaveRequests(): Promise<LeaveRequest[]> {
    const db = await this.getFullDatabase();
    return db.leave_requests;
  }

  public async saveLeaveRequest(
    reqItem: LeaveRequest & { expected_updated_at?: string; forceOverwrite?: boolean },
    actorName = 'Wali Kelas'
  ): Promise<LeaveRequest> {
    const nowIso = new Date().toISOString();
    const rowPayload = {
      id: reqItem.id,
      student_id: reqItem.student_id,
      class_id: reqItem.class_id,
      type: reqItem.type,
      start_date: reqItem.start_date,
      end_date: reqItem.end_date,
      reason: reqItem.reason,
      letter_file_url: reqItem.letter_file_url || '',
      status_persetujuan: reqItem.status,
      approved_by: reqItem.approved_by || '',
      approved_at: reqItem.approved_at || '',
      rejection_reason: reqItem.rejection_reason || '',
      created_at: reqItem.created_at || nowIso,
      updated_at: nowIso,
      status: 'aktif',
      diubah_pada: nowIso,
    };

    const updated = await this.updateRowPartial({
      tabName: SHEET_TABS.IZIN_TIDAK_MASUK,
      id: reqItem.id,
      newRowObj: rowPayload,
      expectedUpdatedAt: reqItem.expected_updated_at,
      forceOverwrite: reqItem.forceOverwrite,
      actorName,
      reason: `Status izin: ${reqItem.status}`,
    });

    if (!updated.updated) {
      await this.appendRows(SHEET_TABS.IZIN_TIDAK_MASUK, [rowPayload]);
      await this.appendLog({
        waktu: nowIso,
        pengguna: actorName,
        id_data: reqItem.id,
        tabel: SHEET_TABS.IZIN_TIDAK_MASUK,
        aksi: 'tambah',
        nilai_baru: JSON.stringify(reqItem),
      });
    }

    return {
      ...reqItem,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };
  }

  // ==================== SETTINGS & LOGS ====================

  public async getSettings(): Promise<AppSettings> {
    const db = await this.getFullDatabase();
    return db.settings;
  }

  public async updateSettings(
    patch: Partial<AppSettings> & { expected_updated_at?: string; forceOverwrite?: boolean },
    actorName = 'Admin'
  ): Promise<AppSettings> {
    const current = await this.getSettings();
    const nowIso = new Date().toISOString();
    const { expected_updated_at, forceOverwrite, ...cleanPatch } = patch;
    const merged: AppSettings = {
      ...current,
      ...cleanPatch,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const updated = await this.updateRowPartial({
      tabName: SHEET_TABS.PENGATURAN,
      id: 'app_settings',
      newRowObj: {
        id: 'app_settings',
        tipe: 'app',
        json_data: JSON.stringify(merged),
        status: 'aktif',
        diubah_pada: nowIso,
      },
      expectedUpdatedAt: expected_updated_at,
      forceOverwrite: forceOverwrite !== false ? true : false,
      actorName,
      reason: 'Perbarui pengaturan aplikasi',
    });

    if (!updated.updated) {
      await this.appendRows(SHEET_TABS.PENGATURAN, [
        {
          id: 'app_settings',
          tipe: 'app',
          json_data: JSON.stringify(merged),
          status: 'aktif',
          diubah_pada: nowIso,
        },
      ]);
    }
    return merged;
  }

  public async getNotificationSettings(): Promise<NotificationSettings> {
    const db = await this.getFullDatabase();
    return db.notification_settings;
  }

  public async updateNotificationSettings(
    patch: Partial<NotificationSettings> & { expected_updated_at?: string; forceOverwrite?: boolean },
    actorName = 'Admin'
  ): Promise<NotificationSettings> {
    const current = await this.getNotificationSettings();
    const nowIso = new Date().toISOString();
    const { expected_updated_at, forceOverwrite, ...cleanPatch } = patch;
    const merged: NotificationSettings = {
      ...current,
      ...cleanPatch,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const updated = await this.updateRowPartial({
      tabName: SHEET_TABS.PENGATURAN,
      id: 'notification_settings',
      newRowObj: {
        id: 'notification_settings',
        tipe: 'notification',
        json_data: JSON.stringify(merged),
        status: 'aktif',
        diubah_pada: nowIso,
      },
      expectedUpdatedAt: expected_updated_at,
      forceOverwrite: forceOverwrite !== false ? true : false,
      actorName,
      reason: 'Perbarui pengaturan notifikasi',
    });

    if (!updated.updated) {
      await this.appendRows(SHEET_TABS.PENGATURAN, [
        {
          id: 'notification_settings',
          tipe: 'notification',
          json_data: JSON.stringify(merged),
          status: 'aktif',
          diubah_pada: nowIso,
        },
      ]);
    }
    return merged;
  }

  public async getNotificationLogs(): Promise<NotificationLog[]> {
    const db = await this.getFullDatabase();
    return db.notification_logs;
  }

  public async logNotification(log: NotificationLog): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.appendRows(SHEET_TABS.NOTIFIKASI_LOG, [
      {
        id: log.id,
        timestamp: log.timestamp,
        student_id: log.student_id,
        student_name: log.student_name,
        recipient_email: log.recipient_email,
        trigger_type: log.trigger_type,
        status_kirim: log.status,
        error_message: log.error_message || '',
        created_at: log.created_at || nowIso,
        status: 'aktif',
        diubah_pada: nowIso,
      },
    ]);
  }

  public async getAuditLogs(): Promise<AuditLog[]> {
    const db = await this.getFullDatabase();
    return db.audit_logs;
  }

  public async logAudit(
    actorName: string,
    _actorRole: string,
    action: string,
    entity: string,
    entityId: string,
    oldValues?: string,
    newValues?: string,
    reason?: string
  ): Promise<void> {
    await this.appendLog({
      pengguna: actorName,
      id_data: entityId,
      tabel: entity,
      aksi: action,
      nilai_lama: oldValues,
      nilai_baru: newValues,
      reason,
    });
  }
}

export const sheetsDb = new SheetsDatabaseService();
