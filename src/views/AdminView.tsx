import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Sliders,
  Users,
  Clock,
  BookOpen,
  Key,
  AlertTriangle,
  Palette,
  Volume2,
  Mail,
  RefreshCw,
  FlaskConical,
  FileSpreadsheet,
  FileText,
  Download,
  Upload,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  CreditCard,
  History,
  ShieldCheck,
  AlertCircle,
  Lock,
  Eye,
  EyeOff,
  GraduationCap,
  Shield,
  UserCheck,
  UserCog,
  Folder,
  FolderPlus,
  ExternalLink,
  LogOut,
  Database,
  Image as ImageIcon,
  UploadCloud,
  Sparkles,
  CheckCircle2,
  RotateCcw,
  Maximize2,
  Copy,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import {
  downloadStudentTemplate,
  parseStudentExcel,
  exportToExcel,
  StudentImportRow,
} from '../utils/excel.js';
import { exportToPdf } from '../utils/pdf.js';
import { uploadPhotoToBackend } from '../utils/photo.js';
import { DriveImage } from '../components/common/DriveImage.js';
import { apiFetch } from '../utils/apiClient.js';
import { AppsScriptPanel } from '../components/auth/AppsScriptPanel.js';
import { SystemCheckView } from './SystemCheckView.js';
import {
  SCHOOL_NAME_PRESETS,
  SCHOOL_LOGO_PRESETS,
  LogoPreset,
} from '../utils/logoPresets.js';
import {
  User,
  Student,
  SchoolClass,
  AttendanceSession,
  ViolationType,
  AppSettings,
  NotificationSettings,
} from '../types/index.js';

