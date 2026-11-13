import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import type {
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
  DeltaChange,
} from './types.ts';
import { googleSheetsClient } from './sheets.ts';

interface DatabaseSchema {
  meta: Record<string, string>;
  users: User[];
  students: Student[];
  classes: SchoolClass[];
  sessions: AttendanceSession[];
  attendance: AttendanceRecord[];
  leave_requests: LeaveRequest[];
  out_of_class: OutOfClassRecord[];
  violation_types: ViolationType[];
  violations: ViolationRecord[];
  settings: AppSettings;
  notification_settings: NotificationSettings;
  notification_log: NotificationLog[];
  audit_log: AuditLog[];
  changes: DeltaChange[];
}

const IS_VERCEL = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'dkb_data') : path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

class StorageManager {
  private db: DatabaseSchema | null = null;
  private lastCacheTime = 0;
  private lastMtimeMs = 0;
  private cacheTtlMs = 1500; // 1.5 seconds cache
  private lockPromise: Promise<void> = Promise.resolve();

  constructor() {
    this.ensureDataDir();
  }

  private ensureDataDir() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      // If deployed on Vercel, copy bundled seed data to /tmp if not already present
      if (IS_VERCEL && !fs.existsSync(DB_FILE)) {
        const candidates = [
          path.resolve(process.cwd(), '.data', 'database.json'),
          path.resolve(process.cwd(), '..', '.data', 'database.json'),
          path.resolve('/var/task', '.data', 'database.json'),
          path.resolve('/var/task', 'database.json'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            try {
              fs.copyFileSync(candidate, DB_FILE);
              console.log('[Storage] Successfully seeded Vercel /tmp DB from:', candidate);
              break;
            } catch (copyErr) {
              console.warn('[Storage] Copy failed from:', candidate, copyErr);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Storage] ensureDataDir exception:', err);
    }
  }

  public isSheetsConnected(): boolean {
    return true;
  }

  private async loadDb(): Promise<DatabaseSchema> {
    const now = Date.now();

    if (fs.existsSync(DB_FILE)) {
      try {
        const stat = fs.statSync(DB_FILE);
        if (this.db && stat.mtimeMs <= this.lastMtimeMs && now - this.lastCacheTime < this.cacheTtlMs) {
          return this.db;
        }

        const content = fs.readFileSync(DB_FILE, 'utf-8');
        this.db = JSON.parse(content);
        this.lastMtimeMs = stat.mtimeMs;

        // Ensure classes have homeroom_teacher_email configured by admin
        let modified = false;
        if (this.db?.classes) {
          const defaultEmails: Record<string, string> = {
            '10-RPL-1': 'siti.aminah@sekolah.sch.id',
            '10-TKJ-1': 'budi.santoso@sekolah.sch.id',
            '11-RPL-1': 'sri.rahayu@sekolah.sch.id',
            '12-RPL-1': 'ahmad.fauzi@sekolah.sch.id',
          };
          for (const c of this.db.classes) {
            if (!c.homeroom_teacher_email) {
              c.homeroom_teacher_email = defaultEmails[c.id] || `${c.id.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sekolah.sch.id`;
              modified = true;
            }
          }
        }

        // Ensure notification_settings have weekly recap settings
        if (this.db?.notification_settings) {
          if (this.db.notification_settings.weekly_recap_enabled === undefined) {
            this.db.notification_settings.weekly_recap_enabled = true;
            this.db.notification_settings.weekly_recap_day = 5; // Friday
            this.db.notification_settings.weekly_recap_time = '15:00';
            modified = true;
          }
        }

        // Ensure google_account_email is configured
        if (this.db?.settings) {
          if (!this.db.settings.google_account_email) {
            this.db.settings.google_account_email = 'kswsmp.puncakdarussalam@gmail.com';
            this.db.settings.google_account_name = 'Kesiswaan SMP Puncak Darussalam';
            modified = true;
          }
          if (this.db.settings.toggle_email_notifications === undefined) {
            this.db.settings.toggle_email_notifications = true;
            modified = true;
          }
          if (this.db.settings.google_client_id === undefined) {
            this.db.settings.google_client_id = '1050818791896-mi4qsashp76oedjfgqiagmph04osv40b.apps.googleusercontent.com';
            modified = true;
          }
        }

        if (modified && this.db) {
          this.saveDbSync(this.db);
        }

        this.lastCacheTime = now;
        return this.db!;
      } catch (err) {
        console.error('[Storage] Error reading db file, re-initializing:', err);
      }
    }

    // Initialize default state
    this.db = this.getDefaultSchema();
    this.saveDbSync(this.db);
    this.lastCacheTime = now;
    return this.db;
  }

  private saveDbSync(db: DatabaseSchema) {
    try {
      this.ensureDataDir();
      const tempFile = `${DB_FILE}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 6)}`;
      fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf-8');
      fs.renameSync(tempFile, DB_FILE);
      try {
        this.lastMtimeMs = fs.statSync(DB_FILE).mtimeMs;
      } catch {
        this.lastMtimeMs = Date.now();
      }
    } catch (err) {
      console.warn('[Storage] saveDbSync error (ephemeral cache active):', err);
    }
  }

  private async mutate<T>(updater: (db: DatabaseSchema) => Promise<T> | T): Promise<T> {
    const prevLock = this.lockPromise;
    let release: () => void;
    this.lockPromise = new Promise<void>((r) => {
      release = r;
    });

    await prevLock;
    try {
      const db = await this.loadDb();
      const result = await updater(db);

      // Increment version
      const currentVer = parseInt(db.meta['current_version'] || '1', 10);
      const nextVer = currentVer + 1;
      db.meta['current_version'] = nextVer.toString();
      db.meta['last_updated_at'] = new Date().toISOString();

      this.saveDbSync(db);
      this.lastCacheTime = Date.now();
      if (googleSheetsClient.isConnected) {
        googleSheetsClient.scheduleAutoSync(() => db);
      }
      return result;
    } finally {
      release!();
    }
  }

  // --- RECORD DELTA CHANGE ---
  public recordChange(
    db: DatabaseSchema,
    entity: string,
    entityId: string,
    action: 'insert' | 'update' | 'delete',
    data?: any
  ) {
    const ver = parseInt(db.meta['current_version'] || '1', 10) + 1;
    const change: DeltaChange = {
      id: `chg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      version: ver,
      entity,
      entity_id: entityId,
      action,
      changed_at: new Date().toISOString(),
      data,
    };
    db.changes.push(change);

    // Keep changes trimmed to last 1000 items as mandated by Bagian 13 Poin 2
    if (db.changes.length > 1000) {
      db.changes = db.changes.slice(-1000);
    }
  }

  // --- TWO-WAY BIDIRECTIONAL SYNC ---
  public async applyTwoWaySync(payload: {
    classes?: SchoolClass[];
    students?: Student[];
    sessions?: AttendanceSession[];
    violation_types?: ViolationType[];
    attendance?: AttendanceRecord[];
    out_of_class?: OutOfClassRecord[];
    violations?: ViolationRecord[];
    leave_requests?: LeaveRequest[];
    settings?: Partial<AppSettings>;
    notification_settings?: Partial<NotificationSettings>;
    mutations?: Array<{ type: string; action?: string; payload: any }>;
  }) {
    return this.mutate((db) => {
      const nowIso = new Date().toISOString();

      if (Array.isArray(payload.classes)) {
        db.classes = payload.classes;
        this.recordChange(db, 'classes', 'bulk', 'update', db.classes);
      }

      if (Array.isArray(payload.students)) {
        db.students = payload.students;
        this.recordChange(db, 'students', 'bulk', 'update', db.students);
      }

      if (Array.isArray(payload.sessions)) {
        db.sessions = payload.sessions;
        this.recordChange(db, 'sessions', 'bulk', 'update', db.sessions);
      }

      if (Array.isArray(payload.violation_types)) {
        db.violation_types = payload.violation_types;
        this.recordChange(db, 'violation_types', 'bulk', 'update', db.violation_types);
      }

      if (Array.isArray(payload.attendance)) {
        for (const att of payload.attendance) {
          if (!att || !att.id) continue;
          const idx = db.attendance.findIndex((a) => a.id === att.id);
          if (idx >= 0) db.attendance[idx] = att;
          else db.attendance.unshift(att);
          this.recordChange(db, 'attendance', att.id, idx >= 0 ? 'update' : 'insert', att);
        }
      }

      if (Array.isArray(payload.out_of_class)) {
        for (const ooc of payload.out_of_class) {
          if (!ooc || !ooc.id) continue;
          const idx = db.out_of_class.findIndex((o) => o.id === ooc.id);
          if (idx >= 0) db.out_of_class[idx] = ooc;
          else db.out_of_class.unshift(ooc);
          this.recordChange(db, 'out_of_class', ooc.id, idx >= 0 ? 'update' : 'insert', ooc);
        }
      }

      if (Array.isArray(payload.violations)) {
        for (const v of payload.violations) {
          if (!v || !v.id) continue;
          const idx = db.violations.findIndex((item) => item.id === v.id);
          if (idx >= 0) db.violations[idx] = v;
          else db.violations.unshift(v);
          this.recordChange(db, 'violations', v.id, idx >= 0 ? 'update' : 'insert', v);
        }
      }

      if (Array.isArray(payload.leave_requests)) {
        for (const lr of payload.leave_requests) {
          if (!lr || !lr.id) continue;
          const idx = db.leave_requests.findIndex((item) => item.id === lr.id);
          if (idx >= 0) db.leave_requests[idx] = lr;
          else db.leave_requests.unshift(lr);
          this.recordChange(db, 'leave_requests', lr.id, idx >= 0 ? 'update' : 'insert', lr);
        }
      }

      if (payload.settings) {
        db.settings = { ...db.settings, ...payload.settings, updated_at: nowIso };
        this.recordChange(db, 'settings', 'global', 'update', db.settings);
      }

      if (payload.notification_settings) {
        db.notification_settings = { ...db.notification_settings, ...payload.notification_settings, updated_at: nowIso };
        this.recordChange(db, 'notification_settings', 'global', 'update', db.notification_settings);
      }

      if (Array.isArray(payload.mutations)) {
        for (const m of payload.mutations) {
          if (!m || !m.type) continue;
          const action = m.action || 'upsert';
          const p = m.payload;

          if (m.type === 'settings' && p) {
            db.settings = { ...db.settings, ...p, updated_at: nowIso };
            this.recordChange(db, 'settings', 'global', 'update', db.settings);
          } else if (m.type === 'notification_settings' && p) {
            db.notification_settings = { ...db.notification_settings, ...p, updated_at: nowIso };
            this.recordChange(db, 'notification_settings', 'global', 'update', db.notification_settings);
          } else if (m.type === 'classes' && p) {
            if (action === 'delete') {
              const delId = typeof p === 'string' ? p : p.id;
              const idx = db.classes.findIndex((c) => c.id === delId);
              if (idx >= 0) {
                db.classes.splice(idx, 1);
                this.recordChange(db, 'classes', delId, 'delete');
              }
            } else if (p.id) {
              const cls = { ...p, updated_at: nowIso, created_at: p.created_at || nowIso };
              const idx = db.classes.findIndex((c) => c.id === cls.id);
              if (idx >= 0) {
                db.classes[idx] = cls;
                this.recordChange(db, 'classes', cls.id, 'update', cls);
              } else {
                db.classes.push(cls);
                this.recordChange(db, 'classes', cls.id, 'insert', cls);
              }
            }
          } else if (m.type === 'students') {
            if (action === 'clear_all') {
              db.students = [];
              this.recordChange(db, 'students', 'bulk', 'update', db.students);
            } else if (action === 'delete_many') {
              const nisses: string[] = Array.isArray(p?.nisses) ? p.nisses : Array.isArray(p) ? p : [];
              const delSet = new Set(nisses);
              db.students = db.students.filter((s) => !delSet.has(s.nis));
              for (const nis of nisses) {
                this.recordChange(db, 'students', nis, 'delete');
              }
            } else if (action === 'delete' && p) {
              const delNis = typeof p === 'string' ? p : p.nis;
              const idx = db.students.findIndex((s) => s.nis === delNis);
              if (idx >= 0) {
                db.students.splice(idx, 1);
                this.recordChange(db, 'students', delNis, 'delete');
              }
            } else if (action === 'batch_import') {
              const incoming: Student[] = Array.isArray(p?.students) ? p.students : Array.isArray(p) ? p : [];
              for (const st of incoming) {
                if (!st?.nis) continue;
                const s = { ...st, updated_at: nowIso, created_at: st.created_at || nowIso };
                const idx = db.students.findIndex((x) => x.nis === s.nis);
                if (idx >= 0) {
                  db.students[idx] = s;
                  this.recordChange(db, 'students', s.nis, 'update', s);
                } else {
                  db.students.push(s);
                  this.recordChange(db, 'students', s.nis, 'insert', s);
                }
              }
            } else if (p?.nis) {
              const s = { ...p, updated_at: nowIso, created_at: p.created_at || nowIso };
              const idx = db.students.findIndex((x) => x.nis === s.nis);
              if (idx >= 0) {
                db.students[idx] = s;
                this.recordChange(db, 'students', s.nis, 'update', s);
              } else {
                db.students.push(s);
                this.recordChange(db, 'students', s.nis, 'insert', s);
              }
            }
          } else if (m.type === 'sessions' && p) {
            if (action === 'delete') {
              const delId = typeof p === 'string' ? p : p.id;
              const idx = db.sessions.findIndex((s) => s.id === delId);
              if (idx >= 0) {
                db.sessions.splice(idx, 1);
                this.recordChange(db, 'sessions', delId, 'delete');
              }
            } else if (p.id) {
              const sess = { ...p, updated_at: nowIso, created_at: p.created_at || nowIso };
              const idx = db.sessions.findIndex((s) => s.id === sess.id);
              if (idx >= 0) {
                db.sessions[idx] = sess;
                this.recordChange(db, 'sessions', sess.id, 'update', sess);
              } else {
                db.sessions.push(sess);
                this.recordChange(db, 'sessions', sess.id, 'insert', sess);
              }
            }
          } else if (m.type === 'violation_types' && p) {
            if (action === 'delete') {
              const delId = typeof p === 'string' ? p : p.id;
              const idx = db.violation_types.findIndex((vt) => vt.id === delId);
              if (idx >= 0) {
                const isUsed = db.violations.some((v) => v.violation_type_id === delId);
                if (isUsed) {
                  db.violation_types[idx].is_active = false;
                  db.violation_types[idx].updated_at = nowIso;
                  this.recordChange(db, 'violation_types', delId, 'update', db.violation_types[idx]);
                } else {
                  db.violation_types.splice(idx, 1);
                  this.recordChange(db, 'violation_types', delId, 'delete');
                }
              }
            } else if (p.id) {
              const vt = { ...p, updated_at: nowIso, created_at: p.created_at || nowIso };
              const idx = db.violation_types.findIndex((x) => x.id === vt.id);
              if (idx >= 0) {
                db.violation_types[idx] = vt;
                this.recordChange(db, 'violation_types', vt.id, 'update', vt);
              } else {
                db.violation_types.push(vt);
                this.recordChange(db, 'violation_types', vt.id, 'insert', vt);
              }
            }
          } else if (m.type === 'attendance' && p) {
            if (action === 'delete') {
              const delId = typeof p === 'string' ? p : p.id;
              const idx = db.attendance.findIndex((a) => a.id === delId);
              if (idx >= 0) {
                db.attendance.splice(idx, 1);
                this.recordChange(db, 'attendance', delId, 'delete');
              }
            } else if (action === 'update' && p.id) {
              const idx = db.attendance.findIndex((a) => a.id === p.id);
              if (idx >= 0) {
                const old = db.attendance[idx];
                const updated = {
                  ...old,
                  ...(p.updates || p),
                  version: (old.version || 1) + 1,
                  updated_at: nowIso,
                };
                db.attendance[idx] = updated;
                this.recordChange(db, 'attendance', p.id, 'update', updated);
              }
            } else if (p.id && p.student_id) {
              const idx = db.attendance.findIndex((a) => a.id === p.id);
              const dup = db.attendance.find(
                (a) =>
                  a.student_id === p.student_id &&
                  a.session_id === p.session_id &&
                  a.date === p.date
              );
              if (idx >= 0) {
                db.attendance[idx] = p;
                this.recordChange(db, 'attendance', p.id, 'update', p);
              } else if (!dup) {
                db.attendance.unshift(p);
                this.recordChange(db, 'attendance', p.id, 'insert', p);
              }
            }
          } else if (m.type === 'out_of_class' && p) {
            if (action === 'delete') {
              const delId = typeof p === 'string' ? p : p.id;
              const idx = db.out_of_class.findIndex((o) => o.id === delId);
              if (idx >= 0) {
                db.out_of_class.splice(idx, 1);
                this.recordChange(db, 'out_of_class', delId, 'delete');
              }
            } else if (p.id) {
              const idx = db.out_of_class.findIndex((o) => o.id === p.id);
              if (idx >= 0) {
                const updated = { ...db.out_of_class[idx], ...p, updated_at: nowIso };
                db.out_of_class[idx] = updated;
                this.recordChange(db, 'out_of_class', p.id, 'update', updated);
              } else if (p.student_id) {
                db.out_of_class.unshift(p);
                this.recordChange(db, 'out_of_class', p.id, 'insert', p);
              }
            }
          } else if (m.type === 'violations' && p) {
            if (action === 'delete') {
              const delId = typeof p === 'string' ? p : p.id;
              const idx = db.violations.findIndex((v) => v.id === delId);
              if (idx >= 0) {
                db.violations.splice(idx, 1);
                this.recordChange(db, 'violations', delId, 'delete');
              }
            } else if (p.id && p.student_id) {
              const idx = db.violations.findIndex((v) => v.id === p.id);
              if (idx >= 0) {
                db.violations[idx] = p;
                this.recordChange(db, 'violations', p.id, 'update', p);
              } else {
                db.violations.unshift(p);
                this.recordChange(db, 'violations', p.id, 'insert', p);
              }
            }
          } else if (m.type === 'leave_requests' && p) {
            if (action === 'delete') {
              const delId = typeof p === 'string' ? p : p.id;
              const idx = db.leave_requests.findIndex((lr) => lr.id === delId);
              if (idx >= 0) {
                db.leave_requests.splice(idx, 1);
                this.recordChange(db, 'leave_requests', delId, 'delete');
              }
            } else if (p.id) {
              const idx = db.leave_requests.findIndex((lr) => lr.id === p.id);
              if (idx >= 0) {
                const updated = { ...db.leave_requests[idx], ...p, updated_at: nowIso };
                db.leave_requests[idx] = updated;
                this.recordChange(db, 'leave_requests', p.id, 'update', updated);
              } else {
                db.leave_requests.unshift({ ...p, created_at: p.created_at || nowIso, updated_at: nowIso });
                this.recordChange(db, 'leave_requests', p.id, 'insert', p);
              }
            }
          }
        }
      }

      const curVer = parseInt(db.meta['current_version'] || '1', 10);
      return {
        success: true,
        version: curVer + 1,
        serverTime: nowIso,
        data: {
          settings: db.settings,
          classes: db.classes,
          sessions: db.sessions,
          students: db.students,
          violation_types: db.violation_types,
          attendance: db.attendance,
          out_of_class: db.out_of_class,
          violations: db.violations,
          leave_requests: db.leave_requests,
          notification_settings: db.notification_settings,
        },
      };
    });
  }

  // --- SYNC & SNAPSHOT ---
  public async getSyncData(sinceVersion = 0) {
    const db = await this.loadDb();
    const currentVersion = parseInt(db.meta['current_version'] || '1', 10);
    const serverTime = new Date().toISOString();

    // If client is brand new, client version is ahead (server restart/different instance),
    // lagged by more than 300 versions, or missed changes due to change trimming, send full snapshot
    const oldestChangeVer = db.changes.length > 0 ? db.changes[0].version : currentVersion;
    if (
      sinceVersion <= 0 ||
      sinceVersion > currentVersion ||
      currentVersion - sinceVersion > 300 ||
      (db.changes.length > 0 && sinceVersion < oldestChangeVer)
    ) {
      return {
        fullSnapshot: true,
        version: currentVersion,
        serverTime,
        data: {
          settings: db.settings,
          classes: db.classes,
          sessions: db.sessions,
          students: db.students,
          violation_types: db.violation_types,
          attendance: db.attendance,
          out_of_class: db.out_of_class,
          violations: db.violations,
          leave_requests: db.leave_requests,
          notification_settings: db.notification_settings,
        },
      };
    }

    const changes = db.changes.filter((c) => c.version > sinceVersion);
    return {
      fullSnapshot: false,
      version: currentVersion,
      serverTime,
      changes,
    };
  }

  public async getFullSnapshot() {
    const db = await this.loadDb();
    return {
      version: parseInt(db.meta['current_version'] || '1', 10),
      serverTime: new Date().toISOString(),
      db,
    };
  }

  // --- META ---
  public async getMeta(key: string): Promise<string | undefined> {
    const db = await this.loadDb();
    return db.meta[key];
  }

  // --- USERS ---
  public async getUsers(): Promise<User[]> {
    const db = await this.loadDb();
    return db.users;
  }

  public async findUserByRole(role: string): Promise<User | undefined> {
    const db = await this.loadDb();
    return db.users.find((u) => u.role === role && u.is_active);
  }

  public async findDutyUsers(): Promise<User[]> {
    const db = await this.loadDb();
    return db.users.filter((u) => u.role === 'duty' && u.is_active);
  }

  public async findHomeroomUser(name: string, classId: string): Promise<User | undefined> {
    const db = await this.loadDb();
    return db.users.find(
      (u) =>
        u.role === 'homeroom' &&
        u.is_active &&
        u.name.toLowerCase().trim() === name.toLowerCase().trim() &&
        u.class_id === classId
    );
  }

  public async saveUser(user: User): Promise<User> {
    return this.mutate((db) => {
      const idx = db.users.findIndex((u) => u.id === user.id);
      user.updated_at = new Date().toISOString();
      if (idx >= 0) {
        db.users[idx] = user;
        this.recordChange(db, 'users', user.id, 'update', user);
      } else {
        user.created_at = new Date().toISOString();
        db.users.push(user);
        this.recordChange(db, 'users', user.id, 'insert', user);
      }
      return user;
    });
  }

  public async deleteUser(id: string): Promise<boolean> {
    return this.mutate((db) => {
      const idx = db.users.findIndex((u) => u.id === id);
      if (idx >= 0) {
        db.users.splice(idx, 1);
        this.recordChange(db, 'users', id, 'delete');
        return true;
      }
      return false;
    });
  }

  // --- STUDENTS ---
  public async getStudents(): Promise<Student[]> {
    const db = await this.loadDb();
    return db.students;
  }

  public async findStudentByCode(code: string): Promise<Student | undefined> {
    const db = await this.loadDb();
    const clean = code.trim().toLowerCase();
    return db.students.find(
      (s) =>
        s.rfid_uid.toLowerCase() === clean ||
        s.card_code.toLowerCase() === clean ||
        s.nis.toLowerCase() === clean
    );
  }

  public async saveStudent(student: Student): Promise<Student> {
    return this.mutate((db) => {
      const idx = db.students.findIndex((s) => s.nis === student.nis);
      student.updated_at = new Date().toISOString();
      if (idx >= 0) {
        db.students[idx] = student;
        this.recordChange(db, 'students', student.nis, 'update', student);
      } else {
        student.created_at = new Date().toISOString();
        db.students.push(student);
        this.recordChange(db, 'students', student.nis, 'insert', student);
      }
      return student;
    });
  }

  public async batchSaveStudents(students: Student[]): Promise<{ added: number; updated: number }> {
    return this.mutate((db) => {
      let added = 0;
      let updated = 0;
      const now = new Date().toISOString();

      // Automatically create any missing classes referenced by students
      for (const s of students) {
        if (s.class_id && s.class_id.trim()) {
          const classCode = s.class_id.trim();
          const classExists = db.classes.some(
            (c) => c.id.toLowerCase() === classCode.toLowerCase() || c.name.toLowerCase() === classCode.toLowerCase()
          );

          if (!classExists) {
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

            const newClass: SchoolClass = {
              id: classCode,
              name: classCode,
              grade,
              major: major || 'Umum',
              homeroom_teacher_name: `Wali Kelas ${classCode}`,
              homeroom_teacher_email: `${classCode.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sekolah.sch.id`,
              quota_limit: 2,
              created_at: now,
              updated_at: now,
            };
            db.classes.push(newClass);
            this.recordChange(db, 'classes', newClass.id, 'insert', newClass);

            // Auto-create homeroom user account for this class if missing
            const userExists = db.users.some(
              (u) => u.role === 'homeroom' && u.class_id === newClass.id
            );
            if (!userExists) {
              const newHomeroomUser: User = {
                id: `user_hr_${newClass.id.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                role: 'homeroom',
                name: newClass.homeroom_teacher_name,
                class_id: newClass.id,
                email: newClass.homeroom_teacher_email,
                password_hash: bcrypt.hashSync('wali123', 10),
                label: `Wali Kelas ${newClass.name}`,
                token_version: 1,
                is_active: true,
                created_at: now,
                updated_at: now,
              };
              db.users.push(newHomeroomUser);
              this.recordChange(db, 'users', newHomeroomUser.id, 'insert', newHomeroomUser);
            }
          }
        }
      }

