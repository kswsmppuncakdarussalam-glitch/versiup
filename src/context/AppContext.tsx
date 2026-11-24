import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  AuthSession,
  ActiveTab,
  SyncStatus,
  SaveStatusState,
  ConflictState,
  AppSettings,
  SchoolClass,
  AttendanceSession,
  Student,
  ViolationType,
  AttendanceRecord,
  OutOfClassRecord,
  ViolationRecord,
  LeaveRequest,
  NotificationSettings,
  NotificationLog,
  AuditLog,
} from '../types/index.js';
import { setServerClockOffset, getServerNow } from '../utils/time.js';
import {
  resolveSessionSchedule,
  checkSessionAttendanceOpen,
  SessionScheduleState,
} from '../utils/sessionHelper.js';
import { soundEffects } from '../utils/audio.js';
import { ttsService } from '../utils/tts.js';
import {
  apiFetch,
  getAppsScriptUrl,
  setAppsScriptUrl,
  clearAppsScriptUrl,
  getAppsScriptSecretToken,
  setAppsScriptSecretToken,
  clearAppsScriptSecretToken,
  hasAppsScriptSecretToken,
  isAppsScriptConfigLocked,
  setAppsScriptConfigLocked,
  getMissingClientConfig,
  hasCompleteAppsScriptConfig,
  isValidAppsScriptUrl,
  testAppsScriptConnection,
  persistServerAppsScriptConfig,
  clearServerAppsScriptUrl,
  hydrateAppsScriptConfig,
  runAppsScriptSystemCheck,
  type SystemCheckResult,
} from '../utils/apiClient.js';

interface ToastNotification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface OfflineAttendanceScan {
  localId: string;
  code?: string;
  studentId?: string;
  sessionId?: string;
  status?: string;
  notes?: string;
  method?: string;
  manualOverride?: boolean;
  upsert?: boolean;
  photoBase64?: string;
  photoFileName?: string;
  queuedAt: string;
}

const OFFLINE_SCANS_KEY = 'dkb_offline_attendance_scans';
const DB_CACHE_KEY = 'dkb_db_cache_v1';
const SYNC_BROADCAST_CHANNEL = 'dkb_sync_channel';
const REALTIME_SYNC_COOLDOWN_MS = 120;
const REALTIME_BURST_COOLDOWN_MS = 60;
const FULL_RECONCILE_INTERVAL_MS = 15000;
const SCAN_IDLE_FLUSH_MS = 180;
const SCAN_MAX_BATCH_WAIT_MS = 2500;

export interface EnvConfigStatus {
  configured: boolean;
  sheetsConfigured: boolean;
  driveConfigured: boolean;
  spreadsheetConfigured: boolean;
  driveFolderConfigured: boolean;
  authMode?: 'apps_script' | 'unconfigured';
  emailConnected?: boolean;
  emailTransport?: 'apps_script_gmail' | 'unconfigured';
  senderEmail?: string;
  missingEnv: string[];
}

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

interface AppContextType {
  session: AuthSession | null;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  syncStatus: SyncStatus;
  saveStatus: SaveStatusState;
  isInitialLoading: boolean;
  initialLoadError: string | null;
  configError: string | null;
  missingEnv: string[];
  envStatus: EnvConfigStatus;
  appsScriptUrl: string;
  appsScriptSecretConfigured: boolean;
  isAppsScriptLocked: boolean;
  isConnectingAppsScript: boolean;
  connectAppsScript: (url: string, secretToken?: string) => Promise<{ ok: boolean; message: string }>;
  disconnectAppsScript: () => Promise<void>;
  runSystemCheck: () => Promise<SystemCheckResult>;
  confirmDialog: ConfirmDialogState | null;
  requestConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning';
  }) => Promise<boolean>;
  conflictPrompt: ConflictState | null;
  dismissConflictPrompt: () => void;
  lastSyncTime: Date | null;
  currentServerTime: Date;
  activeSession: AttendanceSession | null;
  sessionSchedule: SessionScheduleState;
  lastSessionTransition: {
    fromName?: string;
    toSession: AttendanceSession;
    at: string;
  } | null;
  dismissSessionTransition: () => void;
  setManualSessionOverride: (sessionId: string | null) => void;
  isKioskFullscreen: boolean;
  toggleKioskFullscreen: () => void;
  pendingOfflineScansCount: number;

  // Data directly loaded from Google Sheets
  settings: AppSettings;
  classes: SchoolClass[];
  sessions: AttendanceSession[];
  students: Student[];
  violationTypes: ViolationType[];
  attendance: AttendanceRecord[];
  outOfClass: OutOfClassRecord[];
  violations: ViolationRecord[];
  leaveRequests: LeaveRequest[];
  notificationSettings: NotificationSettings;
  notificationLogs: NotificationLog[];
  auditLogs: AuditLog[];

  // Actions
  loginDuty: (password: string) => Promise<{ success: boolean; error?: string; remainingAttempts?: number; lockedForSeconds?: number }>;
  unlockHomeroom: (name: string, password: string, classId?: string) => Promise<{ success: boolean; error?: string; classId?: string }>;
  unlockStudentAffairs: (password: string) => Promise<{ success: boolean; error?: string }>;
  unlockAdmin: (password: string) => Promise<{ success: boolean; error?: string }>;
  lockCurrentMenu: () => void;
  logout: () => void;
  updateSessionToken: (newToken: string) => void;
  refreshAuthSession: (forceLogoutOn401?: boolean, failedToken?: string) => Promise<string | null>;
  refreshFromSheets: (
    silent?: boolean,
    options?: { afterWrite?: boolean; forceFull?: boolean }
  ) => Promise<void>;

  // Mutators (Direct to Google Sheets & Drive via Apps Script Web App)
  recordAttendance: (params: {
    code?: string;
    studentId?: string;
    sessionId?: string;
    status?: string;
    notes?: string;
    method?: string;
    photoBase64?: string;
    photoFileName?: string;
  }) => Promise<{
    success: boolean;
    record?: AttendanceRecord;
    student?: Student;
    session?: AttendanceSession;
    error?: string;
    isDuplicate?: boolean;
    sessionClosed?: boolean;
    offlineQueued?: boolean;
    syncedFromExisting?: boolean;
  }>;
  updateAttendance: (
    id: string,
    updates: Partial<AttendanceRecord>,
    reason: string,
    options?: { enforceSessionWindow?: boolean; silentToast?: boolean }
  ) => Promise<boolean>;
  deleteAttendance: (id: string, reason: string) => Promise<boolean>;

  startOutOfClass: (
    studentId: string,
    type: 'BAK' | 'BAB' | 'Keperluan Lain',
    durationMinutes: number
  ) => Promise<{ success: boolean; record?: OutOfClassRecord; student?: Student; error?: string }>;
  confirmOutOfClassReturn: (
    id: string,
    returnMethod?: 'click' | 'manual',
    notes?: string,
    auditReason?: string
  ) => Promise<{ success: boolean; record?: OutOfClassRecord; error?: string }>;

  recordViolation: (params: {
    studentId: string;
    violationTypeId: string;
    customPoints?: number;
    notes?: string;
    location?: string;
    evidenceBase64?: string;
    evidenceFileName?: string;
  }) => Promise<{ success: boolean; violation?: ViolationRecord; studentTotalPoints?: number; error?: string }>;
  deleteViolation: (id: string, reason: string) => Promise<boolean>;

  saveStudent: (student: Student & { photoBase64?: string }) => Promise<boolean>;
  deleteStudent: (nis: string) => Promise<boolean>;
  deleteStudents: (nisses: string[]) => Promise<boolean>;
  clearAllStudents: () => Promise<boolean>;
  batchImportStudents: (students: Student[]) => Promise<{
    success: boolean;
    added: number;
    updated: number;
    classesCreated?: number;
    error?: string;
  }>;

  saveClass: (cls: SchoolClass) => Promise<boolean>;
  deleteClass: (id: string) => Promise<boolean>;

  saveSession: (sess: AttendanceSession) => Promise<boolean>;
  deleteSession: (id: string) => Promise<boolean>;

  saveViolationType: (vt: ViolationType) => Promise<boolean>;
  deleteViolationType: (id: string) => Promise<boolean>;

  updateSettings: (updates: Partial<AppSettings> & { logoBase64?: string }, options?: { silent?: boolean }) => Promise<boolean>;
  updateNotificationSettings: (updates: Partial<NotificationSettings>, options?: { silent?: boolean }) => Promise<boolean>;
  sendTestEmail: (email: string) => Promise<{ success: boolean; message: string; cancelled?: boolean }>;
  sendWeeklyRecap: (classId?: string) => Promise<{ success: boolean; message: string; results?: any; sent?: boolean; recipient?: string; cancelled?: boolean }>;

  approveLeaveRequest: (id: string, status: 'approved' | 'rejected', rejectionReason?: string) => Promise<boolean>;

  // UI Helpers
  toasts: ToastNotification[];
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  dismissToast: (id: string) => void;
  speak: (text: string) => void;
}

const defaultSettings: AppSettings = {
  school_name: 'DISIPLIN KITA BISA — SMK NEGERI',
  logo_url: '',
  background_url: '',
  accent_color: '#0f172a',
  theme: 'light',
  tts_enabled: true,
  tts_rate: 1.0,
  tts_pitch: 1.0,
  tts_volume: 1.0,
  tts_template_present: 'Selamat pagi, {nama}. Kamu hadir tepat waktu di sesi {sesi}.',
  tts_template_late: 'Halo, {nama}. Kamu tercatat terlambat {menit} menit di sesi {sesi}. Silakan segera masuk kelas.',
  tts_template_out_of_class: '{nama}, izin keluar {tipe} selama {durasi} menit dimulai. Harap kembali tepat waktu.',
  tts_template_overdue: 'Perhatian! {nama} dari kelas {kelas} telah melebihi waktu izin keluar kelas.',
  discipline_late_weight: 2,
  discipline_alpha_weight: 10,
  discipline_late_return_weight: 1,
  discipline_full_attendance_bonus: 5,
  out_of_class_max_per_class: 2,
  out_of_class_max_per_student_daily: 2,
  out_of_class_bak_duration: 5,
  out_of_class_bab_duration: 10,
  out_of_class_other_duration: 15,
  toggle_allow_edit_violation_points: true,
  toggle_email_notifications: true,
  toggle_kiosk_mode: false,
  auto_session_switch: true,
  auto_session_switch_notify: true,
  updated_at: new Date().toISOString(),
};

const defaultNotificationSettings: NotificationSettings = {
  email_enabled: true,
  trigger_late: true,
  trigger_alpha: true,
  trigger_leave: true,
  trigger_violation: true,
  trigger_warning_threshold: true,
  trigger_overdue_out_of_class: true,
  warning_threshold_points: 25,
  subject_template: 'Pemberitahuan Kedisiplinan Siswa: {nama_siswa} ({kelas})',
  body_template: 'Yth. Orang Tua / Wali dari {nama_siswa},\n\nKami menginformasikan bahwa siswa tercatat: {status}.\n\n{nama_sekolah}',
  weekly_recap_enabled: false,
  weekly_recap_day: 5,
  weekly_recap_time: '15:00',
  weekly_recap_last_sent: undefined,
  updated_at: new Date().toISOString(),
};

const AppContext = createContext<AppContextType | null>(null);

