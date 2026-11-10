import React, { useState, useEffect, useMemo } from 'react';
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
import { GoogleAccountSelectModal } from '../components/modals/GoogleAccountSelectModal.js';
import {
  getGoogleClientId,
  setCustomGoogleClientId,
} from '../utils/googleWorkspace.js';
import {
  SCHOOL_NAME_PRESETS,
  SCHOOL_LOGO_PRESETS,
  compressImageFile,
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
    saveSession,
    deleteSession,
    violationTypes,
    saveViolationType,
    deleteViolationType,
    attendance,
    outOfClass,
    violations,
    serverVersion,
    googleSheetsConnected,
    googleAccount,
    googleSyncing,
    connectGoogle,
    disconnectGoogle,
    syncGoogleSheetsNow,
    lockCurrentMenu,
    notificationLogs,
    auditLogs,
    syncNow,
    speak,
    showToast,
    updateSessionToken,
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
  >('students');

  // Student CRUD & Import states
  const [editingStudent, setEditingStudent] = useState<Partial<Student> | null>(null);
  const [importRows, setImportRows] = useState<StudentImportRow[] | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [printCardStudent, setPrintCardStudent] = useState<Student | null>(null);
  const [selectedStudentNis, setSelectedStudentNis] = useState<Set<string>>(new Set());
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('all');
  const [isClearAllModalOpen, setIsClearAllModalOpen] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false);
  const [customClientIdInput, setCustomClientIdInput] = useState(() => getGoogleClientId());
  const [showClientIdConfig, setShowClientIdConfig] = useState(false);
  const [isEditingDriveIds, setIsEditingDriveIds] = useState(false);
  const [inlineSheetIdInput, setInlineSheetIdInput] = useState('');
  const [inlineFolderIdInput, setInlineFolderIdInput] = useState('');
  const [isManualMultiSyncing, setIsManualMultiSyncing] = useState(false);

  const handleOpenInlineEdit = () => {
    setInlineSheetIdInput(settings.google_sheet_url || settings.google_sheet_id || '');
    setInlineFolderIdInput(settings.google_drive_folder_url || settings.google_drive_folder_id || '');
    setIsEditingDriveIds(true);
  };

  const handleSaveInlineDriveIds = async () => {
    let sId = inlineSheetIdInput.trim();
    let sUrl = '';
    if (sId.includes('/d/')) {
      const parts = sId.split('/d/');
      sId = parts[1].split('/')[0];
      sUrl = inlineSheetIdInput.trim();
    } else if (sId) {
      sUrl = `https://docs.google.com/spreadsheets/d/${sId}/edit`;
    }

    let fId = inlineFolderIdInput.trim();
    let fUrl = '';
    if (fId.includes('/folders/')) {
      const parts = fId.split('/folders/');
      fId = parts[1].split('/')[0].split('?')[0];
      fUrl = inlineFolderIdInput.trim();
    } else if (fId) {
      fUrl = `https://drive.google.com/drive/folders/${fId}`;
    }

    await updateSettings({
      google_sheet_id: sId,
      google_sheet_url: sUrl,
      google_drive_folder_id: fId,
      google_drive_folder_url: fUrl,
      google_account_email: settings.google_account_email || 'kswsmp.puncakdarussalam@gmail.com',
      google_account_name: settings.google_account_name || 'Kesiswaan SMP Puncak Darussalam',
      google_last_synced_at: new Date().toISOString(),
    });
    showToast('Tautan Google Spreadsheet & Drive berhasil diperbarui!', 'success');
    setIsEditingDriveIds(false);
  };

  // Session CRUD state
  const [editingSession, setEditingSession] = useState<Partial<AttendanceSession> | null>(null);

  // Class CRUD state
  const [editingClass, setEditingClass] = useState<Partial<SchoolClass> | null>(null);

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

  // Fetch all user accounts from server
  const fetchUsers = async () => {
    if (!session?.token) return;
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/auth?action=manage_accounts', {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });
      const data = await res.json();
      if (res.ok && data.users) {
        setUsersList(data.users);
      }
    } catch (e: any) {
      console.error('Failed to load accounts:', e);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'accounts' || !usersList.length) {
      fetchUsers();
    }
  }, [activeSection, session?.token]);

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
      const res = await fetch('/api/auth?action=manage_accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.token}`,
        },
        body: JSON.stringify({
          targetUserId: targetUser.id,
          newPassword: newPass.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Gagal mengubah password.', 'error');
        return;
      }

      if (data.refreshedToken) {
        updateSessionToken(data.refreshedToken);
        showToast('Password Administrator sendiri berhasil diperbarui! Sesi browser ini diperbarui otomatis, perangkat lain telah dikeluarkan.', 'success');
      } else {
        showToast(`Password untuk "${targetUser.name}" berhasil diperbarui. Sesi perangkat lain otomatis dikeluarkan.`, 'success');
      }

      setTargetNewPassword('');
      setTargetConfirmPassword('');
      setSelectedUserForPassword(null);
      await fetchUsers();
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
      const res = await fetch('/api/auth?action=manage_accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.token}`,
        },
        body: JSON.stringify({
          targetRole,
          newPassword: newPass.trim(),
          classId: classId === 'all' ? undefined : classId,
          universalHomeroom: targetRole === 'homeroom' && classId === 'all',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Gagal mengubah password.', 'error');
        return false;
      }

      if (data.refreshedToken) {
        updateSessionToken(data.refreshedToken);
        showToast('Password Administrator berhasil diperbarui! Sesi browser Anda tetap aktif tanpa terputus.', 'success');
      } else {
        const roleLabel =
          targetRole === 'admin'
            ? 'Administrator'
            : targetRole === 'student_affairs'
            ? 'Kesiswaan'
            : targetRole === 'homeroom'
            ? classId && classId !== 'all'
              ? `Wali Kelas ${classId}`
              : 'Seluruh Wali Kelas (Sandi Bersama)'
            : 'Petugas Piket';
        showToast(`Kata sandi ${roleLabel} berhasil diperbarui langsung tanpa perlu menambah akun!`, 'success');
      }

      await fetchUsers();
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
      const res = await fetch('/api/auth?action=manage_accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.token}`,
        },
        body: JSON.stringify({
          user: payload,
          newPassword: newAccountPassword.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Gagal membuat akun.', 'error');
        return;
      }

      showToast(`Akun ${payload.name} berhasil dibuat.`, 'success');
      setIsNewAccountModalOpen(false);
      setNewAccountName('');
      setNewAccountLabel('');
      setNewAccountPassword('');
      await fetchUsers();
    } catch (err: any) {
      showToast(`Terjadi kesalahan: ${err.message}`, 'error');
    }
  };

  const handleDeleteAccount = async (id: string, name: string) => {
    if (id === 'user_admin_main') {
      showToast('Akun administrator utama tidak dapat dihapus.', 'error');
      return;
    }
    if (!confirm(`Hapus akun "${name}"? Tindakan ini tidak dapat dibatalkan.`)) return;

    try {
      const res = await fetch('/api/auth?action=manage_accounts', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.token}`,
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Gagal menghapus akun.', 'error');
        return;
      }
      showToast(`Akun "${name}" telah dihapus.`, 'success');
      await fetchUsers();
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
    if (!importRows) return;
    const validRows = importRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      showToast('Tidak ada baris data valid untuk diimpor.', 'error');
      return;
    }

    // 1. Otomatis deteksi & buat kelas baru yang belum ada di data kelas
    const existingClassIds = new Set(classes.map((c) => c.id.toLowerCase().trim()));
    const uniqueNewClasses = new Map<string, string>();
    for (const r of validRows) {
      if (r.Kelas && !existingClassIds.has(r.Kelas.toLowerCase().trim())) {
        uniqueNewClasses.set(r.Kelas.trim(), r.Kelas.trim());
      }
    }

    // Buat kelas-kelas baru secara otomatis di basis data
    for (const classCode of uniqueNewClasses.keys()) {
      let grade = '10';
      const gradeMatch = classCode.match(/^(10|11|12)/i) || classCode.match(/^(X|XI|XII)/i);
      if (gradeMatch) {
        const g = gradeMatch[1].toUpperCase();
        grade = g === 'X' ? '10' : g === 'XI' ? '11' : g === 'XII' ? '12' : g;
      }

      let major = '';
      const majorParts = classCode.split('-');
      if (majorParts.length > 1) {
        major = majorParts[1].trim();
      }

      await saveClass({
        id: classCode,
        name: classCode,
        grade,
        major: major || 'Umum',
        homeroom_teacher_name: `Wali Kelas ${classCode}`,
        homeroom_teacher_email: `${classCode.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sekolah.sch.id`,
        quota_limit: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // 2. Simpan data seluruh siswa yang valid
    const studentsToSave: Student[] = validRows.map((r) => ({
      nis: r.NIS,
      nisn: r.NISN || '',
      name: r.Nama,
      class_id: r.Kelas.trim(),
      gender: r.Jenis_Kelamin || 'L',
      rfid_uid: r.UID_RFID || `RFID-${r.NIS}`,
      card_code: r.NIS,
      photo_url: '',
      parent_name: r.Nama_Orang_Tua || '',
      parent_email: r.Email_Orang_Tua || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    await batchImportStudents(studentsToSave);
    setIsImportModalOpen(false);
    setImportRows(null);

    if (uniqueNewClasses.size > 0) {
      showToast(
        `Impor sukses! ${studentsToSave.length} siswa tersimpan & ${uniqueNewClasses.size} kelas baru (${Array.from(uniqueNewClasses.keys()).join(', ')}) otomatis ditambahkan ke Data Kelas.`,
        'success'
      );
    } else {
      showToast(`Impor sukses! ${studentsToSave.length} data siswa berhasil disimpan.`, 'success');
    }

    // Auto-sync to Google Sheets if connected
    if (googleSheetsConnected && settings.google_sheet_id) {
      syncGoogleSheetsNow().catch(() => {});
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
    if (!window.confirm(`Yakin ingin menghapus ${selectedStudentNis.size} data siswa terpilih? Tindakan ini tidak dapat dibatalkan.`)) {
      return;
    }
    setIsDeletingBulk(true);
    try {
      const ok = await deleteStudents(Array.from(selectedStudentNis));
      if (ok) {
        setSelectedStudentNis(new Set());
        if (googleSheetsConnected && settings.google_sheet_id) {
          syncGoogleSheetsNow().catch(() => {});
        }
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
        if (googleSheetsConnected && settings.google_sheet_id) {
          syncGoogleSheetsNow().catch(() => {});
        }
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
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testType }),
      });
      const data = await res.json();
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
            <span className="text-xs px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
              Versi Database: v{serverVersion}
            </span>
            <button
              type="button"
              onClick={lockCurrentMenu}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 hover:bg-rose-100 dark:hover:bg-rose-900/60 font-semibold text-xs transition-colors shadow-xs"
              title="Kunci Akses Admin (Wajib Masukkan Password Kembali)"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Kunci & Keluar Admin</span>
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
            ['sync_status', 'Basis Data Google Drive & Sheets'],
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
                onClick={downloadStudentTemplate}
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
                onClick={() => exportToExcel(students, `data_siswa_${Date.now()}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Ekspor Excel</span>
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
                              onClick={async () => {
                                if (window.confirm(`Yakin ingin menghapus nama dan data siswa "${s.name}" (NIS: ${s.nis})?`)) {
                                  const ok = await deleteStudent(s.nis);
                                  if (ok && googleSheetsConnected && settings.google_sheet_id) {
                                    syncGoogleSheetsNow().catch(() => {});
                                  }
                                }
                              }}
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
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Kelola Sesi Presensi & Peralihan Otomatis
              </h2>
              <p className="text-xs text-slate-500">
                Sesi aktif berganti otomatis berdasarkan jam server tanpa perlu campur tangan petugas.
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Sesi</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {sessions.map((sess) => (
              <div key={sess.id} className="py-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{sess.name}</span>
                    <span className="font-mono text-slate-500">({sess.start_time} - {sess.end_time})</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${sess.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                      {sess.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <p className="text-slate-500">
                    Batas Tepat Waktu: <span className="font-semibold">{sess.on_time_limit}</span> • Toleransi Terlambat: {sess.late_tolerance_minutes} Menit
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
            ))}
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
                    onClick={() => {
                      if (confirm(`Hapus jenis pelanggaran ${vt.name}?`)) {
                        deleteViolationType(vt.id);
                      }
                    }}
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
              <button
                type="button"
                onClick={() => fetchUsers()}
                disabled={loadingUsers}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title="Muat ulang data akun dari server"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
                Muat Ulang
              </button>
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
                    onChange={(e) => setSchoolNameInput(e.target.value)}
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
                      <img
                        src={settings.logo_url}
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
                    const compressedDataUrl = await compressImageFile(file, 512);
                    setLogoUrlInput(compressedDataUrl);
                    await updateSettings({ logo_url: compressedDataUrl });
                    showToast('Logo sekolah berhasil diperbarui!', 'success');
                  } catch (err: any) {
                    showToast(err.message || 'Gagal memproses gambar.', 'error');
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
                        const compressedDataUrl = await compressImageFile(file, 512);
                        setLogoUrlInput(compressedDataUrl);
                        await updateSettings({ logo_url: compressedDataUrl });
                        showToast('Logo berhasil diunggah dan disimpan!', 'success');
                      } catch (err: any) {
                        showToast(err.message || 'Gagal memproses gambar.', 'error');
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
                        {isUploadingLogo ? 'Sedang Mengompresi & Menyimpan Logo...' : 'Klik atau Tarik Berkas Logo ke Sini'}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Mendukung PNG, JPG, SVG, dan WebP (Maksimal 5MB). Otomatis dioptimasi untuk performa cepat dan offline.
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
                                setLogoUrlInput(preset.dataUrl);
                                await updateSettings({ logo_url: preset.dataUrl });
                                showToast(`Logo template "${preset.name}" berhasil dipasang!`, 'success');
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
                    <img
                      src={settings.logo_url}
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
                    <img
                      src={settings.logo_url}
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
                      <img
                        src={settings.logo_url}
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
                    onClick={async () => {
                      setIsSavingName(true);
                      try {
                        setSchoolNameInput('');
                        await updateSettings({ school_name: '' });
                        showToast('Nama sekolah berhasil dikosongkan.', 'success');
                        setShowClearNameConfirm(false);
                      } finally {
                        setIsSavingName(false);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-medium"
                  >
                    Ya, Hapus Nama
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
                    onClick={async () => {
                      setIsSavingLogo(true);
                      try {
                        setLogoUrlInput('');
                        await updateSettings({ logo_url: '' });
                        showToast('Logo sekolah berhasil dihapus. Kembali menggunakan monogram DKB.', 'success');
                        setShowClearLogoConfirm(false);
                      } finally {
                        setIsSavingLogo(false);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-medium"
                  >
                    Ya, Hapus Logo
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
                  <img
                    src={settings.logo_url}
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
              <label className="block text-slate-500 mb-1">
                Template Kalimat Hadir Tepat Waktu (Variabel: &#123;nama&#125;, &#123;kelas&#125;, &#123;sesi&#125;)
              </label>
              <input
                type="text"
                value={settings.tts_template_present}
                onChange={(e) => updateSettings({ tts_template_present: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-slate-500 mb-1">
                Template Kalimat Terlambat (Variabel: &#123;nama&#125;, &#123;menit&#125;, &#123;sesi&#125;)
              </label>
              <input
                type="text"
                value={settings.tts_template_late}
                onChange={(e) => updateSettings({ tts_template_late: e.target.value })}
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
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Pengaturan Notifikasi Email ke Orang Tua
              </h2>
              <p className="text-slate-500">Kirim pemberitahuan otomatis ke email orang tua saat siswa terlambat atau melanggar.</p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="email-toggle"
                checked={settings.toggle_email_notifications && notificationSettings.email_enabled}
                onChange={(e) => {
                  updateSettings({ toggle_email_notifications: e.target.checked });
                  updateNotificationSettings({ email_enabled: e.target.checked });
                }}
                className="w-4 h-4 rounded text-slate-900"
              />
              <label htmlFor="email-toggle" className="font-semibold text-slate-800 dark:text-slate-200">
                Aktifkan Notifikasi Email
              </label>
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
                    onChange={(e) => setWeeklyRecapDay(parseInt(e.target.value))}
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
                    onChange={(e) => setWeeklyRecapTime(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      updateNotificationSettings({
                        weekly_recap_day: weeklyRecapDay,
                        weekly_recap_time: weeklyRecapTime,
                      });
                      showToast('Jadwal rekap mingguan berhasil diperbarui.', 'success');
                    }}
                    className="w-full py-1.5 px-3 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold text-xs hover:bg-slate-800"
                  >
                    Simpan Jadwal Pengiriman
                  </button>
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
                showToast(res.message, res.success ? 'success' : 'error');
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

      {/* SECTION 10: STATUS SINKRONISASI & BASIS DATA GOOGLE DRIVE & SHEETS */}
      {activeSection === 'sync_status' && (
        <div className="space-y-5 text-xs">
          {/* Main Google Integration Header Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    Basis Data Google Drive & Google Sheets
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${googleSheetsConnected ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {googleSheetsConnected ? 'Cloud Google Aktif' : 'Penyimpanan Lokal Aktif'}
                    </span>
                  </h2>
                  <p className="text-slate-500">
                    Hubungkan akun Google Anda. Aplikasi secara otomatis membuat folder khusus di Google Drive dan spreadsheet multi-tabel di Google Sheets.
                  </p>
                </div>
              </div>

              {/* Action: Sync now */}
              <button
                type="button"
                disabled={googleSyncing}
                onClick={() => syncGoogleSheetsNow()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs disabled:opacity-50 transition-colors shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${googleSyncing ? 'animate-spin' : ''}`} />
                <span>{googleSyncing ? 'Menyinkronkan...' : 'Sinkronkan ke Google Sheets'}</span>
              </button>
            </div>

            {/* Google Account Connection Status */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {googleAccount?.photo || settings.google_account_photo ? (
                    <img
                      src={googleAccount?.photo || settings.google_account_photo}
                      alt="Google Avatar"
                       className="w-11 h-11 rounded-full border-2 border-white dark:border-slate-700 shadow-xs"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-700 dark:text-slate-300 text-sm">
                      {(googleAccount?.name || settings.google_account_name || 'G')[0]}
                    </div>
                  )}

                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white text-sm">
                        {googleAccount?.name || settings.google_account_name || 'Belum Terhubung dengan Akun Google'}
                      </span>
                      {googleSheetsConnected && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                          <Check className="w-3 h-3" />
                          Terhubung
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 font-mono text-[11px]">
                      {googleAccount?.email || settings.google_account_email || 'Masuk dengan akun Google untuk mengaktifkan sinkronisasi otomatis'}
                    </p>
                    {settings.google_last_synced_at && (
                      <p className="text-[10px] text-slate-400">
                        Sinkron terakhir: {new Date(settings.google_last_synced_at).toLocaleString('id-ID')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Account Connect / Change / Disconnect Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {!googleSheetsConnected ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={googleSyncing}
                        onClick={() => connectGoogle(false, 'kswsmp.puncakdarussalam@gmail.com')}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors"
                        title="Hubungkan otomatis akun kswsmp.puncakdarussalam@gmail.com ke Google Cloud Console"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-300" />
                        <span>Otomatis ke Cloud Console (kswsmp.puncakdarussalam@gmail.com)</span>
                      </button>

                      <button
                        type="button"
                        disabled={googleSyncing}
                        onClick={() => setIsGoogleModalOpen(true)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 font-semibold text-slate-700 dark:text-slate-200 text-xs shadow-xs transition-colors"
                      >
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 48 48">
                          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                        </svg>
                        <span>Opsi Google Lengkap</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={googleSyncing}
                        onClick={() => syncGoogleSheetsNow()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors shadow-xs disabled:opacity-50"
                        title="Kirim dan sinkronkan data terkini ke Google Sheets & Google Drive"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${googleSyncing ? 'animate-spin' : ''}`} />
                        <span>{googleSyncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={googleSyncing}
                        onClick={() => setIsGoogleModalOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 font-semibold transition-colors"
                        title="Ganti email atau hubungkan dengan akun Google lain"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
                        <span>Ganti Email / Akun Lain</span>
                      </button>

                      <button
                        type="button"
                        disabled={googleSyncing}
                        onClick={() => {
                          if (window.confirm('Apakah Anda yakin ingin memutuskan akun Google dari aplikasi?')) {
                            disconnectGoogle();
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold transition-colors"
                        title="Putuskan sambungan akun Google"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Putuskan Akun</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Mode & Optional Advanced Developer Settings */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Mode Akun: Email Sekolah Langsung (Bebas Error Developer &amp; Tanpa ID)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClientIdConfig(!showClientIdConfig)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1"
                >
                  <Key className="w-3.5 h-3.5 text-blue-500" />
                  <span>{showClientIdConfig ? 'Tutup Pengaturan Lanjutan' : 'Pengaturan Lanjutan Cloud Console (Opsional)'}</span>
                </button>
              </div>

              {showClientIdConfig && (
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3.5 animate-in fade-in duration-150">
                  {/* Origin URL Copy Bar */}
                  <div className="p-2.5 rounded-md bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[11px] text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        Asal JavaScript Aplikasi (Tambahkan ke Google Cloud Console)
                      </span>
                      <a
                        href="https://console.cloud.google.com/apis/credentials"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Buka Credentials Console</span>
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-2.5 py-1.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[11px] truncate border border-slate-200 dark:border-slate-700 select-all">
                        {typeof window !== 'undefined' ? window.location.origin : ''}
                      </code>
                      <button
                        type="button"
                        onClick={async () => {
                          const orig = typeof window !== 'undefined' ? window.location.origin : '';
                          if (orig) {
                            await navigator.clipboard.writeText(orig);
                            showToast('Asal JavaScript disalin! Tempelkan di Authorized JavaScript origins.', 'success');
                          }
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Salin Origin URL</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 text-[11px] mb-1">
                      OAuth 2.0 Web Client ID (dari console.cloud.google.com):
                    </label>
                    <input
                      type="text"
                      value={customClientIdInput}
                      onChange={(e) => setCustomClientIdInput(e.target.value)}
                      placeholder="contoh: 1049823447787-xxxx.apps.googleusercontent.com"
                      className="w-full px-3 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-500">
                      Pastikan URL asal aplikasi di atas didaftarkan di <strong>Authorized JavaScript origins</strong> pada Client ID ini.
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          setCustomGoogleClientId('');
                          await updateSettings({ google_client_id: '' });
                          setCustomClientIdInput(getGoogleClientId());
                          showToast('Client ID dikembalikan ke bawaan.', 'info');
                          setShowClientIdConfig(false);
                        }}
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      >
                        Reset Default
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const cleaned = customClientIdInput.trim();
                          setCustomGoogleClientId(cleaned);
                          await updateSettings({ google_client_id: cleaned });
                          showToast('Client ID Google Console disimpan ke database!', 'success');
                          setShowClientIdConfig(false);
                        }}
                        className="px-3 py-1 text-[11px] font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 rounded-lg shadow-xs"
                      >
                        Simpan Client ID
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Folder & Spreadsheet Automated Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {/* Card 1: Google Drive Folder */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      <Folder className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white">Folder Google Drive</h3>
                      <p className="text-[11px] text-slate-500">Folder Khusus Aplikasi Sekolah</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                    Otomatis Dibuat
                  </span>
                </div>

                <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                  <div className="text-slate-500 text-[10px] font-sans">Nama Folder:</div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    DISIPLIN KITA BISA - Database Sekolah
                  </div>
                  <div className="text-slate-500 text-[10px] font-sans pt-1">ID Folder:</div>
                  <div className="truncate text-slate-600 dark:text-slate-400">
                    {settings.google_drive_folder_id || '(Dibuat otomatis saat akun Google terhubung)'}
                  </div>
                </div>

                {settings.google_drive_folder_url ? (
                  <a
                    href={settings.google_drive_folder_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white font-semibold transition-colors"
                  >
                    <span>Buka Folder di Google Drive</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={!googleSheetsConnected || googleSyncing}
                    onClick={() => syncGoogleSheetsNow()}
                    className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-500 font-semibold cursor-not-allowed"
                  >
                    <span>Folder Akan Terbentuk Saat Terhubung</span>
                  </button>
                )}
              </div>

              {/* Card 2: Google Spreadsheet */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white">Google Spreadsheet</h3>
                      <p className="text-[11px] text-slate-500">File Database Multi-Tabel</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    7 Lembar Kerja
                  </span>
                </div>

                <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                  <div className="text-slate-500 text-[10px] font-sans">Nama Spreadsheet:</div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    Database Presensi & Kedisiplinan - DISIPLIN KITA BISA
                  </div>
                  <div className="text-slate-500 text-[10px] font-sans pt-1">Lembar Kerja (Sheets):</div>
                  <div className="flex flex-wrap gap-1 font-sans text-[10px]">
                    {['Siswa', 'Kelas', 'Sesi_Presensi', 'Presensi', 'Izin_Keluar', 'Pelanggaran', 'Pengaturan'].map((sh) => (
                      <span key={sh} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {sh}
                      </span>
                    ))}
                  </div>
                </div>

                {settings.google_sheet_url ? (
                  <a
                    href={settings.google_sheet_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors"
                  >
                    <span>Buka Database di Google Sheets</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={!googleSheetsConnected || googleSyncing}
                    onClick={() => syncGoogleSheetsNow()}
                    className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-500 font-semibold cursor-not-allowed"
                  >
                    <span>Spreadsheet Akan Terbentuk Saat Terhubung</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Inline Manual Drive/Sheet Link Toggle */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-blue-500" />
                  Tautkan Link / ID Spreadsheet &amp; Folder Manual (Tanpa OAuth)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!isEditingDriveIds) handleOpenInlineEdit();
                    else setIsEditingDriveIds(false);
                  }}
                  className="font-bold text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {isEditingDriveIds ? 'Tutup Formulir' : 'Buka Formulir Tautan Manual'}
                </button>
              </div>

              {isEditingDriveIds && (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2.5 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Link atau ID Google Spreadsheet:
                    </label>
                    <input
                      type="text"
                      value={inlineSheetIdInput}
                      onChange={(e) => setInlineSheetIdInput(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/1xxxx/edit atau ID spreadsheet"
                      className="w-full px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Link atau ID Folder Google Drive (Opsional):
                    </label>
                    <input
                      type="text"
                      value={inlineFolderIdInput}
                      onChange={(e) => setInlineFolderIdInput(e.target.value)}
                      placeholder="https://drive.google.com/drive/folders/1xxxx atau ID folder"
                      className="w-full px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-[11px]"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingDriveIds(false)}
                      className="px-3 py-1 rounded text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveInlineDriveIds}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-xs"
                    >
                      Simpan Tautan Spreadsheet &amp; Drive
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Live Data Summary to be Synchronized */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
                <span className="text-slate-400 block text-[10px]">Siswa Terdaftar</span>
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

          {/* Architecture & Multi-device Real-Time Sync Details */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  Status Sinkronisasi Multi-Device Real-Time (Semua Perangkat &amp; Pengguna)
                </h3>
                <p className="text-slate-500 text-[11px] mt-0.5">
                  Setiap mutasi presensi, izin keluar, dan pelanggaran otomatis disinkronkan ke seluruh HP/laptop petugas piket, wali kelas, dan kesiswaan.
                </p>
              </div>

              <button
                type="button"
                disabled={isManualMultiSyncing}
                onClick={async () => {
                  setIsManualMultiSyncing(true);
                  try {
                    await syncNow();
                    showToast(`Sinkronisasi berhasil! Versi data server: v${serverVersion} (terkini).`, 'success');
                  } finally {
                    setIsManualMultiSyncing(false);
                  }
                }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs disabled:opacity-50 transition-colors shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isManualMultiSyncing ? 'animate-spin' : ''}`} />
                <span>{isManualMultiSyncing ? 'Menyinkronkan...' : 'Sinkronkan Multi-Perangkat Sekarang'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-slate-500 block text-[10px]">Versi Data Server (Counter):</span>
                <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  v{serverVersion}
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-slate-500 block text-[10px]">Interval Polling Otomatis:</span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  2.5s (Aktif) / 15s (Latar)
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-slate-500 block text-[10px]">Sinkronisasi Antar Tab:</span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  BroadcastChannel (0ms)
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-slate-500 block text-[10px]">Status Akses Offline:</span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  PWA Cache + Queue Aktif
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                Perlindungan Bentrok &amp; Konsistensi Data Multi-Perangkat:
              </h4>
              <ul className="list-disc pl-4 space-y-1.5 text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                <li>
                  <strong>Pencegahan Duplikat Presensi Antar Perangkat:</strong> Server memeriksa pasangan kunci unik <code>student_id + session_id + date</code> secara atomik dengan lock penulisan. Scan bersamaan dari dua HP berbeda untuk siswa yang sama tidak akan pernah menduplikasi presensi.
                </li>
                <li>
                  <strong>Pencegahan Perebutan Kuota Izin Keluar:</strong> Kuota maksimal 2 siswa per rombel dievaluasi dengan kunci mutex serial di server. Jika 2 siswa mengajukan izin pada detik yang sama di kelas yang sama, sistem memastikan kuota tidak terlampaui.
                </li>
                <li>
                  <strong>Delta Polling Ringan:</strong> Setiap perangkat hanya mengunduh selisih perubahan (delta changes) sejak versi terakhirnya, menghemat kuota internet dan menjaga latensi di bawah 2.5 detik.
                </li>
                <li>
                  <strong>Sinkronisasi Basis Data Cloud:</strong> Seluruh mutasi juga dapat disinkronkan berkala ke Google Sheets dan Google Drive sekolah (<code>kswsmp.puncakdarussalam@gmail.com</code>).
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
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-3 py-1.5 text-slate-600"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  className="px-4 py-1.5 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700"
                >
                  Konfirmasi Impor ({importRows.filter((r) => r.isValid).length} Siswa)
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
                  <img src={settings.logo_url} alt="Logo" className="w-7 h-7 object-contain shrink-0" />
                )}
                <h3 className="font-extrabold text-sm uppercase">{settings.school_name || 'SEKOLAH INDONESIA'}</h3>
              </div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">KARTU PRESENSI SISWA</p>
            </div>

            <div className="flex gap-3 items-center mb-4">
              <div className="w-16 h-16 rounded border border-slate-200 bg-slate-100 flex items-center justify-center font-bold text-lg overflow-hidden shrink-0">
                {printCardStudent.photo_url ? (
                  <img src={printCardStudent.photo_url} alt={printCardStudent.name} className="w-full h-full object-cover" />
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
                <select
                  value={editingStudent.class_id || classes[0]?.id}
                  onChange={(e) => setEditingStudent({ ...editingStudent, class_id: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
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

            <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
              {editingStudent.nis && students.some((s) => s.nis === editingStudent.nis) ? (
                <button
                  type="button"
                  onClick={async () => {
                    if (window.confirm(`Hapus siswa ${editingStudent.name} (${editingStudent.nis})? Tindakan ini tidak dapat dibatalkan.`)) {
                      await deleteStudent(editingStudent.nis!);
                      setEditingStudent(null);
                      if (googleSheetsConnected && settings.google_sheet_id) {
                        syncGoogleSheetsNow().catch(() => {});
                      }
                    }
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
                  onClick={async () => {
                    if (!editingStudent.nis || !editingStudent.name) {
                      showToast('NIS dan Nama wajib diisi.', 'error');
                      return;
                    }
                    await saveStudent(editingStudent as Student);
                    setEditingStudent(null);
                  }}
                  className="px-4 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold transition-colors"
                >
                  Simpan Data Siswa
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
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Akhir sesi</span>
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
                onClick={async () => {
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
                  await saveSession(sessionToSave);
                  setEditingSession(null);
                }}
                className="px-4 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold hover:bg-slate-800"
              >
                Simpan Sesi Presensi
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
                onClick={async () => {
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
                  await saveClass(classToSave);
                  setEditingClass(null);
                  showToast(`Kelas ${classToSave.name} dan email wali kelas berhasil disimpan.`, 'success');
                }}
                className="px-4 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold hover:bg-slate-800"
              >
                Simpan Data Kelas & Email
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

      {/* Google Account Pre-connection Selector Modal */}
      <GoogleAccountSelectModal
        isOpen={isGoogleModalOpen}
        onClose={() => setIsGoogleModalOpen(false)}
        onConfirmConnect={() => {
          setIsGoogleModalOpen(false);
          connectGoogle(true);
        }}
        isLoading={googleSyncing}
        currentEmail={googleAccount?.email || settings.google_account_email}
      />
    </div>
  );
};
