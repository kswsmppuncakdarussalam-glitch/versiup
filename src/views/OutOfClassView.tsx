import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  DoorOpen,
  Search,
  AlertTriangle,
  Clock,
  Check,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import {
  calculateRemainingSeconds,
  calculateOverdueSeconds,
  formatDuration,
} from '../utils/time.js';
import { soundEffects } from '../utils/audio.js';
import { DriveImage } from '../components/common/DriveImage.js';
import { Student, OutOfClassType } from '../types/index.js';

function toLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeClassKey(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

export const OutOfClassView: React.FC = () => {
  const {
    students,
    classes,
    outOfClass,
    settings,
    startOutOfClass,
    confirmOutOfClassReturn,
    currentServerTime,
    speak,
    showToast,
  } = useApp();

  // Search and form state (NO RFID/Barcode Scan here as required in Bagian 5)
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [permissionType, setPermissionType] = useState<OutOfClassType>('BAK');
  const [customDuration, setCustomDuration] = useState<number>(settings.out_of_class_bak_duration || 5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [returningIds, setReturningIds] = useState<Record<string, boolean>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const defaultMaxPerClass = Math.max(1, Number(settings.out_of_class_max_per_class || 2));

  // Local YYYY-MM-DD based on synchronized server time (avoids UTC 07:00 WIB split)
  const todayLocalStr = toLocalYmd(currentServerTime);

  const todayRecords = useMemo(() => {
    return outOfClass
      .filter((o) => {
        if (!o.started_at) return false;
        const parsed = new Date(o.started_at);
        if (!Number.isNaN(parsed.getTime())) {
          return toLocalYmd(parsed) === todayLocalStr;
        }
        return String(o.started_at).startsWith(todayLocalStr);
      })
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }, [outOfClass, todayLocalStr]);

  // Active / Overdue records (always matches backend class quota filter exactly)
  const activeRecords = useMemo(() => {
    return outOfClass
      .filter((o) => o.status === 'active' || o.status === 'overdue')
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }, [outOfClass]);

  // Sound alarm trigger tracker to prevent multiple alarms for the same overdue record
  const alarmedRecordsRef = useRef<Set<string>>(new Set());

  // Alarm & status check for overdue students every second
  useEffect(() => {
    activeRecords.forEach((rec) => {
      const remaining = calculateRemainingSeconds(rec.due_at);
      if (remaining === 0) {
        if (!alarmedRecordsRef.current.has(rec.id)) {
          alarmedRecordsRef.current.add(rec.id);
          soundEffects.playAlarmSound();
          const student = students.find((s) => s.nis === rec.student_id);
          const studentName = student?.name || 'Siswa';
          speak(`Perhatian! ${studentName} dari kelas ${rec.class_id} telah melebihi batas waktu izin keluar kelas.`);
        }
      }
    });
  }, [currentServerTime, activeRecords, students, speak]);

  // Quota calculation per class (resets directly to 0 when all active students return)
  const classQuotaStats = useMemo(() => {
    return classes.map((cls) => {
      const clsMax = Math.max(1, Number(cls.quota_limit || defaultMaxPerClass));
      const clsIdNorm = normalizeClassKey(cls.id);
      const clsNameNorm = normalizeClassKey(cls.name);
      const activeStudentsInClass = activeRecords.filter((r) => {
        const recClassNorm = normalizeClassKey(r.class_id);
        return recClassNorm === clsIdNorm || recClassNorm === clsNameNorm;
      });
      const activeCount = activeStudentsInClass.length;
      return {
        class: cls,
        maxPerClass: clsMax,
        activeStudents: activeStudentsInClass,
        activeCount,
        isFull: activeCount >= clsMax,
      };
    });
  }, [classes, activeRecords, defaultMaxPerClass]);

  const selectedStudentClassQuota = useMemo(() => {
    if (!selectedStudent) return null;
    const stuClassNorm = normalizeClassKey(selectedStudent.class_id);
    return (
      classQuotaStats.find(
        (stat) =>
          normalizeClassKey(stat.class.id) === stuClassNorm ||
          normalizeClassKey(stat.class.name) === stuClassNorm
      ) || null
    );
  }, [selectedStudent, classQuotaStats]);

  const isSelectedStudentActive = useMemo(() => {
    if (!selectedStudent) return false;
    return activeRecords.some((r) => r.student_id === selectedStudent.nis);
  }, [selectedStudent, activeRecords]);

  // Autocomplete search suggestions (Fuzzy name search)
  const filteredStudents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.nis.toLowerCase().includes(q) ||
          s.class_id.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [searchTerm, students]);

  // Update default duration when permission type changes
  const handleTypeChange = (type: OutOfClassType) => {
    setPermissionType(type);
    if (type === 'BAK') {
      setCustomDuration(settings.out_of_class_bak_duration || 5);
    } else if (type === 'BAB') {
      setCustomDuration(settings.out_of_class_bab_duration || 10);
    } else {
      setCustomDuration(settings.out_of_class_other_duration || 2);
    }
  };

  // Submit start out of class
  const handleStartPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const res = await startOutOfClass(selectedStudent.nis, permissionType, customDuration);
    setIsSubmitting(false);

    if (res.success && res.record) {
      const msg = `${selectedStudent.name}, izin ${permissionType} selama ${customDuration} menit dimulai.`;
      speak(msg);
      showToast('Tersimpan', 'success');

      // Clear search and selection ready for next student
      setSelectedStudent(null);
      setSearchTerm('');
    } else {
      setErrorMessage(res.error || 'Gagal memulai izin keluar.');
      speak(res.error || 'Izin keluar kelas tidak dapat diberikan.');
    }
  };

  // Confirm return by clicking big checkmark icon
  const handleConfirmReturn = async (recordId: string) => {
    if (returningIds[recordId] || recordId.startsWith('opt_')) return;

    setReturningIds((prev) => ({ ...prev, [recordId]: true }));
    setErrorMessage(null);

    const res = await confirmOutOfClassReturn(recordId, 'click');

    setReturningIds((prev) => {
      const next = { ...prev };
      delete next[recordId];
      return next;
    });

    if (res.success && res.record) {
      showToast('Tersimpan', 'success');
    } else if (res.error) {
      setErrorMessage(res.error);
    }
  };

  // Top statistics for summary
  const mostFrequentLeavers = useMemo(() => {
    const counts: Record<string, number> = {};
    todayRecords.forEach((r) => {
      counts[r.student_id] = (counts[r.student_id] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([nis, count]) => ({
        student: students.find((s) => s.nis === nis),
        count,
      }))
      .filter((x) => x.student)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [todayRecords, students]);

  const mostLateReturners = useMemo(() => {
    const lateMap: Record<string, { count: number; totalMinutes: number }> = {};
    todayRecords.forEach((r) => {
      if (r.late_return_minutes > 0) {
        if (!lateMap[r.student_id]) lateMap[r.student_id] = { count: 0, totalMinutes: 0 };
        lateMap[r.student_id].count += 1;
        lateMap[r.student_id].totalMinutes += r.late_return_minutes;
      }
    });
    return Object.entries(lateMap)
      .map(([nis, data]) => ({
        student: students.find((s) => s.nis === nis),
        ...data,
      }))
      .filter((x) => x.student)
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .slice(0, 5);
  }, [todayRecords, students]);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Top Banner & Quota indicators */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <DoorOpen className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              Izin Keluar Kelas Berkuota
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Input manual pencarian nama. Maks. {defaultMaxPerClass} siswa per kelas keluar bersamaan (kembali ke 0 saat semua kembali) & maks. {settings.out_of_class_max_per_student_daily || 3}x izin/hari.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold px-3 py-1.5 rounded border ${
                activeRecords.length > 0
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              Sedang Izin Keluar:{' '}
              <span className="font-bold text-slate-900 dark:text-white">{activeRecords.length} Siswa</span>
            </span>
          </div>
        </div>

        {/* Quota per class indicators */}
        <div className="pt-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Kuota Izin Aktif per Kelas (Reset otomatis ke 0/{defaultMaxPerClass} saat siswa kembali):
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {classQuotaStats.map(({ class: cls, maxPerClass, activeStudents, activeCount, isFull }) => (
              <div
                key={cls.id}
                className={`p-2.5 rounded border text-xs flex flex-col justify-between gap-1.5 ${
                  isFull
                    ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                    : activeCount > 0
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold block truncate">{cls.name}</span>
                    <span className="text-[10px] text-slate-400 block truncate">{cls.major}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-bold font-mono text-sm">
                      {activeCount}/{maxPerClass}
                    </span>
                    <span className="block text-[10px] font-medium">
                      {isFull ? 'Penuh' : activeCount === 0 ? `Kosong (${maxPerClass})` : `Sisa ${maxPerClass - activeCount}`}
                    </span>
                  </div>
                </div>

                {activeStudents.length > 0 && (
                  <div className="pt-1.5 border-t border-black/10 dark:border-white/10 space-y-1">
                    {activeStudents.map((rec) => {
                      const stu = students.find((s) => s.nis === rec.student_id);
                      const remSec = calculateRemainingSeconds(rec.due_at);
                      const over = remSec === 0;
                      return (
                        <div key={rec.id} className="flex items-center justify-between gap-1 text-[10px]">
                          <span className="truncate font-medium">• {stu?.name || rec.student_id}</span>
                          <span className={`font-mono shrink-0 ${over ? 'text-rose-600 dark:text-rose-400 font-bold' : 'opacity-80'}`}>
                            {over ? `+${formatDuration(calculateOverdueSeconds(rec.due_at))}` : formatDuration(remSec)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Workspace: Active Out-of-Class Students immediately visible alongside Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* PANEL SISWA SEDANG IZIN KELUAR (Visible immediately at top on mobile & right column on desktop) */}
        <div className="lg:col-span-7 order-1 lg:order-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Siswa Sedang Izin Keluar ({activeRecords.length} Siswa)
              </h2>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Klik tombol centang (✓) saat siswa kembali agar kuota kelas kembali ke 0
            </span>
          </div>

          {activeRecords.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-xs">
              Saat ini tidak ada siswa yang sedang berada di luar kelas. Semua kuota kelas berada di 0.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-4">
              {activeRecords.map((rec) => {
                const student = students.find((s) => s.nis === rec.student_id);
                const remainingSec = calculateRemainingSeconds(rec.due_at);
                const isOverdue = remainingSec === 0;
                const overdueSec = isOverdue ? calculateOverdueSeconds(rec.due_at) : 0;
                const isPendingSync = rec.id.startsWith('opt_');
                const isReturning = Boolean(returningIds[rec.id]);

                return (
                  <div
                    key={rec.id}
                    className={`p-4 rounded-lg border-2 transition-all flex flex-col justify-between ${
                      isOverdue
                        ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-500'
                        : 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center font-bold text-slate-800 dark:text-slate-200 text-xs overflow-hidden shrink-0">
                          {student?.photo_url ? (
                            <DriveImage srcValue={student.photo_url} alt={student.name} className="w-full h-full object-cover" />
                          ) : (
                            student?.name.slice(0, 2).toUpperCase() || '!'
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 dark:text-white text-xs truncate">
                            {student?.name || rec.student_id}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Kelas {rec.class_id} • {rec.type} ({rec.duration_minutes}m)
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                            Keluar: {new Date(rec.started_at).toLocaleTimeString('id-ID')}
                          </p>
                        </div>
                      </div>

                      {/* CHECKMARK BUTTON TO CONFIRM RETURN */}
                      <button
                        type="button"
                        onClick={() => handleConfirmReturn(rec.id)}
                        disabled={isPendingSync || isReturning}
                        title={
                          isPendingSync
                            ? 'Menyinkronkan data izin...'
                            : 'Konfirmasi Siswa Kembali ke Kelas'
                        }
                        className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow hover:scale-[1.02] active:scale-95 transition-all shrink-0 flex items-center gap-1 text-xs font-semibold"
                      >
                        <Check className="w-4 h-4 stroke-[2.5]" />
                        <span>{isReturning ? 'Proses...' : isPendingSync ? 'Sinkron...' : 'Kembali'}</span>
                      </button>
                    </div>

                    {/* Countdown Timer or Overdue Live Counter */}
                    <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-xs">
                      <div>
                        {isOverdue ? (
                          <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400 font-semibold">
                            <AlertTriangle className="w-4 h-4" />
                            <span>Melebihi Waktu</span>
                          </div>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">Sisa Waktu:</span>
                        )}
                      </div>

                      <div className="font-mono text-base font-bold">
                        {isOverdue ? (
                          <span className="text-rose-600 dark:text-rose-400">
                            +{formatDuration(overdueSec)}
                          </span>
                        ) : (
                          <span className="text-slate-900 dark:text-white">
                            {formatDuration(remainingSec)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Input Form Section */}
        <div className="lg:col-span-5 order-2 lg:order-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
            Mulai Izin Keluar Siswa
          </h2>

          {errorMessage && (
            <div className="mb-4 p-3 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{errorMessage}</p>
            </div>
          )}

          <form onSubmit={handleStartPermission} className="space-y-4">
            {/* Autocomplete Search input */}
            <div className="relative">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Cari Nama Siswa (Ketik sebagian nama atau NIS)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setSelectedStudent(null);
                    setErrorMessage(null);
                  }}
                  placeholder="Ketik nama siswa..."
                  className="w-full px-3.5 py-2.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              </div>

              {/* Suggestions list */}
              {filteredStudents.length > 0 && !selectedStudent && (
                <div className="absolute z-20 left-0 right-0 mt-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700 text-xs">
                  {filteredStudents.map((s) => {
                    const isAlreadyOut = activeRecords.some((r) => r.student_id === s.nis);
                    const sClassStat = classQuotaStats.find(
                      (st) =>
                        normalizeClassKey(st.class.id) === normalizeClassKey(s.class_id) ||
                        normalizeClassKey(st.class.name) === normalizeClassKey(s.class_id)
                    );
                    return (
                      <div
                        key={s.nis}
                        onClick={() => {
                          setSelectedStudent(s);
                          setSearchTerm(`${s.name} (${s.class_id})`);
                          setErrorMessage(null);
                        }}
                        className="p-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                            {s.name.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-900 dark:text-white truncate">{s.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isAlreadyOut && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-semibold">
                              Sedang Keluar
                            </span>
                          )}
                          {!isAlreadyOut && sClassStat?.isFull && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-semibold">
                              Kuota {sClassStat.activeCount}/{sClassStat.maxPerClass}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-400 font-mono">Kelas {s.class_id}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected student badge & live quota status */}
            {selectedStudent && (
              <div className="space-y-2">
                <div className="p-3 rounded bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 flex items-center justify-center font-bold text-xs shrink-0">
                      {selectedStudent.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 dark:text-white truncate">{selectedStudent.name}</p>
                      <p className="text-[10px] text-slate-500 truncate">
                        Kelas {selectedStudent.class_id} • NIS: {selectedStudent.nis}
                        {selectedStudentClassQuota
                          ? ` • Kuota Kelas: ${selectedStudentClassQuota.activeCount}/${selectedStudentClassQuota.maxPerClass}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStudent(null);
                      setSearchTerm('');
                      setErrorMessage(null);
                    }}
                    className="text-slate-400 hover:text-slate-600 text-xs shrink-0"
                  >
                    Ganti Siswa
                  </button>
                </div>

                {isSelectedStudentActive && (
                  <div className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300">
                    Siswa ini sedang tercatat izin keluar kelas. Klik tombol <strong>Kembali (✓)</strong> pada daftar siswa di samping jika sudah masuk kelas.
                  </div>
                )}

                {!isSelectedStudentActive && selectedStudentClassQuota?.isFull && (
                  <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
                    Kuota kelas {selectedStudent.class_id} sedang penuh ({selectedStudentClassQuota.activeCount}/{selectedStudentClassQuota.maxPerClass}). Konfirmasi <strong>Kembali (✓)</strong> pada siswa kelas ini agar kuota kembali tersedia.
                  </div>
                )}
              </div>
            )}

            {/* Permission Type Selection Buttons */}
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Pilih Jenis Izin & Durasi
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleTypeChange('BAK')}
                  className={`p-3 rounded border text-xs text-left transition-colors ${
                    permissionType === 'BAK'
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                      : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="font-bold block">1. BAK</span>
                  <span className="text-[11px] opacity-80">{settings.out_of_class_bak_duration || 5} Menit</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleTypeChange('BAB')}
                  className={`p-3 rounded border text-xs text-left transition-colors ${
                    permissionType === 'BAB'
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                      : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="font-bold block">2. BAB</span>
                  <span className="text-[11px] opacity-80">{settings.out_of_class_bab_duration || 10} Menit</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleTypeChange('Keperluan Lain')}
                  className={`p-3 rounded border text-xs text-left transition-colors ${
                    permissionType === 'Keperluan Lain'
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                      : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="font-bold block">3. Lainnya</span>
                  <span className="text-[11px] opacity-80">{settings.out_of_class_other_duration || 2} Menit</span>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={!selectedStudent || isSubmitting}
              className="w-full px-6 py-2.5 rounded font-semibold text-xs text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Memeriksa Kuota...' : 'Mulai Izin Keluar'}
            </button>
          </form>
        </div>
      </div>

      {/* History and Summary Statistics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Returned History (2 cols) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
            Riwayat Izin Keluar Hari Ini ({todayRecords.length} kali)
          </h2>

          {todayRecords.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">Belum ada riwayat izin hari ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                    <th className="py-2">Nama Siswa</th>
                    <th className="py-2">Kelas</th>
                    <th className="py-2">Jenis</th>
                    <th className="py-2">Keluar - Kembali</th>
                    <th className="py-2">Keterlambatan</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {todayRecords.map((rec) => {
                    const student = students.find((s) => s.nis === rec.student_id);
                    return (
                      <tr key={rec.id}>
                        <td className="py-2.5 font-medium text-slate-900 dark:text-white">
                          {student?.name || rec.student_id}
                        </td>
                        <td className="py-2.5 text-slate-500">{rec.class_id}</td>
                        <td className="py-2.5">{rec.type}</td>
                        <td className="py-2.5 font-mono text-[11px] text-slate-500">
                          {new Date(rec.started_at).toLocaleTimeString('id-ID')}
                          {' - '}
                          {rec.returned_at ? new Date(rec.returned_at).toLocaleTimeString('id-ID') : 'Belum'}
                        </td>
                        <td className="py-2.5">
                          {rec.late_return_minutes > 0 ? (
                            <span className="font-semibold text-rose-600">
                              +{rec.late_return_minutes} menit
                            </span>
                          ) : rec.returned_at ? (
                            <span className="text-emerald-600 font-medium">Tepat Waktu</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              rec.status === 'returned'
                                ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                : rec.status === 'auto_closed'
                                ? 'bg-zinc-100 text-zinc-600'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400'
                            }`}
                          >
                            {rec.status === 'returned' ? 'Kembali' : rec.status === 'auto_closed' ? 'Auto Closed' : 'Di Luar'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Out-of-Class Statistics (1 col) */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm text-xs">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-slate-500" /> Siswa Paling Sering Keluar
            </h3>
            {mostFrequentLeavers.length === 0 ? (
              <p className="text-slate-400 py-2">Belum ada data.</p>
            ) : (
              <div className="space-y-2 mt-2">
                {mostFrequentLeavers.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{item.student?.name}</span>
                      <span className="text-[10px] text-slate-400 block">{item.student?.class_id}</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">{item.count}x izin</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm text-xs">
            <h3 className="font-semibold text-rose-700 dark:text-rose-400 mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Siswa Paling Sering Terlambat Kembali
            </h3>
            {mostLateReturners.length === 0 ? (
              <p className="text-slate-400 py-2">Tidak ada siswa terlambat kembali.</p>
            ) : (
              <div className="space-y-2 mt-2">
                {mostLateReturners.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{item.student?.name}</span>
                      <span className="text-[10px] text-slate-400 block">{item.student?.class_id} • {item.count}x telat</span>
                    </div>
                    <span className="font-bold text-rose-600">+{item.totalMinutes} menit</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
