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
  initGoogleAuth,
  googleSignIn,
  getGoogleAccessToken,
  clearGoogleAccessToken,
  googleLogout,
} from '../utils/googleAuth.js';
import {
  apiFetch,
  getAppsScriptUrl,
  setAppsScriptUrl,
  clearAppsScriptUrl,
  isValidAppsScriptUrl,
  testAppsScriptConnection,
  fetchServerAppsScriptUrl,
  persistServerAppsScriptUrl,
  clearServerAppsScriptUrl,
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
const AUTO_REFRESH_INTERVAL_MS = 10000;
const SCAN_BATCH_WINDOW_MS = 3000;

export interface EnvConfigStatus {
  configured: boolean;
  sheetsConfigured: boolean;
  driveConfigured: boolean;
  spreadsheetConfigured: boolean;
  driveFolderConfigured: boolean;
  hasServiceAccount?: boolean;
  authMode?: 'google_oauth' | 'service_account' | 'apps_script' | 'unconfigured';
  requiresGoogleSignIn?: boolean;
  emailConnected?: boolean;
  emailTransport?: 'gmail_oauth' | 'smtp' | 'apps_script_gmail' | 'unconfigured';
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

export interface GoogleAccountProfile {
  email: string;
  displayName: string;
  photoURL?: string | null;
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
  needsGoogleAuth: boolean;
  isGoogleSigningIn: boolean;
  googleAccessToken: string | null;
  googleUser: GoogleAccountProfile | null;
  connectGoogleAccount: () => Promise<boolean>;
  disconnectGoogleAccount: () => Promise<void>;
  appsScriptUrl: string;
  isConnectingAppsScript: boolean;
  connectAppsScript: (url: string) => Promise<{ ok: boolean; message: string }>;
  disconnectAppsScript: () => Promise<void>;
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
    overrideGoogleToken?: string,
    options?: { afterWrite?: boolean }
  ) => Promise<void>;

  // Mutators (Direct to Google Sheets API v4 / Drive v3)
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
      if (savedTab && ['dashboard', 'attendance', 'out_of_class', 'violations', 'homeroom', 'student_affairs', 'admin'].includes(savedTab)) {
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
  const [missingEnv, setMissingEnv] = useState<string[]>([]);
  const [envStatus, setEnvStatus] = useState<EnvConfigStatus>({
    configured: false,
    sheetsConfigured: false,
    driveConfigured: false,
    spreadsheetConfigured: false,
    driveFolderConfigured: false,
    hasServiceAccount: false,
    authMode: 'unconfigured',
    requiresGoogleSignIn: false,
    emailConnected: false,
    emailTransport: 'unconfigured',
    senderEmail: '',
    missingEnv: [],
  });
  const [needsGoogleAuth, setNeedsGoogleAuth] = useState<boolean>(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState<boolean>(false);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(() => getGoogleAccessToken());
  const [googleUser, setGoogleUser] = useState<GoogleAccountProfile | null>(null);
  const [appsScriptUrl, setAppsScriptUrlState] = useState<string>(() => getAppsScriptUrl());
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
  const hasCheckedServerAppsScriptRef = useRef<boolean>(false);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionRef = useRef<AuthSession | null>(session);
  sessionRef.current = session;
  const tokenRefreshPromiseRef = useRef<Promise<string | null> | null>(null);

  const broadcastSyncEvent = useCallback((type: 'DATA_MUTATED' | 'APPS_SCRIPT_CHANGED', payload?: any) => {
    try {
      syncChannelRef.current?.postMessage({ type, payload, at: Date.now() });
    } catch {}
    try {
      localStorage.setItem('dkb_last_sync_event', JSON.stringify({ type, at: Date.now() }));
    } catch {}
  }, []);

  // 3-second batch scan collector for consecutive scans
  interface BatchItem {
    params: OfflineAttendanceScan;
    resolve: (res: any) => void;
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
      overrideGoogleToken?: string,
      overrideAppToken?: string
    ): Record<string, string> => {
      const gToken = overrideGoogleToken || googleAccessToken || getGoogleAccessToken();
      const appToken = overrideAppToken ?? session?.token ?? sessionRef.current?.token ?? '';
      return {
        ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
        ...(gToken ? { 'X-Google-Access-Token': gToken } : {}),
        ...(extra || {}),
      };
    },
    [session?.token, googleAccessToken]
  );

  const handlePossibleGoogleTokenExpiry = useCallback(
    (status: number, data: any) => {
      if (status === 401 && data?.googleAuthExpired) {
        clearGoogleAccessToken();
        setGoogleAccessToken(null);
        setNeedsGoogleAuth(true);
        showToast('Sesi akses Google berakhir. Silakan klik "Sign in with Google" lagi untuk melanjutkan.', 'info');
        return true;
      }
      if (status === 401 && data?.googleDeploymentUnauthorized) {
        showToast(
          data.error ||
            'Google Apps Script menolak akses (401). Pastikan deploy Web App dengan URL /exec dan akses "Siapa saja (Anyone)".',
          'error'
        );
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

  const applyDatabaseSnapshot = useCallback((d: any, serverTime?: string) => {
    if (serverTime) {
      setServerClockOffset(serverTime);
      setCurrentServerTime(getServerNow());
    }
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.students)) setStudents(d.students);
    if (Array.isArray(d.classes)) setClasses(d.classes);
    if (Array.isArray(d.sessions)) setSessions(d.sessions);
    if (Array.isArray(d.attendance)) setAttendance(d.attendance);
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
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, undefined, currentSess.token),
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

          if (res.status === 401 && !data?.googleAuthExpired && !data?.googleDeploymentUnauthorized) {
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
   * Direct read from Google Sheets via /api/sync
   */
  const refreshFromSheets = useCallback(
    async (silent = false, overrideGoogleToken?: string, options?: { afterWrite?: boolean }) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return;
      }

      if (options?.afterWrite) {
        latestMutationSeqRef.current += 1;
        pendingRefreshAfterWriteRef.current = true;
      }

      if (isFetchingRef.current && !overrideGoogleToken) {
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
        // Auto-discover persisted Apps Script URL from server once if local storage has none
        if (!getAppsScriptUrl() && !hasCheckedServerAppsScriptRef.current) {
          hasCheckedServerAppsScriptRef.current = true;
          const serverUrl = await fetchServerAppsScriptUrl();
          if (serverUrl) {
            const saved = setAppsScriptUrl(serverUrl);
            setAppsScriptUrlState(saved);
            setNeedsGoogleAuth(false);
          }
        }

        const res = await apiFetch('/api/sync', {
          headers: buildApiHeaders({ 'Cache-Control': 'no-cache' }, overrideGoogleToken),
        });
        const data = await res.json().catch(() => ({}));

        // Discard stale snapshot if a mutation happened while this GET was in-flight
        if (latestMutationSeqRef.current > fetchStartMutationSeq) {
          pendingRefreshAfterWriteRef.current = true;
          return;
        }

        // Auto-adopt Apps Script URL returned by server or Google Sheets Pengaturan
        const discoveredUrl =
          data?.savedAppsScriptUrl || data?.data?.settings?.apps_script_url || '';
        if (!getAppsScriptUrl() && discoveredUrl && isValidAppsScriptUrl(discoveredUrl)) {
          const saved = setAppsScriptUrl(discoveredUrl);
          setAppsScriptUrlState(saved);
          setNeedsGoogleAuth(false);
          pendingRefreshAfterWriteRef.current = true;
          return;
        }

        if (handlePossibleGoogleTokenExpiry(res.status, data)) {
          setSyncStatus('error');
          return;
        }

        if (res.status === 401 && sessionRef.current?.token) {
          await refreshAuthSessionIfNeeded(true);
        }

        if (res.status === 503) {
          const isAppsScriptMode = Boolean(getAppsScriptUrl());
          const requiresSignIn = !isAppsScriptMode && Boolean(data.requiresGoogleSignIn);
          setNeedsGoogleAuth(requiresSignIn);
          setConfigError(
            requiresSignIn
              ? null
              : data.error || 'Environment variable server (SPREADSHEET_ID / Service Account) belum dikonfigurasi.'
          );
          setMissingEnv(Array.isArray(data.missingEnv) ? data.missingEnv : []);
          setEnvStatus({
            configured: false,
            sheetsConfigured: false,
            driveConfigured: false,
            spreadsheetConfigured: false,
            driveFolderConfigured: false,
            hasServiceAccount: Boolean(data.hasServiceAccount),
            authMode: isAppsScriptMode ? 'apps_script' : (data.authMode || 'unconfigured'),
            requiresGoogleSignIn: requiresSignIn,
            emailConnected: Boolean(data.emailConnected),
            emailTransport: data.emailTransport || 'unconfigured',
            senderEmail: data.senderEmail || '',
            missingEnv: Array.isArray(data.missingEnv) ? data.missingEnv : [],
          });
          setSyncStatus(requiresSignIn ? 'offline' : 'error');
          return;
        }

        if (!res.ok) {
          setInitialLoadError(data.error || 'Gagal membaca data dari Google Sheets.');
          setSyncStatus('error');
          return;
        }

        setConfigError(null);
        setNeedsGoogleAuth(false);
        setInitialLoadError(null);
        setMissingEnv(Array.isArray(data.missingEnv) ? data.missingEnv : []);
        setEnvStatus({
          configured: Boolean(data.configured),
          sheetsConfigured: Boolean(data.sheetsConfigured),
          driveConfigured: Boolean(data.driveConfigured),
          spreadsheetConfigured: Boolean(data.spreadsheetConfigured),
          driveFolderConfigured: Boolean(data.driveFolderConfigured),
          hasServiceAccount: Boolean(data.hasServiceAccount),
          authMode: data.authMode || (getAppsScriptUrl() ? 'apps_script' : 'service_account'),
          requiresGoogleSignIn: Boolean(data.requiresGoogleSignIn),
          emailConnected: Boolean(data.emailConnected),
          emailTransport: data.emailTransport || 'unconfigured',
          senderEmail: data.senderEmail || '',
          missingEnv: Array.isArray(data.missingEnv) ? data.missingEnv : [],
        });

        if (data.data) {
          applyDatabaseSnapshot(data.data, data.serverTime);
        } else {
          if (data.serverTime) {
            setServerClockOffset(data.serverTime);
            setCurrentServerTime(getServerNow());
          }
          setLastSyncTime(new Date());
          setSyncStatus('synced');
        }
      } catch (err: any) {
        setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        if (!silent) {
          setInitialLoadError(err?.message || 'Koneksi ke server bermasalah.');
        }
      } finally {
        isFetchingRef.current = false;
        setIsInitialLoading(false);
        if (pendingRefreshAfterWriteRef.current) {
          pendingRefreshAfterWriteRef.current = false;
          void refreshFromSheets(true, overrideGoogleToken);
        }
      }
    },
    [applyDatabaseSnapshot, buildApiHeaders, handlePossibleGoogleTokenExpiry]
  );

  // Firebase Google Auth listener (in-memory access token)
  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (user, token) => {
        setGoogleAccessToken(token);
        setGoogleUser({
          email: user.email || '',
          displayName: user.displayName || user.email || 'Akun Google',
          photoURL: user.photoURL,
        });
        setNeedsGoogleAuth(false);
      },
      (user) => {
        setGoogleAccessToken(null);
        if (user) {
          setGoogleUser({
            email: user.email || '',
            displayName: user.displayName || user.email || 'Akun Google',
            photoURL: user.photoURL,
          });
        } else {
          setGoogleUser(null);
        }
      }
    );
    return () => unsubscribe();
  }, []);

  const connectGoogleAccount = useCallback(async (): Promise<boolean> => {
    setIsGoogleSigningIn(true);
    try {
      const { user, accessToken } = await googleSignIn();
      setGoogleAccessToken(accessToken);
      setGoogleUser({
        email: user.email || '',
        displayName: user.displayName || user.email || 'Akun Google',
        photoURL: user.photoURL,
      });
      setNeedsGoogleAuth(false);
      setConfigError(null);
      showToast(`Terhubung dengan akun Google ${user.email || ''}. Menyinkronkan data...`, 'success');
      await refreshFromSheets(false, accessToken);
      return true;
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        showToast('Login Google dibatalkan.', 'info');
      } else {
        showToast(err?.message || 'Gagal menghubungkan akun Google.', 'error');
      }
      return false;
    } finally {
      setIsGoogleSigningIn(false);
    }
  }, [refreshFromSheets, showToast]);

  const disconnectGoogleAccount = useCallback(async () => {
    await googleLogout();
    setGoogleAccessToken(null);
    setGoogleUser(null);
    if (!getAppsScriptUrl()) {
      setNeedsGoogleAuth(true);
    }
    showToast('Koneksi akun Google telah diputuskan.', 'info');
  }, [showToast]);

  const connectAppsScript = useCallback(
    async (rawUrl: string): Promise<{ ok: boolean; message: string }> => {
      setIsConnectingAppsScript(true);
      try {
        const result = await testAppsScriptConnection(rawUrl);
        if (!result.ok) {
          showToast(result.message, 'error');
          return { ok: false, message: result.message };
        }
        const saved = setAppsScriptUrl(rawUrl);
        setAppsScriptUrlState(saved);
        setNeedsGoogleAuth(false);
        setConfigError(null);
        setInitialLoadError(null);

        if (result.data?.data) {
          applyDatabaseSnapshot(result.data.data, result.data.serverTime);
          setEnvStatus({
            configured: true,
            sheetsConfigured: Boolean(result.data.sheetsConfigured ?? true),
            driveConfigured: Boolean(result.data.driveConfigured ?? true),
            spreadsheetConfigured: true,
            driveFolderConfigured: true,
            hasServiceAccount: false,
            authMode: 'apps_script',
            requiresGoogleSignIn: false,
            emailConnected: Boolean(result.data.emailConnected),
            emailTransport: result.data.emailTransport || 'apps_script_gmail',
            senderEmail: result.data.senderEmail || '',
            missingEnv: [],
          });
        }

        await persistServerAppsScriptUrl(saved);
        broadcastSyncEvent('APPS_SCRIPT_CHANGED', { appsScriptUrl: saved });

        let activeAppToken = sessionRef.current?.token || '';
        if (activeAppToken) {
          const refreshed = await refreshAuthSessionIfNeeded(true);
          activeAppToken = refreshed || '';
        }

        if (activeAppToken) {
          apiFetch('/api/settings', {
            method: 'POST',
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, undefined, activeAppToken),
            body: JSON.stringify({ apps_script_url: saved }),
          }).catch(() => {});
        }

        showToast(result.message, 'success');
        if (!result.data?.data) {
          await refreshFromSheets(false, undefined, { afterWrite: true });
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
    setAppsScriptUrlState('');
    await clearServerAppsScriptUrl();
    broadcastSyncEvent('APPS_SCRIPT_CHANGED', { appsScriptUrl: '' });
    showToast('Koneksi backend Google Apps Script diputuskan.', 'info');
    await refreshFromSheets(false, undefined, { afterWrite: true });
  }, [broadcastSyncEvent, refreshFromSheets, showToast]);

  /**
   * Flush offline attendance scans saved in localStorage when back online
   */
  const flushOfflineAttendanceScans = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (needsGoogleAuth && !getAppsScriptUrl() && !googleAccessToken && !getGoogleAccessToken()) return;
    const queued = readOfflineScans();
    if (queued.length === 0) return;

    setSavingState();
    try {
      const sendQueued = async (tokOverride?: string) => {
        const res = await apiFetch('/api/attendance', {
          method: 'POST',
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }, undefined, tokOverride),
          body: JSON.stringify({ scans: queued }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };

      let { res, data } = await sendQueued();
      if (handlePossibleGoogleTokenExpiry(res.status, data)) {
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
        setSavedState(`Tersimpan (${queued.length} scan offline terkirim)`);
        if (data.rejectedCount > 0) {
          showToast(`${data.savedCount} scan offline terkirim, ${data.rejectedCount} duplikat ditolak.`, 'info');
        } else {
          showToast(`${queued.length} data presensi offline berhasil disinkronkan ke Google Sheets.`, 'success');
        }
        if (data.snapshot) {
          applyDatabaseSnapshot(data.snapshot, data.serverTime);
        } else {
          await refreshFromSheets(true, undefined, { afterWrite: true });
        }
        broadcastSyncEvent('DATA_MUTATED');
      } else if (res.status < 500 && res.status !== 429 && res.status !== 401) {
        // Unrecoverable validation error; drop bad items so queue does not loop forever
        writeOfflineScans([]);
        setPendingOfflineScansCount(0);
        setSaveErrorState(data.error || 'Gagal mengirim scan offline.');
      }
    } catch {
      setSyncStatus('offline');
    }
  }, [
    needsGoogleAuth,
    googleAccessToken,
    applyDatabaseSnapshot,
    buildApiHeaders,
    broadcastSyncEvent,
    handlePossibleGoogleTokenExpiry,
    refreshAuthSessionIfNeeded,
    refreshFromSheets,
    setSavingState,
    setSavedState,
    setSaveErrorState,
    showToast,
  ]);

  // Initial load + silent session verification + 10s automatic polling + cross-tab instant sync
  useEffect(() => {
    refreshFromSheets(false);
    flushOfflineAttendanceScans();
    if (sessionRef.current?.token) {
      void refreshAuthSessionIfNeeded(false);
    }

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
            void refreshFromSheets(true, undefined, { afterWrite: true });
          } else if (msg.type === 'DATA_MUTATED') {
            void refreshFromSheets(true, undefined, { afterWrite: true });
          }
        };
      }
    } catch {}

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'dkb_apps_script_url') {
        setAppsScriptUrlState(getAppsScriptUrl());
        void refreshFromSheets(true, undefined, { afterWrite: true });
      } else if (e.key === 'dkb_last_sync_event') {
        void refreshFromSheets(true, undefined, { afterWrite: true });
      }
    };

    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        refreshFromSheets(true);
        flushOfflineAttendanceScans();
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        refreshFromSheets(true);
        flushOfflineAttendanceScans();
      }
    };

    const handleOnline = () => {
      setSyncStatus('syncing');
      flushOfflineAttendanceScans();
      refreshFromSheets(true, undefined, { afterWrite: true });
    };

    const handleOffline = () => {
      setSyncStatus('offline');
    };

    const handleGoogleAuthExpiredEvent = (evt: Event) => {
      const detail = (evt as CustomEvent)?.detail || {};
      handlePossibleGoogleTokenExpiry(401, detail);
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
    window.addEventListener('dkb-google-auth-expired', handleGoogleAuthExpiredEvent);
    window.addEventListener('dkb-app-token-refreshed', handleAppTokenRefreshedEvent);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('dkb-google-auth-expired', handleGoogleAuthExpiredEvent);
      window.removeEventListener('dkb-app-token-refreshed', handleAppTokenRefreshedEvent);
      try {
        bc?.close();
      } catch {}
      syncChannelRef.current = null;
    };
  }, [refreshFromSheets, flushOfflineAttendanceScans, handlePossibleGoogleTokenExpiry, refreshAuthSessionIfNeeded]);

  // Flush the 3-second batch of scans to POST /api/attendance
  const flushScanBatch = useCallback(async () => {
    if (scanBatchTimerRef.current) {
      clearTimeout(scanBatchTimerRef.current);
      scanBatchTimerRef.current = null;
    }

    const items = scanBatchQueueRef.current.splice(0, scanBatchQueueRef.current.length);
    if (items.length === 0) return;

    setSavingState();

    try {
      const sendBatch = async (tokOverride?: string) => {
        const res = await apiFetch('/api/attendance', {
          method: 'POST',
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }, undefined, tokOverride),
          body: JSON.stringify({
            scans: items.map((it) => it.params),
          }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };

      let { res, data } = await sendBatch();
      if (handlePossibleGoogleTokenExpiry(res.status, data)) {
        const msg = data.error || 'Sesi Google berakhir.';
        setSaveErrorState(msg);
        items.forEach((it) => it.resolve({ success: false, error: msg }));
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
          // Persist offline & notify user
          const existingOffline = readOfflineScans();
          const newOffline = [...existingOffline, ...items.map((i) => i.params)];
          writeOfflineScans(newOffline);
          setPendingOfflineScansCount(newOffline.length);
          const msg = data.error || 'Server/kuota sibuk, scan disimpan sementara di perangkat.';
          setSaveErrorState(msg);
          items.forEach((it) => it.resolve({ success: false, error: msg, offlineQueued: true }));
          return;
        }
        soundEffects.playErrorBeep();
        const errMsg = data.error || 'Presensi gagal disimpan.';
        setSaveErrorState(errMsg);
        items.forEach((it) =>
          it.resolve({
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

      if (savedResults.length > 0) {
        soundEffects.playSuccessBeep();
        setAttendance((prev) => [
          ...savedResults.map((r) => r.record),
          ...prev.filter((p) => !savedResults.some((sr) => sr.record.id === p.id)),
        ]);
        setSavedState('Tersimpan & Tersinkron');
      } else {
        soundEffects.playErrorBeep();
        setSaveErrorState(rejectedList[0]?.message || 'Presensi ditolak.');
      }

      // Map each queued item to its result
      items.forEach((it) => {
        const targetStudent = students.find(
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
        applyDatabaseSnapshot(data.snapshot, data.serverTime);
      } else {
        await refreshFromSheets(true, undefined, { afterWrite: true });
      }
      broadcastSyncEvent('DATA_MUTATED');
    } catch {
      const existingOffline = readOfflineScans();
      const newOffline = [...existingOffline, ...items.map((i) => i.params)];
      writeOfflineScans(newOffline);
      setPendingOfflineScansCount(newOffline.length);
      setSyncStatus('offline');
      setSaveErrorState('Offline: scan tersimpan sementara di perangkat.');
      items.forEach((it) =>
        it.resolve({
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
    handlePossibleGoogleTokenExpiry,
    refreshAuthSessionIfNeeded,
    students,
    refreshFromSheets,
    setSavingState,
    setSavedState,
    setSaveErrorState,
  ]);

  /**
   * Helper to run direct write fetch with 'Menyimpan...' -> 'Tersimpan' status,
   * automatic 401 token refresh + retry, immediate snapshot sync, and 409 Conflict UI
   */
  const runWriteRequest = useCallback(
    async (params: {
      url: string;
      method: 'POST' | 'PUT' | 'DELETE';
      body: any;
      conflictTitle?: string;
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
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, undefined, overrideAppToken),
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));

          if (handlePossibleGoogleTokenExpiry(res.status, data)) {
            const msg = data.error || 'Sesi Google berakhir.';
            setSaveErrorState(msg);
            return { ok: false, error: msg };
          }

          if (res.status === 401 && !hasRetriedAuth && sessionRef.current?.token) {
            const refreshedTok = await refreshAuthSessionIfNeeded(true);
            if (refreshedTok) {
              return execute(forceOverwrite, true, refreshedTok);
            }
            const authErr = data.error || 'Sesi login telah berakhir. Silakan masuk kembali.';
            setSaveErrorState(authErr);
            return { ok: false, error: authErr, data };
          }

          if (res.status === 409 && data.conflict) {
            const msg = data.error || 'Data sudah diubah oleh pengguna lain sebelum Anda menyimpan.';
            setSaveErrorState('Konflik edit terdeteksi');
            return await new Promise((resolve) => {
              setConflictPrompt({
                title: params.conflictTitle || 'Peringatan Konflik Data',
                message: msg,
                currentData: data.current,
                onReloadLatest: async () => {
                  setConflictPrompt(null);
                  await refreshFromSheets(true, undefined, { afterWrite: true });
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
            const errMsg = data.error || `Gagal menyimpan data (${res.status})`;
            setSaveErrorState(errMsg);
            if (!params.silentToast) showToast(errMsg, 'error');
            return { ok: false, error: errMsg, data };
          }

          // Instant authoritative snapshot reflection in the same HTTP roundtrip
          if (data.snapshot) {
            applyDatabaseSnapshot(data.snapshot, data.serverTime);
          } else {
            if (params.url === '/api/settings' && data.settings) {
              setSettings((prev) => ({ ...prev, ...data.settings }));
            } else if (params.url === '/api/notifications' && data.settings) {
              setNotificationSettings((prev) => ({ ...prev, ...data.settings }));
            }
          }

          setSavedState('Tersimpan & Tersinkron');
          if (params.onSuccess) params.onSuccess(data);
          if (params.successMessage && !params.silentToast) {
            showToast(params.successMessage, 'success');
          }
          broadcastSyncEvent('DATA_MUTATED');
          if (!data.snapshot) {
            await refreshFromSheets(true, undefined, { afterWrite: true });
          }
          return { ok: true, data };
        } catch (err: any) {
          const errMsg = err?.message || 'Gagal terhubung ke server.';
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
      handlePossibleGoogleTokenExpiry,
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
      if (handlePossibleGoogleTokenExpiry(res.status, data)) {
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
      return { success: false, error: 'Gagal menghubungi server autentikasi.' };
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
      if (handlePossibleGoogleTokenExpiry(res.status, data)) {
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
      return { success: false, error: 'Gagal menghubungi server autentikasi.' };
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
      if (handlePossibleGoogleTokenExpiry(res.status, data)) {
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
      return { success: false, error: 'Gagal menghubungi server autentikasi.' };
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
      if (handlePossibleGoogleTokenExpiry(res.status, data)) {
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
      return { success: false, error: 'Gagal menghubungi server autentikasi.' };
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
    const targetSessionId = params.sessionId || activeSession?.id;
    const todayStr = getServerNow().toISOString().split('T')[0];

    // Quick duplicate & card validation against current state before queueing 3s batch
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

    // Collect scans in frontend for 3 seconds, then send in one batch request
    return await new Promise<any>((resolve) => {
      setSavingState();
      scanBatchQueueRef.current.push({ params: scanObj, resolve });
      if (!scanBatchTimerRef.current) {
        scanBatchTimerRef.current = setTimeout(() => {
          flushScanBatch();
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

    const res = await runWriteRequest({
      url: '/api/students',
      method: 'DELETE',
      body: { nisses },
      successMessage: `${nisses.length} siswa ditandai dihapus di Google Sheets.`,
    });
    return res.ok;
  };

  const clearAllStudents = async () => {
    const res = await runWriteRequest({
      url: '/api/students',
      method: 'DELETE',
      body: { action: 'clear_all' },
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

    const CHUNK_SIZE = 150;
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalClassesCreated = 0;
    let lastSnapshot: any = null;
    let lastServerTime: string | undefined;

    try {
      for (let i = 0; i < newStudents.length; i += CHUNK_SIZE) {
        const chunk = newStudents.slice(i, i + CHUNK_SIZE);

        const sendChunk = async (tokOverride?: string) => {
          const res = await apiFetch('/api/students?action=batch_import', {
            method: 'POST',
            headers: buildApiHeaders({ 'Content-Type': 'application/json' }, undefined, tokOverride),
            body: JSON.stringify({ students: chunk }),
          });
          const data = await res.json().catch(() => ({}));
          return { res, data };
        };

        let { res, data } = await sendChunk();
        if (handlePossibleGoogleTokenExpiry(res.status, data)) {
          const msg = data.error || 'Sesi Google berakhir. Silakan masuk ulang.';
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
      }

      if (lastSnapshot) {
        applyDatabaseSnapshot(lastSnapshot, lastServerTime);
      } else {
        await refreshFromSheets(true, undefined, { afterWrite: true });
      }
      setSavedState('Tersimpan & Tersinkron');
      broadcastSyncEvent('DATA_MUTATED');

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
        successMessage: 'Pengaturan aplikasi berhasil disimpan ke Google Sheets.',
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
        body: updates,
        successMessage: 'Pengaturan notifikasi email tersimpan ke Google Sheets.',
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
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }, undefined, tokOverride),
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };

      let { res, data } = await executeTestEmail();
      if (handlePossibleGoogleTokenExpiry(res.status, data)) {
        return { success: false, message: data.error || 'Sesi Google berakhir.' };
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
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }, undefined, tokOverride),
          body: JSON.stringify({ classId }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };

      let { res, data } = await executeWeeklyRecap();
      if (handlePossibleGoogleTokenExpiry(res.status, data)) {
        return { success: false, message: data.error || 'Sesi Google berakhir.' };
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
        needsGoogleAuth,
        isGoogleSigningIn,
        googleAccessToken,
        googleUser,
        connectGoogleAccount,
        disconnectGoogleAccount,
        appsScriptUrl,
        isConnectingAppsScript,
        connectAppsScript,
        disconnectAppsScript,
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
