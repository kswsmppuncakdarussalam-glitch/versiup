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
import { resolveSessionSchedule, SessionScheduleState } from '../utils/sessionHelper.js';
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
  photoBase64?: string;
  photoFileName?: string;
  queuedAt: string;
}

const OFFLINE_SCANS_KEY = 'dkb_offline_attendance_scans';
const SYNC_BROADCAST_CHANNEL = 'dkb_sync_channel';
const REALTIME_SYNC_COOLDOWN_MS = 350;
const FULL_RECONCILE_INTERVAL_MS = 15000;
const SCAN_BATCH_WINDOW_MS = 3000;

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
  refreshAuthSession: (forceLogoutOn401?: boolean) => Promise<string | null>;
  refreshFromSheets: (
    silent?: boolean,
    options?: { afterWrite?: boolean }
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
    offlineQueued?: boolean;
  }>;
  updateAttendance: (id: string, updates: Partial<AttendanceRecord>, reason: string) => Promise<boolean>;
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

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const saved = localStorage.getItem('dkb_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTabState] = useState<ActiveTab>(() => {
    try {
      const savedTab = localStorage.getItem('dkb_active_tab') as ActiveTab | null;
      const savedSessionRaw = localStorage.getItem('dkb_session');
      const savedSession: AuthSession | null = savedSessionRaw ? JSON.parse(savedSessionRaw) : null;
      if (
        savedTab &&
        savedTab !== 'system_check' &&
        ['dashboard', 'attendance', 'out_of_class', 'violations', 'homeroom', 'student_affairs', 'admin'].includes(savedTab)
      ) {
        if (['homeroom', 'student_affairs', 'admin'].includes(savedTab) && savedSession?.lockedMenuRole !== savedTab) {
          return 'attendance';
        }
        return savedTab;
      }
    } catch {}
    return 'attendance';
  });

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

  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [missingEnv, setMissingEnv] = useState<string[]>(() => getMissingClientConfig());
  const [envStatus, setEnvStatus] = useState<EnvConfigStatus>({
    configured: false,
    sheetsConfigured: false,
    driveConfigured: false,
    spreadsheetConfigured: false,
    driveFolderConfigured: false,
    authMode: 'unconfigured',
    emailConnected: false,
    emailTransport: 'unconfigured',
    senderEmail: '',
    missingEnv: getMissingClientConfig(),
  });
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

  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
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

  // Domain States (Read directly from Google Sheets)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [violationTypes, setViolationTypes] = useState<ViolationType[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [outOfClass, setOutOfClass] = useState<OutOfClassRecord[]>([]);
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(defaultNotificationSettings);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const isFetchingRef = useRef<boolean>(false);
  const latestMutationSeqRef = useRef<number>(0);
  const pendingRefreshAfterWriteRef = useRef<boolean>(false);
  const hasHydratedConfigRef = useRef<boolean>(false);
  const lastKnownRevRef = useRef<string>('');
  const lastFullSyncAtRef = useRef<number>(0);
  const consecutiveSyncErrorsRef = useRef<number>(0);
  const inFlightOptimisticIdsRef = useRef<Set<string>>(new Set());
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionRef = useRef<AuthSession | null>(session);
  sessionRef.current = session;
  const tokenRefreshPromiseRef = useRef<Promise<string | null> | null>(null);

  const broadcastSyncEvent = useCallback(
    (
      type:
        | 'DATA_MUTATED'
        | 'DATA_SNAPSHOT'
        | 'DATA_OPTIMISTIC_ATTENDANCE'
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

  // 3-second batch scan collector for consecutive scans
  interface BatchItem {
    params: OfflineAttendanceScan;
    optimisticId?: string;
    targetStudent?: Student;
    resolve?: (res: any) => void;
  }
  const scanBatchQueueRef = useRef<BatchItem[]>([]);
  const scanBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const appToken = overrideAppToken ?? session?.token ?? sessionRef.current?.token ?? '';
      return {
        ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
        ...(extra || {}),
      };
    },
    [session?.token]
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
        showToast(msg, 'error');
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

  const applyDatabaseSnapshot = useCallback((d: any, serverTime?: string, rev?: string) => {
    if (serverTime) {
      setServerClockOffset(serverTime);
      setCurrentServerTime(getServerNow());
    }
    if (rev) {
      lastKnownRevRef.current = String(rev);
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
  }, []);

  const clearExpiredAppSession = useCallback(
    (message = 'Sesi login telah berakhir atau sandi diubah. Silakan masuk kembali.') => {
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
    async (forceLogoutOn401 = false): Promise<string | null> => {
      const currentSess = sessionRef.current;
      if (!currentSess?.token) return null;

      if (tokenRefreshPromiseRef.current) {
        return tokenRefreshPromiseRef.current;
      }

      const promise = (async () => {
        try {
          const res = await apiFetch('/api/auth?action=refresh_session', {
            method: 'POST',
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, currentSess.token),
            body: JSON.stringify({}),
          });
          const data = await res.json().catch(() => ({}));

          if (res.ok && data?.token) {
            const payload = decodeJwtPayload(data.token);
            const updated: AuthSession = {
              ...currentSess,
              token: data.token,
              userId: payload.userId || currentSess.userId,
              role: payload.role || currentSess.role,
              name: payload.name || currentSess.name,
              label: payload.label || currentSess.label,
              tokenVersion: payload.tokenVersion ?? currentSess.tokenVersion,
              lockedMenuClassId:
                payload.lockedMenuClassId !== undefined
                  ? payload.lockedMenuClassId
                  : currentSess.lockedMenuClassId,
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
            (forceLogoutOn401 || data?.sessionInvalidated)
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
        } else {
          const curUrl = getAppsScriptUrl();
          if (curUrl) setAppsScriptUrlState(curUrl);
          setAppsScriptSecretConfigured(hasAppsScriptSecretToken());
          setIsAppsScriptLockedState(isAppsScriptConfigLocked());
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
        const needsFullReconcile =
          Boolean(options?.forceFull) ||
          Boolean(options?.afterWrite) ||
          !lastKnownRevRef.current ||
          nowMs - lastFullSyncAtRef.current >= FULL_RECONCILE_INTERVAL_MS;

        const syncParams = new URLSearchParams();
        if (!needsFullReconcile && lastKnownRevRef.current) {
          syncParams.set('rev', lastKnownRevRef.current);
        } else {
          syncParams.set('full', '1');
        }
        const syncEndpoint = `/api/sync?${syncParams.toString()}`;

        const res = await apiFetch(syncEndpoint, {
          headers: buildApiHeaders({ 'Cache-Control': 'no-cache' }),
        });
        const data = await res.json().catch(() => ({}));

        // Abaikan snapshot lama bila ada penulisan yang baru dimulai
        if (latestMutationSeqRef.current > fetchStartMutationSeq) {
          pendingRefreshAfterWriteRef.current = true;
          return;
        }

        if (handleAppsScriptUnauthorized(res.status, data)) {
          consecutiveSyncErrorsRef.current += 1;
          setSyncStatus('error');
          return;
        }

        if (res.status === 401 && sessionRef.current?.token) {
          await refreshAuthSessionIfNeeded(true);
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

        if (data.unchanged) {
          if (data.serverTime) {
            setServerClockOffset(data.serverTime);
            setCurrentServerTime(getServerNow());
          }
          setLastSyncTime(new Date());
          setSyncStatus('synced');
          return;
        }

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
          applyDatabaseSnapshot(data.data, data.serverTime, data.rev);
          broadcastSyncEvent('DATA_SNAPSHOT', {
            snapshot: data.data,
            serverTime: data.serverTime,
            rev: data.rev,
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
          void refreshFromSheets(true, { forceFull: true });
        }
      }
    },
    [
      applyDatabaseSnapshot,
      broadcastSyncEvent,
      buildApiHeaders,
      handleAppsScriptUnauthorized,
      refreshAuthSessionIfNeeded,
    ]
  );

  const connectAppsScript = useCallback(
    async (rawUrl: string, rawSecretToken?: string): Promise<{ ok: boolean; message: string }> => {
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
          applyDatabaseSnapshot(result.data.data, result.data.serverTime, result.data.rev);
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

        let activeAppToken = sessionRef.current?.token || '';
        if (activeAppToken) {
          const refreshed = await refreshAuthSessionIfNeeded(true);
          activeAppToken = refreshed || '';
        }

        if (activeAppToken) {
          apiFetch('/api/settings', {
            method: 'POST',
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, activeAppToken),
            body: JSON.stringify({ apps_script_url: saved }),
          }).catch(() => {});
        }

        showToast(result.message, 'success');
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
    try {
      const sendQueued = async (tokOverride?: string) => {
        const res = await apiFetch('/api/attendance', {
          method: 'POST',
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }, tokOverride),
          body: JSON.stringify({ scans: queued }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };

      let { res, data } = await sendQueued();
      if (handleAppsScriptUnauthorized(res.status, data)) {
        return;
      }
      if (res.status === 401 && sessionRef.current?.token) {
        const refreshedTok = await refreshAuthSessionIfNeeded(true);
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
          showToast(`${data.savedCount} scan offline terkirim, ${data.rejectedCount} duplikat ditolak.`, 'info');
        } else {
          showToast(`${queued.length} data presensi offline berhasil disinkronkan ke Google Sheets.`, 'success');
        }
        if (data.snapshot) {
          applyDatabaseSnapshot(data.snapshot, data.serverTime, data.rev);
          broadcastSyncEvent('DATA_SNAPSHOT', {
            snapshot: data.snapshot,
            serverTime: data.serverTime,
            rev: data.rev,
          });
        } else {
          await refreshFromSheets(true, { afterWrite: true, forceFull: true });
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
  }, [
    applyDatabaseSnapshot,
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

  // Muat awal + verifikasi sesi + sinkronisasi otomatis real-time (cooldown 350ms + lintas-tab <1ms + saat tab aktif)
  useEffect(() => {
    let cancelled = false;
    let syncLoopTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextSync = () => {
      if (cancelled) return;
      if (syncLoopTimer) clearTimeout(syncLoopTimer);
      const errCount = consecutiveSyncErrorsRef.current;
      const delay =
        errCount === 0
          ? REALTIME_SYNC_COOLDOWN_MS
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
      await refreshFromSheets(false, { forceFull: true });
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
            applyDatabaseSnapshot(msg.payload.snapshot, msg.payload.serverTime, msg.payload.rev);
          } else if (msg.type === 'DATA_OPTIMISTIC_ATTENDANCE' && msg.payload?.record) {
            const optRec = msg.payload.record as AttendanceRecord;
            setAttendance((prev) =>
              prev.some((a) => a.id === optRec.id) ? prev : [optRec, ...prev]
            );
          } else if (msg.type === 'DATA_MUTATED') {
            void refreshFromSheets(true, { afterWrite: true, forceFull: true });
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
        void refreshFromSheets(true, { forceFull: true });
        void flushOfflineAttendanceScans();
      }
    };

    const handleOnline = () => {
      consecutiveSyncErrorsRef.current = 0;
      setSyncStatus('syncing');
      void flushOfflineAttendanceScans();
      void refreshFromSheets(true, { afterWrite: true, forceFull: true });
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
    refreshFromSheets,
    flushOfflineAttendanceScans,
    handleAppsScriptUnauthorized,
    refreshAuthSessionIfNeeded,
  ]);

  // Flush the 3-second batch of scans to POST /api/attendance
  const flushScanBatch = useCallback(async () => {
    if (scanBatchTimerRef.current) {
      clearTimeout(scanBatchTimerRef.current);
      scanBatchTimerRef.current = null;
    }

    const items = scanBatchQueueRef.current.splice(0, scanBatchQueueRef.current.length);
    if (items.length === 0) return;

    const batchOptimisticIds = items.map((it) => it.optimisticId).filter(Boolean) as string[];
    batchOptimisticIds.forEach((oid) => inFlightOptimisticIdsRef.current.add(oid));

    const clearInFlightOptimistic = () => {
      batchOptimisticIds.forEach((oid) => inFlightOptimisticIdsRef.current.delete(oid));
    };

    setSavingState();

    try {
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

      let { res, data } = await sendBatch();
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
        const refreshedTok = await refreshAuthSessionIfNeeded(true);
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
        // Jika ada item yang sudah ter-resolusi optimistik, jangan bunyikan beep ganda jika semua sukses
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
        setSavedState('Tersimpan');
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
        });
      });

      if (data.snapshot) {
        applyDatabaseSnapshot(data.snapshot, data.serverTime, data.rev);
        broadcastSyncEvent('DATA_SNAPSHOT', {
          snapshot: data.snapshot,
          serverTime: data.serverTime,
          rev: data.rev,
        });
      } else {
        await refreshFromSheets(true, { afterWrite: true, forceFull: true });
        broadcastSyncEvent('DATA_MUTATED');
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
      conflictTitle?: string;
      applyOptimistic?: () => () => void;
      onSuccess?: (data: any) => void;
      successMessage?: string;
      silentToast?: boolean;
    }): Promise<{ ok: boolean; data?: any; error?: string }> => {
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
          const payload = forceOverwrite ? { ...params.body, forceOverwrite: true } : params.body;
          const res = await apiFetch(params.url, {
            method: params.method,
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, overrideAppToken),
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
            const refreshedTok = await refreshAuthSessionIfNeeded(true);
            if (refreshedTok) {
              return execute(forceOverwrite, true, refreshedTok);
            }
            rollbackOptimistic?.();
            const authErr = data.error || 'Sesi login telah berakhir. Silakan masuk kembali.';
            setSaveErrorState(authErr);
            return { ok: false, error: authErr, data };
          }

          if (res.status === 409 && data.conflict) {
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

          if (!res.ok) {
            rollbackOptimistic?.();
            const errMsg = data.error || `Gagal menyimpan data (${res.status})`;
            setSaveErrorState(errMsg);
            if (!params.silentToast) showToast(errMsg, 'error');
            return { ok: false, error: errMsg, data };
          }

          if (data.snapshot) {
            applyDatabaseSnapshot(data.snapshot, data.serverTime, data.rev);
            broadcastSyncEvent('DATA_SNAPSHOT', {
              snapshot: data.snapshot,
              serverTime: data.serverTime,
              rev: data.rev,
            });
          } else {
            if (params.url === '/api/settings' && data.settings) {
              setSettings((prev) => ({ ...prev, ...data.settings }));
            } else if (params.url === '/api/notifications' && data.settings) {
              setNotificationSettings((prev) => ({ ...prev, ...data.settings }));
            }
            broadcastSyncEvent('DATA_MUTATED');
          }

          setSavedState('Tersimpan');
          if (params.onSuccess) params.onSuccess(data);
          if (params.successMessage && !params.silentToast) {
            showToast(params.successMessage, 'success');
          }
          if (!data.snapshot) {
            await refreshFromSheets(true, { afterWrite: true, forceFull: true });
          }
          return { ok: true, data };
        } catch (err: any) {
          rollbackOptimistic?.();
          const errMsg = err?.message || 'Gagal terhubung ke Apps Script.';
          setSaveErrorState(errMsg);
          if (!params.silentToast) showToast(errMsg, 'error');
          return { ok: false, error: errMsg };
        }
      };

      return execute(false);
    },
    [
      applyDatabaseSnapshot,
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

  const loginDuty = async (password: string) => {
    try {
      const res = await apiFetch('/api/auth?action=login_duty', {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
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
      setSession(authSess);
      localStorage.setItem('dkb_session', JSON.stringify(authSess));
      refreshFromSheets(true);
      return { success: true };
    } catch {
      return { success: false, error: 'Gagal menghubungi Google Apps Script.' };
    }
  };

  const unlockHomeroom = async (name: string, password: string, classId?: string) => {
    try {
      const res = await apiFetch('/api/auth?action=unlock_homeroom', {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, password, classId }),
      });
      const data = await res.json().catch(() => ({}));
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
    try {
      const res = await apiFetch('/api/auth?action=unlock_student_affairs', {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
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
    try {
      const res = await apiFetch('/api/auth?action=unlock_admin', {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (handleAppsScriptUnauthorized(res.status, data)) {
        return { success: false, error: data.error };
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
      setSession(authSess);
      localStorage.setItem('dkb_session', JSON.stringify(authSess));
      setActiveTab('admin');
      refreshFromSheets(true);
      return { success: true };
    } catch {
      return { success: false, error: 'Gagal menghubungi Google Apps Script.' };
    }
  };

  const logout = () => {
    setSession(null);
    localStorage.removeItem('dkb_session');
    localStorage.removeItem('dkb_active_tab');
    setActiveTabState('attendance');
  };

  const lockCurrentMenu = () => logout();

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
    const targetSessionObj =
      (params.sessionId && sessions.find((s) => s.id === params.sessionId)) ||
      activeSession ||
      sessions.find((s) => s.is_active) ||
      sessions[0];
    const targetSessionId = targetSessionObj?.id || params.sessionId;
    const serverNow = getServerNow();
    const todayStr = serverNow.toISOString().split('T')[0];

    // Quick duplicate & card validation against current state (<1ms) before queueing 3s batch
    const targetStudent = students.find(
      (s) =>
        (params.studentId && s.nis === params.studentId) ||
        (params.code &&
          (s.nis.toLowerCase() === params.code.trim().toLowerCase() ||
            s.rfid_uid.toLowerCase() === params.code.trim().toLowerCase() ||
            s.card_code.toLowerCase() === params.code.trim().toLowerCase()))
    );

    if (targetStudent) {
      const multiSession = sessions.filter((s) => s.is_active).length > 1;
      const alreadyRecorded = attendance.some(
        (a) =>
          a.student_id === targetStudent.nis &&
          a.date === todayStr &&
          (multiSession ? a.session_id === targetSessionId : true)
      );
      if (alreadyRecorded) {
        soundEffects.playErrorBeep();
        const err = `Presensi ganda ditolak: ${targetStudent.name} sudah tercatat presensi hari ini (${todayStr}).`;
        return { success: false, error: err, isDuplicate: true, student: targetStudent };
      }

      const alreadyInBatch = scanBatchQueueRef.current.some(
        (b) =>
          (b.params.studentId && b.params.studentId === targetStudent.nis) ||
          (b.targetStudent && b.targetStudent.nis === targetStudent.nis) ||
          (params.code && b.params.code && b.params.code.trim().toLowerCase() === params.code.trim().toLowerCase())
      );
      if (alreadyInBatch) {
        soundEffects.playErrorBeep();
        return {
          success: false,
          error: `Presensi ganda dalam antrean 3 detik untuk ${targetStudent.name}.`,
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
    // sembari tetap mengumpulkan batch scan selama 3 detik di latar belakang ke Apps Script!
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

      scanBatchQueueRef.current.push({
        params: scanObj,
        optimisticId: optimisticRecord.id,
        targetStudent,
      });
      if (!scanBatchTimerRef.current) {
        scanBatchTimerRef.current = setTimeout(() => {
          void flushScanBatch();
        }, SCAN_BATCH_WINDOW_MS);
      }

      return {
        success: true,
        record: optimisticRecord,
        student: targetStudent,
        session: targetSessionObj,
      };
    }

    // Fallback (kartu tidak ditemukan di state lokal): tunggu verifikasi server lewat batch 3 detik
    return await new Promise<any>((resolve) => {
      setSavingState();
      scanBatchQueueRef.current.push({ params: scanObj, resolve });
      if (!scanBatchTimerRef.current) {
        scanBatchTimerRef.current = setTimeout(() => {
          void flushScanBatch();
        }, SCAN_BATCH_WINDOW_MS);
      }
    });
  };

  const updateAttendance = async (id: string, updates: Partial<AttendanceRecord>, reason: string) => {
    const existing = attendance.find((a) => a.id === id);
    const res = await runWriteRequest({
      url: '/api/attendance',
      method: 'PUT',
      body: {
        id,
        updates,
        reason,
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
      successMessage: 'Presensi berhasil diperbarui & disimpan ke Google Sheets.',
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
      successMessage: 'Presensi berhasil ditandai dihapus (soft delete) di Google Sheets.',
    });
    return res.ok;
  };

  const startOutOfClass = async (
    studentId: string,
    type: 'BAK' | 'BAB' | 'Keperluan Lain',
    durationMinutes: number
  ) => {
    const res = await runWriteRequest({
      url: '/api/out-of-class',
      method: 'POST',
      body: {
        studentId,
        type,
        durationMinutes,
        idempotencyKey: `ooc_${Date.now()}_${Math.random()}`,
      },
      silentToast: true,
    });
    if (!res.ok) {
      soundEffects.playErrorBeep();
      return { success: false, error: res.error };
    }
    soundEffects.playSuccessBeep();
    return { success: true, record: res.data?.record, student: res.data?.student };
  };

  const confirmOutOfClassReturn = async (
    id: string,
    returnMethod: 'click' | 'manual' = 'click',
    notes?: string,
    auditReason?: string
  ) => {
    const existing = outOfClass.find((o) => o.id === id);
    const res = await runWriteRequest({
      url: '/api/out-of-class',
      method: 'PUT',
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
            const snapshot = outOfClass;
            const returnedAt = getServerNow().toISOString();
            setOutOfClass((prev) =>
              prev.map((o) => (o.id === id ? { ...o, status: 'returned', returned_at: returnedAt } : o))
            );
            return () => setOutOfClass(snapshot);
          }
        : undefined,
      silentToast: true,
    });
    if (!res.ok) {
      soundEffects.playErrorBeep();
      return { success: false, error: res.error };
    }
    soundEffects.playSuccessBeep();
    return { success: true, record: res.data?.record };
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
    const res = await runWriteRequest({
      url: '/api/violations',
      method: 'POST',
      body: params,
      silentToast: true,
    });
    if (!res.ok) {
      soundEffects.playErrorBeep();
      return { success: false, error: res.error };
    }
    soundEffects.playSuccessBeep();
    return {
      success: true,
      violation: res.data?.violation,
      studentTotalPoints: res.data?.studentTotalPoints,
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
      successMessage: 'Catatan pelanggaran ditandai dihapus (soft delete) di Google Sheets.',
    });
    return res.ok;
  };

  const saveStudent = async (student: Student & { photoBase64?: string }) => {
    const existing = students.find((s) => s.nis === student.nis);
    const res = await runWriteRequest({
      url: '/api/students',
      method: 'POST',
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
      successMessage: `Data siswa ${student.name} tersimpan di Google Sheets.`,
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
      successMessage: 'Siswa ditandai dihapus di Google Sheets.',
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
      successMessage: `${nisses.length} siswa ditandai dihapus di Google Sheets.`,
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
      successMessage: 'Seluruh data siswa ditandai dihapus di Google Sheets.',
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

    setSavingState();
    latestMutationSeqRef.current += 1;

    const CHUNK_SIZE = 80;
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalClassesCreated = 0;
    let lastSnapshot: any = null;
    let lastServerTime: string | undefined;
    let lastRev: string | undefined;

    try {
      for (let i = 0; i < newStudents.length; i += CHUNK_SIZE) {
        const chunk = newStudents.slice(i, i + CHUNK_SIZE);

        const sendChunk = async (tokOverride?: string) => {
          const res = await apiFetch('/api/students?action=batch_import', {
            method: 'POST',
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, tokOverride),
            body: JSON.stringify({ students: chunk }),
          });
          const data = await res.json().catch(() => ({}));
          return { res, data };
        };

        let { res, data } = await sendChunk();
        if (handleAppsScriptUnauthorized(res.status, data)) {
          const msg = data.error || 'Token rahasia Apps Script ditolak.';
          setSaveErrorState(msg);
          return {
            success: false,
            added: totalAdded,
            updated: totalUpdated,
            classesCreated: totalClassesCreated,
            error: msg,
          };
        }

        if (res.status === 401 && sessionRef.current?.token) {
          const refreshedTok = await refreshAuthSessionIfNeeded(true);
          if (refreshedTok) {
            const retried = await sendChunk(refreshedTok);
            res = retried.res;
            data = retried.data;
          }
        }

        if (!res.ok || data?.success === false) {
          const errMsg = data?.error || `Gagal mengimpor data siswa (HTTP ${res.status}).`;
          setSaveErrorState(errMsg);
          return {
            success: false,
            added: totalAdded,
            updated: totalUpdated,
            classesCreated: totalClassesCreated,
            error: errMsg,
          };
        }

        totalAdded += Number(data.inserted || 0);
        totalUpdated += Number(data.updated || 0);
        totalClassesCreated += Number(data.classesCreated || 0);
        if (data.snapshot) lastSnapshot = data.snapshot;
        if (data.serverTime) lastServerTime = data.serverTime;
        if (data.rev) lastRev = String(data.rev);
      }

      if (lastSnapshot) {
        applyDatabaseSnapshot(lastSnapshot, lastServerTime, lastRev);
        broadcastSyncEvent('DATA_SNAPSHOT', {
          snapshot: lastSnapshot,
          serverTime: lastServerTime,
          rev: lastRev,
        });
      } else {
        await refreshFromSheets(true, { afterWrite: true, forceFull: true });
        broadcastSyncEvent('DATA_MUTATED');
      }
      setSavedState('Tersimpan');

      return {
        success: true,
        added: totalAdded,
        updated: totalUpdated,
        classesCreated: totalClassesCreated,
      };
    } catch (err: any) {
      const errMsg = err?.message || 'Gagal menghubungi server saat impor data siswa.';
      setSaveErrorState(errMsg);
      return {
        success: false,
        added: totalAdded,
        updated: totalUpdated,
        classesCreated: totalClassesCreated,
        error: errMsg,
      };
    }
  };

  const saveClass = async (cls: SchoolClass) => {
    const existing = classes.find((c) => c.id === cls.id);
    const res = await runWriteRequest({
      url: '/api/classes',
      method: 'POST',
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
      successMessage: `Data kelas ${cls.name} tersimpan di Google Sheets.`,
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
      successMessage: 'Kelas berhasil dihapus (soft delete).',
    });
    return res.ok;
  };

  const saveSession = async (sess: AttendanceSession) => {
    const existing = sessions.find((s) => s.id === sess.id);
    const res = await runWriteRequest({
      url: '/api/sessions',
      method: 'POST',
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
      successMessage: `Sesi ${sess.name} tersimpan di Google Sheets.`,
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
      successMessage: 'Sesi presensi berhasil dihapus (soft delete).',
    });
    return res.ok;
  };

  const saveViolationType = async (vt: ViolationType) => {
    const existing = violationTypes.find((v) => v.id === vt.id);
    const res = await runWriteRequest({
      url: '/api/violation-types',
      method: 'POST',
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
      successMessage: `Jenis pelanggaran ${vt.name} tersimpan di Google Sheets.`,
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
      successMessage: 'Jenis pelanggaran berhasil dihapus (soft delete).',
    });
    return res.ok;
  };

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings> & { logoBase64?: string }, options?: { silent?: boolean }) => {
      const res = await runWriteRequest({
        url: '/api/settings',
        method: 'POST',
        body: updates,
        applyOptimistic: () => {
          const snapshot = settings;
          setSettings((prev) => ({ ...prev, ...updates }));
          return () => setSettings(snapshot);
        },
        successMessage: 'Pengaturan aplikasi berhasil disimpan ke Google Sheets.',
        silentToast: options?.silent,
      });
      return res.ok;
    },
    [runWriteRequest, settings]
  );

  const updateNotificationSettings = useCallback(
    async (updates: Partial<NotificationSettings>, options?: { silent?: boolean }) => {
      const res = await runWriteRequest({
        url: '/api/notifications',
        method: 'POST',
        body: updates,
        applyOptimistic: () => {
          const snapshot = notificationSettings;
          setNotificationSettings((prev) => ({ ...prev, ...updates }));
          return () => setNotificationSettings(snapshot);
        },
        successMessage: 'Pengaturan notifikasi email tersimpan ke Google Sheets.',
        silentToast: options?.silent,
      });
      return res.ok;
    },
    [runWriteRequest, notificationSettings]
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
      successMessage: status === 'approved' ? 'Pengajuan izin disetujui.' : 'Pengajuan izin ditolak.',
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
