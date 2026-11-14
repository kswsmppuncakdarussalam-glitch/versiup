import {
  AttendanceSession,
  AttendanceRecord,
  SchoolClass,
  Student,
} from './types.ts';

export type SessionTimelineStatus = 'active' | 'upcoming' | 'completed';

export interface SessionTimelineItem {
  session: AttendanceSession;
  status: SessionTimelineStatus;
  startMinutes: number;
  endMinutes: number;
  onTimeMinutes: number;
  minutesUntilStart: number;
  minutesRemaining: number;
}

export interface SessionScheduleState {
  activeSession: AttendanceSession | null;
  liveWindowSession: AttendanceSession | null;
  nextSession: AttendanceSession | null;
  status: 'active' | 'upcoming' | 'outside' | 'override';
  isWithinScheduledWindow: boolean;
  isAutoSwitchEnabled: boolean;
  manualSessionId: string | null;
  minutesRemaining: number;
  minutesUntilNext: number;
  todayTimeline: SessionTimelineItem[];
}

export function parseTimeToMinutes(hhmm: string): number {
  const parts = String(hhmm || '00:00').split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

export function isTimeInWindow(currentMin: number, startMin: number, endMin: number): boolean {
  if (endMin >= startMin) {
    return currentMin >= startMin && currentMin <= endMin;
  }
  // Overnight wrap (e.g. 22:00 - 05:00)
  return currentMin >= startMin || currentMin <= endMin;
}

export function resolveSessionSchedule(
  sessions: AttendanceSession[],
  now: Date,
  autoSwitchEnabled = true,
  manualOverrideSessionId?: string | null
): SessionScheduleState {
  const activeSessionsAll = (sessions || [])
    .filter((s) => s.is_active)
    .sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time));

  const fallbackAll = (sessions || []).slice().sort(
    (a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time)
  );

  const currentDay = now.getDay();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  const validToday = activeSessionsAll.filter((s) =>
    Array.isArray(s.active_days) && s.active_days.length > 0
      ? s.active_days.includes(currentDay)
      : true
  );

  // Build timeline for today's active sessions
  const liveMatches: AttendanceSession[] = [];
  const todayTimeline: SessionTimelineItem[] = validToday.map((s) => {
    const startMin = parseTimeToMinutes(s.start_time);
    const endMin = parseTimeToMinutes(s.end_time);
    const onTimeMin = parseTimeToMinutes(s.on_time_limit);
    const inWindow = isTimeInWindow(currentMin, startMin, endMin);

    let itemStatus: SessionTimelineStatus = 'upcoming';
    if (inWindow) {
      itemStatus = 'active';
      liveMatches.push(s);
    } else if (endMin >= startMin && currentMin > endMin) {
      itemStatus = 'completed';
    } else if (endMin < startMin && currentMin > endMin && currentMin < startMin) {
      itemStatus = 'completed';
    }

    let minutesRemaining = 0;
    if (inWindow) {
      minutesRemaining = endMin >= startMin
        ? Math.max(0, endMin - currentMin)
        : Math.max(0, (1440 - currentMin) + endMin);
    }

    const minutesUntilStart = itemStatus === 'upcoming'
      ? Math.max(0, startMin - currentMin)
      : 0;

    return {
      session: s,
      status: itemStatus,
      startMinutes: startMin,
      endMinutes: endMin,
      onTimeMinutes: onTimeMin,
      minutesUntilStart,
      minutesRemaining,
    };
  });

  // If multiple windows overlap (e.g. boundary 08:00 where A ends at 08:00 and B starts at 08:00),
  // prefer the session with the latest start_time.
  const liveWindowSession =
    liveMatches.length > 0
      ? liveMatches.slice().sort((a, b) => parseTimeToMinutes(b.start_time) - parseTimeToMinutes(a.start_time))[0]
      : null;

  const upcomingItems = todayTimeline.filter((item) => item.status === 'upcoming');
  const nextSession = upcomingItems.length > 0 ? upcomingItems[0].session : (validToday[0] || activeSessionsAll[0] || null);
  const minutesUntilNext = upcomingItems.length > 0 ? upcomingItems[0].minutesUntilStart : 0;

  // Handle manual override when specified
  if (manualOverrideSessionId) {
    const overridden = sessions.find((s) => s.id === manualOverrideSessionId);
    if (overridden) {
      const startMin = parseTimeToMinutes(overridden.start_time);
      const endMin = parseTimeToMinutes(overridden.end_time);
      const inWin = isTimeInWindow(currentMin, startMin, endMin);
      const minsRem = inWin
        ? (endMin >= startMin ? Math.max(0, endMin - currentMin) : Math.max(0, 1440 - currentMin + endMin))
        : 0;
      return {
        activeSession: overridden,
        liveWindowSession,
        nextSession,
        status: 'override',
        isWithinScheduledWindow: inWin,
        isAutoSwitchEnabled: autoSwitchEnabled,
        manualSessionId: overridden.id,
        minutesRemaining: minsRem,
        minutesUntilNext,
        todayTimeline,
      };
    }
  }

  if (!autoSwitchEnabled) {
    const manualFallback = liveWindowSession || validToday[0] || activeSessionsAll[0] || fallbackAll[0] || null;
    const liveItem = todayTimeline.find((t) => t.session.id === manualFallback?.id);
    return {
      activeSession: manualFallback,
      liveWindowSession,
      nextSession,
      status: liveWindowSession ? 'active' : 'outside',
      isWithinScheduledWindow: Boolean(liveWindowSession),
      isAutoSwitchEnabled: false,
      manualSessionId: manualFallback?.id || null,
      minutesRemaining: liveItem?.minutesRemaining || 0,
      minutesUntilNext,
      todayTimeline,
    };
  }

  if (liveWindowSession) {
    const liveItem = todayTimeline.find((t) => t.session.id === liveWindowSession.id);
    return {
      activeSession: liveWindowSession,
      liveWindowSession,
      nextSession,
      status: 'active',
      isWithinScheduledWindow: true,
      isAutoSwitchEnabled: true,
      manualSessionId: null,
      minutesRemaining: liveItem?.minutesRemaining || 0,
      minutesUntilNext,
      todayTimeline,
    };
  }

  // Outside active window: prefer upcoming session today, or last completed session today, or first active session
  const completedToday = todayTimeline.filter((t) => t.status === 'completed');
  const smartFallback =
    (upcomingItems.length > 0 ? upcomingItems[0].session : null) ||
    (completedToday.length > 0 ? completedToday[completedToday.length - 1].session : null) ||
    validToday[0] ||
    activeSessionsAll[0] ||
    fallbackAll[0] ||
    null;

  return {
    activeSession: smartFallback,
    liveWindowSession: null,
    nextSession,
    status: upcomingItems.length > 0 ? 'upcoming' : 'outside',
    isWithinScheduledWindow: false,
    isAutoSwitchEnabled: true,
    manualSessionId: null,
    minutesRemaining: 0,
    minutesUntilNext,
    todayTimeline,
  };
}

