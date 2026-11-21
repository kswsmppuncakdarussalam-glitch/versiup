import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  Calendar,
  UserCheck,
  RefreshCw,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { AttendanceRecord, AttendanceSession, Student } from '../../types/index.js';
import { checkSessionAttendanceOpen, parseTimeToMinutes } from '../../utils/sessionHelper.js';
import { formatIndonesianDate } from '../../utils/time.js';

interface SessionSlot {
  slotTitle: string;
  defaultTimeLabel: string;
  session: AttendanceSession | null;
}

function getMinutesFromIso(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

function resolveFirstAndSecondSessions(sessions: AttendanceSession[]): [SessionSlot, SessionSlot, AttendanceSession[]] {
  const pool = (sessions || []).filter((s) => s.is_active !== false);
  const sorted = (pool.length > 0 ? pool : [...(sessions || [])]).sort(
    (a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time)
  );

  // Cari Sesi Pertama (target ~07:30)
  const target1Min = 7 * 60 + 30;
  let sess1: AttendanceSession | null =
    sorted.find((s) => /sesi\s*1|pertama|pagi|07[:.]30/i.test(`${s.id} ${s.name} ${s.start_time} ${s.on_time_limit}`)) ||
    null;
  if (!sess1 && sorted.length > 0) {
    const morningCandidates = sorted.filter((s) => parseTimeToMinutes(s.start_time) <= 8 * 60 + 45);
    if (morningCandidates.length > 0) {
      sess1 = morningCandidates
        .slice()
        .sort(
          (a, b) =>
            Math.abs(parseTimeToMinutes(a.on_time_limit || a.start_time) - target1Min) -
            Math.abs(parseTimeToMinutes(b.on_time_limit || b.start_time) - target1Min)
        )[0];
    } else {
      sess1 = sorted[0];
    }
  }

  // Cari Sesi Kedua (target ~09:30)
  const target2Min = 9 * 60 + 30;
  const remainingFor2 = sorted.filter((s) => s.id !== sess1?.id);
  let sess2: AttendanceSession | null =
    remainingFor2.find((s) => /sesi\s*2|kedua|dhuha|09[:.]30/i.test(`${s.id} ${s.name} ${s.start_time} ${s.on_time_limit}`)) ||
    null;
  if (!sess2 && remainingFor2.length > 0) {
    const midMorning = remainingFor2.filter((s) => {
      const m = parseTimeToMinutes(s.start_time);
      return m >= 8 * 60 + 15 && m <= 11 * 60 + 30;
    });
    if (midMorning.length > 0) {
      sess2 = midMorning
        .slice()
        .sort(
          (a, b) =>
            Math.abs(parseTimeToMinutes(a.on_time_limit || a.start_time) - target2Min) -
            Math.abs(parseTimeToMinutes(b.on_time_limit || b.start_time) - target2Min)
        )[0];
    } else {
      sess2 = remainingFor2[0];
    }
  }

  const usedIds = new Set<string>();
  if (sess1) usedIds.add(sess1.id);
  if (sess2) usedIds.add(sess2.id);
  const extraSessions = sorted.filter((s) => !usedIds.has(s.id));

  return [
    {
      slotTitle: 'Sesi Pertama (07.30)',
      defaultTimeLabel: '07:30 WIB',
      session: sess1,
    },
    {
      slotTitle: 'Sesi Kedua (09.30)',
      defaultTimeLabel: '09:30 WIB',
      session: sess2,
    },
    extraSessions,
  ];
}

function getStatusBadgeStyle(status: string): string {
  switch (status) {
    case 'Hadir':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800';
    case 'Terlambat':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
    case 'Izin':
      return 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800';
    case 'Sakit':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-800';
    case 'Alpha':
      return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}

export const ParentAttendanceCheckPanel: React.FC = () => {
  const {
    students,
    classes,
    sessions,
    attendance,
    currentServerTime,
    refreshFromSheets,
    configError,
  } = useApp();

  const todayStr = currentServerTime.toISOString().split('T')[0];

  const [nameInput, setNameInput] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [submittedQuery, setSubmittedQuery] = useState<string>('');
  const [selectedStudentNis, setSelectedStudentNis] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [validationError, setValidationError] = useState('');
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, []);

  const [slot1, slot2, extraSessions] = useMemo(
    () => resolveFirstAndSecondSessions(sessions),
    [sessions]
  );

  const classMap = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name || c.id])),
    [classes]
  );

  const liveSuggestions = useMemo<Student[]>(() => {
    const q = nameInput.trim().replace(/\s+/g, ' ').toLowerCase();
    if (q.length < 1) return [];
    const tokens = q.split(' ').filter(Boolean);

    const matches = students.filter((s) => {
      const studentName = String(s.name || '').toLowerCase();
      if (studentName.includes(q)) return true;
      return tokens.length > 1 && tokens.every((tok) => studentName.includes(tok));
    });

    return matches
      .slice()
      .sort((a, b) => {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        const aScore = an === q ? 0 : an.startsWith(q) ? 1 : 2;
        const bScore = bn === q ? 0 : bn.startsWith(q) ? 1 : 2;
        if (aScore !== bScore) return aScore - bScore;
        return an.localeCompare(bn, 'id');
      })
      .slice(0, 8);
  }, [students, nameInput]);

  const handleSelectSuggestion = (student: Student) => {
    setNameInput(student.name);
    setSelectedStudentNis(student.nis);
    setSubmittedQuery(student.name);
    setShowSuggestions(false);
    setValidationError('');
    void refreshFromSheets(true);
  };

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nameInput.trim().replace(/\s+/g, ' ');
    if (cleaned.length < 2) {
      setValidationError('Masukkan minimal 2 huruf nama siswa.');
      return;
    }
    setValidationError('');
    setShowSuggestions(false);
    setSubmittedQuery(cleaned);

    if (students.length === 0) {
      setIsChecking(true);
      try {
        await refreshFromSheets(true);
      } finally {
        setIsChecking(false);
      }
    } else {
      void refreshFromSheets(true);
    }
  };

  const matchedStudents = useMemo<Student[]>(() => {
    if (!submittedQuery) return [];
    if (selectedStudentNis) {
      const exact = students.find((s) => s.nis === selectedStudentNis);
      if (exact) return [exact];
    }
    const q = submittedQuery.toLowerCase();
    const tokens = q.split(' ').filter(Boolean);

    const matches = students.filter((s) => {
      const studentName = String(s.name || '').toLowerCase();
      if (studentName.includes(q)) return true;
      return tokens.length > 1 && tokens.every((tok) => studentName.includes(tok));
    });

    return matches
      .slice()
      .sort((a, b) => {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        const aExact = an === q ? 0 : an.startsWith(q) ? 1 : 2;
        const bExact = bn === q ? 0 : bn.startsWith(q) ? 1 : 2;
        if (aExact !== bExact) return aExact - bExact;
        return an.localeCompare(bn, 'id');
      });
  }, [students, submittedQuery, selectedStudentNis]);

  const displayedStudents = matchedStudents.slice(0, 6);
  const isToday = selectedDate === todayStr;

  const findRecordForSlot = (
    studentRecords: AttendanceRecord[],
    slot: SessionSlot,
    slotIndex: 1 | 2
  ): AttendanceRecord | undefined => {
    if (slot.session) {
      const exact = studentRecords.find((r) => r.session_id === slot.session!.id);
      if (exact) return exact;
    }
    // Fallback berbasis waktu scan jika session_id lama/berbeda
    return studentRecords.find((r) => {
      if (slot1.session && r.session_id === slot1.session.id && slotIndex !== 1) return false;
      if (slot2.session && r.session_id === slot2.session.id && slotIndex !== 2) return false;
      const m = getMinutesFromIso(r.timestamp);
      if (m === null) return false;
      return slotIndex === 1 ? m < 8 * 60 + 45 : m >= 8 * 60 + 45 && m <= 12 * 60;
    });
  };

  const renderSlotCard = (
    studentRecords: AttendanceRecord[],
    slot: SessionSlot,
    slotIndex: 1 | 2
  ) => {
    const rec = findRecordForSlot(studentRecords, slot, slotIndex);
    const windowCheck = slot.session && isToday
      ? checkSessionAttendanceOpen(slot.session, currentServerTime)
      : null;

    const scheduleLabel = slot.session
      ? `${slot.session.start_time} - ${slot.session.end_time} WIB`
      : slot.defaultTimeLabel;

    let statusText = 'Belum Presensi';
    if (rec) {
      statusText = rec.status;
    } else if (isToday && windowCheck) {
      if (windowCheck.reason === 'upcoming') statusText = 'Belum Dimulai';
      else if (windowCheck.reason === 'closed') statusText = 'Belum Tercatat';
    }

    const scanTime = rec?.timestamp
      ? new Date(rec.timestamp).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    return (
      <div
        key={slot.slotTitle}
        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 p-3 flex flex-col justify-between gap-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-slate-900 dark:text-white">
              {slot.slotTitle}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
              <Clock className="w-3 h-3 shrink-0" />
              <span>
                {slot.session ? `${slot.session.name} (${scheduleLabel})` : `Jadwal ${scheduleLabel}`}
              </span>
            </p>
          </div>
          <span
            className={`px-2 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${
              rec
                ? getStatusBadgeStyle(rec.status)
                : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
            }`}
          >
            {statusText}
          </span>
        </div>

        <div className="text-[11px] text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-200/70 dark:border-slate-700/70 flex flex-wrap items-center justify-between gap-1">
          {rec ? (
            <>
              <span>
                Waktu: <strong className="font-mono text-slate-900 dark:text-white">{scanTime || '-'}</strong>
                {rec.status === 'Terlambat' && rec.late_minutes > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    {' '}(+{rec.late_minutes} mnt)
                  </span>
                )}
              </span>
              <span className="text-slate-400 dark:text-slate-400">
                {rec.method === 'manual' ? 'Input Petugas' : 'Scan Kartu'}
              </span>
            </>
          ) : (
            <span className="text-slate-400 dark:text-slate-400">
              {isToday && windowCheck?.reason === 'upcoming'
                ? `Sesi dibuka pukul ${slot.session?.start_time || '-'}`
                : 'Belum ada catatan presensi pada sesi ini.'}
            </span>
          )}
        </div>
        {rec?.notes && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
            Catatan: {rec.notes}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
        <UserCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
        <div>
          <p className="font-semibold">Cek Presensi Siswa untuk Wali Murid (Tanpa Password)</p>
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">
            Masukkan nama siswa lalu klik <strong>Cek Presensi</strong> untuk melihat kehadiran Sesi Pertama (07.30) dan Sesi Kedua (09.30).
          </p>
        </div>
      </div>

      {validationError && (
        <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      <form onSubmit={handleCheck} className="space-y-3">
        <div ref={searchBoxRef} className="relative">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Nama Lengkap / Panggilan Siswa
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={nameInput}
              onFocus={() => {
                if (nameInput.trim().length >= 1) setShowSuggestions(true);
              }}
              onChange={(e) => {
                const val = e.target.value;
                setNameInput(val);
                setSelectedStudentNis(null);
                setShowSuggestions(val.trim().length >= 1);
                if (validationError) setValidationError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowSuggestions(false);
                }
              }}
              placeholder="Ketik nama siswa, lalu pilih saran atau klik Cek Presensi..."
              autoComplete="off"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600"
            />
            {nameInput && (
              <button
                type="button"
                onClick={() => {
                  setNameInput('');
                  setSelectedStudentNis(null);
                  setSubmittedQuery('');
                  setShowSuggestions(false);
                  setValidationError('');
                }}
                className="absolute inset-y-0 right-0 px-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Hapus nama"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {showSuggestions && nameInput.trim().length >= 1 && (
            <div className="absolute left-0 right-0 mt-1 z-30 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {liveSuggestions.length > 0 ? (
                liveSuggestions.map((s) => {
                  const classLabel = classMap.get(s.class_id) || s.class_id;
                  return (
                    <button
                      key={s.nis}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSuggestion(s);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {s.name}
                      </span>
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                        {classLabel}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                  {students.length === 0
                    ? 'Memuat daftar nama siswa...'
                    : `Tidak ada saran nama yang cocok dengan "${nameInput.trim()}"`}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>Tanggal Presensi</span>
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || todayStr)}
              className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <button
            type="submit"
            disabled={isChecking}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-xs inline-flex items-center justify-center gap-1.5"
          >
            {isChecking ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Memeriksa...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>Cek Presensi</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Hasil Cek Presensi */}
      {submittedQuery && (
        <div className="pt-2 space-y-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              Hasil untuk <strong className="text-slate-800 dark:text-slate-200">"{submittedQuery}"</strong>
              {' '}•{' '}
              {isToday
                ? `Hari Ini (${formatIndonesianDate(currentServerTime)})`
                : selectedDate}
            </span>
            <button
              type="button"
              onClick={() => void refreshFromSheets(true)}
              className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-semibold"
              title="Muat ulang data presensi terbaru"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Perbarui</span>
            </button>
          </div>

          {matchedStudents.length === 0 ? (
            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-center space-y-1">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Data siswa dengan nama "{submittedQuery}" tidak ditemukan.
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {configError
                  ? 'Perangkat ini belum terhubung ke server sekolah. Buka melalui link resmi aplikasi atau hubungi Admin.'
                  : students.length === 0
                  ? 'Data siswa sedang disinkronkan. Pastikan koneksi internet aktif lalu klik Perbarui.'
                  : 'Periksa kembali ejaan nama siswa dan coba lagi.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-0.5">
              {displayedStudents.map((student) => {
                const studentDayRecords = attendance.filter(
                  (a) => a.student_id === student.nis && a.date === selectedDate
                );
                const classLabel = classMap.get(student.class_id) || student.class_id;

                const shownExtraRecords = extraSessions
                  .map((sess) => ({
                    sess,
                    rec: studentDayRecords.find((r) => r.session_id === sess.id),
                  }))
                  .filter((item) => Boolean(item.rec));

                return (
                  <div
                    key={student.nis}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 shadow-xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>{student.name}</span>
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Kelas: <strong className="text-slate-700 dark:text-slate-200">{classLabel}</strong> • NIS: <span className="font-mono">{student.nis}</span>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {renderSlotCard(studentDayRecords, slot1, 1)}
                      {renderSlotCard(studentDayRecords, slot2, 2)}
                    </div>

                    {shownExtraRecords.length > 0 && (
                      <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 space-y-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Sesi Lainnya
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {shownExtraRecords.map(({ sess, rec }) => (
                            <span
                              key={sess.id}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-semibold ${getStatusBadgeStyle(rec!.status)}`}
                            >
                              <span>{sess.name}:</span>
                              <span>{rec!.status}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {matchedStudents.length > displayedStudents.length && (
                <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">
                  Menampilkan {displayedStudents.length} dari {matchedStudents.length} siswa yang cocok. Ketik nama lebih lengkap untuk hasil lebih spesifik.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
