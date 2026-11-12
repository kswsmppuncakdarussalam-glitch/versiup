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
import { AttendanceNotificationModal } from '../components/modals/AttendanceNotificationModal.js';
import { StudentProfileModal } from '../components/modals/StudentProfileModal.js';
import { Student, AttendanceRecord, AttendanceStatus } from '../types/index.js';

export const AttendanceView: React.FC = () => {
  const {
    students,
    attendance,
    activeSession,
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

  // Edit / Delete Attendance Record state
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editStatus, setEditStatus] = useState<AttendanceStatus>('Hadir');

  // Drilldown Profile Modal
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);

  // Keep scan input ALWAYS focused (Bagian 4 Poin 60)
  useEffect(() => {
    const focusInput = () => {
      if (inputRef.current && !showManualModal && !editingRecord && !profileStudent) {
        inputRef.current.focus();
      }
    };

    focusInput();
    const interval = setInterval(focusInput, 1500);

    const handleWindowFocus = () => focusInput();
    const handleDocumentClick = (e: MouseEvent) => {
      // Don't steal focus if user is clicking on modals or inputs
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'BUTTON' && target.tagName !== 'SELECT' && target.tagName !== 'TEXTAREA') {
        focusInput();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('click', handleDocumentClick);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [showManualModal, editingRecord, profileStudent]);

  // Handle Automatic Scan Submission on Enter (USB Barcode & RFID "Keyboard" Mode)
  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanInput.trim();
    if (!code || isProcessing) return;

    setIsProcessing(true);
    setScanInput(''); // clear immediately for next scan in queue

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
        if (res.student) {
          speechMsg = `${res.student.name}, kelas ${res.student.class_id}, sudah melakukan presensi hari ini.`;
        } else {
          speechMsg = 'Perhatian, siswa sudah melakukan presensi hari ini.';
        }
      } else if (res.error && (res.error.toLowerCase().includes('tidak terdaftar') || res.error.toLowerCase().includes('tidak dikenali'))) {
        speechMsg = 'Kartu tidak terdaftar.';
      } else {
        speechMsg = res.error || 'Presensi gagal.';
      }

      const errorMsg = res.error || 'Kartu tidak dikenali';
      setModalStudent(res.student || null);
      setModalRecord(null);
      setModalMessage(errorMsg);
      setModalIsError(true);
      setShowNotificationModal(true);
      speak(speechMsg);
    }
  };

  // Manual Attendance submission
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;

    const res = await recordAttendance({
      studentId: selectedStudent.nis,
      sessionId: activeSession?.id,
      status: manualStatus,
      notes: manualNotes,
      method: 'manual',
    });

    if (res.success && res.record) {
      setShowManualModal(false);
      const studentName = selectedStudent.name;
      const studentClass = selectedStudent.class_id;
      const speechMsg = `${studentName}, kelas ${studentClass}, Tercatat ${manualStatus}.`;
      const displayMsg = `Presensi manual ${studentName} (${studentClass}) berhasil disimpan dengan status ${manualStatus}.`;
      setModalStudent(selectedStudent);
      setModalRecord(res.record);
      setModalMessage(displayMsg);
      setModalIsError(false);
      setShowNotificationModal(true);
      speak(speechMsg);

      // Reset
      setSelectedStudent(null);
      setManualSearch('');
      setManualNotes('');
    } else {
      showToast(res.error || 'Gagal menyimpan presensi manual', 'error');
    }
  };

  // Today's attendance calculation
  const todayStr = currentServerTime.toISOString().split('T')[0];
  const todayAttendance = attendance.filter((a) => a.date === todayStr);

  const totalStudents = students.length;
  const hadirCount = todayAttendance.filter((a) => a.status === 'Hadir').length;
  const terlambatCount = todayAttendance.filter((a) => a.status === 'Terlambat').length;
  const sudahPresensiCount = todayAttendance.length;
  const belumPresensiCount = Math.max(0, totalStudents - sudahPresensiCount);

  // Recent attendance list
  const recentAttendance = todayAttendance.slice(0, 10);

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
              <img
                src={settings.logo_url}
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

          {/* Active Session Info */}
          <div className="text-center md:text-right">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                {activeSession ? activeSession.name : 'Tidak Ada Sesi Terjadwal'}
              </span>
            </div>
            {activeSession && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Batas Tepat Waktu: <span className="font-semibold text-slate-800 dark:text-slate-200">{activeSession.on_time_limit}</span> (Toleransi: {activeSession.late_tolerance_minutes}m)
              </p>
            )}
          </div>
        </div>

        {/* Quick Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
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

      {/* Center Section: THE MAIN SCAN FRAME (Bagian 4 Poin 60) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 sm:p-10 shadow-sm text-center relative overflow-hidden">
        {/* Pulsing indicator "Siap memindai" */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-400 mb-6">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="font-semibold">Siap Memindai (USB RFID / Barcode Scanner)</span>
        </div>

        {/* Scan Icon & Instruction Frame */}
        <div className="max-w-xl mx-auto p-8 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 transition-colors bg-slate-50/50 dark:bg-slate-800/30">
          <Scan className="w-16 h-16 mx-auto text-slate-400 dark:text-slate-500 mb-4 animate-pulse" />
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-2">
            Tempelkan kartu RFID atau scan barcode/QR kartu siswa
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Pembaca kartu bekerja otomatis layaknya keyboard. Cukup tap kartu atau sorot barcode kartu ke alat scanner.
          </p>

          {/* SINGLE AUTOMATIC INPUT FIELD (Bagian 4 Poin 60) */}
          <form onSubmit={handleScanSubmit} className="mt-6">
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder="Menunggu pembaca kartu RFID / Barcode scanner..."
              disabled={isProcessing}
              className="w-full text-center px-4 py-3 rounded-md text-sm font-mono border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-inner focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400"
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
                  onClick={() => {
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
                            ? `${res.student ? res.student.name : s.name}, kelas ${res.student ? res.student.class_id : s.class_id}, sudah melakukan presensi hari ini.`
                            : res.error || 'Presensi gagal';
                          setModalStudent(res.student || s);
                          setModalRecord(null);
                          setModalMessage(res.error || 'Sudah presensi');
                          setModalIsError(true);
                          setShowNotificationModal(true);
                          speak(speechMsg);
                        }
                      });
                    }, 50);
                  }}
                  className="px-2.5 py-1 rounded text-[11px] font-medium bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600"
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
            onClick={() => setShowManualModal(true)}
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
              Presensi Terbaru Real-Time ({todayAttendance.length} siswa hari ini)
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">Diperbarui otomatis</span>
        </div>

        {recentAttendance.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            Belum ada siswa yang melakukan presensi hari ini.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
            {recentAttendance.map((rec) => {
              const student = students.find((s) => s.nis === rec.student_id);
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
                        <img src={student.photo_url} alt={student.name} className="w-full h-full object-cover" />
                      ) : (
                        student?.name.slice(0, 2).toUpperCase() || '!'
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate hover:underline">
                        {student?.name || rec.student_id}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Kelas {student?.class_id || '-'} • NIS: {rec.student_id} • Metode: {rec.method}
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
                    Presensi Manual Siswa
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Pilih siswa dan tentukan status kehadiran secara langsung
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="mt-4 space-y-4 text-xs overflow-y-auto pr-0.5">
              {/* Selected Student Card with Dropdown Status Presensi on the Right */}
              {selectedStudent ? (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-emerald-300 dark:border-emerald-800/60 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                      Siswa Terpilih
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStudent(null);
                        setManualSearch('');
                      }}
                      className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <Search className="w-3 h-3" />
                      <span>Ganti / Cari Siswa Lain</span>
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
                          value={manualStatus}
                          onChange={(e) => setManualStatus(e.target.value as AttendanceStatus)}
                          className={`pl-3 pr-8 py-2 rounded-lg font-bold text-xs border shadow-xs appearance-none cursor-pointer focus:outline-none focus:ring-2 transition-all ${
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
              ) : (
                /* Student Search & Immediate Student List */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block font-bold text-slate-700 dark:text-slate-300 text-xs">
                      Pencarian Siswa (Ketik Nama / NIS / Kelas):
                    </label>
                    <span className="text-[10px] text-slate-400">
                      {filteredStudents.length} siswa tersedia
                    </span>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      autoFocus
                      value={manualSearch}
                      onChange={(e) => setManualSearch(e.target.value)}
                      placeholder="Ketik nama siswa, NIS, atau kelas..."
                      className="w-full pl-9 pr-8 py-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
                    />
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    {manualSearch && (
                      <button
                        type="button"
                        onClick={() => setManualSearch('')}
                        className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 absolute right-2.5 top-2.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Immediate List of Students (Always shown immediately) */}
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60 shadow-inner">
                    {filteredStudents.length > 0 ? (
                      filteredStudents.map((s) => (
                        <div
                          key={s.nis}
                          onClick={() => {
                            setSelectedStudent(s);
                            setManualSearch('');
                          }}
                          className="p-2.5 hover:bg-emerald-50/70 dark:hover:bg-slate-700/80 cursor-pointer flex items-center justify-between transition-colors group"
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
                          <button
                            type="button"
                            className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0"
                          >
                            Pilih
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-slate-400 text-xs">
                        Tidak ada siswa yang cocok dengan "{manualSearch}".
                      </div>
                    )}
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
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Contoh: Mengikuti lomba dinas, dispensasi OSIS, surat dokter..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 shrink-0">
                <span className="text-[11px] text-slate-400">
                  {selectedStudent ? 'Siswa terpilih siap disimpan' : 'Pilih siswa terlebih dahulu'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowManualModal(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={!selectedStudent}
                    className="px-4 py-1.5 rounded-lg font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Simpan Presensi</span>
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
                  onClick={() => {
                    if (!editReason.trim()) {
                      showToast('Alasan pembatalan wajib diisi.', 'error');
                      return;
                    }
                    deleteAttendance(editingRecord.id, editReason);
                    setEditingRecord(null);
                  }}
                  className="px-3 py-1.5 rounded text-rose-600 border border-rose-200 hover:bg-rose-50"
                >
                  Hapus Data
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingRecord(null)}
                    className="px-3 py-1.5 text-slate-600"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!editReason.trim()) {
                        showToast('Alasan koreksi wajib diisi.', 'error');
                        return;
                      }
                      updateAttendance(editingRecord.id, { status: editStatus }, editReason);
                      setEditingRecord(null);
                    }}
                    className="px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800"
                  >
                    Simpan
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
