import {
  User,
  Student,
  SchoolClass,
  AttendanceSession,
  AttendanceRecord,
  OutOfClassRecord,
  ViolationType,
  ViolationRecord,
  LeaveRequest,
  AppSettings,
  NotificationSettings,
  NotificationLog,
  AuditLog,
  AttendanceStatus,
  OutOfClassType,
  OutOfClassStatus,
  ViolationCategory,
} from '../../server/types.ts';

export type {
  User,
  Student,
  SchoolClass,
  AttendanceSession,
  AttendanceRecord,
  OutOfClassRecord,
  ViolationType,
  ViolationRecord,
  LeaveRequest,
  AppSettings,
  NotificationSettings,
  NotificationLog,
  AuditLog,
  AttendanceStatus,
  OutOfClassType,
  OutOfClassStatus,
  ViolationCategory,
};

export type ActiveTab =
  | 'attendance'
  | 'out_of_class'
  | 'violations'
  | 'dashboard'
  | 'homeroom'
  | 'student_affairs'
  | 'admin';

export interface AuthSession {
  token: string;
  userId: string;
  role: string;
  name: string;
  classId?: string;
  label?: string;
  tokenVersion?: number;
  lockedMenuRole?: 'homeroom' | 'student_affairs' | 'admin';
  lockedMenuClassId?: string;
  lockedMenuExpiresAt?: number;
}

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export interface SaveStatusState {
  state: 'idle' | 'saving' | 'saved' | 'error';
  message: string;
  updatedAt?: number;
}

export interface ConflictState {
  title: string;
  message: string;
  currentData?: any;
  onForceOverwrite: () => Promise<void>;
  onReloadLatest: () => Promise<void>;
}
