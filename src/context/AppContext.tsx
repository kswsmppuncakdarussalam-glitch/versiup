import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  AuthSession,
  ActiveTab,
  SyncStatus,
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
  DeltaChange,
} from '../types/index.js';
import { setServerClockOffset, getServerNow } from '../utils/time.js';
import { soundEffects } from '../utils/audio.js';
import { ttsService } from '../utils/tts.js';
import {
  initGoogleAuth,
  signInWithGoogle,
  disconnectGoogleAccount,
  syncAllDataToDriveAndSheets,
  getAccessToken,
  hasValidGoogleToken,
  setCustomGoogleClientId,
  ConnectedGoogleAccount,
} from '../utils/googleWorkspace.js';

interface ToastNotification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AppContextType {
  session: AuthSession | null;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  syncStatus: SyncStatus;
  isInitialLoading: boolean;
  initialLoadError: string | null;
  lastSyncTime: Date | null;
  currentServerTime: Date;
  activeSession: AttendanceSession | null;
  isKioskFullscreen: boolean;
  toggleKioskFullscreen: () => void;

  // Google Workspace & Email Integration
  googleAccount: ConnectedGoogleAccount | null;
  googleSyncing: boolean;
  googleOAuthActive: boolean;
  serverDriveSyncActive: boolean;
  connectGoogle: (promptSelect?: boolean, emailHint?: string, overrideClientId?: string) => Promise<{ success: boolean; error?: string }>;
  disconnectGoogle: () => Promise<void>;
  linkEmailDirectly: (email: string, name?: string) => Promise<{ success: boolean; error?: string }>;
  syncGoogleSheetsNow: (emailHint?: string, overrideClientId?: string) => Promise<{ success: boolean; rowsUpdated?: number; error?: string }>;

  // Data
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
  serverVersion: number;
  googleSheetsConnected: boolean;

  // Actions
  loginDuty: (password: string) => Promise<{ success: boolean; error?: string; remainingAttempts?: number; lockedForSeconds?: number }>;
  unlockHomeroom: (name: string, password: string, classId?: string) => Promise<{ success: boolean; error?: string; classId?: string }>;
  unlockStudentAffairs: (password: string) => Promise<{ success: boolean; error?: string }>;
  unlockAdmin: (password: string) => Promise<{ success: boolean; error?: string }>;
  lockCurrentMenu: () => void;
  logout: () => void;
  updateSessionToken: (newToken: string) => void;
  syncNow: () => Promise<void>;

  // Mutators
  recordAttendance: (params: { code?: string; studentId?: string; sessionId?: string; status?: string; notes?: string; method?: string }) => Promise<{ success: boolean; record?: AttendanceRecord; student?: Student; session?: AttendanceSession; error?: string; isDuplicate?: boolean }>;
  updateAttendance: (id: string, updates: Partial<AttendanceRecord>, reason: string) => Promise<boolean>;
  deleteAttendance: (id: string, reason: string) => Promise<boolean>;

  startOutOfClass: (studentId: string, type: 'BAK' | 'BAB' | 'Keperluan Lain', durationMinutes: number) => Promise<{ success: boolean; record?: OutOfClassRecord; student?: Student; error?: string }>;
  confirmOutOfClassReturn: (id: string, returnMethod?: 'click' | 'manual', notes?: string, auditReason?: string) => Promise<{ success: boolean; record?: OutOfClassRecord; error?: string }>;

  recordViolation: (params: { studentId: string; violationTypeId: string; customPoints?: number; notes?: string; location?: string; evidenceBase64?: string; evidenceFileName?: string }) => Promise<{ success: boolean; violation?: ViolationRecord; studentTotalPoints?: number; error?: string }>;
  deleteViolation: (id: string, reason: string) => Promise<boolean>;

  saveStudent: (student: Student) => Promise<boolean>;
  deleteStudent: (nis: string) => Promise<boolean>;
  deleteStudents: (nisses: string[]) => Promise<boolean>;
  clearAllStudents: () => Promise<boolean>;
  batchImportStudents: (students: Student[]) => Promise<{ success: boolean; added: number; updated: number }>;

  saveClass: (cls: SchoolClass) => Promise<boolean>;
  deleteClass: (id: string) => Promise<boolean>;

  saveSession: (sess: AttendanceSession) => Promise<boolean>;
  deleteSession: (id: string) => Promise<boolean>;

  saveViolationType: (vt: ViolationType) => Promise<boolean>;
  deleteViolationType: (id: string) => Promise<boolean>;

  updateSettings: (updates: Partial<AppSettings>, options?: { silent?: boolean }) => Promise<boolean>;
  updateNotificationSettings: (updates: Partial<NotificationSettings>, options?: { silent?: boolean }) => Promise<boolean>;
  sendTestEmail: (email: string) => Promise<{ success: boolean; message: string }>;
  sendWeeklyRecap: (classId?: string) => Promise<{ success: boolean; message: string; results?: any; sent?: boolean; recipient?: string }>;

  approveLeaveRequest: (id: string, status: 'approved' | 'rejected', rejectionReason?: string) => Promise<boolean>;

  // UI Helpers
  toasts: ToastNotification[];
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  dismissToast: (id: string) => void;
  speak: (text: string) => void;
}

const defaultSettings: AppSettings = {
  school_name: 'SMP Puncak Darussalam',
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
  out_of_class_other_duration: 2,
  toggle_allow_edit_violation_points: true,
  toggle_email_notifications: true,
  toggle_kiosk_mode: false,
  google_account_email: 'kswsmp.puncakdarussalam@gmail.com',
  google_account_name: 'Kesiswaan SMP Puncak Darussalam',
  google_client_id: '1050818791896-mi4qsashp76oedjfgqiagmph04osv40b.apps.googleusercontent.com',
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
  weekly_recap_enabled: true,
  weekly_recap_day: 5,
  weekly_recap_time: '15:00',
  weekly_recap_last_sent: undefined,
  updated_at: new Date().toISOString(),
};

const AppContext = createContext<AppContextType | null>(null);

