import { sheetsDb, SheetsConfigError, GoogleAuthExpiredError, ConflictError } from './sheets.ts';
import { authService } from './auth.ts';
import { notificationService } from './emailer.ts';
import { resolveSessionSchedule } from './sessionHelper.ts';
import * as XLSX from 'xlsx';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { AttendanceRecord } from './types.ts';
import {
  getSavedAppsScriptUrl,
  saveAppsScriptUrlConfig,
  clearAppsScriptUrlConfig,
  isValidServerAppsScriptUrl,
} from './appsScriptConfig.ts';

function sanitizePayloadForSigning(obj: Record<string, any>): Record<string, any> {
  const copy = { ...obj };
  delete copy.exp;
  delete copy.iat;
  delete copy.nbf;
  delete copy.jti;
  return copy;
}

export interface ApiRequest {
  method: string;
  url: string;
  query: Record<string, string>;
  body: any;
  headers: Record<string, string | undefined>;
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
}

export class JsonResponse {
  static ok(data: any, headers?: Record<string, string>): ApiResponse {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: data,
    };
  }

  static badRequest(message: string, details?: any): ApiResponse {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message, ...(details ? { details, ...details } : {}) },
    };
  }

  static unauthorized(message = 'Unauthorized'): ApiResponse {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message },
    };
  }

  static forbidden(message = 'Forbidden'): ApiResponse {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message },
    };
  }

  static notFound(message = 'Not Found'): ApiResponse {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message },
    };
  }

  static conflict(message: string, current: any): ApiResponse {
    return {
      statusCode: 409,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message, conflict: true, current },
    };
  }

  static serviceUnavailable(
    message: string,
    missingEnv: string[],
    extra?: { requiresGoogleSignIn?: boolean; authMode?: string; hasServiceAccount?: boolean }
  ): ApiResponse {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: message,
        configured: false,
        missingEnv,
        requiresGoogleSignIn: extra?.requiresGoogleSignIn ?? false,
        authMode: extra?.authMode ?? 'unconfigured',
        hasServiceAccount: extra?.hasServiceAccount ?? false,
        savedAppsScriptUrl: getSavedAppsScriptUrl() || undefined,
      },
    };
  }

  static serverError(err: any): ApiResponse {
    if (err instanceof SheetsConfigError) {
      const envStatus = sheetsDb.getFullEnvStatus();
      return JsonResponse.serviceUnavailable(err.message, err.missingEnv, {
        requiresGoogleSignIn: envStatus.requiresGoogleSignIn,
        authMode: envStatus.authMode,
        hasServiceAccount: envStatus.hasServiceAccount,
      });
    }
    if (err instanceof GoogleAuthExpiredError) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { error: err.message, googleAuthExpired: true },
      };
    }
    if (err instanceof ConflictError) {
      return JsonResponse.conflict(err.message, err.current);
    }
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: err?.message || 'Internal Server Error' },
    };
  }
}

/**
 * Main stateless API Handler for Vercel Serverless & local Express
 */