export interface SessionSummaryRow {
  sessionId: string;
  sessionName: string;
  timeRange: string;
  onTimeLimit: string;
  statusLabel: string;
  totalStudents: number;
  hadir: number;
  terlambat: number;
  izin: number;
  sakit: number;
  alpha: number;
  belumPresensi: number;
  totalRecorded: number;
  attendancePercent: number;
}

export interface SessionClassSummaryRow {
  sessionId: string;
  sessionName: string;
  classId: string;
  className: string;
  totalStudents: number;
  hadir: number;
  terlambat: number;
  izin: number;
  sakit: number;
  alpha: number;
  belumPresensi: number;
  totalAttended: number;
  attendancePercent: number;
}

export function buildSessionRecapData(params: {
  sessions: AttendanceSession[];
  classes: SchoolClass[];
  students: Student[];
  attendance: AttendanceRecord[];
  targetDate?: string;
}): {
  targetDate: string;
  sessionSummaries: SessionSummaryRow[];
  classSessionSummaries: SessionClassSummaryRow[];
} {
  const targetDate = params.targetDate || new Date().toISOString().split('T')[0];
  const { sessions, classes, students, attendance } = params;
  const studentMap = new Map<string, Student>(students.map((s) => [s.nis, s]));
  const totalStudents = students.length;

  const dayAttendance = attendance.filter((a) => a.date === targetDate);

  const sessionSummaries: SessionSummaryRow[] = sessions.map((sess) => {
    const sessAtt = dayAttendance.filter((a) => a.session_id === sess.id);
    const hadir = sessAtt.filter((a) => a.status === 'Hadir').length;
    const terlambat = sessAtt.filter((a) => a.status === 'Terlambat').length;
    const izin = sessAtt.filter((a) => a.status === 'Izin').length;
    const sakit = sessAtt.filter((a) => a.status === 'Sakit').length;
    const alpha = sessAtt.filter((a) => a.status === 'Alpha').length;
    const uniqueRecordedIds = new Set(sessAtt.map((a) => a.student_id));
    const belumPresensi = Math.max(0, totalStudents - uniqueRecordedIds.size);
    const totalAttended = hadir + terlambat;
    const attendancePercent = totalStudents > 0 ? Math.round((totalAttended / totalStudents) * 100) : 0;

    return {
      sessionId: sess.id,
      sessionName: sess.name,
      timeRange: `${sess.start_time} - ${sess.end_time}`,
      onTimeLimit: sess.on_time_limit,
      statusLabel: sess.is_active ? 'Aktif' : 'Nonaktif',
      totalStudents,
      hadir,
      terlambat,
      izin,
      sakit,
      alpha,
      belumPresensi,
      totalRecorded: sessAtt.length,
      attendancePercent,
    };
  });

  const classSessionSummaries: SessionClassSummaryRow[] = [];
  for (const sess of sessions) {
    const sessAtt = dayAttendance.filter((a) => a.session_id === sess.id);
    for (const cls of classes) {
      const clsStudents = students.filter((s) => s.class_id === cls.id);
      const clsTotal = clsStudents.length;
      const clsAtt = sessAtt.filter((a) => studentMap.get(a.student_id)?.class_id === cls.id);

      const hadir = clsAtt.filter((a) => a.status === 'Hadir').length;
      const terlambat = clsAtt.filter((a) => a.status === 'Terlambat').length;
      const izin = clsAtt.filter((a) => a.status === 'Izin').length;
      const sakit = clsAtt.filter((a) => a.status === 'Sakit').length;
      const alpha = clsAtt.filter((a) => a.status === 'Alpha').length;
      const uniqueRecordedIds = new Set(clsAtt.map((a) => a.student_id));
      const belumPresensi = Math.max(0, clsTotal - uniqueRecordedIds.size);
      const totalAttended = hadir + terlambat;
      const attendancePercent = clsTotal > 0 ? Math.round((totalAttended / clsTotal) * 100) : 0;

      classSessionSummaries.push({
        sessionId: sess.id,
        sessionName: sess.name,
        classId: cls.id,
        className: cls.name,
        totalStudents: clsTotal,
        hadir,
        terlambat,
        izin,
        sakit,
        alpha,
        belumPresensi,
        totalAttended,
        attendancePercent,
      });
    }
  }

  return {
    targetDate,
    sessionSummaries,
    classSessionSummaries,
  };
}
