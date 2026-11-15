import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { writeQueue } from './queue.ts';
import { buildSessionRecapData } from './sessionHelper.ts';

const IS_VERCEL_SHEETS = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);
const SHEETS_DATA_DIR = IS_VERCEL_SHEETS ? path.join('/tmp', 'dkb_data') : path.resolve(process.cwd(), '.data');
const OAUTH_SESSION_FILE = path.join(SHEETS_DATA_DIR, 'oauth_session.json');

/**
 * Google Sheets API Integration with Service Account credentials
 */

export class GoogleSheetsClient {
  private sheetsService: any = null;
  private driveService: any = null;
  private spreadsheetId: string = '';
  private driveFolderId: string = '';
  private isConfigured: boolean = false;

  constructor() {
    this.init();
  }

  private loadPersistedOAuthSession(): void {
    try {
      if (!fs.existsSync(OAUTH_SESSION_FILE)) return;
      const raw = fs.readFileSync(OAUTH_SESSION_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.accessToken && typeof parsed.expiresAt === 'number') {
        if (Date.now() < parsed.expiresAt - 30000) {
          this.oauthAccessToken = parsed.accessToken;
          this.oauthExpiresAt = parsed.expiresAt;
          this.oauthEmail = parsed.email || '';
          this.oauthTokenExpired = false;
        } else {
          this.oauthAccessToken = '';
          this.oauthExpiresAt = 0;
          this.oauthEmail = parsed.email || '';
          this.oauthTokenExpired = true;
        }
      }
    } catch {
      // Ignore corrupt or unavailable oauth_session cache
    }
  }