      for (const s of students) {
        const idx = db.students.findIndex((x) => x.nis === s.nis);
        s.updated_at = now;
        if (idx >= 0) {
          db.students[idx] = s;
          this.recordChange(db, 'students', s.nis, 'update', s);
          updated++;
        } else {
          s.created_at = now;
          db.students.push(s);
          this.recordChange(db, 'students', s.nis, 'insert', s);
          added++;
        }
      }
      return { added, updated };
    });
  }

  public async deleteStudent(nis: string): Promise<boolean> {
    return this.mutate((db) => {
      const idx = db.students.findIndex((s) => s.nis === nis);
      if (idx >= 0) {
        db.students.splice(idx, 1);
        this.recordChange(db, 'students', nis, 'delete');
        return true;
      }
      return false;
    });
  }

  public async deleteStudents(nisses: string[]): Promise<number> {
    return this.mutate((db) => {
      const set = new Set(nisses);
      const initialCount = db.students.length;
      db.students = db.students.filter((s) => !set.has(s.nis));
      for (const nis of nisses) {
        this.recordChange(db, 'students', nis, 'delete');
      }
      return initialCount - db.students.length;
    });
  }

  public async clearAllStudents(): Promise<number> {
    return this.mutate((db) => {
      const count = db.students.length;
      const allNis = db.students.map((s) => s.nis);
      db.students = [];
      for (const nis of allNis) {
        this.recordChange(db, 'students', nis, 'delete');
      }
      return count;
    });
  }

  // --- CLASSES ---
  public async getClasses(): Promise<SchoolClass[]> {
    const db = await this.loadDb();
    return db.classes;
  }

  public async saveClass(cls: SchoolClass): Promise<SchoolClass> {
    return this.mutate((db) => {
      const idx = db.classes.findIndex((c) => c.id === cls.id);
      cls.updated_at = new Date().toISOString();
      if (idx >= 0) {
        db.classes[idx] = cls;
        this.recordChange(db, 'classes', cls.id, 'update', cls);
      } else {
        cls.created_at = new Date().toISOString();
        db.classes.push(cls);
        this.recordChange(db, 'classes', cls.id, 'insert', cls);
      }
      return cls;
    });
  }

  public async deleteClass(id: string): Promise<boolean> {
    return this.mutate((db) => {
      const idx = db.classes.findIndex((c) => c.id === id);
      if (idx >= 0) {
        db.classes.splice(idx, 1);
        this.recordChange(db, 'classes', id, 'delete');
        return true;
      }
      return false;
    });
  }

  // --- SESSIONS ---
  public async getSessions(): Promise<AttendanceSession[]> {
    const db = await this.loadDb();
    return db.sessions;
  }

  public async saveSession(session: AttendanceSession): Promise<AttendanceSession> {
    return this.mutate((db) => {
      const idx = db.sessions.findIndex((s) => s.id === session.id);
      session.updated_at = new Date().toISOString();
      if (idx >= 0) {
        db.sessions[idx] = session;
        this.recordChange(db, 'sessions', session.id, 'update', session);
      } else {
        session.created_at = new Date().toISOString();
        db.sessions.push(session);
        this.recordChange(db, 'sessions', session.id, 'insert', session);
      }
      return session;
    });
  }

  public async deleteSession(id: string): Promise<boolean> {
    return this.mutate((db) => {
      const idx = db.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) {
        db.sessions.splice(idx, 1);
        this.recordChange(db, 'sessions', id, 'delete');
        return true;
      }
      return false;
    });
  }

  // --- ATTENDANCE (ANTI-BENTROK / DUPLICATE PROTECTION) ---
  public async getAttendance(): Promise<AttendanceRecord[]> {
    const db = await this.loadDb();
    return db.attendance;
  }

  /**
   * Records attendance with strict uniqueness check:
   * Unique Key: student_id + session_id + date
   * Follows Bagian 13 Poin 5.
   */
  public async recordAttendance(
    record: AttendanceRecord
  ): Promise<{ success: boolean; record: AttendanceRecord; isDuplicate: boolean; message?: string }> {
    return this.mutate((db) => {
      const nowIso = new Date().toISOString();

      // Check if already exists with same student, session, and date
      const existing = db.attendance.find(
        (a) =>
          a.student_id === record.student_id &&
          a.session_id === record.session_id &&
          a.date === record.date
      );

      if (existing) {
        return {
          success: false,
          record: existing,
          isDuplicate: true,
          message: 'Siswa sudah melakukan presensi pada sesi ini hari ini.',
        };
      }

      record.created_at = nowIso;
      record.updated_at = nowIso;
      record.version = 1;
      db.attendance.unshift(record);
      this.recordChange(db, 'attendance', record.id, 'insert', record);

      return {
        success: true,
        record,
        isDuplicate: false,
      };
    });
  }

  public async updateAttendance(
    id: string,
    updates: Partial<AttendanceRecord>,
    auditedBy: string,
    reason: string
  ): Promise<AttendanceRecord | null> {
    return this.mutate((db) => {
      const idx = db.attendance.findIndex((a) => a.id === id);
      if (idx < 0) return null;

      const old = { ...db.attendance[idx] };
      const updated: AttendanceRecord = {
        ...old,
        ...updates,
        audited_by: auditedBy,
        audit_reason: reason,
        version: old.version + 1,
        updated_at: new Date().toISOString(),
      };

      db.attendance[idx] = updated;
      this.recordChange(db, 'attendance', id, 'update', updated);

      this.logAuditInternal(db, auditedBy, 'audit', 'update', 'attendance', id, JSON.stringify(old), JSON.stringify(updated), reason);

      return updated;
    });
  }

  public async deleteAttendance(id: string, auditedBy: string, reason: string): Promise<boolean> {
    return this.mutate((db) => {
      const idx = db.attendance.findIndex((a) => a.id === id);
      if (idx < 0) return false;

      const old = db.attendance[idx];
      db.attendance.splice(idx, 1);
      this.recordChange(db, 'attendance', id, 'delete');

      this.logAuditInternal(db, auditedBy, 'audit', 'delete', 'attendance', id, JSON.stringify(old), '', reason);
      return true;
    });
  }

  // --- OUT OF CLASS (SERVER VALIDATION & QUOTA PROTECTION) ---
  public async getOutOfClass(): Promise<OutOfClassRecord[]> {
    const db = await this.loadDb();
    return db.out_of_class;
  }

  /**
   * Starts an out of class permission with strict server validation:
   * 1. Max 2 active students per class currently out
   * 2. Max 2 out-of-class requests per student per day
   * 3. Student cannot start if already actively out
   */
  public async startOutOfClass(
    record: OutOfClassRecord
  ): Promise<{ success: boolean; record?: OutOfClassRecord; error?: string }> {
    return this.mutate((db) => {
      const todayDate = record.started_at.split('T')[0];
      const maxPerClass = db.settings.out_of_class_max_per_class || 2;
      const maxPerStudent = db.settings.out_of_class_max_per_student_daily || 2;

      // 1. Check if student is already out
      const alreadyOut = db.out_of_class.find(
        (o) =>
          o.student_id === record.student_id &&
          (o.status === 'active' || o.status === 'overdue')
      );
      if (alreadyOut) {
        return {
          success: false,
          error: 'Siswa masih berstatus izin keluar kelas dan belum dikonfirmasi kembali.',
        };
      }

      // 2. Check active out quota for this class
      const activeInClass = db.out_of_class.filter(
        (o) =>
          o.class_id === record.class_id &&
          (o.status === 'active' || o.status === 'overdue')
      ).length;

      if (activeInClass >= maxPerClass) {
        const cls = db.classes.find((c) => c.id === record.class_id);
        const className = cls ? cls.name : record.class_id;
        return {
          success: false,
          error: `Kuota kelas ${className} sudah penuh (${maxPerClass} siswa sedang di luar), mohon tunggu hingga ada siswa yang kembali.`,
        };
      }

      // 3. Check student daily limit
      const studentDailyCount = db.out_of_class.filter(
        (o) =>
          o.student_id === record.student_id &&
          o.started_at.startsWith(todayDate)
      ).length;

      if (studentDailyCount >= maxPerStudent) {
        return {
          success: false,
          error: `Siswa telah mencapai batas maksimal izin keluar hari ini (${maxPerStudent} kali).`,
        };
      }

      const nowIso = new Date().toISOString();
      record.created_at = nowIso;
      record.updated_at = nowIso;
      record.version = 1;
      db.out_of_class.unshift(record);
      this.recordChange(db, 'out_of_class', record.id, 'insert', record);

      return {
        success: true,
        record,
      };
    });
  }

  /**
   * Confirm student return (Idempotent: click checkmark)
   * Calculates actual_minutes and late_return_minutes based on server clock.
   */
  public async confirmOutOfClassReturn(
    id: string,
    returnMethod: 'click' | 'manual' = 'click',
    notes?: string,
    auditedBy?: string,
    auditReason?: string
  ): Promise<{ success: boolean; record?: OutOfClassRecord; alreadyReturned?: boolean; error?: string }> {
    return this.mutate((db) => {
      const item = db.out_of_class.find((o) => o.id === id);
      if (!item) {
        return { success: false, error: 'Data izin keluar tidak ditemukan.' };
      }

      if (item.status === 'returned' || item.status === 'auto_closed') {
        return {
          success: true,
          alreadyReturned: true,
          record: item,
        };
      }

      const now = new Date();
      const returnTime = now.toISOString();
      const startTime = new Date(item.started_at).getTime();
      const dueTime = new Date(item.due_at).getTime();
      const nowTime = now.getTime();

      const actualMinutes = Math.max(1, Math.round((nowTime - startTime) / 60000));
      // late_return_minutes = max(0, jam kembali - due_at), rounded up to minute
      const lateMs = nowTime - dueTime;
      const lateReturnMinutes = lateMs > 0 ? Math.ceil(lateMs / 60000) : 0;

      item.returned_at = returnTime;
      item.actual_minutes = actualMinutes;
      item.late_return_minutes = lateReturnMinutes;
      item.return_method = returnMethod;
      item.status = 'returned';
      item.return_notes = notes;
      item.version = item.version + 1;
      item.updated_at = returnTime;

      if (auditedBy && auditReason) {
        item.audited_by = auditedBy;
        item.audit_reason = auditReason;
      }

      this.recordChange(db, 'out_of_class', item.id, 'update', item);

      return {
        success: true,
        alreadyReturned: false,
        record: item,
      };
    });
  }

  /**
   * Auto-closes any remaining active/overdue permissions at day/session end
   */
  public async autoCloseOverdueOutOfClass(): Promise<number> {
    return this.mutate((db) => {
      let count = 0;
      const now = new Date();
      const nowIso = now.toISOString();

      for (const item of db.out_of_class) {
        if (item.status === 'active' || item.status === 'overdue') {
          const startTime = new Date(item.started_at).getTime();
          // If started earlier today and more than 4 hours ago, or overnight
          if (now.getTime() - startTime > 3 * 3600 * 1000) {
            item.status = 'auto_closed';
            item.return_method = 'auto_closed';
            item.returned_at = nowIso;
            item.return_notes = 'Otomatis ditutup oleh sistem (tidak dikonfirmasi kembali)';
            item.version += 1;
            item.updated_at = nowIso;
            this.recordChange(db, 'out_of_class', item.id, 'update', item);
            count++;
          }
        }
      }
      return count;
    });
  }

  // --- VIOLATIONS & TYPES ---
  public async getViolationTypes(): Promise<ViolationType[]> {
    const db = await this.loadDb();
    return db.violation_types;
  }

  public async saveViolationType(vtype: ViolationType): Promise<ViolationType> {
    return this.mutate((db) => {
      const idx = db.violation_types.findIndex((v) => v.id === vtype.id);
      vtype.updated_at = new Date().toISOString();
      if (idx >= 0) {
        db.violation_types[idx] = vtype;
        this.recordChange(db, 'violation_types', vtype.id, 'update', vtype);
      } else {
        vtype.created_at = new Date().toISOString();
        db.violation_types.push(vtype);
        this.recordChange(db, 'violation_types', vtype.id, 'insert', vtype);
      }
      return vtype;
    });
  }

  public async deleteViolationType(id: string): Promise<boolean> {
    return this.mutate((db) => {
      const idx = db.violation_types.findIndex((v) => v.id === id);
      if (idx >= 0) {
        // If already used in violations, mark inactive instead of hard delete
        const isUsed = db.violations.some((v) => v.violation_type_id === id);
        if (isUsed) {
          db.violation_types[idx].is_active = false;
          this.recordChange(db, 'violation_types', id, 'update', db.violation_types[idx]);
        } else {
          db.violation_types.splice(idx, 1);
          this.recordChange(db, 'violation_types', id, 'delete');
        }
        return true;
      }
      return false;
    });
  }

  public async getViolations(): Promise<ViolationRecord[]> {
    const db = await this.loadDb();
    return db.violations;
  }

  public async recordViolation(violation: ViolationRecord): Promise<ViolationRecord> {
    return this.mutate((db) => {
      const nowIso = new Date().toISOString();
      violation.created_at = nowIso;
      violation.updated_at = nowIso;
      violation.version = 1;
      db.violations.unshift(violation);
      this.recordChange(db, 'violations', violation.id, 'insert', violation);
      return violation;
    });
  }

  public async deleteViolation(id: string, auditedBy: string, reason: string): Promise<boolean> {
    return this.mutate((db) => {
      const idx = db.violations.findIndex((v) => v.id === id);
      if (idx < 0) return false;
      const old = db.violations[idx];
      db.violations.splice(idx, 1);
      this.recordChange(db, 'violations', id, 'delete');
      this.logAuditInternal(db, auditedBy, 'audit', 'delete', 'violations', id, JSON.stringify(old), '', reason);
      return true;
    });
  }

  // --- LEAVE REQUESTS ---
  public async getLeaveRequests(): Promise<LeaveRequest[]> {
    const db = await this.loadDb();
    return db.leave_requests;
  }

  public async saveLeaveRequest(req: LeaveRequest): Promise<LeaveRequest> {
    return this.mutate((db) => {
      const idx = db.leave_requests.findIndex((l) => l.id === req.id);
      req.updated_at = new Date().toISOString();
      if (idx >= 0) {
        db.leave_requests[idx] = req;
        this.recordChange(db, 'leave_requests', req.id, 'update', req);
      } else {
        req.created_at = new Date().toISOString();
        db.leave_requests.unshift(req);
        this.recordChange(db, 'leave_requests', req.id, 'insert', req);
      }
      return req;
    });
  }

  // --- SETTINGS ---
  public async getSettings(): Promise<AppSettings> {
    const db = await this.loadDb();
    return db.settings;
  }

  public async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    return this.mutate((db) => {
      db.settings = {
        ...db.settings,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      this.recordChange(db, 'settings', 'global', 'update', db.settings);
      return db.settings;
    });
  }

  // --- NOTIFICATION SETTINGS & LOG ---
  public async getNotificationSettings(): Promise<NotificationSettings> {
    const db = await this.loadDb();
    return db.notification_settings;
  }

  public async updateNotificationSettings(updates: Partial<NotificationSettings>): Promise<NotificationSettings> {
    return this.mutate((db) => {
      db.notification_settings = {
        ...db.notification_settings,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      this.recordChange(db, 'notification_settings', 'global', 'update', db.notification_settings);
      return db.notification_settings;
    });
  }

  public async getNotificationLogs(): Promise<NotificationLog[]> {
    const db = await this.loadDb();
    return db.notification_log;
  }

  public async logNotification(log: NotificationLog): Promise<void> {
    return this.mutate((db) => {
      db.notification_log.unshift(log);
      if (db.notification_log.length > 500) {
        db.notification_log = db.notification_log.slice(0, 500);
      }
    });
  }

  // --- AUDIT LOG ---
  public async getAuditLogs(): Promise<AuditLog[]> {
    const db = await this.loadDb();
    return db.audit_log;
  }

  public async logAudit(
    actorName: string,
    actorRole: string,
    action: string,
    entity: string,
    entityId: string,
    oldValues?: string,
    newValues?: string,
    reason?: string,
    ipOrDevice?: string
  ): Promise<void> {
    return this.mutate((db) => {
      this.logAuditInternal(db, actorName, actorRole, action, entity, entityId, oldValues, newValues, reason, ipOrDevice);
    });
  }

  private logAuditInternal(
    db: DatabaseSchema,
    actorName: string,
    actorRole: string,
    action: string,
    entity: string,
    entityId: string,
    oldValues?: string,
    newValues?: string,
    reason?: string,
    ipOrDevice?: string
  ) {
    const log: AuditLog = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      actor_name: actorName,
      actor_role: actorRole,
      action,
      entity,
      entity_id: entityId,
      old_values: oldValues,
      new_values: newValues,
      reason,
      ip_or_device: ipOrDevice,
    };
    db.audit_log.unshift(log);
    if (db.audit_log.length > 1000) {
      db.audit_log = db.audit_log.slice(0, 1000);
    }
  }

  // --- DEFAULT SEED SCHEMA ---
  private getDefaultSchema(): DatabaseSchema {
    const salt = bcrypt.genSaltSync(10);
    const now = new Date().toISOString();

    return {
      meta: {
        current_version: '1',
        app_name: 'DISIPLIN KITA BISA',
        initialized_at: now,
        last_updated_at: now,
      },
      users: [
        {
          id: 'user_duty_main',
          role: 'duty',
          name: 'Petugas Piket Utama',
          password_hash: bcrypt.hashSync('piket123', salt),
          label: 'Gerbang Utama & Pos Piket',
          token_version: 1,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'user_admin_main',
          role: 'admin',
          name: 'Administrator Sekolah',
          password_hash: bcrypt.hashSync('admin123', salt),
          label: 'Admin Sistem',
          token_version: 1,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'user_student_affairs',
          role: 'student_affairs',
          name: 'Bagian Kesiswaan & Tatib',
          password_hash: bcrypt.hashSync('kesiswaan123', salt),
          label: 'Tim Kesiswaan',
          token_version: 1,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ],
      classes: [],
      sessions: [
        {
          id: 'sess_pagi',
          name: 'Masuk Pagi',
          start_time: '06:00',
          on_time_limit: '07:00',
          end_time: '08:00',
          active_days: [1, 2, 3, 4, 5],
          late_tolerance_minutes: 15,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'sess_dhuha',
          name: 'Salat Dhuha',
          start_time: '09:30',
          on_time_limit: '09:45',
          end_time: '10:15',
          active_days: [1, 2, 3, 4, 5],
          late_tolerance_minutes: 5,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'sess_zuhur',
          name: 'Salat Zuhur',
          start_time: '12:00',
          on_time_limit: '12:20',
          end_time: '12:50',
          active_days: [1, 2, 3, 4],
          late_tolerance_minutes: 10,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'sess_pulang',
          name: 'Pulang Sekolah',
          start_time: '15:00',
          on_time_limit: '15:30',
          end_time: '17:00',
          active_days: [1, 2, 3, 4, 5],
          late_tolerance_minutes: 30,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ],
      students: [],
      violation_types: [
        {
          id: 'vt_1',
          code: 'REG-01',
          name: 'Atribut seragam tidak lengkap (dasi/topi/sabuk/sepatu hitam)',
          category: 'ringan',
          default_points: 5,
          is_active: true,
          description: 'Kelengkapan seragam resmi sekolah',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_2',
          code: 'REG-02',
          name: 'Terlambat masuk kelas setelah istirahat',
          category: 'ringan',
          default_points: 5,
          is_active: true,
          description: 'Kembali ke kelas setelah bel istirahat berbunyi',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_3',
          code: 'REG-03',
          name: 'Membuang sampah tidak pada tempatnya',
          category: 'ringan',
          default_points: 5,
          is_active: true,
          description: 'Kebersihan lingkungan sekolah',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_4',
          code: 'MED-01',
          name: 'Meninggalkan jam pelajaran tanpa izin guru piket/pengajar',
          category: 'sedang',
          default_points: 15,
          is_active: true,
          description: 'Bolos pada jam pelajaran berlangsung',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_5',
          code: 'MED-02',
          name: 'Rambut tidak rapi/diwarnai/tato temporer',
          category: 'sedang',
          default_points: 10,
          is_active: true,
          description: 'Kerapian penampilan sesuai standar sekolah',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_6',
          code: 'MED-03',
          name: 'Merokok atau vaping di lingkungan sekolah/radius 500m',
          category: 'sedang',
          default_points: 30,
          is_active: true,
          description: 'Kawasan tanpa rokok dan vape',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_7',
          code: 'SEV-01',
          name: 'Membawa senjata tajam atau barang berbahaya ke sekolah',
          category: 'berat',
          default_points: 75,
          is_active: true,
          description: 'Keamanan warga sekolah',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_8',
          code: 'SEV-02',
          name: 'Terlibat perkelahian atau tawuran antarpelajar',
          category: 'berat',
          default_points: 100,
          is_active: true,
          description: 'Tindakan kekerasan fisik',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_9',
          code: 'SEV-03',
          name: 'Merusak fasilitas sekolah atau barang milik orang lain',
          category: 'berat',
          default_points: 50,
          is_active: true,
          description: 'Perusakan sarana dan prasarana',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_10',
          code: 'ACH-01',
          name: 'Juara 1/2/3 Lomba Tingkat Kota/Provinsi/Nasional',
          category: 'prestasi',
          default_points: 25,
          is_active: true,
          description: 'Prestasi akademik maupun non-akademik',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_11',
          code: 'ACH-02',
          name: 'Petugas Upacara Bendera / Kedisiplinan Teladan',
          category: 'prestasi',
          default_points: 10,
          is_active: true,
          description: 'Dedikasi ketertiban dan kepemimpinan',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'vt_12',
          code: 'ACH-03',
          name: 'Karya Inovasi / Juara Kelas / Pengurus OSIS Aktif',
          category: 'prestasi',
          default_points: 15,
          is_active: true,
          description: 'Apresiasi kontribusi positif',
          created_at: now,
          updated_at: now,
        },
      ],
      attendance: [],
      leave_requests: [],
      out_of_class: [],
      violations: [],
      settings: {
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
        updated_at: now,
      },
      notification_settings: {
        email_enabled: false,
        trigger_late: true,
        trigger_alpha: true,
        trigger_leave: true,
        trigger_violation: true,
        trigger_warning_threshold: true,
        trigger_overdue_out_of_class: true,
        warning_threshold_points: 25,
        subject_template: 'Pemberitahuan Kedisiplinan Siswa: {nama_siswa} ({kelas})',
        body_template: 'Yth. Orang Tua / Wali dari {nama_siswa},\n\nKami menginformasikan bahwa pada tanggal {tanggal} pukul {jam}, putra/putri Anda tercatat: {status}.\nDetail: {pelanggaran} (Poin: {poin}, Menit Keterlambatan: {menit_terlambat_kembali}).\n\nMohon perhatian dan bimbingannya.\n\nHormat kami,\n{nama_sekolah}',
        weekly_recap_enabled: true,
        weekly_recap_day: 5,
        weekly_recap_time: '15:00',
        weekly_recap_last_sent: undefined,
        updated_at: now,
      },
      notification_log: [],
      audit_log: [],
      changes: [
        {
          id: 'init_1',
          version: 1,
          entity: 'meta',
          entity_id: 'app_name',
          action: 'insert',
          changed_at: now,
        },
      ],
    };
  }
}

export const storage = new StorageManager();
