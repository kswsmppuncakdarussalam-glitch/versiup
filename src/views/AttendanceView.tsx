import React, { useState, useEffect, useRef } from 'react';
import {
  Scan,
  UserCheck,
  Clock,
  Users,
  AlertTriangle,
  UserX,
  Search,
  Plus,
  Maximize2,
  Minimize2,
  Trash2,
  Edit2,
  CheckCircle,
  X,
  Volume2,
  ChevronDown,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { formatServerTime, formatIndonesianDate, LiveClockText } from '../utils/time.js';
import { DriveImage } from '../components/common/DriveImage.js';
import { AttendanceNotificationModal } from '../components/modals/AttendanceNotificationModal.js';
import { StudentProfileModal } from '../components/modals/StudentProfileModal.js';
import { Student, AttendanceRecord, AttendanceStatus } from '../types/index.js';
import { checkSessionAttendanceOpen } from '../utils/sessionHelper.js';

export const AttendanceView: React.FC = () => {
  const {
    students,
    sessions,
    attendance,
    activeSession,
    sessionSchedule,
    lastSessionTransition,
    dismissSessionTransition,
    setManualSessionOverride,
    currentServerTime,
    settings,
    recordAttendance,
    updateAttendance,
    deleteAttendance,
    isKioskFullscreen,
    toggleKioskFullscreen,
    speak,
    showToast,
  } = useApp();

  const [counterScope, setCounterScope] = useState<'session' | 'today'>('session');
  const [manualTargetSessionId, setManualTargetSessionId] = useState<string>('');

  const [scanInput, setScanInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Notification Modal state
  const [modalStudent, setModalStudent] = useState<Student | null>(null);
  const [modalRecord, setModalRecord] = useState<AttendanceRecord | null>(null);
  const [modalMessage, setModalMessage] = useState<string | undefined>(undefined);
  const [modalIsError, setModalIsError] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);

  // Manual Attendance Modal state
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [manualStatus, setManualStatus] = useState<AttendanceStatus>('Hadir');
  const [manualNotes, setManualNotes] = useState('');
  const [manualFeedback, setManualFeedback] = useState<{
    studentName: string;
    status: AttendanceStatus;
    sessionName: string;
    synced: boolean;
  } | null>(null);
  const manualSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  // Edit / Delete Attendance Record state
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editStatus, setEditStatus] = useState<AttendanceStatus>('Hadir');
  const [isUpdatingRecord, setIsUpdatingRecord] = useState(false);

  // Drilldown Profile Modal
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);

  // Auto-focus input pencarian siswa ketika modal Presensi Manual dibuka (cursor utama scan/RFID tidak pernah dikunci)
  useEffect(() => {
    if (showManualModal) {
      const t = setTimeout(() => {
        manualSearchInputRef.current?.focus();
      }, 30);
      return () => clearTimeout(t);
    }
  }, [showManualModal]);

  // Handle Automatic Scan Submission on Enter (USB Barcode & RFID "Keyboard" Mode)
  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanInput.trim();
    if (!code) return;

    setScanInput(''); // clear immediately for next scan in queue
    setIsProcessing(true);

    const res = await recordAttendance({
      code,
      sessionId: activeSession?.id,
    });

    setIsProcessing(false);

    if (res.success && res.record && res.student) {
      const studentName = res.student.name;
      const studentClass = res.student.class_id;
      let speechMsg = '';
      let displayMsg = '';

      if (res.record.status === 'Hadir') {
        speechMsg = `${studentName}, kelas ${studentClass}, Hadir tepat waktu.`;
        displayMsg = `Selamat pagi, ${studentName}. Kamu hadir tepat waktu di sesi ${activeSession?.name || 'presensi'}.`;
      } else if (res.record.status === 'Terlambat') {
        const lateMin = res.record.late_minutes ?? 0;
        speechMsg = `${studentName}, kelas ${studentClass}, Terlambat ${lateMin > 0 ? `${lateMin} menit.` : '.'}`;
        displayMsg = `Halo, ${studentName}. Kamu tercatat terlambat ${lateMin} menit di sesi ${activeSession?.name || 'presensi'}. Silakan segera masuk kelas.`;
      } else if (res.record.status === 'Izin') {
        speechMsg = `${studentName}, kelas ${studentClass}, Tercatat izin.`;
        displayMsg = `${studentName} tercatat izin di sesi ${activeSession?.name || 'presensi'}.`;
      } else if (res.record.status === 'Sakit') {
        speechMsg = `${studentName}, kelas ${studentClass}, Tercatat sakit.`;
        displayMsg = `${studentName} tercatat sakit di sesi ${activeSession?.name || 'presensi'}.`;
      } else if (res.record.status === 'Alpha') {
        speechMsg = `${studentName}, kelas ${studentClass}, Tercatat alpha.`;
        displayMsg = `${studentName} tercatat alpha di sesi ${activeSession?.name || 'presensi'}.`;
      } else {
        speechMsg = `${studentName}, kelas ${studentClass}, Tercatat ${res.record.status}.`;
        displayMsg = `${studentName} tercatat ${res.record.status}.`;
      }

      setModalStudent(res.student);
      setModalRecord(res.record);
      setModalMessage(displayMsg);
      setModalIsError(false);
      setShowNotificationModal(true);
      // Immediately speak name, class, and status
      speak(speechMsg);
    } else {
      // Error / duplicate / unregistered
      const isDup = res.isDuplicate || (res.error && res.error.toLowerCase().includes('sudah tercatat'));
      let speechMsg = '';
      if (isDup) {
        if (res.student && res.record) {
          const methodSrc = res.record.method === 'manual' ? 'Manual' : 'Scan';
          speechMsg = `${res.student.name}, kelas ${res.student.class_id}, sudah tercatat ${res.record.status} melalui ${methodSrc} pada sesi ini.`;
        } else if (res.student) {
          speechMsg = `${res.student.name}, kelas ${res.student.class_id}, sudah melakukan presensi sesi ini hari ini.`;
        } else {
          speechMsg = 'Perhatian, siswa sudah melakukan presensi pada sesi ini hari ini.';
        }
      } else if (res.error && (res.error.toLowerCase().includes('tidak terdaftar') || res.error.toLowerCase().includes('tidak dikenali'))) {
        speechMsg = 'Kartu tidak terdaftar.';
      } else {
        speechMsg = res.error || 'Presensi gagal.';
      }

      const errorMsg = res.error || 'Kartu tidak dikenali';
      setModalStudent(res.student || null);
      setModalRecord(res.record || null);
      setModalMessage(errorMsg);
      setModalIsError(true);
      setShowNotificationModal(true);
      speak(speechMsg);
    }
  };

  const activeSessionWindow = checkSessionAttendanceOpen(activeSession, currentServerTime);
  const effectiveManualSessionId =
    manualTargetSessionId || activeSession?.id || sessions.find((s) => s.is_active)?.id || sessions[0]?.id || '';
  const manualSessionObj = sessions.find((s) => s.id === effectiveManualSessionId) || null;
  const manualSessionWindow = checkSessionAttendanceOpen(manualSessionObj, currentServerTime);

  // Manual Attendance submission (menunggu konfirmasi Google Sheets, tetap berada di modal, dan langsung kembali ke pencarian siswa berikutnya)
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || isSubmittingManual) return;
    if (!manualSessionWindow.open) {
      showToast(manualSessionWindow.message, 'error');
      return;
    }

    const chosenStudent = selectedStudent;
    const chosenStatus = manualStatus;
    const chosenSessionId = effectiveManualSessionId;
    const targetSessName = manualSessionObj?.name || activeSession?.name || 'presensi';

    setIsSubmittingManual(true);
    try {
      const res = await recordAttendance({
        studentId: chosenStudent.nis,
        sessionId: chosenSessionId,
        status: chosenStatus,
        notes: manualNotes,
        method: 'manual',
      });

      if (res.success) {
        const speechMsg = `${chosenStudent.name}, kelas ${chosenStudent.class_id}, Tercatat ${chosenStatus}.`;
        setManualFeedback({
          studentName: chosenStudent.name,
          status: chosenStatus,
          sessionName: targetSessName,
          synced: Boolean(res.syncedFromExisting),
        });
        showToast('Tersimpan', 'success');
        speak(speechMsg);

        // Reset pilihan & langsung kembalikan fokus ke kolom pencarian nama siswa
        setSelectedStudent(null);
        setManualSearch('');
        setManualNotes('');
        setManualStatus('Hadir');
        setTimeout(() => {
          manualSearchInputRef.current?.focus();
        }, 15);
      } else {
        showToast(res.error || 'Gagal menyimpan presensi manual', 'error');
      }
    } finally {
      setIsSubmittingManual(false);
    }
  };

  // Today's attendance calculation (auto-switches cleanly with activeSession when counterScope === 'session')
  const todayStr = currentServerTime.toISOString().split('T')[0];
  const todayAttendanceAll = attendance.filter((a) => a.date === todayStr);
  const activeSessionAttendance = activeSession
    ? todayAttendanceAll.filter((a) => a.session_id === activeSession.id)
    : todayAttendanceAll;
  const scopedAttendance = counterScope === 'session' ? activeSessionAttendance : todayAttendanceAll;

  const manualSessionAttendanceMap = new Map<string, AttendanceRecord>();
  todayAttendanceAll.forEach((a) => {
    if (!effectiveManualSessionId || a.session_id === effectiveManualSessionId) {
      if (!manualSessionAttendanceMap.has(a.student_id)) {
        manualSessionAttendanceMap.set(a.student_id, a);
      }
    }
  });

  const totalStudents = students.length;
  const hadirCount = scopedAttendance.filter((a) => a.status === 'Hadir').length;
  const terlambatCount = scopedAttendance.filter((a) => a.status === 'Terlambat').length;
  const uniquePresensiCount = new Set(scopedAttendance.map((a) => a.student_id)).size;
  const belumPresensiCount = Math.max(0, totalStudents - uniquePresensiCount);

  // Recent attendance list
  const recentAttendance = scopedAttendance.slice(0, 12);

  // Filter students for manual modal autocomplete (instantly shows students)
  const filteredStudents = manualSearch.trim()
    ? students
        .filter(
          (s) =>
            s.name.toLowerCase().includes(manualSearch.toLowerCase().trim()) ||
            s.nis.toLowerCase().includes(manualSearch.toLowerCase().trim()) ||
            s.class_id.toLowerCase().includes(manualSearch.toLowerCase().trim())
        )
        .slice(0, 50)
    : students.slice(0, 50);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Section: Kiosk Header with Clock, Session, & Counters (Bagian 4 Poin 59) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
          {/* Big Digital Clock & School Info */}
          <div className="flex items-center gap-3.5">
            {settings.logo_url && (
              <DriveImage
                srcValue={settings.logo_url}
                alt="Logo Sekolah"
                className="w-12 h-12 rounded-lg object-contain bg-white dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700 shadow-xs shrink-0"
              />
            )}
            <div className="text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2">
                <LiveClockText className="font-mono text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight" />
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                  WIB
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {formatIndonesianDate(currentServerTime)} {settings.school_name && <span>• <strong className="text-slate-700 dark:text-slate-300">{settings.school_name}</strong></span>}
              </p>
            </div>
          </div>

          {/* Active Session Info & Auto-Switch Status */}
          <div className="text-center md:text-right space-y-1">
            <div className="inline-flex flex-wrap items-center justify-center md:justify-end gap-2 px-3 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  sessionSchedule.status === 'active'
                    ? 'bg-emerald-500 animate-pulse'
                    : sessionSchedule.status === 'override'
                    ? 'bg-indigo-500'
                    : 'bg-amber-500'
                }`}
              />
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                {activeSession ? activeSession.name : 'Tidak Ada Sesi Terjadwal'}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  sessionSchedule.manualSessionId
                    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                    : sessionSchedule.isAutoSwitchEnabled
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {sessionSchedule.manualSessionId
                  ? 'Manual Override'
                  : sessionSchedule.isAutoSwitchEnabled
                  ? 'Peralihan Otomatis'
                  : 'Mode Manual'}
              </span>
            </div>
            {activeSession && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Jadwal: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{activeSession.start_time} - {activeSession.end_time}</span> • Tepat Waktu s/d{' '}
                <span className="font-semibold text-slate-800 dark:text-slate-200">{activeSession.on_time_limit}</span>
                {sessionSchedule.status === 'active' && sessionSchedule.minutesRemaining > 0 && (
                  <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                    (Sisa {sessionSchedule.minutesRemaining}m)
                  </span>
                )}
                {sessionSchedule.status === 'upcoming' && sessionSchedule.nextSession && (
                  <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                    (Mulai dlm {sessionSchedule.minutesUntilNext}m)
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Live Session Transition Banner */}
        {lastSessionTransition && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 text-emerald-900 dark:text-emerald-200">
              <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 animate-pulse" />
              <div>
                <span className="font-bold">Peralihan Sesi Otomatis: </span>
                <span>
                  {lastSessionTransition.fromName
                    ? `Sesi berganti otomatis dari "${lastSessionTransition.fromName}" ke `
                    : 'Memasuki sesi '}
                  <strong>"{lastSessionTransition.toSession.name}"</strong> ({lastSessionTransition.toSession.start_time} - {lastSessionTransition.toSession.end_time}). Pemindaian kartu kini tercatat ke sesi baru.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissSessionTransition}
              className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 p-1"
              title="Tutup info peralihan"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Today's Automatic Session Timeline Strip */}
        {sessionSchedule.todayTimeline.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Jadwal Sesi Hari Ini ({sessionSchedule.manualSessionId ? 'Dikunci Manual' : sessionSchedule.isAutoSwitchEnabled ? 'Beralih Otomatis Sesuai Jam Server' : 'Mode Manual'}):
              </span>
              {sessionSchedule.manualSessionId && (
                <button
                  type="button"
                  onClick={() => setManualSessionOverride(null)}
                  className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  Kembali ke Peralihan Otomatis
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {sessionSchedule.todayTimeline.map((item) => {
                const isSelected = activeSession?.id === item.session.id;
                const isLive = item.status === 'active';
                const isDone = item.status === 'completed';
                return (
                  <button
                    key={item.session.id}
                    type="button"
                    onClick={() =>
                      setManualSessionOverride(
                        sessionSchedule.manualSessionId === item.session.id ? null : item.session.id
                      )
                    }
                    title={
                      sessionSchedule.manualSessionId === item.session.id
                        ? 'Klik untuk kembali ke mode otomatis'
                        : `Klik jika ingin mengunci presensi sementara ke sesi ${item.session.name}`
                    }
                    className={`px-2.5 py-1.5 rounded-md border text-left transition-all text-[11px] flex items-center gap-2 ${
                      isSelected
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                        : isDone
                        ? 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 border-slate-200 dark:border-slate-800'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isLive
                          ? 'bg-emerald-400 animate-pulse'
                          : isDone
                          ? 'bg-slate-400'
                          : 'bg-amber-400'
                      }`}
                    />
                    <div>
                      <span className="font-bold block leading-tight">{item.session.name}</span>
                      <span className={`font-mono text-[10px] ${isSelected ? 'opacity-85' : 'text-slate-400'}`}>
                        {item.session.start_time}-{item.session.end_time}
                        {isLive ? ' • Aktif' : isDone ? ' • Ditutup' : item.minutesUntilStart > 0 ? ` • ${item.minutesUntilStart}m lagi` : ''}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Counters with Automatic Session vs Today Scope */}
        <div className="pt-4 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500 dark:text-slate-400 font-medium">
              Statistik {counterScope === 'session' && activeSession ? `Sesi "${activeSession.name}"` : 'Semua Sesi Hari Ini'}:
            </span>
            <div className="inline-flex rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => setCounterScope('session')}
                className={`px-2 py-0.5 rounded font-medium ${
                  counterScope === 'session'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                Sesi Aktif
              </button>
              <button
                type="button"
                onClick={() => setCounterScope('today')}
                className={`px-2 py-0.5 rounded font-medium ${
                  counterScope === 'today'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                Semua Sesi Hari Ini
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">Total Siswa</span>
                <Users className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {totalStudents}
              </p>
            </div>

            <div className="p-3 rounded border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Tepat Waktu</span>
                <UserCheck className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-xl font-bold text-emerald-900 dark:text-emerald-300 mt-1">
                {hadirCount}
              </p>
            </div>

            <div className="p-3 rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20">
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Terlambat</span>
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-xl font-bold text-amber-900 dark:text-amber-300 mt-1">
                {terlambatCount}
              </p>
            </div>

            <div className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">Belum Hadir</span>
                <UserX className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {belumPresensiCount}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Center Section: THE MAIN SCAN FRAME (Bagian 4 Poin 60) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 sm:p-10 shadow-sm text-center relative overflow-hidden">
        {/* Session Open / Closed Indicator */}
        {activeSessionWindow.open ? (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-400 mb-6">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="font-semibold">Siap Memindai (USB RFID / Barcode Scanner)</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-400 mb-4">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="font-semibold">Presensi Ditutup — Di Luar Waktu Sesi</span>
          </div>
        )}

        {!activeSessionWindow.open && (
          <div className="max-w-xl mx-auto mb-5 px-4 py-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs text-left flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Presensi Scan/RFID &amp; Manual Sesi Ini Ditutup</p>
              <p className="mt-0.5 text-[11px]">{activeSessionWindow.message}</p>
            </div>
          </div>
        )}

        {/* Scan Icon & Instruction Frame */}
        <div
          className={`max-w-xl mx-auto p-8 rounded-lg border-2 border-dashed transition-colors ${
            activeSessionWindow.open
              ? 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30'
              : 'border-rose-200 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/10 opacity-85'
          }`}
        >
          <Scan
            className={`w-16 h-16 mx-auto mb-4 ${
              activeSessionWindow.open
                ? 'text-slate-400 dark:text-slate-500 animate-pulse'
                : 'text-rose-300 dark:text-rose-700'
            }`}
          />
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-2">
            {activeSessionWindow.open
              ? 'Tempelkan kartu RFID atau scan barcode/QR kartu siswa'
              : 'Pemindaian kartu ditutup di luar jam sesi'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {activeSessionWindow.open
              ? 'Pembaca kartu bekerja otomatis layaknya keyboard. Cukup tap kartu atau sorot barcode kartu ke alat scanner.'
              : 'Menunggu sesi presensi berikutnya dibuka atau periksa pengaturan jadwal sesi pada menu Admin.'}
          </p>

          {/* SINGLE AUTOMATIC INPUT FIELD (Kursor bebas, tidak dikunci) */}
          <form onSubmit={handleScanSubmit} className="mt-6">
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              disabled={!activeSessionWindow.open}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder={
                !activeSessionWindow.open
                  ? 'Presensi ditutup — di luar waktu sesi'
                  : isProcessing
                  ? 'Memproses scan...'
                  : 'Menunggu pembaca kartu RFID / Barcode scanner...'
              }
              className="w-full text-center px-4 py-3 rounded-md text-sm font-mono border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-inner focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-400 disabled:cursor-not-allowed"
            />
          </form>

          {/* Quick simulator buttons for easy testing without hardware */}
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700/60">
            <span className="text-[11px] text-slate-400 block mb-2">
              Uji Coba Cepat (Klik untuk simulasi tap kartu siswa):
            </span>
            <div className="flex flex-wrap justify-center gap-1.5">
              {students.slice(0, 4).map((s) => (
                <button
                  key={s.nis}
                  type="button"
                  disabled={!activeSessionWindow.open}
                  onClick={() => {
                    if (!activeSessionWindow.open) return;
                    setScanInput(s.rfid_uid);
                    setTimeout(() => {
                      recordAttendance({ code: s.rfid_uid, sessionId: activeSession?.id }).then((res) => {
                        if (res.success && res.record && res.student) {
                          const sName = res.student.name;
                          const sClass = res.student.class_id;
                          let speechMsg = '';
                          if (res.record.status === 'Hadir') {
                            speechMsg = `${sName}, kelas ${sClass}, Hadir tepat waktu.`;
                          } else if (res.record.status === 'Terlambat') {
                            const lateMin = res.record.late_minutes ?? 0;
                            speechMsg = `${sName}, kelas ${sClass}, Terlambat ${lateMin > 0 ? `${lateMin} menit.` : '.'}`;
                          } else {
                            speechMsg = `${sName}, kelas ${sClass}, Tercatat ${res.record.status}.`;
                          }
                          const displayMsg = res.record.status === 'Terlambat'
                            ? `Halo, ${sName}. Kamu tercatat terlambat ${res.record.late_minutes} menit.`
                            : `Selamat pagi, ${sName}. Kamu hadir tepat waktu.`;
                          setModalStudent(res.student);
                          setModalRecord(res.record);
                          setModalMessage(displayMsg);
                          setModalIsError(false);
                          setShowNotificationModal(true);
                          speak(speechMsg);
                        } else {
                          const isDup = res.isDuplicate || (res.error && res.error.toLowerCase().includes('sudah tercatat'));
                          const speechMsg = isDup
                            ? res.student && res.record
                              ? `${res.student.name}, kelas ${res.student.class_id}, sudah tercatat ${res.record.status} (${res.record.method === 'manual' ? 'Manual' : 'Scan'}) pada sesi ini.`
                              : `${res.student ? res.student.name : s.name}, kelas ${res.student ? res.student.class_id : s.class_id}, sudah melakukan presensi pada sesi ini.`
                            : res.error || 'Presensi gagal';
                          setModalStudent(res.student || s);
                          setModalRecord(res.record || null);
                          setModalMessage(res.error || 'Sudah presensi');
                          setModalIsError(true);
                          setShowNotificationModal(true);
                          speak(speechMsg);
                        }
                      });
                    }, 50);
                  }}
                  className="px-2.5 py-1 rounded text-[11px] font-medium bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  Tap {s.name.split(' ')[0]} ({s.rfid_uid})
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Presensi Manual Button, Uji Suara TTS, & Fullscreen (Bagian 4 Poin 70) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              setManualFeedback(null);
              if (!manualTargetSessionId && activeSession?.id) {
                setManualTargetSessionId(activeSession.id);
              }
              setShowManualModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Presensi Manual</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const sampleStudent = students[0];
              const testMsg = sampleStudent
                ? `${sampleStudent.name}, kelas ${sampleStudent.class_id}, Hadir tepat waktu.`
                : 'Uji coba suara presensi SMP Puncak Darussalam, hadir tepat waktu.';
              speak(testMsg);
              showToast(`Uji suara: "${testMsg}"`, 'info');
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            title="Uji coba pembacaan nama, kelas, dan status suara presensi"
          >
            <Volume2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Uji Suara TTS</span>
          </button>

          <button
            type="button"
            onClick={toggleKioskFullscreen}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {isKioskFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isKioskFullscreen ? 'Keluar Layar Penuh' : 'Mode Layar Penuh'}</span>
          </button>
        </div>
      </div>

      {/* Bottom Section: Recent Real-Time Attendance List (Bagian 4 Poin 62) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Presensi Terbaru Real-Time ({scopedAttendance.length} catatan {counterScope === 'session' && activeSession ? `di sesi ${activeSession.name}` : 'hari ini'})
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">Diperbarui otomatis</span>
        </div>

        {recentAttendance.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            Belum ada siswa yang melakukan presensi pada sesi ini hari ini.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
            {recentAttendance.map((rec) => {
              const student = students.find((s) => s.nis === rec.student_id);
              const sessName = sessions.find((s) => s.id === rec.session_id)?.name || rec.session_id;
              return (
                <div
                  key={rec.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/30 px-2 rounded"
                >
                  <div
                    onClick={() => student && setProfileStudent(student)}
                    className="flex items-center gap-3 cursor-pointer min-w-0"
                  >
                    <div className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-700 dark:text-slate-300 overflow-hidden shrink-0">
                      {student?.photo_url ? (
                        <DriveImage srcValue={student.photo_url} alt={student.name} className="w-full h-full object-cover" />
                      ) : (
                        student?.name.slice(0, 2).toUpperCase() || '!'
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate hover:underline">
                        {student?.name || rec.student_id}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Kelas {student?.class_id || '-'} • NIS: {rec.student_id} • Sesi: <span className="font-semibold text-slate-600 dark:text-slate-300">{sessName}</span> • {rec.method}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-slate-600 dark:text-slate-400">
                      {new Date(rec.timestamp).toLocaleTimeString('id-ID')}
                    </span>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        rec.status === 'Hadir'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400'
                          : rec.status === 'Terlambat'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-400'
                      }`}
                    >
                      {rec.status} {rec.late_minutes > 0 ? `(+${rec.late_minutes}m)` : ''}
                    </span>

                    {/* Edit / Delete action */}
                    <button
                      onClick={() => {
                        setEditingRecord(rec);
                        setEditStatus(rec.status);
                        setEditReason('');
                      }}
                      title="Koreksi presensi"
                      className="text-slate-400 hover:text-slate-600 p-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Manual Attendance Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Presensi Manual Siswa (Sinkron Otomatis Sesi)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Cari siswa, pilih status kehadiran, lalu simpan — langsung siap mencari siswa berikutnya
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowManualModal(false);
                  setManualFeedback(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="mt-3 space-y-3.5 text-xs overflow-y-auto pr-0.5">
              {/* Target Session Selector (Berdiri Sendiri Per Sesi) */}
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">
                  Sesi Presensi Target (Data Terpisah Per Sesi):
                </label>
                <select
                  value={effectiveManualSessionId}
                  onChange={(e) => {
                    const nextSessId = e.target.value;
                    setManualTargetSessionId(nextSessId);
                    if (selectedStudent) {
                      const existingRec = todayAttendanceAll.find(
                        (a) => a.student_id === selectedStudent.nis && a.session_id === nextSessId
                      );
                      setManualStatus(existingRec?.status || 'Hadir');
                      setManualNotes(existingRec?.notes || '');
                    }
                  }}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                >
                  {sessions.filter((s) => s.is_active).map((s) => {
                    const win = checkSessionAttendanceOpen(s, currentServerTime);
                    const tag = win.open
                      ? ' — [Dibuka]'
                      : win.reason === 'upcoming'
                      ? ' — [Belum Mulai]'
                      : ' — [Ditutup]';
                    return (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.start_time} - {s.end_time}){tag}
                      </option>
                    );
                  })}
                </select>
                {!manualSessionWindow.open && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 flex items-start gap-2 text-[11px]">
                    <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Presensi Manual Ditutup</p>
                      <p>{manualSessionWindow.message}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Persistent Active Search Bar — ALWAYS visible above selected student & list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 text-xs">
                    Cari Nama Siswa / NIS / Kelas:
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {filteredStudents.length} siswa ditampilkan
                  </span>
                </div>

                <div className="relative">
                  <input
                    ref={manualSearchInputRef}
                    type="text"
                    autoFocus
                    value={manualSearch}
                    onChange={(e) => setManualSearch(e.target.value)}
                    placeholder="Ketik nama siswa, NIS, atau kelas..."
                    className="w-full pl-9 pr-8 py-2.5 text-xs rounded-lg border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
                  />
                  <Search className="w-4 h-4 text-emerald-500 absolute left-3 top-3" />
                  {manualSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualSearch('');
                        manualSearchInputRef.current?.focus();
                      }}
                      className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 absolute right-2.5 top-2.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Inline last-saved banner */}
                {manualFeedback && (
                  <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1.5 font-medium">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>
                        <strong>{manualFeedback.studentName}</strong> ({manualFeedback.status}) di sesi{' '}
                        <strong>{manualFeedback.sessionName}</strong> tersimpan.
                      </span>
                    </span>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">
                      Siap input berikutnya
                    </span>
                  </div>
                )}

                {/* Student List (always visible if no student selected OR user is typing a new search) */}
                {(!selectedStudent || manualSearch.trim().length > 0) && (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60 shadow-inner">
                    {filteredStudents.length > 0 ? (
                      filteredStudents.map((s) => {
                        const existingAtt = manualSessionAttendanceMap.get(s.nis);
                        const isChosen = selectedStudent?.nis === s.nis;
                        return (
                          <div
                            key={s.nis}
                            onClick={() => {
                              if (!manualSessionWindow.open) return;
                              setSelectedStudent(s);
                              setManualSearch('');
                              setManualStatus(existingAtt?.status || 'Hadir');
                              setManualNotes(existingAtt?.notes || '');
                            }}
                            className={`p-2.5 flex items-center justify-between gap-2 transition-colors group ${
                              !manualSessionWindow.open
                                ? 'opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800/40'
                                : 'hover:bg-emerald-50/70 dark:hover:bg-slate-700/80 cursor-pointer'
                            } ${isChosen ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                                {s.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <span className="font-semibold text-slate-900 dark:text-white text-xs block truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
                                  {s.name}
                                </span>
                                <span className="text-[10px] text-slate-400 block">
                                  Kelas: <strong className="font-semibold text-slate-600 dark:text-slate-300">{s.class_id}</strong> • NIS: <span className="font-mono">{s.nis}</span>
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {existingAtt ? (
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    existingAtt.status === 'Hadir'
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                      : existingAtt.status === 'Terlambat'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                      : existingAtt.status === 'Izin'
                                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                      : existingAtt.status === 'Sakit'
                                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                                      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                  }`}
                                >
                                  {existingAtt.status} ({existingAtt.method === 'manual' ? 'Manual' : 'Scan'})
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                                  Belum
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={!manualSessionWindow.open}
                                className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-900 dark:bg-slate-600 text-white group-hover:bg-emerald-600 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                              >
                                {manualSessionWindow.open ? 'Pilih' : 'Ditutup'}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-slate-400 text-xs">
                        Tidak ada siswa yang cocok dengan "{manualSearch}".
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Selected Student Card BELOW active search bar */}
              {selectedStudent && (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-emerald-300 dark:border-emerald-800/60 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                      Siswa Terpilih
                      {(() => {
                        const curAtt = manualSessionAttendanceMap.get(selectedStudent.nis);
                        return curAtt ? (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 normal-case font-semibold">
                            Saat ini: {curAtt.status} ({curAtt.method === 'manual' ? 'Manual' : 'Scan'})
                          </span>
                        ) : null;
                      })()}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStudent(null);
                        setManualSearch('');
                        setTimeout(() => manualSearchInputRef.current?.focus(), 10);
                      }}
                      className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      <span>Batal Pilih</span>
                    </button>
                  </div>

                  {/* Horizontal row: Student Name & Info on Left, Dropdown Status on Right */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-0.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                        {selectedStudent.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 dark:text-white text-sm truncate leading-snug">
                          {selectedStudent.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Kelas: <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedStudent.class_id}</span> • NIS: <span className="font-mono font-medium">{selectedStudent.nis}</span>
                        </p>
                      </div>
                    </div>

                    {/* Dropdown status presensi berada persis di samping kanan nama siswa */}
                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-center pl-1 sm:pl-0">
                      <label htmlFor="manual-status-dropdown" className="text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0">
                        Status:
                      </label>
                      <div className="relative">
                        <select
                          id="manual-status-dropdown"
                          disabled={!manualSessionWindow.open}
                          value={manualStatus}
                          onChange={(e) => setManualStatus(e.target.value as AttendanceStatus)}
                          className={`pl-3 pr-8 py-2 rounded-lg font-bold text-xs border shadow-xs appearance-none cursor-pointer focus:outline-none focus:ring-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                            manualStatus === 'Hadir'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700 focus:ring-emerald-500'
                              : manualStatus === 'Terlambat'
                              ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700 focus:ring-amber-500'
                              : manualStatus === 'Izin'
                              ? 'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700 focus:ring-blue-500'
                              : manualStatus === 'Sakit'
                              ? 'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-700 focus:ring-purple-500'
                              : 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-700 focus:ring-rose-500'
                          }`}
                        >
                          <option value="Hadir">🟢 Hadir</option>
                          <option value="Terlambat">🟡 Terlambat</option>
                          <option value="Izin">🔵 Izin</option>
                          <option value="Sakit">🟣 Sakit</option>
                          <option value="Alpha">🔴 Alpha</option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">
                  Catatan / Keterangan (Opsional):
                </label>
                <input
                  type="text"
                  disabled={!manualSessionWindow.open}
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Contoh: Mengikuti lomba dinas, dispensasi OSIS, surat dokter..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 shrink-0">
                <span className="text-[11px] text-slate-400">
                  {!manualSessionWindow.open
                    ? 'Sesi ditutup — pilih sesi yang sedang dibuka'
                    : selectedStudent
                    ? 'Simpan & otomatis kembali ke pencarian'
                    : 'Pilih siswa dari daftar di atas'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowManualModal(false);
                      setManualFeedback(null);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
                  >
                    Tutup
                  </button>
                  <button
                    type="submit"
                    disabled={!selectedStudent || !manualSessionWindow.open || isSubmittingManual}
                    className="px-4 py-1.5 rounded-lg font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>{isSubmittingManual ? 'Menyimpan...' : 'Simpan & Cari Berikutnya'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Record Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
              Koreksi / Hapus Presensi
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Ubah Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {['Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Alasan Koreksi (Wajib untuk Audit Log)</label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Alasan perubahan data..."
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={isUpdatingRecord}
                  onClick={async () => {
                    if (isUpdatingRecord) return;
                    if (!editReason.trim()) {
                      showToast('Alasan pembatalan wajib diisi.', 'error');
                      return;
                    }
                    setIsUpdatingRecord(true);
                    try {
                      const ok = await deleteAttendance(editingRecord.id, editReason);
                      if (ok) setEditingRecord(null);
                    } finally {
                      setIsUpdatingRecord(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded text-rose-600 border border-rose-200 hover:bg-rose-50 disabled:opacity-50"
                >
                  Hapus Data
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isUpdatingRecord}
                    onClick={() => setEditingRecord(null)}
                    className="px-3 py-1.5 text-slate-600 disabled:opacity-50"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingRecord}
                    onClick={async () => {
                      if (isUpdatingRecord) return;
                      if (!editReason.trim()) {
                        showToast('Alasan koreksi wajib diisi.', 'error');
                        return;
                      }
                      setIsUpdatingRecord(true);
                      try {
                        const ok = await updateAttendance(editingRecord.id, { status: editStatus }, editReason);
                        if (ok) setEditingRecord(null);
                      } finally {
                        setIsUpdatingRecord(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isUpdatingRecord ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Center Scan Notification Modal */}
      {showNotificationModal && (
        <AttendanceNotificationModal
          student={modalStudent}
          record={modalRecord}
          session={activeSession}
          customMessage={modalMessage}
          isError={modalIsError}
          onClose={() => setShowNotificationModal(false)}
        />
      )}

      {/* Drill-down Student Profile */}
      <StudentProfileModal
        student={profileStudent}
        onClose={() => setProfileStudent(null)}
      />
    </div>
  );
};