  private savePersistedOAuthSession(): void {
    try {
      if (!fs.existsSync(SHEETS_DATA_DIR)) {
        fs.mkdirSync(SHEETS_DATA_DIR, { recursive: true });
      }
      const tmp = `${OAUTH_SESSION_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          accessToken: this.oauthAccessToken,
          expiresAt: this.oauthExpiresAt,
          email: this.oauthEmail,
          updatedAt: new Date().toISOString(),
        }),
        'utf-8'
      );
      fs.renameSync(tmp, OAUTH_SESSION_FILE);
    } catch (err) {
      console.warn('[GoogleSheetsClient] Failed to persist OAuth session:', err);
    }
  }

  private removePersistedOAuthSession(): void {
    try {
      if (fs.existsSync(OAUTH_SESSION_FILE)) {
        fs.unlinkSync(OAUTH_SESSION_FILE);
      }
    } catch {}
  }

  private init() {
    this.loadPersistedOAuthSession();

    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY;
    this.spreadsheetId = process.env.SPREADSHEET_ID || '';
    this.driveFolderId = process.env.DRIVE_FOLDER_ID || '';

    if (email && rawKey) {
      try {
        const privateKey = rawKey.replace(/\\n/g, '\n');
        const auth = new google.auth.JWT({
          email,
          key: privateKey,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
          ],
        });

        this.sheetsService = google.sheets({ version: 'v4', auth });
        this.driveService = google.drive({ version: 'v3', auth });
        this.isConfigured = true;
        console.log('[GoogleSheetsClient] Initialized successfully with Service Account:', email);
      } catch (err) {
        console.error('[GoogleSheetsClient] Failed to initialize Google Auth:', err);
        this.isConfigured = false;
      }
    } else {
      this.isConfigured = false;
    }
  }

  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private driveBackupFileId: string = '';
  private oauthAccessToken: string = '';
  private oauthExpiresAt: number = 0;
  private oauthEmail: string = '';
  private oauthTokenExpired: boolean = false;

  get isConnected(): boolean {
    return this.isConfigured || this.hasValidOAuthToken();
  }

  get isOAuthExpired(): boolean {
    return this.oauthTokenExpired;
  }

  get sheetId(): string {
    return this.spreadsheetId;
  }

  public hasValidOAuthToken(): boolean {
    if (!this.oauthAccessToken) return false;
    if (this.oauthExpiresAt > 0 && Date.now() >= this.oauthExpiresAt - 30000) {
      this.oauthAccessToken = '';
      this.oauthExpiresAt = 0;
      this.oauthTokenExpired = true;
      return false;
    }
    return true;
  }

  public setOAuthSession(accessToken: string, expiresInSeconds?: number, email?: string): void {
    const clean = (accessToken || '').trim();
    if (!clean) return;
    this.oauthAccessToken = clean;
    const ttl = typeof expiresInSeconds === 'number' && expiresInSeconds > 120 ? expiresInSeconds : 3500;
    this.oauthExpiresAt = Date.now() + ttl * 1000;
    this.oauthEmail = email || this.oauthEmail;
    this.oauthTokenExpired = false;
    this.savePersistedOAuthSession();
  }

  public clearOAuthSession(): void {
    this.oauthAccessToken = '';
    this.oauthExpiresAt = 0;
    this.oauthEmail = '';
    this.oauthTokenExpired = false;
    this.removePersistedOAuthSession();
  }

  /**
   * Read rows from a sheet
   */
  async readRows(sheetName: string, targetSheetId?: string): Promise<string[][]> {
    const sid = targetSheetId || this.spreadsheetId;
    if (!this.isConfigured || !this.sheetsService || !sid) {
      throw new Error('Google Sheets not configured');
    }

    const response = await this.sheetsService.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `${sheetName}!A:Z`,
    });

    return response.data.values || [];
  }

  /**
   * Append rows to a sheet with writeQueue
   */
  async appendRows(sheetName: string, rows: any[][], targetSheetId?: string): Promise<void> {
    const sid = targetSheetId || this.spreadsheetId;
    if (!this.isConfigured || !this.sheetsService || !sid) {
      throw new Error('Google Sheets not configured');
    }

    await writeQueue.enqueue(async () => {
      await this.sheetsService.spreadsheets.values.append({
        spreadsheetId: sid,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rows,
        },
      });
    });
  }

  /**
   * Update full sheet values (batch update)
   */
  async updateSheet(sheetName: string, values: any[][], targetSheetId?: string): Promise<void> {
    const sid = targetSheetId || this.spreadsheetId;
    if (!this.isConfigured || !this.sheetsService || !sid) {
      throw new Error('Google Sheets not configured');
    }

    await writeQueue.enqueue(async () => {
      await this.sheetsService.spreadsheets.values.clear({
        spreadsheetId: sid,
        range: `${sheetName}!A:Z`,
      });

      await this.sheetsService.spreadsheets.values.update({
        spreadsheetId: sid,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values,
        },
      });
    });
  }

  public hasRealData(db: any): boolean {
    if (!db) return false;
    return (
      (db.students?.length || 0) > 0 ||
      (db.classes?.length || 0) > 0 ||
      (db.attendance?.length || 0) > 0 ||
      (db.violations?.length || 0) > 0 ||
      (db.out_of_class?.length || 0) > 0 ||
      (db.leave_requests?.length || 0) > 0
    );
  }

  private getActiveOAuthToken(overrideToken?: string): string {
    if (overrideToken && overrideToken.trim()) return overrideToken.trim();
    return this.hasValidOAuthToken() ? this.oauthAccessToken : '';
  }

  private handleOAuth401() {
    this.oauthAccessToken = '';
    this.oauthExpiresAt = 0;
    this.oauthTokenExpired = true;
    this.removePersistedOAuthSession();
  }

  /**
   * Pull JSON backup from Google Drive using OAuth token or Service Account
   */
  public async pullDriveBackupWithToken(
    backupFileId?: string,
    folderId?: string,
    overrideToken?: string
  ): Promise<{ backupFileId: string; data: any } | null> {
    const token = this.getActiveOAuthToken(overrideToken);
    const validFolderId =
      folderId && folderId !== 'folder_kesiswaan_puncak_darussalam' ? folderId : '';
    let targetFileId =
      backupFileId && backupFileId !== 'backup_kesiswaan_puncak_darussalam'
        ? backupFileId
        : this.driveBackupFileId || '';

    if (token) {
      if (!targetFileId) {
        const backupFilename = 'DISIPLIN_KITA_BISA_Database_Realtime.json';
        const q = validFolderId
          ? `name='${backupFilename}' and '${validFolderId}' in parents and trashed=false`
          : `name='${backupFilename}' and trashed=false`;
        const searchRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (searchRes.status === 401) {
          this.handleOAuth401();
          return null;
        }
        if (searchRes.ok) {
          const searchJson = await searchRes.json().catch(() => ({}));
          targetFileId = searchJson.files?.[0]?.id || '';
        }
      }

      if (!targetFileId) return null;

      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${targetFileId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (dlRes.status === 401) {
        this.handleOAuth401();
        return null;
      }
      if (!dlRes.ok) return null;

      const parsed = await dlRes.json().catch(() => null);
      const data = parsed?.data || parsed;
      if (!data || typeof data !== 'object') return null;
      this.driveBackupFileId = targetFileId;
      return { backupFileId: targetFileId, data };
    }

    if (this.isConfigured && this.driveService) {
      try {
        if (!targetFileId) {
          const backupFilename = 'DISIPLIN_KITA_BISA_Database_Realtime.json';
          const q = validFolderId
            ? `name='${backupFilename}' and '${validFolderId}' in parents and trashed=false`
            : `name='${backupFilename}' and trashed=false`;
          const listRes = await this.driveService.files.list({ q, fields: 'files(id)' });
          targetFileId = listRes.data?.files?.[0]?.id || '';
        }
        if (!targetFileId) return null;
        const fileRes = await this.driveService.files.get({ fileId: targetFileId, alt: 'media' });
        const parsed = typeof fileRes.data === 'string' ? JSON.parse(fileRes.data) : fileRes.data;
        const data = parsed?.data || parsed;
        if (!data || typeof data !== 'object') return null;
        this.driveBackupFileId = targetFileId;
        return { backupFileId: targetFileId, data };
      } catch (err) {
        console.warn('[GoogleSheetsClient] pullDriveBackup service account warning:', err);
      }
    }

    return null;
  }

  /**
   * Fallback reader: pull Siswa / Kelas / Sesi_Presensi directly from Spreadsheet rows if Drive JSON backup is missing
   */
  public async pullSpreadsheetDataWithToken(
    spreadsheetId?: string,
    overrideToken?: string
  ): Promise<any | null> {
    const sid =
      spreadsheetId && spreadsheetId !== 'spreadsheet_kesiswaan_puncak_darussalam'
        ? spreadsheetId
        : this.spreadsheetId;
    if (!sid) return null;
    const token = this.getActiveOAuthToken(overrideToken);
    if (!token) return null;

    try {
      const ranges = encodeURIComponent('Siswa!A2:I5000');
      const r2 = encodeURIComponent('Kelas!A2:F500');
      const r3 = encodeURIComponent('Sesi_Presensi!A2:I100');
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchGet?ranges=${ranges}&ranges=${r2}&ranges=${r3}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 401) {
        this.handleOAuth401();
        return null;
      }
      if (!res.ok) return null;

      const json = await res.json().catch(() => null);
      const valueRanges = json?.valueRanges || [];
      const siswaRows: any[][] = valueRanges[0]?.values || [];
      const kelasRows: any[][] = valueRanges[1]?.values || [];
      const sesiRows: any[][] = valueRanges[2]?.values || [];

      if (siswaRows.length === 0 && kelasRows.length === 0) return null;
      const nowIso = new Date().toISOString();

      const students = siswaRows
        .filter((r) => r[0] && r[1])
        .map((r) => ({
          nis: String(r[0]).trim(),
          name: String(r[1]).trim(),
          class_id: String(r[2] || '').trim(),
          gender: String(r[3] || '').toLowerCase().includes('perempuan') ? 'P' : 'L',
          rfid_uid: r[4] && r[4] !== '-' ? String(r[4]).trim() : '',
          card_code: r[5] && r[5] !== '-' ? String(r[5]).trim() : String(r[0]).trim(),
          parent_name: r[6] && r[6] !== '-' ? String(r[6]).trim() : '',
          parent_email: r[7] && r[7] !== '-' ? String(r[7]).trim() : '',
          created_at: nowIso,
          updated_at: nowIso,
        }));

      const classes = kelasRows
        .filter((r) => r[0] && r[1])
        .map((r) => ({
          id: String(r[0]).trim(),
          name: String(r[1]).trim(),
          grade: String(r[2] || '10').trim(),
          major: String(r[3] || 'Umum').trim(),
          homeroom_teacher_name: r[4] && r[4] !== '-' ? String(r[4]).trim() : `Wali Kelas ${r[1]}`,
          homeroom_teacher_email: r[5] && r[5] !== '-' ? String(r[5]).trim() : '',
          quota_limit: 2,
          created_at: nowIso,
          updated_at: nowIso,
        }));

      const sessions = sesiRows
        .filter((r) => r[0] && r[1])
        .map((r) => ({
          id: String(r[0]).trim(),
          name: String(r[1]).trim(),
          start_time: String(r[2] || '06:00').trim(),
          on_time_limit: String(r[3] || '07:00').trim(),
          end_time: String(r[4] || '08:00').trim(),
          late_tolerance_minutes: Number(r[5]) || 0,
          active_days: String(r[6] || '1,2,3,4,5')
            .split(',')
            .map((x) => parseInt(x.trim(), 10))
            .filter((n) => !Number.isNaN(n)),
          is_active: !String(r[7] || '').toLowerCase().includes('nonaktif'),
          created_at: nowIso,
          updated_at: nowIso,
        }));

      return {
        students,
        classes,
        ...(sessions.length > 0 ? { sessions } : {}),
      };
    } catch (err) {
      console.warn('[GoogleSheetsClient] pullSpreadsheetDataWithToken warning:', err);
      return null;
    }
  }

  /**
   * Schedule non-blocking debounced sync of entire DB to Google Drive & Google Sheets
   */
  public scheduleAutoSync(getSnapshot: () => any) {
    if (!this.isConnected) return;
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }
    this.autoSyncTimer = setTimeout(() => {
      this.autoSyncTimer = null;
      const db = getSnapshot();
      this.syncFullDatabase(db).catch((err) => {
        console.warn('[GoogleSheetsClient Auto-Sync Warning]:', err?.message || err);
      });
    }, 800);
  }

  /**
   * Synchronize all tables to Google Sheets and JSON backup to Google Drive
   */
  public async syncFullDatabase(
    db: any,
    options?: { allowEmptyOverwrite?: boolean }
  ): Promise<{ abortedEmptyOverwrite?: boolean; discoveredBackupFileId?: string } | void> {
    const useServiceAccount = Boolean(this.isConfigured && this.sheetsService && this.driveService);
    const useOAuthToken = !useServiceAccount && this.hasValidOAuthToken();
    if (!useServiceAccount && !useOAuthToken) return;

    const targetSheetId =
      this.spreadsheetId ||
      (db?.settings?.google_sheet_id && db.settings.google_sheet_id !== 'spreadsheet_kesiswaan_puncak_darussalam'
        ? db.settings.google_sheet_id
        : '');

    const targetFolderId =
      this.driveFolderId ||
      (db?.settings?.google_drive_folder_id && db.settings.google_drive_folder_id !== 'folder_kesiswaan_puncak_darussalam'
        ? db.settings.google_drive_folder_id
        : '');

    // Empty-overwrite guard: if server DB has no students/classes/attendance/violations,
    // verify whether Drive backup or Google Sheets already holds real data before overwriting!
    if (!this.hasRealData(db) && !options?.allowEmptyOverwrite) {
      const existingBackup = await this.pullDriveBackupWithToken(
        db?.settings?.google_drive_backup_file_id,
        targetFolderId
      );
      if (existingBackup && this.hasRealData(existingBackup.data)) {
        console.warn('[GoogleSheetsClient] Aborted empty DB overwrite because Google Drive backup contains real school data.');
        return { abortedEmptyOverwrite: true, discoveredBackupFileId: existingBackup.backupFileId };
      }
      if (targetSheetId && useOAuthToken) {
        const existingSheet = await this.pullSpreadsheetDataWithToken(targetSheetId);
        if (existingSheet && this.hasRealData(existingSheet)) {
          console.warn('[GoogleSheetsClient] Aborted empty DB overwrite because Google Sheets contains real school data.');
          return { abortedEmptyOverwrite: true };
        }
      }
    }

    await writeQueue.enqueue(async () => {
      const students = db.students || [];
      const classes = db.classes || [];
      const sessions = db.sessions || [];
      const attendance = db.attendance || [];
      const outOfClass = db.out_of_class || [];
      const violations = db.violations || [];
      const leaveRequests = db.leave_requests || [];
      const violationTypes = db.violation_types || [];
      const settings = db.settings || {};
      const studentMap = new Map<string, any>(students.map((s: any) => [s.nis, s]));
      const requiredSheets = [
        'Siswa',
        'Kelas',
        'Sesi_Presensi',
        'Rekap_Per_Sesi',
        'Presensi',
        'Izin_Keluar',
        'Pelanggaran',
        'Izin_Tidak_Masuk',
        'Jenis_Pelanggaran',
        'Pengaturan',
      ];
      const sessionMap = new Map<string, any>(sessions.map((s: any) => [s.id, s]));
      const recapData = buildSessionRecapData({
        sessions,
        classes,
        students,
        attendance,
      });

      const buildDataPayload = () => [
        {
          range: 'Siswa!A1',
          values: [
            ['NIS', 'Nama Siswa', 'Kelas', 'Jenis Kelamin', 'RFID UID', 'Kode Kartu/NIS', 'Nama Orang Tua', 'Email Orang Tua', 'Status Keaktifan'],
            ...students.map((s: any) => [s.nis, s.name, s.class_id, s.gender === 'L' ? 'Laki-laki' : 'Perempuan', s.rfid_uid || '-', s.card_code || s.nis, s.parent_name || '-', s.parent_email || '-', 'Aktif']),
          ],
        },
        {
          range: 'Kelas!A1',
          values: [
            ['ID Kelas', 'Nama Kelas', 'Tingkat', 'Jurusan', 'Nama Wali Kelas', 'Email Wali Kelas'],
            ...classes.map((c: any) => [c.id, c.name, c.grade, c.major, c.homeroom_teacher_name || '-', c.homeroom_teacher_email || '-']),
          ],
        },
        {
          range: 'Sesi_Presensi!A1',
          values: [
            ['ID Sesi', 'Nama Sesi', 'Jam Mulai', 'Batas Tepat Waktu', 'Jam Selesai', 'Toleransi Terlambat (Menit)', 'Hari Aktif (0=Min,1=Sen..)', 'Status', 'Peralihan Otomatis'],
            ...sessions.map((sess: any) => [
              sess.id,
              sess.name,
              sess.start_time,
              sess.on_time_limit,
              sess.end_time,
              sess.late_tolerance_minutes ?? 0,
              (sess.active_days || [1, 2, 3, 4, 5]).join(', '),
              sess.is_active ? 'Aktif' : 'Nonaktif',
              settings.auto_session_switch !== false ? 'Otomatis (Aktif)' : 'Manual',
            ]),
          ],
        },
        {
          range: 'Rekap_Per_Sesi!A1',
          values: [
            ['RINGKASAN REKAPITULASI PRESENSI PER SESI (SELURUH SEKOLAH)', `Tanggal Rekap: ${recapData.targetDate}`, '', '', '', '', '', '', '', '', '', '', '', ''],
            ['ID Sesi', 'Nama Sesi', 'Rentang Jam', 'Batas Tepat Waktu', 'Status Sesi', 'Total Siswa', 'Hadir Tepat Waktu', 'Terlambat', 'Izin', 'Sakit', 'Alpha', 'Belum Presensi', 'Total Tercatat', 'Persentase Kehadiran (%)'],
            ...recapData.sessionSummaries.map((row) => [
              row.sessionId,
              row.sessionName,
              row.timeRange,
              row.onTimeLimit,
              row.statusLabel,
              row.totalStudents,
              row.hadir,
              row.terlambat,
              row.izin,
              row.sakit,
              row.alpha,
              row.belumPresensi,
              row.totalRecorded,
              `${row.attendancePercent}%`,
            ]),
            [],
            ['RINCIAN REKAP PRESENSI PER SESI DAN PER KELAS', `Tanggal Rekap: ${recapData.targetDate}`, '', '', '', '', '', '', '', '', '', ''],
            ['ID Sesi', 'Nama Sesi', 'ID Kelas', 'Nama Kelas', 'Total Siswa Kelas', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha', 'Belum Presensi', 'Total Hadir+Terlambat', 'Persentase Kehadiran (%)'],
            ...recapData.classSessionSummaries.map((cRow) => [
              cRow.sessionId,
              cRow.sessionName,
              cRow.classId,
              cRow.className,
              cRow.totalStudents,
              cRow.hadir,
              cRow.terlambat,
              cRow.izin,
              cRow.sakit,
              cRow.alpha,
              cRow.belumPresensi,
              cRow.totalAttended,
              `${cRow.attendancePercent}%`,
            ]),
          ],
        },
        {
          range: 'Presensi!A1',
          values: [
            ['ID Presensi', 'Tanggal', 'Jam', 'NIS', 'Nama Siswa', 'Kelas', 'ID Sesi', 'Nama Sesi', 'Status', 'Terlambat (Menit)', 'Metode', 'Perangkat', 'Catatan'],
            ...attendance.slice(0, 1500).map((a: any) => {
              const st = studentMap.get(a.student_id);
              const sess = sessionMap.get(a.session_id);
              return [a.id, a.date, a.timestamp ? new Date(a.timestamp).toLocaleTimeString('id-ID') : '-', a.student_id, st?.name || '-', st?.class_id || '-', a.session_id, sess?.name || a.session_id, a.status, a.late_minutes || 0, a.method || 'rfid', a.device_id || 'utama', a.notes || ''];
            }),
          ],
        },
        {
          range: 'Izin_Keluar!A1',
          values: [
            ['ID Izin', 'NIS', 'Nama Siswa', 'Kelas', 'Jenis', 'Mulai', 'Batas', 'Kembali', 'Durasi', 'Terlambat', 'Status', 'Metode', 'Catatan'],
            ...outOfClass.slice(0, 1000).map((o: any) => {
              const st = studentMap.get(o.student_id);
              return [o.id, o.student_id, st?.name || '-', o.class_id, o.type, new Date(o.started_at).toLocaleString('id-ID'), new Date(o.due_at).toLocaleTimeString('id-ID'), o.returned_at ? new Date(o.returned_at).toLocaleTimeString('id-ID') : '-', o.duration_minutes, o.late_return_minutes || 0, o.status, o.return_method || '-', o.return_notes || ''];
            }),
          ],
        },
        {
          range: 'Pelanggaran!A1',
          values: [
            ['ID', 'Waktu', 'NIS', 'Nama Siswa', 'Kelas', 'Pelanggaran', 'Kategori', 'Poin', 'Lokasi', 'Petugas', 'Catatan'],
            ...violations.slice(0, 1000).map((v: any) => {
              const st = studentMap.get(v.student_id);
              return [v.id, new Date(v.recorded_at).toLocaleString('id-ID'), v.student_id, st?.name || '-', v.class_id, v.type_name, v.category, v.points, v.location || '-', v.recorded_by || 'Admin', v.notes || ''];
            }),
          ],
        },
        {
          range: 'Izin_Tidak_Masuk!A1',
          values: [
            ['ID', 'NIS', 'Nama Siswa', 'Kelas', 'Jenis', 'Mulai', 'Selesai', 'Alasan', 'Status', 'Diproses Oleh'],
            ...leaveRequests.slice(0, 1000).map((lr: any) => {
              const st = studentMap.get(lr.student_id);
              return [lr.id, lr.student_id, st?.name || '-', lr.class_id, lr.type, lr.start_date, lr.end_date, lr.reason, lr.status, lr.approved_by || '-'];
            }),
          ],
        },
        {
          range: 'Jenis_Pelanggaran!A1',
          values: [
            ['ID', 'Kode', 'Nama', 'Kategori', 'Poin Default', 'Status', 'Keterangan'],
            ...violationTypes.map((vt: any) => [vt.id, vt.code, vt.name, vt.category, vt.default_points, vt.is_active ? 'Aktif' : 'Nonaktif', vt.description || '']),
          ],
        },
        {
          range: 'Pengaturan!A1',
          values: [
            ['Parameter Sistem', 'Nilai Saat Ini', 'Keterangan'],
            ['ID Cloud Console (Client ID)', settings.google_client_id || '1050818791896-mi4qsashp76oedjfgqiagmph04osv40b.apps.googleusercontent.com', 'OAuth 2.0 Web Client ID tersimpan otomatis di aplikasi & sheet'],
            ['Nama Sekolah', settings.school_name || 'SMP Puncak Darussalam', 'Identitas sekolah'],
            ['Email Google Terhubung (OAuth 2.0)', settings.google_account_email || this.oauthEmail || '-', 'Akun Google Drive & Sheets sekolah'],
            ['Nama Akun Google', settings.google_account_name || '-', 'Nama profil akun Google OAuth 2.0'],
            ['ID Folder Google Drive', targetFolderId || settings.google_drive_folder_id || '-', 'Folder penyimpanan otomatis database JSON'],
            ['ID Google Spreadsheet', targetSheetId || '-', 'ID Google Spreadsheet database 10 lembar kerja'],
            ['Peralihan Sesi Otomatis', settings.auto_session_switch !== false ? 'Aktif (Otomatis)' : 'Manual', 'Pergantian sesi otomatis sesuai jam server'],
            ['Total Siswa Terdaftar', students.length, 'Jumlah siswa terdaftar'],
            ['Total Kelas', classes.length, 'Jumlah kelas'],
            ['Total Sesi Presensi', sessions.length, 'Jumlah sesi jadwal presensi'],
            ['Total Jenis Pelanggaran', violationTypes.length, 'Jumlah master aturan pelanggaran/prestasi'],
            ['Total Catatan Presensi', attendance.length, 'Presensi tercatat di sistem'],
            ['Total Izin Keluar', outOfClass.length, 'Izin keluar kelas tercatat'],
            ['Total Pelanggaran & Prestasi', violations.length, 'Catatan kedisiplinan'],
            ['Notifikasi Email Orang Tua', settings.toggle_email_notifications !== false && db.notification_settings?.email_enabled !== false ? 'Aktif (Otomatis)' : 'Nonaktif', 'Pengiriman pemberitahuan otomatis tanpa klik manual'],
            ['Rekap Mingguan Wali Kelas', db.notification_settings?.weekly_recap_enabled !== false ? `Aktif (Hari ${db.notification_settings?.weekly_recap_day ?? 5}, Jam ${db.notification_settings?.weekly_recap_time || '15:00'})` : 'Nonaktif', 'Pengiriman otomatis ke wali kelas per sesi'],
            ['Sinkron Terakhir', new Date().toLocaleString('id-ID'), 'Otomatis real-time server'],
            ['Mode Database', 'Google OAuth 2.0 + Drive & Sheets Otomatis Real-Time', 'Sinkronisasi otomatis setiap perubahan data'],
          ],
        },
      ];

      if (useOAuthToken && this.oauthAccessToken) {
        const token = this.oauthAccessToken;
        if (targetSheetId) {
          // Ensure all 10 sheet tabs (including Rekap_Per_Sesi) exist before clearing/writing
          const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSheetId}?fields=sheets.properties.title`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (metaRes.status === 401) {
            this.oauthAccessToken = '';
            this.oauthExpiresAt = 0;
            this.oauthTokenExpired = true;
            this.removePersistedOAuthSession();
            return;
          }
          if (metaRes.ok) {
            const metaJson = await metaRes.json().catch(() => ({}));
            const existingTitles: string[] = (metaJson.sheets || []).map((s: any) => s.properties?.title);
            const missing = requiredSheets.filter((t) => !existingTitles.includes(t));
            if (missing.length > 0) {
              await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSheetId}:batchUpdate`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  requests: missing.map((title) => ({
                    addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
                  })),
                }),
              });
            }
          }

          const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSheetId}/values:batchClear`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ranges: requiredSheets.map((t) => `${t}!A:Z`) }),
          });
          if (clearRes.status === 401) {
            this.oauthAccessToken = '';
            this.oauthExpiresAt = 0;
            this.oauthTokenExpired = true;
            this.removePersistedOAuthSession();
            return;
          }
          const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSheetId}/values:batchUpdate`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ valueInputOption: 'RAW', data: buildDataPayload() }),
          });
          if (writeRes.status === 401) {
            this.oauthAccessToken = '';
            this.oauthExpiresAt = 0;
            this.oauthTokenExpired = true;
            this.removePersistedOAuthSession();
            return;
          }
        }

        const backupFileId = this.driveBackupFileId || db?.settings?.google_drive_backup_file_id || '';
        if (backupFileId && backupFileId !== 'backup_kesiswaan_puncak_darussalam') {
          const snapshotBody = JSON.stringify(
            {
              app: 'DISIPLIN KITA BISA',
              syncedAt: new Date().toISOString(),
              data: {
                settings: db.settings,
                notification_settings: db.notification_settings,
                classes: db.classes,
                sessions: db.sessions,
                students: db.students,
                violation_types: db.violation_types,
                attendance: db.attendance,
                out_of_class: db.out_of_class,
                violations: db.violations,
                leave_requests: db.leave_requests,
              },
            },
            null,
            2
          );
          const patchRes = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${backupFileId}?uploadType=media&fields=id`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: snapshotBody,
            }
          );
          if (patchRes.status === 401) {
            this.oauthAccessToken = '';
            this.oauthExpiresAt = 0;
            this.oauthTokenExpired = true;
            this.removePersistedOAuthSession();
          }
        }
        return;
      }

      // 1. Service-account sync to Google Sheets if a valid Spreadsheet ID is available
      if (targetSheetId) {
        const meta = await this.sheetsService.spreadsheets.get({
          spreadsheetId: targetSheetId,
          fields: 'sheets.properties.title',
        });
        const existingTitles: string[] = (meta.data?.sheets || []).map((s: any) => s.properties?.title);
        const missing = requiredSheets.filter((t) => !existingTitles.includes(t));
        if (missing.length > 0) {
          await this.sheetsService.spreadsheets.batchUpdate({
            spreadsheetId: targetSheetId,
            requestBody: {
              requests: missing.map((title) => ({
                addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
              })),
            },
          });
        }

        const dataPayload = buildDataPayload();

        await this.sheetsService.spreadsheets.values.batchClear({
          spreadsheetId: targetSheetId,
          requestBody: { ranges: requiredSheets.map((t) => `${t}!A:Z`) },
        });
        await this.sheetsService.spreadsheets.values.batchUpdate({
          spreadsheetId: targetSheetId,
          requestBody: { valueInputOption: 'RAW', data: dataPayload },
        });
      }

      // 2. Sync JSON snapshot backup file to Google Drive folder if folder ID available
      if (targetFolderId) {
        const { Readable } = await import('stream');
        const backupFilename = 'DISIPLIN_KITA_BISA_Database_Realtime.json';
        const snapshotBody = JSON.stringify(
          {
            app: 'DISIPLIN KITA BISA',
            syncedAt: new Date().toISOString(),
            data: {
              settings: db.settings,
              notification_settings: db.notification_settings,
              classes: db.classes,
              sessions: db.sessions,
              students: db.students,
              violation_types: db.violation_types,
              attendance: db.attendance,
              out_of_class: db.out_of_class,
              violations: db.violations,
              leave_requests: db.leave_requests,
            },
          },
          null,
          2
        );

        let fileId = this.driveBackupFileId || db?.settings?.google_drive_backup_file_id || '';
        if (!fileId) {
          const listRes = await this.driveService.files.list({
            q: `name='${backupFilename}' and '${targetFolderId}' in parents and trashed=false`,
            fields: 'files(id)',
          });
          fileId = listRes.data?.files?.[0]?.id || '';
        }

        const stream = new Readable();
        stream.push(snapshotBody);
        stream.push(null);

        if (fileId) {
          await this.driveService.files.update({
            fileId,
            media: { mimeType: 'application/json', body: stream },
          });
          this.driveBackupFileId = fileId;
        } else {
          const created = await this.driveService.files.create({
            requestBody: {
              name: backupFilename,
              parents: [targetFolderId],
              mimeType: 'application/json',
            },
            media: { mimeType: 'application/json', body: stream },
            fields: 'id',
          });
          this.driveBackupFileId = created.data?.id || '';
        }
      }
    });
  }

  /**
   * Upload file to Google Drive folder
   */
  async uploadFileToDrive(fileName: string, mimeType: string, base64Data: string): Promise<string> {
    if (!this.isConfigured || !this.driveService) {
      throw new Error('Google Drive not configured');
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const { Readable } = await import('stream');
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const fileMetadata: any = {
      name: fileName,
    };
    if (this.driveFolderId) {
      fileMetadata.parents = [this.driveFolderId];
    }

    const response = await this.driveService.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType,
        body: stream,
      },
      fields: 'id, webViewLink, webContentLink',
    });

    const fileId = response.data.id;
    try {
      await this.driveService.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
    } catch (e) {
      // Permission might already be inherited from folder
    }

    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
}

export const googleSheetsClient = new GoogleSheetsClient();