export const AdminView: React.FC = () => {
  const {
    session,
    settings,
    updateSettings,
    notificationSettings,
    updateNotificationSettings,
    sendTestEmail,
    sendWeeklyRecap,
    students,
    saveStudent,
    deleteStudent,
    deleteStudents,
    clearAllStudents,
    batchImportStudents,
    classes,
    saveClass,
    deleteClass,
    sessions,
    activeSession,
    sessionSchedule,
    saveSession,
    deleteSession,
    violationTypes,
    saveViolationType,
    deleteViolationType,
    attendance,
    outOfClass,
    violations,
    envStatus,
    configError,
    missingEnv,
    appsScriptUrl,
    appsScriptSecretConfigured,
    setActiveTab,
    requestConfirm,
    saveStatus,
    syncStatus,
    lastSyncTime,
    lockCurrentMenu,
    notificationLogs,
    auditLogs,
    speak,
    showToast,
    updateSessionToken,
    refreshAuthSession,
    refreshFromSheets,
  } = useApp();

  const [activeSection, setActiveSection] = useState<
    | 'sessions'
    | 'students'
    | 'classes'
    | 'accounts'
    | 'violations'
    | 'appearance'
    | 'tts'
    | 'notifications'
    | 'sync_status'
    | 'self_test'
    | 'audit_log'
  >(() => (!appsScriptUrl || !appsScriptSecretConfigured || Boolean(configError) ? 'sync_status' : 'students'));

  // Student CRUD & Import states
  const [editingStudent, setEditingStudent] = useState<Partial<Student> | null>(null);
  const [isSavingStudent, setIsSavingStudent] = useState(false);
  const [importRows, setImportRows] = useState<StudentImportRow[] | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImportingStudents, setIsImportingStudents] = useState(false);
  const [printCardStudent, setPrintCardStudent] = useState<Student | null>(null);
  const [selectedStudentNis, setSelectedStudentNis] = useState<Set<string>>(new Set());
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('all');
  const [isClearAllModalOpen, setIsClearAllModalOpen] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [isUploadingStudentPhoto, setIsUploadingStudentPhoto] = useState(false);
  const [ttsPresentInput, setTtsPresentInput] = useState(settings.tts_template_present || '');
  const [ttsLateInput, setTtsLateInput] = useState(settings.tts_template_late || '');
  const ttsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schoolNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDebouncedPatchRef = useRef<Partial<AppSettings>>({});
  const updateSettingsRef = useRef(updateSettings);
  updateSettingsRef.current = updateSettings;

  // Session CRUD state
  const [editingSession, setEditingSession] = useState<Partial<AttendanceSession> | null>(null);
  const [isSavingSession, setIsSavingSession] = useState(false);

  // Class CRUD state
  const [editingClass, setEditingClass] = useState<Partial<SchoolClass> | null>(null);
  const [isSavingClass, setIsSavingClass] = useState(false);

  // Violation Type CRUD state
  const [editingVType, setEditingVType] = useState<Partial<ViolationType> | null>(null);

  // Accounts management state
  const [usersList, setUsersList] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [accountSubCategory, setAccountSubCategory] = useState<'all' | 'duty' | 'homeroom' | 'student_affairs' | 'admin'>('all');

  // Password editing state for any specific account
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<User | null>(null);
  const [targetNewPassword, setTargetNewPassword] = useState('');
  const [targetConfirmPassword, setTargetConfirmPassword] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const updatingPasswordRef = useRef(false);
  updatingPasswordRef.current = updatingPassword;
  const isMountedRef = useRef(true);

  // New account form state
  const [isNewAccountModalOpen, setIsNewAccountModalOpen] = useState(false);
  const [newAccountRole, setNewAccountRole] = useState<'duty' | 'homeroom' | 'student_affairs'>('duty');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountEmail, setNewAccountEmail] = useState('');
  const [newAccountClassId, setNewAccountClassId] = useState(classes[0]?.id || '');
  const [newAccountLabel, setNewAccountLabel] = useState('');
  const [newAccountPassword, setNewAccountPassword] = useState('');

  // Weekly recap states
  const [sendingWeeklyRecap, setSendingWeeklyRecap] = useState(false);
  const [weeklyRecapDay, setWeeklyRecapDay] = useState(notificationSettings.weekly_recap_day ?? 5);
  const [weeklyRecapTime, setWeeklyRecapTime] = useState(notificationSettings.weekly_recap_time || '15:00');
  // School identity & logo management states
  const [schoolNameInput, setSchoolNameInput] = useState(settings.school_name || '');
  const [logoUrlInput, setLogoUrlInput] = useState(settings.logo_url || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingLogo, setIsSavingLogo] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [showClearNameConfirm, setShowClearNameConfirm] = useState(false);
  const [showClearLogoConfirm, setShowClearLogoConfirm] = useState(false);
  const [logoTab, setLogoTab] = useState<'upload' | 'preset' | 'url'>('upload');
  const [previewZoomModal, setPreviewZoomModal] = useState(false);

  // Quick Direct Password Change states (Ubah Langsung Tanpa Tambah Akun)
  const [directAdminPass, setDirectAdminPass] = useState('');
  const [showDirectAdminPass, setShowDirectAdminPass] = useState(false);
  const [isSavingDirectAdmin, setIsSavingDirectAdmin] = useState(false);

  const [directKesiswaanPass, setDirectKesiswaanPass] = useState('');
  const [showDirectKesiswaanPass, setShowDirectKesiswaanPass] = useState(false);
  const [isSavingDirectKesiswaan, setIsSavingDirectKesiswaan] = useState(false);

  const [directHomeroomPass, setDirectHomeroomPass] = useState('');
  const [directHomeroomClassId, setDirectHomeroomClassId] = useState('all');
  const [showDirectHomeroomPass, setShowDirectHomeroomPass] = useState(false);
  const [isSavingDirectHomeroom, setIsSavingDirectHomeroom] = useState(false);

  const [directDutyPass, setDirectDutyPass] = useState('');
  const [showDirectDutyPass, setShowDirectDutyPass] = useState(false);
  const [isSavingDirectDuty, setIsSavingDirectDuty] = useState(false);

  // Sync inputs when settings change from sync or external
  useEffect(() => {
    setSchoolNameInput(settings.school_name || '');
  }, [settings.school_name]);

  useEffect(() => {
    setLogoUrlInput(settings.logo_url || '');
  }, [settings.logo_url]);

  useEffect(() => {
    setTtsPresentInput(settings.tts_template_present || '');
  }, [settings.tts_template_present]);

  useEffect(() => {
    setTtsLateInput(settings.tts_template_late || '');
  }, [settings.tts_template_late]);

  useEffect(() => {
    if (notificationSettings.weekly_recap_day !== undefined) {
      setWeeklyRecapDay(notificationSettings.weekly_recap_day);
    }
    if (notificationSettings.weekly_recap_time) {
      setWeeklyRecapTime(notificationSettings.weekly_recap_time);
    }
  }, [notificationSettings.weekly_recap_day, notificationSettings.weekly_recap_time]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
      if (schoolNameTimerRef.current) clearTimeout(schoolNameTimerRef.current);
      const pendingPatch = pendingDebouncedPatchRef.current;
      pendingDebouncedPatchRef.current = {};
      let hasActiveSession = false;
      try {
        hasActiveSession = Boolean(localStorage.getItem('dkb_session'));
      } catch {
        hasActiveSession = false;
      }
      if (Object.keys(pendingPatch).length > 0 && hasActiveSession) {
        void updateSettingsRef.current(pendingPatch, { silent: true });
      }
    };
  }, []);

  const safeReadJson = async (res: Response): Promise<any> => {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: `Server mengembalikan respons non-JSON (HTTP ${res.status}).` };
    }
  };

  const getAdminHeaders = (extra?: Record<string, string>, overrideToken?: string): Record<string, string> => {
    const appTok = overrideToken || session?.token;
    return {
      ...(appTok ? { Authorization: `Bearer ${appTok}` } : {}),
      ...(extra || {}),
    };
  };

  const fetchAdminWithRetry = async (
    url: string,
    options: RequestInit & { extraHeaders?: Record<string, string>; isBackgroundPoll?: boolean } = {}
  ) => {
    const { extraHeaders, isBackgroundPoll = false, ...rest } = options;
    const sentToken = session?.token || '';
    let res = await apiFetch(url, {
      ...rest,
      headers: getAdminHeaders(extraHeaders, sentToken),
    });
    let data = await safeReadJson(res);

    if (res.status === 401) {
      if (data?.unauthorizedToken || data?.googleDeploymentUnauthorized) {
        window.dispatchEvent(new CustomEvent('dkb-apps-script-unauthorized', { detail: data }));
        return { res, data };
      }
      let hasActiveSession = false;
      try {
        hasActiveSession = Boolean(localStorage.getItem('dkb_session'));
      } catch {
        hasActiveSession = false;
      }
      if (sentToken && isMountedRef.current && hasActiveSession) {
        const refreshedTok = await refreshAuthSession(!isBackgroundPoll, sentToken);
        if (refreshedTok && isMountedRef.current) {
          res = await apiFetch(url, {
            ...rest,
            headers: getAdminHeaders(extraHeaders, refreshedTok),
          });
          data = await safeReadJson(res);
        }
      }
    }
    return { res, data };
  };

  // Fetch all user accounts from server (with automatic 401 session renewal)
  const fetchUsers = async () => {
    if (!session?.token || configError || !appsScriptUrl || !appsScriptSecretConfigured) return;
    if (isMountedRef.current) setLoadingUsers(true);
    try {
      const { res, data } = await fetchAdminWithRetry('/api/auth?action=manage_accounts', {
        isBackgroundPoll: true,
      });
      if (isMountedRef.current && res.ok && Array.isArray(data.users)) {
        setUsersList(data.users);
      }
    } catch {
      // Abaikan gangguan jaringan sementara; pembaruan otomatis berjalan di latar belakang.
    } finally {
      if (isMountedRef.current) setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (
      session?.token &&
      (activeSection === 'accounts' || !usersList.length) &&
      !configError &&
      Boolean(appsScriptUrl) &&
      appsScriptSecretConfigured
    ) {
      void fetchUsers();
    }
  }, [activeSection, session?.token, configError, appsScriptUrl, appsScriptSecretConfigured]);

  useEffect(() => {
    if (activeSection !== 'accounts' || !session?.token || configError || !appsScriptUrl || !appsScriptSecretConfigured) {
      return;
    }
    const timer = window.setInterval(() => {
      if (
        !updatingPasswordRef.current &&
        (typeof document === 'undefined' || document.visibilityState === 'visible')
      ) {
        void fetchUsers();
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeSection, session?.token, configError, appsScriptUrl, appsScriptSecretConfigured]);

  const handleSaveTargetPassword = async (targetUser: User, newPass: string, confirmPass?: string) => {
    if (!newPass || newPass.trim().length < 4) {
      showToast('Password baru minimal 4 karakter.', 'error');
      return;
    }
    if (confirmPass !== undefined && newPass !== confirmPass) {
      showToast('Konfirmasi password tidak cocok.', 'error');
      return;
    }

    setUpdatingPassword(true);
    try {
      const { res, data } = await fetchAdminWithRetry('/api/auth?action=manage_accounts', {
        method: 'POST',
        extraHeaders: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: targetUser.id,
          newPassword: newPass.trim(),
        }),
      });
      if (!res.ok) {
        showToast(data.error || 'Gagal mengubah password.', 'error');
        return;
      }

      if (data.refreshedToken) {
        updateSessionToken(data.refreshedToken);
      }
      showToast('Tersimpan', 'success');

      setTargetNewPassword('');
      setTargetConfirmPassword('');
      setSelectedUserForPassword(null);
      await fetchUsers();
      void refreshFromSheets(true, { afterWrite: true });
    } catch (err: any) {
      showToast(`Terjadi kesalahan: ${err.message}`, 'error');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleDirectRolePasswordChange = async (
    targetRole: 'admin' | 'student_affairs' | 'homeroom' | 'duty',
    newPass: string,
    classId?: string
  ): Promise<boolean> => {
    if (!newPass || newPass.trim().length < 4) {
      showToast('Password baru minimal 4 karakter.', 'error');
      return false;
    }

    setUpdatingPassword(true);
    try {
      const { res, data } = await fetchAdminWithRetry('/api/auth?action=manage_accounts', {
        method: 'POST',
        extraHeaders: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetRole,
          newPassword: newPass.trim(),
          classId: classId === 'all' ? undefined : classId,
          universalHomeroom: targetRole === 'homeroom' && classId === 'all',
        }),
      });
      if (!res.ok) {
        showToast(data.error || 'Gagal mengubah password.', 'error');
        return false;
      }

      if (data.refreshedToken) {
        updateSessionToken(data.refreshedToken);
      }
      showToast('Tersimpan', 'success');

      await fetchUsers();
      void refreshFromSheets(true, { afterWrite: true });
      return true;
    } catch (err: any) {
      showToast(`Terjadi kesalahan: ${err.message}`, 'error');
      return false;
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleCreateNewAccount = async () => {
    if (!newAccountName.trim()) {
      showToast('Nama akun / petugas wajib diisi.', 'error');
      return;
    }
    if (!newAccountPassword || newAccountPassword.length < 4) {
      showToast('Password minimal 4 karakter.', 'error');
      return;
    }

    const payload = {
      id: `user_${newAccountRole}_${Date.now()}`,
      role: newAccountRole,
      name: newAccountName.trim(),
      class_id: newAccountRole === 'homeroom' ? newAccountClassId : undefined,
      label: newAccountLabel.trim() || newAccountName.trim(),
      is_active: true,
    };

    try {
      const { res, data } = await fetchAdminWithRetry('/api/auth?action=manage_accounts', {
        method: 'POST',
        extraHeaders: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: payload,
          newPassword: newAccountPassword.trim(),
        }),
      });
      if (!res.ok) {
        showToast(data.error || 'Gagal membuat akun.', 'error');
        return;
      }

      showToast('Tersimpan', 'success');
      setIsNewAccountModalOpen(false);
      setNewAccountName('');
      setNewAccountLabel('');
      setNewAccountPassword('');
      await fetchUsers();
      void refreshFromSheets(true, { afterWrite: true });
    } catch (err: any) {
      showToast(`Terjadi kesalahan: ${err.message}`, 'error');
    }
  };

  const handleDeleteAccount = async (id: string, name: string) => {
    if (id === 'user_admin_main') {
      showToast('Akun administrator utama tidak dapat dihapus.', 'error');
      return;
    }
    const confirmed = await requestConfirm({
      title: 'Hapus Akun Petugas?',
      message: `Hapus akun "${name}" dari Google Sheets? Tindakan ini tidak dapat dibatalkan.`,
      confirmLabel: 'Ya, Hapus Akun',
    });
    if (!confirmed) return;

    try {
      const { res, data } = await fetchAdminWithRetry('/api/auth?action=manage_accounts', {
        method: 'DELETE',
        extraHeaders: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        showToast(data.error || 'Gagal menghapus akun.', 'error');
        return;
      }
      showToast(`Akun "${name}" telah dihapus.`, 'success');
      await fetchUsers();
      void refreshFromSheets(true, { afterWrite: true });
    } catch (err: any) {
      showToast(`Gagal menghapus akun: ${err.message}`, 'error');
    }
  };

  // Self-Test simulation state
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any>(null);

  // Test email state
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);

  // --- STUDENT IMPORT HANDLER (Bagian 10 Poin 3) ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const fallbackClass = classes[0]?.id || '10-Umum';
      const parsed = await parseStudentExcel(file, fallbackClass);
      
      const seenNisInBatch = new Set<string>();

      const validated: StudentImportRow[] = parsed.map((r) => {
        const errors: string[] = [];
        if (!r.NIS) errors.push('NIS wajib diisi');
        if (seenNisInBatch.has(r.NIS)) errors.push('Duplikat NIS dalam berkas impor');
        seenNisInBatch.add(r.NIS);

        if (!r.Nama) errors.push('Nama wajib diisi');

        // Auto-assign class if missing
        const kelas = r.Kelas?.trim() || fallbackClass;

        if (r.Email_Orang_Tua && !r.Email_Orang_Tua.includes('@')) {
          errors.push('Format email orang tua tidak valid');
        }

        const statusNorm = (r.Status_Keaktifan || '').trim().toLowerCase();
        if (
          statusNorm &&
          ['nonaktif', 'non-aktif', 'tidak aktif', 'keluar', 'mutasi', 'lulus', 'alumni', 'dihapus', 'inactive', 'off', 'false', '0'].includes(statusNorm)
        ) {
          errors.push(`Status siswa tidak aktif (${r.Status_Keaktifan})`);
        }

        return {
          ...r,
          Kelas: kelas,
          isValid: errors.length === 0,
          errors,
        };
      });

      setImportRows(validated);
      setIsImportModalOpen(true);
      // Reset input value so same file can be re-uploaded if needed
      e.target.value = '';
    } catch (err: any) {
      showToast(`Gagal membaca berkas: ${err.message}`, 'error');
    }
  };

  const handleConfirmImport = async () => {
    if (!importRows || isImportingStudents) return;
    const validRows = importRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      showToast('Tidak ada baris data valid untuk diimpor.', 'error');
      return;
    }

    setIsImportingStudents(true);
    try {
      const nowIso = new Date().toISOString();
      const studentsToSave: Student[] = validRows.map((r) => ({
        nis: r.NIS,
        nisn: r.NISN || '',
        name: r.Nama,
        class_id: r.Kelas.trim(),
        gender: r.Jenis_Kelamin || 'L',
        rfid_uid: r.UID_RFID || `RFID-${r.NIS}`,
        card_code: r.Kode_Kartu || r.NIS,
        photo_url: '',
        parent_name: r.Nama_Orang_Tua || '',
        parent_email: r.Email_Orang_Tua || '',
        created_at: nowIso,
        updated_at: nowIso,
      }));

      const res = await batchImportStudents(studentsToSave);
      if (!res.success) {
        showToast(res.error || 'Impor data siswa gagal disimpan. Periksa koneksi & coba lagi.', 'error');
        return;
      }

      setIsImportModalOpen(false);
      setImportRows(null);
      showToast('Tersimpan', 'success');
    } finally {
      setIsImportingStudents(false);
    }
  };

  // Student filtering & bulk deletion handlers
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const matchClass = studentClassFilter === 'all' || s.class_id.toLowerCase() === studentClassFilter.toLowerCase();
      const matchQuery =
        !studentSearchQuery.trim() ||
        s.name.toLowerCase().includes(studentSearchQuery.toLowerCase()) ||
        s.nis.toLowerCase().includes(studentSearchQuery.toLowerCase()) ||
        (s.rfid_uid && s.rfid_uid.toLowerCase().includes(studentSearchQuery.toLowerCase()));
      return matchClass && matchQuery;
    });
  }, [students, studentClassFilter, studentSearchQuery]);

  const toggleSelectAllStudents = () => {
    if (selectedStudentNis.size === filteredStudents.length && filteredStudents.length > 0) {
      setSelectedStudentNis(new Set());
    } else {
      setSelectedStudentNis(new Set(filteredStudents.map((s) => s.nis)));
    }
  };

  const toggleSelectStudent = (nis: string) => {
    setSelectedStudentNis((prev) => {
      const next = new Set(prev);
      if (next.has(nis)) next.delete(nis);
      else next.add(nis);
      return next;
    });
  };

  const handleDeleteSelectedStudents = async () => {
    if (selectedStudentNis.size === 0) return;
    setIsDeletingBulk(true);
    try {
      const ok = await deleteStudents(Array.from(selectedStudentNis));
      if (ok) {
        setSelectedStudentNis(new Set());
      }
    } finally {
      setIsDeletingBulk(false);
    }
  };

  const handleConfirmClearAllStudents = async () => {
    setIsDeletingBulk(true);
    try {
      const ok = await clearAllStudents();
      if (ok) {
        setIsClearAllModalOpen(false);
        setSelectedStudentNis(new Set());
      }
    } finally {
      setIsDeletingBulk(false);
    }
  };

  // --- SELF-TEST CONCURRENCY SIMULATION (Bagian 13 Poin 9) ---
  const runSelfTest = async (testType: 'duplicate_attendance' | 'out_of_class_quota_race') => {
    setSimulationRunning(true);
    setSimulationResult(null);

    try {
      const { data } = await fetchAdminWithRetry('/api/simulate', {
        method: 'POST',
        extraHeaders: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testType }),
      });
      setSimulationResult(data);
    } catch (err: any) {
      setSimulationResult({ error: err.message });
    } finally {
      setSimulationRunning(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Admin Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 flex items-center justify-center font-bold">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Pusat Kontrol Administrator
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Kelola sesi absen, database siswa, jenis pelanggaran, notifikasi email, dan sinkronisasi
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs px-2.5 py-1 rounded font-mono ${
              envStatus.configured
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
            }`}>
              {envStatus.configured ? 'Apps Script Aktif' : 'Konfigurasi Apps Script'}
            </span>
            <button
              type="button"
              onClick={lockCurrentMenu}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 hover:bg-rose-100 dark:hover:bg-rose-900/60 font-semibold text-xs transition-colors shadow-xs"
              title="Kunci Sesi & Kembali ke Menu Awal Login"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Kunci & Keluar ke Login</span>
            </button>
          </div>
        </div>

        {/* Section Navigation Pills */}
        <div className="flex overflow-x-auto gap-2 pt-4 text-xs font-medium">
          {[
            ['students', 'Database Siswa & Impor'],
            ['sessions', 'Sesi Absen & Jadwal'],
            ['classes', 'Kelola Kelas'],
            ['violations', 'Jenis Pelanggaran & Poin'],
            ['accounts', 'Kelola Akun & Password'],
            ['appearance', 'Tampilan & Logo'],
            ['tts', 'Pengaturan TTS'],
            ['notifications', 'Notifikasi Email'],
            ['sync_status', 'Aktivasi, URL Script & Token'],
            ['self_test', 'Pengujian Mandiri (Simulasi)'],
            ['audit_log', 'Audit Log'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveSection(id as any)}
              className={`px-3 py-1.5 rounded whitespace-nowrap transition-colors ${
                activeSection === id
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Notifikasi Apps Script (Dipindahkan ke Menu Admin) */}
        {(configError || !appsScriptUrl || !appsScriptSecretConfigured || missingEnv.length > 0) && (
          <div className="mt-3 px-3.5 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>
                <strong>Notifikasi Apps Script:</strong>{' '}
                {configError || 'URL Web App atau SECRET_TOKEN belum diatur di perangkat ini.'}
              </span>
            </div>
            {activeSection !== 'sync_status' && (
              <button
                type="button"
                onClick={() => setActiveSection('sync_status')}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-rose-600 text-white font-semibold hover:bg-rose-700 shrink-0 self-start sm:self-center"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Buka Koneksi &amp; Cek Sistem</span>
              </button>
            )}
          </div>
        )}

        {/* Live Auto-Refresh & Sheets API Status Strip */}
        <div
          className={`mt-3 px-3 py-2 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
            configError
              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
              : saveStatus.state === 'saving' || syncStatus === 'syncing'
              ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200'
              : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {configError ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            ) : saveStatus.state === 'saving' || syncStatus === 'syncing' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Database className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>
              {configError ? (
                <>
                  <strong>Konfigurasi Server Diperlukan:</strong> {configError}
                </>
              ) : saveStatus.state === 'saving' ? (
                <>
                  <strong>Menyimpan...</strong> Menulis perubahan ke Google Sheets melalui Google Apps Script...
                </>
              ) : (
                <>
                  <strong>Tersimpan • Google Apps Script Web App Aktif:</strong> Semua perubahan ditulis langsung ke Spreadsheet &amp; Drive melalui Apps Script dan tersinkron otomatis real-time (permili detik) ke seluruh tab aktif.
                  {lastSyncTime ? ` (Pembaruan terakhir: ${lastSyncTime.toLocaleTimeString('id-ID')})` : ''}
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 1: DATABASE SISWA, TEMPLATE, & IMPORT (Bagian 10 Poin 3) */}
      {activeSection === 'students' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Basis Data Siswa ({students.length} Siswa Terdaftar)
              </h2>
              <p className="text-slate-500">Unduh template otomatis, deteksi nama/kelas instan, seleksi massal, dan hapus data siswa.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Unduh Template Otomatis */}
              <button
                type="button"
                onClick={() => downloadStudentTemplate(classes)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <Download className="w-3.5 h-3.5 text-blue-600" />
                <span>Unduh Template (.xlsx)</span>
              </button>

              {/* Impor Data Excel */}
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Impor Data Siswa</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {/* Ekspor Excel */}
              <button
                type="button"
                onClick={async () => {
                  await exportToExcel(students, `data_siswa_${Date.now()}`);
                  showToast('Data siswa berhasil diekspor ke Excel.', 'success');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Ekspor Excel</span>
              </button>

              {/* Ekspor PDF */}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const pdfRows = students.map((s, idx) => ({
                      No: idx + 1,
                      NIS: s.nis,
                      Nama: s.name,
                      Kelas: s.class_id,
                      JK: s.gender || 'L',
                      UID_RFID: s.rfid_uid || '-',
                      Orang_Tua: s.parent_name || '-',
                      Email_Ortu: s.parent_email || '-',
                    }));
                    await exportToPdf({
                      data: pdfRows,
                      fileName: `data_siswa_${new Date().toISOString().split('T')[0]}`,
                      title: 'Daftar Basis Data Siswa Terdaftar',
                      schoolName: settings.school_name,
                      orientation: 'landscape',
                    });
                    showToast('Data siswa berhasil diunduh sebagai PDF.', 'success');
                  } catch {
                    showToast('Gagal mengunduh PDF data siswa. Coba lagi.', 'error');
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 font-semibold"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Ekspor PDF</span>
              </button>

              {/* Tambah Manual */}
              <button
                type="button"
                onClick={() => setEditingStudent({
                  nis: '',
                  name: '',
                  class_id: classes[0]?.id || '',
                  gender: 'L',
                  rfid_uid: '',
                  card_code: '',
                  parent_name: '',
                  parent_email: '',
                })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Siswa</span>
              </button>
            </div>
          </div>

          {/* Search, Filter, and Bulk Action Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <input
                type="text"
                value={studentSearchQuery}
                onChange={(e) => setStudentSearchQuery(e.target.value)}
                placeholder="Cari nama siswa, NIS, atau RFID..."
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 w-full sm:w-64 focus:ring-1 focus:ring-slate-900"
              />
              <select
                value={studentClassFilter}
                onChange={(e) => setStudentClassFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium"
              >
                <option value="all">Semua Kelas ({students.length})</option>
                {classes.map((c) => {
                  const count = students.filter((s) => s.class_id.toLowerCase() === c.id.toLowerCase()).length;
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} ({count})
                    </option>
                  );
                })}
              </select>
              {studentSearchQuery && (
                <button
                  type="button"
                  onClick={() => setStudentSearchQuery('')}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              {selectedStudentNis.size > 0 && (
                <button
                  type="button"
                  disabled={isDeletingBulk}
                  onClick={handleDeleteSelectedStudents}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold transition-colors shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus ({selectedStudentNis.size}) Siswa Terpilih</span>
                </button>
              )}

              {students.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsClearAllModalOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold transition-colors"
                  title="Hapus dan kosongkan seluruh data siswa"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Kosongkan Semua Siswa</span>
                </button>
              )}
            </div>
          </div>

          {/* Students Table */}
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                  <th className="w-8 py-2.5 px-2 text-center">
                    <input
                      type="checkbox"
                      checked={filteredStudents.length > 0 && selectedStudentNis.size === filteredStudents.length}
                      onChange={toggleSelectAllStudents}
                      className="rounded border-slate-300 text-slate-900 cursor-pointer"
                      title="Pilih / Batalkan semua siswa di tampilan"
                    />
                  </th>
                  <th className="py-2.5">NIS</th>
                  <th className="py-2.5">Nama Siswa</th>
                  <th className="py-2.5">Kelas</th>
                  <th className="py-2.5">L/P</th>
                  <th className="py-2.5">UID Kartu RFID</th>
                  <th className="py-2.5">Orang Tua / Email</th>
                  <th className="py-2.5">Kartu</th>
                  <th className="py-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      {students.length === 0
                        ? 'Belum ada data siswa. Silakan impor dari Excel atau tambah secara manual.'
                        : 'Tidak ada data siswa yang cocok dengan filter atau pencarian Anda.'}
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((s) => {
                    const isSelected = selectedStudentNis.has(s.nis);
                    return (
                      <tr
                        key={s.nis}
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-rose-50/50 dark:bg-rose-950/20'
                            : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectStudent(s.nis)}
                            className="rounded border-slate-300 text-slate-900 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 font-mono text-[11px] text-slate-400">{s.nis}</td>
                        <td className="py-2 font-semibold text-slate-900 dark:text-white">{s.name}</td>
                        <td className="py-2 text-slate-500">{s.class_id}</td>
                        <td className="py-2">{s.gender}</td>
                        <td className="py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {s.rfid_uid}
                        </td>
                        <td className="py-2 text-slate-500 truncate max-w-[150px]">
                          {s.parent_name || '-'} {s.parent_email ? `(${s.parent_email})` : ''}
                        </td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => setPrintCardStudent(s)}
                            className="text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Cetak</span>
                          </button>
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingStudent(s)}
                              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                              title="Edit Siswa / Ubah Nama"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteStudent(s.nis)}
                              className="p-1 text-slate-400 hover:text-rose-600"
                              title="Hapus Siswa Ini"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 2: SESI ABSEN & PERALIHAN OTOMATIS (Bagian 10 Poin 1 & 2) */}
      {activeSection === 'sessions' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Kelola Sesi Presensi & Peralihan Otomatis
              </h2>
              <p className="text-xs text-slate-500">
                Sesi aktif berganti otomatis berdasarkan jam server pada menu Presensi maupun Google Sheets tanpa perlu campur tangan petugas.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setEditingSession({
                id: `sess_${Date.now()}`,
                name: '',
                start_time: '07:00',
                on_time_limit: '07:30',
                end_time: '08:00',
                active_days: [1, 2, 3, 4, 5],
                late_tolerance_minutes: 15,
                is_active: true,
              })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Sesi</span>
            </button>
          </div>

          {/* Panel Pengaturan Peralihan Sesi Otomatis */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${settings.auto_session_switch !== false ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                  <span className="font-bold text-slate-900 dark:text-white">
                    Engine Peralihan Sesi Otomatis
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    settings.auto_session_switch !== false
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  }`}>
                    {settings.auto_session_switch !== false ? 'OTOMATIS AKTIF' : 'MODE MANUAL'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Sesi aktif saat ini: <strong className="text-slate-900 dark:text-white">{activeSession ? `${activeSession.name} (${activeSession.start_time} - ${activeSession.end_time})` : 'Tidak ada'}</strong>
                  {sessionSchedule.status === 'active' && sessionSchedule.minutesRemaining > 0 && (
                    <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                      • Sisa waktu {sessionSchedule.minutesRemaining} menit
                    </span>
                  )}
                  {sessionSchedule.nextSession && sessionSchedule.nextSession.id !== activeSession?.id && (
                    <span className="ml-1.5 text-slate-500">
                      • Berikutnya: <strong>{sessionSchedule.nextSession.name}</strong> ({sessionSchedule.nextSession.start_time})
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({ auto_session_switch: settings.auto_session_switch === false })
                  }
                  className={`px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                    settings.auto_session_switch !== false
                      ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {settings.auto_session_switch !== false ? 'Otomatis: ON' : 'Otomatis: OFF'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({
                      auto_session_switch_notify: settings.auto_session_switch_notify === false,
                    })
                  }
                  className={`px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                    settings.auto_session_switch_notify !== false
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-900'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {settings.auto_session_switch_notify !== false ? 'Suara & Banner Peralihan: ON' : 'Suara Peralihan: OFF'}
                </button>
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {sessions.map((sess) => {
              const isCurrentlyActive = activeSession?.id === sess.id;
              const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
              const activeDayText = (sess.active_days || [1, 2, 3, 4, 5])
                .map((d) => dayNames[d])
                .filter(Boolean)
                .join(', ');
              return (
                <div
                  key={sess.id}
                  className={`py-3 px-2 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isCurrentlyActive ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white text-sm">{sess.name}</span>
                      <span className="font-mono text-slate-500">({sess.start_time} - {sess.end_time})</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${sess.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                        {sess.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                      {isCurrentlyActive && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950">
                          SEDANG BERJALAN
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500">
                      Batas Tepat Waktu: <span className="font-semibold">{sess.on_time_limit}</span> • Toleransi Terlambat: {sess.late_tolerance_minutes} Menit • Hari: <span className="font-semibold">{activeDayText}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingSession(sess)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors shadow-xs"
                      title="Ubah Parameter & Waktu Sesi Ini"
                    >
                      <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                      <span>Ubah Sesi</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSession(sess.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-all shadow-xs active:scale-95 cursor-pointer"
                      title="Hapus Sesi Ini (Sekali Klik Langsung Terhapus)"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>Hapus Sesi</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 3: KELOLA KELAS & EMAIL WALI KELAS (Admin Mengatur) */}
      {activeSection === 'classes' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-slate-900 dark:text-slate-100" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Kelola Kelas & Email Wali Kelas ({classes.length} Kelas)
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Admin mengatur identitas kelas, wali kelas, serta <strong>alamat email wali kelas</strong> yang digunakan untuk pengiriman laporan rekap presensi per sesi otomatis setiap pekan.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setEditingClass({
                    id: '',
                    name: '',
                    grade: '10',
                    major: '',
                    homeroom_teacher_name: '',
                    homeroom_teacher_email: '',
                    quota_limit: 2,
                  })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Kelas Baru</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                  <th className="py-2.5 px-3">Kode Kelas</th>
                  <th className="py-2.5 px-3">Nama Kelas</th>
                  <th className="py-2.5 px-3">Tingkat & Jurusan</th>
                  <th className="py-2.5 px-3">Nama Wali Kelas</th>
                  <th className="py-2.5 px-3">Email Wali Kelas (Diatur Admin)</th>
                  <th className="py-2.5 px-3 text-center">Kuota Izin</th>
                  <th className="py-2.5 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {classes.map((cls) => {
                  const studentCount = students.filter((s) => s.class_id === cls.id).length;
                  const hasEmail = Boolean(cls.homeroom_teacher_email && cls.homeroom_teacher_email.includes('@'));

                  return (
                    <tr key={cls.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-700 dark:text-slate-300">
                        {cls.id}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                        {cls.name}
                        <span className="text-[10px] text-slate-400 font-normal ml-1.5">
                          ({studentCount} siswa)
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                        Kelas {cls.grade} • {cls.major || '-'}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-200">
                        {cls.homeroom_teacher_name || '-'}
                      </td>
                      <td className="py-2.5 px-3">
                        {hasEmail ? (
                          <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                            <Mail className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="font-mono text-[11px]">{cls.homeroom_teacher_email}</span>
                            <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              Siap Rekap
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span className="text-[11px] font-medium">Belum diatur</span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">
                        {cls.quota_limit || 2} Siswa
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => sendWeeklyRecap(cls.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium transition-colors"
                            title="Kirim laporan rekap presensi per sesi minggu ini ke email wali kelas"
                          >
                            <Mail className="w-3 h-3 text-blue-500" />
                            <span>Kirim Rekap</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingClass(cls)}
                            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                            title="Ubah data kelas & email wali kelas"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteClass(cls.id)}
                            className="p-1.5 rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:hover:bg-rose-900/60 dark:text-rose-400 transition-all shadow-xs active:scale-95 cursor-pointer"
                            title="Hapus Kelas (Sekali Klik Langsung Terhapus)"
                          >
                            <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {activeSection === 'violations' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Kelola Jenis Pelanggaran, Poin & Prestasi
              </h2>
              <p className="text-xs text-slate-500">
                Atur bobot poin default, status aktif, dan jenis prestasi bernilai positif.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setEditingVType({
                id: `vt_${Date.now()}`,
                code: 'NEW-01',
                name: '',
                category: 'ringan',
                default_points: 5,
                is_active: true,
                description: '',
              })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Jenis Pelanggaran</span>
            </button>
          </div>

          {/* Toggle izinkan ubah poin saat input (Bagian 10 Poin 6) */}
          <div className="p-3 rounded bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
            <div>
              <span className="font-semibold text-slate-900 dark:text-white block">
                Izinkan Petugas Mengubah Poin Saat Input Pelanggaran
              </span>
              <span className="text-[11px] text-slate-500">
                Bila dinonaktifkan, poin akan selalu mengikuti nilai default yang telah ditentukan admin.
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.toggle_allow_edit_violation_points}
              onChange={(e) => updateSettings({ toggle_allow_edit_violation_points: e.target.checked })}
              className="w-4 h-4 rounded text-slate-900"
            />
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {violationTypes.map((vt) => (
              <div key={vt.id} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-slate-500">{vt.code}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{vt.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      vt.category === 'prestasi' ? 'bg-emerald-100 text-emerald-800' :
                      vt.category === 'berat' ? 'bg-rose-100 text-rose-800' :
                      vt.category === 'sedang' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-800'
                    }`}>
                      {vt.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{vt.description || 'Tanpa keterangan tambahan'}</p>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`font-mono font-bold ${vt.category === 'prestasi' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {vt.category === 'prestasi' ? `+${vt.default_points}` : `-${vt.default_points}`} Poin
                  </span>

                  <button
                    type="button"
                    onClick={() => setEditingVType(vt)}
                    className="p-1 text-slate-400 hover:text-slate-600"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteViolationType(vt.id)}
                    className="p-1 text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 5: KELOLA AKUN & PASSWORD (Sandi Piket, Sandi Wali Kelas, Sandi Kesiswaan, Sandi Admin Sendiri) */}
      {activeSection === 'accounts' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-6">
          {/* Header & Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-slate-900 dark:text-slate-100" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Kelola Akun & Kata Sandi Aplikasi
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Ubah sandi login aplikasi (piket), sandi wali kelas, sandi kesiswaan, dan sandi administrator sendiri.
                Perubahan sandi otomatis memperbarui token keamanan dan mengakhiri sesi aktif di perangkat lain.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500">
                {loadingUsers ? 'Memuat akun...' : 'Sinkron Real-Time'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNewAccountRole('duty');
                  setNewAccountName('');
                  setNewAccountLabel('');
                  setNewAccountPassword('');
                  setIsNewAccountModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Akun Baru
              </button>
            </div>
          </div>

          {/* QUICK DIRECT ROLE PASSWORD EDITOR (Ubah Sandi Langsung Tanpa Tambah Akun) */}
          <div className="bg-gradient-to-r from-indigo-900/5 via-slate-900/5 to-purple-900/5 dark:from-indigo-950/40 dark:via-slate-900/40 dark:to-purple-950/40 border-2 border-indigo-200 dark:border-indigo-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 dark:border-indigo-900/50 pb-3">
              <div>
                <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-xs">⚡</span>
                  Ubah Langsung Sandi Akses Menu (Tanpa Perlu Tambah Akun / Petugas)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Ubah kata sandi untuk <strong>Kesiswaan</strong>, <strong>Administrator</strong>, <strong>Wali Kelas</strong>, dan <strong>Piket</strong> secara instan dalam 1 klik.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                Aksi Cepat Instan
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* CARD 1: SANDI KESISWAAN */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3 shadow-xs flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs">
                      <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      1. Sandi Kesiswaan
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                      Menu Tatib
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Sandi untuk membuka menu Kesiswaan, data pelanggaran, dan surat peringatan SP.
                  </p>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Password Baru Kesiswaan
                    </label>
                    <div className="relative">
                      <input
                        type={showDirectKesiswaanPass ? 'text' : 'password'}
                        value={directKesiswaanPass}
                        onChange={(e) => setDirectKesiswaanPass(e.target.value)}
                        placeholder="Minimal 4 karakter..."
                        className="w-full px-3 py-2 pr-9 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDirectKesiswaanPass(!showDirectKesiswaanPass)}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showDirectKesiswaanPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSavingDirectKesiswaan || !directKesiswaanPass.trim()}
                  onClick={async () => {
                    setIsSavingDirectKesiswaan(true);
                    const success = await handleDirectRolePasswordChange('student_affairs', directKesiswaanPass);
                    if (success) setDirectKesiswaanPass('');
                    setIsSavingDirectKesiswaan(false);
                  }}
                  className="w-full py-2 rounded bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isSavingDirectKesiswaan ? 'Menyimpan...' : 'Simpan Sandi Kesiswaan'}
                </button>
              </div>

              {/* CARD 2: SANDI ADMINISTRATOR */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3 shadow-xs flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs">
                      <ShieldCheck className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                      2. Sandi Admin
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                      Akses Penuh
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Sandi untuk membuka menu Administrator. Sesi login Anda saat ini langsung diperbarui otomatis.
                  </p>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Password Baru Admin
                    </label>
                    <div className="relative">
                      <input
                        type={showDirectAdminPass ? 'text' : 'password'}
                        value={directAdminPass}
                        onChange={(e) => setDirectAdminPass(e.target.value)}
                        placeholder="Minimal 4 karakter..."
                        className="w-full px-3 py-2 pr-9 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-rose-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDirectAdminPass(!showDirectAdminPass)}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showDirectAdminPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSavingDirectAdmin || !directAdminPass.trim()}
                  onClick={async () => {
                    setIsSavingDirectAdmin(true);
                    const success = await handleDirectRolePasswordChange('admin', directAdminPass);
                    if (success) setDirectAdminPass('');
                    setIsSavingDirectAdmin(false);
                  }}
                  className="w-full py-2 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isSavingDirectAdmin ? 'Menyimpan...' : 'Simpan Sandi Admin'}
                </button>
              </div>

              {/* CARD 3: SANDI WALI KELAS */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3 shadow-xs flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs">
                      <GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      3. Sandi Wali Kelas
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      Presensi Kelas
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Atur sandi untuk seluruh wali kelas sekaligus atau pilih per kelas spesifik.
                  </p>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Target Kelas:
                    </label>
                    <select
                      value={directHomeroomClassId}
                      onChange={(e) => setDirectHomeroomClassId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs mb-2 font-medium"
                    >
                      <option value="all">🌟 Semua Kelas (Sandi Bersama Seluruh Wali Kelas)</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          Kelas {c.name} ({c.homeroom_teacher_name || 'Wali Kelas'})
                        </option>
                      ))}
                    </select>

                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Password Baru Wali Kelas
                    </label>
                    <div className="relative">
                      <input
                        type={showDirectHomeroomPass ? 'text' : 'password'}
                        value={directHomeroomPass}
                        onChange={(e) => setDirectHomeroomPass(e.target.value)}
                        placeholder="Minimal 4 karakter..."
                        className="w-full px-3 py-2 pr-9 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDirectHomeroomPass(!showDirectHomeroomPass)}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showDirectHomeroomPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSavingDirectHomeroom || !directHomeroomPass.trim()}
                  onClick={async () => {
                    setIsSavingDirectHomeroom(true);
                    const success = await handleDirectRolePasswordChange(
                      'homeroom',
                      directHomeroomPass,
                      directHomeroomClassId
                    );
                    if (success) setDirectHomeroomPass('');
                    setIsSavingDirectHomeroom(false);
                  }}
                  className="w-full py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isSavingDirectHomeroom
                    ? 'Menyimpan...'
                    : directHomeroomClassId === 'all'
                    ? 'Simpan Sandi Semua Wali Kelas'
                    : `Simpan Sandi Kelas ${directHomeroomClassId}`}
                </button>
              </div>
            </div>
          </div>

          {/* Sub-category Filter Tabs */}
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-md text-xs">
            <button
              type="button"
              onClick={() => setAccountSubCategory('all')}
              className={`px-3 py-1.5 rounded font-medium transition-colors ${
                accountSubCategory === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Semua Akun ({usersList.length})
            </button>
            <button
              type="button"
              onClick={() => setAccountSubCategory('duty')}
              className={`px-3 py-1.5 rounded font-medium transition-colors inline-flex items-center gap-1.5 ${
                accountSubCategory === 'duty'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Key className="w-3.5 h-3.5 text-blue-500" />
              1. Sandi Login Aplikasi (Piket) ({usersList.filter((u) => u.role === 'duty').length})
            </button>
            <button
              type="button"
              onClick={() => setAccountSubCategory('homeroom')}
              className={`px-3 py-1.5 rounded font-medium transition-colors inline-flex items-center gap-1.5 ${
                accountSubCategory === 'homeroom'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5 text-emerald-500" />
              2. Sandi Wali Kelas ({usersList.filter((u) => u.role === 'homeroom').length})
            </button>
            <button
              type="button"
              onClick={() => setAccountSubCategory('student_affairs')}
              className={`px-3 py-1.5 rounded font-medium transition-colors inline-flex items-center gap-1.5 ${
                accountSubCategory === 'student_affairs'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5 text-purple-500" />
              3. Sandi Kesiswaan ({usersList.filter((u) => u.role === 'student_affairs').length})
            </button>
            <button
              type="button"
              onClick={() => setAccountSubCategory('admin')}
              className={`px-3 py-1.5 rounded font-medium transition-colors inline-flex items-center gap-1.5 ${
                accountSubCategory === 'admin'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-rose-500" />
              4. Sandi Admin Sendiri ({usersList.filter((u) => u.role === 'admin').length})
            </button>
          </div>

          {/* 4 CORE CATEGORY CARDS */}
          <div className="space-y-6">
            {/* KATEGORI 1: SANDI LOGIN APLIKASI (PETUGAS PIKET / GERBANG) */}
            {(accountSubCategory === 'all' || accountSubCategory === 'duty') && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/50 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 flex items-center justify-center font-bold">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        1. Sandi Login Aplikasi (Petugas Piket / Gerbang)
                        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-semibold uppercase">
                          Akses Gerbang
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500">
                        Sandi tunggal yang digunakan petugas di pos gerbang / laptop piket untuk presensi dan izin keluar kelas.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setNewAccountRole('duty');
                      setNewAccountName('');
                      setNewAccountLabel('');
                      setNewAccountPassword('');
                      setIsNewAccountModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tambah Pos Piket Baru
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {usersList
                    .filter((u) => u.role === 'duty')
                    .map((user) => (
                      <div
                        key={user.id}
                        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3.5 space-y-3 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white block text-xs">
                              {user.name}
                            </span>
                            <span className="text-[11px] text-slate-500 block font-mono">
                              ID: {user.id}
                            </span>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-semibold">
                            v{user.token_version || 1}
                          </span>
                        </div>

                        {user.label && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-400">
                            Lokasi / Catatan: <span className="font-medium text-slate-800 dark:text-slate-200">{user.label}</span>
                          </p>
                        )}

                        <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUserForPassword(user);
                              setTargetNewPassword('');
                              setTargetConfirmPassword('');
                              setShowPasswordText(false);
                            }}
                            className="flex-1 py-1.5 px-2.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
                          >
                            <Key className="w-3 h-3" />
                            Ubah Sandi Piket
                          </button>

                          {user.id !== 'user_duty_main' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(user.id, user.name)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                              title="Hapus akun pos piket ini"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* KATEGORI 2: SANDI WALI KELAS */}
            {(accountSubCategory === 'all' || accountSubCategory === 'homeroom') && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/50 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 flex items-center justify-center font-bold">
                      <GraduationCap className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        2. Sandi Wali Kelas (Akses Data Kelas Saya & Rekap)
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-semibold uppercase">
                          Menu 5
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500">
                        Sandi khusus untuk masing-masing wali kelas membuka presensi, rekap kehadiran, dan persetujuan surat izin kelasnya.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setNewAccountRole('homeroom');
                      setNewAccountName('');
                      setNewAccountClassId(classes[0]?.id || '');
                      setNewAccountLabel('');
                      setNewAccountPassword('');
                      setIsNewAccountModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tambah Akun Wali Kelas
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="px-3 py-2">Kelas</th>
                        <th className="px-3 py-2">Nama Wali Kelas</th>
                        <th className="px-3 py-2">Label Akun</th>
                        <th className="px-3 py-2 text-center">Versi Token</th>
                        <th className="px-3 py-2 text-right">Aksi Sandi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                      {usersList
                        .filter((u) => u.role === 'homeroom')
                        .map((user) => (
                          <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2.5">
                              <span className="px-2 py-0.5 rounded font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700">
                                {user.class_id || 'Umum'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-white">
                              {user.name}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 font-mono text-[11px]">
                              {user.label || user.id}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                                v{user.token_version || 1}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right space-x-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedUserForPassword(user);
                                  setTargetNewPassword('');
                                  setTargetConfirmPassword('');
                                  setShowPasswordText(false);
                                }}
                                className="px-2.5 py-1 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold hover:bg-slate-800 inline-flex items-center gap-1"
                              >
                                <Key className="w-3 h-3" />
                                Ubah Sandi
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAccount(user.id, user.name)}
                                className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                                title="Hapus akun wali kelas ini"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* KATEGORI 3: SANDI KESISWAAN */}
            {(accountSubCategory === 'all' || accountSubCategory === 'student_affairs') && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/50 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 flex items-center justify-center font-bold">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        3. Sandi Bagian Kesiswaan & BK
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 font-semibold uppercase">
                          Menu 6
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500">
                        Sandi untuk membuka menu penanganan pelanggaran, surat pemanggilan orang tua, surat peringatan (SP), dan konseling BK.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {usersList
                    .filter((u) => u.role === 'student_affairs')
                    .map((user) => (
                      <div
                        key={user.id}
                        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white block text-sm">
                              {user.name}
                            </span>
                            <span className="text-xs text-slate-500 font-mono">
                              ID: {user.id} • Label: {user.label || 'Kesiswaan'}
                            </span>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 font-mono font-bold">
                            Token: v{user.token_version || 1}
                          </span>
                        </div>

                        <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-400">
                          Catatan: Mengubah sandi ini akan langsung mengakhiri sesi aktif staf kesiswaan di komputer lain demi keamanan data siswa.
                        </div>

                        <div className="pt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUserForPassword(user);
                              setTargetNewPassword('');
                              setTargetConfirmPassword('');
                              setShowPasswordText(false);
                            }}
                            className="w-full sm:w-auto px-4 py-2 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold text-xs hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
                          >
                            <Key className="w-3.5 h-3.5" />
                            Ubah Sandi Kesiswaan
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* KATEGORI 4: SANDI ADMINISTRATOR SENDIRI */}
            {(accountSubCategory === 'all' || accountSubCategory === 'admin') && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/50 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 flex items-center justify-center font-bold">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        4. Sandi Administrator Sendiri
                        <span className="text-[10px] px-2 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-semibold uppercase">
                          Menu 7 Admin
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500">
                        Ubah kata sandi akun Administrator Anda saat ini. Sesi login pada browser Anda akan diperbarui otomatis tanpa terputus, sedangkan sesi di perangkat lain otomatis dikeluarkan.
                      </p>
                    </div>
                  </div>
                </div>

                {usersList
                  .filter((u) => u.role === 'admin')
                  .map((adminUser) => (
                    <div
                      key={adminUser.id}
                      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-4 max-w-2xl shadow-2xs"
                    >
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60">
                        <div>
                          <span className="text-xs text-slate-500 block">Akun Administrator Aktif</span>
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {adminUser.name} ({adminUser.id})
                          </span>
                        </div>
                        <span className="text-xs px-2.5 py-1 rounded bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 font-mono font-bold">
                          Versi Token: v{adminUser.token_version || 1}
                        </span>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div>
                          <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                            Password Baru Administrator (Minimal 4 karakter)
                          </label>
                          <div className="relative">
                            <input
                              type={showPasswordText ? 'text' : 'password'}
                              value={targetNewPassword}
                              onChange={(e) => setTargetNewPassword(e.target.value)}
                              placeholder="Masukkan password baru admin..."
                              className="w-full px-3 py-2 pr-10 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPasswordText(!showPasswordText)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                              {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                            Konfirmasi Password Baru Administrator
                          </label>
                          <input
                            type={showPasswordText ? 'text' : 'password'}
                            value={targetConfirmPassword}
                            onChange={(e) => setTargetConfirmPassword(e.target.value)}
                            placeholder="Ketik ulang password baru admin..."
                            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900"
                          />
                        </div>

                        <div className="p-3 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>
                            <strong>Perhatian Keamanan:</strong> Pastikan Anda mengingat atau mencatat kata sandi baru ini.
                            Setelah disimpan, sesi browser ini langsung diperbarui sehingga Anda tidak akan terlogout.
                          </span>
                        </div>

                        <button
                          type="button"
                          disabled={updatingPassword}
                          onClick={() => handleSaveTargetPassword(adminUser, targetNewPassword, targetConfirmPassword)}
                          className="w-full py-2.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-bold hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors inline-flex items-center justify-center gap-2"
                        >
                          {updatingPassword ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          Simpan Sandi Administrator Sendiri
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Security & Password Policy Info Card */}
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-xs space-y-2">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-slate-500" />
              Keamanan Akun & Kebijakan Sandi Multi-Pengguna:
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              Seluruh kata sandi diamankan menggunakan enkripsi kriptografi satu arah (bcrypt). Administrator dapat mengatur dan memperbarui sandi untuk setiap peran (Piket, Wali Kelas, Kesiswaan, Admin) secara individual melalui tombol &quot;Ubah Sandi&quot; pada daftar akun di atas.
            </p>
          </div>
        </div>
      )}

      {/* SECTION 7: TAMPILAN & LOGO (Pengaturan Nama & Logo Sekolah) */}
      {activeSection === 'appearance' && (
        <div className="space-y-6 text-xs">
          {/* Header Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Palette className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Identitas & Logo Sekolah
                </h2>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  Ubah, hapus, dan tambahkan nama sekolah serta logo resmi. Perubahan otomatis disinkronkan ke Sidebar, Layar Kiosk, Kartu Pelajar, dan Kop Surat.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Tersinkron Real-time
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* CARD 1: NAMA SEKOLAH (Ubah, Tambah, Hapus) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm">Nama Sekolah</h3>
                    <p className="text-[11px] text-slate-500">Identitas utama institusi pendidikan</p>
                  </div>
                </div>
                {settings.school_name ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                    Aktif
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                    Belum Diatur
                  </span>
                )}
              </div>

              {/* Input & Form */}
              <div className="space-y-2">
                <label className="block text-slate-700 dark:text-slate-300 font-semibold">
                  Tulis atau Ubah Nama Sekolah
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={schoolNameInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSchoolNameInput(val);
                      pendingDebouncedPatchRef.current = {
                        ...pendingDebouncedPatchRef.current,
                        school_name: val.trim(),
                      };
                      if (schoolNameTimerRef.current) clearTimeout(schoolNameTimerRef.current);
                      schoolNameTimerRef.current = setTimeout(() => {
                        const { school_name: _ignored, ...rest } = pendingDebouncedPatchRef.current;
                        pendingDebouncedPatchRef.current = rest;
                        if (val.trim() !== (settings.school_name || '').trim()) {
                          updateSettings({ school_name: val.trim() }, { silent: true });
                        }
                      }, 600);
                    }}
                    onBlur={() => {
                      if (schoolNameTimerRef.current) clearTimeout(schoolNameTimerRef.current);
                      const { school_name: _ignored, ...rest } = pendingDebouncedPatchRef.current;
                      pendingDebouncedPatchRef.current = rest;
                      if (schoolNameInput.trim() !== (settings.school_name || '').trim()) {
                        updateSettings({ school_name: schoolNameInput.trim() }, { silent: true });
                      }
                    }}
                    placeholder="Contoh: SMK BISA HEBAT NUSANTARA / SMAN 1..."
                    maxLength={80}
                    className="w-full px-3 py-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                  <span className="absolute right-3 top-3 text-[10px] text-slate-400">
                    {schoolNameInput.length}/80
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Nama ini akan dicetak pada kartu kehadiran siswa, laporan PDF/Excel, dan kop surat peringatan resmi.
                </p>
              </div>

              {/* Action Buttons for Name */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSavingName || schoolNameInput === settings.school_name}
                  onClick={async () => {
                    setIsSavingName(true);
                    try {
                      await updateSettings({ school_name: schoolNameInput.trim() });
                    } finally {
                      setIsSavingName(false);
                    }
                  }}
                  className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isSavingName ? 'Menyimpan...' : 'Simpan Nama'}
                </button>

                {schoolNameInput !== settings.school_name && (
                  <button
                    type="button"
                    onClick={() => setSchoolNameInput(settings.school_name || '')}
                    className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                )}

                {settings.school_name && (
                  <button
                    type="button"
                    onClick={() => setShowClearNameConfirm(true)}
                    className="px-3 py-2 rounded-md border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors flex items-center gap-1 ml-auto"
                    title="Kosongkan nama sekolah"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus Nama
                  </button>
                )}
              </div>

              {/* Quick Preset Names */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  Pilih Cepat Nama Contoh / Rekomendasi:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {SCHOOL_NAME_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setSchoolNameInput(preset)}
                      className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] transition-colors hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* CARD 2: LOGO SEKOLAH (Lihat, Unggah, Ganti, Hapus) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                    <ImageIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm">Logo Sekolah</h3>
                    <p className="text-[11px] text-slate-500">Lambang visual resmi sekolah</p>
                  </div>
                </div>
                {settings.logo_url ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                    Logo Terpasang
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    Monogram DKB
                  </span>
                )}
              </div>

              {/* Current Logo Active Box */}
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
                <div className="relative group">
                  {settings.logo_url ? (
                    <div className="w-24 h-24 rounded-lg border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-1 flex items-center justify-center overflow-hidden shadow-xs">
                      <DriveImage
                        srcValue={settings.logo_url}
                        alt="Logo Sekolah"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                      <div className="w-10 h-10 rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-bold flex items-center justify-center text-xs mb-1">
                        DKB
                      </div>
                      <span className="text-[10px] font-medium text-center px-1">Tanpa Logo</span>
                    </div>
                  )}
                  {settings.logo_url && (
                    <button
                      type="button"
                      onClick={() => setPreviewZoomModal(true)}
                      className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1 font-semibold text-[11px]"
                      title="Perbesar Pratinjau Logo"
                    >
                      <Maximize2 className="w-4 h-4" />
                      Zoom
                    </button>
                  )}
                </div>

                <div className="flex-1 text-center sm:text-left space-y-2">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white">
                      {settings.logo_url ? 'Logo Aktif Terpasang' : 'Belum Ada Logo Terpasang'}
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {settings.logo_url
                        ? 'Logo ini sedang digunakan di seluruh aplikasi (Sidebar, Kiosk, Kartu Pelajar).'
                        : 'Aplikasi saat ini menampilkan lencana monogram inisial "DKB" sebagai pengganti.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                    {settings.logo_url ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const fileInput = document.getElementById('logo-file-picker');
                            fileInput?.click();
                          }}
                          className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium flex items-center gap-1.5 transition-colors shadow-xs"
                        >
                          <UploadCloud className="w-3.5 h-3.5" />
                          Ganti Logo
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowClearLogoConfirm(true)}
                          className="px-3 py-1.5 rounded-md border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors flex items-center gap-1 font-medium"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Hapus Logo
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const fileInput = document.getElementById('logo-file-picker');
                          fileInput?.click();
                        }}
                        className="px-3.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium flex items-center gap-1.5 transition-colors shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Tambah / Unggah Logo
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Hidden file input triggered by buttons */}
              <input
                id="logo-file-picker"
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!file.type.startsWith('image/')) {
                    showToast('Format file tidak didukung. Pilih gambar PNG, JPG, WebP, atau SVG.', 'error');
                    return;
                  }
                  setIsUploadingLogo(true);
                  try {
                    const driveFileId = await uploadPhotoToBackend(file, `logo_sekolah_${Date.now()}.jpg`);
                    const ok = await updateSettings({ logo_url: driveFileId });
                    if (ok) {
                      setLogoUrlInput(driveFileId);
                    }
                  } catch (err: any) {
                    showToast(err.message || 'Gagal mengunggah logo ke Google Drive.', 'error');
                  } finally {
                    setIsUploadingLogo(false);
                    e.target.value = '';
                  }
                }}
                className="hidden"
              />

              {/* Tabs for Adding / Changing Logo */}
              <div className="space-y-3 pt-2">
                <div className="flex border-b border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setLogoTab('upload')}
                    className={`px-3 py-1.5 font-semibold text-[11px] border-b-2 transition-colors ${
                      logoTab === 'upload'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    1. Unggah Berkas Gambar
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogoTab('preset')}
                    className={`px-3 py-1.5 font-semibold text-[11px] border-b-2 transition-colors ${
                      logoTab === 'preset'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    2. Pilih Template Nasional
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogoTab('url')}
                    className={`px-3 py-1.5 font-semibold text-[11px] border-b-2 transition-colors ${
                      logoTab === 'url'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    3. Tautan URL Gambar
                  </button>
                </div>

                {/* Tab 1: Direct File Upload */}
                {logoTab === 'upload' && (
                  <div
                    onClick={() => {
                      const fileInput = document.getElementById('logo-file-picker');
                      fileInput?.click();
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files?.[0];
                      if (!file) return;
                      if (!file.type.startsWith('image/')) {
                        showToast('Harap jatuhkan berkas gambar (PNG, JPG, SVG, WebP).', 'error');
                        return;
                      }
                      setIsUploadingLogo(true);
                      try {
                        const driveFileId = await uploadPhotoToBackend(file, `logo_sekolah_${Date.now()}.jpg`);
                        const ok = await updateSettings({ logo_url: driveFileId });
                        if (ok) {
                          setLogoUrlInput(driveFileId);
                        }
                      } catch (err: any) {
                        showToast(err.message || 'Gagal mengunggah logo ke Google Drive.', 'error');
                      } finally {
                        setIsUploadingLogo(false);
                      }
                    }}
                    className="p-6 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 text-center space-y-2 group"
                  >
                    <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        {isUploadingLogo ? 'Mengompresi & Mengunggah ke Drive...' : 'Klik atau Tarik Berkas Logo ke Sini'}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Foto otomatis dikecilkan (maks 800 px, JPEG 70%) lalu diunggah ke folder Google Drive privat dan ID file disimpan ke Sheet.
                      </p>
                    </div>
                  </div>
                )}

                {/* Tab 2: Educational Vector Presets */}
                {logoTab === 'preset' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {SCHOOL_LOGO_PRESETS.map((preset) => (
                      <div
                        key={preset.id}
                        className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-indigo-400 dark:hover:border-indigo-500 transition-all flex items-center gap-3 group"
                      >
                        <div className="w-12 h-12 rounded-md bg-slate-100 dark:bg-slate-700/60 p-1 flex items-center justify-center shrink-0">
                          <img
                            src={preset.dataUrl}
                            alt={preset.name}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 dark:text-indigo-400 block">
                            {preset.category}
                          </span>
                          <h5 className="font-bold text-slate-900 dark:text-white truncate text-xs">
                            {preset.name}
                          </h5>
                          <button
                            type="button"
                            disabled={isSavingLogo}
                            onClick={async () => {
                              setIsSavingLogo(true);
                              try {
                                const ok = await updateSettings({ logo_url: preset.dataUrl });
                                if (ok) {
                                  setLogoUrlInput(preset.dataUrl);
                                }
                              } finally {
                                setIsSavingLogo(false);
                              }
                            }}
                            className="mt-1.5 px-2.5 py-1 rounded bg-slate-100 hover:bg-indigo-600 hover:text-white dark:bg-slate-700 dark:hover:bg-indigo-600 text-slate-700 dark:text-slate-200 font-semibold text-[10px] transition-colors inline-flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            Gunakan Logo Ini
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tab 3: Image URL input */}
                {logoTab === 'url' && (
                  <div className="space-y-2 pt-1">
                    <label className="block text-slate-600 dark:text-slate-400 font-medium">
                      Masukkan URL Gambar Logo
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={logoUrlInput}
                        onChange={(e) => setLogoUrlInput(e.target.value)}
                        placeholder="https://contoh.sch.id/logo.png"
                        className="flex-1 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        disabled={isSavingLogo || !logoUrlInput.trim()}
                        onClick={async () => {
                          if (!logoUrlInput.trim()) return;
                          setIsSavingLogo(true);
                          try {
                            await updateSettings({ logo_url: logoUrlInput.trim() });
                          } finally {
                            setIsSavingLogo(false);
                          }
                        }}
                        className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-50 transition-colors shadow-xs shrink-0"
                      >
                        {isSavingLogo ? 'Menyimpan...' : 'Terapkan URL'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* CARD 3: PRATINJAU LANGSUNG MULTI-KONTEKS */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  Pratinjau Langsung Identitas di Berbagai Menu Aplikasi
                </h3>
                <p className="text-[11px] text-slate-500">
                  Berikut tampilan identitas sekolah Anda saat dilihat oleh Guru Piket, Siswa, dan Wali Kelas.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Preview 1: Sidebar Mockup */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    1. Tampilan Sidebar
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                    Navigasi
                  </span>
                </div>
                <div className="p-3 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5 shadow-xs">
                  {settings.logo_url ? (
                    <DriveImage
                      srcValue={settings.logo_url}
                      alt="Logo"
                      className="w-9 h-9 rounded object-contain bg-white dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 shadow-xs shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs flex items-center justify-center shrink-0">
                      DKB
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      DISIPLIN KITA BISA
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {settings.school_name || 'Nama Sekolah Belum Diatur'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Preview 2: Kiosk Header Mockup */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    2. Layar Kiosk Presensi
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold">
                    Layar Utama
                  </span>
                </div>
                <div className="p-3 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center gap-3 shadow-xs">
                  {settings.logo_url ? (
                    <DriveImage
                      srcValue={settings.logo_url}
                      alt="Logo"
                      className="w-10 h-10 rounded object-contain bg-white dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 shadow-xs shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-bold text-xs flex items-center justify-center shrink-0">
                      DKB
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-base font-extrabold text-slate-900 dark:text-white">
                        06:45:12
                      </span>
                      <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                        WIB
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate font-semibold">
                      {settings.school_name || 'SEKOLAH INDONESIA'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Preview 3: Kartu Presensi Siswa Mockup */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    3. Kartu Pelajar Siswa
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold">
                    Cetak / RFID
                  </span>
                </div>
                <div className="p-3 rounded-md bg-white text-slate-900 border border-slate-200 shadow-xs text-center space-y-1">
                  <div className="flex items-center justify-center gap-1.5">
                    {settings.logo_url && (
                      <DriveImage
                        srcValue={settings.logo_url}
                        alt="Logo"
                        className="w-5 h-5 object-contain shrink-0"
                      />
                    )}
                    <span className="font-extrabold text-xs uppercase truncate max-w-[150px]">
                      {settings.school_name || 'SEKOLAH INDONESIA'}
                    </span>
                  </div>
                  <p className="text-[9px] text-slate-500 tracking-wider uppercase font-semibold">
                    KARTU PRESENSI SISWA
                  </p>
                  <div className="font-mono text-[10px] tracking-widest text-slate-400 pt-0.5">
                    ||| | |||| | |||
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CONFIRMATION MODAL: HAPUS NAMA SEKOLAH */}
          {showClearNameConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                      Kosongkan Nama Sekolah?
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Nama sekolah akan dihapus dari identitas aplikasi. Anda dapat mengisinya kembali kapan saja.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowClearNameConfirm(false)}
                    className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={isSavingName}
                    onClick={async () => {
                      setIsSavingName(true);
                      try {
                        const ok = await updateSettings({ school_name: '' });
                        if (ok) {
                          setSchoolNameInput('');
                          setShowClearNameConfirm(false);
                        }
                      } finally {
                        setIsSavingName(false);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
                  >
                    {isSavingName ? 'Menyimpan...' : 'Ya, Hapus Nama'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CONFIRMATION MODAL: HAPUS LOGO */}
          {showClearLogoConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                      Hapus Logo Sekolah?
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Logo akan dihapus dan aplikasi akan kembali menampilkan lencana inisial default &quot;DKB&quot;.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowClearLogoConfirm(false)}
                    className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={isSavingLogo}
                    onClick={async () => {
                      setIsSavingLogo(true);
                      try {
                        const ok = await updateSettings({ logo_url: '' });
                        if (ok) {
                          setLogoUrlInput('');
                          setShowClearLogoConfirm(false);
                        }
                      } finally {
                        setIsSavingLogo(false);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
                  >
                    {isSavingLogo ? 'Menyimpan...' : 'Ya, Hapus Logo'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ZOOM MODAL: PREVIEW BESAR LOGO */}
          {previewZoomModal && settings.logo_url && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              onClick={() => setPreviewZoomModal(false)}
            >
              <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-2xl max-w-md w-full text-center space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                    Pratinjau Logo Sekolah
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPreviewZoomModal(false)}
                    className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="w-64 h-64 mx-auto rounded-lg bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 p-3 flex items-center justify-center shadow-inner">
                  <DriveImage
                    srcValue={settings.logo_url}
                    alt="Logo Sekolah Besar"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>

                <div className="text-center">
                  <p className="font-bold text-slate-900 dark:text-white text-sm">
                    {settings.school_name || 'Identitas Sekolah'}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Tersimpan dalam database aplikasi dan dapat digunakan saat offline
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setPreviewZoomModal(false)}
                    className="w-full py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 font-medium"
                  >
                    Tutup Pratinjau
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 8: PENGATURAN TTS (Bagian 10 Poin 8) */}
      {activeSection === 'tts' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4 text-xs">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Pengaturan Text-to-Speech (TTS id-ID)
          </h2>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="tts-toggle"
              checked={settings.tts_enabled}
              onChange={(e) => updateSettings({ tts_enabled: e.target.checked })}
              className="w-4 h-4 rounded text-slate-900"
            />
            <label htmlFor="tts-toggle" className="font-semibold text-slate-800 dark:text-slate-200">
              Aktifkan Suara Notifikasi TTS
            </label>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-500">
                  Template Kalimat Hadir Tepat Waktu (Variabel: &#123;nama&#125;, &#123;kelas&#125;, &#123;sesi&#125;)
                </label>
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Tersimpan otomatis</span>
              </div>
              <input
                type="text"
                value={ttsPresentInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setTtsPresentInput(val);
                  pendingDebouncedPatchRef.current = {
                    ...pendingDebouncedPatchRef.current,
                    tts_template_present: val,
                  };
                  if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
                  ttsTimerRef.current = setTimeout(() => {
                    const { tts_template_present: _ignored, ...rest } = pendingDebouncedPatchRef.current;
                    pendingDebouncedPatchRef.current = rest;
                    updateSettings({ tts_template_present: val }, { silent: true });
                  }, 500);
                }}
                onBlur={() => {
                  if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
                  const { tts_template_present: _ignored, ...rest } = pendingDebouncedPatchRef.current;
                  pendingDebouncedPatchRef.current = rest;
                  if (ttsPresentInput !== settings.tts_template_present) {
                    updateSettings({ tts_template_present: ttsPresentInput }, { silent: true });
                  }
                }}
                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-500">
                  Template Kalimat Terlambat (Variabel: &#123;nama&#125;, &#123;menit&#125;, &#123;sesi&#125;)
                </label>
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Tersimpan otomatis</span>
              </div>
              <input
                type="text"
                value={ttsLateInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setTtsLateInput(val);
                  pendingDebouncedPatchRef.current = {
                    ...pendingDebouncedPatchRef.current,
                    tts_template_late: val,
                  };
                  if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
                  ttsTimerRef.current = setTimeout(() => {
                    const { tts_template_late: _ignored, ...rest } = pendingDebouncedPatchRef.current;
                    pendingDebouncedPatchRef.current = rest;
                    updateSettings({ tts_template_late: val }, { silent: true });
                  }, 500);
                }}
                onBlur={() => {
                  if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
                  const { tts_template_late: _ignored, ...rest } = pendingDebouncedPatchRef.current;
                  pendingDebouncedPatchRef.current = rest;
                  if (ttsLateInput !== settings.tts_template_late) {
                    updateSettings({ tts_template_late: ttsLateInput }, { silent: true });
                  }
                }}
                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <button
              type="button"
              onClick={() => speak('Uji coba suara notifikasi aplikasi Disiplin Kita Bisa.')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Volume2 className="w-4 h-4 text-slate-600" />
              <span>Uji Coba Suara Sekarang</span>
            </button>
          </div>
        </div>
      )}

      {/* SECTION 9: NOTIFIKASI EMAIL (Bagian 11) */}
      {activeSection === 'notifications' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Pengaturan Notifikasi Email ke Orang Tua
                </h2>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 text-[10px] font-semibold">
                  Sinkron &amp; Aktif Otomatis
                </span>
              </div>
              <p className="text-slate-500 mt-0.5">
                Notifikasi email orang tua &amp; rekap mingguan berjalan otomatis serta langsung tersimpan ke database, Google Drive, dan Google Sheet tanpa klik sinkron manual.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                type="checkbox"
                id="email-toggle"
                checked={settings.toggle_email_notifications && notificationSettings.email_enabled}
                onChange={async (e) => {
                  const nextEnabled = e.target.checked;
                  const ok = await updateSettings({ toggle_email_notifications: nextEnabled }, { silent: true });
                  if (ok) {
                    await updateNotificationSettings({ email_enabled: nextEnabled });
                  }
                }}
                className="w-4 h-4 rounded text-slate-900"
              />
              <label htmlFor="email-toggle" className="font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                Aktifkan Notifikasi Email
              </label>
            </div>
          </div>

          {/* Status Email Pengirim (Google Apps Script GmailApp) */}
          <div
            className={`p-4 rounded-xl border space-y-2.5 ${
              envStatus.emailConnected
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100'
                : 'border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span className="font-bold">Email Pengirim (Apps Script GmailApp)</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      envStatus.emailConnected
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                    }`}
                  >
                    {envStatus.emailConnected
                      ? `Aktif via Apps Script (${envStatus.senderEmail || 'GmailApp'})`
                      : 'Menunggu Koneksi Apps Script'}
                  </span>
                </div>
                <p className="text-[11px] opacity-85 leading-relaxed">
                  {envStatus.emailConnected
                    ? `Email notifikasi orang tua & rekap mingguan wali kelas dikirim langsung melalui layanan GmailApp dari akun Google pemilik Google Apps Script${envStatus.senderEmail ? ` (${envStatus.senderEmail})` : ''}.`
                    : 'Pengiriman email otomatis berjalan langsung melalui GmailApp di Google Apps Script Web App. Pastikan Web App & token rahasia sudah terhubung dan jalankan setupAppsScript() sekali di editor Apps Script untuk memberi izin Gmail.'}
                </p>
              </div>

              {!envStatus.emailConnected && (
                <button
                  type="button"
                  onClick={() => setActiveTab('system_check')}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
                >
                  Buka Cek Sistem
                </button>
              )}
            </div>
          </div>

          {/* Trigger options (Bagian 11 Poin b) */}
          <div className="space-y-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200 block">Pemicu Pengiriman Email:</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                ['trigger_late', 'Siswa Terlambat Presensi'],
                ['trigger_alpha', 'Siswa Alpha / Tidak Hadir'],
                ['trigger_leave', 'Pengajuan Izin / Sakit Disetujui'],
                ['trigger_violation', 'Pencatatan Pelanggaran Baru'],
                ['trigger_warning_threshold', 'Melewati Ambang Batas SP'],
                ['trigger_overdue_out_of_class', 'Melebihi Waktu Izin Keluar'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 p-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(notificationSettings as any)[key]}
                    onChange={(e) => updateNotificationSettings({ [key]: e.target.checked })}
                    className="w-4 h-4 rounded text-slate-900"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Pengiriman Rekapan Presensi Mingguan ke Wali Kelas per Sesi (Admin yang Mengatur) */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-500" />
                  Pengiriman Rekap Presensi Mingguan ke Wali Kelas per Sesi
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Laporan rekapitulasi presensi siswa dikelompokkan <strong>per sesi presensi aktif</strong> dan dikirimkan otomatis setiap pekan ke email wali kelas yang telah diatur oleh Admin.
                </p>
              </div>

              <button
                type="button"
                disabled={sendingWeeklyRecap}
                onClick={async () => {
                  setSendingWeeklyRecap(true);
                  await sendWeeklyRecap();
                  setSendingWeeklyRecap(false);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-xs disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${sendingWeeklyRecap ? 'animate-spin' : ''}`} />
                <span>{sendingWeeklyRecap ? 'Memproses Pengiriman...' : 'Kirim Rekap ke Semua Kelas Sekarang'}</span>
              </button>
            </div>

            {/* Jadwal Mingguan Otomatis */}
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="weekly-recap-toggle"
                    checked={notificationSettings.weekly_recap_enabled ?? true}
                    onChange={(e) => updateNotificationSettings({ weekly_recap_enabled: e.target.checked })}
                    className="w-4 h-4 rounded text-slate-900"
                  />
                  <label htmlFor="weekly-recap-toggle" className="font-semibold text-slate-900 dark:text-white cursor-pointer">
                    Aktifkan Pengiriman Otomatis Mingguan
                  </label>
                </div>

                {notificationSettings.weekly_recap_last_sent && (
                  <span className="text-[11px] text-slate-500">
                    Terakhir dikirim: {new Date(notificationSettings.weekly_recap_last_sent).toLocaleString('id-ID')}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div>
                  <label className="block text-[11px] text-slate-600 dark:text-slate-300 font-medium mb-1">
                    Hari Pengiriman Mingguan
                  </label>
                  <select
                    value={weeklyRecapDay}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setWeeklyRecapDay(val);
                      updateNotificationSettings({ weekly_recap_day: val }, { silent: true });
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  >
                    <option value="1">Setiap Senin</option>
                    <option value="2">Setiap Selasa</option>
                    <option value="3">Setiap Rabu</option>
                    <option value="4">Setiap Kamis</option>
                    <option value="5">Setiap Jumat (Rekomendasi Akhir Pekan)</option>
                    <option value="6">Setiap Sabtu</option>
                    <option value="0">Setiap Minggu</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-600 dark:text-slate-300 font-medium mb-1">
                    Jam Pengiriman Otomatis
                  </label>
                  <input
                    type="time"
                    value={weeklyRecapTime}
                    onChange={(e) => {
                      const val = e.target.value;
                      setWeeklyRecapTime(val);
                      updateNotificationSettings({ weekly_recap_time: val }, { silent: true });
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                  />
                </div>

                <div className="flex items-end">
                  <div className="w-full py-1.5 px-3 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-semibold text-xs text-center flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Jadwal Tersimpan Otomatis</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Status Email Wali Kelas per Kelas */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold text-slate-800 dark:text-slate-200 text-xs flex justify-between items-center">
                <span>Daftar Email Penerima per Kelas (Dikelola oleh Administrator):</span>
                <span className="text-[11px] font-normal text-slate-500">
                  {classes.filter((c) => Boolean(c.homeroom_teacher_email)).length} dari {classes.length} kelas memiliki email
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto">
                {classes.map((cls) => {
                  const hasEmail = Boolean(cls.homeroom_teacher_email && cls.homeroom_teacher_email.includes('@'));
                  return (
                    <div key={cls.id} className="p-2.5 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-white">{cls.name}</span>
                          <span className="text-slate-500">• {cls.homeroom_teacher_name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {hasEmail ? (
                            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                              <Mail className="w-3 h-3 text-emerald-500" />
                              {cls.homeroom_teacher_email}
                            </span>
                          ) : (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                              <AlertCircle className="w-3 h-3" />
                              Belum ada email (Atur di menu Kelola Kelas)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => sendWeeklyRecap(cls.id)}
                          className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-[11px] transition-colors"
                        >
                          Kirim ke Kelas Ini
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSection('classes');
                            setEditingClass(cls);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-600"
                          title="Ubah email wali kelas"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Test Email Section */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <input
              type="email"
              value={testEmailAddress}
              onChange={(e) => setTestEmailAddress(e.target.value)}
              placeholder="Masukkan email uji coba..."
              className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs w-64"
            />
            <button
              type="button"
              disabled={testEmailSending || !testEmailAddress}
              onClick={async () => {
                setTestEmailSending(true);
                const res = await sendTestEmail(testEmailAddress);
                setTestEmailSending(false);
                if (!res.cancelled) {
                  showToast(res.message, res.success ? 'success' : 'error');
                }
              }}
              className="px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold disabled:opacity-50"
            >
              {testEmailSending ? 'Mengirim...' : 'Kirim Email Uji Coba'}
            </button>
          </div>

          {/* Notification Logs */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">
              Log Pengiriman Notifikasi ({notificationLogs.length} Terakhir)
            </h3>
            {notificationLogs.length === 0 ? (
              <p className="text-slate-400 py-3">Belum ada riwayat email terkirim.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {notificationLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="py-1.5 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white">{log.student_name}</span>
                      <span className="text-[10px] text-slate-400 ml-2">({log.recipient_email})</span>
                      <span className="text-[10px] text-slate-500 block">Pemicu: {log.trigger_type}</span>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${log.status === 'sent' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                      {log.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 10: KONEKSI LANGSUNG GOOGLE APPS SCRIPT WEB APP */}
      {activeSection === 'sync_status' && (
        <div className="space-y-5 text-xs">
          {/* Backend Google Apps Script (.gs) Panel */}
          <AppsScriptPanel />

          {/* Cek Sistem Live Diagnostics (tanpa menampilkan nilai rahasia) */}
          <SystemCheckView embedded />

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg text-white flex items-center justify-center font-bold shadow-xs ${
                  envStatus.configured ? 'bg-emerald-600' : 'bg-amber-600'
                }`}>
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                    Integrasi Google Sheets &amp; Drive via Google Apps Script
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      envStatus.configured
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    }`}>
                      {envStatus.configured
                        ? `Aktif via Apps Script${envStatus.senderEmail ? ` (${envStatus.senderEmail})` : ''}`
                        : 'Menunggu Konfigurasi Apps Script'}
                    </span>
                  </h2>
                  <p className="text-slate-500">
                    Google Sheets adalah satu-satunya database. Semua permintaan dikirim dengan token rahasia ke Web App doGet / doPost tanpa Google Cloud maupun Service Account.
                  </p>
                </div>
              </div>
            </div>

            {missingEnv.length > 0 && (
              <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Bagian Konfigurasi yang Masih Kosong</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Lengkapi bagian berikut (nilai rahasia tidak ditampilkan):
                </p>
                <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                  {missingEnv.map((envName) => (
                    <span key={envName} className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 font-semibold">
                      {envName}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: Google Sheets */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white">Google Sheets (SpreadsheetApp)</h3>
                      <p className="text-[11px] text-slate-500">Satu-satunya Basis Data Utama</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    envStatus.sheetsConfigured && envStatus.spreadsheetConfigured
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                  }`}>
                    {envStatus.sheetsConfigured && envStatus.spreadsheetConfigured ? 'Siap & Terhubung' : 'Belum Lengkap'}
                  </span>
                </div>

                <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px]">
                  <div className="text-slate-500 text-[10px]">Struktur Sheet Tabs (Termasuk Sheet Terpisah Per Sesi Presensi):</div>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {['Siswa', 'Kelas', 'Sesi_Presensi', 'Rekap_Per_Sesi', 'Presensi - [Per Sesi]', 'Izin_Keluar', 'Pelanggaran', 'Izin_Tidak_Masuk', 'Jenis_Pelanggaran', 'Pengaturan', 'Users', 'Notifikasi_Log', 'Log'].map((sh) => (
                      <span key={sh} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {sh}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Card 2: Google Drive (Photos Only) */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white">Google Drive Privat (DriveApp)</h3>
                      <p className="text-[11px] text-slate-500">Akses Media via Endpoint Apps Script (/api/photos)</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    envStatus.driveConfigured && envStatus.driveFolderConfigured
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                  }`}>
                    {envStatus.driveConfigured && envStatus.driveFolderConfigured ? 'Siap & Privat' : 'Belum Lengkap'}
                  </span>
                </div>

                <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                  <p>
                    Foto siswa, bukti pelanggaran, bukti presensi, dan logo sekolah dikecilkan di perangkat (maks <strong>800 px</strong>, JPEG <strong>70%</strong>) lalu diunggah ke folder Drive privat via <code className="font-mono">DriveApp</code>. Hanya ID file yang disimpan ke Google Sheets.
                  </p>
                </div>
              </div>
            </div>

            {/* Live Data Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
                <span className="text-slate-400 block text-[10px]">Siswa Aktif</span>
                <span className="text-base font-bold text-slate-900 dark:text-white">{students.length}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
                <span className="text-slate-400 block text-[10px]">Total Presensi</span>
                <span className="text-base font-bold text-slate-900 dark:text-white">{attendance.length}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
                <span className="text-slate-400 block text-[10px]">Izin Keluar</span>
                <span className="text-base font-bold text-slate-900 dark:text-white">{outOfClass.length}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
                <span className="text-slate-400 block text-[10px]">Pelanggaran</span>
                <span className="text-base font-bold text-slate-900 dark:text-white">{violations.length}</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 dark:text-white">
              Arsitektur Google Apps Script &amp; Integritas Data
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-slate-500 block text-[10px]">Sinkronisasi Otomatis:</span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  Real-Time (ms) &amp; Saat Tab Aktif
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-slate-500 block text-[10px]">Batch Scan Perangkat:</span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  Kumpul 3 Detik &amp; Offline Auto-Sync
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-slate-500 block text-[10px]">Integritas Edit &amp; Hapus:</span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  LockService + 409 + Soft Delete
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-slate-500 block text-[10px]">Keamanan Endpoint:</span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  SECRET_TOKEN di Script Properties
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2">
              <ul className="list-disc pl-4 space-y-1.5 text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                <li>
                  <strong>ID Unik &amp; Partial Cell Update:</strong> Kolom A menyimpan <code>id</code> unik dan kolom <code>diubah_pada</code> mencatat waktu pembaruan terakhir. Operasi tambah memakai <code>appendRow</code>, sedangkan operasi edit mencari baris dari ID kolom A, membandingkan <code>diubah_pada</code> (HTTP 409 jika sudah berubah), dan hanya memperbarui sel yang berubah.
                </li>
                <li>
                  <strong>LockService, Soft Delete &amp; Sheet Log:</strong> Semua operasi tulis dibungkus <code>LockService.getScriptLock()</code>. Penghapusan mengubah kolom <code>status</code> menjadi <code>dihapus</code> tanpa menggeser baris, dan setiap perubahan dicatat otomatis ke sheet <code>Log</code>.
                </li>
                <li>
                  <strong>Presensi Beruntun &amp; Mode Offline:</strong> Waktu presensi diambil dari server Apps Script, presensi ganda di hari yang sama ditolak, scan beruntun dikumpulkan tiap 3 detik menjadi batch, dan scan saat offline disimpan sementara lalu otomatis terkirim ketika online.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 11: PENGUJIAN MANDIRI / SIMULASI RACE CONDITION (Bagian 13 Poin 9) */}
      {activeSection === 'self_test' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4 text-xs">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-slate-600" />
              Pengujian Mandiri (Simulasi Penulisan Serentak Multi-Perangkat)
            </h2>
            <p className="text-slate-500">
              Uji ketahanan sistem terhadap presensi duplikat bersamaan dan perebutan kuota izin keluar.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={simulationRunning}
              onClick={() => runSelfTest('duplicate_attendance')}
              className="px-4 py-2 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold disabled:opacity-50"
            >
              {simulationRunning ? 'Menjalankan Simulasi...' : '1. Simulasi 2 Perangkat Scan Siswa Sama Serentak'}
            </button>

            <button
              type="button"
              disabled={simulationRunning}
              onClick={() => runSelfTest('out_of_class_quota_race')}
              className="px-4 py-2 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold disabled:opacity-50"
            >
              {simulationRunning ? 'Menjalankan Simulasi...' : '2. Simulasi 2 Siswa Rebutan Kuota Izin Keluar Kelas'}
            </button>
          </div>

          {simulationResult && (
            <div className="p-4 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
              <h3 className="font-bold text-slate-900 dark:text-white mb-2">Hasil Evaluasi Server:</h3>
              <pre className="font-mono text-[11px] overflow-x-auto text-slate-800 dark:text-slate-200 p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                {JSON.stringify(simulationResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* SECTION 12: AUDIT LOG (Bagian 10 Poin 9) */}
      {activeSection === 'audit_log' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4 text-xs">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Log Audit Perubahan Data
          </h2>

          {auditLogs.length === 0 ? (
            <p className="text-slate-400 py-6 text-center">Belum ada riwayat log audit.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                    <th className="py-2">Waktu</th>
                    <th className="py-2">Pelaku</th>
                    <th className="py-2">Aksi</th>
                    <th className="py-2">Entitas</th>
                    <th className="py-2">Alasan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 font-mono text-[11px] text-slate-500">
                        {new Date(log.timestamp).toLocaleString('id-ID')}
                      </td>
                      <td className="py-2 font-medium text-slate-900 dark:text-white">{log.actor_name}</td>
                      <td className="py-2 uppercase font-semibold text-[10px]">{log.action}</td>
                      <td className="py-2 font-mono text-[11px]">{log.entity} ({log.entity_id})</td>
                      <td className="py-2 text-slate-500">{log.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL: PRATINJAU IMPOR DATA SISWA DENGAN VALIDASI MERAH (Bagian 10 Poin 3) */}
      {isImportModalOpen && importRows && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Pratinjau & Validasi Impor Data Siswa
                </h3>
                <p className="text-xs text-slate-500">
                  Total {importRows.length} baris terbaca. Baris bermasalah diberi warna merah beserta alasannya.
                </p>
              </div>
              <button onClick={() => setIsImportModalOpen(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 text-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                    <th className="py-2">Status</th>
                    <th className="py-2">NIS</th>
                    <th className="py-2">Nama</th>
                    <th className="py-2">Kelas</th>
                    <th className="py-2">RFID UID</th>
                    <th className="py-2">Alasan Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {importRows.map((r, idx) => (
                    <tr
                      key={idx}
                      className={r.isValid ? 'bg-emerald-50/20' : 'bg-rose-50/60 dark:bg-rose-950/30'}
                    >
                      <td className="py-2">
                        {r.isValid ? (
                          <span className="text-emerald-600 font-bold">Valid</span>
                        ) : (
                          <span className="text-rose-600 font-bold">Gagal</span>
                        )}
                      </td>
                      <td className="py-2 font-mono font-semibold">{r.NIS || '-'}</td>
                      <td className="py-2">{r.Nama || '-'}</td>
                      <td className="py-2">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{r.Kelas || '-'}</span>
                        {r.Kelas && !classes.some(c => c.id.toLowerCase() === r.Kelas.toLowerCase()) && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                            + Kelas Baru
                          </span>
                        )}
                      </td>
                      <td className="py-2 font-mono">{r.UID_RFID || '-'}</td>
                      <td className="py-2 text-rose-600 font-medium">
                        {r.errors && r.errors.length > 0 ? r.errors.join(', ') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                {importRows.filter((r) => r.isValid).length} baris valid siap diimpor.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isImportingStudents}
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-3 py-1.5 text-slate-600 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isImportingStudents || importRows.filter((r) => r.isValid).length === 0}
                  onClick={handleConfirmImport}
                  className="px-4 py-1.5 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {isImportingStudents && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {isImportingStudents
                      ? 'Mengimpor Data...'
                      : `Konfirmasi Impor (${importRows.filter((r) => r.isValid).length} Siswa)`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CETAK KARTU SISWA (Bagian 10 Poin 3) */}
      {printCardStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm bg-white text-slate-900 border border-slate-300 rounded-lg p-5 shadow-2xl">
            <div className="text-center border-b border-slate-200 pb-3 mb-3">
              <div className="flex items-center justify-center gap-2 mb-1">
                {settings.logo_url && (
                  <DriveImage srcValue={settings.logo_url} alt="Logo" className="w-7 h-7 object-contain shrink-0" />
                )}
                <h3 className="font-extrabold text-sm uppercase">{settings.school_name || 'SEKOLAH INDONESIA'}</h3>
              </div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">KARTU PRESENSI SISWA</p>
            </div>

            <div className="flex gap-3 items-center mb-4">
              <div className="w-16 h-16 rounded border border-slate-200 bg-slate-100 flex items-center justify-center font-bold text-lg overflow-hidden shrink-0">
                {printCardStudent.photo_url ? (
                  <DriveImage srcValue={printCardStudent.photo_url} alt={printCardStudent.name} className="w-full h-full object-cover" />
                ) : (
                  printCardStudent.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="text-xs">
                <p className="font-bold text-sm">{printCardStudent.name}</p>
                <p>NIS: <span className="font-mono font-semibold">{printCardStudent.nis}</span></p>
                <p>Kelas: <span className="font-semibold">{printCardStudent.class_id}</span></p>
              </div>
            </div>

            {/* Simulated Barcode */}
            <div className="text-center p-2 bg-slate-50 border border-slate-200 rounded">
              <div className="font-mono tracking-widest font-bold text-base">||| | |||| | ||| | |||</div>
              <span className="font-mono text-[11px] text-slate-500 block mt-1">{printCardStudent.rfid_uid}</span>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPrintCardStudent(null)}
                className="px-3 py-1.5 text-slate-600"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-1.5 rounded bg-slate-900 text-white font-semibold"
              >
                Cetak Kartu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT / TAMBAH SISWA MANUAL DENGAN REGISTRASI RFID */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-xl text-xs space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {editingStudent.nis ? 'Edit Data Siswa' : 'Tambah Siswa Baru'}
            </h3>

            <div>
              <label className="block text-slate-500 mb-1">Nomor Induk Siswa (NIS) *</label>
              <input
                type="text"
                value={editingStudent.nis || ''}
                onChange={(e) => setEditingStudent({ ...editingStudent, nis: e.target.value })}
                placeholder="Contoh: 20261015"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-slate-500 mb-1">Nama Lengkap Siswa *</label>
              <input
                type="text"
                value={editingStudent.name || ''}
                onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                placeholder="Nama lengkap..."
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-500 mb-1">Kelas *</label>
                {classes.length > 0 ? (
                  <select
                    value={editingStudent.class_id || classes[0]?.id || ''}
                    onChange={(e) => setEditingStudent({ ...editingStudent, class_id: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={editingStudent.class_id || ''}
                    onChange={(e) => setEditingStudent({ ...editingStudent, class_id: e.target.value })}
                    placeholder="Contoh: 7A"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                )}
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Jenis Kelamin</label>
                <select
                  value={editingStudent.gender || 'L'}
                  onChange={(e) => setEditingStudent({ ...editingStudent, gender: e.target.value as any })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="L">Laki-laki</option>
                  <option value="P">Perempuan</option>
                </select>
              </div>
            </div>

            {/* Registrasi Kartu RFID Instan: Kursor di kolom UID, tempelkan kartu, UID terisi otomatis (Bagian 10 Poin 3) */}
            <div>
              <label className="block text-slate-500 mb-1">
                Registrasi Kartu RFID (Fokuskan kursor & tempelkan kartu RFID pada scanner)
              </label>
              <input
                type="text"
                value={editingStudent.rfid_uid || ''}
                onChange={(e) => setEditingStudent({ ...editingStudent, rfid_uid: e.target.value })}
                placeholder="Tempelkan kartu RFID di sini..."
                className="w-full px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-500 mb-1">Nama Orang Tua</label>
                <input
                  type="text"
                  value={editingStudent.parent_name || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, parent_name: e.target.value })}
                  placeholder="Nama orang tua..."
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Email Orang Tua</label>
                <input
                  type="email"
                  value={editingStudent.parent_email || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, parent_email: e.target.value })}
                  placeholder="email@example.com"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            {/* Foto Siswa (Kompresi maks 800px JPEG 70% -> Google Drive Privat) */}
            <div className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
              <div className="w-12 h-12 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center font-bold text-slate-500 overflow-hidden shrink-0">
                {editingStudent.photo_url ? (
                  <DriveImage
                    srcValue={editingStudent.photo_url}
                    alt="Foto Siswa"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (editingStudent.name || 'S').slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 dark:text-slate-200 text-[11px]">Foto Profil Siswa</p>
                <p className="text-[10px] text-slate-500">Otomatis dikecilkan (maks 800 px, JPEG 70%) &amp; diunggah ke Drive</p>
              </div>
              <label className="px-2.5 py-1.5 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold text-[11px] cursor-pointer hover:opacity-90 shrink-0">
                {isUploadingStudentPhoto ? 'Mengunggah...' : editingStudent.photo_url ? 'Ganti Foto' : 'Unggah Foto'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={isUploadingStudentPhoto}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setIsUploadingStudentPhoto(true);
                    try {
                      const fileId = await uploadPhotoToBackend(
                        file,
                        `siswa_${(editingStudent.nis || Date.now()).toString()}.jpg`
                      );
                      setEditingStudent((prev) => (prev ? { ...prev, photo_url: fileId } : prev));
                      showToast('Foto siap. Klik Simpan Data Siswa.', 'info');
                    } catch (err: any) {
                      showToast(err.message || 'Gagal mengunggah foto siswa.', 'error');
                    } finally {
                      setIsUploadingStudentPhoto(false);
                      e.target.value = '';
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>

            <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
              {editingStudent.nis && students.some((s) => s.nis === editingStudent.nis) ? (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await deleteStudent(editingStudent.nis!);
                    if (ok) setEditingStudent(null);
                  }}
                  className="px-2.5 py-1.5 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold flex items-center gap-1.5 transition-colors text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Siswa</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isSavingStudent}
                  onClick={async () => {
                    if (isSavingStudent) return;
                    const trimmedNis = (editingStudent.nis || '').trim();
                    const trimmedName = (editingStudent.name || '').trim();
                    const resolvedClassId = (editingStudent.class_id || classes[0]?.id || '').trim();
                    if (!trimmedNis || !trimmedName || !resolvedClassId) {
                      showToast('NIS, Nama Lengkap, dan Kelas wajib diisi.', 'error');
                      return;
                    }
                    setIsSavingStudent(true);
                    try {
                      const ok = await saveStudent({
                        ...(editingStudent as Student),
                        nis: trimmedNis,
                        name: trimmedName,
                        class_id: resolvedClassId,
                        card_code: (editingStudent.card_code || '').trim() || trimmedNis,
                      });
                      if (ok) {
                        setEditingStudent(null);
                      }
                    } finally {
                      setIsSavingStudent(false);
                    }
                  }}
                  className="px-4 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold transition-colors disabled:opacity-50"
                >
                  {isSavingStudent ? 'Menyimpan...' : 'Simpan Data Siswa'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: KONFIRMASI KOSONGKAN SEMUA SISWA */}
      {isClearAllModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-2xl text-xs space-y-3">
            <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400 font-bold text-sm">
              <div className="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-950 flex items-center justify-center shrink-0">
                <AlertCircle className="w-4 h-4" />
              </div>
              <span>Kosongkan Semua Data Siswa?</span>
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Tindakan ini akan <strong>menghapus seluruh {students.length} data siswa</strong> dari database dan mencatat perubahan sinkronisasi. Seluruh data nama, NIS, kelas, dan UID kartu RFID siswa akan dibersihkan.
            </p>
            <p className="text-slate-500 text-[11px]">
              Pastikan Anda sudah mengunduh berkas cadangan melalui tombol "Ekspor Excel" jika data ini masih dibutuhkan.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={isDeletingBulk}
                onClick={() => setIsClearAllModalOpen(false)}
                className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isDeletingBulk}
                onClick={handleConfirmClearAllStudents}
                className="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingBulk ? 'Menghapus...' : 'Ya, Kosongkan Semua'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH / EDIT SESI PRESENSI */}
      {editingSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-xl text-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white flex items-center justify-center font-bold">
                  <Clock className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {sessions.some((s) => s.id === editingSession.id) ? 'Atur Waktu & Parameter Sesi Presensi' : 'Tambah Sesi Presensi Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingSession(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Nama Sesi Presensi *
                </label>
                <input
                  type="text"
                  value={editingSession.name || ''}
                  onChange={(e) => setEditingSession({ ...editingSession, name: e.target.value })}
                  placeholder="Contoh: Masuk Pagi, Salat Dhuha, Salat Zuhur, Pulang..."
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    Jam Mulai Sesi *
                  </label>
                  <input
                    type="time"
                    value={editingSession.start_time || '07:00'}
                    onChange={(e) => setEditingSession({ ...editingSession, start_time: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Awal pemindaian</span>
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    Batas Tepat Waktu *
                  </label>
                  <input
                    type="time"
                    value={editingSession.on_time_limit || '07:30'}
                    onChange={(e) => setEditingSession({ ...editingSession, on_time_limit: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Lewat = Terlambat</span>
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    Jam Selesai Sesi *
                  </label>
                  <input
                    type="time"
                    value={editingSession.end_time || '08:30'}
                    onChange={(e) => setEditingSession({ ...editingSession, end_time: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Akhir sesi (lewat jam ini presensi ditutup)</span>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Toleransi Keterlambatan (Menit)
                </label>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={editingSession.late_tolerance_minutes ?? 15}
                  onChange={(e) => setEditingSession({ ...editingSession, late_tolerance_minutes: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Batas menit toleransi dispensasi keterlambatan siswa
                </span>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Hari Aktif Sesi
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                  {[
                    { day: 1, label: 'Sen' },
                    { day: 2, label: 'Sel' },
                    { day: 3, label: 'Rab' },
                    { day: 4, label: 'Kam' },
                    { day: 5, label: 'Jum' },
                    { day: 6, label: 'Sab' },
                    { day: 0, label: 'Min' },
                  ].map(({ day, label }) => {
                    const activeDays = editingSession.active_days || [1, 2, 3, 4, 5];
                    const isChecked = activeDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const nextDays = isChecked
                            ? activeDays.filter((d) => d !== day)
                            : [...activeDays, day];
                          setEditingSession({ ...editingSession, active_days: nextDays });
                        }}
                        className={`py-1.5 px-2 rounded text-center font-semibold border transition-colors ${
                          isChecked
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-900 dark:border-white'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="session-active-toggle"
                  checked={editingSession.is_active ?? true}
                  onChange={(e) => setEditingSession({ ...editingSession, is_active: e.target.checked })}
                  className="w-4 h-4 rounded text-slate-900"
                />
                <label htmlFor="session-active-toggle" className="font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  Sesi Aktif (Berlaku untuk pemindaian otomatis)
                </label>
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingSession(null)}
                className="px-3 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSavingSession}
                onClick={async () => {
                  if (isSavingSession) return;
                  if (!editingSession.name?.trim()) {
                    showToast('Nama sesi presensi wajib diisi.', 'error');
                    return;
                  }
                  if (!editingSession.start_time || !editingSession.end_time || !editingSession.on_time_limit) {
                    showToast('Jam mulai, batas tepat waktu, dan jam selesai wajib diisi.', 'error');
                    return;
                  }
                  const sessionToSave: AttendanceSession = {
                    id: editingSession.id || `sess_${Date.now()}`,
                    name: editingSession.name.trim(),
                    start_time: editingSession.start_time,
                    on_time_limit: editingSession.on_time_limit,
                    end_time: editingSession.end_time,
                    active_days: editingSession.active_days || [1, 2, 3, 4, 5],
                    late_tolerance_minutes: editingSession.late_tolerance_minutes ?? 15,
                    is_active: editingSession.is_active ?? true,
                    created_at: editingSession.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  setIsSavingSession(true);
                  try {
                    const ok = await saveSession(sessionToSave);
                    if (ok) {
                      setEditingSession(null);
                    }
                  } finally {
                    setIsSavingSession(false);
                  }
                }}
                className="px-4 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {isSavingSession ? 'Menyimpan...' : 'Simpan Sesi Presensi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH / EDIT KELAS & EMAIL WALI KELAS */}
      {editingClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-xl text-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white flex items-center justify-center font-bold">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {classes.some((c) => c.id === editingClass.id) ? 'Edit Kelas & Email Wali Kelas' : 'Tambah Kelas Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingClass(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    ID / Kode Kelas *
                  </label>
                  <input
                    type="text"
                    value={editingClass.id || ''}
                    disabled={classes.some((c) => c.id === editingClass.id)}
                    onChange={(e) => setEditingClass({ ...editingClass, id: e.target.value })}
                    placeholder="Contoh: 10-RPL-1"
                    className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    Nama Tampilan Kelas *
                  </label>
                  <input
                    type="text"
                    value={editingClass.name || ''}
                    onChange={(e) => setEditingClass({ ...editingClass, name: e.target.value })}
                    placeholder="Contoh: X RPL 1"
                    className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    Tingkat (Grade)
                  </label>
                  <select
                    value={editingClass.grade || '10'}
                    onChange={(e) => setEditingClass({ ...editingClass, grade: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="10">Kelas 10 (X)</option>
                    <option value="11">Kelas 11 (XI)</option>
                    <option value="12">Kelas 12 (XII)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    Jurusan / Kompetensi Keahlian
                  </label>
                  <input
                    type="text"
                    value={editingClass.major || ''}
                    onChange={(e) => setEditingClass({ ...editingClass, major: e.target.value })}
                    placeholder="Contoh: Rekayasa Perangkat Lunak"
                    className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Nama Lengkap Wali Kelas *
                </label>
                <input
                  type="text"
                  value={editingClass.homeroom_teacher_name || ''}
                  onChange={(e) => setEditingClass({ ...editingClass, homeroom_teacher_name: e.target.value })}
                  placeholder="Contoh: Dra. Siti Aminah, M.Pd"
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  📧 Email Wali Kelas (Dikelola Administrator untuk Rekap Mingguan Otomatis) *
                </label>
                <input
                  type="email"
                  value={editingClass.homeroom_teacher_email || ''}
                  onChange={(e) => setEditingClass({ ...editingClass, homeroom_teacher_email: e.target.value })}
                  placeholder="wali.kelas@sekolah.sch.id"
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
                <span className="text-[11px] text-slate-400 mt-0.5 block">
                  Laporan rekap presensi per sesi setiap pekan akan dikirimkan otomatis ke alamat email ini.
                </span>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Batas Kuota Siswa Keluar Kelas Bersamaan
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={editingClass.quota_limit ?? 2}
                  onChange={(e) => setEditingClass({ ...editingClass, quota_limit: parseInt(e.target.value) || 2 })}
                  className="w-full px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingClass(null)}
                className="px-3 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSavingClass}
                onClick={async () => {
                  if (isSavingClass) return;
                  if (!editingClass.id?.trim() || !editingClass.name?.trim()) {
                    showToast('Kode ID dan Nama kelas wajib diisi.', 'error');
                    return;
                  }
                  if (!editingClass.homeroom_teacher_name?.trim()) {
                    showToast('Nama wali kelas wajib diisi.', 'error');
                    return;
                  }
                  const classToSave: SchoolClass = {
                    id: editingClass.id.trim(),
                    name: editingClass.name.trim(),
                    grade: editingClass.grade || '10',
                    major: editingClass.major || '',
                    homeroom_teacher_name: editingClass.homeroom_teacher_name.trim(),
                    homeroom_teacher_email: editingClass.homeroom_teacher_email?.trim() || '',
                    quota_limit: editingClass.quota_limit ?? 2,
                    created_at: editingClass.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  setIsSavingClass(true);
                  try {
                    const ok = await saveClass(classToSave);
                    if (ok) {
                      setEditingClass(null);
                    }
                  } finally {
                    setIsSavingClass(false);
                  }
                }}
                className="px-4 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {isSavingClass ? 'Menyimpan...' : 'Simpan Data Kelas & Email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: UBAH SANDI AKUN (PIKET, WALI KELAS, KESISWAAN, ADMIN) */}
      {selectedUserForPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-xl text-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white flex items-center justify-center">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Ubah Kata Sandi Akun
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {selectedUserForPassword.name} • {selectedUserForPassword.role === 'duty' ? 'Petugas Piket' : selectedUserForPassword.role === 'homeroom' ? `Wali Kelas ${selectedUserForPassword.class_id}` : selectedUserForPassword.role === 'student_affairs' ? 'Bagian Kesiswaan' : 'Administrator'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserForPassword(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-[11px] text-blue-800 dark:text-blue-300">
              Sandi baru akan otomatis memutakhirkan versi token akun (saat ini: v{selectedUserForPassword.token_version || 1}) dan mengeluarkan sesi lama yang sedang aktif di perangkat lain.
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Password Baru (Minimal 4 Karakter) *
                </label>
                <div className="relative">
                  <input
                    type={showPasswordText ? 'text' : 'password'}
                    value={targetNewPassword}
                    onChange={(e) => setTargetNewPassword(e.target.value)}
                    placeholder="Masukkan sandi baru..."
                    className="w-full px-3 py-2 pr-10 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {selectedUserForPassword.role === 'admin' && (
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    Konfirmasi Password Baru *
                  </label>
                  <input
                    type={showPasswordText ? 'text' : 'password'}
                    value={targetConfirmPassword}
                    onChange={(e) => setTargetConfirmPassword(e.target.value)}
                    placeholder="Ketik ulang sandi baru..."
                    className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedUserForPassword(null)}
                className="px-3 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={updatingPassword}
                onClick={() => handleSaveTargetPassword(
                  selectedUserForPassword,
                  targetNewPassword,
                  selectedUserForPassword.role === 'admin' ? targetConfirmPassword : undefined
                )}
                className="px-4 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                {updatingPassword && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Simpan Sandi Baru
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH AKUN BARU (PIKET / WALI KELAS / KESISWAAN) */}
      {isNewAccountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-xl text-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Tambah Akun Petugas Baru
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNewAccountModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Peran Akun *
                </label>
                <select
                  value={newAccountRole}
                  onChange={(e) => setNewAccountRole(e.target.value as any)}
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="duty">Petugas Piket (Gerbang / Absensi)</option>
                  <option value="homeroom">Wali Kelas</option>
                  <option value="student_affairs">Bagian Kesiswaan & BK</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Nama Petugas / Guru *
                </label>
                <input
                  type="text"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="Contoh: Dra. Siti Rahayu, M.Pd atau Pos Gerbang Timur"
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              {newAccountRole === 'homeroom' && (
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                    Kelas yang Diampu *
                  </label>
                  <select
                    value={newAccountClassId}
                    onChange={(e) => setNewAccountClassId(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Label / Keterangan (Opsional)
                </label>
                <input
                  type="text"
                  value={newAccountLabel}
                  onChange={(e) => setNewAccountLabel(e.target.value)}
                  placeholder="Contoh: Gerbang Belakang atau Gedung C"
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Kata Sandi Awal (Minimal 4 Karakter) *
                </label>
                <input
                  type="password"
                  value={newAccountPassword}
                  onChange={(e) => setNewAccountPassword(e.target.value)}
                  placeholder="Masukkan kata sandi awal..."
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsNewAccountModalOpen(false)}
                className="px-3 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleCreateNewAccount}
                className="px-4 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold hover:bg-slate-800"
              >
                Simpan & Daftarkan Akun
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