export async function handleApiRoute(req: ApiRequest): Promise<ApiResponse> {
  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;
  const method = req.method.toUpperCase();

  const query: Record<string, string> = { ...req.query };
  urlObj.searchParams.forEach((val, key) => {
    query[key] = val;
  });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
  const googleAccessToken = (req.headers['x-google-access-token'] || '').trim();

  return await sheetsDb.runWithOAuthToken(googleAccessToken, async () => {
  try {
    // 0. APPS SCRIPT PERSISTENT CONFIG: /api/apps-script-config
    if (pathname === '/api/apps-script-config') {
      if (method === 'GET') {
        return JsonResponse.ok(
          { appsScriptUrl: getSavedAppsScriptUrl() },
          { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
        );
      }
      if (method === 'POST') {
        const rawUrl = String(req.body?.appsScriptUrl || '').trim();
        if (!isValidServerAppsScriptUrl(rawUrl)) {
          return JsonResponse.badRequest(
            'URL harus berupa alamat Web App Google Apps Script HTTPS yang valid (https://script.google.com/macros/s/.../exec).'
          );
        }
        const saved = saveAppsScriptUrlConfig(rawUrl);
        return JsonResponse.ok({ success: true, appsScriptUrl: saved });
      }
      if (method === 'DELETE') {
        clearAppsScriptUrlConfig();
        return JsonResponse.ok({ success: true, appsScriptUrl: '' });
      }
      return JsonResponse.badRequest('Method tidak didukung untuk /api/apps-script-config.');
    }

    // 1. SETUP & CONFIG CHECK: /api/setup
    if (pathname === '/api/setup') {
      const envStatus = sheetsDb.getFullEnvStatus();
      if (!envStatus.sheetsConfigured) {
        return JsonResponse.serviceUnavailable(
          envStatus.requiresGoogleSignIn
            ? 'Hubungkan akun Google Anda untuk mengakses Google Sheets & Drive secara otomatis.'
            : `Environment variable server belum lengkap: ${envStatus.missingEnv.join(', ')}`,
          envStatus.missingEnv,
          {
            requiresGoogleSignIn: envStatus.requiresGoogleSignIn,
            authMode: envStatus.authMode,
            hasServiceAccount: envStatus.hasServiceAccount,
          }
        );
      }
      await sheetsDb.ensureSheetsAndHeaders();
      const emailStatus = notificationService.getEmailTransportStatus();
      return JsonResponse.ok({
        success: true,
        configured: envStatus.configured,
        sheetsConfigured: envStatus.sheetsConfigured,
        driveConfigured: envStatus.driveConfigured,
        spreadsheetConfigured: envStatus.spreadsheetConfigured,
        driveFolderConfigured: envStatus.driveFolderConfigured,
        hasServiceAccount: envStatus.hasServiceAccount,
        authMode: envStatus.authMode,
        requiresGoogleSignIn: envStatus.requiresGoogleSignIn,
        emailConnected: emailStatus.connected,
        emailTransport: emailStatus.transport,
        savedAppsScriptUrl: getSavedAppsScriptUrl() || undefined,
        missingEnv: envStatus.missingEnv,
        serverTime: new Date().toISOString(),
      });
    }

    // 2. PRIVATE PHOTO PROXY & UPLOAD: /api/photos
    if (pathname === '/api/photos') {
      const envStatus = sheetsDb.getFullEnvStatus();
      if (!envStatus.driveConfigured) {
        return JsonResponse.serviceUnavailable(
          envStatus.requiresGoogleSignIn
            ? 'Hubungkan akun Google Anda untuk mengakses foto di Google Drive.'
            : `Environment variable Google Drive belum lengkap: ${envStatus.missingEnv.join(', ')}`,
          envStatus.missingEnv,
          {
            requiresGoogleSignIn: envStatus.requiresGoogleSignIn,
            authMode: envStatus.authMode,
            hasServiceAccount: envStatus.hasServiceAccount,
          }
        );
      }

      if (method === 'GET') {
        const fileId = (query.id || '').trim();
        if (!fileId || !/^[a-zA-Z0-9_-]{10,200}$/.test(fileId)) {
          return JsonResponse.badRequest('Parameter id file Drive tidak valid.');
        }
        const fileData = await sheetsDb.getPhotoFromDrive(fileId);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': fileData.mimeType,
            'Cache-Control': 'private, max-age=86400',
          },
          body: fileData.buffer,
        };
      }

      if (method === 'POST') {
        const { base64, fileName } = req.body || {};
        if (!base64) return JsonResponse.badRequest('Data base64 foto wajib diisi.');
        const fileId = await sheetsDb.uploadPhotoToDrive(base64, fileName || `foto_${Date.now()}.jpg`);
        return JsonResponse.ok({ success: true, fileId });
      }
    }

    // 3. AUTH: /api/auth
    if (pathname === '/api/auth') {
      const envStatus = sheetsDb.getFullEnvStatus();
      if (!envStatus.sheetsConfigured) {
        return JsonResponse.serviceUnavailable(
          envStatus.requiresGoogleSignIn
            ? 'Hubungkan akun Google Anda terlebih dahulu untuk mengakses aplikasi.'
            : `Konfigurasi Google Service Account / Spreadsheet belum lengkap di environment variable server: ${envStatus.missingEnv.join(', ')}`,
          envStatus.missingEnv,
          {
            requiresGoogleSignIn: envStatus.requiresGoogleSignIn,
            authMode: envStatus.authMode,
            hasServiceAccount: envStatus.hasServiceAccount,
          }
        );
      }

      const action = query.action || req.body?.action;
      if (!action && method === 'GET') {
        if (!token) return JsonResponse.unauthorized('Token sesi tidak ditemukan.');
        const validRes = await authService.validateActiveSession(token);
        if (!validRes.valid) return JsonResponse.unauthorized(validRes.reason);
        return JsonResponse.ok({ valid: true, session: validRes.session });
      }

      if (action === 'login_duty') {
        const password = req.body?.password;
        if (!password) return JsonResponse.badRequest('Password wajib diisi.');
        const result = await authService.loginDuty(password, req.headers['x-forwarded-for'] || 'client');
        if (!result.success) return JsonResponse.badRequest(result.error || 'Password salah', result);
        return JsonResponse.ok(result);
      }

      if (action === 'unlock_homeroom') {
        const { name, password, classId } = req.body || {};
        if (!name || !password) return JsonResponse.badRequest('Nama dan password wali kelas wajib diisi.');
        const result = await authService.unlockHomeroom(name, password, classId, token);
        if (!result.success) return JsonResponse.badRequest(result.error || 'Gagal membuka akses wali kelas');
        return JsonResponse.ok(result);
      }

      if (action === 'unlock_student_affairs') {
        const password = req.body?.password;
        if (!password) return JsonResponse.badRequest('Password wajib diisi.');
        const result = await authService.unlockStudentAffairs(password, token);
        if (!result.success) return JsonResponse.badRequest(result.error || 'Password kesiswaan salah');
        return JsonResponse.ok(result);
      }

      if (action === 'unlock_admin') {
        const password = req.body?.password;
        if (!password) return JsonResponse.badRequest('Password admin wajib diisi.');
        const result = await authService.unlockAdmin(password, token);
        if (!result.success) return JsonResponse.badRequest(result.error || 'Password admin salah');
        return JsonResponse.ok(result);
      }

      if (action === 'verify_session') {
        if (!token) return JsonResponse.unauthorized();
        const validRes = await authService.validateActiveSession(token);
        if (!validRes.valid) {
          return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json' },
            body: { error: validRes.reason || 'Unauthorized', sessionInvalidated: Boolean(validRes.invalidated) },
          };
        }
        return JsonResponse.ok({ valid: true, session: validRes.session });
      }

      if (action === 'refresh_session') {
        if (!token) return JsonResponse.unauthorized();
        const validRes = await authService.validateActiveSession(token);
        if (!validRes.valid || !validRes.session || !validRes.user) {
          return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json' },
            body: { error: validRes.reason || 'Unauthorized', sessionInvalidated: Boolean(validRes.invalidated) },
          };
        }
        const JWT_SECRET = process.env.JWT_SECRET || 'disiplin-kita-bisa-secure-secret-key-2026';
        const refreshed = jwt.sign(
          sanitizePayloadForSigning({
            ...validRes.session,
            userId: validRes.user.id,
            tokenVersion: validRes.user.token_version,
          }),
          JWT_SECRET,
          { expiresIn: '30d' }
        );
        return JsonResponse.ok({ valid: true, token: refreshed, session: validRes.session });
      }

      if (action === 'manage_accounts') {
        const validRes = await authService.validateActiveSession(token);
        if (!validRes.valid || !validRes.session) {
          return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json' },
            body: {
              error: validRes.reason || 'Sesi tidak valid atau telah berakhir.',
              sessionInvalidated: Boolean(validRes.invalidated),
            },
          };
        }

        if (method === 'GET') {
          const users = await sheetsDb.getUsers();
          const safeUsers = users.map((u) => ({
            id: u.id,
            role: u.role,
            name: u.name,
            class_id: u.class_id,
            label: u.label,
            token_version: u.token_version,
            is_active: u.is_active,
            created_at: u.created_at,
          }));
          return JsonResponse.ok({ users: safeUsers });
        }

        if (method === 'POST') {
          const { user, newPassword, targetUserId, targetRole, classId } = req.body;

          if (targetRole && newPassword) {
            if (newPassword.trim().length < 4) {
              return JsonResponse.badRequest('Password baru minimal 4 karakter.');
            }

            const users = await sheetsDb.getUsers();
            let target: any = undefined;
            let refreshedToken: string | undefined = undefined;
            const nowIso = new Date().toISOString();

            if (targetRole === 'admin') {
              target = users.find((u) => u.role === 'admin') || {
                id: 'user_admin_main',
                role: 'admin',
                name: 'Administrator Sekolah',
                label: 'Admin Sistem',
                password_hash: '',
                token_version: 1,
                is_active: true,
                created_at: nowIso,
                updated_at: nowIso,
              };
              target.password_hash = bcrypt.hashSync(newPassword.trim(), 10);
              target.token_version = (target.token_version || 1) + 1;
              target.updated_at = nowIso;
              await sheetsDb.saveUser(target, validRes.session.name);

              const JWT_SECRET = process.env.JWT_SECRET || 'disiplin-kita-bisa-secure-secret-key-2026';
              refreshedToken = jwt.sign(
                sanitizePayloadForSigning({
                  ...validRes.session,
                  tokenVersion: target.token_version,
                }),
                JWT_SECRET,
                { expiresIn: '30d' }
              );
            } else if (targetRole === 'student_affairs') {
              target = users.find((u) => u.role === 'student_affairs') || {
                id: 'user_student_affairs',
                role: 'student_affairs',
                name: 'Bagian Kesiswaan & Tatib',
                label: 'Tim Kesiswaan',
                password_hash: '',
                token_version: 1,
                is_active: true,
                created_at: nowIso,
                updated_at: nowIso,
              };
              target.password_hash = bcrypt.hashSync(newPassword.trim(), 10);
              target.token_version = (target.token_version || 1) + 1;
              target.updated_at = nowIso;
              await sheetsDb.saveUser(target, validRes.session.name);
            } else if (targetRole === 'duty') {
              target = users.find((u) => u.role === 'duty') || {
                id: 'user_duty_main',
                role: 'duty',
                name: 'Petugas Piket Utama',
                label: 'Gerbang Utama & Pos Piket',
                password_hash: '',
                token_version: 1,
                is_active: true,
                created_at: nowIso,
                updated_at: nowIso,
              };
              target.password_hash = bcrypt.hashSync(newPassword.trim(), 10);
              target.token_version = (target.token_version || 1) + 1;
              target.updated_at = nowIso;
              await sheetsDb.saveUser(target, validRes.session.name);
            } else if (targetRole === 'homeroom') {
              const classes = await sheetsDb.getClasses();
              const hash = bcrypt.hashSync(newPassword.trim(), 10);

              if (classId) {
                const targetClass = classes.find((c) => c.id === classId);
                target = users.find((u) => u.role === 'homeroom' && u.class_id === classId) || {
                  id: `user_homeroom_${classId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                  role: 'homeroom',
                  name: targetClass?.homeroom_teacher_name || `Wali Kelas ${classId}`,
                  class_id: classId,
                  email: targetClass?.homeroom_teacher_email,
                  label: `Wali Kelas ${targetClass?.name || classId}`,
                  password_hash: hash,
                  token_version: 1,
                  is_active: true,
                  created_at: nowIso,
                  updated_at: nowIso,
                };
                target.password_hash = hash;
                target.token_version = (target.token_version || 1) + 1;
                target.updated_at = nowIso;
                await sheetsDb.saveUser(target, validRes.session.name);
              } else {
                const homeroomUsers = users.filter((u) => u.role === 'homeroom');
                for (const hr of homeroomUsers) {
                  hr.password_hash = hash;
                  hr.token_version = (hr.token_version || 1) + 1;
                  hr.updated_at = nowIso;
                  await sheetsDb.saveUser(hr, validRes.session.name);
                }

                let masterHr = users.find((u) => u.id === 'user_homeroom_master');
                if (!masterHr) {
                  masterHr = {
                    id: 'user_homeroom_master',
                    role: 'homeroom',
                    name: 'Wali Kelas Umum',
                    label: 'Sandi Bersama Seluruh Wali Kelas',
                    password_hash: hash,
                    token_version: 1,
                    is_active: true,
                    created_at: nowIso,
                    updated_at: nowIso,
                  };
                } else {
                  masterHr.password_hash = hash;
                  masterHr.token_version = (masterHr.token_version || 1) + 1;
                  masterHr.updated_at = nowIso;
                }
                await sheetsDb.saveUser(masterHr, validRes.session.name);
                target = masterHr;
              }
            }

            return JsonResponse.ok({ success: true, user: target, refreshedToken });
          }

          if (targetUserId && newPassword) {
            if (newPassword.trim().length < 4) {
              return JsonResponse.badRequest('Password baru minimal 4 karakter.');
            }
            const users = await sheetsDb.getUsers();
            const target = users.find((u) => u.id === targetUserId);
            if (!target) return JsonResponse.notFound('Akun tidak ditemukan.');

            target.password_hash = bcrypt.hashSync(newPassword.trim(), 10);
            target.token_version = (target.token_version || 1) + 1;
            target.updated_at = new Date().toISOString();

            await sheetsDb.saveUser(target, validRes.session.name);

            let refreshedToken: string | undefined = undefined;
            if (validRes.session.userId === target.id) {
              const JWT_SECRET = process.env.JWT_SECRET || 'disiplin-kita-bisa-secure-secret-key-2026';
              refreshedToken = jwt.sign(
                sanitizePayloadForSigning({
                  ...validRes.session,
                  tokenVersion: target.token_version,
                }),
                JWT_SECRET,
                { expiresIn: '12h' }
              );
            }

            return JsonResponse.ok({ success: true, user: target, refreshedToken });
          }

          if (!user || !user.id || !user.role || !user.name) {
            return JsonResponse.badRequest('Data akun tidak lengkap.');
          }
          const users = await sheetsDb.getUsers();
          const existing = users.find((u) => u.id === user.id);

          if (!existing && (!newPassword || newPassword.trim().length < 4)) {
            return JsonResponse.badRequest('Password minimal 4 karakter untuk akun baru.');
          }

          let passwordHash = existing?.password_hash || '';
          let tokenVersion = existing?.token_version || 1;

          if (newPassword && newPassword.trim().length >= 4) {
            passwordHash = bcrypt.hashSync(newPassword.trim(), 10);
            tokenVersion += 1;
          }

          const updatedUser = {
            ...user,
            password_hash: passwordHash,
            token_version: tokenVersion,
            updated_at: new Date().toISOString(),
          };

          await sheetsDb.saveUser(updatedUser, validRes.session.name);

          let refreshedToken: string | undefined = undefined;
          if (validRes.session.userId === updatedUser.id && newPassword && newPassword.trim().length >= 4) {
            const JWT_SECRET = process.env.JWT_SECRET || 'disiplin-kita-bisa-secure-secret-key-2026';
            refreshedToken = jwt.sign(
              sanitizePayloadForSigning({
                ...validRes.session,
                tokenVersion: updatedUser.token_version,
              }),
              JWT_SECRET,
              { expiresIn: '12h' }
            );
          }

          return JsonResponse.ok({ success: true, user: updatedUser, refreshedToken });
        }

        if (method === 'DELETE') {
          const { id } = req.body;
          if (id === 'user_admin_main') {
            return JsonResponse.badRequest('Akun admin utama tidak boleh dihapus.');
          }
          await sheetsDb.deleteUser(id, validRes.session.name);
          return JsonResponse.ok({ success: true });
        }
      }

      return JsonResponse.badRequest('Aksi auth tidak dikenali.');
    }

    // 4. DIRECT READ FROM GOOGLE SHEETS: GET /api/sync
    if (pathname === '/api/sync') {
      if (method !== 'GET') {
        return JsonResponse.badRequest('Endpoint /api/sync hanya mendukung GET untuk membaca data langsung dari Google Sheets.');
      }

      const envStatus = sheetsDb.getFullEnvStatus();
      if (!envStatus.sheetsConfigured) {
        return JsonResponse.serviceUnavailable(
          envStatus.requiresGoogleSignIn
            ? 'Hubungkan akun Google Anda untuk menyinkronkan data Google Sheets.'
            : `Konfigurasi Google Service Account / Spreadsheet belum lengkap di environment variable server: ${envStatus.missingEnv.join(', ')}`,
          envStatus.missingEnv,
          {
            requiresGoogleSignIn: envStatus.requiresGoogleSignIn,
            authMode: envStatus.authMode,
            hasServiceAccount: envStatus.hasServiceAccount,
          }
        );
      }
      const db = await sheetsDb.getFullDatabase();
      const emailStatus = notificationService.getEmailTransportStatus();

      return JsonResponse.ok(
        {
          fullSnapshot: true,
          configured: envStatus.configured,
          sheetsConfigured: envStatus.sheetsConfigured,
          driveConfigured: envStatus.driveConfigured,
          spreadsheetConfigured: envStatus.spreadsheetConfigured,
          driveFolderConfigured: envStatus.driveFolderConfigured,
          hasServiceAccount: envStatus.hasServiceAccount,
          authMode: envStatus.authMode,
          requiresGoogleSignIn: envStatus.requiresGoogleSignIn,
          emailConnected: emailStatus.connected,
          emailTransport: emailStatus.transport,
          savedAppsScriptUrl: getSavedAppsScriptUrl() || undefined,
          missingEnv: envStatus.missingEnv,
          serverTime: new Date().toISOString(),
          data: {
            students: db.students,
            classes: db.classes,
            sessions: db.sessions,
            attendance: db.attendance,
            out_of_class: db.out_of_class,
            violations: db.violations,
            violation_types: db.violation_types,
            leave_requests: db.leave_requests,
            settings: db.settings,
            notification_settings: db.notification_settings,
            notification_logs: db.notification_logs,
            audit_logs: db.audit_logs,
          },
        },
        {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        }
      );
    }

    // 5. STATELESS ATTENDANCE: /api/attendance
    if (pathname === '/api/attendance') {
      if (method === 'GET') {
        const records = await sheetsDb.getAttendance();
        return JsonResponse.ok({ records, serverTime: new Date().toISOString() });
      }

      if (method === 'POST') {
        const incomingScans: any[] = Array.isArray(req.body?.scans)
          ? req.body.scans
          : [req.body];

        if (incomingScans.length === 0) {
          return JsonResponse.badRequest('Tidak ada data scan presensi untuk diproses.');
        }

        const db = await sheetsDb.getFullDatabase();
        const serverNow = new Date();
        const currentDateStr = serverNow.toISOString().split('T')[0];
        const autoSwitchEnabled = db.settings.auto_session_switch !== false;

        const validRes = token ? await authService.validateActiveSession(token) : { valid: false, session: undefined };
        const actorName = validRes.valid ? validRes.session?.name || 'Petugas Piket' : 'Sistem Presensi';

        const preparedRecords: AttendanceRecord[] = [];
        const resolvedStudentsByRecordId = new Map<string, any>();
        const resolvedSessionByRecordId = new Map<string, any>();
        const immediateRejections: { code?: string; studentId?: string; message: string; isDuplicate?: boolean }[] = [];

        for (const item of incomingScans) {
          const {
            code,
            studentId,
            sessionId,
            status,
            notes,
            method: attMethod,
            deviceId,
            manualOverride,
            photoBase64,
            photoFileName,
          } = item || {};

          let student = null;
          if (code) {
            const clean = String(code).trim().toLowerCase();
            student = db.students.find(
              (s) =>
                s.nis.toLowerCase() === clean ||
                s.rfid_uid.toLowerCase() === clean ||
                s.card_code.toLowerCase() === clean
            );
          } else if (studentId) {
            student = db.students.find((s) => s.nis === String(studentId).trim());
          }

          if (!student) {
            immediateRejections.push({
              code,
              studentId,
              message: `Kartu atau NIS "${code || studentId || '-'}" tidak terdaftar dalam database siswa.`,
            });
            continue;
          }

          const scheduleState = resolveSessionSchedule(
            db.sessions,
            serverNow,
            autoSwitchEnabled,
            manualOverride ? sessionId : undefined
          );

          let session = undefined;
          if (manualOverride && sessionId) {
            session = db.sessions.find((s) => s.id === sessionId);
          } else if (autoSwitchEnabled && scheduleState.liveWindowSession) {
            session = scheduleState.liveWindowSession;
          } else if (sessionId) {
            session = db.sessions.find((s) => s.id === sessionId && s.is_active);
          }
          const activeSession = session || scheduleState.activeSession || db.sessions.find((s) => s.is_active) || db.sessions[0];

          const activeLeave = db.leave_requests.find(
            (l) =>
              l.student_id === student!.nis &&
              l.status === 'approved' &&
              currentDateStr >= l.start_date &&
              currentDateStr <= l.end_date
          );

          if (activeLeave && !status) {
            immediateRejections.push({
              code,
              studentId: student.nis,
              message: `Siswa ${student.name} berstatus ${activeLeave.type.toUpperCase()} hari ini: ${activeLeave.reason}`,
            });
            continue;
          }

          let attStatus = status || 'Hadir';
          let lateMinutes = 0;

          if (!status && activeSession?.on_time_limit) {
            const [limitH, limitM] = activeSession.on_time_limit.split(':').map(Number);
            const curMinTotal = serverNow.getHours() * 60 + serverNow.getMinutes();
            const limitMinTotal = (limitH || 0) * 60 + (limitM || 0);
            const diffMinutes = curMinTotal - limitMinTotal;

            if (diffMinutes > 0) {
              lateMinutes = diffMinutes;
              attStatus = 'Terlambat';
            }
          }

          let photoId = '';
          if (photoBase64) {
            photoId = await sheetsDb.uploadPhotoToDrive(
              photoBase64,
              photoFileName || `presensi_${student.nis}_${Date.now()}.jpg`
            );
          }

          const nowIso = serverNow.toISOString();
          const recordId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const record: AttendanceRecord = {
            id: recordId,
            student_id: student.nis,
            session_id: activeSession.id,
            date: currentDateStr,
            timestamp: nowIso,
            status: attStatus,
            late_minutes: lateMinutes,
            method: attMethod || (String(code || '').startsWith('RFID-') ? 'rfid' : 'barcode'),
            device_id: deviceId || 'kiosk_main',
            photo_id: photoId,
            notes: notes || '',
            version: 1,
            created_at: nowIso,
            updated_at: nowIso,
            diubah_pada: nowIso,
          };

          preparedRecords.push(record);
          resolvedStudentsByRecordId.set(recordId, student);
          resolvedSessionByRecordId.set(recordId, activeSession);
        }

        const { saved, rejectedDuplicates } = await sheetsDb.appendAttendanceBatch(
          preparedRecords,
          actorName
        );

        // Send notifications for saved late/alpha scans
        for (const rec of saved) {
          if (rec.status === 'Terlambat' || rec.status === 'Alpha') {
            const student = resolvedStudentsByRecordId.get(rec.id);
            if (student) {
              notificationService
                .notifyParent({
                  student,
                  triggerType: rec.status === 'Terlambat' ? 'terlambat' : 'alpha',
                  status: `${rec.status} (${rec.late_minutes} menit)`,
                })
                .catch(console.error);
            }
          }
        }

        const allRejections = [
          ...immediateRejections,
          ...rejectedDuplicates.map((d) => ({
            studentId: d.student_id,
            isDuplicate: true,
            message: d.reason,
          })),
        ];

        // If single scan request and rejected
        if (!Array.isArray(req.body?.scans)) {
          if (saved.length === 0 && allRejections.length > 0) {
            return JsonResponse.badRequest(allRejections[0].message, {
              isDuplicate: Boolean(allRejections[0].isDuplicate),
              student: preparedRecords[0]
                ? resolvedStudentsByRecordId.get(preparedRecords[0].id)
                : undefined,
            });
          }
          const singleRec = saved[0];
          return JsonResponse.ok({
            success: true,
            record: singleRec,
            student: resolvedStudentsByRecordId.get(singleRec.id),
            session: resolvedSessionByRecordId.get(singleRec.id),
            serverTime: serverNow.toISOString(),
          });
        }

        return JsonResponse.ok({
          success: true,
          savedCount: saved.length,
          rejectedCount: allRejections.length,
          results: saved.map((rec) => ({
            record: rec,
            student: resolvedStudentsByRecordId.get(rec.id),
            session: resolvedSessionByRecordId.get(rec.id),
          })),
          rejectedDuplicates: allRejections,
          serverTime: serverNow.toISOString(),
        });
      }

      if (method === 'PUT') {
        const { id, updates, reason, expected_updated_at, forceOverwrite } = req.body;
        const validRes = await authService.validateActiveSession(token);
        if (!validRes.valid) return JsonResponse.unauthorized();
        const updated = await sheetsDb.updateAttendance(
          id,
          updates,
          validRes.session?.name || 'Petugas',
          reason || 'Koreksi presensi',
          expected_updated_at,
          Boolean(forceOverwrite)
        );
        if (!updated) return JsonResponse.notFound('Data presensi tidak ditemukan.');
        return JsonResponse.ok({ success: true, record: updated });
      }

      if (method === 'DELETE') {
        const { id, reason } = req.body;
        const validRes = await authService.validateActiveSession(token);
        if (!validRes.valid) return JsonResponse.unauthorized();
        const success = await sheetsDb.deleteAttendance(
          id,
          validRes.session?.name || 'Petugas',
          reason || 'Pembatalan presensi'
        );
        return JsonResponse.ok({ success });
      }
    }

    // 6. OUT OF CLASS: /api/out-of-class
    if (pathname === '/api/out-of-class') {
      if (method === 'GET') {
        await sheetsDb.autoCloseOverdueOutOfClass();
        const records = await sheetsDb.getOutOfClass();
        return JsonResponse.ok({ records });
      }

      if (method === 'POST') {
        const { studentId, type, durationMinutes, idempotencyKey } = req.body;
        if (!studentId || !type || !durationMinutes) {
          return JsonResponse.badRequest('Data izin keluar tidak lengkap.');
        }

        const students = await sheetsDb.getStudents();
        const student = students.find((s) => s.nis === studentId);
        if (!student) {
          return JsonResponse.badRequest('Siswa tidak ditemukan.');
        }

        const validRes = token ? await authService.validateActiveSession(token) : { valid: false, session: undefined };
        const actorName = validRes.valid ? validRes.session?.name || 'Petugas Piket' : 'Petugas Piket';

        const now = new Date();
        const due = new Date(now.getTime() + durationMinutes * 60 * 1000);

        const newRecord = {
          id: `ooc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          student_id: student.nis,
          class_id: student.class_id,
          type,
          duration_minutes: durationMinutes,
          started_at: now.toISOString(),
          due_at: due.toISOString(),
          late_return_minutes: 0,
          status: 'active' as const,
          idempotency_key: idempotencyKey || `key_${Date.now()}`,
          version: 1,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        };

        const result = await sheetsDb.startOutOfClass(newRecord, actorName);
        if (!result.success) {
          return JsonResponse.badRequest(result.error || 'Gagal memulai izin keluar.');
        }

        return JsonResponse.ok({ success: true, record: result.record, student });
      }

      if (method === 'PUT') {
        const { id, returnMethod, notes, auditReason, expected_updated_at, forceOverwrite } = req.body;
        const validRes = await authService.validateActiveSession(token);
        const result = await sheetsDb.confirmOutOfClassReturn(
          id,
          returnMethod || 'click',
          notes,
          validRes.valid ? validRes.session?.name || 'Petugas Piket' : 'Petugas Piket',
          auditReason,
          expected_updated_at,
          Boolean(forceOverwrite)
        );

        if (!result.success) {
          return JsonResponse.badRequest(result.error || 'Gagal mengonfirmasi kepulangan.');
        }

        if (result.record && result.record.late_return_minutes > 0) {
          const students = await sheetsDb.getStudents();
          const student = students.find((s) => s.nis === result.record!.student_id);
          if (student) {
            notificationService
              .notifyParent({
                student,
                triggerType: 'melebihi_waktu',
                status: `Melebihi Waktu Izin Keluar (+${result.record.late_return_minutes} menit)`,
                lateReturnMinutes: result.record.late_return_minutes,
              })
              .catch(console.error);
          }
        }

        return JsonResponse.ok({
          success: true,
          alreadyReturned: result.alreadyReturned,
          record: result.record,
        });
      }
    }

    // 7. VIOLATIONS: /api/violations
    if (pathname === '/api/violations') {
      if (method === 'GET') {
        const violations = await sheetsDb.getViolations();
        const types = await sheetsDb.getViolationTypes();
        return JsonResponse.ok({ violations, types });
      }

      if (method === 'POST') {
        const {
          studentId,
          violationTypeId,
          customPoints,
          notes,
          location,
          evidenceBase64,
          evidenceFileName,
        } = req.body;

        const students = await sheetsDb.getStudents();
        const student = students.find((s) => s.nis === studentId);
        if (!student) return JsonResponse.badRequest('Siswa tidak ditemukan.');

        const types = await sheetsDb.getViolationTypes();
        const vtype = types.find((t) => t.id === violationTypeId);
        if (!vtype) return JsonResponse.badRequest('Jenis pelanggaran tidak valid.');

        let evidencePhotoId = '';
        if (evidenceBase64) {
          evidencePhotoId = await sheetsDb.uploadPhotoToDrive(
            evidenceBase64,
            evidenceFileName || `bukti_${student.nis}_${Date.now()}.jpg`
          );
        }

        const validRes = await authService.validateActiveSession(token);
        const recordedBy = validRes.valid ? validRes.session?.name || 'Petugas' : 'Petugas';
        const nowIso = new Date().toISOString();

        const record = {
          id: `vio_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          student_id: student.nis,
          class_id: student.class_id,
          violation_type_id: vtype.id,
          type_name: vtype.name,
          category: vtype.category,
          points: customPoints !== undefined ? Number(customPoints) : vtype.default_points,
          notes: notes || '',
          location: location || '',
          evidence_photo_url: evidencePhotoId,
          recorded_by: recordedBy,
          recorded_at: nowIso,
          version: 1,
          created_at: nowIso,
          updated_at: nowIso,
        };

        const saved = await sheetsDb.recordViolation(record, recordedBy);

        const allVios = await sheetsDb.getViolations();
        const studentVios = allVios.filter((v) => v.student_id === student.nis);
        const totalPoints = studentVios.reduce(
          (acc, curr) => acc + (curr.category === 'prestasi' ? -curr.points : curr.points),
          0
        );

        notificationService
          .notifyParent({
            student,
            triggerType: 'pelanggaran',
            status: `Pelanggaran: ${vtype.name}`,
            violationName: vtype.name,
            points: record.points,
          })
          .catch(console.error);

        const notifSettings = await sheetsDb.getNotificationSettings();
        const threshold = notifSettings?.warning_threshold_points ?? 25;
        if (totalPoints >= threshold && vtype.category !== 'prestasi') {
          notificationService
            .notifyParent({
              student,
              triggerType: 'ambang_peringatan',
              status: `Poin Pelanggaran Mencapai Ambang Batas SP (${totalPoints} poin)`,
              violationName: vtype.name,
              points: totalPoints,
            })
            .catch(console.error);
        }

        return JsonResponse.ok({
          success: true,
          violation: saved,
          studentTotalPoints: totalPoints,
        });
      }

      if (method === 'DELETE') {
        const { id, reason } = req.body;
        const validRes = await authService.validateActiveSession(token);
        if (!validRes.valid) return JsonResponse.unauthorized();
        const success = await sheetsDb.deleteViolation(
          id,
          validRes.session?.name || 'Admin',
          reason || 'Koreksi pelanggaran'
        );
        return JsonResponse.ok({ success });
      }
    }

    // 8. VIOLATION TYPES CRUD: /api/violation-types
    if (pathname === '/api/violation-types') {
      if (method === 'GET') {
        const types = await sheetsDb.getViolationTypes();
        return JsonResponse.ok({ types });
      }

      const validRes = await authService.validateActiveSession(token);
      if (!validRes.valid) return JsonResponse.unauthorized();

      if (method === 'POST') {
        const vtype = req.body;
        if (!vtype.name || !vtype.code || !vtype.category) {
          return JsonResponse.badRequest('Nama, kode, dan kategori wajib diisi.');
        }
        if (!vtype.id) vtype.id = `vt_${Date.now()}`;
        const saved = await sheetsDb.saveViolationType(vtype, validRes.session?.name || 'Admin');
        return JsonResponse.ok({ success: true, violationType: saved });
      }

      if (method === 'DELETE') {
        const { id } = req.body;
        await sheetsDb.deleteViolationType(id, validRes.session?.name || 'Admin');
        return JsonResponse.ok({ success: true });
      }
    }

    // 9. STUDENTS: /api/students
    if (pathname === '/api/students') {
      if (method === 'GET') {
        const students = await sheetsDb.getStudents();
        const action = query.action;

        if (action === 'template') {
          const classes = await sheetsDb.getClasses();
          const classNames = classes.map((c) => c.id).join(', ');
          const wb = XLSX.utils.book_new();
          const sampleData = [
            {
              NIS: '20261011',
              NISN: '0081234011',
              Nama: 'Muhammad Faiz',
              Kelas: classes[0]?.id || '10-RPL-1',
              Jenis_Kelamin: 'L',
              UID_RFID: 'RFID-8821911',
              Nama_Orang_Tua: 'Bambang Faiz',
              Email_Orang_Tua: 'faiz.parent@example.com',
            },
            {
              NIS: '20261012',
              NISN: '0081234012',
              Nama: 'Nadia Putri',
              Kelas: classes[0]?.id || '10-RPL-1',
              Jenis_Kelamin: 'P',
              UID_RFID: 'RFID-8821912',
              Nama_Orang_Tua: 'Rudi Hermanto',
              Email_Orang_Tua: 'nadia.parent@example.com',
            },
          ];

          const wsData = XLSX.utils.json_to_sheet(sampleData);
          XLSX.utils.book_append_sheet(wb, wsData, 'Data Siswa');

          const instructions = [
            { Kolom: 'NIS', Keterangan: 'Nomor Induk Siswa (Wajib, Unik, angka/teks)', Contoh: '20261011' },
            { Kolom: 'NISN', Keterangan: 'Nomor Induk Siswa Nasional (Opsional)', Contoh: '0081234011' },
            { Kolom: 'Nama', Keterangan: 'Nama Lengkap Siswa (Wajib)', Contoh: 'Muhammad Faiz' },
            { Kolom: 'Kelas', Keterangan: `ID Kelas terdaftar (${classNames})`, Contoh: classes[0]?.id || '10-RPL-1' },
            { Kolom: 'Jenis_Kelamin', Keterangan: 'L (Laki-laki) atau P (Perempuan)', Contoh: 'L' },
            { Kolom: 'UID_RFID', Keterangan: 'Kode UID kartu RFID / Barcode (Wajib unik)', Contoh: 'RFID-8821911' },
            { Kolom: 'Nama_Orang_Tua', Keterangan: 'Nama Orang Tua / Wali', Contoh: 'Bambang Faiz' },
            { Kolom: 'Email_Orang_Tua', Keterangan: 'Alamat email aktif untuk notifikasi presensi & kedisiplinan', Contoh: 'faiz.parent@example.com' },
          ];
          const wsInstructions = XLSX.utils.json_to_sheet(instructions);
          XLSX.utils.book_append_sheet(wb, wsInstructions, 'Petunjuk Format');

          const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition': 'attachment; filename="template_siswa_disiplin_kita_bisa.xlsx"',
            },
            body: buf,
          };
        }

        return JsonResponse.ok({ students });
      }

      const validRes = await authService.validateActiveSession(token);
      if (!validRes.valid) return JsonResponse.unauthorized();
      const actorName = validRes.session?.name || 'Admin';

      if (method === 'POST') {
        const action = query.action;
        if (action === 'batch_import') {
          const { students: incomingStudents } = req.body;
          if (!Array.isArray(incomingStudents) || incomingStudents.length === 0) {
            return JsonResponse.badRequest('Daftar siswa kosong.');
          }
          const result = await sheetsDb.batchSaveStudents(incomingStudents, actorName);
          return JsonResponse.ok({ success: true, ...result });
        }

        const student = req.body;
        if (!student.nis || !student.name || !student.class_id) {
          return JsonResponse.badRequest('NIS, Nama, dan Kelas wajib diisi.');
        }

        if (student.photoBase64) {
          student.photo_url = await sheetsDb.uploadPhotoToDrive(
            student.photoBase64,
            `siswa_${student.nis}_${Date.now()}.jpg`
          );
          delete student.photoBase64;
        }

        const saved = await sheetsDb.saveStudent(student, actorName);
        return JsonResponse.ok({ success: true, student: saved });
      }

      if (method === 'DELETE') {
        const { nis, nisses, action } = req.body || {};
        if (action === 'clear_all') {
          const count = await sheetsDb.clearAllStudents(actorName);
          return JsonResponse.ok({ success: true, count, message: `${count} data siswa berhasil dihapus.` });
        }
        if (Array.isArray(nisses) && nisses.length > 0) {
          const count = await sheetsDb.deleteStudents(nisses, actorName);
          return JsonResponse.ok({ success: true, count, message: `${count} siswa berhasil dihapus.` });
        }
        if (nis) {
          const success = await sheetsDb.deleteStudent(nis, actorName);
          return JsonResponse.ok({ success });
        }
        return JsonResponse.badRequest('Parameter nis, nisses, atau action diperlukan.');
      }
    }

    // 10. CLASSES & SESSIONS CRUD
    if (pathname === '/api/classes') {
      if (method === 'GET') {
        const classes = await sheetsDb.getClasses();
        return JsonResponse.ok({ classes });
      }
      const validRes = await authService.validateActiveSession(token);
      if (!validRes.valid) return JsonResponse.unauthorized();
      const actorName = validRes.session?.name || 'Admin';

      if (method === 'POST') {
        const cls = await sheetsDb.saveClass(req.body, actorName);
        try {
          const users = await sheetsDb.getUsers();
          const homeroomUser = users.find((u) => u.role === 'homeroom' && u.class_id === cls.id);
          if (homeroomUser) {
            let changed = false;
            if (cls.homeroom_teacher_name && homeroomUser.name !== cls.homeroom_teacher_name) {
              homeroomUser.name = cls.homeroom_teacher_name;
              changed = true;
            }
            if (cls.homeroom_teacher_email && homeroomUser.email !== cls.homeroom_teacher_email) {
              homeroomUser.email = cls.homeroom_teacher_email;
              changed = true;
            }
            if (changed) {
              await sheetsDb.saveUser(homeroomUser, actorName);
            }
          }
        } catch (e) {
          console.error('[API Classes] Error syncing homeroom user:', e);
        }
        return JsonResponse.ok({ success: true, class: cls });
      }

      if (method === 'DELETE') {
        const idToDelete = req.body?.id || query.id;
        if (idToDelete) await sheetsDb.deleteClass(idToDelete, actorName);
        return JsonResponse.ok({ success: true });
      }
    }

    if (pathname === '/api/sessions') {
      if (method === 'GET') {
        const sessions = await sheetsDb.getSessions();
        return JsonResponse.ok({ sessions });
      }
      const validRes = await authService.validateActiveSession(token);
      if (!validRes.valid) return JsonResponse.unauthorized();
      const actorName = validRes.session?.name || 'Admin';

      if (method === 'POST') {
        const session = await sheetsDb.saveSession(req.body, actorName);
        return JsonResponse.ok({ success: true, session });
      }
      if (method === 'DELETE') {
        const idToDelete = req.body?.id || query.id;
        if (idToDelete) await sheetsDb.deleteSession(idToDelete, actorName);
        return JsonResponse.ok({ success: true });
      }
    }

    // 11. SETTINGS
    if (pathname === '/api/settings') {
      if (method === 'GET') {
        const settings = await sheetsDb.getSettings();
        return JsonResponse.ok({ settings });
      }
      const validRes = await authService.validateActiveSession(token);
      if (!validRes.valid) return JsonResponse.unauthorized();
      const body = { ...(req.body || {}) };
      if (body.logoBase64) {
        body.logo_url = await sheetsDb.uploadPhotoToDrive(
          body.logoBase64,
          `logo_sekolah_${Date.now()}.jpg`
        );
        delete body.logoBase64;
      }
      const updated = await sheetsDb.updateSettings(body, validRes.session?.name || 'Admin');
      return JsonResponse.ok({ success: true, settings: updated });
    }

    // 12. NOTIFICATIONS & TEST EMAIL
    if (pathname === '/api/notifications') {
      if (method === 'GET') {
        const settings = await sheetsDb.getNotificationSettings();
        const logs = await sheetsDb.getNotificationLogs();
        const emailStatus = notificationService.getEmailTransportStatus();
        return JsonResponse.ok({
          settings,
          logs,
          emailConnected: emailStatus.connected,
          emailTransport: emailStatus.transport,
        });
      }

      const cleanToken = token && token !== 'undefined' && token !== 'null' ? token : '';
      let actorName = 'Admin';
      if (cleanToken) {
        const validRes = await authService.validateActiveSession(cleanToken);
        if (!validRes.valid && validRes.reason === 'Session invalidated by password or account change') {
          return JsonResponse.unauthorized(validRes.reason);
        }
        if (validRes.valid && validRes.session?.name) {
          actorName = validRes.session.name;
        }
      }

      if (query.action === 'test_email') {
        const { email } = req.body || {};
        if (!email) return JsonResponse.badRequest('Email tujuan wajib diisi.');
        const result = await notificationService.sendTestEmail(email);
        return JsonResponse.ok(result);
      }

      if (query.action === 'send_weekly_recap') {
        const { classId } = req.body || {};
        const result = classId
          ? await notificationService.sendWeeklyHomeroomRecap(classId)
          : await notificationService.sendAllWeeklyRecaps();
        return JsonResponse.ok(result);
      }

      const updated = await sheetsDb.updateNotificationSettings(req.body || {}, actorName);
      return JsonResponse.ok({ success: true, settings: updated });
    }

    // 13. LEAVE REQUESTS
    if (pathname === '/api/leave-requests') {
      if (method === 'GET') {
        const requests = await sheetsDb.getLeaveRequests();
        return JsonResponse.ok({ requests });
      }

      if (method === 'POST') {
        const nowIso = new Date().toISOString();
        const newReq = {
          id: `lr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          ...req.body,
          status: 'pending' as const,
          created_at: nowIso,
          updated_at: nowIso,
        };
        const saved = await sheetsDb.saveLeaveRequest(newReq, 'Pengaju Izin');
        return JsonResponse.ok({ success: true, request: saved });
      }

      if (method === 'PUT') {
        const validRes = await authService.validateActiveSession(token);
        if (!validRes.valid) return JsonResponse.unauthorized();

        const { id, status, rejectionReason, expected_updated_at, forceOverwrite } = req.body;
        const requests = await sheetsDb.getLeaveRequests();
        const existing = requests.find((r) => r.id === id);
        if (!existing) return JsonResponse.notFound('Pengajuan izin tidak ditemukan.');

        const updatedPayload = {
          ...existing,
          status,
          approved_by: validRes.session?.name,
          approved_at: new Date().toISOString(),
          ...(rejectionReason ? { rejection_reason: rejectionReason } : {}),
          expected_updated_at,
          forceOverwrite,
        };

        const saved = await sheetsDb.saveLeaveRequest(
          updatedPayload,
          validRes.session?.name || 'Wali Kelas'
        );

        if (status === 'approved') {
          const students = await sheetsDb.getStudents();
          const student = students.find((s) => s.nis === existing.student_id);
          if (student) {
            notificationService
              .notifyParent({
                student,
                triggerType: 'izin_sakit',
                status: `Izin / Sakit Disetujui (${existing.type}: ${existing.start_date} s/d ${existing.end_date})`,
                customDetails: existing.reason,
              })
              .catch(console.error);
          }
        }

        return JsonResponse.ok({ success: true, request: saved });
      }
    }

    // 14. AUDIT LOGS (FROM 'Log' SHEET): /api/audit
    if (pathname === '/api/audit') {
      const logs = await sheetsDb.getAuditLogs();
      return JsonResponse.ok({ logs });
    }

    // 15. SELF-TEST SIMULATION
    if (pathname === '/api/simulate') {
      const { testType } = req.body || {};
      const students = await sheetsDb.getStudents();
      const sessions = await sheetsDb.getSessions();
      const targetStudent = students[0];
      const targetSession = sessions[0];
      if (!targetStudent || !targetSession) {
        return JsonResponse.badRequest('Data siswa atau sesi masih kosong di Google Sheets.');
      }

      if (testType === 'duplicate_attendance') {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const res = await sheetsDb.appendAttendanceBatch([
          {
            id: `att_sim_1_${Date.now()}`,
            student_id: targetStudent.nis,
            session_id: targetSession.id,
            date: dateStr,
            timestamp: now.toISOString(),
            status: 'Hadir',
            late_minutes: 0,
            method: 'rfid',
            device_id: 'device_gate_1',
            version: 1,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
          {
            id: `att_sim_2_${Date.now()}`,
            student_id: targetStudent.nis,
            session_id: targetSession.id,
            date: dateStr,
            timestamp: now.toISOString(),
            status: 'Hadir',
            late_minutes: 0,
            method: 'barcode',
            device_id: 'device_gate_2',
            version: 1,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
        ]);
        return JsonResponse.ok({
          test: 'duplicate_attendance',
          saved: res.saved.length,
          rejectedDuplicates: res.rejectedDuplicates,
          conclusion:
            res.rejectedDuplicates.length > 0
              ? 'SUKSES: Hanya satu presensi yang diterima, duplikat hari yang sama berhasil ditolak.'
              : 'Simulasi selesai.',
        });
      }

      if (testType === 'out_of_class_quota_race') {
        const classStudents = students.filter((s) => s.class_id === targetStudent.class_id);
        const s1 = classStudents[0];
        const s2 = classStudents[1] || students[1] || s1;
        const r1 = await sheetsDb.startOutOfClass({
          id: `ooc_sim_1_${Date.now()}`,
          student_id: s1.nis,
          class_id: s1.class_id,
          type: 'BAK',
          duration_minutes: 5,
          started_at: new Date().toISOString(),
          due_at: new Date(Date.now() + 5 * 60000).toISOString(),
          late_return_minutes: 0,
          status: 'active',
          idempotency_key: `key_sim_1_${Date.now()}`,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        const r2 = await sheetsDb.startOutOfClass({
          id: `ooc_sim_2_${Date.now()}`,
          student_id: s2.nis,
          class_id: s2.class_id,
          type: 'BAB',
          duration_minutes: 10,
          started_at: new Date().toISOString(),
          due_at: new Date(Date.now() + 10 * 60000).toISOString(),
          late_return_minutes: 0,
          status: 'active',
          idempotency_key: `key_sim_2_${Date.now()}`,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return JsonResponse.ok({
          test: 'out_of_class_quota_race',
          req1: { success: r1.success, error: r1.error },
          req2: { success: r2.success, error: r2.error },
          conclusion: 'Pengujian kuota kelas langsung ke Google Sheets selesai dievaluasi.',
        });
      }

      return JsonResponse.badRequest('Jenis pengujian tidak valid.');
    }

    return JsonResponse.notFound(`Endpoint ${pathname} tidak ditemukan.`);
  } catch (err: any) {
    if (
      err instanceof SheetsConfigError ||
      err instanceof GoogleAuthExpiredError ||
      err instanceof ConflictError
    ) {
      return JsonResponse.serverError(err);
    }
    console.error(`[API ERROR] ${method} ${pathname}:`, err);
    return JsonResponse.serverError(err);
  }
  });
}