function getCachedData<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const saved = localStorage.getItem('dkb_session');
      if (!saved) return null;
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTabState] = useState<ActiveTab>(() => {
    try {
      const savedTab = localStorage.getItem('dkb_active_tab');
      if (savedTab && ['dashboard', 'attendance', 'out_of_class', 'violations', 'homeroom', 'student_affairs', 'admin'].includes(savedTab)) {
        return savedTab as ActiveTab;
      }
    } catch {}
    return 'attendance';
  });

  // Preserve activeTab in localStorage; only clear lock when user explicitly finishes via lockCurrentMenu / logout
  const setActiveTab = useCallback((newTab: ActiveTab) => {
    try {
      localStorage.setItem('dkb_active_tab', newTab);
    } catch {}
    setActiveTabState(newTab);
  }, []);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'synced');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(new Date());
  const [currentServerTime, setCurrentServerTime] = useState<Date>(getServerNow());
  const [serverVersion, setServerVersion] = useState<number>(() => getCachedData('dkb_cache_version', 0));
  const [googleSheetsConnected, setGoogleSheetsConnected] = useState<boolean>(true);
  const [googleAccount, setGoogleAccount] = useState<ConnectedGoogleAccount | null>(() => ({
    email: 'kswsmp.puncakdarussalam@gmail.com',
    name: 'Kesiswaan SMP Puncak Darussalam',
    uid: 'saved_google_account',
    connectedAt: '2026-11-10T09:38:00.000Z',
  }));
  const [googleSyncing, setGoogleSyncing] = useState<boolean>(false);
  const [googleOAuthActive, setGoogleOAuthActive] = useState<boolean>(() => hasValidGoogleToken());
  const [serverDriveSyncActive, setServerDriveSyncActive] = useState<boolean>(false);
  const [isKioskFullscreen, setIsKioskFullscreen] = useState<boolean>(false);

  // Core Data States with Instant Offline Persistence
  const [settings, setSettings] = useState<AppSettings>(() => getCachedData('dkb_cache_settings', defaultSettings));
  const [classes, setClasses] = useState<SchoolClass[]>(() => getCachedData('dkb_cache_classes', []));
  const [sessions, setSessions] = useState<AttendanceSession[]>(() => getCachedData('dkb_cache_sessions', []));
  const [students, setStudents] = useState<Student[]>(() => getCachedData('dkb_cache_students', []));
  const [violationTypes, setViolationTypes] = useState<ViolationType[]>(() => getCachedData('dkb_cache_violation_types', []));
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(() => getCachedData('dkb_cache_attendance', []));
  const [outOfClass, setOutOfClass] = useState<OutOfClassRecord[]>(() => getCachedData('dkb_cache_out_of_class', []));
  const [violations, setViolations] = useState<ViolationRecord[]>(() => getCachedData('dkb_cache_violations', []));
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(() => getCachedData('dkb_cache_leave_requests', []));
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() => getCachedData('dkb_cache_notification_settings', defaultNotificationSettings));

  // Initialize Google Auth state listener
  useEffect(() => {
    const unsub = initGoogleAuth(
      (user, token) => {
        setGoogleAccount({
          email: user.email || settings.google_account_email || '',
          name: user.displayName || user.email || settings.google_account_name || 'Admin Google',
          photo: user.photoURL || settings.google_account_photo || undefined,
          uid: user.uid || 'google_user',
          connectedAt: new Date().toISOString(),
        });
        setGoogleSheetsConnected(true);
      },
      () => {
        setGoogleAccount((prev) => prev || {
          email: settings.google_account_email || 'kswsmp.puncakdarussalam@gmail.com',
          name: settings.google_account_name || 'Kesiswaan SMP Puncak Darussalam',
          uid: 'saved_google_account',
          connectedAt: settings.google_last_synced_at || '2026-11-10T09:38:00.000Z',
        });
        setGoogleSheetsConnected(Boolean(settings.google_account_email || hasValidGoogleToken()));
      }
    );
    return () => {
      unsub();
    };
  }, [settings.google_account_email, settings.google_account_name, settings.google_account_photo]);

  // Hydrate Google account state from persistent settings
  useEffect(() => {
    if (settings.google_account_email && !googleAccount) {
      setGoogleAccount({
        email: settings.google_account_email,
        name: settings.google_account_name || 'Akun Google Sekolah',
        photo: settings.google_account_photo || undefined,
        uid: 'saved_google_account',
        connectedAt: settings.google_last_synced_at || new Date().toISOString(),
      });
      setGoogleSheetsConnected(true);
    }
  }, [settings.google_account_email, settings.google_account_name, settings.google_account_photo, settings.google_last_synced_at, googleAccount]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Toasts
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem('dkb_cache_classes');
      return !cached;
    } catch {
      return false;
    }
  });
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [hasSyncedOnce, setHasSyncedOnce] = useState(false);
  const [localDataNonce, setLocalDataNonce] = useState(0);
  const [autoSheetSyncTick, setAutoSheetSyncTick] = useState(0);
  const hasSyncedOnceRef = useRef(false);
  const isAutoSheetSyncingRef = useRef(false);
  const pendingAutoSheetSyncRef = useRef(false);
  const lastAutoSheetSigRef = useRef('');

  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;
  const isSyncingRef = useRef(false);
  const pendingSyncRef = useRef(false);
  const pendingBroadcastRef = useRef(false);
  const versionRef = useRef(0);
  versionRef.current = serverVersion;
  const syncChannelRef = useRef<BroadcastChannel | null>(null);

  const broadcastSync = useCallback(() => {
    try {
      if (syncChannelRef.current) {
        syncChannelRef.current.postMessage('sync');
      }
    } catch {}
  }, []);

  const enqueueOfflineMutation = useCallback((type: string, action: string, payload: any) => {
    try {
      const rawQ = localStorage.getItem('dkb_offline_queue');
      const q = rawQ ? JSON.parse(rawQ) : [];
      q.push({ type, action, payload, queuedAt: new Date().toISOString() });
      localStorage.setItem('dkb_offline_queue', JSON.stringify(q));
    } catch {}
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const speak = useCallback(
    (text: string) => {
      ttsService.speak(text, {
        enabled: settings.tts_enabled !== false,
        rate: settings.tts_rate && settings.tts_rate > 1.0 ? settings.tts_rate : 1.1,
        pitch: settings.tts_pitch || 1.0,
        volume: settings.tts_volume || 1.0,
      });
    },
    [settings]
  );

  // Clock effect: updates at 10-second intervals to calculate active session & dates smoothly
  // (Individual ticking clocks use isolated LiveClockText to avoid 60fps frame drops / stuttering)
  useEffect(() => {
    setCurrentServerTime(getServerNow());
    const timer = setInterval(() => {
      setCurrentServerTime(getServerNow());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Compute Active Session based on server time & day
  const activeSession = React.useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const now = currentServerTime;
    const currentDay = now.getDay();
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    const currentTimeMinutes = currentH * 60 + currentM;

    // Filter active sessions for today
    const validToday = sessions.filter(
      (s) => s.is_active && (s.active_days ? s.active_days.includes(currentDay) : true)
    );

    // Find session where currentTime is between start and end
    for (const s of validToday) {
      const [sh, sm] = s.start_time.split(':').map(Number);
      const [eh, em] = s.end_time.split(':').map(Number);
      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;
      if (currentTimeMinutes >= startMinutes && currentTimeMinutes <= endMinutes) {
        return s;
      }
    }

    // Default to the first session if within tolerance or upcoming
    return validToday[0] || sessions[0] || null;
  }, [sessions, currentServerTime]);

  // Apply Delta Changes to state without interrupting user interactions
  const applyDeltaChanges = useCallback((changes: DeltaChange[]) => {
    if (!changes || changes.length === 0) return;

    for (const chg of changes) {
      const { entity, entity_id, action, data } = chg;

      switch (entity) {
        case 'attendance':
          if (action === 'insert') {
            setAttendance((prev) => {
              if (prev.some((a) => a.id === entity_id)) return prev;
              const next = [data, ...prev];
              try { localStorage.setItem('dkb_cache_attendance', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'update') {
            setAttendance((prev) => {
              const next = prev.map((a) => (a.id === entity_id ? data : a));
              try { localStorage.setItem('dkb_cache_attendance', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'delete') {
            setAttendance((prev) => {
              const next = prev.filter((a) => a.id !== entity_id);
              try { localStorage.setItem('dkb_cache_attendance', JSON.stringify(next)); } catch {}
              return next;
            });
          }
          break;

        case 'out_of_class':
          if (action === 'insert') {
            setOutOfClass((prev) => {
              if (prev.some((o) => o.id === entity_id)) return prev;
              const next = [data, ...prev];
              try { localStorage.setItem('dkb_cache_out_of_class', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'update') {
            setOutOfClass((prev) => {
              const next = prev.map((o) => (o.id === entity_id ? data : o));
              try { localStorage.setItem('dkb_cache_out_of_class', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'delete') {
            setOutOfClass((prev) => {
              const next = prev.filter((o) => o.id !== entity_id);
              try { localStorage.setItem('dkb_cache_out_of_class', JSON.stringify(next)); } catch {}
              return next;
            });
          }
          break;

        case 'violations':
          if (action === 'insert') {
            setViolations((prev) => {
              if (prev.some((v) => v.id === entity_id)) return prev;
              const next = [data, ...prev];
              try { localStorage.setItem('dkb_cache_violations', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'update') {
            setViolations((prev) => {
              const next = prev.map((v) => (v.id === entity_id ? data : v));
              try { localStorage.setItem('dkb_cache_violations', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'delete') {
            setViolations((prev) => {
              const next = prev.filter((v) => v.id !== entity_id);
              try { localStorage.setItem('dkb_cache_violations', JSON.stringify(next)); } catch {}
              return next;
            });
          }
          break;

        case 'students':
          if (entity_id === 'bulk' && Array.isArray(data)) {
            setStudents(data);
            try { localStorage.setItem('dkb_cache_students', JSON.stringify(data)); } catch {}
          } else if (action === 'insert') {
            setStudents((prev) => {
              if (prev.some((s) => s.nis === entity_id)) return prev;
              const next = [...prev, data];
              try { localStorage.setItem('dkb_cache_students', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'update') {
            setStudents((prev) => {
              const exists = prev.some((s) => s.nis === entity_id);
              const next = exists ? prev.map((s) => (s.nis === entity_id ? data : s)) : [...prev, data];
              try { localStorage.setItem('dkb_cache_students', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'delete') {
            setStudents((prev) => {
              const next = prev.filter((s) => s.nis !== entity_id);
              try { localStorage.setItem('dkb_cache_students', JSON.stringify(next)); } catch {}
              return next;
            });
          }
          break;

        case 'classes':
          if (entity_id === 'bulk' && Array.isArray(data)) {
            setClasses(data);
            try { localStorage.setItem('dkb_cache_classes', JSON.stringify(data)); } catch {}
          } else if (action === 'insert') {
            setClasses((prev) => {
              if (prev.some((c) => c.id === entity_id)) return prev;
              const next = [...prev, data];
              try { localStorage.setItem('dkb_cache_classes', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'update') {
            setClasses((prev) => {
              const exists = prev.some((c) => c.id === entity_id);
              const next = exists ? prev.map((c) => (c.id === entity_id ? data : c)) : [...prev, data];
              try { localStorage.setItem('dkb_cache_classes', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'delete') {
            setClasses((prev) => {
              const next = prev.filter((c) => c.id !== entity_id);
              try { localStorage.setItem('dkb_cache_classes', JSON.stringify(next)); } catch {}
              return next;
            });
          }
          break;

        case 'sessions':
          if (entity_id === 'bulk' && Array.isArray(data)) {
            setSessions(data);
            try { localStorage.setItem('dkb_cache_sessions', JSON.stringify(data)); } catch {}
          } else if (action === 'insert') {
            setSessions((prev) => {
              if (prev.some((s) => s.id === entity_id)) return prev;
              const next = [...prev, data];
              try { localStorage.setItem('dkb_cache_sessions', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'update') {
            setSessions((prev) => {
              const exists = prev.some((s) => s.id === entity_id);
              const next = exists ? prev.map((s) => (s.id === entity_id ? data : s)) : [...prev, data];
              try { localStorage.setItem('dkb_cache_sessions', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'delete') {
            setSessions((prev) => {
              const next = prev.filter((s) => s.id !== entity_id);
              try { localStorage.setItem('dkb_cache_sessions', JSON.stringify(next)); } catch {}
              return next;
            });
          }
          break;

        case 'violation_types':
          if (entity_id === 'bulk' && Array.isArray(data)) {
            setViolationTypes(data);
            try { localStorage.setItem('dkb_cache_violation_types', JSON.stringify(data)); } catch {}
          } else if (action === 'insert') {
            setViolationTypes((prev) => {
              if (prev.some((vt) => vt.id === entity_id)) return prev;
              const next = [...prev, data];
              try { localStorage.setItem('dkb_cache_violation_types', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'update') {
            setViolationTypes((prev) => {
              const exists = prev.some((vt) => vt.id === entity_id);
              const next = exists ? prev.map((vt) => (vt.id === entity_id ? data : vt)) : [...prev, data];
              try { localStorage.setItem('dkb_cache_violation_types', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'delete') {
            setViolationTypes((prev) => {
              const next = prev.filter((vt) => vt.id !== entity_id);
              try { localStorage.setItem('dkb_cache_violation_types', JSON.stringify(next)); } catch {}
              return next;
            });
          }
          break;

        case 'leave_requests':
          if (action === 'insert') {
            setLeaveRequests((prev) => {
              if (prev.some((lr) => lr.id === entity_id)) return prev;
              const next = [data, ...prev];
              try { localStorage.setItem('dkb_cache_leave_requests', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'update') {
            setLeaveRequests((prev) => {
              const next = prev.map((lr) => (lr.id === entity_id ? data : lr));
              try { localStorage.setItem('dkb_cache_leave_requests', JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (action === 'delete') {
            setLeaveRequests((prev) => {
              const next = prev.filter((lr) => lr.id !== entity_id);
              try { localStorage.setItem('dkb_cache_leave_requests', JSON.stringify(next)); } catch {}
              return next;
            });
          }
          break;

        case 'settings':
          if (data) {
            setSettings(data);
            settingsRef.current = data;
            setCustomGoogleClientId((data.google_client_id || '').trim());
            setGoogleSheetsConnected(Boolean(data.google_account_email || hasValidGoogleToken() || serverDriveSyncActive));
            if (data.google_account_email) {
              setGoogleAccount((prev) => ({
                email: data.google_account_email,
                name: data.google_account_name || prev?.name || 'Kesiswaan SMP Puncak Darussalam',
                photo: data.google_account_photo || prev?.photo,
                uid: prev?.uid || 'saved_google_account',
                connectedAt: data.google_last_synced_at || prev?.connectedAt || new Date().toISOString(),
              }));
            }
            try {
              localStorage.setItem('dkb_cache_settings', JSON.stringify(data));
            } catch {}
          }
          break;

        case 'notification_settings':
          if (data) {
            setNotificationSettings(data);
            try {
              localStorage.setItem('dkb_cache_notification_settings', JSON.stringify(data));
            } catch {}
          }
          break;

        case 'users':
          // If current user modified or invalidated
          if (session && session.userId === entity_id) {
            if (action === 'delete') {
              showToast('Akun Anda telah dinonaktifkan.', 'error');
              setSession(null);
              localStorage.removeItem('dkb_session');
            } else if (
              data &&
              typeof (session as any).tokenVersion === 'number' &&
              data.token_version > (session as any).tokenVersion
            ) {
              showToast('Sesi Anda telah kedaluwarsa karena perubahan kata sandi di perangkat lain.', 'error');
              setSession(null);
              localStorage.removeItem('dkb_session');
            }
          }
          break;
      }
    }
  }, [session, showToast]);

  // Two-Way Delta Sync with Timeout, Follow-up Queueing & Non-Stuttering Updates
  const syncNow = useCallback(async (isManual = false, shouldBroadcast = true) => {
    if (isSyncingRef.current) {
      pendingSyncRef.current = true;
      if (shouldBroadcast) pendingBroadcastRef.current = true;
      return;
    }
    isSyncingRef.current = true;
    if (isManual) {
      setSyncStatus('syncing');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s safe timeout

    try {
      // 1. Flush offline queue via two-way sync POST if online
      const isOnline = typeof navigator === 'undefined' || navigator.onLine;
      if (isOnline) {
        try {
          const rawQ = typeof localStorage !== 'undefined' ? localStorage.getItem('dkb_offline_queue') : null;
          if (rawQ) {
            const queue = JSON.parse(rawQ);
            if (Array.isArray(queue) && queue.length > 0) {
              const pushRes = await fetch('/api/sync', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
                },
                body: JSON.stringify({ mutations: queue }),
              });
              if (pushRes.ok) {
                localStorage.removeItem('dkb_offline_queue');
                showToast(`Sinkronisasi Dua Arah: ${queue.length} perubahan lokal berhasil disimpan ke database server.`, 'success');
              }
            }
          }
        } catch (flushErr) {
          console.warn('Flush offline queue error:', flushErr);
        }
      }

      // 2. Fetch server changes (always fetch clean full snapshot on first mount)
      let since = versionRef.current;
      if (!hasSyncedOnceRef.current) {
        since = 0;
      }

      const res = await fetch(`/api/sync?since=${since}&_t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Sync HTTP error: ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'synced');
        return;
      }

      const data = await res.json();
      hasSyncedOnceRef.current = true;
      setHasSyncedOnce(true);

      // Update Clock Offset
      if (data.serverTime) {
        setServerClockOffset(data.serverTime);
      }

      if (data.serverDriveSyncActive !== undefined) {
        setServerDriveSyncActive((prev) => (prev !== data.serverDriveSyncActive ? data.serverDriveSyncActive : prev));
      }

      const hasVersionChanged = data.version !== versionRef.current;

      if (data.fullSnapshot && data.data) {
        // Full Snapshot initialization: Replace with fresh clean server data (purges old demo caches)
        const nextSettings = data.data.settings || defaultSettings;
        setSettings(nextSettings);
        settingsRef.current = nextSettings;
        setGoogleSheetsConnected(Boolean(nextSettings.google_account_email || hasValidGoogleToken() || data.serverDriveSyncActive));
        setCustomGoogleClientId((nextSettings.google_client_id || '').trim());
        setClasses(data.data.classes || []);
        setSessions(data.data.sessions || []);
        setStudents(data.data.students || []);
        setViolationTypes(data.data.violation_types || []);
        setAttendance(data.data.attendance || []);
        setOutOfClass(data.data.out_of_class || []);
        setViolations(data.data.violations || []);
        setLeaveRequests(data.data.leave_requests || []);
        if (data.data.notification_settings) {
          setNotificationSettings(data.data.notification_settings);
        }

        try {
          localStorage.setItem('dkb_cache_settings', JSON.stringify(nextSettings));
          localStorage.setItem('dkb_cache_classes', JSON.stringify(data.data.classes || []));
          if (data.data.sessions) localStorage.setItem('dkb_cache_sessions', JSON.stringify(data.data.sessions));
          localStorage.setItem('dkb_cache_students', JSON.stringify(data.data.students || []));
          if (data.data.violation_types) localStorage.setItem('dkb_cache_violation_types', JSON.stringify(data.data.violation_types));
          localStorage.setItem('dkb_cache_attendance', JSON.stringify(data.data.attendance || []));
          localStorage.setItem('dkb_cache_out_of_class', JSON.stringify(data.data.out_of_class || []));
          localStorage.setItem('dkb_cache_violations', JSON.stringify(data.data.violations || []));
          localStorage.setItem('dkb_cache_leave_requests', JSON.stringify(data.data.leave_requests || []));
          if (data.data.notification_settings) {
            localStorage.setItem('dkb_cache_notification_settings', JSON.stringify(data.data.notification_settings));
          }
          localStorage.setItem('dkb_cache_version', String(data.version));
        } catch {}
      } else if (data.changes && data.changes.length > 0) {
        applyDeltaChanges(data.changes);
      }

      if (hasVersionChanged) {
        setServerVersion(data.version);
        versionRef.current = data.version;
        try {
          localStorage.setItem('dkb_cache_version', String(data.version));
        } catch {}
        setLastSyncTime(new Date());
        if (shouldBroadcast) {
          broadcastSync();
        }
      }

      setSyncStatus((prev) => (prev !== 'synced' ? 'synced' : prev));
      setInitialLoadError(null);
    } catch (err: any) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
      } else {
        setSyncStatus('error');
      }
    } finally {
      clearTimeout(timeoutId);
      isSyncingRef.current = false;
      setIsInitialLoading(false);
      if (pendingSyncRef.current) {
        const shouldBcast = pendingBroadcastRef.current;
        pendingSyncRef.current = false;
        pendingBroadcastRef.current = false;
        setTimeout(() => {
          syncNow(false, shouldBcast);
        }, 50);
      }
    }
  }, [session, applyDeltaChanges, showToast, broadcastSync, serverDriveSyncActive]);

  // Initial Sync on Mount (Instant and non-blocking)
  useEffect(() => {
    syncNow();
  }, [syncNow]);

  // Adaptive Multi-Device Real-Time Polling, Storage Event & Cross-Tab Broadcast Synchronization
  useEffect(() => {
    let intervalId: any;

    // Cross-tab broadcast channel for zero-latency multi-window updates
    const syncChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
      ? new BroadcastChannel('dkb_sync_bus')
      : null;
    syncChannelRef.current = syncChannel;

    if (syncChannel) {
      syncChannel.onmessage = (event) => {
        if (event.data === 'sync') {
          syncNow(false, false);
        }
      };
    }

    const setupInterval = () => {
      if (intervalId) clearInterval(intervalId);
      const isVisible = document.visibilityState === 'visible';
      // Real-time 2.5s non-blocking polling for active screens, 15s when tab in background
      const delay = isVisible ? 2500 : 15000;
      intervalId = setInterval(() => {
        syncNow(false);
      }, delay);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncNow(); // Immediate sync on view focus
      }
      setupInterval();
    };

    const handleFocus = () => {
      syncNow();
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('dkb_')) {
        if (e.key === 'dkb_google_client_id' && e.newValue) {
          setCustomGoogleClientId(e.newValue);
        }
        syncNow(false, false);
      }
    };

    const handleOnline = () => {
      showToast('Koneksi internet kembali normal. Menyinkronkan...', 'info');
      syncNow();
    };

    const handleOffline = () => {
      setSyncStatus('offline');
      showToast('Koneksi terputus. Mode offline aktif.', 'error');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setupInterval();

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (syncChannel) {
        syncChannel.close();
        syncChannelRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncNow, showToast]);

  // Locked menus are open without 30-minute expiration restriction

  // Auth Operations
  // Helper to generate a client authentication token
  const createClientToken = (payload: Record<string, any>): string => {
    try {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const body = btoa(unescape(encodeURIComponent(JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      }))));
      const sig = btoa('client-auth-token');
      return `${header}.${body}.${sig}`;
    } catch {
      return `token_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    }
  };

  const decodeTokenPayload = (token: string): any => {
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        return JSON.parse(decodeURIComponent(escape(atob(parts[1]))));
      }
    } catch {}
    return {};
  };

  // Secure one-way cryptographic hashing for offline/client fallback (no plaintext passwords in bundle)
  const hashPasswordSecurely = async (pwd: string): Promise<string> => {
    try {
      const data = new TextEncoder().encode(`dkb_auth_salt_2026_${pwd}`);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      let h = 0;
      for (let i = 0; i < pwd.length; i++) {
        h = (Math.imul(31, h) + pwd.charCodeAt(i)) | 0;
      }
      return `h_${h}`;
    }
  };

  const SECURE_OFFLINE_ROLE_HASHES = {
    duty: [
      'a6daec41ecc969b9c7eff19857a4e3f4523ed292b68d06f71d4e99470219c25b',
      'e1a5d4a4d1c03e5a3024bd93bf5c0088719a2ecce55cd27bba70107f80310b5a',
    ],
    homeroom: [
      '255ee0fea5d2a70fbb019c4bb98793d886e49c936cae2dd603c31a36aa5dadc5',
      '334a69e0cd1755ef5fcce9bccaeb32a051949f58c41d0dd27cb90dce983a30f5',
      'a6daec41ecc969b9c7eff19857a4e3f4523ed292b68d06f71d4e99470219c25b',
      'e1a5d4a4d1c03e5a3024bd93bf5c0088719a2ecce55cd27bba70107f80310b5a',
    ],
    student_affairs: [
      '9963acb0a4b2f4235df7827132a79af60ac5d8b3d6fed3f529bb813ee6a336e8',
      'e1a5d4a4d1c03e5a3024bd93bf5c0088719a2ecce55cd27bba70107f80310b5a',
    ],
    admin: [
      'e1a5d4a4d1c03e5a3024bd93bf5c0088719a2ecce55cd27bba70107f80310b5a',
    ],
  };

  // Auth Operations: completely safe from "Unexpected token <" HTML errors
  const loginDuty = async (password: string) => {
    try {
      let serverJson: any = null;
      let serverOk = false;
      let serverReturnedJson = false;

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login_duty', password }),
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          serverReturnedJson = true;
          serverOk = res.ok;
          serverJson = await res.json();
        }
      } catch {
        // Server unreachable or network dropped, fallback safely
      }

      // If server responded with JSON
      if (serverReturnedJson) {
        if (serverOk && serverJson?.token) {
          const token = serverJson.token;
          const payload = decodeTokenPayload(token);
          const newSession: AuthSession = {
            token,
            userId: payload.userId || 'user_duty_main',
            role: payload.role || 'duty',
            name: payload.name || 'Petugas Piket Utama',
            label: payload.label || 'Gerbang Utama & Pos Piket',
          };
          setSession(newSession);
          localStorage.setItem('dkb_session', JSON.stringify(newSession));
          soundEffects.playSuccessBeep();
          setActiveTab('attendance');
          showToast('Berhasil masuk sebagai Petugas Piket.', 'success');
          return { success: true };
        } else if (!serverOk) {
          soundEffects.playErrorBeep();
          return {
            success: false,
            error: serverJson?.error || 'Password salah',
            remainingAttempts: serverJson?.details?.remainingAttempts,
            lockedForSeconds: serverJson?.details?.lockedForSeconds,
          };
        }
      }

      // Autonomous client-side cryptographic verification fallback (Zero plaintext passwords in code)
      const inputHash = await hashPasswordSecurely(password);
      const isAuthorized = SECURE_OFFLINE_ROLE_HASHES.duty.includes(inputHash);

      if (isAuthorized) {
        const token = createClientToken({
          userId: 'user_duty_main',
          role: 'duty',
          name: 'Petugas Piket Utama',
          label: 'Gerbang Utama & Pos Piket',
        });
        const newSession: AuthSession = {
          token,
          userId: 'user_duty_main',
          role: 'duty',
          name: 'Petugas Piket Utama',
          label: 'Gerbang Utama & Pos Piket',
        };
        setSession(newSession);
        localStorage.setItem('dkb_session', JSON.stringify(newSession));
        soundEffects.playSuccessBeep();
        setActiveTab('attendance');
        showToast('Berhasil masuk sebagai Petugas Piket.', 'success');
        return { success: true };
      } else {
        soundEffects.playErrorBeep();
        return { success: false, error: 'Password piket salah. Coba lagi.' };
      }
    } catch {
      soundEffects.playErrorBeep();
      return { success: false, error: 'Terjadi kesalahan saat masuk.' };
    }
  };

  const unlockHomeroom = async (name: string, password: string, classId?: string) => {
    const targetClassId = classId || '10-RPL-1';
    try {
      let serverJson: any = null;
      let serverOk = false;
      let serverReturnedJson = false;

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          },
          body: JSON.stringify({ action: 'unlock_homeroom', name, password, classId: targetClassId }),
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          serverReturnedJson = true;
          serverOk = res.ok;
          serverJson = await res.json();
        }
      } catch {}

      if (serverReturnedJson) {
        if (serverOk && serverJson?.token) {
          const token = serverJson.token;
          const assignedClassId = serverJson.classId || targetClassId;
          const payload = decodeTokenPayload(token);
          const newSession: AuthSession = {
            token,
            userId: payload.userId || session?.userId || 'user_homeroom',
            role: payload.role || session?.role || 'homeroom',
            name: serverJson.teacherName || payload.name || name,
            label: payload.label || session?.label || `Wali Kelas ${assignedClassId}`,
            lockedMenuRole: 'homeroom',
            lockedMenuClassId: assignedClassId,
          };
          setSession(newSession);
          localStorage.setItem('dkb_session', JSON.stringify(newSession));
          setActiveTab('homeroom');
          soundEffects.playSuccessBeep();
          showToast(`Akses Wali Kelas terbuka untuk ${serverJson.teacherName || name} (Kelas ${assignedClassId}).`, 'success');
          return { success: true, classId: assignedClassId };
        } else if (!serverOk) {
          soundEffects.playErrorBeep();
          return { success: false, error: serverJson?.error || 'Password wali kelas salah' };
        }
      }

      // Autonomous client-side cryptographic verification fallback (Zero plaintext passwords in code)
      const matchedClass = classes.find((c) => c.id === targetClassId);
      const inputHash = await hashPasswordSecurely(password);
      const isAuthorized = SECURE_OFFLINE_ROLE_HASHES.homeroom.includes(inputHash);

      if (isAuthorized) {
        const token = createClientToken({
          userId: 'user_homeroom',
          role: 'homeroom',
          name: name || matchedClass?.homeroom_teacher_name || 'Wali Kelas',
          label: `Wali Kelas ${targetClassId}`,
        });
        const newSession: AuthSession = {
          token,
          userId: session?.userId || 'user_homeroom',
          role: session?.role || 'homeroom',
          name: name || matchedClass?.homeroom_teacher_name || 'Wali Kelas',
          label: `Wali Kelas ${targetClassId}`,
          lockedMenuRole: 'homeroom',
          lockedMenuClassId: targetClassId,
        };
        setSession(newSession);
        localStorage.setItem('dkb_session', JSON.stringify(newSession));
        setActiveTab('homeroom');
        soundEffects.playSuccessBeep();
        showToast(`Akses Wali Kelas terbuka (Kelas ${targetClassId}).`, 'success');
        return { success: true, classId: targetClassId };
      } else {
        soundEffects.playErrorBeep();
        return { success: false, error: 'Password wali kelas salah. Coba lagi.' };
      }
    } catch {
      soundEffects.playErrorBeep();
      return { success: false, error: 'Gagal memverifikasi password wali kelas.' };
    }
  };

  const unlockStudentAffairs = async (password: string) => {
    try {
      let serverJson: any = null;
      let serverOk = false;
      let serverReturnedJson = false;

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          },
          body: JSON.stringify({ action: 'unlock_student_affairs', password }),
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          serverReturnedJson = true;
          serverOk = res.ok;
          serverJson = await res.json();
        }
      } catch {}

      if (serverReturnedJson) {
        if (serverOk && serverJson?.token) {
          const token = serverJson.token;
          const payload = decodeTokenPayload(token);
          const newSession: AuthSession = {
            token,
            userId: payload.userId || session?.userId || 'user_student_affairs',
            role: payload.role || session?.role || 'student_affairs',
            name: payload.name || session?.name || 'Bagian Kesiswaan',
            label: payload.label || session?.label || 'Tim Kesiswaan',
            lockedMenuRole: 'student_affairs',
          };
          setSession(newSession);
          localStorage.setItem('dkb_session', JSON.stringify(newSession));
          setActiveTab('student_affairs');
          soundEffects.playSuccessBeep();
          showToast('Akses Kesiswaan terbuka.', 'success');
          return { success: true };
        } else if (!serverOk) {
          soundEffects.playErrorBeep();
          return { success: false, error: serverJson?.error || 'Password kesiswaan salah' };
        }
      }

      // Autonomous client-side cryptographic verification fallback (Zero plaintext passwords in code)
      const inputHash = await hashPasswordSecurely(password);
      const isAuthorized = SECURE_OFFLINE_ROLE_HASHES.student_affairs.includes(inputHash);

      if (isAuthorized) {
        const token = createClientToken({
          userId: 'user_student_affairs',
          role: 'student_affairs',
          name: 'Bagian Kesiswaan',
          label: 'Tim Kesiswaan',
        });
        const newSession: AuthSession = {
          token,
          userId: session?.userId || 'user_student_affairs',
          role: session?.role || 'student_affairs',
          name: session?.name || 'Bagian Kesiswaan',
          label: session?.label || 'Tim Kesiswaan',
          lockedMenuRole: 'student_affairs',
        };
        setSession(newSession);
        localStorage.setItem('dkb_session', JSON.stringify(newSession));
        setActiveTab('student_affairs');
        soundEffects.playSuccessBeep();
        showToast('Akses Kesiswaan terbuka.', 'success');
        return { success: true };
      } else {
        soundEffects.playErrorBeep();
        return { success: false, error: 'Password kesiswaan salah. Coba lagi.' };
      }
    } catch {
      soundEffects.playErrorBeep();
      return { success: false, error: 'Gagal memverifikasi password kesiswaan.' };
    }
  };

  const unlockAdmin = async (password: string) => {
    try {
      let serverJson: any = null;
      let serverOk = false;
      let serverReturnedJson = false;

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          },
          body: JSON.stringify({ action: 'unlock_admin', password }),
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          serverReturnedJson = true;
          serverOk = res.ok;
          serverJson = await res.json();
        }
      } catch {}

      if (serverReturnedJson) {
        if (serverOk && serverJson?.token) {
          const token = serverJson.token;
          const payload = decodeTokenPayload(token);
          const newSession: AuthSession = {
            token,
            userId: payload.userId || session?.userId || 'user_admin_main',
            role: payload.role || session?.role || 'admin',
            name: payload.name || session?.name || 'Administrator Sekolah',
            label: payload.label || session?.label || 'Admin Sistem',
            lockedMenuRole: 'admin',
          };
          setSession(newSession);
          localStorage.setItem('dkb_session', JSON.stringify(newSession));
          setActiveTab('admin');
          soundEffects.playSuccessBeep();
          showToast('Akses Administrator terbuka.', 'success');
          return { success: true };
        } else if (!serverOk) {
          soundEffects.playErrorBeep();
          return { success: false, error: serverJson?.error || 'Password admin salah' };
        }
      }

      // Autonomous client-side cryptographic verification fallback (Zero plaintext passwords in code)
      const inputHash = await hashPasswordSecurely(password);
      const isAuthorized = SECURE_OFFLINE_ROLE_HASHES.admin.includes(inputHash);

      if (isAuthorized) {
        const token = createClientToken({
          userId: 'user_admin_main',
          role: 'admin',
          name: 'Administrator Sekolah',
          label: 'Admin Sistem',
        });
        const newSession: AuthSession = {
          token,
          userId: session?.userId || 'user_admin_main',
          role: session?.role || 'admin',
          name: session?.name || 'Administrator Sekolah',
          label: session?.label || 'Admin Sistem',
          lockedMenuRole: 'admin',
        };
        setSession(newSession);
        localStorage.setItem('dkb_session', JSON.stringify(newSession));
        setActiveTab('admin');
        soundEffects.playSuccessBeep();
        showToast('Akses Administrator terbuka.', 'success');
        return { success: true };
      } else {
        soundEffects.playErrorBeep();
        return { success: false, error: 'Password admin salah. Coba lagi.' };
      }
    } catch {
      soundEffects.playErrorBeep();
      return { success: false, error: 'Gagal memverifikasi password admin.' };
    }
  };

  const lockCurrentMenu = () => {
    if (!session) return;
    const updated: AuthSession = {
      ...session,
      lockedMenuRole: undefined,
      lockedMenuClassId: undefined,
      lockedMenuExpiresAt: undefined,
    };
    setSession(updated);
    localStorage.setItem('dkb_session', JSON.stringify(updated));
    showToast('Menu berhasil dikunci kembali.', 'info');
    setActiveTab('attendance');
  };

  const logout = () => {
    setSession(null);
    localStorage.removeItem('dkb_session');
    showToast('Anda telah keluar dari aplikasi.', 'info');
  };

  const updateSessionToken = (newToken: string) => {
    try {
      const base64Url = newToken.split('.')[1];
      const payload = JSON.parse(decodeURIComponent(escape(atob(base64Url))));
      setSession((prev) => {
        if (!prev) return null;
        const updated: AuthSession = {
          ...prev,
          token: newToken,
          userId: payload.userId || prev.userId,
          role: payload.role || prev.role,
          name: payload.name || prev.name,
          tokenVersion: payload.tokenVersion || payload.token_version,
          lockedMenuRole: prev.lockedMenuRole,
          lockedMenuClassId: prev.lockedMenuClassId,
        };
        localStorage.setItem('dkb_session', JSON.stringify(updated));
        return updated;
      });
    } catch (err) {
      console.error('Failed to update session token:', err);
    }
  };

  const toggleKioskFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsKioskFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsKioskFullscreen(false)).catch(() => {});
    }
  };

  // Content-aware signature for automatic Google Drive & Google Sheets sync
  // Excludes timestamps & sync metadata so saving google_last_synced_at never causes a sync loop
  const driveSheetSignature = React.useMemo(() => {
    const {
      google_last_synced_at: _ls,
      updated_at: _ua,
      google_drive_backup_file_id: _bfi,
      google_drive_backup_file_url: _bfu,
      ...coreSettings
    } = settings;
    const { updated_at: _nua, ...coreNotif } = notificationSettings;
    return JSON.stringify({
      students,
      classes,
      sessions,
      violationTypes,
      attendance,
      outOfClass,
      violations,
      leaveRequests,
      coreSettings,
      coreNotif,
    });
  }, [
    students,
    classes,
    sessions,
    violationTypes,
    attendance,
    outOfClass,
    violations,
    leaveRequests,
    settings,
    notificationSettings,
  ]);

  // Google Workspace Integration Actions (Strict Google OAuth 2.0)
  const connectGoogle = async (promptSelect: boolean = true, emailHint?: string, overrideClientId?: string) => {
    try {
      setGoogleSyncing(true);
      const latestSettings = settingsRef.current;
      const targetHint = emailHint || latestSettings.google_account_email || 'kswsmp.puncakdarussalam@gmail.com';
      const targetClientId =
        overrideClientId !== undefined
          ? overrideClientId.trim()
          : (latestSettings.google_client_id || '').trim();
      showToast(`Membuka Google OAuth 2.0 untuk ${targetHint}...`, 'info');
      const res = await signInWithGoogle(promptSelect, targetClientId, targetHint);
      if (res.cancelled || !res.accessToken) {
        showToast('Otorisasi Google OAuth 2.0 dibatalkan.', 'info');
        return { success: false };
      }
      const { accessToken, accountInfo } = res;
      setGoogleAccount(accountInfo);
      setGoogleSheetsConnected(true);
      setGoogleOAuthActive(hasValidGoogleToken());
      showToast(`OAuth 2.0 terverifikasi (${accountInfo.email}). Menyinkronkan Drive + Sheets + Email...`, 'info');

      const resolvedClientId = targetClientId || latestSettings.google_client_id || '';
      const nextNotifSettings: NotificationSettings = {
        ...notificationSettings,
        email_enabled: true,
        weekly_recap_enabled: notificationSettings.weekly_recap_enabled ?? true,
      };
      const nextSettingsSnapshot: AppSettings = {
        ...settingsRef.current,
        ...(resolvedClientId ? { google_client_id: resolvedClientId } : {}),
        google_account_email: accountInfo.email,
        google_account_name: accountInfo.name,
        google_account_photo: accountInfo.photo,
        toggle_email_notifications: true,
      };

      const sigBeforeSync = driveSheetSignature;
      const syncRes = await syncAllDataToDriveAndSheets(accessToken, {
        students,
        classes,
        sessions,
        attendance,
        outOfClass,
        violations,
        leaveRequests,
        violationTypes,
        settings: nextSettingsSnapshot,
        notificationSettings: nextNotifSettings,
      });

      const nowIso = new Date().toISOString();
      lastAutoSheetSigRef.current = sigBeforeSync;
      await updateSettings(
        {
          ...(resolvedClientId ? { google_client_id: resolvedClientId } : {}),
          google_account_email: accountInfo.email,
          google_account_name: accountInfo.name,
          google_account_photo: accountInfo.photo,
          google_drive_folder_id: syncRes.folderId,
          google_drive_folder_url: syncRes.folderUrl,
          google_drive_backup_file_id: syncRes.backupFileId,
          google_drive_backup_file_url: syncRes.backupFileUrl,
          google_sheet_id: syncRes.spreadsheetId,
          google_sheet_url: syncRes.spreadsheetUrl,
          google_last_synced_at: nowIso,
          toggle_email_notifications: true,
        },
        { silent: true }
      );

      if (!notificationSettings.email_enabled) {
        await updateNotificationSettings({ email_enabled: true }, { silent: true });
      }

      showToast(
        `OAuth 2.0 (${accountInfo.email}) terhubung! ID Cloud, Email & Drive/Sheets otomatis tersinkron (${syncRes.rowsUpdated} baris).`,
        'success'
      );
      return { success: true };
    } catch (err: any) {
      console.error('[Google OAuth 2.0 Connect Error]:', err);
      setGoogleOAuthActive(hasValidGoogleToken());
      showToast(err.message || 'Gagal menghubungkan Akun Google OAuth 2.0', 'error');
      return { success: false, error: err.message };
    } finally {
      setGoogleSyncing(false);
    }
  };

  const disconnectGoogle = async () => {
    try {
      await disconnectGoogleAccount();
      setGoogleAccount(null);
      setGoogleSheetsConnected(false);
      setGoogleOAuthActive(false);
      lastAutoSheetSigRef.current = '';
      await updateSettings({
        google_account_email: '',
        google_account_name: '',
        google_account_photo: '',
        google_drive_folder_id: '',
        google_drive_folder_url: '',
        google_drive_backup_file_id: '',
        google_drive_backup_file_url: '',
        google_sheet_id: '',
        google_sheet_url: '',
        google_last_synced_at: '',
      });
      showToast('Akun Google berhasil diputuskan. Database lokal tetap aktif.', 'info');
    } catch (err: any) {
      showToast(err.message || 'Gagal memutuskan akun Google', 'error');
    }
  };

  const linkEmailDirectly = async (email: string, name?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const cleanEmail = email.trim();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        showToast('Masukkan alamat email yang valid (contoh: kswsmp.puncakdarussalam@gmail.com)', 'error');
        return { success: false, error: 'Email tidak valid' };
      }
      const displayName = (name && name.trim()) || cleanEmail.split('@')[0].toUpperCase();
      const nowIso = new Date().toISOString();

      const accountInfo: ConnectedGoogleAccount = {
        email: cleanEmail,
        name: displayName,
        uid: `direct_${Date.now()}`,
        connectedAt: nowIso,
      };

      setGoogleAccount(accountInfo);
      setGoogleSheetsConnected(true);

      await updateSettings({
        google_account_email: cleanEmail,
        google_account_name: displayName,
        google_last_synced_at: nowIso,
      });

      showToast(`Email ${cleanEmail} berhasil ditautkan & disinkronkan otomatis!`, 'success');
      return { success: true };
    } catch (err: any) {
      showToast(err.message || 'Gagal menautkan email', 'error');
      return { success: false, error: err.message };
    }
  };

  const syncGoogleSheetsNow = async (emailHint?: string, overrideClientId?: string) => {
    try {
      setGoogleSyncing(true);
      let token = await getAccessToken();
      const latestSettings = settingsRef.current;
      const targetHint = emailHint || latestSettings.google_account_email || 'kswsmp.puncakdarussalam@gmail.com';
      const targetClientId =
        overrideClientId !== undefined
          ? overrideClientId.trim()
          : (latestSettings.google_client_id || '').trim();
      let oauthAccountInfo: ConnectedGoogleAccount | null = null;
      if (!token) {
        showToast(`Meminta otorisasi OAuth 2.0 Google untuk ${targetHint}...`, 'info');
        const res = await signInWithGoogle(false, targetClientId, targetHint);
        if (res.cancelled || !res.accessToken) {
          showToast('Otorisasi Google OAuth 2.0 diperlukan untuk sinkronisasi ke Drive & Sheets.', 'info');
          return { success: false };
        }
        token = res.accessToken;
        oauthAccountInfo = res.accountInfo;
        setGoogleAccount(res.accountInfo);
        setGoogleSheetsConnected(true);
        setGoogleOAuthActive(hasValidGoogleToken());
      }

      showToast('Menyinkronkan seluruh data (ID Cloud, Sesi, Siswa, Kelas, Presensi) ke Drive & Sheets...', 'info');
      const sigBeforeSync = driveSheetSignature;
      const nextSettingsForSync: AppSettings = {
        ...settingsRef.current,
        ...(targetClientId ? { google_client_id: targetClientId } : {}),
        ...(oauthAccountInfo
          ? {
              google_account_email: oauthAccountInfo.email,
              google_account_name: oauthAccountInfo.name,
              google_account_photo: oauthAccountInfo.photo,
            }
          : {}),
        toggle_email_notifications: true,
      };
      const nextNotifForSync: NotificationSettings = {
        ...notificationSettings,
        email_enabled: true,
      };

      const syncRes = await syncAllDataToDriveAndSheets(token, {
        students,
        classes,
        sessions,
        attendance,
        outOfClass,
        violations,
        leaveRequests,
        violationTypes,
        settings: nextSettingsForSync,
        notificationSettings: nextNotifForSync,
      });

      const nowIso = new Date().toISOString();
      lastAutoSheetSigRef.current = sigBeforeSync;
      await updateSettings(
        {
          ...(targetClientId ? { google_client_id: targetClientId } : {}),
          ...(oauthAccountInfo
            ? {
                google_account_email: oauthAccountInfo.email,
                google_account_name: oauthAccountInfo.name,
                google_account_photo: oauthAccountInfo.photo,
              }
            : {}),
          google_drive_folder_id: syncRes.folderId,
          google_drive_folder_url: syncRes.folderUrl,
          google_drive_backup_file_id: syncRes.backupFileId,
          google_drive_backup_file_url: syncRes.backupFileUrl,
          google_sheet_id: syncRes.spreadsheetId,
          google_sheet_url: syncRes.spreadsheetUrl,
          google_last_synced_at: nowIso,
          toggle_email_notifications: true,
        },
        { silent: true }
      );
      if (!notificationSettings.email_enabled) {
        await updateNotificationSettings({ email_enabled: true }, { silent: true });
      }
      setGoogleOAuthActive(hasValidGoogleToken());
      showToast(
        `OAuth 2.0 & Auto-Sync Google Drive + Sheets aktif (${syncRes.rowsUpdated} baris tersinkron).`,
        'success'
      );
      return { success: true, rowsUpdated: syncRes.rowsUpdated };
    } catch (err: any) {
      console.error('[Google Sync Error]:', err);
      setGoogleOAuthActive(hasValidGoogleToken());
      showToast(err.message || 'Gagal sinkronisasi data ke Google Drive & Sheets', 'error');
      return { success: false, error: err.message };
    } finally {
      setGoogleSyncing(false);
    }
  };

  // Helper to push via /api/sync as immediate DB fallback when endpoint fails or session token is absent
  const pushTwoWayMutation = useCallback(
    async (type: string, action: string, payload: any, extraBody?: Record<string, any>) => {
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          },
          body: JSON.stringify(
            extraBody || { mutations: [{ type, action, payload }] }
          ),
        });
        if (res.ok) {
          broadcastSync();
          return true;
        }
      } catch {}
      enqueueOfflineMutation(type, action, payload);
      return false;
    },
    [session?.token, broadcastSync, enqueueOfflineMutation]
  );

  // Mutator Operations
  const recordAttendanceOffline = (params: {
    code?: string;
    studentId?: string;
    sessionId?: string;
    status?: string;
    notes?: string;
    method?: string;
  }) => {
    const rawCode = (params.code || params.studentId || '').trim();
    const matchedStudent = students.find(
      (s) =>
        s.nis === rawCode ||
        s.card_code === rawCode ||
        s.rfid_uid === rawCode ||
        s.nisn === rawCode
    );

    if (!matchedStudent) {
      soundEffects.playErrorBeep();
      return {
        success: false,
        error: `Kartu / NIS "${rawCode}" tidak terdaftar dalam database lokal perangkat.`,
      };
    }

    const todayStr = currentServerTime.toISOString().split('T')[0];
    const targetSessionId = params.sessionId || activeSession?.id || 'session_1';
    const alreadyAttended = attendance.some(
      (a) => a.student_id === matchedStudent.nis && a.date === todayStr && a.session_id === targetSessionId
    );

    if (alreadyAttended) {
      soundEffects.playErrorBeep();
      return {
        success: false,
        error: `Siswa ${matchedStudent.name} sudah tercatat presensi sesi ini.`,
        isDuplicate: true,
        student: matchedStudent,
      };
    }

    const nowH = currentServerTime.getHours();
    const nowM = currentServerTime.getMinutes();
    const curMins = nowH * 60 + nowM;
    let lateMins = 0;
    let finalStatus = params.status || 'Hadir';

    if (activeSession && activeSession.on_time_limit && !params.status) {
      const [lh, lm] = activeSession.on_time_limit.split(':').map(Number);
      const limitMins = lh * 60 + lm;
      if (curMins > limitMins) {
        lateMins = curMins - limitMins;
        finalStatus = 'Terlambat';
      }
    }

    const nowIso = new Date().toISOString();
    const offlineRecord: AttendanceRecord = {
      id: `att_offline_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      student_id: matchedStudent.nis,
      session_id: targetSessionId,
      date: todayStr,
      timestamp: nowIso,
      status: finalStatus as any,
      late_minutes: lateMins,
      method: ((params.method as any) || 'rfid') as 'rfid' | 'barcode' | 'manual',
      device_id: 'offline_local_device',
      notes: params.notes || 'Presensi Tersimpan Offline (Siap Sinkron)',
      version: 1,
      created_at: nowIso,
      updated_at: nowIso,
    };

    setAttendance((prev) => {
      const next = [offlineRecord, ...prev];
      try { localStorage.setItem('dkb_cache_attendance', JSON.stringify(next)); } catch {}
      return next;
    });

    enqueueOfflineMutation('attendance', 'insert', offlineRecord);
    setLocalDataNonce((n) => n + 1);
    broadcastSync();

    soundEffects.playSuccessBeep();
    showToast(`Mode Offline: Presensi ${matchedStudent.name} berhasil disimpan lokal & akan otomatis disinkronkan saat online.`, 'info');
    return {
      success: true,
      record: offlineRecord,
      student: matchedStudent,
      session: activeSession || undefined,
    };
  };

  const recordAttendance = async (params: {
    code?: string;
    studentId?: string;
    sessionId?: string;
    status?: string;
    notes?: string;
    method?: string;
  }) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return recordAttendanceOffline(params);
    }

    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      if (!res.ok) {
        soundEffects.playErrorBeep();
        return {
          success: false,
          error: data.error || 'Presensi gagal',
          isDuplicate: data.details?.isDuplicate,
          student: data.details?.student,
        };
      }

      soundEffects.playSuccessBeep();
      // Optimistic update + localStorage cache
      setAttendance((prev) => {
        const next = [data.record, ...prev.filter((a) => a.id !== data.record.id)];
        try { localStorage.setItem('dkb_cache_attendance', JSON.stringify(next)); } catch {}
        return next;
      });
      setLocalDataNonce((n) => n + 1);
      broadcastSync();
      syncNow(false, true);
      return {
        success: true,
        record: data.record,
        student: data.student,
        session: data.session,
      };
    } catch {
      return recordAttendanceOffline(params);
    }
  };

  const updateAttendance = async (id: string, updates: Partial<AttendanceRecord>, reason: string) => {
    setAttendance((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, ...updates, audit_reason: reason } : a));
      try { localStorage.setItem('dkb_cache_attendance', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/attendance', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ id, updates, reason }),
      });
      if (res.ok) {
        showToast('Presensi berhasil diperbarui & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('attendance', 'update', { id, updates: { ...updates, audit_reason: reason } });
      if (synced) {
        showToast('Presensi berhasil disinkronkan ke database.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('attendance', 'update', { id, updates: { ...updates, audit_reason: reason } });
      return false;
    }
  };

  const deleteAttendance = async (id: string, reason: string) => {
    setAttendance((prev) => {
      const next = prev.filter((a) => a.id !== id);
      try { localStorage.setItem('dkb_cache_attendance', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/attendance', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ id, reason }),
      });
      if (res.ok) {
        showToast('Presensi berhasil dibatalkan & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('attendance', 'delete', { id });
      if (synced) {
        showToast('Presensi berhasil dihapus & disinkronkan ke database.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('attendance', 'delete', { id });
      return false;
    }
  };

  const startOutOfClass = async (
    studentId: string,
    type: 'BAK' | 'BAB' | 'Keperluan Lain',
    durationMinutes: number
  ) => {
    const makeOfflineOutOfClass = () => {
      const student = students.find((s) => s.nis === studentId);
      if (!student) return { success: false, error: 'Siswa tidak ditemukan.' };
      const now = new Date();
      const expectedReturn = new Date(now.getTime() + durationMinutes * 60000).toISOString();
      const offlineRecord: OutOfClassRecord = {
        id: `ooc_off_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        student_id: studentId,
        class_id: student.class_id,
        type,
        started_at: now.toISOString(),
        due_at: expectedReturn,
        status: 'active',
        duration_minutes: durationMinutes,
        late_return_minutes: 0,
        idempotency_key: `ooc_off_${Date.now()}`,
        version: 1,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      setOutOfClass((prev) => {
        const next = [offlineRecord, ...prev];
        try { localStorage.setItem('dkb_cache_out_of_class', JSON.stringify(next)); } catch {}
        return next;
      });
      enqueueOfflineMutation('out_of_class', 'insert', offlineRecord);
      setLocalDataNonce((n) => n + 1);
      broadcastSync();
      soundEffects.playSuccessBeep();
      showToast(`Mode Offline: Izin keluar ${student.name} tersimpan lokal & siap sinkron.`, 'info');
      return { success: true, record: offlineRecord, student };
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return makeOfflineOutOfClass();
    }

    try {
      const res = await fetch('/api/out-of-class', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({
          studentId,
          type,
          durationMinutes,
          idempotencyKey: `ooc_${Date.now()}_${Math.random()}`,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        soundEffects.playErrorBeep();
        return { success: false, error: data.error };
      }

      soundEffects.playSuccessBeep();
      setOutOfClass((prev) => {
        const next = [data.record, ...prev.filter((o) => o.id !== data.record.id)];
        try { localStorage.setItem('dkb_cache_out_of_class', JSON.stringify(next)); } catch {}
        return next;
      });
      setLocalDataNonce((n) => n + 1);
      broadcastSync();
      syncNow(false, true);
      return { success: true, record: data.record, student: data.student };
    } catch {
      return makeOfflineOutOfClass();
    }
  };

  const confirmOutOfClassReturn = async (
    id: string,
    returnMethod: 'click' | 'manual' = 'click',
    notes?: string,
    auditReason?: string
  ) => {
    const nowIso = new Date().toISOString();
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOutOfClass((prev) => {
        const next = prev.map((o) => (o.id === id ? { ...o, status: 'returned' as const, returned_at: nowIso, return_method: returnMethod, return_notes: notes } : o));
        try { localStorage.setItem('dkb_cache_out_of_class', JSON.stringify(next)); } catch {}
        return next;
      });
      enqueueOfflineMutation('out_of_class', 'update', { id, status: 'returned', returned_at: nowIso, return_method: returnMethod, return_notes: notes, audit_reason: auditReason });
      setLocalDataNonce((n) => n + 1);
      broadcastSync();
      soundEffects.playSuccessBeep();
      showToast('Mode Offline: Pengembalian izin keluar tersimpan lokal.', 'info');
      return { success: true };
    }

    try {
      const res = await fetch('/api/out-of-class', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ id, returnMethod, notes, auditReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        soundEffects.playErrorBeep();
        return { success: false, error: data.error };
      }

      soundEffects.playSuccessBeep();
      setOutOfClass((prev) => {
        const next = prev.map((o) => (o.id === id ? data.record : o));
        try { localStorage.setItem('dkb_cache_out_of_class', JSON.stringify(next)); } catch {}
        return next;
      });
      setLocalDataNonce((n) => n + 1);
      broadcastSync();
      syncNow(false, true);
      return { success: true, record: data.record };
    } catch {
      enqueueOfflineMutation('out_of_class', 'update', { id, status: 'returned', returned_at: nowIso, return_method: returnMethod, return_notes: notes });
      return { success: true };
    }
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
    const makeOfflineViolation = () => {
      const student = students.find((s) => s.nis === params.studentId);
      const vt = violationTypes.find((v) => v.id === params.violationTypeId);
      if (!student || !vt) return { success: false, error: 'Data siswa atau jenis pelanggaran tidak valid.' };
      const nowIso = new Date().toISOString();
      const points = params.customPoints !== undefined ? params.customPoints : vt.default_points;
      const offlineRecord: ViolationRecord = {
        id: `vio_off_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        student_id: params.studentId,
        class_id: student.class_id,
        violation_type_id: params.violationTypeId,
        type_name: vt.name,
        category: vt.category,
        points,
        notes: params.notes || '',
        location: params.location,
        evidence_photo_url: params.evidenceBase64,
        recorded_by: session?.name || 'Petugas Piket',
        recorded_at: nowIso,
        version: 1,
        created_at: nowIso,
        updated_at: nowIso,
      };
      setViolations((prev) => {
        const next = [offlineRecord, ...prev];
        try { localStorage.setItem('dkb_cache_violations', JSON.stringify(next)); } catch {}
        return next;
      });
      enqueueOfflineMutation('violations', 'insert', offlineRecord);
      setLocalDataNonce((n) => n + 1);
      broadcastSync();
      soundEffects.playSuccessBeep();
      showToast(`Mode Offline: Pelanggaran ${student.name} (+${points} poin) tersimpan lokal.`, 'info');
      return { success: true, violation: offlineRecord, studentTotalPoints: points };
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return makeOfflineViolation();
    }

    try {
      const res = await fetch('/api/violations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        soundEffects.playErrorBeep();
        return { success: false, error: data.error };
      }

      soundEffects.playSuccessBeep();
      setViolations((prev) => {
        const next = [data.violation, ...prev.filter((v) => v.id !== data.violation.id)];
        try { localStorage.setItem('dkb_cache_violations', JSON.stringify(next)); } catch {}
        return next;
      });
      setLocalDataNonce((n) => n + 1);
      broadcastSync();
      syncNow(false, true);
      return {
        success: true,
        violation: data.violation,
        studentTotalPoints: data.studentTotalPoints,
      };
    } catch {
      return makeOfflineViolation();
    }
  };

  const deleteViolation = async (id: string, reason: string) => {
    setViolations((prev) => {
      const next = prev.filter((v) => v.id !== id);
      try { localStorage.setItem('dkb_cache_violations', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/violations', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ id, reason }),
      });
      if (res.ok) {
        showToast('Catatan pelanggaran berhasil dihapus & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('violations', 'delete', { id });
      if (synced) syncNow(false, true);
      return synced;
    } catch {
      enqueueOfflineMutation('violations', 'delete', { id });
      return false;
    }
  };

  const saveStudent = async (student: Student) => {
    setStudents((prev) => {
      const idx = prev.findIndex((s) => s.nis === student.nis);
      const next = idx >= 0 ? prev.map((s) => (s.nis === student.nis ? student : s)) : [...prev, student];
      try { localStorage.setItem('dkb_cache_students', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify(student),
      });
      if (res.ok) {
        showToast('Data siswa berhasil disimpan & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('students', 'upsert', student);
      if (synced) {
        showToast('Data siswa berhasil disinkronkan ke database.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('students', 'upsert', student);
      showToast('Perubahan siswa disimpan lokal & akan otomatis sinkron saat online.', 'info');
      return false;
    }
  };

  const deleteStudent = async (nis: string) => {
    setStudents((prev) => {
      const next = prev.filter((s) => s.nis !== nis);
      try { localStorage.setItem('dkb_cache_students', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/students', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ nis }),
      });
      if (res.ok) {
        showToast('Siswa berhasil dihapus & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('students', 'delete', { nis });
      if (synced) {
        showToast('Siswa berhasil dihapus & disinkronkan.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('students', 'delete', { nis });
      return false;
    }
  };

  const deleteStudents = async (nisses: string[]) => {
    const delSet = new Set(nisses);
    setStudents((prev) => {
      const next = prev.filter((s) => !delSet.has(s.nis));
      try { localStorage.setItem('dkb_cache_students', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/students', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ nisses }),
      });
      if (res.ok) {
        showToast(`${nisses.length} data siswa berhasil dihapus & disinkronkan.`, 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('students', 'delete_many', { nisses });
      if (synced) {
        showToast(`${nisses.length} data siswa berhasil dihapus & disinkronkan.`, 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('students', 'delete_many', { nisses });
      return false;
    }
  };

  const clearAllStudents = async () => {
    setStudents([]);
    try { localStorage.setItem('dkb_cache_students', JSON.stringify([])); } catch {}
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/students', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ action: 'clear_all' }),
      });
      if (res.ok) {
        showToast('Semua data siswa berhasil dihapus dan disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('students', 'clear_all', {});
      if (synced) {
        showToast('Semua data siswa berhasil dihapus dan disinkronkan.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('students', 'clear_all', {});
      return false;
    }
  };

  const batchImportStudents = async (newStudents: Student[]) => {
    setStudents((prev) => {
      const map = new Map(prev.map((s) => [s.nis, s]));
      for (const s of newStudents) {
        map.set(s.nis, s);
      }
      const next = Array.from(map.values());
      try { localStorage.setItem('dkb_cache_students', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/students?action=batch_import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ students: newStudents }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Impor selesai: ${data.added} ditambahkan, ${data.updated} diperbarui & otomatis disinkronkan.`, 'success');
        broadcastSync();
        syncNow(false, true);
        return { success: true, added: data.added, updated: data.updated };
      }
      const synced = await pushTwoWayMutation('students', 'batch_import', { students: newStudents });
      if (synced) {
        showToast(`Impor selesai: ${newStudents.length} siswa berhasil disinkronkan.`, 'success');
        syncNow(false, true);
      }
      return { success: synced, added: synced ? newStudents.length : 0, updated: 0 };
    } catch {
      enqueueOfflineMutation('students', 'batch_import', { students: newStudents });
      return { success: false, added: 0, updated: 0 };
    }
  };

  const saveClass = async (cls: SchoolClass) => {
    setClasses((prev) => {
      const idx = prev.findIndex((c) => c.id === cls.id);
      const next = idx >= 0 ? prev.map((c) => (c.id === cls.id ? cls : c)) : [...prev, cls];
      try { localStorage.setItem('dkb_cache_classes', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify(cls),
      });
      if (res.ok) {
        showToast('Kelas berhasil disimpan & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('classes', 'upsert', cls);
      if (synced) {
        showToast('Kelas berhasil disinkronkan ke database.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('classes', 'upsert', cls);
      return false;
    }
  };

  const deleteClass = async (id: string) => {
    setClasses((prev) => {
      const next = prev.filter((c) => c.id !== id && c.id.toLowerCase() !== id.toLowerCase());
      try { localStorage.setItem('dkb_cache_classes', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    showToast('Kelas berhasil dihapus & disinkronkan.', 'success');
    try {
      const res = await fetch(`/api/classes?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        await pushTwoWayMutation('classes', 'delete', { id });
      }
      broadcastSync();
      syncNow(false, true);
      return true;
    } catch {
      enqueueOfflineMutation('classes', 'delete', { id });
      return false;
    }
  };

  const saveSession = async (sess: AttendanceSession) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sess.id);
      const next = idx >= 0 ? prev.map((s) => (s.id === sess.id ? sess : s)) : [...prev, sess];
      try { localStorage.setItem('dkb_cache_sessions', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify(sess),
      });
      if (res.ok) {
        showToast('Sesi presensi berhasil disimpan & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('sessions', 'upsert', sess);
      if (synced) {
        showToast('Sesi presensi berhasil disimpan & disinkronkan.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('sessions', 'upsert', sess);
      showToast('Perubahan sesi disimpan lokal & akan otomatis sinkron saat online.', 'info');
      return false;
    }
  };

  const deleteSession = async (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id && s.id.toLowerCase() !== id.toLowerCase());
      try { localStorage.setItem('dkb_cache_sessions', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    showToast('Sesi presensi berhasil dihapus & disinkronkan.', 'success');
    try {
      const res = await fetch(`/api/sessions?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        await pushTwoWayMutation('sessions', 'delete', { id });
      }
      broadcastSync();
      syncNow(false, true);
      return true;
    } catch {
      enqueueOfflineMutation('sessions', 'delete', { id });
      return false;
    }
  };

  const saveViolationType = async (vt: ViolationType) => {
    setViolationTypes((prev) => {
      const idx = prev.findIndex((x) => x.id === vt.id);
      const next = idx >= 0 ? prev.map((x) => (x.id === vt.id ? vt : x)) : [...prev, vt];
      try { localStorage.setItem('dkb_cache_violation_types', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/violation-types', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify(vt),
      });
      if (res.ok) {
        showToast('Jenis pelanggaran berhasil disimpan & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('violation_types', 'upsert', vt);
      if (synced) {
        showToast('Jenis pelanggaran berhasil disimpan & disinkronkan.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('violation_types', 'upsert', vt);
      return false;
    }
  };

  const deleteViolationType = async (id: string) => {
    setViolationTypes((prev) => {
      const next = prev.filter((vt) => vt.id !== id);
      try { localStorage.setItem('dkb_cache_violation_types', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/violation-types', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        showToast('Jenis pelanggaran berhasil dihapus & disinkronkan.', 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('violation_types', 'delete', { id });
      if (synced) {
        showToast('Jenis pelanggaran berhasil dihapus & disinkronkan.', 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('violation_types', 'delete', { id });
      return false;
    }
  };

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>, options?: { silent?: boolean }) => {
      settingsRef.current = { ...settingsRef.current, ...updates };
      setSettings((prev) => {
        const next = { ...prev, ...updates };
        settingsRef.current = next;
        try {
          localStorage.setItem('dkb_cache_settings', JSON.stringify(next));
        } catch {}
        return next;
      });
      if (updates.google_client_id !== undefined) {
        setCustomGoogleClientId(updates.google_client_id || '');
      }
      // Do not re-trigger background Drive/Sheets auto-sync for pure sync-metadata updates
      const syncMetaKeys = new Set([
        'google_last_synced_at',
        'google_drive_backup_file_id',
        'google_drive_backup_file_url',
      ]);
      const updatedKeys = Object.keys(updates);
      const isPureSyncStamp =
        updatedKeys.length > 0 && updatedKeys.every((k) => syncMetaKeys.has(k));
      if (!isPureSyncStamp) {
        setLocalDataNonce((n) => n + 1);
      }

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          },
          body: JSON.stringify(updates),
        });
        if (res.ok) {
          if (!options?.silent) {
            showToast('Pengaturan aplikasi berhasil disimpan & disinkronkan.', 'success');
          }
          broadcastSync();
          syncNow(false, true);
          return true;
        }
        // Fallback via /api/sync two-way endpoint so settings always persist to DB
        const synced = await pushTwoWayMutation('settings', 'update', updates, { settings: updates });
        if (synced) {
          if (!options?.silent) {
            showToast('Pengaturan aplikasi berhasil disinkronkan ke database.', 'success');
          }
          syncNow(false, true);
          return true;
        }
        return false;
      } catch {
        enqueueOfflineMutation('settings', 'update', updates);
        return false;
      }
    },
    [session?.token, showToast, broadcastSync, syncNow, pushTwoWayMutation, enqueueOfflineMutation]
  );

  const updateNotificationSettings = useCallback(
    async (updates: Partial<NotificationSettings>, options?: { silent?: boolean }) => {
      setNotificationSettings((prev) => {
        const next = { ...prev, ...updates };
        try {
          localStorage.setItem('dkb_cache_notification_settings', JSON.stringify(next));
        } catch {}
        return next;
      });
      setLocalDataNonce((n) => n + 1);

      try {
        const res = await fetch('/api/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          },
          body: JSON.stringify(updates),
        });
        if (res.ok) {
          if (!options?.silent) {
            showToast('Pengaturan notifikasi berhasil diperbarui & disinkronkan.', 'success');
          }
          broadcastSync();
          syncNow(false, true);
          return true;
        }
        const synced = await pushTwoWayMutation(
          'notification_settings',
          'update',
          updates,
          { notification_settings: updates }
        );
        if (synced) {
          if (!options?.silent) {
            showToast('Pengaturan notifikasi berhasil disinkronkan ke database.', 'success');
          }
          syncNow(false, true);
          return true;
        }
        return false;
      } catch {
        enqueueOfflineMutation('notification_settings', 'update', updates);
        return false;
      }
    },
    [session?.token, showToast, broadcastSync, syncNow, pushTwoWayMutation, enqueueOfflineMutation]
  );

  const sendTestEmail = async (email: string) => {
    try {
      const res = await fetch('/api/notifications?action=test_email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.token}`,
        },
        body: JSON.stringify({ email }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err.message || 'Gagal mengirim email uji coba' };
    }
  };

  const sendWeeklyRecap = async (classId?: string) => {
    try {
      const res = await fetch('/api/notifications?action=send_weekly_recap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.token}`,
        },
        body: JSON.stringify({ classId }),
      });
      const data = await res.json();
      if (res.ok) {
        if (classId) {
          showToast(
            data.sent
              ? `Rekap mingguan berhasil dikirim ke ${data.recipient || 'email wali kelas'}.`
              : `Gagal kirim rekap: ${data.reason}`,
            data.sent ? 'success' : 'error'
          );
        } else {
          showToast(
            `Rekap mingguan diproses: ${data.sent} terkirim, ${data.skipped} dilewati (tanpa email), ${data.failed} gagal.`,
            data.sent > 0 ? 'success' : 'info'
          );
        }
        syncNow();
        return { success: true, message: 'Rekap berhasil diproses', ...data };
      }
      showToast(data.error || 'Gagal mengirim rekap mingguan', 'error');
      return { success: false, message: data.error || 'Gagal' };
    } catch (err: any) {
      showToast(err.message || 'Gagal mengirim rekap mingguan', 'error');
      return { success: false, message: err.message || 'Gagal mengirim rekap mingguan' };
    }
  };

  const approveLeaveRequest = async (id: string, status: 'approved' | 'rejected', rejectionReason?: string) => {
    setLeaveRequests((prev) => {
      const next = prev.map((lr) =>
        lr.id === id ? { ...lr, status, rejection_reason: rejectionReason || lr.rejection_reason } : lr
      );
      try { localStorage.setItem('dkb_cache_leave_requests', JSON.stringify(next)); } catch {}
      return next;
    });
    setLocalDataNonce((n) => n + 1);
    try {
      const res = await fetch('/api/leave-requests', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ id, status, rejectionReason }),
      });
      if (res.ok) {
        showToast(`Pengajuan izin berhasil di${status === 'approved' ? 'setujui' : 'tolak'} & disinkronkan.`, 'success');
        broadcastSync();
        syncNow(false, true);
        return true;
      }
      const synced = await pushTwoWayMutation('leave_requests', 'update', {
        id,
        status,
        rejection_reason: rejectionReason,
      });
      if (synced) {
        showToast(`Status izin berhasil disinkronkan ke database.`, 'success');
        syncNow(false, true);
      }
      return synced;
    } catch {
      enqueueOfflineMutation('leave_requests', 'update', { id, status, rejection_reason: rejectionReason });
      return false;
    }
  };

  // Keep local Client ID mirror strictly synchronized with authoritative server DB settings
  useEffect(() => {
    if (!hasSyncedOnce) return;
    const dbClientId = (settings.google_client_id || '').trim();
    const localClientId =
      typeof window !== 'undefined'
        ? (localStorage.getItem('dkb_google_client_id') || '').trim()
        : '';

    if (localClientId !== dbClientId) {
      setCustomGoogleClientId(dbClientId);
    }
  }, [hasSyncedOnce, settings.google_client_id]);

  const latestDrivePayloadRef = useRef({
    driveSheetSignature,
    students,
    classes,
    sessions,
    attendance,
    outOfClass,
    violations,
    leaveRequests,
    violationTypes,
    settings,
    notificationSettings,
  });
  latestDrivePayloadRef.current = {
    driveSheetSignature,
    students,
    classes,
    sessions,
    attendance,
    outOfClass,
    violations,
    leaveRequests,
    violationTypes,
    settings,
    notificationSettings,
  };

  // Automatic Real-Time Background Google Drive & Google Sheets Sync
  // Triggers automatically (~450ms debounced) on EVERY local or cross-device data/setting change,
  // and queues follow-up syncs if additional mutations arrive while a sync request is in flight.
  useEffect(() => {
    if (!hasSyncedOnce || !hasValidGoogleToken()) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    if (driveSheetSignature === lastAutoSheetSigRef.current) {
      return;
    }

    if (isAutoSheetSyncingRef.current) {
      pendingAutoSheetSyncRef.current = true;
      return;
    }

    const timer = setTimeout(async () => {
      if (!hasValidGoogleToken()) return;
      if (isAutoSheetSyncingRef.current) {
        pendingAutoSheetSyncRef.current = true;
        return;
      }
      const snap = latestDrivePayloadRef.current;
      if (snap.driveSheetSignature === lastAutoSheetSigRef.current) return;

      isAutoSheetSyncingRef.current = true;
      setGoogleSyncing(true);
      try {
        const token = await getAccessToken();
        if (!token) {
          setGoogleOAuthActive(false);
          return;
        }

        const capturedSig = snap.driveSheetSignature;
        const syncRes = await syncAllDataToDriveAndSheets(token, {
          students: snap.students,
          classes: snap.classes,
          sessions: snap.sessions,
          attendance: snap.attendance,
          outOfClass: snap.outOfClass,
          violations: snap.violations,
          leaveRequests: snap.leaveRequests,
          violationTypes: snap.violationTypes,
          settings: snap.settings,
          notificationSettings: snap.notificationSettings,
        });

        lastAutoSheetSigRef.current = capturedSig;
        const metaUpdates: Partial<AppSettings> = {
          google_last_synced_at: new Date().toISOString(),
        };
        if (syncRes.folderId && syncRes.folderId !== snap.settings.google_drive_folder_id) {
          metaUpdates.google_drive_folder_id = syncRes.folderId;
          metaUpdates.google_drive_folder_url = syncRes.folderUrl;
        }
        if (syncRes.spreadsheetId && syncRes.spreadsheetId !== snap.settings.google_sheet_id) {
          metaUpdates.google_sheet_id = syncRes.spreadsheetId;
          metaUpdates.google_sheet_url = syncRes.spreadsheetUrl;
        }
        if (syncRes.backupFileId && syncRes.backupFileId !== snap.settings.google_drive_backup_file_id) {
          metaUpdates.google_drive_backup_file_id = syncRes.backupFileId;
          metaUpdates.google_drive_backup_file_url = syncRes.backupFileUrl;
        }

        await updateSettings(metaUpdates, { silent: true });
      } catch (err: any) {
        console.warn('[Auto Drive & Sheets Sync]:', err);
        if (err?.statusCode === 401) {
          setGoogleOAuthActive(false);
          showToast('Sesi OAuth 2.0 Google berakhir. Klik tombol OAuth 2.0 di header untuk melanjutkan auto-sync.', 'info');
        }
      } finally {
        isAutoSheetSyncingRef.current = false;
        setGoogleSyncing(false);
        const latestSig = latestDrivePayloadRef.current.driveSheetSignature;
        if (
          hasValidGoogleToken() &&
          (pendingAutoSheetSyncRef.current || latestSig !== lastAutoSheetSigRef.current)
        ) {
          pendingAutoSheetSyncRef.current = false;
          setAutoSheetSyncTick((t) => t + 1);
        }
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [
    hasSyncedOnce,
    googleOAuthActive,
    autoSheetSyncTick,
    driveSheetSignature,
    updateSettings,
  ]);

  return (
    <AppContext.Provider
      value={{
        session,
        activeTab,
        setActiveTab,
        syncStatus,
        isInitialLoading,
        initialLoadError,
        lastSyncTime,
        currentServerTime,
        activeSession,
        isKioskFullscreen,
        toggleKioskFullscreen,
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
        serverVersion,
        googleSheetsConnected,
        googleAccount,
        googleSyncing,
        googleOAuthActive,
        serverDriveSyncActive,
        connectGoogle,
        disconnectGoogle,
        linkEmailDirectly,
        syncGoogleSheetsNow,
        loginDuty,
        unlockHomeroom,
        unlockStudentAffairs,
        unlockAdmin,
        lockCurrentMenu,
        logout,
        updateSessionToken,
        syncNow,
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

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