function readOfflineScans(): OfflineAttendanceScan[] {
  try {
    const raw = localStorage.getItem(OFFLINE_SCANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOfflineScans(list: OfflineAttendanceScan[]): void {
  try {
    if (list.length === 0) {
      localStorage.removeItem(OFFLINE_SCANS_KEY);
    } else {
      localStorage.setItem(OFFLINE_SCANS_KEY, JSON.stringify(list));
    }
  } catch {}
}

interface CachedDbPayload {
  rev?: string;
  seq?: number;
  serverTime?: string;
  data?: Record<string, any>;
}

function readLocalDbCache(): CachedDbPayload | null {
  try {
    const raw = localStorage.getItem(DB_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object') {
      return parsed as CachedDbPayload;
    }
  } catch {}
  return null;
}

function writeLocalDbCache(payload: CachedDbPayload): void {
  if (!payload?.data) return;
  try {
    localStorage.setItem(DB_CACHE_KEY, JSON.stringify(payload));
  } catch {
    try {
      const compactData = {
        ...payload.data,
        audit_logs: Array.isArray(payload.data.audit_logs) ? payload.data.audit_logs.slice(0, 80) : [],
        notification_logs: Array.isArray(payload.data.notification_logs) ? payload.data.notification_logs.slice(0, 80) : [],
      };
      localStorage.setItem(DB_CACHE_KEY, JSON.stringify({ ...payload, data: compactData }));
    } catch {}
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      localStorage.removeItem('dkb_session');
      localStorage.removeItem('dkb_active_tab');
    } catch {}
    return null;
  });

  const [activeTab, setActiveTabState] = useState<ActiveTab>('attendance');

  const setActiveTab = useCallback((newTab: ActiveTab) => {
    try {
      localStorage.setItem('dkb_active_tab', newTab);
    } catch {}
    setActiveTabState(newTab);
  }, []);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'synced'
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatusState>({ state: 'idle', message: '' });
  const saveResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialDbCacheRef = useRef<CachedDbPayload | null | undefined>(undefined);
  if (initialDbCacheRef.current === undefined) {
    initialDbCacheRef.current = readLocalDbCache();
    if (initialDbCacheRef.current?.serverTime) {
      setServerClockOffset(initialDbCacheRef.current.serverTime);
    }
  }
  const cachedInitData = initialDbCacheRef.current?.data;

  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(
    () => !(Boolean(cachedInitData) || hasCompleteAppsScriptConfig())
  );
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [missingEnv, setMissingEnv] = useState<string[]>(() => getMissingClientConfig());
  const [envStatus, setEnvStatus] = useState<EnvConfigStatus>(() => ({
    configured: Boolean(cachedInitData) || hasCompleteAppsScriptConfig(),
    sheetsConfigured: Boolean(cachedInitData),
    driveConfigured: Boolean(cachedInitData),
    spreadsheetConfigured: Boolean(cachedInitData),
    driveFolderConfigured: Boolean(cachedInitData),
    authMode: hasCompleteAppsScriptConfig() ? 'apps_script' : 'unconfigured',
    emailConnected: Boolean(cachedInitData),
    emailTransport: hasCompleteAppsScriptConfig() ? 'apps_script_gmail' : 'unconfigured',
    senderEmail: '',
    missingEnv: getMissingClientConfig(),
  }));
  const [appsScriptUrl, setAppsScriptUrlState] = useState<string>(() => getAppsScriptUrl());
  const [appsScriptSecretConfigured, setAppsScriptSecretConfigured] = useState<boolean>(() =>
    hasAppsScriptSecretToken()
  );
  const [isAppsScriptLocked, setIsAppsScriptLockedState] = useState<boolean>(() =>
    isAppsScriptConfigLocked()
  );
  const [isConnectingAppsScript, setIsConnectingAppsScript] = useState<boolean>(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<ConflictState | null>(null);
  const dismissConflictPrompt = useCallback(() => setConflictPrompt(null), []);

  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(
    () => (cachedInitData ? new Date() : null)
  );
  const [currentServerTime, setCurrentServerTime] = useState<Date>(getServerNow());
  const [isKioskFullscreen, setIsKioskFullscreen] = useState<boolean>(false);
  const [pendingOfflineScansCount, setPendingOfflineScansCount] = useState<number>(() => readOfflineScans().length);

  const [manualSessionOverrideId, setManualSessionOverrideId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('dkb_manual_session_override') || null;
    } catch {
      return null;
    }
  });
  const [lastSessionTransition, setLastSessionTransition] = useState<{
    fromName?: string;
    toSession: AttendanceSession;
    at: string;
  } | null>(null);
  const prevLiveSessionIdRef = useRef<string | null>(null);
  const prevLiveSessionNameRef = useRef<string | null>(null);
  const pendingAdminSetupPasswordRef = useRef<string | null>(null);

  // Domain States (Hydrated synchronously from local snapshot cache, reconciled with Google Sheets)
  const [settings, setSettings] = useState<AppSettings>(() =>
    cachedInitData?.settings ? { ...defaultSettings, ...cachedInitData.settings } : defaultSettings
  );
  const [classes, setClasses] = useState<SchoolClass[]>(() =>
    Array.isArray(cachedInitData?.classes) ? cachedInitData.classes : []
  );
  const [sessions, setSessions] = useState<AttendanceSession[]>(() =>
    Array.isArray(cachedInitData?.sessions) ? cachedInitData.sessions : []
  );
  const [students, setStudents] = useState<Student[]>(() =>
    Array.isArray(cachedInitData?.students) ? cachedInitData.students : []
  );
  const [violationTypes, setViolationTypes] = useState<ViolationType[]>(() =>
    Array.isArray(cachedInitData?.violation_types) ? cachedInitData.violation_types : []
  );
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(() =>
    Array.isArray(cachedInitData?.attendance) ? cachedInitData.attendance : []
  );
  const [outOfClass, setOutOfClass] = useState<OutOfClassRecord[]>(() =>
    Array.isArray(cachedInitData?.out_of_class) ? cachedInitData.out_of_class : []
  );
  const [violations, setViolations] = useState<ViolationRecord[]>(() =>
    Array.isArray(cachedInitData?.violations) ? cachedInitData.violations : []
  );
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(() =>
    Array.isArray(cachedInitData?.leave_requests) ? cachedInitData.leave_requests : []
  );
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() =>
    cachedInitData?.notification_settings
      ? { ...defaultNotificationSettings, ...cachedInitData.notification_settings }
      : defaultNotificationSettings
  );
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>(() =>
    Array.isArray(cachedInitData?.notification_logs) ? cachedInitData.notification_logs : []
  );
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() =>
    Array.isArray(cachedInitData?.audit_logs) ? cachedInitData.audit_logs : []
  );
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const isFetchingRef = useRef<boolean>(false);
  const latestMutationSeqRef = useRef<number>(0);
  const pendingRefreshAfterWriteRef = useRef<boolean>(false);
  const pendingWriteCountRef = useRef<number>(0);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestModifiedByEntityKeyRef = useRef<Record<string, string>>({});
  const hasHydratedConfigRef = useRef<boolean>(false);
  const lastKnownRevRef = useRef<string>(String(initialDbCacheRef.current?.rev || ''));
  const lastKnownSeqRef = useRef<number>(Number(initialDbCacheRef.current?.seq || 0));
  const burstSyncNextRef = useRef<boolean>(false);
  const lastFullSyncAtRef = useRef<number>(0);
  const consecutiveSyncErrorsRef = useRef<number>(0);
  const inFlightOptimisticIdsRef = useRef<Set<string>>(new Set());
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionRef = useRef<AuthSession | null>(session);
  sessionRef.current = session;
  const authEpochRef = useRef<number>(0);
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;
  const notificationSettingsRef = useRef<NotificationSettings>(notificationSettings);
  notificationSettingsRef.current = notificationSettings;
  const latestSnapshotDataRef = useRef<Record<string, any>>(
    initialDbCacheRef.current?.data ? { ...initialDbCacheRef.current.data } : {}
  );
  const tokenRefreshPromiseRef = useRef<Promise<string | null> | null>(null);

  const broadcastSyncEvent = useCallback(
    (
      type:
        | 'DATA_MUTATED'
        | 'DATA_SNAPSHOT'
        | 'DATA_DELTA'
        | 'DATA_OPTIMISTIC_ATTENDANCE'
        | 'DATA_OPTIMISTIC_OUT_OF_CLASS'
        | 'DATA_OPTIMISTIC_VIOLATION'
        | 'APPS_SCRIPT_CHANGED',
      payload?: any
    ) => {
      try {
        syncChannelRef.current?.postMessage({ type, payload, at: Date.now() });
      } catch {}
      try {
        if (type === 'DATA_MUTATED' || type === 'APPS_SCRIPT_CHANGED' || type === 'DATA_SNAPSHOT') {
          localStorage.setItem('dkb_last_sync_event', JSON.stringify({ type, at: Date.now() }));
        }
      } catch {}
    },
    []
  );

  // Smart scan batch collector: flush at 280ms idle for sub-second speed, or max 3s during rapid bursts
  interface BatchItem {
    params: OfflineAttendanceScan;
    optimisticId?: string;
    targetStudent?: Student;
    resolve?: (res: any) => void;
  }
  const scanBatchQueueRef = useRef<BatchItem[]>([]);
  const scanBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanBatchMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
      setTimeout(() => {
        dismissToast(id);
      }, 4500);
    },
    [dismissToast]
  );

  const setSavingState = useCallback(() => {
    if (saveResetTimerRef.current) clearTimeout(saveResetTimerRef.current);
    setSaveStatus({ state: 'saving', message: 'Menyimpan...', updatedAt: Date.now() });
  }, []);

  const setSavedState = useCallback((customMsg = 'Tersimpan') => {
    if (saveResetTimerRef.current) clearTimeout(saveResetTimerRef.current);
    setSaveStatus({ state: 'saved', message: customMsg, updatedAt: Date.now() });
    saveResetTimerRef.current = setTimeout(() => {
      setSaveStatus((prev) => (prev.state === 'saved' ? { state: 'idle', message: '' } : prev));
    }, 3500);
  }, []);

  const setSaveErrorState = useCallback((errMsg: string) => {
    if (saveResetTimerRef.current) clearTimeout(saveResetTimerRef.current);
    setSaveStatus({ state: 'error', message: errMsg, updatedAt: Date.now() });
  }, []);

  const requestConfirm = useCallback(
    (opts: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      variant?: 'danger' | 'warning';
    }): Promise<boolean> => {
      return new Promise((resolve) => {
        setConfirmDialog({
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel || 'Ya, Lanjutkan',
          cancelLabel: opts.cancelLabel || 'Batal',
          variant: opts.variant || 'danger',
          onConfirm: () => {
            setConfirmDialog(null);
            resolve(true);
          },
          onCancel: () => {
            setConfirmDialog(null);
            resolve(false);
          },
        });
      });
    },
    []
  );

  const buildApiHeaders = useCallback(
    (
      extra?: Record<string, string>,
      overrideAppToken?: string
    ): Record<string, string> => {
      const appToken = overrideAppToken ?? sessionRef.current?.token ?? '';
      return {
        ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
        ...(extra || {}),
      };
    },
    []
  );

  const handleAppsScriptUnauthorized = useCallback(
    (status: number, data: any) => {
      if (status === 401 && (data?.unauthorizedToken || data?.googleDeploymentUnauthorized)) {
        const msg =
          data.error ||
          'Token rahasia (SECRET_TOKEN) atau deployment Google Apps Script ditolak (401).';
        setConfigError(msg);
        if (Array.isArray(data?.missingConfig)) {
          setMissingEnv(data.missingConfig);
        }
        if (sessionRef.current?.lockedMenuRole === 'admin') {
          showToast(msg, 'error');
        }
        return true;
      }
      return false;
    },
    [showToast]
  );

  const decodeJwtPayload = (token: string): any => {
    try {
      const part = token.split('.')[1] || '';
      const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const binStr = atob(padded);
      const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
      const jsonStr = new TextDecoder().decode(bytes);
      return JSON.parse(jsonStr);
    } catch {
      return {};
    }
  };

  const applyDatabaseSnapshot = useCallback((d: any, serverTime?: string, rev?: string, seq?: number) => {
    if (serverTime) {
      setServerClockOffset(serverTime);
      setCurrentServerTime(getServerNow());
    }
    if (rev) {
      lastKnownRevRef.current = String(rev);
    }
    if (typeof seq === 'number' && seq > 0) {
      lastKnownSeqRef.current = seq;
    }
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.students)) setStudents(d.students);
    if (Array.isArray(d.classes)) setClasses(d.classes);
    if (Array.isArray(d.sessions)) setSessions(d.sessions);
    if (Array.isArray(d.attendance)) {
      const pendingOptIds = new Set<string>();
      scanBatchQueueRef.current.forEach((b) => {
        if (b.optimisticId) pendingOptIds.add(b.optimisticId);
      });
      inFlightOptimisticIdsRef.current.forEach((oid) => pendingOptIds.add(oid));

      if (pendingOptIds.size === 0) {
        setAttendance(d.attendance);
      } else {
        setAttendance((prev) => {
          const preserved = prev.filter((item) => {
            if (!pendingOptIds.has(item.id)) return false;
            const alreadySaved = d.attendance.some(
              (srv: AttendanceRecord) =>
                srv.student_id === item.student_id &&
                srv.session_id === item.session_id &&
                srv.date === item.date
            );
            return !alreadySaved;
          });
          return [...preserved, ...d.attendance];
        });
      }
    }
    if (Array.isArray(d.out_of_class)) setOutOfClass(d.out_of_class);
    if (Array.isArray(d.violations)) setViolations(d.violations);
    if (Array.isArray(d.violation_types)) setViolationTypes(d.violation_types);
    if (Array.isArray(d.leave_requests)) setLeaveRequests(d.leave_requests);
    if (d.settings) setSettings((prev) => ({ ...prev, ...d.settings }));
    if (d.notification_settings) {
      setNotificationSettings((prev) => ({ ...prev, ...d.notification_settings }));
    }
    if (Array.isArray(d.notification_logs)) setNotificationLogs(d.notification_logs);
    if (Array.isArray(d.audit_logs)) setAuditLogs(d.audit_logs);
    setLastSyncTime(new Date());
    setSyncStatus('synced');
    latestSnapshotDataRef.current = { ...latestSnapshotDataRef.current, ...d };
    writeLocalDbCache({
      rev: rev || lastKnownRevRef.current,
      seq: typeof seq === 'number' && seq > 0 ? seq : lastKnownSeqRef.current,
      serverTime,
      data: latestSnapshotDataRef.current,
    });
  }, []);

  const applyDeltaEvents = useCallback(
    (events: any[], serverTime?: string, rev?: string, seq?: number) => {
      if (serverTime) {
        setServerClockOffset(serverTime);
        setCurrentServerTime(getServerNow());
      }
      if (rev) {
        lastKnownRevRef.current = String(rev);
      }
      if (typeof seq === 'number' && seq > 0) {
        lastKnownSeqRef.current = seq;
      }
      if (!Array.isArray(events) || events.length === 0) return;

      const attUpserts: AttendanceRecord[] = [];
      const attDeletes = new Set<string>();
      const oocUpserts: OutOfClassRecord[] = [];
      const vioUpserts: ViolationRecord[] = [];
      const vioDeletes = new Set<string>();
      const lrUpserts: LeaveRequest[] = [];

      for (const ev of events) {
        if (!ev || !ev.op) continue;
        if (ev.op === 'attendance_upsert' && ev.record) attUpserts.push(ev.record);
        else if (ev.op === 'attendance_delete' && ev.id) attDeletes.add(String(ev.id));
        else if (ev.op === 'ooc_upsert' && ev.record) oocUpserts.push(ev.record);
        else if (ev.op === 'violation_upsert' && ev.record) vioUpserts.push(ev.record);
        else if (ev.op === 'violation_delete' && ev.id) vioDeletes.add(String(ev.id));
        else if (ev.op === 'leave_upsert' && ev.record) lrUpserts.push(ev.record);
      }

      if (attUpserts.length > 0 || attDeletes.size > 0) {
        setAttendance((prev) => {
          let next = prev.filter((item) => !attDeletes.has(item.id));
          for (const rec of attUpserts) {
            next = [
              rec,
              ...next.filter(
                (p) =>
                  p.id !== rec.id &&
                  !(
                    p.id.startsWith('opt_') &&
                    p.student_id === rec.student_id &&
                    p.session_id === rec.session_id &&
                    p.date === rec.date
                  )
              ),
            ];
          }
          return next;
        });
      }

      if (oocUpserts.length > 0) {
        setOutOfClass((prev) => {
          let next = prev;
          for (const rec of oocUpserts) {
            next = [
              rec,
              ...next.filter(
                (p) =>
                  p.id !== rec.id &&
                  !(
                    p.id.startsWith('opt_') &&
                    p.student_id === rec.student_id &&
                    p.status === 'active'
                  )
              ),
            ];
          }
          return next;
        });
      }

      if (vioUpserts.length > 0 || vioDeletes.size > 0) {
        setViolations((prev) => {
          let next = prev.filter((item) => !vioDeletes.has(item.id));
          for (const rec of vioUpserts) {
            next = [
              rec,
              ...next.filter(
                (p) =>
                  p.id !== rec.id &&
                  !(
                    p.id.startsWith('opt_') &&
                    p.student_id === rec.student_id &&
                    p.violation_type_id === rec.violation_type_id
                  )
              ),
            ];
          }
          return next;
        });
      }

      if (lrUpserts.length > 0) {
        setLeaveRequests((prev) => {
          let next = prev;
          for (const rec of lrUpserts) {
            const exists = next.some((p) => p.id === rec.id);
            next = exists
              ? next.map((p) => (p.id === rec.id ? { ...p, ...rec } : p))
              : [rec, ...next];
          }
          return next;
        });
      }

      setLastSyncTime(new Date());
      setSyncStatus('synced');
    },
    []
  );

  const clearExpiredAppSession = useCallback(
    (message = 'Sesi login telah berakhir atau sandi diubah. Silakan masuk kembali.') => {
      authEpochRef.current += 1;
      tokenRefreshPromiseRef.current = null;
      pendingAdminSetupPasswordRef.current = null;
      sessionRef.current = null;
      setSession(null);
      try {
        localStorage.removeItem('dkb_session');
        localStorage.removeItem('dkb_active_tab');
      } catch {}
      setActiveTabState('attendance');
      showToast(message, 'info');
    },
    [showToast]
  );

  const refreshAuthSessionIfNeeded = useCallback(
    async (forceLogoutOn401 = false, failedToken?: string): Promise<string | null> => {
      const currentSess = sessionRef.current;
      if (!currentSess?.token) return null;
      if (failedToken && failedToken !== currentSess.token) {
        return currentSess.token;
      }
      const startEpoch = authEpochRef.current;
      const startToken = currentSess.token;

      if (tokenRefreshPromiseRef.current) {
        return tokenRefreshPromiseRef.current;
      }

      const promise = (async () => {
        try {
          const res = await apiFetch('/api/auth?action=refresh_session', {
            method: 'POST',
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, startToken),
            body: JSON.stringify({}),
          });
          const data = await res.json().catch(() => ({}));

          if (
            authEpochRef.current !== startEpoch ||
            !sessionRef.current?.token ||
            sessionRef.current.token !== startToken
          ) {
            return sessionRef.current?.token || null;
          }

          if (res.ok && data?.token) {
            const payload = decodeJwtPayload(data.token);
            const activeSess = sessionRef.current;
            const updated: AuthSession = {
              ...activeSess,
              token: data.token,
              userId: payload.userId || activeSess.userId,
              role: payload.role || activeSess.role,
              name: payload.name || activeSess.name,
              label: payload.label || activeSess.label,
              tokenVersion: payload.tokenVersion ?? activeSess.tokenVersion,
              lockedMenuClassId:
                payload.lockedMenuClassId !== undefined
                  ? payload.lockedMenuClassId
                  : activeSess.lockedMenuClassId,
            };
            sessionRef.current = updated;
            setSession(updated);
            try {
              localStorage.setItem('dkb_session', JSON.stringify(updated));
            } catch {}
            return data.token as string;
          }

          if (
            res.status === 401 &&
            !data?.unauthorizedToken &&
            !data?.googleDeploymentUnauthorized &&
            (data?.sessionInvalidated || forceLogoutOn401)
          ) {
            clearExpiredAppSession(
              data?.error || 'Sesi login telah berakhir atau kata sandi diubah. Silakan masuk kembali.'
            );
          }
          return null;
        } catch {
          return null;
        } finally {
          tokenRefreshPromiseRef.current = null;
        }
      })();

      tokenRefreshPromiseRef.current = promise;
      return promise;
    },
    [buildApiHeaders, clearExpiredAppSession]
  );

  const speak = useCallback(
    (text: string) => {
      if (!settings.tts_enabled) return;
      ttsService.speak(text, {
        rate: settings.tts_rate,
        pitch: settings.tts_pitch,
        volume: settings.tts_volume,
      });
    },
    [settings.tts_enabled, settings.tts_rate, settings.tts_pitch, settings.tts_volume]
  );

  // Synchronize theme
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.theme]);

  // Real-time Server Clock tick (1s)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentServerTime(getServerNow());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Live session calculation
  const autoSwitchEnabled = settings.auto_session_switch !== false;
  const sessionSchedule = resolveSessionSchedule(
    sessions,
    currentServerTime,
    autoSwitchEnabled,
    manualSessionOverrideId
  );
  const activeSession = sessionSchedule.activeSession;

  // Detect automatic session transitions
  useEffect(() => {
    const liveSess = sessionSchedule.liveWindowSession;
    if (!liveSess || manualSessionOverrideId) return;

    const prevId = prevLiveSessionIdRef.current;
    const prevName = prevLiveSessionNameRef.current;

    if (prevId && prevId !== liveSess.id && autoSwitchEnabled) {
      setLastSessionTransition({
        fromName: prevName || undefined,
        toSession: liveSess,
        at: new Date().toISOString(),
      });
      if (settings.auto_session_switch_notify !== false) {
        showToast(`Peralihan sesi otomatis: "${liveSess.name}" kini aktif.`, 'info');
      }
    }

    prevLiveSessionIdRef.current = liveSess.id;
    prevLiveSessionNameRef.current = liveSess.name;
  }, [sessionSchedule.liveWindowSession, manualSessionOverrideId, autoSwitchEnabled, settings.auto_session_switch_notify, showToast]);

  const dismissSessionTransition = useCallback(() => setLastSessionTransition(null), []);

  const setManualSessionOverride = useCallback((sessionId: string | null) => {
    setManualSessionOverrideId(sessionId);
    try {
      if (sessionId) localStorage.setItem('dkb_manual_session_override', sessionId);
      else localStorage.removeItem('dkb_manual_session_override');
    } catch {}
  }, []);

  const toggleKioskFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsKioskFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsKioskFullscreen(false);
    }
  }, []);

  /**
   * Memuat data langsung dari Google Sheets melalui Google Apps Script Web App
   * Memakai fast-revision check (`rev`) untuk respons permili detik saat belum ada perubahan,
   * dan full snapshot otomatis bila terjadi mutasi atau setiap 15 detik / saat tab aktif.
   */
  const refreshFromSheets = useCallback(
    async (silent = false, options?: { afterWrite?: boolean; forceFull?: boolean }) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return;
      }

      if (options?.afterWrite) {
        latestMutationSeqRef.current += 1;
        pendingRefreshAfterWriteRef.current = true;
      }

      if (isFetchingRef.current) {
        if (options?.afterWrite) {
          pendingRefreshAfterWriteRef.current = true;
        }
        return;
      }

      if (pendingWriteCountRef.current > 0 && !options?.forceFull) {
        return;
      }

      isFetchingRef.current = true;
      if (options?.afterWrite) {
        pendingRefreshAfterWriteRef.current = false;
      }
      if (!silent) setSyncStatus('syncing');

      const fetchStartMutationSeq = latestMutationSeqRef.current;

      try {
        // Hidrasi otomatis URL & SECRET_TOKEN dari 4 lapis browser + Vercel Env + /api/apps-script-config
        if (!hasHydratedConfigRef.current || !hasCompleteAppsScriptConfig()) {
          hasHydratedConfigRef.current = true;
          const hydrated = await hydrateAppsScriptConfig();
          setAppsScriptUrlState(hydrated.appsScriptUrl);
          setAppsScriptSecretConfigured(Boolean(hydrated.secretToken));
          setIsAppsScriptLockedState(hydrated.locked);
          if (hydrated.appsScriptUrl && hydrated.secretToken) {
            // Segera buka layar login begitu URL & token terhidrasi tanpa menunggu snapshot penuh 13 tab
            setIsInitialLoading(false);
          }
        } else {
          const curUrl = getAppsScriptUrl();
          if (curUrl) setAppsScriptUrlState(curUrl);
          setAppsScriptSecretConfigured(hasAppsScriptSecretToken());
          setIsAppsScriptLockedState(isAppsScriptConfigLocked());
          setIsInitialLoading(false);
        }

        const clientMissing = getMissingClientConfig();
        setAppsScriptSecretConfigured(hasAppsScriptSecretToken());
        setIsAppsScriptLockedState(isAppsScriptConfigLocked());
        if (clientMissing.length > 0) {
          setConfigError(
            `Konfigurasi Google Apps Script belum lengkap (${clientMissing.join(', ')} masih kosong).`
          );
          setMissingEnv(clientMissing);
          setEnvStatus({
            configured: false,
            sheetsConfigured: false,
            driveConfigured: false,
            spreadsheetConfigured: false,
            driveFolderConfigured: false,
            authMode: 'unconfigured',
            emailConnected: false,
            emailTransport: 'unconfigured',
            senderEmail: '',
            missingEnv: clientMissing,
          });
          setSyncStatus('error');
          return;
        }

        const nowMs = Date.now();
        const isPeriodicReconcile =
          Boolean(lastKnownRevRef.current) &&
          !options?.afterWrite &&
          !options?.forceFull &&
          nowMs - lastFullSyncAtRef.current >= FULL_RECONCILE_INTERVAL_MS;
        const needsFullReconcile =
          Boolean(options?.forceFull) ||
          !lastKnownRevRef.current ||
          isPeriodicReconcile;

        const syncParams = new URLSearchParams();
        if (!needsFullReconcile && lastKnownRevRef.current) {
          syncParams.set('rev', lastKnownRevRef.current);
          if (lastKnownSeqRef.current > 0) {
            syncParams.set('seq', String(lastKnownSeqRef.current));
          }
        } else {
          syncParams.set('full', '1');
          if (isPeriodicReconcile) {
            syncParams.set('fresh', '1');
          }
        }
        const syncEndpoint = `/api/sync?${syncParams.toString()}`;

        const res = await apiFetch(syncEndpoint, {
          headers: buildApiHeaders({ 'Cache-Control': 'no-cache' }),
        });
        const data = await res.json().catch(() => ({}));

        // Abaikan snapshot lama bila ada penulisan atau antrean optimistik yang masih berjalan
        if (latestMutationSeqRef.current > fetchStartMutationSeq || pendingWriteCountRef.current > 0) {
          pendingRefreshAfterWriteRef.current = true;
          return;
        }

        if (handleAppsScriptUnauthorized(res.status, data)) {
          consecutiveSyncErrorsRef.current += 1;
          setSyncStatus('error');
          return;
        }

        if (res.status === 401 && sessionRef.current?.token) {
          await refreshAuthSessionIfNeeded(false, sessionRef.current.token);
        }

        if (res.status === 503) {
          consecutiveSyncErrorsRef.current += 1;
          const missing = Array.isArray(data.missingConfig)
            ? data.missingConfig
            : Array.isArray(data.missingEnv)
            ? data.missingEnv
            : getMissingClientConfig();
          setConfigError(
            data.error || 'Properti Skrip Google Apps Script belum lengkap (SPREADSHEET_ID / DRIVE_FOLDER_ID / SECRET_TOKEN).'
          );
          setMissingEnv(missing);
          setEnvStatus({
            configured: false,
            sheetsConfigured: false,
            driveConfigured: false,
            spreadsheetConfigured: false,
            driveFolderConfigured: false,
            authMode: 'apps_script',
            emailConnected: Boolean(data.emailConnected),
            emailTransport: data.emailTransport || 'unconfigured',
            senderEmail: data.senderEmail || '',
            missingEnv: missing,
          });
          setSyncStatus('error');
          return;
        }

        if (!res.ok) {
          consecutiveSyncErrorsRef.current += 1;
          setInitialLoadError(data.error || 'Gagal membaca data dari Google Sheets.');
          setSyncStatus('error');
          return;
        }

        consecutiveSyncErrorsRef.current = 0;

        const missingList = Array.isArray(data.missingConfig)
          ? data.missingConfig
          : Array.isArray(data.missingEnv)
          ? data.missingEnv
          : [];
        setConfigError(null);
        setInitialLoadError(null);
        setMissingEnv(missingList);

        if (data.rev) {
          lastKnownRevRef.current = String(data.rev);
        }
        if (typeof data.seq === 'number' && data.seq > 0) {
          lastKnownSeqRef.current = data.seq;
        }

        if (data.unchanged) {
          burstSyncNextRef.current = false;
          if (data.serverTime) {
            setServerClockOffset(data.serverTime);
            setCurrentServerTime(getServerNow());
          }
          setLastSyncTime(new Date());
          setSyncStatus('synced');
          return;
        }

        if (data.delta && Array.isArray(data.events)) {
          burstSyncNextRef.current = true;
          setEnvStatus((prev) => ({
            ...prev,
            configured: Boolean(data.configured),
            sheetsConfigured: Boolean(data.sheetsConfigured),
            driveConfigured: Boolean(data.driveConfigured),
            spreadsheetConfigured: Boolean(data.spreadsheetConfigured),
            driveFolderConfigured: Boolean(data.driveFolderConfigured),
            authMode: 'apps_script',
            emailConnected: Boolean(data.emailConnected),
            emailTransport: data.emailTransport || 'apps_script_gmail',
            missingEnv: missingList,
          }));
          applyDeltaEvents(data.events, data.serverTime, data.rev, data.seq);
          broadcastSyncEvent('DATA_DELTA', {
            events: data.events,
            serverTime: data.serverTime,
            rev: data.rev,
            seq: data.seq,
          });
          return;
        }

        burstSyncNextRef.current = false;
        lastFullSyncAtRef.current = nowMs;

        setEnvStatus({
          configured: Boolean(data.configured),
          sheetsConfigured: Boolean(data.sheetsConfigured),
          driveConfigured: Boolean(data.driveConfigured),
          spreadsheetConfigured: Boolean(data.spreadsheetConfigured),
          driveFolderConfigured: Boolean(data.driveFolderConfigured),
          authMode: 'apps_script',
          emailConnected: Boolean(data.emailConnected),
          emailTransport: data.emailTransport || 'apps_script_gmail',
          senderEmail: data.senderEmail || '',
          missingEnv: missingList,
        });

        if (data.data) {
          applyDatabaseSnapshot(data.data, data.serverTime, data.rev, data.seq);
          broadcastSyncEvent('DATA_SNAPSHOT', {
            snapshot: data.data,
            serverTime: data.serverTime,
            rev: data.rev,
            seq: data.seq,
          });
        } else {
          if (data.serverTime) {
            setServerClockOffset(data.serverTime);
            setCurrentServerTime(getServerNow());
          }
          setLastSyncTime(new Date());
          setSyncStatus('synced');
        }
      } catch (err: any) {
        consecutiveSyncErrorsRef.current += 1;
        setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        if (!silent) {
          setInitialLoadError(err?.message || 'Koneksi ke Google Apps Script bermasalah.');
        }
      } finally {
        isFetchingRef.current = false;
        setIsInitialLoading(false);
        if (pendingRefreshAfterWriteRef.current) {
          pendingRefreshAfterWriteRef.current = false;
          void refreshFromSheets(true);
        }
      }
    },
    [
      applyDatabaseSnapshot,
      applyDeltaEvents,
      broadcastSyncEvent,
      buildApiHeaders,
      handleAppsScriptUnauthorized,
      refreshAuthSessionIfNeeded,
    ]
  );

  const connectAppsScript = useCallback(
    async (rawUrl: string, rawSecretToken?: string): Promise<{ ok: boolean; message: string }> => {
      const startEpoch = authEpochRef.current;
      setIsConnectingAppsScript(true);
      try {
        const resolvedSecret = String(rawSecretToken ?? getAppsScriptSecretToken()).trim();
        const result = await testAppsScriptConnection(rawUrl, resolvedSecret);
        if (!result.ok) {
          showToast(result.message, 'error');
          return { ok: false, message: result.message };
        }
        const saved = setAppsScriptUrl(rawUrl);
        setAppsScriptSecretToken(resolvedSecret);
        setAppsScriptConfigLocked(true);
        setAppsScriptUrlState(saved);
        setAppsScriptSecretConfigured(true);
        setIsAppsScriptLockedState(true);
        setConfigError(null);
        setInitialLoadError(null);

        const missingList = Array.isArray(result.data?.missingConfig) ? result.data.missingConfig : [];
        setMissingEnv(missingList);

        if (result.data?.data) {
          applyDatabaseSnapshot(result.data.data, result.data.serverTime, result.data.rev, result.data.seq);
          lastFullSyncAtRef.current = Date.now();
          setEnvStatus({
            configured: Boolean(result.data.configured ?? true),
            sheetsConfigured: Boolean(result.data.sheetsConfigured ?? true),
            driveConfigured: Boolean(result.data.driveConfigured ?? true),
            spreadsheetConfigured: true,
            driveFolderConfigured: Boolean(result.data.driveFolderConfigured ?? true),
            authMode: 'apps_script',
            emailConnected: Boolean(result.data.emailConnected),
            emailTransport: result.data.emailTransport || 'apps_script_gmail',
            senderEmail: result.data.senderEmail || '',
            missingEnv: missingList,
          });
        }

        await persistServerAppsScriptConfig(saved, resolvedSecret);
        broadcastSyncEvent('APPS_SCRIPT_CHANGED', { appsScriptUrl: saved });

        if (authEpochRef.current !== startEpoch) {
          showToast('Tersimpan', 'success');
          return { ok: true, message: result.message };
        }

        let activeAppToken = sessionRef.current?.token || '';
        if (activeAppToken) {
          const refreshed = await refreshAuthSessionIfNeeded(false, activeAppToken);
          activeAppToken = refreshed || '';
        } else if (sessionRef.current?.lockedMenuRole === 'admin') {
          try {
            const setupPw = pendingAdminSetupPasswordRef.current || 'admin123';
            const authRes = await apiFetch('/api/auth?action=unlock_admin', {
              method: 'POST',
              headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ password: setupPw }),
            });
            const authData = await authRes.json().catch(() => ({}));
            pendingAdminSetupPasswordRef.current = null;
            if (authEpochRef.current !== startEpoch || !sessionRef.current) {
              showToast('Tersimpan', 'success');
              return { ok: true, message: result.message };
            }
            if (authRes.ok && authData.token) {
              const payload = decodeJwtPayload(authData.token);
              const upgradedSess: AuthSession = {
                token: authData.token,
                userId: payload.userId || 'user_admin_main',
                role: 'admin',
                name: payload.name || 'Administrator Sekolah',
                label: payload.label || 'Admin Sistem',
                tokenVersion: payload.tokenVersion || 1,
                lockedMenuRole: 'admin',
              };
              sessionRef.current = upgradedSess;
              setSession(upgradedSess);
              localStorage.setItem('dkb_session', JSON.stringify(upgradedSess));
              activeAppToken = authData.token;
            } else {
              authEpochRef.current += 1;
              sessionRef.current = null;
              setSession(null);
              localStorage.removeItem('dkb_session');
              localStorage.removeItem('dkb_active_tab');
              setActiveTabState('attendance');
              showToast(
                'Tersimpan. Silakan masuk sebagai Admin dengan password sekolah Anda.',
                'info'
              );
              return { ok: true, message: result.message };
            }
          } catch {}
        }

        if (activeAppToken && authEpochRef.current === startEpoch) {
          apiFetch('/api/settings', {
            method: 'POST',
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, activeAppToken),
            body: JSON.stringify({ apps_script_url: saved }),
          }).catch(() => {});
        }

        showToast('Tersimpan', 'success');
        if (!result.data?.data) {
          await refreshFromSheets(false, { afterWrite: true, forceFull: true });
        }
        return { ok: true, message: result.message };
      } finally {
        setIsConnectingAppsScript(false);
      }
    },
    [
      applyDatabaseSnapshot,
      broadcastSyncEvent,
      buildApiHeaders,
      refreshAuthSessionIfNeeded,
      refreshFromSheets,
      showToast,
    ]
  );

  const disconnectAppsScript = useCallback(async () => {
    clearAppsScriptUrl();
    clearAppsScriptSecretToken();
    setAppsScriptConfigLocked(false);
    setAppsScriptUrlState('');
    setAppsScriptSecretConfigured(false);
    setIsAppsScriptLockedState(false);
    await clearServerAppsScriptUrl();
    broadcastSyncEvent('APPS_SCRIPT_CHANGED', { appsScriptUrl: '' });
    showToast('Koneksi backend Google Apps Script dibuka kunci & diputuskan.', 'info');
    await refreshFromSheets(false, { afterWrite: true });
  }, [broadcastSyncEvent, refreshFromSheets, showToast]);

  const runSystemCheck = useCallback(async (): Promise<SystemCheckResult> => {
    const res = await runAppsScriptSystemCheck();
    const combinedMissing = Array.from(new Set([...res.emptyClientKeys, ...res.emptyBackendKeys]));
    setMissingEnv(combinedMissing);
    if (res.tokenError) {
      setConfigError(res.tokenError);
    } else if (res.ok) {
      setConfigError(null);
    }
    return res;
  }, []);

  /**
   * Kirim otomatis antrean scan offline yang tersimpan di localStorage saat online kembali
   */
  const flushOfflineAttendanceScans = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (!hasCompleteAppsScriptConfig()) return;
    const queued = readOfflineScans();
    if (queued.length === 0) return;

    setSavingState();
    pendingWriteCountRef.current += 1;
    writeQueueRef.current = writeQueueRef.current
      .catch(() => {})
      .then(async () => {
        const latestQueued = readOfflineScans();
        if (latestQueued.length === 0) {
          setPendingOfflineScansCount(0);
          return;
        }
        try {
          const sentToken = sessionRef.current?.token;
          const sendQueued = async (tokOverride?: string) => {
            const res = await apiFetch('/api/attendance', {
              method: 'POST',
              headers: buildApiHeaders({ 'Content-Type': 'application/json' }, tokOverride),
              body: JSON.stringify({ scans: latestQueued }),
            });
            const data = await res.json().catch(() => ({}));
            return { res, data };
          };

          let { res, data } = await sendQueued(sentToken);
          if (handleAppsScriptUnauthorized(res.status, data)) {
            return;
          }
          if (res.status === 401 && sessionRef.current?.token) {
            const refreshedTok = await refreshAuthSessionIfNeeded(false, sentToken);
            if (refreshedTok) {
              const retried = await sendQueued(refreshedTok);
              res = retried.res;
              data = retried.data;
            }
          }

          if (res.ok) {
            writeOfflineScans([]);
            setPendingOfflineScansCount(0);
            setSavedState('Tersimpan');
            if (data.rejectedCount > 0) {
              showToast(`Tersimpan (${data.rejectedCount} duplikat ditolak)`, 'info');
            } else {
              showToast('Tersimpan', 'success');
            }
            if (data.rev) {
              lastKnownRevRef.current = String(data.rev);
            }
            if (typeof data.seq === 'number' && data.seq > 0) {
              lastKnownSeqRef.current = data.seq;
            }
            if (data.snapshot) {
              applyDatabaseSnapshot(data.snapshot, data.serverTime, data.rev, data.seq);
              broadcastSyncEvent('DATA_SNAPSHOT', {
                snapshot: data.snapshot,
                serverTime: data.serverTime,
                rev: data.rev,
                seq: data.seq,
              });
            } else if (data.deltaApplied) {
              const savedOff = Array.isArray(data.results) ? data.results.map((r: any) => ({ op: 'attendance_upsert', record: r.record })) : [];
              if (savedOff.length > 0) {
                applyDeltaEvents(savedOff, data.serverTime, data.rev, data.seq);
                broadcastSyncEvent('DATA_DELTA', {
                  events: savedOff,
                  serverTime: data.serverTime,
                  rev: data.rev,
                  seq: data.seq,
                });
              }
            } else {
              await refreshFromSheets(true, { afterWrite: true });
              broadcastSyncEvent('DATA_MUTATED');
            }
          } else if (res.status < 500 && res.status !== 429 && res.status !== 401) {
            writeOfflineScans([]);
            setPendingOfflineScansCount(0);
            setSaveErrorState(data.error || 'Gagal mengirim scan offline.');
          }
        } catch {
          setSyncStatus('offline');
        }
      })
      .finally(() => {
        pendingWriteCountRef.current = Math.max(0, pendingWriteCountRef.current - 1);
      });
    await writeQueueRef.current;
  }, [
    applyDatabaseSnapshot,
    applyDeltaEvents,
    buildApiHeaders,
    broadcastSyncEvent,
    handleAppsScriptUnauthorized,
    refreshAuthSessionIfNeeded,
    refreshFromSheets,
    setSavingState,
    setSavedState,
    setSaveErrorState,
    showToast,
  ]);

  // Muat awal + verifikasi sesi + sinkronisasi otomatis sub-detik (120ms/60ms delta + lintas-tab <1ms + saat tab aktif)
  useEffect(() => {
    let cancelled = false;
    let syncLoopTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextSync = () => {
      if (cancelled) return;
      if (syncLoopTimer) clearTimeout(syncLoopTimer);
      const errCount = consecutiveSyncErrorsRef.current;
      const delay =
        errCount === 0
          ? (burstSyncNextRef.current ? REALTIME_BURST_COOLDOWN_MS : REALTIME_SYNC_COOLDOWN_MS)
          : Math.min(8000, 1500 * Math.pow(2, errCount - 1));

      syncLoopTimer = setTimeout(async () => {
        if (cancelled) return;
        const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
        const isOnline = typeof navigator === 'undefined' || navigator.onLine;
        if (isVisible && isOnline && hasCompleteAppsScriptConfig() && !isFetchingRef.current) {
          await refreshFromSheets(true);
          void flushOfflineAttendanceScans();
        }
        scheduleNextSync();
      }, delay);
    };

    const bootSync = async () => {
      const hasCachedRev = Boolean(lastKnownRevRef.current);
      await refreshFromSheets(hasCachedRev);
      await flushOfflineAttendanceScans();
      if (sessionRef.current?.token) {
        void refreshAuthSessionIfNeeded(false);
      }
      scheduleNextSync();
    };
    void bootSync();

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(SYNC_BROADCAST_CHANNEL);
        syncChannelRef.current = bc;
        bc.onmessage = (event) => {
          const msg = event?.data;
          if (!msg) return;
          if (msg.type === 'APPS_SCRIPT_CHANGED') {
            setAppsScriptUrlState(getAppsScriptUrl());
            setAppsScriptSecretConfigured(hasAppsScriptSecretToken());
            setIsAppsScriptLockedState(isAppsScriptConfigLocked());
            void refreshFromSheets(true, { afterWrite: true, forceFull: true });
          } else if (msg.type === 'DATA_SNAPSHOT' && msg.payload?.snapshot) {
            applyDatabaseSnapshot(msg.payload.snapshot, msg.payload.serverTime, msg.payload.rev, msg.payload.seq);
          } else if (msg.type === 'DATA_DELTA' && Array.isArray(msg.payload?.events)) {
            applyDeltaEvents(msg.payload.events, msg.payload.serverTime, msg.payload.rev, msg.payload.seq);
          } else if (msg.type === 'DATA_OPTIMISTIC_ATTENDANCE' && msg.payload?.record) {
            const optRec = msg.payload.record as AttendanceRecord;
            setAttendance((prev) =>
              prev.some((a) => a.id === optRec.id) ? prev : [optRec, ...prev]
            );
          } else if (msg.type === 'DATA_OPTIMISTIC_OUT_OF_CLASS' && msg.payload?.record) {
            const optOoc = msg.payload.record as OutOfClassRecord;
            setOutOfClass((prev) =>
              prev.some((o) => o.id === optOoc.id) ? prev : [optOoc, ...prev]
            );
          } else if (msg.type === 'DATA_OPTIMISTIC_VIOLATION' && msg.payload?.violation) {
            const optVio = msg.payload.violation as ViolationRecord;
            setViolations((prev) =>
              prev.some((v) => v.id === optVio.id) ? prev : [optVio, ...prev]
            );
          } else if (msg.type === 'DATA_MUTATED') {
            void refreshFromSheets(true, { afterWrite: true });
          }
        };
      }
    } catch {}

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'dkb_apps_script_url' || e.key === 'dkb_apps_script_secret' || e.key === 'dkb_apps_script_locked') {
        setAppsScriptUrlState(getAppsScriptUrl());
        setAppsScriptSecretConfigured(hasAppsScriptSecretToken());
        setIsAppsScriptLockedState(isAppsScriptConfigLocked());
        void refreshFromSheets(true, { afterWrite: true, forceFull: true });
      } else if (e.key === 'dkb_last_sync_event') {
        void refreshFromSheets(true, { afterWrite: true });
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void refreshFromSheets(true);
        void flushOfflineAttendanceScans();
      }
    };

    const handleOnline = () => {
      consecutiveSyncErrorsRef.current = 0;
      setSyncStatus('syncing');
      void flushOfflineAttendanceScans();
      void refreshFromSheets(true, { afterWrite: true });
    };

    const handleOffline = () => {
      setSyncStatus('offline');
    };

    const handleAppsScriptUnauthorizedEvent = (evt: Event) => {
      const detail = (evt as CustomEvent)?.detail || {};
      handleAppsScriptUnauthorized(401, detail);
    };

    const handleAppTokenRefreshedEvent = (evt: Event) => {
      const nextToken = (evt as CustomEvent)?.detail?.token;
      if (typeof nextToken === 'string' && nextToken) {
        updateSessionToken(nextToken);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('storage', handleStorageEvent);
    window.addEventListener('dkb-apps-script-unauthorized', handleAppsScriptUnauthorizedEvent);
    window.addEventListener('dkb-app-token-refreshed', handleAppTokenRefreshedEvent);

    return () => {
      cancelled = true;
      if (syncLoopTimer) clearTimeout(syncLoopTimer);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('dkb-apps-script-unauthorized', handleAppsScriptUnauthorizedEvent);
      window.removeEventListener('dkb-app-token-refreshed', handleAppTokenRefreshedEvent);
      try {
        bc?.close();
      } catch {}
      syncChannelRef.current = null;
    };
  }, [
    applyDatabaseSnapshot,
    applyDeltaEvents,
    refreshFromSheets,
    flushOfflineAttendanceScans,
    handleAppsScriptUnauthorized,
    refreshAuthSessionIfNeeded,
  ]);

  // Flush batch of scans to POST /api/attendance
  const flushScanBatch = useCallback(async () => {
    if (scanBatchTimerRef.current) {
      clearTimeout(scanBatchTimerRef.current);
      scanBatchTimerRef.current = null;
    }
    if (scanBatchMaxTimerRef.current) {
      clearTimeout(scanBatchMaxTimerRef.current);
      scanBatchMaxTimerRef.current = null;
    }

    const items = scanBatchQueueRef.current.splice(0, scanBatchQueueRef.current.length);
    if (items.length === 0) return;

    const batchOptimisticIds = items.map((it) => it.optimisticId).filter(Boolean) as string[];
    batchOptimisticIds.forEach((oid) => inFlightOptimisticIdsRef.current.add(oid));

    const clearInFlightOptimistic = () => {
      batchOptimisticIds.forEach((oid) => inFlightOptimisticIdsRef.current.delete(oid));
    };

    setSavingState();

    pendingWriteCountRef.current += 1;
    try {
      await (writeQueueRef.current = writeQueueRef.current
        .catch(() => {})
        .then(async () => {
          try {
            const sentBatchTok = sessionRef.current?.token;
            const sendBatch = async (tokOverride?: string) => {
              const res = await apiFetch('/api/attendance', {
                method: 'POST',
                headers: buildApiHeaders({ 'Content-Type': 'application/json' }, tokOverride),
                body: JSON.stringify({
                  scans: items.map((it) => it.params),
                }),
              });
              const data = await res.json().catch(() => ({}));
              return { res, data };
            };

            let { res, data } = await sendBatch(sentBatchTok);
            if (handleAppsScriptUnauthorized(res.status, data)) {
              const msg = data.error || 'Token rahasia Apps Script ditolak.';
              clearInFlightOptimistic();
              if (batchOptimisticIds.length > 0) {
                setAttendance((prev) => prev.filter((a) => !batchOptimisticIds.includes(a.id)));
              }
              setSaveErrorState(msg);
              items.forEach((it) => it.resolve?.({ success: false, error: msg }));
              return;
            }

            if (res.status === 401 && sessionRef.current?.token) {
              const refreshedTok = await refreshAuthSessionIfNeeded(false, sentBatchTok);
              if (refreshedTok) {
                const retried = await sendBatch(refreshedTok);
                res = retried.res;
                data = retried.data;
              }
            }

            if (data.serverTime) {
              setServerClockOffset(data.serverTime);
            }

            if (!res.ok) {
              if (res.status >= 500 || res.status === 429) {
                clearInFlightOptimistic();
                const existingOffline = readOfflineScans();
                const newOffline = [...existingOffline, ...items.map((i) => i.params)];
                writeOfflineScans(newOffline);
                setPendingOfflineScansCount(newOffline.length);
                const msg = data.error || 'Server/kuota sibuk, scan disimpan sementara di perangkat.';
                setSaveErrorState(msg);
                items.forEach((it) => it.resolve?.({ success: false, error: msg, offlineQueued: true }));
                return;
              }
              clearInFlightOptimistic();
              if (batchOptimisticIds.length > 0) {
                setAttendance((prev) => prev.filter((a) => !batchOptimisticIds.includes(a.id)));
              }
              soundEffects.playErrorBeep();
              const errMsg = data.error || 'Presensi gagal disimpan.';
              setSaveErrorState(errMsg);
              showToast(errMsg, 'error');
              items.forEach((it) =>
                it.resolve?.({
                  success: false,
                  error: errMsg,
                  isDuplicate: data.isDuplicate,
                  student: data.student,
                })
              );
              return;
            }

            const savedResults: any[] = Array.isArray(data.results) ? data.results : [];
            const rejectedList: any[] = Array.isArray(data.rejectedDuplicates) ? data.rejectedDuplicates : [];

            clearInFlightOptimistic();

            if (savedResults.length > 0) {
              const hadNonOptimistic = items.some((it) => Boolean(it.resolve));
              if (hadNonOptimistic) {
                soundEffects.playSuccessBeep();
              }
              setAttendance((prev) => [
                ...savedResults.map((r) => r.record),
                ...prev.filter(
                  (p) =>
                    !batchOptimisticIds.includes(p.id) &&
                    !savedResults.some((sr) => sr.record.id === p.id)
                ),
              ]);
              if (pendingWriteCountRef.current <= 1) {
                setSavedState('Tersimpan');
              }
            } else {
              if (batchOptimisticIds.length > 0) {
                setAttendance((prev) => prev.filter((a) => !batchOptimisticIds.includes(a.id)));
              }
              soundEffects.playErrorBeep();
              const rejMsg = rejectedList[0]?.message || 'Presensi ditolak.';
              setSaveErrorState(rejMsg);
              if (items.some((it) => !it.resolve)) {
                showToast(rejMsg, 'error');
              }
            }

            if (rejectedList.length > 0 && savedResults.length > 0) {
              const hasOptimisticRejected = items.some(
                (it) =>
                  !it.resolve &&
                  rejectedList.some(
                    (r) =>
                      (it.targetStudent && r.studentId === it.targetStudent.nis) ||
                      (it.params.studentId && r.studentId === it.params.studentId)
                  )
              );
              if (hasOptimisticRejected) {
                showToast(rejectedList[0]?.message || 'Sebagian scan ditolak server.', 'error');
              }
            }

            items.forEach((it) => {
              if (!it.resolve) return;
              const targetStudent =
                it.targetStudent ||
                students.find(
                  (s) =>
                    (it.params.studentId && s.nis === it.params.studentId) ||
                    (it.params.code &&
                      (s.nis.toLowerCase() === it.params.code.trim().toLowerCase() ||
                        s.rfid_uid.toLowerCase() === it.params.code.trim().toLowerCase() ||
                        s.card_code.toLowerCase() === it.params.code.trim().toLowerCase()))
                );

              const matchSaved = savedResults.find(
                (r) =>
                  (targetStudent && r.record.student_id === targetStudent.nis) ||
                  (it.params.studentId && r.record.student_id === it.params.studentId)
              );

              if (matchSaved) {
                it.resolve({
                  success: true,
                  record: matchSaved.record,
                  student: matchSaved.student,
                  session: matchSaved.session,
                });
                return;
              }

              const matchRejected = rejectedList.find(
                (r) =>
                  (targetStudent && r.studentId === targetStudent.nis) ||
                  (it.params.studentId && r.studentId === it.params.studentId) ||
                  (it.params.code && r.code === it.params.code)
              );

              it.resolve({
                success: false,
                error: matchRejected?.message || rejectedList[0]?.message || 'Presensi gagal atau duplikat hari ini.',
                isDuplicate: Boolean(matchRejected?.isDuplicate),
                student: targetStudent,
                record: matchRejected?.existingRecord,
              });
            });

            if (data.rev) {
              lastKnownRevRef.current = String(data.rev);
            }
            if (typeof data.seq === 'number' && data.seq > 0) {
              lastKnownSeqRef.current = data.seq;
            }

            if (pendingWriteCountRef.current <= 1) {
              if (data.snapshot) {
                applyDatabaseSnapshot(data.snapshot, data.serverTime, data.rev, data.seq);
                broadcastSyncEvent('DATA_SNAPSHOT', {
                  snapshot: data.snapshot,
                  serverTime: data.serverTime,
                  rev: data.rev,
                  seq: data.seq,
                });
              } else if (data.deltaApplied) {
                const deltaEvs = savedResults.map((r: any) => ({
                  op: 'attendance_upsert',
                  record: r.record,
                }));
                if (deltaEvs.length > 0) {
                  broadcastSyncEvent('DATA_DELTA', {
                    events: deltaEvs,
                    serverTime: data.serverTime,
                    rev: data.rev,
                    seq: data.seq,
                  });
                }
              } else {
                await refreshFromSheets(true, { afterWrite: true });
                broadcastSyncEvent('DATA_MUTATED');
              }
            }
          } catch {
            clearInFlightOptimistic();
            const existingOffline = readOfflineScans();
            const newOffline = [...existingOffline, ...items.map((i) => i.params)];
            writeOfflineScans(newOffline);
            setPendingOfflineScansCount(newOffline.length);
            setSyncStatus('offline');
            setSaveErrorState('Offline: scan tersimpan sementara di perangkat.');
            items.forEach((it) =>
              it.resolve?.({
                success: false,
                error: 'Tidak ada koneksi internet. Scan disimpan di perangkat & dikirim otomatis saat online.',
                offlineQueued: true,
              })
            );
          }
        }));
    } finally {
      pendingWriteCountRef.current = Math.max(0, pendingWriteCountRef.current - 1);
      if (pendingWriteCountRef.current === 0 && pendingRefreshAfterWriteRef.current) {
        pendingRefreshAfterWriteRef.current = false;
        void refreshFromSheets(true);
      }
    }
  }, [
    applyDatabaseSnapshot,
    buildApiHeaders,
    broadcastSyncEvent,
    handleAppsScriptUnauthorized,
    refreshAuthSessionIfNeeded,
    students,
    refreshFromSheets,
    setSavingState,
    setSavedState,
    setSaveErrorState,
    showToast,
  ]);

  /**
   * Helper to run direct write fetch with <1ms optimistic state + rollback,
   * 'Menyimpan...' -> 'Tersimpan' status, automatic 401 token refresh + retry,
   * immediate snapshot sync across tabs, and 409 Conflict UI.
   */
  const runWriteRequest = useCallback(
    async (params: {
      url: string;
      method: 'POST' | 'PUT' | 'DELETE';
      body: any;
      entityKey?: string;
      conflictTitle?: string;
      applyOptimistic?: () => () => void;
      onSuccess?: (data: any) => void;
      successMessage?: string;
      silentToast?: boolean;
      optimisticReturn?: boolean;
      optimisticData?: any;
      onOptimisticBroadcast?: () => void;
    }): Promise<{ ok: boolean; optimistic?: boolean; data?: any; error?: string }> => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const offlineMsg = 'Tidak ada koneksi internet. Operasi edit/simpan data memerlukan koneksi ke Google Sheets.';
        setSaveErrorState(offlineMsg);
        if (!params.silentToast) showToast(offlineMsg, 'error');
        return { ok: false, error: offlineMsg };
      }

      const rollbackOptimistic = params.applyOptimistic ? params.applyOptimistic() : undefined;

      setSavingState();
      latestMutationSeqRef.current += 1;

      const execute = async (
        forceOverwrite = false,
        hasRetriedAuth = false,
        overrideAppToken?: string
      ): Promise<{ ok: boolean; data?: any; error?: string }> => {
        try {
          let baseBody = params.body;
          if (
            !forceOverwrite &&
            params.entityKey &&
            latestModifiedByEntityKeyRef.current[params.entityKey] &&
            baseBody &&
            typeof baseBody === 'object'
          ) {
            baseBody = {
              ...baseBody,
              expected_updated_at: latestModifiedByEntityKeyRef.current[params.entityKey],
            };
          }
          const payload = forceOverwrite ? { ...baseBody, forceOverwrite: true } : baseBody;
          const sentToken = overrideAppToken ?? sessionRef.current?.token ?? '';
          const res = await apiFetch(params.url, {
            method: params.method,
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, sentToken),
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));

          if (handleAppsScriptUnauthorized(res.status, data)) {
            rollbackOptimistic?.();
            const msg = data.error || 'Token rahasia Apps Script ditolak.';
            setSaveErrorState(msg);
            return { ok: false, error: msg };
          }

          if (res.status === 401 && !hasRetriedAuth && sessionRef.current?.token) {
            const refreshedTok = await refreshAuthSessionIfNeeded(true, sentToken);
            if (refreshedTok) {
              return execute(forceOverwrite, true, refreshedTok);
            }
            rollbackOptimistic?.();
            const authErr = data.error || 'Sesi login telah berakhir. Silakan masuk kembali.';
            setSaveErrorState(authErr);
            if (!params.silentToast) showToast(authErr, 'error');
            return { ok: false, error: authErr, data };
          }

          if (res.status === 409 && data.conflict) {
            if (params.entityKey && data.current?.diubah_pada) {
              latestModifiedByEntityKeyRef.current[params.entityKey] = String(data.current.diubah_pada);
            }
            rollbackOptimistic?.();
            const msg = data.error || 'Data sudah diubah oleh pengguna lain sebelum Anda menyimpan.';
            setSaveErrorState('Konflik edit terdeteksi');
            return await new Promise((resolve) => {
              setConflictPrompt({
                title: params.conflictTitle || 'Peringatan Konflik Data',
                message: msg,
                currentData: data.current,
                onReloadLatest: async () => {
                  setConflictPrompt(null);
                  await refreshFromSheets(true, { afterWrite: true, forceFull: true });
                  resolve({ ok: false, error: msg });
                },
                onForceOverwrite: async () => {
                  setConflictPrompt(null);
                  setSavingState();
                  const forcedRes = await execute(true, hasRetriedAuth, overrideAppToken);
                  resolve(forcedRes);
                },
              });
            });
          }

          if (!res.ok || data?.success === false) {
            rollbackOptimistic?.();
            soundEffects.playErrorBeep();
            const errMsg = data.error || `Gagal menyimpan data (${res.status})`;
            setSaveErrorState(errMsg);
            if (!params.silentToast) showToast(errMsg, 'error');
            return { ok: false, error: errMsg, data };
          }

          if (params.entityKey) {
            const nextChangedAt =
              data.record?.diubah_pada ||
              data.student?.diubah_pada ||
              data.class?.diubah_pada ||
              data.session?.diubah_pada ||
              data.violationType?.diubah_pada ||
              data.violation?.diubah_pada ||
              data.settings?.diubah_pada ||
              data.request?.diubah_pada;
            if (nextChangedAt) {
              latestModifiedByEntityKeyRef.current[params.entityKey] = String(nextChangedAt);
            }
          }

          const isLastQueuedWrite = pendingWriteCountRef.current <= 1;

          if (data.rev) {
            lastKnownRevRef.current = String(data.rev);
          }
          if (typeof data.seq === 'number' && data.seq > 0) {
            lastKnownSeqRef.current = data.seq;
          }

          if (data.snapshot && isLastQueuedWrite) {
            applyDatabaseSnapshot(data.snapshot, data.serverTime, data.rev, data.seq);
            broadcastSyncEvent('DATA_SNAPSHOT', {
              snapshot: data.snapshot,
              serverTime: data.serverTime,
              rev: data.rev,
              seq: data.seq,
            });
          } else if (data.deltaApplied) {
            const deltaEvents: any[] = [];
            if (params.url.startsWith('/api/attendance')) {
              if (Array.isArray(data.results)) {
                data.results.forEach((r: any) => {
                  if (r?.record) deltaEvents.push({ op: 'attendance_upsert', record: r.record });
                });
              } else if (data.record) {
                deltaEvents.push({ op: 'attendance_upsert', record: data.record });
              } else if (params.method === 'DELETE' && data.deletedId) {
                deltaEvents.push({ op: 'attendance_delete', id: data.deletedId });
              }
            } else if (params.url.startsWith('/api/out-of-class') && data.record) {
              deltaEvents.push({ op: 'ooc_upsert', record: data.record });
            } else if (params.url.startsWith('/api/violations')) {
              if (data.violation) {
                deltaEvents.push({ op: 'violation_upsert', record: data.violation });
              } else if (params.method === 'DELETE' && data.deletedId) {
                deltaEvents.push({ op: 'violation_delete', id: data.deletedId });
              }
            } else if (params.url.startsWith('/api/leave-requests') && data.request) {
              deltaEvents.push({ op: 'leave_upsert', record: data.request });
            }

            if (deltaEvents.length > 0) {
              applyDeltaEvents(deltaEvents, data.serverTime, data.rev, data.seq);
              if (isLastQueuedWrite) {
                broadcastSyncEvent('DATA_DELTA', {
                  events: deltaEvents,
                  serverTime: data.serverTime,
                  rev: data.rev,
                  seq: data.seq,
                });
              }
            }
          } else if (!data.snapshot) {
            if (params.url === '/api/settings' && data.settings) {
              setSettings((prev) => ({ ...prev, ...data.settings }));
              latestSnapshotDataRef.current = {
                ...latestSnapshotDataRef.current,
                settings: { ...(latestSnapshotDataRef.current.settings || {}), ...data.settings },
              };
              writeLocalDbCache({
                rev: lastKnownRevRef.current,
                seq: lastKnownSeqRef.current,
                serverTime: data.serverTime,
                data: latestSnapshotDataRef.current,
              });
            } else if (params.url === '/api/notifications' && data.settings) {
              setNotificationSettings((prev) => ({ ...prev, ...data.settings }));
              latestSnapshotDataRef.current = {
                ...latestSnapshotDataRef.current,
                notification_settings: {
                  ...(latestSnapshotDataRef.current.notification_settings || {}),
                  ...data.settings,
                },
              };
              writeLocalDbCache({
                rev: lastKnownRevRef.current,
                seq: lastKnownSeqRef.current,
                serverTime: data.serverTime,
                data: latestSnapshotDataRef.current,
              });
            }
            if (isLastQueuedWrite) {
              broadcastSyncEvent('DATA_MUTATED');
            }
          }

          if (isLastQueuedWrite) {
            setSavedState('Tersimpan');
          }
          if (params.onSuccess) params.onSuccess(data);
          if (params.successMessage && !params.silentToast) {
            showToast(params.successMessage, 'success');
          }
          if (!data.snapshot && !data.deltaApplied && isLastQueuedWrite) {
            await refreshFromSheets(true, { afterWrite: true });
          }
          return { ok: true, data };
        } catch (err: any) {
          rollbackOptimistic?.();
          soundEffects.playErrorBeep();
          const errMsg = err?.message || 'Gagal terhubung ke Apps Script.';
          setSaveErrorState(errMsg);
          if (!params.silentToast) showToast(errMsg, 'error');
          return { ok: false, error: errMsg };
        }
      };

      // Semua penulisan diserialisasi lewat writeQueueRef dan DITUNGGU hingga server Apps Script benar-benar mengonfirmasi penyimpanan
      pendingWriteCountRef.current += 1;
      const queuedResultPromise = writeQueueRef.current
        .catch(() => {})
        .then(() => execute(false));
      writeQueueRef.current = queuedResultPromise.then(
        () => {},
        () => {}
      );
      try {
        return await queuedResultPromise;
      } finally {
        pendingWriteCountRef.current = Math.max(0, pendingWriteCountRef.current - 1);
        if (pendingWriteCountRef.current === 0 && pendingRefreshAfterWriteRef.current) {
          pendingRefreshAfterWriteRef.current = false;
          void refreshFromSheets(true);
        }
      }
    },
    [
      applyDatabaseSnapshot,
      applyDeltaEvents,
      buildApiHeaders,
      broadcastSyncEvent,
      handleAppsScriptUnauthorized,
      refreshAuthSessionIfNeeded,
      refreshFromSheets,
      setSavingState,
      setSavedState,
      setSaveErrorState,
      showToast,
    ]
  );

  // ==================== AUTH ACTIONS ====================

  const ensureAppsScriptConfigReady = async (): Promise<boolean> => {
    if (hasCompleteAppsScriptConfig()) return true;
    const hydrated = await hydrateAppsScriptConfig();
    if (hydrated.appsScriptUrl) setAppsScriptUrlState(hydrated.appsScriptUrl);
    setAppsScriptSecretConfigured(Boolean(hydrated.secretToken));
    setIsAppsScriptLockedState(hydrated.locked);
    return hasCompleteAppsScriptConfig();
  };

  const loginDuty = async (password: string) => {
    const configReady = await ensureAppsScriptConfigReady();
    if (!configReady) {
      return {
        success: false,
        error: 'Koneksi server belum diaktifkan. Silakan masuk sebagai Admin untuk mengatur aktivasi, URL Script & Token.',
      };
    }
    authEpochRef.current += 1;
    const myEpoch = authEpochRef.current;
    try {
      const res = await apiFetch('/api/auth?action=login_duty', {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (authEpochRef.current !== myEpoch) {
        return { success: false, error: 'Permintaan login dibatalkan.' };
      }
      if (handleAppsScriptUnauthorized(res.status, data)) {
        return { success: false, error: data.error };
      }
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Password salah',
          remainingAttempts: data.details?.remainingAttempts ?? data.remainingAttempts,
          lockedForSeconds: data.details?.lockedForSeconds ?? data.lockedForSeconds,
        };
      }
      const payload = decodeJwtPayload(data.token);
      const authSess: AuthSession = {
        token: data.token,
        userId: payload.userId,
        role: payload.role,
        name: payload.name,
        label: payload.label,
        tokenVersion: payload.tokenVersion,
      };
      sessionRef.current = authSess;
      setSession(authSess);
      localStorage.setItem('dkb_session', JSON.stringify(authSess));
      setActiveTab('attendance');
      refreshFromSheets(true);
      return { success: true };
    } catch {
      return { success: false, error: 'Gagal menghubungi Google Apps Script.' };
    }
  };

  const unlockHomeroom = async (name: string, password: string, classId?: string) => {
    const configReady = await ensureAppsScriptConfigReady();
    if (!configReady) {
      return {
        success: false,
        error: 'Koneksi server belum diaktifkan. Silakan masuk sebagai Admin untuk mengatur aktivasi, URL Script & Token.',
      };
    }
    authEpochRef.current += 1;
    const myEpoch = authEpochRef.current;
    try {
      const res = await apiFetch('/api/auth?action=unlock_homeroom', {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, password, classId }),
      });
      const data = await res.json().catch(() => ({}));
      if (authEpochRef.current !== myEpoch) {
        return { success: false, error: 'Permintaan login dibatalkan.' };
      }
      if (handleAppsScriptUnauthorized(res.status, data)) {
        return { success: false, error: data.error };
      }
      if (!res.ok) return { success: false, error: data.error || 'Password wali kelas salah' };
      const payload = decodeJwtPayload(data.token);
      const authSess: AuthSession = {
        token: data.token,
        userId: payload.userId || 'homeroom',
        role: payload.role || 'homeroom',
        name: payload.name || data.teacherName || name,
        label: payload.label || `Wali Kelas ${data.classId || ''}`,
        tokenVersion: payload.tokenVersion || 1,
        lockedMenuRole: 'homeroom',
        lockedMenuClassId: data.classId || payload.lockedMenuClassId,
      };
      sessionRef.current = authSess;
      setSession(authSess);
      localStorage.setItem('dkb_session', JSON.stringify(authSess));
      setActiveTab('homeroom');
      refreshFromSheets(true);
      return { success: true, classId: data.classId };
    } catch {
      return { success: false, error: 'Gagal menghubungi Google Apps Script.' };
    }
  };

  const unlockStudentAffairs = async (password: string) => {
    const configReady = await ensureAppsScriptConfigReady();
    if (!configReady) {
      return {
        success: false,
        error: 'Koneksi server belum diaktifkan. Silakan masuk sebagai Admin untuk mengatur aktivasi, URL Script & Token.',
      };
    }
    authEpochRef.current += 1;
    const myEpoch = authEpochRef.current;
    try {
      const res = await apiFetch('/api/auth?action=unlock_student_affairs', {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (authEpochRef.current !== myEpoch) {
        return { success: false, error: 'Permintaan login dibatalkan.' };
      }
      if (handleAppsScriptUnauthorized(res.status, data)) {
        return { success: false, error: data.error };
      }
      if (!res.ok) return { success: false, error: data.error || 'Password kesiswaan salah' };
      const payload = decodeJwtPayload(data.token);
      const authSess: AuthSession = {
        token: data.token,
        userId: payload.userId || 'student_affairs',
        role: payload.role || 'student_affairs',
        name: payload.name || 'Bagian Kesiswaan',
        label: payload.label || 'Tim Kesiswaan',
        tokenVersion: payload.tokenVersion || 1,
        lockedMenuRole: 'student_affairs',
      };
      sessionRef.current = authSess;
      setSession(authSess);
      localStorage.setItem('dkb_session', JSON.stringify(authSess));
      setActiveTab('student_affairs');
      refreshFromSheets(true);
      return { success: true };
    } catch {
      return { success: false, error: 'Gagal menghubungi Google Apps Script.' };
    }
  };

  const unlockAdmin = async (password: string) => {
    authEpochRef.current += 1;
    const myEpoch = authEpochRef.current;

    const enterAdminSetupSession = (setupPass: string) => {
      if (authEpochRef.current !== myEpoch) return;
      pendingAdminSetupPasswordRef.current = setupPass;
      const setupSess: AuthSession = {
        token: '',
        userId: 'user_admin_main',
        role: 'admin',
        name: 'Administrator Sekolah',
        label: 'Admin Sistem',
        tokenVersion: 1,
        lockedMenuRole: 'admin',
      };
      sessionRef.current = setupSess;
      setSession(setupSess);
      localStorage.setItem('dkb_session', JSON.stringify(setupSess));
      setActiveTab('admin');
    };

    const configReady = await ensureAppsScriptConfigReady();
    if (authEpochRef.current !== myEpoch) {
      return { success: false, error: 'Permintaan login dibatalkan.' };
    }
    if (!configReady) {
      if (password === 'admin123') {
        enterAdminSetupSession(password);
        return { success: true };
      }
      return { success: false, error: 'Password admin salah.' };
    }

    try {
      const res = await apiFetch('/api/auth?action=unlock_admin', {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (authEpochRef.current !== myEpoch) {
        return { success: false, error: 'Permintaan login dibatalkan.' };
      }
      if (
        (res.status === 401 && (data?.unauthorizedToken || data?.googleDeploymentUnauthorized)) ||
        res.status === 503
      ) {
        if (password === 'admin123') {
          enterAdminSetupSession(password);
          handleAppsScriptUnauthorized(res.status, data);
          return { success: true };
        }
        handleAppsScriptUnauthorized(res.status, data);
        return { success: false, error: data.error || 'Konfigurasi Apps Script bermasalah.' };
      }
      if (!res.ok) return { success: false, error: data.error || 'Password admin salah' };
      const payload = decodeJwtPayload(data.token);
      const authSess: AuthSession = {
        token: data.token,
        userId: payload.userId || 'admin',
        role: 'admin',
        name: payload.name || 'Administrator',
        label: payload.label || 'Admin Sistem',
        tokenVersion: payload.tokenVersion || 1,
        lockedMenuRole: 'admin',
      };
      pendingAdminSetupPasswordRef.current = null;
      sessionRef.current = authSess;
      setSession(authSess);
      localStorage.setItem('dkb_session', JSON.stringify(authSess));
      setActiveTab('admin');
      refreshFromSheets(true);
      return { success: true };
    } catch {
      if (authEpochRef.current !== myEpoch) {
        return { success: false, error: 'Permintaan login dibatalkan.' };
      }
      if (password === 'admin123') {
        enterAdminSetupSession(password);
        showToast('Apps Script tidak terjangkau. Silakan periksa URL Script & Token di Menu Admin.', 'error');
        return { success: true };
      }
      return { success: false, error: 'Gagal menghubungi Google Apps Script.' };
    }
  };

  const logout = useCallback(() => {
    authEpochRef.current += 1;
    tokenRefreshPromiseRef.current = null;
    pendingAdminSetupPasswordRef.current = null;
    setConflictPrompt(null);
    setConfirmDialog(null);
    sessionRef.current = null;
    setSession(null);
    try {
      localStorage.removeItem('dkb_session');
      localStorage.removeItem('dkb_active_tab');
    } catch {}
    setActiveTabState('attendance');
  }, []);

  const lockCurrentMenu = useCallback(() => logout(), [logout]);

  const updateSessionToken = (newToken: string) => {
    try {
      const payload = decodeJwtPayload(newToken);
      const baseSess = sessionRef.current || session;
      if (!baseSess) return;
      const updatedSess: AuthSession = {
        ...baseSess,
        token: newToken,
        tokenVersion: payload.tokenVersion ?? baseSess.tokenVersion,
      };
      sessionRef.current = updatedSess;
      setSession(updatedSess);
      localStorage.setItem('dkb_session', JSON.stringify(updatedSess));
    } catch {}
  };

  // ==================== MUTATORS ====================

  const recordAttendance = async (params: {
    code?: string;
    studentId?: string;
    sessionId?: string;
    status?: string;
    notes?: string;
    method?: string;
    photoBase64?: string;
    photoFileName?: string;
  }) => {
    const manualOverride = Boolean(
      manualSessionOverrideId || (params.sessionId && params.sessionId !== activeSession?.id)
    );
    const targetSessionObj = params.sessionId
      ? sessions.find((s) => s.id === params.sessionId) || null
      : activeSession || sessions.find((s) => s.is_active) || sessions[0] || null;
    const targetSessionId = targetSessionObj?.id || params.sessionId;
    const serverNow = getServerNow();
    const todayStr = serverNow.toISOString().split('T')[0];

    // Quick duplicate & card validation against current state (<1ms)
    const targetStudent = students.find(
      (s) =>
        (params.studentId && s.nis === params.studentId) ||
        (params.code &&
          (s.nis.toLowerCase() === params.code.trim().toLowerCase() ||
            s.rfid_uid.toLowerCase() === params.code.trim().toLowerCase() ||
            s.card_code.toLowerCase() === params.code.trim().toLowerCase()))
    );

    // Peraturan sesi tertib: di luar jam mulai - selesai sesi (atau hari nonaktif / sesi nonaktif),
    // presensi ditutup total baik untuk Scan/RFID maupun Presensi Manual.
    const windowCheck = checkSessionAttendanceOpen(targetSessionObj, serverNow);
    if (!windowCheck.open) {
      soundEffects.playErrorBeep();
      return {
        success: false,
        sessionClosed: true,
        error: windowCheck.message,
        student: targetStudent,
        session: targetSessionObj || undefined,
      };
    }

    const isManual = params.method === 'manual';

    if (targetStudent) {
      // Setiap sesi berdiri sendiri (Sesi 1 & Sesi 2 tidak pernah dicampur)
      const existingInSession = attendance.find(
        (a) =>
          a.student_id === targetStudent.nis &&
          a.date === todayStr &&
          a.session_id === targetSessionId
      );

      if (existingInSession) {
        if (isManual) {
          const nextStatus = (params.status || existingInSession.status) as AttendanceRecord['status'];
          const nextLate = nextStatus === 'Terlambat' ? existingInSession.late_minutes : 0;
          const nextNotes = params.notes !== undefined ? params.notes : existingInSession.notes;
          const syncedRec: AttendanceRecord = {
            ...existingInSession,
            status: nextStatus,
            late_minutes: nextLate,
            notes: nextNotes,
            method: 'manual',
            updated_at: serverNow.toISOString(),
          };

          if (existingInSession.id.startsWith('opt_')) {
            const queuedMatch = scanBatchQueueRef.current.find(
              (b) => b.optimisticId === existingInSession.id
            );
            const prevSnapshot = existingInSession;
            setAttendance((prev) =>
              prev.map((a) => (a.id === existingInSession.id ? syncedRec : a))
            );
            if (queuedMatch) {
              queuedMatch.params = {
                ...queuedMatch.params,
                status: nextStatus,
                notes: nextNotes,
                method: 'manual',
                upsert: true,
                manualOverride: true,
              };
              const prevResolve = queuedMatch.resolve;
              const batchResult = await new Promise<any>((resolve) => {
                queuedMatch.resolve = (r: any) => {
                  prevResolve?.(r);
                  resolve(r);
                };
                void flushScanBatch();
              });
              if (!batchResult?.success) {
                setAttendance((prev) =>
                  prev.map((a) => (a.id === existingInSession.id ? prevSnapshot : a))
                );
                soundEffects.playErrorBeep();
                return {
                  success: false,
                  error: batchResult?.error || 'Gagal menyimpan presensi ke Google Sheets.',
                };
              }
              soundEffects.playSuccessBeep();
              return {
                success: true,
                record: batchResult.record || syncedRec,
                student: targetStudent,
                session: targetSessionObj,
                syncedFromExisting: true,
              };
            } else {
              const writeRes = await runWriteRequest({
                url: '/api/attendance',
                method: 'POST',
                body: {
                  scans: [
                    {
                      studentId: targetStudent.nis,
                      sessionId: targetSessionId,
                      status: nextStatus,
                      notes: nextNotes,
                      method: 'manual',
                      manualOverride: true,
                      upsert: true,
                    },
                  ],
                },
                silentToast: true,
              });
              if (!writeRes.ok) {
                setAttendance((prev) =>
                  prev.map((a) => (a.id === existingInSession.id ? prevSnapshot : a))
                );
                soundEffects.playErrorBeep();
                return {
                  success: false,
                  error: writeRes.error || 'Gagal menyimpan presensi ke Google Sheets.',
                };
              }
              const savedRec = writeRes.data?.results?.[0]?.record || syncedRec;
              soundEffects.playSuccessBeep();
              return {
                success: true,
                record: savedRec,
                student: targetStudent,
                session: targetSessionObj,
                syncedFromExisting: true,
              };
            }
          } else {
            const ok = await updateAttendance(
              existingInSession.id,
              {
                status: nextStatus,
                late_minutes: nextLate,
                notes: nextNotes,
                method: 'manual',
              },
              'Sinkronisasi presensi manual',
              { enforceSessionWindow: true, silentToast: true }
            );
            if (!ok) {
              soundEffects.playErrorBeep();
              return {
                success: false,
                error: 'Gagal menyimpan pembaruan presensi ke Google Sheets.',
              };
            }
            soundEffects.playSuccessBeep();
          }

          return {
            success: true,
            record: syncedRec,
            student: targetStudent,
            session: targetSessionObj,
            syncedFromExisting: true,
          };
        }

        soundEffects.playErrorBeep();
        const methodText = existingInSession.method === 'manual' ? 'Manual' : 'Scan';
        const sessName = targetSessionObj?.name || targetSessionId || '';
        const err = `Presensi ganda ditolak: ${targetStudent.name} sudah tercatat ${existingInSession.status} (${methodText}) pada sesi ${sessName} hari ini (${todayStr}).`;
        return {
          success: false,
          error: err,
          isDuplicate: true,
          student: targetStudent,
          record: existingInSession,
        };
      }

      const alreadyInBatch = scanBatchQueueRef.current.find(
        (b) =>
          b.params.sessionId === targetSessionId &&
          ((b.params.studentId && b.params.studentId === targetStudent.nis) ||
            (b.targetStudent && b.targetStudent.nis === targetStudent.nis) ||
            (params.code && b.params.code && b.params.code.trim().toLowerCase() === params.code.trim().toLowerCase()))
      );
      if (alreadyInBatch) {
        if (isManual) {
          const nextStatus = (params.status || 'Hadir') as AttendanceRecord['status'];
          const nextNotes = params.notes ?? alreadyInBatch.params.notes ?? '';
          alreadyInBatch.params = {
            ...alreadyInBatch.params,
            status: nextStatus,
            notes: nextNotes,
            method: 'manual',
            upsert: true,
            manualOverride: true,
          };
          const optRec = attendance.find((a) => a.id === alreadyInBatch.optimisticId);
          if (optRec) {
            setAttendance((prev) =>
              prev.map((a) =>
                a.id === optRec.id
                  ? {
                      ...a,
                      status: nextStatus,
                      late_minutes: nextStatus === 'Terlambat' ? a.late_minutes : 0,
                      notes: nextNotes,
                      method: 'manual',
                    }
                  : a
              )
            );
          }
          const prevBatchResolve = alreadyInBatch.resolve;
          const batchResult = await new Promise<any>((resolve) => {
            alreadyInBatch.resolve = (r: any) => {
              prevBatchResolve?.(r);
              resolve(r);
            };
            void flushScanBatch();
          });
          if (!batchResult?.success) {
            soundEffects.playErrorBeep();
            return {
              success: false,
              error: batchResult?.error || 'Gagal menyimpan presensi ke Google Sheets.',
            };
          }
          soundEffects.playSuccessBeep();
          return {
            success: true,
            record:
              batchResult.record ||
              (optRec ? { ...optRec, status: nextStatus, notes: nextNotes, method: 'manual' } : undefined),
            student: targetStudent,
            session: targetSessionObj,
            syncedFromExisting: true,
          };
        }
        soundEffects.playErrorBeep();
        return {
          success: false,
          error: `Presensi ganda dalam antrean 3 detik untuk ${targetStudent.name} di sesi ${targetSessionObj?.name || ''}.`,
          isDuplicate: true,
          student: targetStudent,
        };
      }

      const activeLeave = leaveRequests.find(
        (l) =>
          l.student_id === targetStudent.nis &&
          l.status === 'approved' &&
          todayStr >= l.start_date &&
          todayStr <= l.end_date
      );
      if (activeLeave && !params.status) {
        soundEffects.playErrorBeep();
        return {
          success: false,
          error: `Siswa ${targetStudent.name} berstatus ${activeLeave.type.toUpperCase()} hari ini: ${activeLeave.reason}`,
          student: targetStudent,
        };
      }
    }

    const scanObj: OfflineAttendanceScan = {
      localId: `scan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ...params,
      sessionId: targetSessionId,
      manualOverride,
      queuedAt: new Date().toISOString(),
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const existing = readOfflineScans();
      const updated = [...existing, scanObj];
      writeOfflineScans(updated);
      setPendingOfflineScansCount(updated.length);
      soundEffects.playSuccessBeep();
      setSaveErrorState('Offline: scan disimpan di perangkat & dikirim otomatis saat online.');
      showToast('Offline: Presensi disimpan sementara di perangkat & akan dikirim otomatis saat online.', 'info');
      return {
        success: false,
        offlineQueued: true,
        error: 'Mode Offline: Scan disimpan di perangkat dan akan otomatis dikirim saat online.',
        student: targetStudent,
      };
    }

    // Jika siswa & sesi ditemukan di state lokal, tampilkan & sinkronkan optimistik permili detik (0ms),
    // sembari tetap menyimpan/mengumpulkan ke Apps Script di latar belakang!
    if (targetStudent && targetSessionObj) {
      let optStatus = (params.status || 'Hadir') as AttendanceRecord['status'];
      let optLateMinutes = 0;
      if (!params.status && targetSessionObj.on_time_limit) {
        const parts = String(targetSessionObj.on_time_limit).split(':');
        const limitMin = (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
        const curMin = serverNow.getHours() * 60 + serverNow.getMinutes();
        const diffMin = curMin - limitMin;
        if (diffMin > 0) {
          optLateMinutes = diffMin;
          optStatus = 'Terlambat';
        }
      }

      const nowIso = serverNow.toISOString();
      const optimisticRecord: AttendanceRecord = {
        id: `opt_${scanObj.localId}`,
        student_id: targetStudent.nis,
        session_id: targetSessionObj.id,
        date: todayStr,
        timestamp: nowIso,
        status: optStatus,
        late_minutes: optLateMinutes,
        method:
          (params.method as AttendanceRecord['method']) ||
          (String(params.code || '').startsWith('RFID-') ? 'rfid' : 'barcode'),
        device_id: 'kiosk_main',
        photo_id: '',
        notes: params.notes || '',
        version: 1,
        created_at: nowIso,
        updated_at: nowIso,
        diubah_pada: nowIso,
      };

      setAttendance((prev) => [optimisticRecord, ...prev]);
      soundEffects.playSuccessBeep();
      setSavingState();
      broadcastSyncEvent('DATA_OPTIMISTIC_ATTENDANCE', { record: optimisticRecord });

      if (isManual) {
        // Presensi manual WAJIB ditunggu konfirmasi penyimpanan Google Sheets-nya sebelum menyatakan sukses
        const manualTempId = optimisticRecord.id;
        let confirmedSavedRec: AttendanceRecord = optimisticRecord;
        const writeRes = await runWriteRequest({
          url: '/api/attendance',
          method: 'POST',
          body: {
            scans: [
              {
                studentId: targetStudent.nis,
                sessionId: targetSessionObj.id,
                status: optStatus,
                notes: params.notes || '',
                method: 'manual',
                manualOverride: true,
                upsert: true,
              },
            ],
          },
          silentToast: true,
          onSuccess: (data) => {
            const savedRec = data?.results?.[0]?.record;
            if (savedRec) {
              confirmedSavedRec = savedRec;
              setAttendance((prev) => [
                savedRec,
                ...prev.filter((p) => p.id !== manualTempId && p.id !== savedRec.id),
              ]);
            }
          },
        });
        if (!writeRes.ok) {
          setAttendance((prev) => prev.filter((p) => p.id !== manualTempId));
          soundEffects.playErrorBeep();
          return {
            success: false,
            error: writeRes.error || 'Gagal menyimpan presensi ke Google Sheets.',
            student: targetStudent,
            session: targetSessionObj,
          };
        }
        soundEffects.playSuccessBeep();
        return {
          success: true,
          record: confirmedSavedRec,
          student: targetStudent,
          session: targetSessionObj,
        };
      } else {
        scanBatchQueueRef.current.push({
          params: scanObj,
          optimisticId: optimisticRecord.id,
          targetStudent,
        });
        if (scanBatchTimerRef.current) {
          clearTimeout(scanBatchTimerRef.current);
        }
        scanBatchTimerRef.current = setTimeout(() => {
          void flushScanBatch();
        }, SCAN_IDLE_FLUSH_MS);
        if (!scanBatchMaxTimerRef.current) {
          scanBatchMaxTimerRef.current = setTimeout(() => {
            void flushScanBatch();
          }, SCAN_MAX_BATCH_WAIT_MS);
        }
      }

      return {
        success: true,
        record: optimisticRecord,
        student: targetStudent,
        session: targetSessionObj,
      };
    }

    // Fallback (kartu tidak ditemukan di state lokal): tunggu verifikasi server lewat batch
    return await new Promise<any>((resolve) => {
      setSavingState();
      scanBatchQueueRef.current.push({ params: scanObj, resolve });
      if (scanBatchTimerRef.current) {
        clearTimeout(scanBatchTimerRef.current);
      }
      scanBatchTimerRef.current = setTimeout(() => {
        void flushScanBatch();
      }, SCAN_IDLE_FLUSH_MS);
      if (!scanBatchMaxTimerRef.current) {
        scanBatchMaxTimerRef.current = setTimeout(() => {
          void flushScanBatch();
        }, SCAN_MAX_BATCH_WAIT_MS);
      }
    });
  };

  const updateAttendance = async (
    id: string,
    updates: Partial<AttendanceRecord>,
    reason: string,
    options?: { enforceSessionWindow?: boolean; silentToast?: boolean }
  ) => {
    const existing = attendance.find((a) => a.id === id);
    const res = await runWriteRequest({
      url: '/api/attendance',
      method: 'PUT',
      entityKey: `att_${id}`,
      body: {
        id,
        updates,
        reason,
        enforceSessionWindow: Boolean(options?.enforceSessionWindow),
        expected_updated_at: existing?.diubah_pada || existing?.updated_at,
      },
      conflictTitle: 'Konflik Edit Presensi',
      applyOptimistic: existing
        ? () => {
            const snapshot = attendance;
            setAttendance((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
            return () => setAttendance(snapshot);
          }
        : undefined,
      successMessage: 'Tersimpan',
      silentToast: options?.silentToast,
    });
    return res.ok;
  };

  const deleteAttendance = async (id: string, reason: string) => {
    const confirmed = await requestConfirm({
      title: 'Hapus Catatan Presensi?',
      message: `Catatan presensi akan ditandai dihapus (soft delete) di Google Sheets dan dicatat di Log. Alasan: ${reason || 'Koreksi data'}.`,
      confirmLabel: 'Ya, Hapus Presensi',
    });
    if (!confirmed) return false;

    const res = await runWriteRequest({
      url: '/api/attendance',
      method: 'DELETE',
      body: { id, reason },
      applyOptimistic: () => {
        const snapshot = attendance;
        setAttendance((prev) => prev.filter((a) => a.id !== id));
        return () => setAttendance(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const startOutOfClass = async (
    studentId: string,
    type: 'BAK' | 'BAB' | 'Keperluan Lain',
    durationMinutes: number
  ) => {
    const targetStudent = students.find((s) => s.nis === studentId);
    if (!targetStudent) {
      soundEffects.playErrorBeep();
      return { success: false, error: 'Siswa tidak ditemukan.' };
    }

    const normClassId = (v?: string) => String(v || '').trim().toLowerCase();
    const targetClassNorm = normClassId(targetStudent.class_id);

    const activeList = outOfClass.filter((r) => r.status === 'active' || r.status === 'overdue');
    if (activeList.some((r) => r.student_id === studentId)) {
      soundEffects.playErrorBeep();
      return { success: false, error: 'Siswa ini sedang memiliki izin keluar yang masih aktif.' };
    }

    const cls = classes.find(
      (c) => normClassId(c.id) === targetClassNorm || normClassId(c.name) === targetClassNorm
    );
    const maxPerClass = Math.max(1, Number((cls && cls.quota_limit) || settings.out_of_class_max_per_class || 2));
    const classActiveCount = activeList.filter((r) => normClassId(r.class_id) === targetClassNorm).length;
    if (classActiveCount >= maxPerClass) {
      soundEffects.playErrorBeep();
      return {
        success: false,
        error: `Kuota izin keluar untuk kelas ${targetStudent.class_id} penuh (${classActiveCount}/${maxPerClass} siswa sedang di luar).`,
      };
    }

    const now = getServerNow();
    const toLocalYmd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayLocal = toLocalYmd(now);
    const dailyCount = outOfClass.filter((r) => {
      if (r.student_id !== studentId) return false;
      if (!r.started_at) return false;
      const parsed = new Date(r.started_at);
      if (!Number.isNaN(parsed.getTime())) {
        return toLocalYmd(parsed) === todayLocal;
      }
      return String(r.started_at).startsWith(todayLocal);
    }).length;
    const maxDaily = settings.out_of_class_max_per_student_daily || 3;
    if (dailyCount >= maxDaily) {
      soundEffects.playErrorBeep();
      return {
        success: false,
        error: `Batas harian izin keluar siswa (${maxDaily}x/hari) telah tercapai.`,
      };
    }

    const nowIso = now.toISOString();
    const dueIso = new Date(now.getTime() + durationMinutes * 60000).toISOString();
    const optimisticRecord: OutOfClassRecord = {
      id: `opt_ooc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      student_id: targetStudent.nis,
      class_id: targetStudent.class_id,
      type,
      duration_minutes: durationMinutes,
      started_at: nowIso,
      due_at: dueIso,
      late_return_minutes: 0,
      status: 'active',
      idempotency_key: `ooc_${Date.now()}_${Math.random()}`,
      version: 1,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const res = await runWriteRequest({
      url: '/api/out-of-class',
      method: 'POST',
      body: {
        studentId,
        type,
        durationMinutes,
        idempotencyKey: optimisticRecord.idempotency_key,
      },
      applyOptimistic: () => {
        setOutOfClass((prev) => [optimisticRecord, ...prev]);
        return () => setOutOfClass((prev) => prev.filter((o) => o.id !== optimisticRecord.id));
      },
      onOptimisticBroadcast: () => {
        broadcastSyncEvent('DATA_OPTIMISTIC_OUT_OF_CLASS', { record: optimisticRecord });
      },
      optimisticData: { record: optimisticRecord, student: targetStudent },
      silentToast: true,
    });
    if (!res.ok) {
      soundEffects.playErrorBeep();
      return { success: false, error: res.error };
    }
    soundEffects.playSuccessBeep();
    return {
      success: true,
      record: res.data?.record || optimisticRecord,
      student: res.data?.student || targetStudent,
    };
  };

  const confirmOutOfClassReturn = async (
    id: string,
    returnMethod: 'click' | 'manual' = 'click',
    notes?: string,
    auditReason?: string
  ) => {
    if (id.startsWith('opt_')) {
      return {
        success: false,
        error: 'Data izin masih dalam proses sinkronisasi ke server, silakan klik ulang sesaat lagi.',
      };
    }

    const existing = outOfClass.find((o) => o.id === id);
    const nowRet = getServerNow();
    const nowRetIso = nowRet.toISOString();
    const actualMinutes = existing
      ? Math.max(1, Math.round((nowRet.getTime() - new Date(existing.started_at).getTime()) / 60000))
      : 1;
    const lateReturnMinutes = existing
      ? Math.max(0, Math.round((nowRet.getTime() - new Date(existing.due_at).getTime()) / 60000))
      : 0;
    const optimisticUpdatedRecord: OutOfClassRecord | undefined = existing
      ? {
          ...existing,
          status: 'returned',
          returned_at: nowRetIso,
          actual_minutes: actualMinutes,
          late_return_minutes: lateReturnMinutes,
          return_method: returnMethod,
          return_notes: notes,
          updated_at: nowRetIso,
          diubah_pada: nowRetIso,
        }
      : undefined;

    const res = await runWriteRequest({
      url: '/api/out-of-class',
      method: 'PUT',
      entityKey: `ooc_${id}`,
      body: {
        id,
        returnMethod,
        notes,
        auditReason,
        expected_updated_at: existing?.diubah_pada || existing?.updated_at,
      },
      conflictTitle: 'Konflik Konfirmasi Kepulangan',
      applyOptimistic: existing
        ? () => {
            const previousRecord = existing;
            setOutOfClass((prev) =>
              prev.map((o) => (o.id === id && optimisticUpdatedRecord ? optimisticUpdatedRecord : o))
            );
            return () =>
              setOutOfClass((prev) => prev.map((o) => (o.id === id ? previousRecord : o)));
          }
        : undefined,
      optimisticData: { record: optimisticUpdatedRecord },
      silentToast: true,
    });
    if (!res.ok) {
      soundEffects.playErrorBeep();
      return { success: false, error: res.error };
    }
    soundEffects.playSuccessBeep();
    return { success: true, record: res.data?.record || optimisticUpdatedRecord };
  };

  const recordViolation = async (params: {
    studentId: string;
    violationTypeId: string;
    customPoints?: number;
    notes?: string;
    location?: string;
    evidenceBase64?: string;
    evidenceFileName?: string;
  }) => {
    const targetStudent = students.find((s) => s.nis === params.studentId);
    if (!targetStudent) {
      soundEffects.playErrorBeep();
      return { success: false, error: 'Siswa tidak ditemukan.' };
    }
    const vt = violationTypes.find((t) => t.id === params.violationTypeId);
    if (!vt) {
      soundEffects.playErrorBeep();
      return { success: false, error: 'Jenis pelanggaran tidak valid.' };
    }

    const nowIso = getServerNow().toISOString();
    const pts = params.customPoints !== undefined ? Number(params.customPoints) : vt.default_points;
    const optimisticViolation: ViolationRecord = {
      id: `opt_vio_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      student_id: targetStudent.nis,
      class_id: targetStudent.class_id,
      violation_type_id: vt.id,
      type_name: vt.name,
      category: vt.category,
      points: pts,
      notes: params.notes || '',
      location: params.location || '',
      evidence_photo_url: params.evidenceBase64 || '',
      recorded_by: sessionRef.current?.name || 'Petugas',
      recorded_at: nowIso,
      version: 1,
      created_at: nowIso,
      updated_at: nowIso,
      diubah_pada: nowIso,
    };

    const studentTotalPoints = [optimisticViolation, ...violations]
      .filter((v) => v.student_id === targetStudent.nis)
      .reduce((acc, cur) => acc + (cur.category === 'prestasi' ? -cur.points : cur.points), 0);

    const res = await runWriteRequest({
      url: '/api/violations',
      method: 'POST',
      body: params,
      applyOptimistic: () => {
        const snapshot = violations;
        setViolations((prev) => [optimisticViolation, ...prev]);
        return () => setViolations(snapshot);
      },
      onOptimisticBroadcast: () => {
        broadcastSyncEvent('DATA_OPTIMISTIC_VIOLATION', { violation: optimisticViolation });
      },
      onSuccess: (data) => {
        if (data?.violation) {
          setViolations((prev) => [
            data.violation,
            ...prev.filter((p) => p.id !== optimisticViolation.id && p.id !== data.violation.id),
          ]);
        }
      },
      optimisticData: { violation: optimisticViolation, studentTotalPoints },
      silentToast: true,
    });
    if (!res.ok) {
      soundEffects.playErrorBeep();
      return { success: false, error: res.error };
    }
    soundEffects.playSuccessBeep();
    return {
      success: true,
      violation: res.data?.violation || optimisticViolation,
      studentTotalPoints: res.data?.studentTotalPoints ?? studentTotalPoints,
    };
  };

  const deleteViolation = async (id: string, reason: string) => {
    const confirmed = await requestConfirm({
      title: 'Hapus Catatan Pelanggaran?',
      message: 'Catatan pelanggaran/prestasi ini akan ditandai dihapus (soft delete) di Google Sheets dan dicatat di lembar Log.',
      confirmLabel: 'Ya, Hapus Catatan',
    });
    if (!confirmed) return false;

    const res = await runWriteRequest({
      url: '/api/violations',
      method: 'DELETE',
      body: { id, reason },
      applyOptimistic: () => {
        const snapshot = violations;
        setViolations((prev) => prev.filter((v) => v.id !== id));
        return () => setViolations(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const saveStudent = async (student: Student & { photoBase64?: string }) => {
    const existing = students.find((s) => s.nis === student.nis);
    const res = await runWriteRequest({
      url: '/api/students',
      method: 'POST',
      entityKey: `stu_${student.nis}`,
      body: {
        ...student,
        expected_updated_at: existing?.diubah_pada || existing?.updated_at,
      },
      conflictTitle: `Konflik Edit Siswa (${student.name})`,
      applyOptimistic: () => {
        const snapshot = students;
        setStudents((prev) =>
          existing
            ? prev.map((s) => (s.nis === student.nis ? { ...s, ...student } : s))
            : [student, ...prev]
        );
        return () => setStudents(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const deleteStudent = async (nis: string) => {
    const target = students.find((s) => s.nis === nis);
    const confirmed = await requestConfirm({
      title: 'Hapus Data Siswa?',
      message: `Yakin ingin menandai hapus data siswa "${target?.name || nis}" (NIS: ${nis}) di Google Sheets?`,
      confirmLabel: 'Ya, Hapus Siswa',
    });
    if (!confirmed) return false;

    const res = await runWriteRequest({
      url: '/api/students',
      method: 'DELETE',
      body: { nis },
      applyOptimistic: () => {
        const snapshot = students;
        setStudents((prev) => prev.filter((s) => s.nis !== nis));
        return () => setStudents(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const deleteStudents = async (nisses: string[]) => {
    const confirmed = await requestConfirm({
      title: `Hapus ${nisses.length} Siswa Terpilih?`,
      message: `Sebanyak ${nisses.length} data siswa yang dipilih akan ditandai dihapus (soft delete) di Google Sheets.`,
      confirmLabel: `Ya, Hapus ${nisses.length} Siswa`,
    });
    if (!confirmed) return false;

    const nisSet = new Set(nisses);
    const res = await runWriteRequest({
      url: '/api/students',
      method: 'DELETE',
      body: { nisses },
      applyOptimistic: () => {
        const snapshot = students;
        setStudents((prev) => prev.filter((s) => !nisSet.has(s.nis)));
        return () => setStudents(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const clearAllStudents = async () => {
    const res = await runWriteRequest({
      url: '/api/students',
      method: 'DELETE',
      body: { action: 'clear_all' },
      applyOptimistic: () => {
        const snapshot = students;
        setStudents([]);
        return () => setStudents(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const batchImportStudents = async (newStudents: Student[]) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineMsg = 'Tidak ada koneksi internet. Impor massal memerlukan koneksi ke server.';
      setSaveErrorState(offlineMsg);
      showToast(offlineMsg, 'error');
      return { success: false, added: 0, updated: 0, classesCreated: 0, error: offlineMsg };
    }

    if (!Array.isArray(newStudents) || newStudents.length === 0) {
      return { success: false, added: 0, updated: 0, classesCreated: 0, error: 'Tidak ada data siswa untuk diimpor.' };
    }

    // Optimistic class & student computation (<1ms)
    const prevStudentsSnapshot = students;
    const prevClassesSnapshot = classes;
    const nowBatch = getServerNow().toISOString();

    const activeClsMap = new Map<string, string>();
    classes.forEach((c) => {
      if (c.id) activeClsMap.set(String(c.id).trim().toLowerCase(), String(c.id).trim());
    });
    const newClassesList: SchoolClass[] = [];
    newStudents.forEach((s) => {
      const cid = String(s.class_id || '').trim();
      if (!cid) return;
      const norm = cid.toLowerCase();
      if (!activeClsMap.has(norm)) {
        const gMatch = cid.match(/^(10|11|12)/i) || cid.match(/^(X|XI|XII)\b/i);
        let grade = '10';
        if (gMatch) {
          const gUp = String(gMatch[1]).toUpperCase();
          grade = gUp === 'X' ? '10' : gUp === 'XI' ? '11' : gUp === 'XII' ? '12' : gUp;
        }
        const majorParts = cid.split('-');
        const major = majorParts.length > 1 ? String(majorParts[1]).trim() : 'Umum';
        const clsRec: SchoolClass = {
          id: cid,
          name: cid,
          grade,
          major: major || 'Umum',
          homeroom_teacher_name: `Wali Kelas ${cid}`,
          homeroom_teacher_email: `${cid.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sekolah.sch.id`,
          quota_limit: 2,
          created_at: nowBatch,
          updated_at: nowBatch,
        };
        activeClsMap.set(norm, cid);
        newClassesList.push(clsRec);
      }
    });

    const studentMap = new Map<string, Student>();
    students.forEach((s) => studentMap.set(s.nis, s));
    let expectedAdded = 0;
    let expectedUpdated = 0;

    newStudents.forEach((s) => {
      if (!s.nis || !s.name || !s.class_id) return;
      const nis = String(s.nis).trim();
      const resolvedClass = activeClsMap.get(String(s.class_id).trim().toLowerCase()) || String(s.class_id).trim();
      const ex = studentMap.get(nis);
      const merged: Student = {
        ...s,
        nis,
        class_id: resolvedClass,
        photo_url: String(s.photo_url || '').trim() || ex?.photo_url || '',
        created_at: ex?.created_at || s.created_at || nowBatch,
        updated_at: nowBatch,
      };
      if (ex) expectedUpdated++;
      else expectedAdded++;
      studentMap.set(nis, merged);
    });

    if (newClassesList.length > 0) {
      setClasses([...classes, ...newClassesList]);
    }
    setStudents(Array.from(studentMap.values()));

    setSavingState();
    latestMutationSeqRef.current += 1;
    pendingWriteCountRef.current += 1;

    const queuedImportPromise = writeQueueRef.current
      .catch(() => {})
      .then(async (): Promise<{
        success: boolean;
        added: number;
        updated: number;
        classesCreated: number;
        error?: string;
      }> => {
        const CHUNK_SIZE = 250;
        let lastSnapshot: any = null;
        let lastServerTime: string | undefined;
        let lastRev: string | undefined;
        let lastSeq: number | undefined;
        let actualAdded = 0;
        let actualUpdated = 0;
        let actualClassesCreated = 0;

        try {
          for (let i = 0; i < newStudents.length; i += CHUNK_SIZE) {
            const chunk = newStudents.slice(i, i + CHUNK_SIZE);
            const skipSnapshot = i + CHUNK_SIZE < newStudents.length;

            const sentChunkTok = sessionRef.current?.token;
            const sendChunk = async (tokOverride?: string) => {
              const res = await apiFetch('/api/students?action=batch_import', {
                method: 'POST',
                headers: buildApiHeaders({ 'Content-Type': 'application/json' }, tokOverride),
                body: JSON.stringify({ students: chunk, skipSnapshot }),
              });
              const data = await res.json().catch(() => ({}));
              return { res, data };
            };

            let { res, data } = await sendChunk(sentChunkTok);
            if (handleAppsScriptUnauthorized(res.status, data)) {
              setStudents(prevStudentsSnapshot);
              setClasses(prevClassesSnapshot);
              const msg = data.error || 'Token rahasia Apps Script ditolak.';
              setSaveErrorState(msg);
              return { success: false, added: 0, updated: 0, classesCreated: 0, error: msg };
            }

            if (res.status === 401 && sessionRef.current?.token) {
              const refreshedTok = await refreshAuthSessionIfNeeded(true, sentChunkTok);
              if (refreshedTok) {
                const retried = await sendChunk(refreshedTok);
                res = retried.res;
                data = retried.data;
              }
            }

            if (!res.ok || data?.success === false) {
              setStudents(prevStudentsSnapshot);
              setClasses(prevClassesSnapshot);
              soundEffects.playErrorBeep();
              const errMsg = data?.error || `Gagal mengimpor data siswa (HTTP ${res.status}).`;
              setSaveErrorState(errMsg);
              showToast(errMsg, 'error');
              return { success: false, added: 0, updated: 0, classesCreated: 0, error: errMsg };
            }

            actualAdded += Number(data.inserted || 0);
            actualUpdated += Number(data.updated || 0);
            actualClassesCreated += Number(data.classesCreated || 0);
            if (data.snapshot) lastSnapshot = data.snapshot;
            if (data.serverTime) lastServerTime = data.serverTime;
            if (data.rev) lastRev = String(data.rev);
            if (typeof data.seq === 'number' && data.seq > 0) lastSeq = data.seq;
          }

          if (pendingWriteCountRef.current <= 1) {
            if (lastSnapshot) {
              applyDatabaseSnapshot(lastSnapshot, lastServerTime, lastRev, lastSeq);
              broadcastSyncEvent('DATA_SNAPSHOT', {
                snapshot: lastSnapshot,
                serverTime: lastServerTime,
                rev: lastRev,
                seq: lastSeq,
              });
            } else {
              await refreshFromSheets(true, { afterWrite: true, forceFull: true });
              broadcastSyncEvent('DATA_MUTATED');
            }
            setSavedState('Tersimpan');
          }

          return {
            success: true,
            added: actualAdded || expectedAdded,
            updated: actualUpdated || expectedUpdated,
            classesCreated: actualClassesCreated || newClassesList.length,
          };
        } catch (err: any) {
          setStudents(prevStudentsSnapshot);
          setClasses(prevClassesSnapshot);
          soundEffects.playErrorBeep();
          const errMsg = err?.message || 'Gagal menghubungi server saat impor data siswa.';
          setSaveErrorState(errMsg);
          showToast(errMsg, 'error');
          return { success: false, added: 0, updated: 0, classesCreated: 0, error: errMsg };
        }
      });

    writeQueueRef.current = queuedImportPromise.then(
      () => {},
      () => {}
    );

    try {
      return await queuedImportPromise;
    } finally {
      pendingWriteCountRef.current = Math.max(0, pendingWriteCountRef.current - 1);
      if (pendingWriteCountRef.current === 0 && pendingRefreshAfterWriteRef.current) {
        pendingRefreshAfterWriteRef.current = false;
        void refreshFromSheets(true);
      }
    }
  };

  const saveClass = async (cls: SchoolClass) => {
    const existing = classes.find((c) => c.id === cls.id);
    const res = await runWriteRequest({
      url: '/api/classes',
      method: 'POST',
      entityKey: `cls_${cls.id}`,
      body: {
        ...cls,
        expected_updated_at: existing?.diubah_pada || existing?.updated_at,
      },
      conflictTitle: `Konflik Edit Kelas (${cls.name})`,
      applyOptimistic: () => {
        const snapshot = classes;
        setClasses((prev) =>
          existing ? prev.map((c) => (c.id === cls.id ? { ...c, ...cls } : c)) : [cls, ...prev]
        );
        return () => setClasses(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const deleteClass = async (id: string) => {
    const target = classes.find((c) => c.id === id);
    const confirmed = await requestConfirm({
      title: 'Hapus Data Kelas?',
      message: `Kelas "${target?.name || id}" akan ditandai dihapus (soft delete) di Google Sheets.`,
      confirmLabel: 'Ya, Hapus Kelas',
    });
    if (!confirmed) return false;

    const res = await runWriteRequest({
      url: '/api/classes',
      method: 'DELETE',
      body: { id },
      applyOptimistic: () => {
        const snapshot = classes;
        setClasses((prev) => prev.filter((c) => c.id !== id));
        return () => setClasses(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const saveSession = async (sess: AttendanceSession) => {
    const existing = sessions.find((s) => s.id === sess.id);
    const res = await runWriteRequest({
      url: '/api/sessions',
      method: 'POST',
      entityKey: `sess_${sess.id}`,
      body: {
        ...sess,
        expected_updated_at: existing?.diubah_pada || existing?.updated_at,
      },
      conflictTitle: `Konflik Edit Sesi (${sess.name})`,
      applyOptimistic: () => {
        const snapshot = sessions;
        setSessions((prev) =>
          existing ? prev.map((s) => (s.id === sess.id ? { ...s, ...sess } : s)) : [sess, ...prev]
        );
        return () => setSessions(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const deleteSession = async (id: string) => {
    const target = sessions.find((s) => s.id === id);
    const confirmed = await requestConfirm({
      title: 'Hapus Sesi Presensi?',
      message: `Sesi "${target?.name || id}" akan ditandai dihapus (soft delete) di Google Sheets.`,
      confirmLabel: 'Ya, Hapus Sesi',
    });
    if (!confirmed) return false;

    const res = await runWriteRequest({
      url: '/api/sessions',
      method: 'DELETE',
      body: { id },
      applyOptimistic: () => {
        const snapshot = sessions;
        setSessions((prev) => prev.filter((s) => s.id !== id));
        return () => setSessions(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const saveViolationType = async (vt: ViolationType) => {
    const existing = violationTypes.find((v) => v.id === vt.id);
    const res = await runWriteRequest({
      url: '/api/violation-types',
      method: 'POST',
      entityKey: `vt_${vt.id}`,
      body: {
        ...vt,
        expected_updated_at: existing?.diubah_pada || existing?.updated_at,
      },
      conflictTitle: `Konflik Edit Jenis Pelanggaran (${vt.name})`,
      applyOptimistic: () => {
        const snapshot = violationTypes;
        setViolationTypes((prev) =>
          existing ? prev.map((v) => (v.id === vt.id ? { ...v, ...vt } : v)) : [vt, ...prev]
        );
        return () => setViolationTypes(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const deleteViolationType = async (id: string) => {
    const target = violationTypes.find((v) => v.id === id);
    const confirmed = await requestConfirm({
      title: 'Hapus Jenis Pelanggaran?',
      message: `Jenis pelanggaran "${target?.name || id}" akan ditandai dihapus (soft delete) di Google Sheets.`,
      confirmLabel: 'Ya, Hapus Jenis Pelanggaran',
    });
    if (!confirmed) return false;

    const res = await runWriteRequest({
      url: '/api/violation-types',
      method: 'DELETE',
      body: { id },
      applyOptimistic: () => {
        const snapshot = violationTypes;
        setViolationTypes((prev) => prev.filter((v) => v.id !== id));
        return () => setViolationTypes(snapshot);
      },
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings> & { logoBase64?: string }, options?: { silent?: boolean }) => {
      const res = await runWriteRequest({
        url: '/api/settings',
        method: 'POST',
        entityKey: 'app_settings',
        body: updates,
        applyOptimistic: () => {
          const snapshot = settingsRef.current;
          setSettings((prev) => ({ ...prev, ...updates }));
          return () => setSettings(snapshot);
        },
        successMessage: 'Tersimpan',
        silentToast: options?.silent,
      });
      return res.ok;
    },
    [runWriteRequest]
  );

  const updateNotificationSettings = useCallback(
    async (updates: Partial<NotificationSettings>, options?: { silent?: boolean }) => {
      const res = await runWriteRequest({
        url: '/api/notifications',
        method: 'POST',
        entityKey: 'notification_settings',
        body: updates,
        applyOptimistic: () => {
          const snapshot = notificationSettingsRef.current;
          setNotificationSettings((prev) => ({ ...prev, ...updates }));
          return () => setNotificationSettings(snapshot);
        },
        successMessage: 'Tersimpan',
        silentToast: options?.silent,
      });
      return res.ok;
    },
    [runWriteRequest]
  );

  const sendTestEmail = async (email: string) => {
    const confirmed = await requestConfirm({
      title: 'Kirim Email Uji Coba?',
      message: `Aplikasi akan mengirim email uji coba ke "${email}" menggunakan pengirim Google yang terhubung.`,
      confirmLabel: 'Kirim Email Uji Coba',
      variant: 'warning',
    });
    if (!confirmed) {
      return { success: false, cancelled: true, message: 'Pengiriman email uji coba dibatalkan.' };
    }

    try {
      const executeTestEmail = async (tokOverride?: string) => {
        const res = await apiFetch('/api/notifications?action=test_email', {
          method: 'POST',
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }, tokOverride),
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };

      let { res, data } = await executeTestEmail();
      if (handleAppsScriptUnauthorized(res.status, data)) {
        return { success: false, message: data.error || 'Token rahasia Apps Script ditolak.' };
      }
      if (res.status === 401 && sessionRef.current?.token) {
        const refreshedTok = await refreshAuthSessionIfNeeded(true);
        if (refreshedTok) {
          const retried = await executeTestEmail(refreshedTok);
          res = retried.res;
          data = retried.data;
        }
      }
      return { success: Boolean(res.ok && data.success), message: data.message || data.error || 'Selesai' };
    } catch {
      return { success: false, message: 'Gagal menghubungi server email.' };
    }
  };

  const sendWeeklyRecap = async (classId?: string) => {
    const targetLabel = classId
      ? `wali kelas ${classId}`
      : 'seluruh wali kelas yang memiliki alamat email';
    const confirmed = await requestConfirm({
      title: 'Kirim Rekap Mingguan Sekarang?',
      message: `Aplikasi akan mengirim email laporan rekap presensi mingguan ke ${targetLabel}.`,
      confirmLabel: 'Ya, Kirim Rekap',
      variant: 'warning',
    });
    if (!confirmed) {
      return { success: false, cancelled: true, message: 'Pengiriman rekap mingguan dibatalkan.' };
    }

    try {
      const executeWeeklyRecap = async (tokOverride?: string) => {
        const res = await apiFetch('/api/notifications?action=send_weekly_recap', {
          method: 'POST',
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }, tokOverride),
          body: JSON.stringify({ classId }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };

      let { res, data } = await executeWeeklyRecap();
      if (handleAppsScriptUnauthorized(res.status, data)) {
        return { success: false, message: data.error || 'Token rahasia Apps Script ditolak.' };
      }
      if (res.status === 401 && sessionRef.current?.token) {
        const refreshedTok = await refreshAuthSessionIfNeeded(true);
        if (refreshedTok) {
          const retried = await executeWeeklyRecap(refreshedTok);
          res = retried.res;
          data = retried.data;
        }
      }
      if (!res.ok) {
        return { success: false, message: data.error || `Gagal mengirim rekap mingguan (HTTP ${res.status}).` };
      }
      refreshFromSheets(true);
      if (classId) {
        return {
          success: Boolean(data.sent),
          sent: data.sent,
          recipient: data.recipient,
          message: data.sent
            ? `Rekap mingguan terkirim ke ${data.recipient}`
            : data.reason || 'Gagal mengirim rekap',
        };
      }
      return {
        success: res.ok,
        results: data.results,
        message: `Terkirim: ${data.sent || 0}, Dilewati: ${data.skipped || 0}, Gagal: ${data.failed || 0}`,
      };
    } catch {
      return { success: false, message: 'Gagal mengirim rekap mingguan.' };
    }
  };

  const approveLeaveRequest = async (id: string, status: 'approved' | 'rejected', rejectionReason?: string) => {
    const existing = leaveRequests.find((l) => l.id === id);
    const res = await runWriteRequest({
      url: '/api/leave-requests',
      method: 'PUT',
      entityKey: `lr_${id}`,
      body: {
        id,
        status,
        rejectionReason,
        expected_updated_at: existing?.diubah_pada || existing?.updated_at,
      },
      conflictTitle: 'Konflik Persetujuan Izin',
      applyOptimistic: existing
        ? () => {
            const snapshot = leaveRequests;
            setLeaveRequests((prev) =>
              prev.map((l) =>
                l.id === id ? { ...l, status, rejection_reason: rejectionReason } : l
              )
            );
            return () => setLeaveRequests(snapshot);
          }
        : undefined,
      successMessage: 'Tersimpan',
    });
    return res.ok;
  };

  return (
    <AppContext.Provider
      value={{
        session,
        activeTab,
        setActiveTab,
        syncStatus,
        saveStatus,
        isInitialLoading,
        initialLoadError,
        configError,
        missingEnv,
        envStatus,
        appsScriptUrl,
        appsScriptSecretConfigured,
        isAppsScriptLocked,
        isConnectingAppsScript,
        connectAppsScript,
        disconnectAppsScript,
        runSystemCheck,
        confirmDialog,
        requestConfirm,
        conflictPrompt,
        dismissConflictPrompt,
        lastSyncTime,
        currentServerTime,
        activeSession,
        sessionSchedule,
        lastSessionTransition,
        dismissSessionTransition,
        setManualSessionOverride,
        isKioskFullscreen,
        toggleKioskFullscreen,
        pendingOfflineScansCount,
        settings,
        classes,
        sessions,
        students,
        violationTypes,
        attendance,
        outOfClass,
        violations,
        leaveRequests,
        notificationSettings,
        notificationLogs,
        auditLogs,
        loginDuty,
        unlockHomeroom,
        unlockStudentAffairs,
        unlockAdmin,
        lockCurrentMenu,
        logout,
        updateSessionToken,
        refreshAuthSession: refreshAuthSessionIfNeeded,
        refreshFromSheets,
        recordAttendance,
        updateAttendance,
        deleteAttendance,
        startOutOfClass,
        confirmOutOfClassReturn,
        recordViolation,
        deleteViolation,
        saveStudent,
        deleteStudent,
        deleteStudents,
        clearAllStudents,
        batchImportStudents,
        saveClass,
        deleteClass,
        saveSession,
        deleteSession,
        saveViolationType,
        deleteViolationType,
        updateSettings,
        updateNotificationSettings,
        sendTestEmail,
        sendWeeklyRecap,
        approveLeaveRequest,
        toasts,
        showToast,
        dismissToast,
        speak,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return ctx;
};
