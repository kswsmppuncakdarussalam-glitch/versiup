/**
 * ============================================================================
 * DISIPLIN KITA BISA — GOOGLE APPS SCRIPT WEB APP BACKEND (.gs)
 * ============================================================================
 * Cara Deploy di Google Apps Script (https://script.google.com):
 * 1. Buka https://script.google.com -> Proyek Baru ("DISIPLIN KITA BISA Backend").
 * 2. Hapus isi Code.gs bawaan lalu tempel seluruh kode ini dan Simpan (Ctrl+S).
 * 3. Buka "Setelan Proyek" (ikon Roda Gigi) -> "Properti Skrip" (Script Properties)
 *    lalu tambahkan 3 properti wajib berikut:
 *    - SPREADSHEET_ID   : ID Google Spreadsheet Anda (mis. 14MkgrDI6iFV4J8b5rS_LkUZrHtYX_zzuGJUihjKdxU4)
 *    - DRIVE_FOLDER_ID  : ID Folder Google Drive privat untuk foto (mis. 1vHFHbjW2E8Zo_-nuft4ns1NonyXcQY7K)
 *    - SECRET_TOKEN     : Token rahasia bebas & kuat (mis. DKB-Rahasia-2026-SmpPds!)
 * 4. Pilih fungsi `setupAppsScript` di toolbar editor lalu klik "Jalankan"
 *    untuk membuat 13 tab Google Sheets & memberi izin Sheets, Drive, GmailApp.
 * 5. Klik "Terapkan" (Deploy) -> "Deployment baru" (New deployment):
 *    - Jenis: Aplikasi Web (Web app)
 *    - Jalankan sebagai (Execute as): Saya (Me)
 *    - Yang memiliki akses (Who has access): Siapa saja (Anyone)
 * 6. Salin URL Web App (/exec) dan masukkan bersama SECRET_TOKEN di aplikasi.
 *
 * (Opsional) Untuk rekap mingguan otomatis berjalan tanpa membuka aplikasi:
 * Buka menu Triggers (Ikon Jam) di Apps Script -> Tambah Trigger:
 * - Fungsi: `checkAndTriggerWeeklyRecap`
 * - Sumber acara: Berdasarkan waktu (Time-driven) -> Penghitung waktu menit (Setiap 15 menit)
 * ============================================================================
 */

var TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari
var LOCKOUT_MAX_ATTEMPTS = 5;
var LOCKOUT_SECONDS = 300; // 5 menit

var SHEET_TABS = {
  SISWA: 'Siswa',
  KELAS: 'Kelas',
  SESI_PRESENSI: 'Sesi_Presensi',
  REKAP_PER_SESI: 'Rekap_Per_Sesi',
  PRESENSI: 'Presensi',
  IZIN_KELUAR: 'Izin_Keluar',
  PELANGGARAN: 'Pelanggaran',
  IZIN_TIDAK_MASUK: 'Izin_Tidak_Masuk',
  JENIS_PELANGGARAN: 'Jenis_Pelanggaran',
  PENGATURAN: 'Pengaturan',
  USERS: 'Users',
  NOTIFIKASI_LOG: 'Notifikasi_Log',
  LOG: 'Log',
};

var SHEET_HEADERS = {};
SHEET_HEADERS[SHEET_TABS.SISWA] = [
  'id', 'nis', 'nisn', 'name', 'class_id', 'gender', 'rfid_uid', 'card_code',
  'photo_url', 'parent_name', 'parent_email', 'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.KELAS] = [
  'id', 'name', 'grade', 'major', 'homeroom_teacher_name', 'homeroom_teacher_email',
  'quota_limit', 'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.SESI_PRESENSI] = [
  'id', 'name', 'start_time', 'on_time_limit', 'end_time', 'active_days',
  'late_tolerance_minutes', 'is_active', 'is_override', 'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.REKAP_PER_SESI] = [
  'id', 'tanggal', 'session_id', 'session_name', 'rentang_waktu', 'total_siswa',
  'hadir', 'terlambat', 'izin', 'sakit', 'alpha', 'belum_presensi', 'persen_hadir', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.PRESENSI] = [
  'id', 'student_id', 'session_id', 'date', 'timestamp', 'status_presensi', 'late_minutes',
  'method', 'device_id', 'photo_id', 'notes', 'audited_by', 'audit_reason', 'version',
  'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.IZIN_KELUAR] = [
  'id', 'student_id', 'class_id', 'type', 'duration_minutes', 'started_at', 'due_at',
  'returned_at', 'actual_minutes', 'late_return_minutes', 'return_method', 'status_izin',
  'return_notes', 'audited_by', 'audit_reason', 'idempotency_key', 'version',
  'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.PELANGGARAN] = [
  'id', 'student_id', 'class_id', 'violation_type_id', 'type_name', 'category', 'points',
  'notes', 'location', 'evidence_photo_url', 'recorded_by', 'recorded_at', 'version',
  'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.IZIN_TIDAK_MASUK] = [
  'id', 'student_id', 'class_id', 'type', 'start_date', 'end_date', 'reason', 'letter_file_url',
  'status_persetujuan', 'approved_by', 'approved_at', 'rejection_reason',
  'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.JENIS_PELANGGARAN] = [
  'id', 'code', 'name', 'category', 'default_points', 'is_active', 'description',
  'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.PENGATURAN] = [
  'id', 'tipe', 'json_data', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.USERS] = [
  'id', 'role', 'name', 'class_id', 'email', 'password_hash', 'label', 'token_version',
  'is_active', 'created_at', 'updated_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.NOTIFIKASI_LOG] = [
  'id', 'timestamp', 'student_id', 'student_name', 'recipient_email', 'trigger_type',
  'status_kirim', 'error_message', 'created_at', 'status', 'diubah_pada'
];
SHEET_HEADERS[SHEET_TABS.LOG] = [
  'id', 'waktu', 'pengguna', 'id_data', 'tabel', 'aksi', 'nilai_lama', 'nilai_baru',
  'reason', 'status', 'diubah_pada'
];

// ============================================================================
// ENTRY POINTS (Web App + Setup + Scheduler Trigger)
// ============================================================================

function setupAppsScript() {
  var missing = getMissingConfigKeys_();
  var ssId = getSpreadsheetId_();
  if (!ssId) {
    throw new Error('SPREADSHEET_ID belum diisi di Setelan Proyek -> Properti Skrip (Script Properties).');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var ss;
  try {
    ss = getSpreadsheet_();
    ensureSheetsAndHeaders_(ss);
    ensureSeedData_(ss);
  } finally {
    lock.releaseLock();
  }

  var folderId = getDriveFolderId_();
  var folderOk = false;
  var folderName = '';
  if (folderId) {
    try {
      var f = DriveApp.getFolderById(folderId);
      if (f && (!f.isTrashed || !f.isTrashed())) {
        folderOk = true;
        folderName = f.getName();
      }
    } catch (eFolder) {
      folderOk = false;
    }
  }

  // Sentuh GmailApp agar izin pengiriman email ikut terotorisasi saat menjalankan setupAppsScript
  var quotaRemaining = 0;
  try {
    quotaRemaining = MailApp.getRemainingDailyQuota();
  } catch (eMail) {}

  return {
    ok: true,
    spreadsheetName: ss.getName(),
    driveFolderAccessible: folderOk,
    driveFolderName: folderName,
    senderEmail: getActiveSenderEmail_(),
    mailQuotaRemaining: quotaRemaining,
    missingProperties: missing,
  };
}

function checkAndTriggerWeeklyRecap() {
  try {
    if (!getSpreadsheetId_()) return;
    var notifSettings = getNotificationSettings_();
    if (!notifSettings.weekly_recap_enabled) return;

    var now = new Date();
    var targetDay = notifSettings.weekly_recap_day !== undefined ? Number(notifSettings.weekly_recap_day) : 5;
    if (now.getDay() !== targetDay) return;

    var targetTime = String(notifSettings.weekly_recap_time || '15:00').split(':');
    var targetH = Number(targetTime[0]) || 15;
    var targetM = Number(targetTime[1]) || 0;
    if (now.getHours() < targetH || (now.getHours() === targetH && now.getMinutes() < targetM)) return;

    if (notifSettings.weekly_recap_last_sent) {
      var lastSent = new Date(notifSettings.weekly_recap_last_sent);
      if (
        lastSent.getFullYear() === now.getFullYear() &&
        lastSent.getMonth() === now.getMonth() &&
        lastSent.getDate() === now.getDate()
      ) {
        return;
      }
    }
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      sendAllWeeklyRecaps_();
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('checkAndTriggerWeeklyRecap error: ' + err);
  }
}

function normalizeToken_(rawTok) {
  var s = String(rawTok === undefined || rawTok === null ? '' : rawTok).trim();
  s = s.replace(/^Bearer\s+/i, '').trim();
  if (!s || s === 'undefined' || s === 'null') return '';
  return s;
}

function constantTimeEqual_(a, b) {
  var sa = String(a || '');
  var sb = String(b || '');
  var maxLen = Math.max(sa.length, sb.length);
  var diff = sa.length ^ sb.length;
  for (var i = 0; i < maxLen; i++) {
    var ca = i < sa.length ? sa.charCodeAt(i) : 0;
    var cb = i < sb.length ? sb.charCodeAt(i) : 0;
    diff |= (ca ^ cb);
  }
  return diff === 0 && sa.length > 0;
}

function verifySecretToken_(incomingSecret) {
  var configured = getSecretToken_();
  if (!configured) {
    return {
      ok: false,
      missingSecret: true,
      reason: 'Token rahasia (SECRET_TOKEN) belum diatur di Script Properties Google Apps Script.',
    };
  }
  var cleanIncoming = normalizeToken_(incomingSecret);
  if (!cleanIncoming || !constantTimeEqual_(cleanIncoming, configured)) {
    return {
      ok: false,
      missingSecret: false,
      reason: 'Akses ditolak: token rahasia (SECRET_TOKEN) salah atau tidak disertakan.',
    };
  }
  return { ok: true };
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var incomingSecret =
    params.secretToken ||
    params.secret_token ||
    params.apiToken ||
    params.token_rahasia ||
    '';

  var secretCheck = verifySecretToken_(incomingSecret);
  if (!secretCheck.ok) {
    return jsonOutput_(makeResp_(401, {
      error: secretCheck.reason,
      unauthorizedToken: true,
      missingSecret: Boolean(secretCheck.missingSecret),
      missingConfig: getMissingConfigKeys_(),
    }));
  }

  var route = params.route || '/api/setup';
  var req = {
    route: route,
    method: 'GET',
    query: params,
    token: normalizeToken_(params.token),
    body: {},
  };
  return jsonOutput_(dispatchRoute_(req));
}

function doPost(e) {
  var payload = {};
  try {
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
  } catch (parseErr) {
    return jsonOutput_(makeResp_(400, { error: 'Payload JSON tidak valid: ' + parseErr.message }));
  }

  var params = (e && e.parameter) || {};
  var incomingSecret =
    payload.secretToken ||
    payload.secret_token ||
    payload.apiToken ||
    params.secretToken ||
    params.secret_token ||
    params.apiToken ||
    '';

  var secretCheck = verifySecretToken_(incomingSecret);
  if (!secretCheck.ok) {
    return jsonOutput_(makeResp_(401, {
      error: secretCheck.reason,
      unauthorizedToken: true,
      missingSecret: Boolean(secretCheck.missingSecret),
      missingConfig: getMissingConfigKeys_(),
    }));
  }

  var req = {
    route: payload.route || params.route || '/api/setup',
    method: String(payload.method || 'POST').toUpperCase(),
    query: payload.query || params || {},
    token: normalizeToken_(payload.token || params.token),
    body: payload.body !== undefined ? payload.body : {},
  };

  return jsonOutput_(dispatchRoute_(req));
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function makeResp_(status, data) {
  var out = {};
  if (data && typeof data === 'object') {
    for (var k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        out[k] = data[k];
      }
    }
  }
  out._status = status || 200;
  return out;
}

// ============================================================================
// CONFIG & HELPERS (Script Properties ONLY)
// ============================================================================

function getProp_(key, fallback) {
  try {
    var val = PropertiesService.getScriptProperties().getProperty(key);
    if (val && String(val).trim()) return String(val).trim();
  } catch (e) {}
  return fallback !== undefined ? fallback : '';
}

function getSpreadsheetId_() {
  var raw = getProp_('SPREADSHEET_ID', '');
  if (!raw) return '';
  var m = String(raw).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : String(raw).split(/[?#/\s]/)[0];
}

function getDriveFolderId_() {
  var raw = getProp_('DRIVE_FOLDER_ID', '');
  if (!raw) return '';
  var m = String(raw).match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : String(raw).split(/[?#/\s]/)[0];
}

function getSecretToken_() {
  return getProp_('SECRET_TOKEN', '');
}

function getMissingConfigKeys_() {
  var missing = [];
  if (!getSpreadsheetId_()) missing.push('SPREADSHEET_ID');
  if (!getDriveFolderId_()) missing.push('DRIVE_FOLDER_ID');
  if (!getSecretToken_()) missing.push('SECRET_TOKEN');
  return missing;
}

function getJwtSecret_() {
  return getProp_('JWT_SECRET', 'disiplin-kita-bisa-secure-secret-key-2026');
}

function getSpreadsheet_() {
  var id = getSpreadsheetId_();
  if (!id) throw new Error('SPREADSHEET_ID belum diisi di Script Properties Google Apps Script.');
  return SpreadsheetApp.openById(id);
}

function getActiveSenderEmail_() {
  try {
    var active = Session.getActiveUser().getEmail();
    if (active) return active;
    var effective = Session.getEffectiveUser().getEmail();
    return effective || '';
  } catch (e) {
    return '';
  }
}

function parseBool_(v, defVal) {
  if (typeof v === 'boolean') return v;
  var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'ya' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'tidak' || s === 'no') return false;
  return Boolean(defVal);
}

function parseNum_(v, defVal) {
  if (v === '' || v === undefined || v === null) return defVal;
  var n = Number(v);
  return isNaN(n) ? defVal : n;
}

function parseJsonArray_(v, fallback) {
  if (Array.isArray(v)) return v;
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return fallback;
  try {
    var parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function toDateYmd_(d) {
  var tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
  return Utilities.formatDate(d || new Date(), tz, 'yyyy-MM-dd');
}

function toLocalHm_(d) {
  var tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
  return Utilities.formatDate(d || new Date(), tz, 'HH:mm');
}

function getLocalClockParts_(d) {
  var tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
  var now = d || new Date();
  var h = Number(Utilities.formatDate(now, tz, 'H'));
  var m = Number(Utilities.formatDate(now, tz, 'm'));
  var isoDay = Number(Utilities.formatDate(now, tz, 'u')); // 1=Mon..7=Sun
  var jsDay = isoDay === 7 ? 0 : isoDay; // 0=Sun..6=Sat
  return { hours: h, minutes: m, totalMinutes: h * 60 + m, dayOfWeek: jsDay };
}

function formatIdDateTime_(d) {
  var tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
  return Utilities.formatDate(d || new Date(), tz, 'dd/MM/yyyy HH:mm:ss');
}

function randomId_(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}

// ============================================================================
// CRYPTO: HMAC-SHA256 JWT + PASSWORD HASH ($as256$ & BCRYPT VERIFY)
// ============================================================================

function base64UrlEncodeBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function base64UrlEncodeStr_(str) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(str).getBytes()).replace(/=+$/, '');
}

function base64UrlDecodeStr_(b64) {
  var clean = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (clean.length % 4 !== 0) clean += '=';
  var bytes = Utilities.base64Decode(clean);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function signJwt_(payload) {
  var clean = {};
  for (var k in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, k) && k !== 'iat' && k !== 'exp') {
      clean[k] = payload[k];
    }
  }
  clean.iat = Math.floor(Date.now() / 1000);
  clean.exp = Math.floor((Date.now() + TOKEN_EXPIRY_MS) / 1000);

  var headerB64 = base64UrlEncodeStr_(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payloadB64 = base64UrlEncodeStr_(JSON.stringify(clean));
  var signingInput = headerB64 + '.' + payloadB64;
  var sigBytes = Utilities.computeHmacSha256Signature(signingInput, getJwtSecret_());
  return signingInput + '.' + base64UrlEncodeBytes_(sigBytes);
}

function verifyJwt_(token) {
  var cleanTok = normalizeToken_(token);
  if (!cleanTok) return null;
  var parts = cleanTok.split('.');
  if (parts.length !== 3) return null;
  try {
    var signingInput = parts[0] + '.' + parts[1];
    var expectedSig = base64UrlEncodeBytes_(
      Utilities.computeHmacSha256Signature(signingInput, getJwtSecret_())
    );
    var payloadJson = base64UrlDecodeStr_(parts[1]);
    var payload = JSON.parse(payloadJson);
    if (!payload || !payload.userId || !payload.role) return null;

    var nowSec = Math.floor(Date.now() / 1000);
    var maxAgeSec = 30 * 24 * 60 * 60; // 30 hari toleransi untuk sesi Vercel/kios aktif
    if (payload.iat && (nowSec - Number(payload.iat)) > maxAgeSec) {
      return null;
    }
    if (!payload.iat && payload.exp && nowSec > (Number(payload.exp) + maxAgeSec)) {
      return null;
    }

    if (parts[2] === expectedSig) {
      if (payload.tokenVersion !== undefined && payload.tokenVersion !== null) {
        var tv = Number(payload.tokenVersion);
        if (!isNaN(tv)) payload.tokenVersion = tv;
      } else {
        payload.tokenVersion = 1;
      }
      return payload;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function validateTokenAgainstSheet_(tok) {
  var sess = verifyJwt_(tok);
  if (!sess) return { valid: false, reason: 'Sesi tidak valid atau telah berakhir.' };
  var dbUsers = getFullDatabase_().users;
  var matched = dbUsers.filter(function (u) { return u.id === sess.userId; })[0];
  if (!matched && sess.role) {
    if (sess.role === 'homeroom' && sess.lockedMenuClassId) {
      matched = dbUsers.filter(function (u) {
        return u.role === 'homeroom' && u.class_id === sess.lockedMenuClassId && u.is_active;
      })[0];
    }
    if (!matched) {
      matched = dbUsers.filter(function (u) { return u.role === sess.role && u.is_active; })[0];
    }
  }
  if (!matched || !matched.is_active) {
    return { valid: false, reason: 'Akun tidak ditemukan atau nonaktif.' };
  }
  if (
    sess.tokenVersion !== undefined &&
    sess.tokenVersion !== null &&
    Number(matched.token_version) !== Number(sess.tokenVersion)
  ) {
    return { valid: false, reason: 'Session invalidated by password or account change', invalidated: true };
  }
  return { valid: true, session: sess, user: matched };
}

function buildDatabasePayload_(dbOpt) {
  var db = dbOpt || getFullDatabase_();
  return {
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
  };
}

function toHex_(bytes) {
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function hashPassword_(plain) {
  var saltBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Date.now() + ':' + Math.random() + ':' + Utilities.getUuid()
  );
  var salt = toHex_(saltBytes).substring(0, 16);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + String(plain));
  return '$as256$' + salt + '$' + toHex_(digest);
}

function verifyPassword_(plain, storedHash) {
  if (!storedHash || plain === undefined || plain === null) return false;
  var p = String(plain);
  var h = String(storedHash).trim();

  if (h.indexOf('$as256$') === 0) {
    var parts = h.split('$');
    if (parts.length !== 4) return false;
    var salt = parts[2];
    var expectedHex = parts[3];
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + p);
    return toHex_(digest) === expectedHex;
  }

  if (h.indexOf('$2a$') === 0 || h.indexOf('$2b$') === 0 || h.indexOf('$2y$') === 0) {
    return verifyBcrypt_(p, h);
  }

  return p === h;
}

/**
 * Pure-JS EksBlowfish bcrypt verification so existing $2a$/$2b$ hashes stored
 * in the Users tab by the Node.js backend continue to work seamlessly.
 */
function verifyBcrypt_(password, hash) {
  try {
    var BASE64_CODE = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var BF_P_ORIG = [
      0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344, 0xa4093822, 0x299f31d0,
      0x082efa98, 0xec4e6c89, 0x452821e6, 0x38d01377, 0xbe5466cf, 0x34e90c6c,
      0xc0ac29b7, 0xc97c50dd, 0x3f84d5b5, 0xb5470917, 0x9216d5d9, 0x8979fb1b
    ];
    var BF_S_ORIG = [
      0xd1310ba6, 0x98dfb5ac, 0x2ffd72db, 0xd01adfb7, 0xb8e1afed, 0x6a267e96, 0xba7c9045, 0xf12c7f99,
      0x24a19947, 0xb3916cf7, 0x0801f2e2, 0x858efc16, 0x636920d8, 0x71574e69, 0xa458fea3, 0xf4933d7e,
      0x0d95748f, 0x728eb658, 0x718bcd58, 0x82154aee, 0x7b54a41d, 0xc25a59b5, 0x9c30d539, 0x2af26013,
      0xc5d1b023, 0x286085f0, 0xca417918, 0xb8db38ef, 0x8e79dcb0, 0x603a180e, 0x6c9e0e8b, 0xb01e8a3e,
      0xd71577c1, 0xbd314b27, 0x78af2fda, 0x55605c60, 0xe65525f3, 0xaa55ab94, 0x57489862, 0x63e81440,
      0x55ca396a, 0x2aab10b6, 0xb4cc5c34, 0x1141e8ce, 0xa15486af, 0x7c72e993, 0xb3ee1411, 0x636fbc2a,
      0x2ba9c55d, 0x741831f6, 0xce5c3e16, 0x9b87931e, 0xafd6ba33, 0x6c24cf5c, 0x7a325381, 0x28958677,
      0x3b8f4898, 0x6b4bb9af, 0xc4bfe81b, 0x66282193, 0x61d809cc, 0xfb21a991, 0x487cac60, 0x5dec8032,
      0xef845d5d, 0xe98575b1, 0xdc262302, 0xeb651b88, 0x23893e81, 0xd396acc5, 0x0f6d6ff3, 0x83f44239,
      0x2e0b4482, 0xa4842004, 0x69c8f04a, 0x9e1f9b5e, 0x21c66842, 0xf6e96c9a, 0x670c9c61, 0xabd388f0,
      0x6a51a0d2, 0xd8542f68, 0x960fa728, 0xab5133a3, 0x6eef0b6c, 0x137a3be4, 0xba3bf050, 0x7efb2a98,
      0xa1f1651d, 0x39af0176, 0x66ca593e, 0x82430e88, 0x8cee8619, 0x456f9fb4, 0x7d84a5c3, 0x3b8b5ebe,
      0xe06f75d8, 0x85c12073, 0x401a449f, 0x56c16aa6, 0x4ed3aa62, 0x363f7706, 0x1bfedf72, 0x429b023d,
      0x37d0d724, 0xd00a1248, 0xdb0fead3, 0x49f1c09b, 0x075372c9, 0x80991b7b, 0x25d479d8, 0xf6e8def7,
      0xe3fe501a, 0xb6794c3b, 0x976ce0bd, 0x04c006ba, 0xc1a94fb6, 0x409f60c4, 0x5e5c9ec2, 0x196a2463,
      0x68fb6faf, 0x3e6c53b5, 0x1339b2eb, 0x3b52ec6f, 0x6dfc511f, 0x9b30952c, 0xcc814544, 0xaf5ebd09,
      0xbee3d004, 0xde334afd, 0x660f2807, 0x192e4bb3, 0xc0cba857, 0x45c8740f, 0xd20b5f39, 0xb9d3fbdb,
      0x5579c0bd, 0x1a60320a, 0xd6a100c6, 0x402c7279, 0x679f25fe, 0xfb1fa3cc, 0x8ea5e9f8, 0xdb3222f8,
      0x3c7516df, 0xfd616b15, 0x2f501ec8, 0xad0552ab, 0x323db5fa, 0xfd238760, 0x53317b48, 0x3e00df82,
      0x9e5c57bb, 0xca6f8ca0, 0x1a87562e, 0xdf1769db, 0xd542a8f6, 0x287effc3, 0xac6732c6, 0x8c4f5573,
      0x695b27b0, 0xbbca58c8, 0xe1ffa35d, 0xb8f011a0, 0x10fa3d98, 0xfd2183b8, 0x4afcb56c, 0x2dd1d35b,
      0x9a53e479, 0xb6f84565, 0xd28e49bc, 0x4bfb9790, 0xe1ddf2da, 0xa4cb7e33, 0x62fb1341, 0xcee4c6e8,
      0xef20cada, 0x36774c01, 0xd07e9efe, 0x2bf11fb4, 0x95dbda4d, 0xae909198, 0xeaad8e71, 0x6b93d5a0,
      0xd08ed1d0, 0xafc725e0, 0x8e3c5b2f, 0x8e7594b7, 0x8ff6e2fb, 0xf2122b64, 0x8888b812, 0x900df01c,
      0x4fad5ea0, 0x688fc31c, 0xd1cff191, 0xb3a8c1ad, 0x2f2f2218, 0xbe0e1777, 0xea752dfe, 0x8b021fa1,
      0xe5a0cc0f, 0xb56f74e8, 0x18acf3d6, 0xce89e299, 0xb4a84fe0, 0xfd13e0b7, 0x7cc43b81, 0xd2ada8d9,
      0x165fa266, 0x80957705, 0x93cc7314, 0x211a1477, 0xe6ad2065, 0x77b5fa86, 0xc75442f5, 0xfb9d35cf,
      0xebcdaf0c, 0x7b3e89a0, 0xd6411bd3, 0xae1e7e49, 0x00250e2d, 0x2071b35e, 0x226800bb, 0x57b8e0af,
      0x2464369b, 0xf009b91e, 0x5563911d, 0x59dfa6aa, 0x78c14389, 0xd95a537f, 0x207d5ba2, 0x02e5b9c5,
      0x83260376, 0x6295cfa9, 0x11c81968, 0x4e734a41, 0xb3472dca, 0x7b14a94a, 0x1b510052, 0x9a532915,
      0xd60f573f, 0xbc9bc6e4, 0x2b60a476, 0x81e67400, 0x08ba6fb5, 0x571be91f, 0xf296ec6b, 0x2a0dd915,
      0xb6636521, 0xe7b9f9b6, 0xff34052e, 0xc5855664, 0x53b02d5d, 0xa99f8fa1, 0x08ba4799, 0x6e85076a,
      0x4b7a70e9, 0xb5b32944, 0xdb75092e, 0xc4192623, 0xad6ea6b0, 0x49a7df7d, 0x9cee60b8, 0x8fedb266,
      0xecaa8c71, 0x699a17ff, 0x5664526c, 0xc2b19ee1, 0x193602a5, 0x75094c29, 0xa0591340, 0xe4183a3e,
      0x3f54989a, 0x5b429d65, 0x6b8fe4d6, 0x99f73fd6, 0xa1d29c07, 0xefe830f5, 0x4d2d38e6, 0xf0255dc1,
      0x4cdd2086, 0x8470eb26, 0x6382e9c6, 0x021ecc5e, 0x09686b3f, 0x3ebaefc9, 0x3c971814, 0x6b6a70a1,
      0x687f3584, 0x52a0e286, 0xb79c5305, 0xaa500737, 0x3e07841c, 0x7fdeae5c, 0x8e7d44ec, 0x5716f2b8,
      0xb03ada37, 0xf0500c0d, 0xf01c1f04, 0x0200b3ff, 0xae0cf51a, 0x3cb574b2, 0x25837a58, 0xdc0921bd,
      0xd19113f9, 0x7ca92ff6, 0x94324773, 0x22f54701, 0x3ae5e581, 0x37c2dadc, 0xc8b57634, 0x9af3dda7,
      0xa9446146, 0x0fd0030e, 0xecc8c73e, 0xa4751e41, 0xe238cd99, 0x3bea0e2f, 0x3280bba1, 0x183eb331,
      0x4e548b38, 0x4f6db908, 0x6f420d03, 0xf60a04bf, 0x2cb81290, 0x24977c79, 0x5679b072, 0xbcaf89af,
      0xde9a771f, 0xd9930810, 0xb38bae12, 0xdccf3f2e, 0x5512721f, 0x2e6b7124, 0x501adde6, 0x9f84cd87,
      0x7a584718, 0x7408da17, 0xbc9f9abc, 0xe94b7d8c, 0xec7aec3a, 0xdb851dfa, 0x63094366, 0xc464c3d2,
      0xef1c1847, 0x3215d908, 0xdd433b37, 0x24c2ba16, 0x12a14d43, 0x2a65c451, 0x50940002, 0x133ae4dd,
      0x71dff89e, 0x10314e55, 0x81ac77d6, 0x5f11199b, 0x043556f1, 0xd7a3c76b, 0x3c11183b, 0x5924a509,
      0xf28fe6ed, 0x97f1fbfa, 0x9ebabf2c, 0x1e153c6e, 0x86e34570, 0xeae96fb1, 0x860e5e0a, 0x5a3e2ab3,
      0x771fe71c, 0x4e3d06fa, 0x2965dcb9, 0x99e71d0f, 0x803e89d6, 0x5266c825, 0x2e4cc978, 0x9c10b36a,
      0xc6150eba, 0x94e2ea78, 0xa5fc3c53, 0x1e0a2df4, 0xf2f74ea7, 0x361d2b3d, 0x1939260f, 0x19c27960,
      0x5223a708, 0xf71312b6, 0xebadfe6e, 0xeac31f66, 0xe3bc4595, 0xa67bc883, 0xb17f37d1, 0x018cff28,
      0xc332ddef, 0xbe6c5aa5, 0x65582185, 0x68ab9802, 0xeecea50f, 0xdb2f953b, 0x2aef7dad, 0x5b6e2f84,
      0x1521b628, 0x29076170, 0xecdd4775, 0x619f1510, 0x13cca830, 0xeb61bd96, 0x0334fe1e, 0xaa0363cf,
      0xb5735c90, 0x4c70a239, 0xd59e9e0b, 0xcbaade14, 0xeecc86bc, 0x60622ca7, 0x9cab5cab, 0xb2f3846e,
      0x648b1eaf, 0x19bdf0ca, 0xa02369b9, 0x655abb50, 0x40685a32, 0x3c2ab4b3, 0x319ee9d5, 0xc021b8f7,
      0x9b540b19, 0x875fa099, 0x95f7997e, 0x623d7da8, 0xf837889a, 0x97e32d77, 0x11ed935f, 0x16681281,
      0x0e358829, 0xc7e61fd6, 0x96dedfa1, 0x7858ba99, 0x57f584a5, 0x1b227263, 0x9b83c3ff, 0x1ac24696,
      0xcdb30aeb, 0x532e3054, 0x8fd948e4, 0x6dbc3128, 0x58ebf2ef, 0x34c6ffea, 0xfe28ed61, 0xee7c3c73,
      0x5d4a14d9, 0xe864b7e3, 0x42105d14, 0x203e13e0, 0x45eee2b6, 0xa3aaabea, 0xdb6c4f15, 0xfacb4fd0,
      0xc742f442, 0xef6abbb5, 0x654f3b1d, 0x41cd2105, 0xd81e799e, 0x86854dc7, 0xe44b476a, 0x3d816250,
      0xcf62a1f2, 0x5b8d2646, 0xfc8883a0, 0xc1c7b6a3, 0x7f1524c3, 0x69cb7492, 0x47848a0b, 0x5692b285,
      0x095bbf00, 0xad19489d, 0x1462b174, 0x23820e00, 0x58428d2a, 0x0c55f5ea, 0x1dadf43e, 0x233f7061,
      0x3372f092, 0x8d937e41, 0xd65fecf1, 0x6c223bdb, 0x7cde3759, 0xcbee7460, 0x4085f2a7, 0xce77326e,
      0xa6078084, 0x19f8509e, 0xe8efd855, 0x61d99735, 0xa969a7aa, 0xc50c06c2, 0x5a04abfc, 0x800bcadc,
      0x9e447a2e, 0xc3453484, 0xfdd56705, 0x0e1e9ec9, 0xdb73dbd3, 0x105588cd, 0x675fda79, 0xe3674340,
      0xc5c43465, 0x713e38d8, 0x3d28f89e, 0xf16dff20, 0x153e21e7, 0x8fb03d4a, 0xe6e39f2b, 0xdb83adf7,
      0xe93d5a68, 0x948140f7, 0xf64c261c, 0x94692934, 0x411520f7, 0x7602d4f7, 0xbcf46b2e, 0xd4a20068,
      0xd4082471, 0x3320f46a, 0x43b7d4b7, 0x500061af, 0x1e39f62e, 0x97244546, 0x14214f74, 0xbf8b8840,
      0x4d95fc1d, 0x96b591af, 0x70f4ddd3, 0x66a02f45, 0xbfbc09ec, 0x03bd9785, 0x7fac6dd0, 0x31cb8504,
      0x96eb27b3, 0x55fd3941, 0xda2547e6, 0xabca0a9a, 0x28507825, 0x530429f4, 0x0a2c86da, 0xe9b66dfb,
      0x68dc1462, 0xd7486900, 0x680ec0a4, 0x27a18dee, 0x4f3ffea2, 0xe887ad8c, 0xb58ce006, 0x7af4d6b6,
      0xaace1e7c, 0xd3375fec, 0xce78a399, 0x406b2a42, 0x20fe9e35, 0xd9f385b9, 0xee39d7ab, 0x3b124e8b,
      0x1dc9faf7, 0x4b6d1856, 0x26a36631, 0xeae397b2, 0x3a6efa74, 0xdd5b4332, 0x6841e7f7, 0xca7820fb,
      0xfb0af54e, 0xd8feb397, 0x454056ac, 0xba489527, 0x55533a3a, 0x20838d87, 0xfe6ba9b7, 0xd096954b,
      0x55a867bc, 0xa1159a58, 0xcca92963, 0x99e1db33, 0xa62a4a56, 0x3f3125f9, 0x5ef47e1c, 0x9029317c,
      0xfdf8e802, 0x04272f70, 0x80bb155c, 0x05282ce3, 0x95c11548, 0xe4c66d22, 0x48c1133f, 0xc70f86dc,
      0x07f9c9ee, 0x41041f0f, 0x404779a4, 0x5d886e17, 0x325f51eb, 0xd59bc0d1, 0xf2bcc18f, 0x41113564,
      0x257b7834, 0x602a9c60, 0xdff8e8a3, 0x1f636c1b, 0x0e12b4c2, 0x02e1329e, 0xaf664fd1, 0xcad18115,
      0x6b2395e0, 0x333e92e1, 0x3b240b62, 0xeebeb922, 0x85b2a20e, 0xe6ba0d99, 0xde720c8c, 0x2da2f728,
      0xd0127845, 0x95b794fd, 0x647d0862, 0xe7ccf5f0, 0x5449a36f, 0x877d48fa, 0xc39dfd27, 0xf33e8d1e,
      0x0a476341, 0x992eff74, 0x3a6f6eab, 0xf4f8fd37, 0xa812dc60, 0xa1ebddf8, 0x991be14c, 0xdb6e6b0d,
      0xc67b5510, 0x6d672c37, 0x2765d43b, 0xdcd0e804, 0xf1290dc7, 0xcc00ffa3, 0xb5390f92, 0x690fed0b,
      0x667b9ffb, 0xcedb7d9c, 0xa091cf0b, 0xd9155ea3, 0xbb132f88, 0x515bad24, 0x7b9479bf, 0x763bd6eb,
      0x37392eb3, 0xcc115979, 0x8026e297, 0xf42e312d, 0x6842ada7, 0xc66a2b3b, 0x12754ccc, 0x782ef11c,
      0x6a124237, 0xb79251e7, 0x06a1bbe6, 0x4bfb6350, 0x1a6b1018, 0x11caedfa, 0x3d25bdd8, 0xe2e1c3c9,
      0x44421659, 0x0a121386, 0xd90cec6e, 0xd5abea2a, 0x64af674e, 0xda86a85f, 0xbebfe988, 0x64e4c3fe,
      0x9dbc8057, 0xf0f7c086, 0x60787bf8, 0x6003604d, 0xd1fd8346, 0xf6381fb0, 0x7745ae04, 0xd736fccc,
      0x83426b33, 0xf01eab71, 0xb0804187, 0x3c005e5f, 0x77a057be, 0xbde8ae24, 0x55464299, 0xbf582e61,
      0x4e58f48f, 0xf2ddfda2, 0xf474ef38, 0x8789bdc2, 0x5366f9c3, 0xc8b38e74, 0xb475f255, 0x46fcd9b9,
      0x7aeb2661, 0x8b1ddf84, 0x846a0e79, 0x915f95e2, 0x466e598e, 0x20b45770, 0x8cd55591, 0xc902de4c,
      0xb90bace1, 0xbb8205d0, 0x11a86248, 0x7574a99e, 0xb77f19b6, 0xe0a9dc09, 0x662d09a1, 0xc4324633,
      0xe85a1f02, 0x09f0be8c, 0x4a99a025, 0x1d6efe10, 0x1ab93d1d, 0x0ba5a4df, 0xa186f20f, 0x2868f169,
      0xdcb7da83, 0x573906fe, 0xa1e2ce9b, 0x4fcd7f52, 0x50115e01, 0xa70683fa, 0xa002b5c4, 0x0de6d027,
      0x9af88c27, 0x773f8641, 0xc3604c06, 0x61a806b5, 0xf0177a28, 0xc0f586e0, 0x006058aa, 0x30dc7d62,
      0x11e69ed7, 0x2338ea63, 0x53c2dd94, 0xc2c21634, 0xbbcbee56, 0x90bcb6de, 0xebfc7da1, 0xce591d76,
      0x6f05e409, 0x4b7c0188, 0x39720a3d, 0x7c927c24, 0x86e3725f, 0x724d9db9, 0x1ac15bb4, 0xd39eb8fc,
      0xed545578, 0x08fca5b5, 0xd83d7cd3, 0x4dad0fc4, 0x1e50ef5e, 0xb161e6f8, 0xa28514d9, 0x6c51133c,
      0x6fd5c7e7, 0x56e14ec4, 0x362abfce, 0xddc6c837, 0xd79a3234, 0x92638212, 0x670efa8e, 0x406000e0,
      0x3a39ce37, 0xd3faf5cf, 0xabc27737, 0x5ac52d1b, 0x5cb0679e, 0x4fa33742, 0xd3822740, 0x99bc9bbe,
      0xd5118e9d, 0xbf0f7315, 0xd62d1c7e, 0xc700c47b, 0xb78c1b6b, 0x21a19045, 0xb26eb1be, 0x6a366eb4,
      0x5748ab2f, 0xbc946e79, 0xc6a376d2, 0x6549c2c8, 0x530ff8ee, 0x468dde7d, 0xd5730a1d, 0x4cd04dc6,
      0x2939bbdb, 0xa9ba4650, 0xac9526e8, 0xbe5ee304, 0xa1fad5f0, 0x6a2d519a, 0x63ef8ce2, 0x9a86ee22,
      0xc089c2b8, 0x43242ef6, 0xa51e03aa, 0x9cf2d0a4, 0x83c061ba, 0x9be96a4d, 0x8fe51550, 0xba645bd6,
      0x2826a2f9, 0xa73a3ae1, 0x4ba99586, 0xef5562e9, 0xc72fefd3, 0xf752f7da, 0x3f046f69, 0x77fa0a59,
      0x80e4a915, 0x87b08601, 0x9b09e6ad, 0x3b3ee593, 0xe990fd5a, 0x9e34d797, 0x2cf0b7d9, 0x022b8b51,
      0x96d5ac3a, 0x017da67d, 0xd1cf3ed6, 0x7c7d2d28, 0x1f9f25cf, 0xadf2b89b, 0x5ad6b472, 0x5a88f54c,
      0xe029ac71, 0xe019a5e6, 0x47b0acfd, 0xed93fa9b, 0xe8d3c48d, 0x283b57cc, 0xf8d56629, 0x79132e28,
      0x785f0191, 0xed756055, 0xf7960e44, 0xe3d35e8c, 0x15056dd4, 0x88f46dba, 0x03a16125, 0x0564f0bd,
      0xc3eb9e15, 0x3c9057a2, 0x97271aec, 0xa93a072a, 0x1b3f6d9b, 0x1e6321f5, 0xf59c66fb, 0x26dcf319,
      0x7533d928, 0xb155fdf5, 0x03563482, 0x8aba3cbb, 0x28517711, 0xc20ad9f8, 0xabcc5167, 0xccad925f,
      0x4de81751, 0x3830dc8e, 0x379d5862, 0x9320f991, 0xea7a90c2, 0xfb3e7bce, 0x5121ce64, 0x774fbe32,
      0xa8b6e37e, 0xc3293d46, 0x48de5369, 0x6413e680, 0xa2ae0810, 0xdd6db224, 0x69852dfd, 0x09072166,
      0xb39a460a, 0x6445c0dd, 0x586cdecf, 0x1c20c8ae, 0x5bbef7dd, 0x1b588d40, 0xccd2017f, 0x6bb4e3bb,
      0xdda26a7e, 0x3a59ff45, 0x3e350a44, 0xbcb4cdd5, 0x72eacea8, 0xfa6484bb, 0x8d6612ae, 0xbf3c6f47,
      0xd29be463, 0x542f5d9e, 0xaec2771b, 0xf64e6370, 0x740e0d8d, 0xe75b1357, 0xf8721671, 0xaf537d5d,
      0x4040cb08, 0x4eb4e2cc, 0x34d2466a, 0x0115af84, 0xe1b00428, 0x95983a1d, 0x06b89fb4, 0xce6ea048,
      0x6f3f3b82, 0x3520ab82, 0x011a1d4b, 0x277227f8, 0x611560b1, 0xe7933fdc, 0xbb3a792b, 0x344525bd,
      0xa08839e1, 0x51ce794b, 0x2f32c9b7, 0xa01fbac9, 0xe01cc87e, 0xbcc7d1f6, 0xcf0111c3, 0xa1e8aac7,
      0x1a908749, 0xd44fbd9a, 0xd0dadecb, 0xd50ada38, 0x0339c32a, 0xc6913667, 0x8df9317c, 0xe0b12b4f,
      0xf79e59b7, 0x43f5bb3a, 0xf2d519ff, 0x27d9459c, 0xbf97222c, 0x15e6fc2a, 0x0f91fc71, 0x9b941525,
      0xfae59361, 0xceb69ceb, 0xc2a86459, 0x12baa8d1, 0xb6c1075e, 0xe3056a0c, 0x10d25065, 0xcb03a442,
      0xe0ec6e0e, 0x1698db3b, 0x4c98a0be, 0x3278e964, 0x9f1f9532, 0xe0d392df, 0xd3a0342b, 0x8971f21e,
      0x1b0a7441, 0x4ba3348c, 0xc5be7120, 0xc37632d8, 0xdf359f8d, 0x9b992f2e, 0xe60b6f47, 0x0fe3f11d,
      0xe54cda54, 0x1edad891, 0xce6279cf, 0xcd3e7e6f, 0x1618b166, 0xfd2c1d05, 0x848fd2c5, 0xf6fb2299,
      0xf523f357, 0xa6327623, 0x93a83531, 0x56cccd02, 0xacf08162, 0x5a75ebb5, 0x6e163697, 0x88d273cc,
      0xde966292, 0x81b949d0, 0x4c50901b, 0x71c65614, 0xe6c6c7bd, 0x327a140a, 0x45e1d006, 0xc3f27b9a,
      0xc9aa53fd, 0x62a80f00, 0xbb25bfe2, 0x35bdd2f6, 0x71126905, 0xb2040222, 0xb6cbcf7c, 0xcd769c2b,
      0x53113ec0, 0x1640e3d3, 0x38abbd60, 0x2547adf0, 0xba38209c, 0xf746ce76, 0x77afa1c5, 0x20756060,
      0x85cbfe4e, 0x8ae88dd8, 0x7aaaf9b0, 0x4cf9aa7e, 0x1948c25c, 0x02fb8a8c, 0x01c36ae4, 0xd6ebe1f9,
      0x90d4f869, 0xa65cdea0, 0x3f09252d, 0xc208e69f, 0xb74e6132, 0xce77e25b, 0x578fdfe3, 0x3ac372e6
    ];
    var BF_DEC = [
      -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
      -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
      -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,  0,  1,
      54, 55, 56, 57, 58, 59, 60, 61, 62, 63, -1, -1, -1, -1, -1, -1,
      -1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16,
      17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, -1, -1, -1, -1, -1,
      -1, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
      43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, -1, -1, -1, -1, -1
    ];

    function decodeB64(s, len) {
      var off = 0, slen = s.length, olen = 0, rs = [], c1, c2, c3, c4, o;
      while (off < slen - 1 && olen < len) {
        c1 = BF_DEC[s.charCodeAt(off++)];
        c2 = BF_DEC[s.charCodeAt(off++)];
        if (c1 === -1 || c2 === -1) break;
        o = ((c1 << 2) | ((c2 & 0x30) >> 4)) & 0xff;
        rs.push(o > 127 ? o - 256 : o);
        if (++olen >= len || off >= slen) break;
        c3 = BF_DEC[s.charCodeAt(off++)];
        if (c3 === -1) break;
        o = (((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2)) & 0xff;
        rs.push(o > 127 ? o - 256 : o);
        if (++olen >= len || off >= slen) break;
        c4 = BF_DEC[s.charCodeAt(off++)];
        o = (((c3 & 0x03) << 6) | c4) & 0xff;
        rs.push(o > 127 ? o - 256 : o);
        ++olen;
      }
      return rs;
    }

    function encodeB64(d, len) {
      var off = 0, rs = '', c1, c2;
      while (off < len) {
        c1 = d[off++] & 0xff;
        rs += BASE64_CODE.charAt((c1 >> 2) & 0x3f);
        c1 = (c1 & 0x03) << 4;
        if (off >= len) { rs += BASE64_CODE.charAt(c1 & 0x3f); break; }
        c2 = d[off++] & 0xff;
        c1 |= (c2 >> 4) & 0x0f;
        rs += BASE64_CODE.charAt(c1 & 0x3f);
        c1 = (c2 & 0x0f) << 2;
        if (off >= len) { rs += BASE64_CODE.charAt(c1 & 0x3f); break; }
        c2 = d[off++] & 0xff;
        c1 |= (c2 >> 6) & 0x03;
        rs += BASE64_CODE.charAt(c1 & 0x3f);
        rs += BASE64_CODE.charAt(c2 & 0x3f);
      }
      return rs;
    }

    function utf8Bytes(str) {
      var encoded = unescape(encodeURIComponent(String(str)));
      var out = [];
      for (var i = 0; i < encoded.length; i++) {
        var b = encoded.charCodeAt(i) & 0xff;
        out.push(b > 127 ? b - 256 : b);
      }
      out.push(0);
      return out;
    }

    var minor = hash.charAt(2);
    var rounds = parseInt(hash.substring(4, 6), 10);
    if (isNaN(rounds) || rounds < 4 || rounds > 15) return false;
    var saltb = decodeB64(hash.substring(7, 29), 16);
    var pwd = utf8Bytes(password);

    var P = BF_P_ORIG.slice();
    var S = BF_S_ORIG.slice();

    function encipher(lr, off) {
      var n, l = lr[off], r = lr[off + 1];
      l ^= P[0];
      for (n = 0; n <= 14;) {
        r ^= (((S[(l >>> 24) & 0xff] + S[0x100 + ((l >>> 16) & 0xff)]) ^ S[0x200 + ((l >>> 8) & 0xff)]) + S[0x300 + (l & 0xff)]) ^ P[++n];
        l ^= (((S[(r >>> 24) & 0xff] + S[0x100 + ((r >>> 16) & 0xff)]) ^ S[0x200 + ((r >>> 8) & 0xff)]) + S[0x300 + (r & 0xff)]) ^ P[++n];
      }
      lr[off] = r ^ P[17];
      lr[off + 1] = l;
    }

    function streamtoword(data, offp) {
      var i, word = 0, off = offp[0];
      for (i = 0; i < 4; i++) {
        word = (word << 8) | (data[off] & 0xff);
        off = (off + 1) % data.length;
      }
      offp[0] = off;
      return word;
    }

    function key(k) {
      var i, lr = [0, 0], koffp = [0];
      for (i = 0; i < 18; i++) P[i] ^= streamtoword(k, koffp);
      for (i = 0; i < 18; i += 2) { encipher(lr, 0); P[i] = lr[0]; P[i + 1] = lr[1]; }
      for (i = 0; i < 1024; i += 2) { encipher(lr, 0); S[i] = lr[0]; S[i + 1] = lr[1]; }
    }

    function ekskey(data, k) {
      var i, lr = [0, 0], koffp = [0], doffp = [0];
      for (i = 0; i < 18; i++) P[i] ^= streamtoword(k, koffp);
      for (i = 0; i < 18; i += 2) {
        lr[0] ^= streamtoword(data, doffp);
        lr[1] ^= streamtoword(data, doffp);
        encipher(lr, 0);
        P[i] = lr[0];
        P[i + 1] = lr[1];
      }
      for (i = 0; i < 1024; i += 2) {
        lr[0] ^= streamtoword(data, doffp);
        lr[1] ^= streamtoword(data, doffp);
        encipher(lr, 0);
        S[i] = lr[0];
        S[i + 1] = lr[1];
      }
    }

    ekskey(saltb, pwd);
    var totalRounds = 1 << rounds;
    for (var i = 0; i < totalRounds; i++) {
      key(pwd);
      key(saltb);
    }

    var cdata = [
      0x4f727068, 0x65616e42, 0x65686f6c,
      0x64657253, 0x63727944, 0x6f756274
    ];
    for (var c = 0; c < 64; c++) {
      for (var j = 0; j < 6; j += 2) encipher(cdata, j);
    }

    var ret = [];
    for (var m = 0; m < 6; m++) {
      ret.push((cdata[m] >> 24) & 0xff);
      ret.push((cdata[m] >> 16) & 0xff);
      ret.push((cdata[m] >> 8) & 0xff);
      ret.push(cdata[m] & 0xff);
    }
    var computed = '$2' + (minor === 'a' || minor === 'b' || minor === 'y' ? minor : 'a') +
      '$' + (rounds < 10 ? '0' + rounds : rounds) + '$' + encodeB64(saltb, 16) + encodeB64(ret, 23);
    return computed === hash.substring(0, computed.length);
  } catch (e) {
    return false;
  }
}

// ============================================================================
// GOOGLE SHEETS LOW-LEVEL ENGINE (13 Tabs, Partial Update, Soft Delete, Log)
// ============================================================================

function ensureSheetsAndHeaders_(ss) {
  var allTabs = [];
  for (var k in SHEET_TABS) {
    if (Object.prototype.hasOwnProperty.call(SHEET_TABS, k)) {
      allTabs.push(SHEET_TABS[k]);
    }
  }

  for (var i = 0; i < allTabs.length; i++) {
    var tabName = allTabs[i];
    var headers = SHEET_HEADERS[tabName];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.setFrozenRows(1);
    }
    var lastCol = sheet.getLastColumn();
    var needsHeader = lastCol < headers.length || sheet.getLastRow() === 0;
    if (!needsHeader) {
      var existingRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
      for (var c = 0; c < headers.length; c++) {
        if (String(existingRow[c] || '').trim() !== headers[c]) {
          needsHeader = true;
          break;
        }
      }
    }
    if (needsHeader) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }
}

function readTabWithRowNumbers_(ss, tabName) {
  var headers = SHEET_HEADERS[tabName];
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    ensureSheetsAndHeaders_(ss);
    sheet = ss.getSheetByName(tabName);
  }
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  var results = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
    }
    if (obj.id) {
      results.push({ rowNumber: i + 2, data: obj });
    }
  }
  return results;
}

function objToRowArray_(tabName, obj) {
  var headers = SHEET_HEADERS[tabName];
  var arr = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    var v = obj[h];
    if (v === undefined || v === null) {
      arr.push('');
    } else if (Array.isArray(v) || typeof v === 'object') {
      arr.push(JSON.stringify(v));
    } else {
      arr.push(v);
    }
  }
  return arr;
}

function appendRows_(ss, tabName, rowObjects) {
  if (!rowObjects || rowObjects.length === 0) return;
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    ensureSheetsAndHeaders_(ss);
    sheet = ss.getSheetByName(tabName);
  }
  for (var i = 0; i < rowObjects.length; i++) {
    sheet.appendRow(objToRowArray_(tabName, rowObjects[i]));
  }
}

function appendLog_(ss, entry) {
  var nowIso = entry.waktu || new Date().toISOString();
  appendRows_(ss, SHEET_TABS.LOG, [{
    id: randomId_('log'),
    waktu: nowIso,
    pengguna: entry.pengguna || 'Sistem',
    id_data: entry.id_data || '-',
    tabel: entry.tabel || '-',
    aksi: entry.aksi || 'edit',
    nilai_lama: entry.nilai_lama || '',
    nilai_baru: entry.nilai_baru || '',
    reason: entry.reason || '',
    status: 'aktif',
    diubah_pada: nowIso,
  }]);
}

function updateRowPartial_(ss, opts) {
  var tabName = opts.tabName;
  var id = opts.id;
  var newRowObj = opts.newRowObj || {};
  var expectedUpdatedAt = opts.expectedUpdatedAt;
  var forceOverwrite = opts.forceOverwrite;
  var actorName = opts.actorName || 'Sistem';
  var reason = opts.reason || '';
  var skipLog = Boolean(opts.skipLog);

  var headers = SHEET_HEADERS[tabName];
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { updated: false };

  var rows = readTabWithRowNumbers_(ss, tabName);
  var match = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].data.id === id) {
      match = rows[i];
      break;
    }
  }
  if (!match || match.data.status === 'dihapus') {
    return { updated: false };
  }

  var existing = match.data;
  if (!forceOverwrite && expectedUpdatedAt && existing.diubah_pada && existing.diubah_pada !== expectedUpdatedAt) {
    return { updated: false, conflict: true, current: existing };
  }

  var nowIso = new Date().toISOString();
  var target = {};
  var k;
  for (k in existing) {
    if (Object.prototype.hasOwnProperty.call(existing, k)) target[k] = existing[k];
  }
  for (k in newRowObj) {
    if (Object.prototype.hasOwnProperty.call(newRowObj, k)) target[k] = newRowObj[k];
  }
  target.id = id;
  target.status = newRowObj.status || existing.status || 'aktif';
  target.diubah_pada = newRowObj.diubah_pada || nowIso;
  if (headers.indexOf('updated_at') >= 0) {
    target.updated_at = newRowObj.updated_at || nowIso;
  }

  var oldDiff = {};
  var newDiff = {};
  var changedAny = false;

  for (var c = 0; c < headers.length; c++) {
    var col = headers[c];
    var oldValStr = existing[col] !== undefined ? existing[col] : '';
    var rawNew = target[col];
    var newValStr = (rawNew === undefined || rawNew === null)
      ? ''
      : (Array.isArray(rawNew) || typeof rawNew === 'object')
      ? JSON.stringify(rawNew)
      : String(rawNew);

    if (oldValStr !== newValStr) {
      sheet.getRange(match.rowNumber, c + 1).setValue(
        (Array.isArray(rawNew) || typeof rawNew === 'object') ? newValStr : (rawNew === undefined || rawNew === null ? '' : rawNew)
      );
      changedAny = true;
      if (col !== 'diubah_pada' && col !== 'updated_at') {
        oldDiff[col] = oldValStr;
        newDiff[col] = newValStr;
      }
    }
  }

  if (changedAny && !skipLog && Object.keys(newDiff).length > 0) {
    appendLog_(ss, {
      waktu: nowIso,
      pengguna: actorName,
      id_data: id,
      tabel: tabName,
      aksi: 'edit',
      nilai_lama: JSON.stringify(oldDiff),
      nilai_baru: JSON.stringify(newDiff),
      reason: reason,
    });
  }

  return { updated: true, oldObj: existing };
}

function softDeleteRow_(ss, opts) {
  var tabName = opts.tabName;
  var id = opts.id;
  var actorName = opts.actorName || 'Petugas';
  var reason = opts.reason || 'Soft delete';

  var headers = SHEET_HEADERS[tabName];
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return false;

  var rows = readTabWithRowNumbers_(ss, tabName);
  var match = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].data.id === id && rows[i].data.status !== 'dihapus') {
      match = rows[i];
      break;
    }
  }
  if (!match) return false;

  var nowIso = new Date().toISOString();
  var statusIdx = headers.indexOf('status');
  var changedIdx = headers.indexOf('diubah_pada');
  var updatedIdx = headers.indexOf('updated_at');

  if (statusIdx >= 0) sheet.getRange(match.rowNumber, statusIdx + 1).setValue('dihapus');
  if (changedIdx >= 0) sheet.getRange(match.rowNumber, changedIdx + 1).setValue(nowIso);
  if (updatedIdx >= 0) sheet.getRange(match.rowNumber, updatedIdx + 1).setValue(nowIso);

  appendLog_(ss, {
    waktu: nowIso,
    pengguna: actorName,
    id_data: id,
    tabel: tabName,
    aksi: 'hapus',
    nilai_lama: JSON.stringify(match.data),
    nilai_baru: JSON.stringify({ status: 'dihapus' }),
    reason: reason,
  });

  return true;
}

// ============================================================================
// DEFAULT SEEDS & FULL DATABASE SNAPSHOT
// ============================================================================

function defaultSettings_(nowIso) {
  return {
    school_name: 'DISIPLIN KITA BISA — SMK NEGERI',
    logo_url: '',
    background_url: '',
    accent_color: '#0f172a',
    theme: 'light',
    tts_enabled: true,
    tts_rate: 1.0,
    tts_pitch: 1.0,
    tts_volume: 1.0,
    tts_template_present: 'Selamat datang, {nama}. Anda tercatat hadir tepat waktu.',
    tts_template_late: 'Perhatian, {nama}. Anda terlambat {menit} menit. Segera ke kelas.',
    tts_template_out_of_class: 'Izin keluar tercatat untuk {nama}. Batas waktu {durasi} menit.',
    tts_template_overdue: 'Peringatan, {nama} telah melebihi batas waktu izin keluar kelas.',
    discipline_late_weight: 2,
    discipline_alpha_weight: 10,
    discipline_late_return_weight: 3,
    discipline_full_attendance_bonus: 5,
    out_of_class_max_per_class: 2,
    out_of_class_max_per_student_daily: 3,
    out_of_class_bak_duration: 5,
    out_of_class_bab_duration: 10,
    out_of_class_other_duration: 15,
    toggle_allow_edit_violation_points: true,
    toggle_email_notifications: true,
    toggle_kiosk_mode: false,
    auto_session_switch: true,
    auto_session_switch_notify: true,
    updated_at: nowIso,
    diubah_pada: nowIso,
  };
}

function defaultNotificationSettings_(nowIso) {
  return {
    email_enabled: true,
    trigger_late: true,
    trigger_alpha: true,
    trigger_leave: true,
    trigger_violation: true,
    trigger_warning_threshold: true,
    trigger_overdue_out_of_class: true,
    warning_threshold_points: 25,
    subject_template: 'Pemberitahuan Kedisiplinan Siswa: {nama_siswa} ({kelas})',
    body_template: 'Yth. Orang Tua/Wali dari {nama_siswa},\n\nKami menginformasikan catatan kedisiplinan siswa pada tanggal {tanggal} pukul {jam}:\nStatus / Kejadian: {status}\nDetail: {pelanggaran} (Poin: {poin}, Menit Terlambat Kembali: {menit_terlambat_kembali})\nSekolah: {nama_sekolah}\n\nTerima kasih atas kerja samanya.',
    weekly_recap_enabled: false,
    weekly_recap_day: 5,
    weekly_recap_time: '15:00',
    weekly_recap_last_sent: '',
    updated_at: nowIso,
    diubah_pada: nowIso,
  };
}

function ensureSeedData_(ss) {
  var nowIso = new Date().toISOString();

  var usersRows = readTabWithRowNumbers_(ss, SHEET_TABS.USERS).filter(function (r) { return r.data.status !== 'dihapus'; });
  if (usersRows.length === 0) {
    appendRows_(ss, SHEET_TABS.USERS, [
      {
        id: 'user_duty_main', role: 'duty', name: 'Petugas Piket Utama',
        label: 'Gerbang Utama & Pos Piket', password_hash: hashPassword_('piket123'),
        token_version: 1, is_active: true, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso
      },
      {
        id: 'user_homeroom_master', role: 'homeroom', name: 'Wali Kelas Umum',
        label: 'Sandi Bersama Seluruh Wali Kelas', password_hash: hashPassword_('walikelas123'),
        token_version: 1, is_active: true, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso
      },
      {
        id: 'user_student_affairs', role: 'student_affairs', name: 'Bagian Kesiswaan & Tatib',
        label: 'Tim Kesiswaan', password_hash: hashPassword_('kesiswaan123'),
        token_version: 1, is_active: true, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso
      },
      {
        id: 'user_admin_main', role: 'admin', name: 'Administrator Sekolah',
        label: 'Admin Sistem', password_hash: hashPassword_('admin123'),
        token_version: 1, is_active: true, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso
      }
    ]);
  }

  var settingsRows = readTabWithRowNumbers_(ss, SHEET_TABS.PENGATURAN).filter(function (r) { return r.data.status !== 'dihapus'; });
  var hasApp = settingsRows.some(function (r) { return r.data.id === 'app_settings'; });
  var hasNotif = settingsRows.some(function (r) { return r.data.id === 'notification_settings'; });
  var settingsToAdd = [];
  if (!hasApp) {
    settingsToAdd.push({
      id: 'app_settings', tipe: 'app', json_data: JSON.stringify(defaultSettings_(nowIso)), status: 'aktif', diubah_pada: nowIso
    });
  }
  if (!hasNotif) {
    settingsToAdd.push({
      id: 'notification_settings', tipe: 'notification', json_data: JSON.stringify(defaultNotificationSettings_(nowIso)), status: 'aktif', diubah_pada: nowIso
    });
  }
  if (settingsToAdd.length > 0) appendRows_(ss, SHEET_TABS.PENGATURAN, settingsToAdd);

  var sessRows = readTabWithRowNumbers_(ss, SHEET_TABS.SESI_PRESENSI).filter(function (r) { return r.data.status !== 'dihapus'; });
  if (sessRows.length === 0) {
    appendRows_(ss, SHEET_TABS.SESI_PRESENSI, [
      { id: 'sesi_pagi', name: 'Presensi Masuk Pagi', start_time: '06:00', on_time_limit: '07:00', end_time: '08:00', active_days: JSON.stringify([1, 2, 3, 4, 5, 6]), late_tolerance_minutes: 0, is_active: true, is_override: false, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso },
      { id: 'sesi_jam_pertama', name: 'Jam Pelajaran Pertama', start_time: '08:01', on_time_limit: '08:15', end_time: '11:45', active_days: JSON.stringify([1, 2, 3, 4, 5, 6]), late_tolerance_minutes: 0, is_active: true, is_override: false, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso },
      { id: 'sesi_zuhur', name: 'Sholat Zuhur & Siang', start_time: '11:46', on_time_limit: '12:30', end_time: '13:30', active_days: JSON.stringify([1, 2, 3, 4, 5, 6]), late_tolerance_minutes: 0, is_active: true, is_override: false, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso },
      { id: 'sesi_pulang', name: 'Presensi Pulang Sekolah', start_time: '13:31', on_time_limit: '15:00', end_time: '17:30', active_days: JSON.stringify([1, 2, 3, 4, 5, 6]), late_tolerance_minutes: 0, is_active: true, is_override: false, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso }
    ]);
  }

  var clsRows = readTabWithRowNumbers_(ss, SHEET_TABS.KELAS).filter(function (r) { return r.data.status !== 'dihapus'; });
  if (clsRows.length === 0) {
    appendRows_(ss, SHEET_TABS.KELAS, [
      { id: '10-RPL-1', name: '10 RPL 1', grade: '10', major: 'Rekayasa Perangkat Lunak', homeroom_teacher_name: 'Wali Kelas 10 RPL 1', homeroom_teacher_email: '', quota_limit: 2, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso },
      { id: '11-RPL-1', name: '11 RPL 1', grade: '11', major: 'Rekayasa Perangkat Lunak', homeroom_teacher_name: 'Wali Kelas 11 RPL 1', homeroom_teacher_email: '', quota_limit: 2, created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso }
    ]);
  }

  var vtRows = readTabWithRowNumbers_(ss, SHEET_TABS.JENIS_PELANGGARAN).filter(function (r) { return r.data.status !== 'dihapus'; });
  if (vtRows.length === 0) {
    appendRows_(ss, SHEET_TABS.JENIS_PELANGGARAN, [
      { id: 'vt_ringan_atribut', code: 'P-01', name: 'Atribut Seragam Tidak Lengkap', category: 'ringan', default_points: 5, is_active: true, description: 'Tidak memakai dasi, ikat pinggang, atau badge sekolah.', created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso },
      { id: 'vt_sedang_bolospkl', code: 'P-02', name: 'Meninggalkan Pelajaran Tanpa Izin', category: 'sedang', default_points: 15, is_active: true, description: 'Keluar kelas atau area sekolah tanpa izin guru/petugas piket.', created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso },
      { id: 'vt_berat_perkelahian', code: 'P-03', name: 'Berkelahi / Kekerasan', category: 'berat', default_points: 50, is_active: true, description: 'Terlibat perkelahian atau tindakan kekerasan fisik.', created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso },
      { id: 'vt_prestasi_lomba', code: 'PR-01', name: 'Prestasi Akademik / Non-Akademik', category: 'prestasi', default_points: 15, is_active: true, description: 'Meraih juara atau mengharumkan nama sekolah.', created_at: nowIso, updated_at: nowIso, status: 'aktif', diubah_pada: nowIso }
    ]);
  }
}

function activeOnly_(rows) {
  return rows
    .filter(function (r) { return String(r.data.status || 'aktif').toLowerCase() !== 'dihapus'; })
    .map(function (r) { return r.data; });
}

function getFullDatabase_() {
  var ss = getSpreadsheet_();
  ensureSheetsAndHeaders_(ss);
  ensureSeedData_(ss);
  var nowIso = new Date().toISOString();

  var students = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.SISWA)).map(function (r) {
    return {
      nis: r.nis || r.id,
      nisn: r.nisn || '',
      name: r.name || '',
      class_id: r.class_id || '',
      gender: r.gender === 'P' ? 'P' : 'L',
      rfid_uid: r.rfid_uid || '',
      card_code: r.card_code || r.rfid_uid || '',
      photo_url: r.photo_url || '',
      parent_name: r.parent_name || '',
      parent_email: r.parent_email || '',
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var classes = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.KELAS)).map(function (r) {
    return {
      id: r.id,
      name: r.name || r.id,
      grade: r.grade || '10',
      major: r.major || '',
      homeroom_teacher_name: r.homeroom_teacher_name || '',
      homeroom_teacher_email: r.homeroom_teacher_email || '',
      quota_limit: parseNum_(r.quota_limit, 2),
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var sessions = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.SESI_PRESENSI)).map(function (r) {
    return {
      id: r.id,
      name: r.name || r.id,
      start_time: r.start_time || '06:00',
      on_time_limit: r.on_time_limit || '07:00',
      end_time: r.end_time || '08:00',
      active_days: parseJsonArray_(r.active_days, [1, 2, 3, 4, 5, 6]),
      late_tolerance_minutes: parseNum_(r.late_tolerance_minutes, 0),
      is_active: parseBool_(r.is_active, true),
      is_override: parseBool_(r.is_override, false),
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var attendance = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.PRESENSI)).map(function (r) {
    return {
      id: r.id,
      student_id: r.student_id,
      session_id: r.session_id,
      date: r.date,
      timestamp: r.timestamp || r.created_at || nowIso,
      status: r.status_presensi || 'Hadir',
      late_minutes: parseNum_(r.late_minutes, 0),
      method: r.method || 'barcode',
      device_id: r.device_id || 'kiosk_main',
      photo_id: r.photo_id || '',
      notes: r.notes || '',
      audited_by: r.audited_by || '',
      audit_reason: r.audit_reason || '',
      version: parseNum_(r.version, 1),
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var out_of_class = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.IZIN_KELUAR)).map(function (r) {
    return {
      id: r.id,
      student_id: r.student_id,
      class_id: r.class_id,
      type: r.type || 'BAK',
      duration_minutes: parseNum_(r.duration_minutes, 5),
      started_at: r.started_at || nowIso,
      due_at: r.due_at || nowIso,
      returned_at: r.returned_at || undefined,
      actual_minutes: r.actual_minutes ? parseNum_(r.actual_minutes, 0) : undefined,
      late_return_minutes: parseNum_(r.late_return_minutes, 0),
      return_method: r.return_method || undefined,
      status: r.status_izin || 'active',
      return_notes: r.return_notes || undefined,
      audited_by: r.audited_by || undefined,
      audit_reason: r.audit_reason || undefined,
      idempotency_key: r.idempotency_key || r.id,
      version: parseNum_(r.version, 1),
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var violations = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.PELANGGARAN)).map(function (r) {
    return {
      id: r.id,
      student_id: r.student_id,
      class_id: r.class_id,
      violation_type_id: r.violation_type_id,
      type_name: r.type_name,
      category: r.category || 'ringan',
      points: parseNum_(r.points, 0),
      notes: r.notes || '',
      location: r.location || '',
      evidence_photo_url: r.evidence_photo_url || '',
      recorded_by: r.recorded_by || 'Petugas',
      recorded_at: r.recorded_at || r.created_at || nowIso,
      version: parseNum_(r.version, 1),
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var violation_types = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.JENIS_PELANGGARAN)).map(function (r) {
    return {
      id: r.id,
      code: r.code || '',
      name: r.name || '',
      category: r.category || 'ringan',
      default_points: parseNum_(r.default_points, 5),
      is_active: parseBool_(r.is_active, true),
      description: r.description || '',
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var leave_requests = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.IZIN_TIDAK_MASUK)).map(function (r) {
    return {
      id: r.id,
      student_id: r.student_id,
      class_id: r.class_id,
      type: r.type || 'Izin',
      start_date: r.start_date,
      end_date: r.end_date,
      reason: r.reason || '',
      letter_file_url: r.letter_file_url || undefined,
      status: r.status_persetujuan || 'pending',
      approved_by: r.approved_by || undefined,
      approved_at: r.approved_at || undefined,
      rejection_reason: r.rejection_reason || undefined,
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var users = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.USERS)).map(function (r) {
    return {
      id: r.id,
      role: r.role || 'duty',
      name: r.name || '',
      class_id: r.class_id || undefined,
      email: r.email || undefined,
      password_hash: r.password_hash || '',
      label: r.label || '',
      token_version: parseNum_(r.token_version, 1),
      is_active: parseBool_(r.is_active, true),
      created_at: r.created_at || nowIso,
      updated_at: r.updated_at || r.diubah_pada || nowIso,
      diubah_pada: r.diubah_pada || r.updated_at || nowIso,
    };
  });

  var settingsRows = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.PENGATURAN));
  var settings = defaultSettings_(nowIso);
  var notifSettings = defaultNotificationSettings_(nowIso);

  settingsRows.forEach(function (r) {
    if (r.id === 'app_settings' && r.json_data) {
      try {
        var parsedApp = JSON.parse(r.json_data);
        for (var ak in parsedApp) settings[ak] = parsedApp[ak];
        if (r.diubah_pada) { settings.updated_at = r.diubah_pada; settings.diubah_pada = r.diubah_pada; }
      } catch (e) {}
    } else if (r.id === 'notification_settings' && r.json_data) {
      try {
        var parsedNotif = JSON.parse(r.json_data);
        for (var nk in parsedNotif) notifSettings[nk] = parsedNotif[nk];
        if (r.diubah_pada) { notifSettings.updated_at = r.diubah_pada; notifSettings.diubah_pada = r.diubah_pada; }
      } catch (e) {}
    }
  });

  var notification_logs = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.NOTIFIKASI_LOG)).map(function (r) {
    return {
      id: r.id,
      timestamp: r.timestamp || nowIso,
      student_id: r.student_id,
      student_name: r.student_name,
      recipient_email: r.recipient_email,
      trigger_type: r.trigger_type,
      status: r.status_kirim || 'sent',
      error_message: r.error_message || undefined,
      created_at: r.created_at || nowIso,
    };
  }).sort(function (a, b) {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  var audit_logs = activeOnly_(readTabWithRowNumbers_(ss, SHEET_TABS.LOG)).map(function (r) {
    return {
      id: r.id,
      timestamp: r.waktu || r.diubah_pada || nowIso,
      actor_name: r.pengguna || 'Sistem',
      actor_role: 'user',
      action: r.aksi || 'edit',
      entity: r.tabel || '-',
      entity_id: r.id_data || '-',
      old_values: r.nilai_lama || undefined,
      new_values: r.nilai_baru || undefined,
      reason: r.reason || undefined,
    };
  }).sort(function (a, b) {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return {
    students: students,
    classes: classes,
    sessions: sessions,
    attendance: attendance,
    out_of_class: out_of_class,
    violations: violations,
    violation_types: violation_types,
    leave_requests: leave_requests,
    users: users,
    settings: settings,
    notification_settings: notifSettings,
    notification_logs: notification_logs,
    audit_logs: audit_logs,
  };
}

function getNotificationSettings_() {
  var db = getFullDatabase_();
  return db.notification_settings;
}

// ============================================================================
// SESSION SCHEDULE HELPER (Identical to server/sessionHelper.ts)
// ============================================================================

function parseTimeToMinutes_(hhmm) {
  var parts = String(hhmm || '00:00').split(':');
  return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
}

function isTimeInWindow_(curMin, startMin, endMin) {
  if (endMin >= startMin) return curMin >= startMin && curMin <= endMin;
  return curMin >= startMin || curMin <= endMin;
}

function resolveSessionSchedule_(sessions, now, autoSwitchEnabled, manualOverrideSessionId) {
  var activeAll = (sessions || []).filter(function (s) { return s.is_active; }).sort(function (a, b) {
    return parseTimeToMinutes_(a.start_time) - parseTimeToMinutes_(b.start_time);
  });
  var fallbackAll = (sessions || []).slice().sort(function (a, b) {
    return parseTimeToMinutes_(a.start_time) - parseTimeToMinutes_(b.start_time);
  });

  var clock = getLocalClockParts_(now || new Date());
  var curDay = clock.dayOfWeek;
  var curMin = clock.totalMinutes;

  var validToday = activeAll.filter(function (s) {
    return Array.isArray(s.active_days) && s.active_days.length > 0 ? s.active_days.indexOf(curDay) >= 0 : true;
  });

  var liveMatches = [];
  var todayTimeline = validToday.map(function (s) {
    var startMin = parseTimeToMinutes_(s.start_time);
    var endMin = parseTimeToMinutes_(s.end_time);
    var inWin = isTimeInWindow_(curMin, startMin, endMin);
    var status = 'upcoming';
    if (inWin) {
      status = 'active';
      liveMatches.push(s);
    } else if (endMin >= startMin && curMin > endMin) {
      status = 'completed';
    } else if (endMin < startMin && curMin > endMin && curMin < startMin) {
      status = 'completed';
    }
    return { session: s, status: status };
  });

  var liveWindowSession = liveMatches.length > 0
    ? liveMatches.slice().sort(function (a, b) {
        return parseTimeToMinutes_(b.start_time) - parseTimeToMinutes_(a.start_time);
      })[0]
    : null;

  var upcomingItems = todayTimeline.filter(function (t) { return t.status === 'upcoming'; });
  var completedToday = todayTimeline.filter(function (t) { return t.status === 'completed'; });

  if (manualOverrideSessionId) {
    var overridden = (sessions || []).filter(function (s) { return s.id === manualOverrideSessionId; })[0];
    if (overridden) {
      return { activeSession: overridden, liveWindowSession: liveWindowSession };
    }
  }

  if (!autoSwitchEnabled) {
    return {
      activeSession: liveWindowSession || validToday[0] || activeAll[0] || fallbackAll[0] || null,
      liveWindowSession: liveWindowSession,
    };
  }

  if (liveWindowSession) {
    return { activeSession: liveWindowSession, liveWindowSession: liveWindowSession };
  }

  var smartFallback =
    (upcomingItems.length > 0 ? upcomingItems[0].session : null) ||
    (completedToday.length > 0 ? completedToday[completedToday.length - 1].session : null) ||
    validToday[0] || activeAll[0] || fallbackAll[0] || null;

  return { activeSession: smartFallback, liveWindowSession: null };
}

function syncSessionRecapSheet_(ss, targetDate) {
  var db = getFullDatabase_();
  var dateStr = targetDate || toDateYmd_(new Date());
  var studentMap = {};
  db.students.forEach(function (s) { studentMap[s.nis] = s; });
  var totalStudents = db.students.length;
  var dayAtt = db.attendance.filter(function (a) { return a.date === dateStr; });

  var existingRows = readTabWithRowNumbers_(ss, SHEET_TABS.REKAP_PER_SESI);
  var existingById = {};
  existingRows.forEach(function (r) { existingById[r.data.id] = r; });

  var nowIso = new Date().toISOString();
  var toAppend = [];

  db.sessions.forEach(function (sess) {
    var sessAtt = dayAtt.filter(function (a) { return a.session_id === sess.id; });
    var hadir = sessAtt.filter(function (a) { return a.status === 'Hadir'; }).length;
    var terlambat = sessAtt.filter(function (a) { return a.status === 'Terlambat'; }).length;
    var izin = sessAtt.filter(function (a) { return a.status === 'Izin'; }).length;
    var sakit = sessAtt.filter(function (a) { return a.status === 'Sakit'; }).length;
    var alpha = sessAtt.filter(function (a) { return a.status === 'Alpha'; }).length;

    var seenIds = {};
    sessAtt.forEach(function (a) { seenIds[a.student_id] = true; });
    var belum = Math.max(0, totalStudents - Object.keys(seenIds).length);
    var pct = totalStudents > 0 ? Math.round(((hadir + terlambat) / totalStudents) * 100) : 0;

    var id = dateStr + '_' + sess.id;
    var rowObj = {
      id: id,
      tanggal: dateStr,
      session_id: sess.id,
      session_name: sess.name,
      rentang_waktu: sess.start_time + ' - ' + sess.end_time,
      total_siswa: totalStudents,
      hadir: hadir,
      terlambat: terlambat,
      izin: izin,
      sakit: sakit,
      alpha: alpha,
      belum_presensi: belum,
      persen_hadir: pct + '%',
      status: 'aktif',
      diubah_pada: nowIso,
    };
    if (existingById[id]) {
      updateRowPartial_(ss, {
        tabName: SHEET_TABS.REKAP_PER_SESI,
        id: id,
        newRowObj: rowObj,
        forceOverwrite: true,
        skipLog: true,
      });
    } else {
      toAppend.push(rowObj);
    }
  });

  if (toAppend.length > 0) appendRows_(ss, SHEET_TABS.REKAP_PER_SESI, toAppend);
}

// ============================================================================
// GOOGLE DRIVE PHOTO UPLOAD & READ
// ============================================================================

function extractDriveFileId_(raw) {
  var s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!s) return '';
  var mFile = s.match(/\/file\/d\/([a-zA-Z0-9_-]{8,200})/i);
  if (mFile && mFile[1]) return mFile[1];
  var mD = s.match(/\/d\/([a-zA-Z0-9_-]{8,200})/i);
  if (mD && mD[1]) return mD[1];
  var mQuery = s.match(/[?&]id=([a-zA-Z0-9_-]{8,200})/i);
  if (mQuery && mQuery[1]) return mQuery[1];
  if (/^[a-zA-Z0-9_-]{8,200}$/.test(s)) return s;
  return '';
}

function uploadPhotoToDrive_(base64Data, fileName) {
  var rawStr = String(base64Data || '').trim();
  if (!rawStr) throw new Error('Data base64 foto wajib diisi.');

  var folderId = getDriveFolderId_();
  if (!folderId) {
    throw new Error('DRIVE_FOLDER_ID belum diisi di Script Properties Google Apps Script.');
  }

  var targetFolder;
  try {
    targetFolder = DriveApp.getFolderById(folderId);
    if (!targetFolder || (targetFolder.isTrashed && targetFolder.isTrashed())) {
      throw new Error('Folder Drive tujuan sudah dipindahkan ke sampah.');
    }
  } catch (eFolder) {
    throw new Error('Folder Google Drive (DRIVE_FOLDER_ID) tidak dapat diakses: ' + ((eFolder && eFolder.message) ? eFolder.message : String(eFolder)));
  }

  var mimeType = 'image/jpeg';
  var cleanBase64 = rawStr;
  var dataMatch = rawStr.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataMatch) {
    mimeType = String(dataMatch[1] || 'image/jpeg').trim() || 'image/jpeg';
    cleanBase64 = dataMatch[2];
  } else {
    cleanBase64 = rawStr.replace(/^data:[^;]*;base64,/i, '');
  }

  var bytes = Utilities.base64Decode(cleanBase64);
  if (!bytes || bytes.length === 0) {
    throw new Error('Data foto kosong atau tidak valid.');
  }

  var safeName = String(fileName || ('foto_' + Date.now() + '.jpg')).trim();
  var blob = Utilities.newBlob(bytes, mimeType, safeName);
  var file = targetFolder.createFile(blob);

  var createdId = file && file.getId ? file.getId() : '';
  if (!createdId) {
    throw new Error('Gagal mendapatkan ID file setelah mengunggah ke Google Drive.');
  }
  return createdId;
}

function getPhotoFromDrive_(fileIdOrUrl) {
  var resolvedId = extractDriveFileId_(fileIdOrUrl);
  if (!resolvedId) {
    return { notFound: true, error: 'Parameter id file Drive tidak valid.' };
  }
  try {
    var file = DriveApp.getFileById(resolvedId);
    if (file.isTrashed && file.isTrashed()) {
      return { notFound: true, error: 'Foto sudah dihapus di Google Drive.' };
    }
    var blob = file.getBlob();
    return {
      mimeType: blob.getContentType() || 'image/jpeg',
      fileName: file.getName(),
      base64: Utilities.base64Encode(blob.getBytes()),
    };
  } catch (err) {
    return {
      notFound: true,
      error: 'Foto tidak ditemukan atau tidak memiliki akses di Google Drive: ' + ((err && err.message) ? err.message : String(err)),
    };
  }
}

// ============================================================================
// REAL EMAIL NOTIFICATIONS & WEEKLY RECAPS (GmailApp)
// ============================================================================

function logNotification_(ss, log) {
  var nowIso = new Date().toISOString();
  appendRows_(ss, SHEET_TABS.NOTIFIKASI_LOG, [{
    id: log.id || randomId_('notif'),
    timestamp: log.timestamp || nowIso,
    student_id: log.student_id || '-',
    student_name: log.student_name || '-',
    recipient_email: log.recipient_email || '-',
    trigger_type: log.trigger_type || 'info',
    status_kirim: log.status || 'sent',
    error_message: log.error_message || '',
    created_at: log.created_at || nowIso,
    status: 'aktif',
    diubah_pada: nowIso,
  }]);
}

function notifyParent_(payload) {
  var ss = getSpreadsheet_();
  var db = getFullDatabase_();
  var settings = db.settings;
  var notifSettings = db.notification_settings;

  if (!settings.toggle_email_notifications || !notifSettings.email_enabled) {
    return { sent: false, reason: 'Fitur notifikasi email nonaktif.' };
  }

  var shouldTrigger = false;
  switch (payload.triggerType) {
    case 'terlambat': shouldTrigger = notifSettings.trigger_late; break;
    case 'alpha': shouldTrigger = notifSettings.trigger_alpha; break;
    case 'izin_sakit': shouldTrigger = notifSettings.trigger_leave; break;
    case 'pelanggaran': shouldTrigger = notifSettings.trigger_violation; break;
    case 'ambang_peringatan': shouldTrigger = notifSettings.trigger_warning_threshold; break;
    case 'melebihi_waktu': shouldTrigger = notifSettings.trigger_overdue_out_of_class; break;
  }
  if (!shouldTrigger) {
    return { sent: false, reason: 'Pemicu notifikasi ini dinonaktifkan.' };
  }

  var student = payload.student;
  var email = String(student.parent_email || '').trim();
  var now = new Date();
  var tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
  var dateStr = Utilities.formatDate(now, tz, 'dd MMMM yyyy');
  var timeStr = Utilities.formatDate(now, tz, 'HH:mm');

  if (!email || email.indexOf('@') === -1) {
    logNotification_(ss, {
      id: randomId_('notif'),
      timestamp: now.toISOString(),
      student_id: student.nis,
      student_name: student.name,
      recipient_email: email || '-',
      trigger_type: payload.triggerType,
      status: 'skipped_no_email',
      error_message: 'Email orang tua tidak terdaftar atau tidak valid.',
    });
    return { sent: false, reason: 'Email orang tua tidak terdaftar.' };
  }

  var subject = notifSettings.subject_template || 'Pemberitahuan Kedisiplinan Siswa: {nama_siswa} ({kelas})';
  var body = notifSettings.body_template || 'Yth. Orang Tua dari {nama_siswa},\n\nSiswa tercatat: {status}.\nSekolah: {nama_sekolah}';

  var replacements = {
    '{nama_siswa}': student.name,
    '{kelas}': student.class_id,
    '{tanggal}': dateStr,
    '{jam}': timeStr,
    '{status}': payload.status || '',
    '{pelanggaran}': payload.violationName || '-',
    '{poin}': payload.points !== undefined ? String(payload.points) : '0',
    '{menit_terlambat_kembali}': payload.lateReturnMinutes !== undefined ? String(payload.lateReturnMinutes) : '0',
    '{nama_sekolah}': settings.school_name || 'DISIPLIN KITA BISA',
  };

  for (var key in replacements) {
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      subject = subject.split(key).join(replacements[key]);
      body = body.split(key).join(replacements[key]);
    }
  }

  try {
    GmailApp.sendEmail(email, subject, body, {
      name: settings.school_name || 'DISIPLIN KITA BISA',
    });
    logNotification_(ss, {
      id: randomId_('notif'),
      timestamp: now.toISOString(),
      student_id: student.nis,
      student_name: student.name,
      recipient_email: email,
      trigger_type: payload.triggerType,
      status: 'sent',
    });
    return { sent: true };
  } catch (err) {
    logNotification_(ss, {
      id: randomId_('notif'),
      timestamp: now.toISOString(),
      student_id: student.nis,
      student_name: student.name,
      recipient_email: email,
      trigger_type: payload.triggerType,
      status: 'failed',
      error_message: err && err.message ? err.message : String(err),
    });
    return { sent: false, reason: err && err.message ? err.message : String(err) };
  }
}

function sendTestEmail_(targetEmail) {
  var ss = getSpreadsheet_();
  var db = getFullDatabase_();
  var settings = db.settings;
  var cleanTarget = String(targetEmail || '').trim();
  if (!cleanTarget || cleanTarget.indexOf('@') === -1) {
    return { success: false, message: 'Alamat email tujuan tidak valid.' };
  }
  var now = new Date();
  try {
    GmailApp.sendEmail(
      cleanTarget,
      '[Uji Coba] Sistem Notifikasi ' + (settings.school_name || 'DISIPLIN KITA BISA'),
      'Halo,\n\nIni adalah pesan uji coba sistem notifikasi orang tua dari aplikasi DISIPLIN KITA BISA (' +
        (settings.school_name || '') + ') melalui Google Apps Script GmailApp. Konfigurasi email berfungsi dengan baik!',
      { name: settings.school_name || 'DISIPLIN KITA BISA' }
    );
    logNotification_(ss, {
      id: 'notif_test_' + Date.now(),
      timestamp: now.toISOString(),
      student_id: 'uji_coba',
      student_name: 'Uji Coba Sistem Email',
      recipient_email: cleanTarget,
      trigger_type: 'uji_coba',
      status: 'sent',
    });
    return {
      success: true,
      message: 'Email uji coba berhasil dikirim melalui Gmail Apps Script ke ' + cleanTarget,
    };
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    logNotification_(ss, {
      id: 'notif_test_' + Date.now(),
      timestamp: now.toISOString(),
      student_id: 'uji_coba',
      student_name: 'Uji Coba Sistem Email',
      recipient_email: cleanTarget,
      trigger_type: 'uji_coba',
      status: 'failed',
      error_message: msg,
    });
    return { success: false, message: 'Gagal mengirim email: ' + msg };
  }
}

function sendWeeklyHomeroomRecap_(classId, customStartDate, customEndDate) {
  var ss = getSpreadsheet_();
  var db = getFullDatabase_();
  var cls = null;
  for (var i = 0; i < db.classes.length; i++) {
    if (db.classes[i].id === classId) { cls = db.classes[i]; break; }
  }
  if (!cls) return { sent: false, reason: 'Kelas "' + classId + '" tidak ditemukan.' };

  var now = new Date();
  var email = String(cls.homeroom_teacher_email || '').trim();
  if (!email || email.indexOf('@') === -1) {
    logNotification_(ss, {
      id: randomId_('notif'),
      timestamp: now.toISOString(),
      student_id: cls.id,
      student_name: 'Kelas ' + cls.name + ' (' + cls.homeroom_teacher_name + ')',
      recipient_email: email || '-',
      trigger_type: 'rekap_mingguan',
      status: 'skipped_no_email',
      error_message: 'Email wali kelas belum diatur oleh Administrator di menu Kelola Kelas.',
    });
    return { sent: false, reason: 'Email wali kelas untuk ' + cls.name + ' belum diatur oleh Admin.' };
  }

  var startStr = customStartDate;
  var endStr = customEndDate;
  if (!startStr || !endStr) {
    var d = new Date(now.getTime());
    var day = d.getDay();
    var diffToMonday = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diffToMonday);
    startStr = toDateYmd_(d);
    endStr = customEndDate || toDateYmd_(now);
  }

  var classStudents = db.students.filter(function (s) { return s.class_id === classId; });
  var studentMap = {};
  classStudents.forEach(function (s) { studentMap[s.nis] = true; });

  var sessions = db.sessions.filter(function (s) { return s.is_active; });
  var periodAtt = db.attendance.filter(function (a) {
    return a.date >= startStr && a.date <= endStr && Boolean(studentMap[a.student_id]);
  });

  var totalHadir = 0, totalTerlambat = 0, totalIzin = 0, totalSakit = 0, totalAlpha = 0;
  var sessionHtmlList = [];

  sessions.forEach(function (sess) {
    var recs = periodAtt.filter(function (a) { return a.session_id === sess.id; });
    var hC = recs.filter(function (a) { return a.status === 'Hadir'; }).length;
    var tC = recs.filter(function (a) { return a.status === 'Terlambat'; }).length;
    var iC = recs.filter(function (a) { return a.status === 'Izin'; }).length;
    var sC = recs.filter(function (a) { return a.status === 'Sakit'; }).length;
    var aC = recs.filter(function (a) { return a.status === 'Alpha'; }).length;
    totalHadir += hC; totalTerlambat += tC; totalIzin += iC; totalSakit += sC; totalAlpha += aC;

    var rowsHtml = classStudents.map(function (stu, idx) {
      var sr = recs.filter(function (r) { return r.student_id === stu.nis; });
      var sh = sr.filter(function (r) { return r.status === 'Hadir'; }).length;
      var st = sr.filter(function (r) { return r.status === 'Terlambat'; }).length;
      var si = sr.filter(function (r) { return r.status === 'Izin'; }).length;
      var ss2 = sr.filter(function (r) { return r.status === 'Sakit'; }).length;
      var sa = sr.filter(function (r) { return r.status === 'Alpha'; }).length;
      return '<tr style="border-bottom:1px solid #e2e8f0;background-color:' + (idx % 2 === 0 ? '#ffffff' : '#f8fafc') + ';">' +
        '<td style="padding:8px 12px;color:#64748b;">' + (idx + 1) + '</td>' +
        '<td style="padding:8px 12px;font-family:monospace;">' + stu.nis + '</td>' +
        '<td style="padding:8px 12px;font-weight:500;color:#0f172a;">' + stu.name + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:#059669;font-weight:600;">' + sh + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:' + (st > 0 ? '#d97706' : '#94a3b8') + ';">' + st + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:' + (si > 0 ? '#2563eb' : '#94a3b8') + ';">' + si + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:' + (ss2 > 0 ? '#7c3aed' : '#94a3b8') + ';">' + ss2 + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:' + (sa > 0 ? '#dc2626' : '#94a3b8') + ';font-weight:700;">' + sa + '</td>' +
        '</tr>';
    }).join('');

    sessionHtmlList.push(
      '<div style="margin-top:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">' +
      '<div style="background-color:#0f172a;color:#ffffff;padding:12px 16px;">' +
      '<h3 style="margin:0;font-size:15px;">Sesi: ' + sess.name + ' (' + sess.start_time + ' - ' + sess.end_time + ')</h3>' +
      '<p style="margin:4px 0 0 0;font-size:12px;color:#94a3b8;">Hadir: ' + hC + ' | Terlambat: ' + tC + ' | Izin: ' + iC + ' | Sakit: ' + sC + ' | Alpha: ' + aC + '</p>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">' +
      '<thead><tr style="background-color:#f1f5f9;border-bottom:1px solid #cbd5e1;color:#334155;">' +
      '<th style="padding:8px 12px;">No</th><th style="padding:8px 12px;">NIS</th><th style="padding:8px 12px;">Nama Siswa</th>' +
      '<th style="padding:8px 12px;text-align:center;">Hadir</th><th style="padding:8px 12px;text-align:center;">Terlambat</th>' +
      '<th style="padding:8px 12px;text-align:center;">Izin</th><th style="padding:8px 12px;text-align:center;">Sakit</th>' +
      '<th style="padding:8px 12px;text-align:center;">Alpha</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div>'
    );
  });

  var schoolName = db.settings.school_name || 'DISIPLIN KITA BISA';
  var subject = '[Rekap Presensi Mingguan] Kelas ' + cls.name + ' - Periode ' + startStr + ' s.d. ' + endStr;
  var htmlBody =
    '<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;color:#1e293b;padding:20px;">' +
    '<h1 style="margin:0 0 4px 0;font-size:20px;color:#0f172a;">' + schoolName + '</h1>' +
    '<p style="margin:0 0 16px 0;font-size:13px;color:#64748b;">Laporan Rekap Presensi Mingguan Kelas ' + cls.name + ' (' + startStr + ' s.d. ' + endStr + ')</p>' +
    '<p style="font-size:14px;">Yth. <strong>' + cls.homeroom_teacher_name + '</strong>,<br>Berikut ringkasan mingguan: Total Hadir: <strong>' + totalHadir + '</strong>, Terlambat: <strong>' + totalTerlambat + '</strong>, Izin: <strong>' + totalIzin + '</strong>, Sakit: <strong>' + totalSakit + '</strong>, Alpha: <strong>' + totalAlpha + '</strong>.</p>' +
    sessionHtmlList.join('') +
    '<p style="margin-top:24px;font-size:11px;color:#64748b;">Dikirim otomatis oleh ' + schoolName + ' &bull; ' + formatIdDateTime_(now) + '</p></div>';

  var plainText =
    'REKAP PRESENSI MINGGUAN KELAS ' + cls.name + '\n' +
    schoolName + '\nPeriode: ' + startStr + ' s.d. ' + endStr + '\n' +
    'Wali Kelas: ' + cls.homeroom_teacher_name + '\n\n' +
    'Total Siswa: ' + classStudents.length + '\n' +
    'Total Hadir: ' + totalHadir + '\nTotal Terlambat: ' + totalTerlambat +
    '\nTotal Izin: ' + totalIzin + '\nTotal Sakit: ' + totalSakit + '\nTotal Alpha: ' + totalAlpha;

  try {
    GmailApp.sendEmail(email, subject, plainText, { htmlBody: htmlBody, name: schoolName });
    logNotification_(ss, {
      id: randomId_('notif'),
      timestamp: now.toISOString(),
      student_id: cls.id,
      student_name: 'Kelas ' + cls.name + ' (' + cls.homeroom_teacher_name + ')',
      recipient_email: email,
      trigger_type: 'rekap_mingguan',
      status: 'sent',
    });
    return { sent: true, recipient: email, studentCount: classStudents.length };
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    logNotification_(ss, {
      id: randomId_('notif'),
      timestamp: now.toISOString(),
      student_id: cls.id,
      student_name: 'Rekap Mingguan Kelas ' + cls.id,
      recipient_email: email,
      trigger_type: 'rekap_mingguan',
      status: 'failed',
      error_message: msg,
    });
    return { sent: false, reason: msg };
  }
}

function sendAllWeeklyRecaps_() {
  var db = getFullDatabase_();
  var results = [];
  var sent = 0, skipped = 0, failed = 0;

  db.classes.forEach(function (c) {
    var r = sendWeeklyHomeroomRecap_(c.id);
    results.push({ classId: c.id, className: c.name, homeroom: c.homeroom_teacher_name, sent: r.sent, reason: r.reason, recipient: r.recipient });
    if (r.sent) sent++;
    else if (r.reason && r.reason.indexOf('belum diatur') >= 0) skipped++;
    else failed++;
  });

  updateNotificationSettings_({ weekly_recap_last_sent: new Date().toISOString() }, 'Sistem');
  return { total: db.classes.length, sent: sent, skipped: skipped, failed: failed, results: results };
}

// ============================================================================
// DOMAIN WRITES & LOCKED MUTATIONS
// ============================================================================

function saveUser_(ss, user, actorName) {
  var nowIso = new Date().toISOString();
  var record = {
    id: user.id,
    role: user.role,
    name: user.name,
    class_id: user.class_id || '',
    email: user.email || '',
    password_hash: user.password_hash || '',
    label: user.label || '',
    token_version: parseNum_(user.token_version, 1),
    is_active: user.is_active !== false,
    created_at: user.created_at || nowIso,
    updated_at: nowIso,
    status: 'aktif',
    diubah_pada: nowIso,
  };
  var res = updateRowPartial_(ss, {
    tabName: SHEET_TABS.USERS,
    id: record.id,
    newRowObj: record,
    forceOverwrite: true,
    actorName: actorName || 'Admin',
    reason: 'Simpan akun pengguna',
  });
  if (!res.updated) {
    appendRows_(ss, SHEET_TABS.USERS, [record]);
    appendLog_(ss, {
      waktu: nowIso,
      pengguna: actorName || 'Admin',
      id_data: record.id,
      tabel: SHEET_TABS.USERS,
      aksi: 'tambah',
      nilai_baru: JSON.stringify({ id: record.id, role: record.role, name: record.name }),
    });
  }
  return record;
}

function updateSettings_(patch, actorName) {
  var ss = getSpreadsheet_();
  var db = getFullDatabase_();
  var nowIso = new Date().toISOString();
  var expectedUpdatedAt = patch.expected_updated_at;
  var forceOverwrite = patch.forceOverwrite !== false;
  var merged = {};
  var k;
  for (k in db.settings) merged[k] = db.settings[k];
  for (k in patch) {
    if (k !== 'expected_updated_at' && k !== 'forceOverwrite') merged[k] = patch[k];
  }
  merged.updated_at = nowIso;
  merged.diubah_pada = nowIso;

  var res = updateRowPartial_(ss, {
    tabName: SHEET_TABS.PENGATURAN,
    id: 'app_settings',
    newRowObj: { id: 'app_settings', tipe: 'app', json_data: JSON.stringify(merged), status: 'aktif', diubah_pada: nowIso },
    expectedUpdatedAt: expectedUpdatedAt,
    forceOverwrite: forceOverwrite,
    actorName: actorName || 'Admin',
    reason: 'Perbarui pengaturan aplikasi',
  });
  if (res.conflict) return { conflict: true, current: res.current };
  if (!res.updated) {
    appendRows_(ss, SHEET_TABS.PENGATURAN, [{
      id: 'app_settings', tipe: 'app', json_data: JSON.stringify(merged), status: 'aktif', diubah_pada: nowIso
    }]);
  }
  return { settings: merged };
}

function updateNotificationSettings_(patch, actorName) {
  var ss = getSpreadsheet_();
  var db = getFullDatabase_();
  var nowIso = new Date().toISOString();
  var expectedUpdatedAt = patch.expected_updated_at;
  var forceOverwrite = patch.forceOverwrite !== false;
  var merged = {};
  var k;
  for (k in db.notification_settings) merged[k] = db.notification_settings[k];
  for (k in patch) {
    if (k !== 'expected_updated_at' && k !== 'forceOverwrite') merged[k] = patch[k];
  }
  merged.updated_at = nowIso;
  merged.diubah_pada = nowIso;

  var res = updateRowPartial_(ss, {
    tabName: SHEET_TABS.PENGATURAN,
    id: 'notification_settings',
    newRowObj: { id: 'notification_settings', tipe: 'notification', json_data: JSON.stringify(merged), status: 'aktif', diubah_pada: nowIso },
    expectedUpdatedAt: expectedUpdatedAt,
    forceOverwrite: forceOverwrite,
    actorName: actorName || 'Admin',
    reason: 'Perbarui pengaturan notifikasi',
  });
  if (res.conflict) return { conflict: true, current: res.current };
  if (!res.updated) {
    appendRows_(ss, SHEET_TABS.PENGATURAN, [{
      id: 'notification_settings', tipe: 'notification', json_data: JSON.stringify(merged), status: 'aktif', diubah_pada: nowIso
    }]);
  }
  return { settings: merged };
}

function appendAttendanceBatch_(ss, records, actorName) {
  if (!records || records.length === 0) return { saved: [], rejectedDuplicates: [] };

  var existingRows = readTabWithRowNumbers_(ss, SHEET_TABS.PRESENSI);
  var activeExisting = existingRows.filter(function (r) { return r.data.status !== 'dihapus'; }).map(function (r) { return r.data; });

  var exactKeys = {};
  var dayKeys = {};
  activeExisting.forEach(function (r) {
    exactKeys[r.student_id + '::' + r.date + '::' + r.session_id] = true;
    dayKeys[r.student_id + '::' + r.date] = true;
  });

  var db = getFullDatabase_();
  var multiSession = db.sessions.filter(function (s) { return s.is_active; }).length > 1;

  var toInsert = [];
  var rejected = [];

  records.forEach(function (rec) {
    var ek = rec.student_id + '::' + rec.date + '::' + rec.session_id;
    var dk = rec.student_id + '::' + rec.date;
    var isDup = multiSession ? Boolean(exactKeys[ek]) : (Boolean(exactKeys[ek]) || Boolean(dayKeys[dk]));
    if (isDup) {
      rejected.push({
        student_id: rec.student_id,
        date: rec.date,
        session_id: rec.session_id,
        reason: 'Presensi ganda ditolak: siswa NIS ' + rec.student_id + ' sudah tercatat presensi hari ini (' + rec.date + ').',
      });
      return;
    }
    exactKeys[ek] = true;
    dayKeys[dk] = true;
    toInsert.push(rec);
  });

  if (toInsert.length > 0) {
    appendRows_(ss, SHEET_TABS.PRESENSI, toInsert.map(function (r) {
      return {
        id: r.id,
        student_id: r.student_id,
        session_id: r.session_id,
        date: r.date,
        timestamp: r.timestamp,
        status_presensi: r.status,
        late_minutes: r.late_minutes,
        method: r.method,
        device_id: r.device_id,
        photo_id: r.photo_id || '',
        notes: r.notes || '',
        audited_by: r.audited_by || '',
        audit_reason: r.audit_reason || '',
        version: r.version || 1,
        created_at: r.created_at,
        updated_at: r.updated_at,
        status: 'aktif',
        diubah_pada: r.diubah_pada || r.updated_at,
      };
    }));

    toInsert.forEach(function (r) {
      appendLog_(ss, {
        waktu: r.created_at,
        pengguna: actorName || 'Sistem Presensi',
        id_data: r.id,
        tabel: SHEET_TABS.PRESENSI,
        aksi: 'tambah',
        nilai_baru: JSON.stringify({ student_id: r.student_id, session_id: r.session_id, date: r.date, status: r.status }),
      });
    });

    try { syncSessionRecapSheet_(ss, toInsert[0].date); } catch (e) {}
  }

  return { saved: toInsert, rejectedDuplicates: rejected };
}

function autoCloseOverdueOutOfClass_(ss) {
  var db = getFullDatabase_();
  var nowMs = Date.now();
  db.out_of_class.forEach(function (rec) {
    if (rec.status === 'active' || rec.status === 'overdue') {
      var dueMs = new Date(rec.due_at).getTime();
      if (nowMs - dueMs > 2 * 60 * 60 * 1000) {
        var nowIso = new Date().toISOString();
        updateRowPartial_(ss, {
          tabName: SHEET_TABS.IZIN_KELUAR,
          id: rec.id,
          newRowObj: {
            status_izin: 'auto_closed',
            returned_at: nowIso,
            return_method: 'auto_closed',
            updated_at: nowIso,
            diubah_pada: nowIso,
          },
          forceOverwrite: true,
          actorName: 'Sistem',
          reason: 'Auto-close izin keluar lewat 2 jam',
        });
      }
    }
  });
}

function startOutOfClass_(ss, record, actorName) {
  var db = getFullDatabase_();
  var active = db.out_of_class.filter(function (r) { return r.status === 'active' || r.status === 'overdue'; });

  if (active.some(function (r) { return r.student_id === record.student_id; })) {
    return { success: false, error: 'Siswa ini sedang memiliki izin keluar yang masih aktif.' };
  }

  var cls = db.classes.filter(function (c) { return c.id === record.class_id; })[0];
  var maxPerClass = (cls && cls.quota_limit) || db.settings.out_of_class_max_per_class || 2;
  var classActiveCount = active.filter(function (r) { return r.class_id === record.class_id; }).length;
  if (classActiveCount >= maxPerClass) {
    return { success: false, error: 'Kuota izin keluar untuk kelas ' + record.class_id + ' penuh (' + classActiveCount + '/' + maxPerClass + ' siswa sedang di luar).' };
  }

  var todayStr = toDateYmd_(new Date());
  var dailyCount = db.out_of_class.filter(function (r) {
    if (r.student_id !== record.student_id) return false;
    var startedDate = toDateYmd_(new Date(r.started_at));
    return startedDate === todayStr || String(r.started_at).indexOf(todayStr) === 0;
  }).length;
  var maxDaily = db.settings.out_of_class_max_per_student_daily || 3;
  if (dailyCount >= maxDaily) {
    return { success: false, error: 'Batas harian izin keluar siswa (' + maxDaily + 'x/hari) telah tercapai.' };
  }

  var nowIso = new Date().toISOString();
  appendRows_(ss, SHEET_TABS.IZIN_KELUAR, [{
    id: record.id,
    student_id: record.student_id,
    class_id: record.class_id,
    type: record.type,
    duration_minutes: record.duration_minutes,
    started_at: record.started_at,
    due_at: record.due_at,
    returned_at: '',
    actual_minutes: '',
    late_return_minutes: 0,
    return_method: '',
    status_izin: 'active',
    return_notes: '',
    audited_by: '',
    audit_reason: '',
    idempotency_key: record.idempotency_key,
    version: 1,
    created_at: nowIso,
    updated_at: nowIso,
    status: 'aktif',
    diubah_pada: nowIso,
  }]);

  appendLog_(ss, {
    waktu: nowIso,
    pengguna: actorName || 'Petugas Piket',
    id_data: record.id,
    tabel: SHEET_TABS.IZIN_KELUAR,
    aksi: 'tambah',
    nilai_baru: JSON.stringify(record),
  });

  return { success: true, record: record };
}

// ============================================================================
// MAIN ROUTE DISPATCHER (All 15 /api/* Endpoints)
// ============================================================================

function runSystemCheck_() {
  var missingConfig = getMissingConfigKeys_();
  var ssId = getSpreadsheetId_();
  var folderId = getDriveFolderId_();
  var secretTok = getSecretToken_();

  var configFlags = {
    SPREADSHEET_ID: Boolean(ssId),
    DRIVE_FOLDER_ID: Boolean(folderId),
    SECRET_TOKEN: Boolean(secretTok),
  };

  var sheetsCheck = {
    ok: false,
    configured: Boolean(ssId),
    spreadsheetName: '',
    tabsCount: 0,
    expectedTabs: 13,
    missingTabs: [],
    error: '',
  };

  if (!ssId) {
    sheetsCheck.error = 'Properti skrip SPREADSHEET_ID masih kosong.';
  } else {
    try {
      var ss = SpreadsheetApp.openById(ssId);
      sheetsCheck.spreadsheetName = ss.getName();
      var missingTabs = [];
      var existingCount = 0;
      for (var k in SHEET_TABS) {
        if (Object.prototype.hasOwnProperty.call(SHEET_TABS, k)) {
          var tName = SHEET_TABS[k];
          if (ss.getSheetByName(tName)) {
            existingCount++;
          } else {
            missingTabs.push(tName);
          }
        }
      }
      sheetsCheck.tabsCount = existingCount;
      sheetsCheck.missingTabs = missingTabs;
      sheetsCheck.ok = true;
    } catch (errSs) {
      sheetsCheck.error = (errSs && errSs.message) ? errSs.message : String(errSs);
    }
  }

  var driveCheck = {
    ok: false,
    configured: Boolean(folderId),
    folderName: '',
    error: '',
  };

  if (!folderId) {
    driveCheck.error = 'Properti skrip DRIVE_FOLDER_ID masih kosong.';
  } else {
    try {
      var folder = DriveApp.getFolderById(folderId);
      if (folder.isTrashed && folder.isTrashed()) {
        driveCheck.error = 'Folder Google Drive berada di tempat sampah (trashed).';
      } else {
        driveCheck.folderName = folder.getName();
        driveCheck.ok = true;
      }
    } catch (errDrv) {
      driveCheck.error = (errDrv && errDrv.message) ? errDrv.message : String(errDrv);
    }
  }

  var senderEmail = getActiveSenderEmail_();
  var gmailCheck = {
    ok: Boolean(senderEmail) || true,
    senderEmail: senderEmail,
  };

  return {
    success: sheetsCheck.ok && driveCheck.ok && missingConfig.length === 0,
    tokenValid: Boolean(secretTok),
    missingConfig: missingConfig,
    configFlags: configFlags,
    sheets: sheetsCheck,
    drive: driveCheck,
    gmail: gmailCheck,
    serverTime: new Date().toISOString(),
  };
}

function dispatchRoute_(req) {
  var pathname = req.route || '/api/setup';
  var method = String(req.method || 'GET').toUpperCase();
  var query = req.query || {};
  var body = req.body || {};
  var token = req.token || '';

  try {
    // 0. /api/system-check (Uji koneksi Sheets & Drive + tampilkan konfigurasi yang masih kosong, tanpa nilainya)
    if (pathname === '/api/system-check') {
      return makeResp_(200, runSystemCheck_());
    }

    // 1. /api/setup
    if (pathname === '/api/setup') {
      var missingSetup = getMissingConfigKeys_();
      if (!getSpreadsheetId_()) {
        return makeResp_(503, {
          error: 'SPREADSHEET_ID di Script Properties Google Apps Script masih kosong.',
          configured: false,
          missingConfig: missingSetup,
          missingEnv: missingSetup,
        });
      }
      var lockSetup = LockService.getScriptLock();
      lockSetup.waitLock(15000);
      var ss;
      try {
        ss = getSpreadsheet_();
        ensureSheetsAndHeaders_(ss);
        ensureSeedData_(ss);
        var incomingScriptUrl = String((body && body.appsScriptUrl) || (query && query.appsScriptUrl) || '').trim();
        if (incomingScriptUrl && incomingScriptUrl.indexOf('https://script.google') === 0) {
          try {
            updateSettings_({ apps_script_url: incomingScriptUrl.replace(/\/+$/, '') }, 'Sistem');
          } catch (eSetUrl) {}
        }
      } finally {
        lockSetup.releaseLock();
      }
      var driveOkSetup = false;
      var folderIdSetup = getDriveFolderId_();
      if (folderIdSetup) {
        try {
          var fSetup = DriveApp.getFolderById(folderIdSetup);
          driveOkSetup = Boolean(fSetup && (!fSetup.isTrashed || !fSetup.isTrashed()));
        } catch (eDrvSetup) {}
      }
      var dbSetup = getFullDatabase_();
      var senderEmail = getActiveSenderEmail_();
      return makeResp_(200, {
        success: true,
        configured: missingSetup.length === 0 && driveOkSetup,
        sheetsConfigured: true,
        driveConfigured: driveOkSetup,
        spreadsheetConfigured: true,
        driveFolderConfigured: driveOkSetup,
        authMode: 'apps_script',
        emailConnected: true,
        emailTransport: 'apps_script_gmail',
        senderEmail: senderEmail,
        missingConfig: missingSetup,
        missingEnv: missingSetup,
        serverTime: new Date().toISOString(),
        data: buildDatabasePayload_(dbSetup),
      });
    }

    // 2. /api/photos (Upload ke folder privat & baca via endpoint Apps Script tanpa folder publik)
    if (pathname === '/api/photos') {
      if (method === 'GET') {
        var fileId = extractDriveFileId_(query.id || '');
        if (!fileId) {
          return makeResp_(400, { error: 'Parameter id file Drive tidak valid.' });
        }
        var photo = getPhotoFromDrive_(fileId);
        if (photo.notFound) {
          return makeResp_(404, { notFound: true, error: photo.error || 'Foto tidak ditemukan di Google Drive.' });
        }
        return makeResp_(200, {
          success: true,
          mimeType: photo.mimeType,
          fileName: photo.fileName,
          base64: photo.base64,
        });
      }
      if (method === 'POST') {
        if (!body.base64) return makeResp_(400, { error: 'Data base64 foto wajib diisi.' });
        var createdId = uploadPhotoToDrive_(body.base64, body.fileName || ('foto_' + Date.now() + '.jpg'));
        return makeResp_(200, { success: true, fileId: createdId });
      }
    }

    // 3. /api/sync
    if (pathname === '/api/sync') {
      var missingSync = getMissingConfigKeys_();
      if (!getSpreadsheetId_()) {
        return makeResp_(503, {
          error: 'SPREADSHEET_ID belum diisi di Script Properties Google Apps Script.',
          configured: false,
          missingConfig: missingSync,
          missingEnv: missingSync,
        });
      }
      var dbSync = getFullDatabase_();
      var driveOkSync = false;
      var folderIdSync = getDriveFolderId_();
      if (folderIdSync) {
        try {
          var fSync = DriveApp.getFolderById(folderIdSync);
          driveOkSync = Boolean(fSync && (!fSync.isTrashed || !fSync.isTrashed()));
        } catch (eDrvSync) {}
      }
      return makeResp_(200, {
        fullSnapshot: true,
        configured: missingSync.length === 0 && driveOkSync,
        sheetsConfigured: true,
        driveConfigured: driveOkSync,
        spreadsheetConfigured: true,
        driveFolderConfigured: driveOkSync,
        authMode: 'apps_script',
        emailConnected: true,
        emailTransport: 'apps_script_gmail',
        senderEmail: getActiveSenderEmail_(),
        missingConfig: missingSync,
        missingEnv: missingSync,
        serverTime: new Date().toISOString(),
        data: buildDatabasePayload_(dbSync),
      });
    }

    // 4. /api/auth
    if (pathname === '/api/auth') {
      var action = query.action || body.action;
      var ssAuth = getSpreadsheet_();
      ensureSheetsAndHeaders_(ssAuth);
      ensureSeedData_(ssAuth);

      var validateTokenFn = validateTokenAgainstSheet_;

      if (!action && method === 'GET') {
        if (!token) return makeResp_(401, { error: 'Token sesi tidak ditemukan.' });
        var v = validateTokenFn(token);
        if (!v.valid) return makeResp_(401, { error: v.reason, sessionInvalidated: Boolean(v.invalidated) });
        return makeResp_(200, { valid: true, session: v.session });
      }

      if (action === 'login_duty') {
        var cache = CacheService.getScriptCache();
        var lockKey = 'dkb_duty_lock';
        var lockRaw = cache.get(lockKey);
        var lockInfo = lockRaw ? JSON.parse(lockRaw) : { attempts: 0, lockedUntil: 0 };
        var nowMs = Date.now();
        if (lockInfo.lockedUntil > nowMs) {
          var waitSec = Math.ceil((lockInfo.lockedUntil - nowMs) / 1000);
          return makeResp_(400, {
            error: 'Terlalu banyak percobaan salah. Akun dikunci sementara selama ' + waitSec + ' detik lagi.',
            lockedForSeconds: waitSec,
          });
        }

        if (!body.password) return makeResp_(400, { error: 'Password wajib diisi.' });
        var usersD = getFullDatabase_().users;
        var dutyUsers = usersD.filter(function (u) { return u.role === 'duty' && u.is_active; });
        var matchedD = dutyUsers.filter(function (u) { return verifyPassword_(body.password, u.password_hash); })[0];
        if (!matchedD) {
          var adminD = usersD.filter(function (u) { return u.role === 'admin' && u.is_active; })[0];
          if (adminD && verifyPassword_(body.password, adminD.password_hash)) matchedD = adminD;
        }
        if (!matchedD) {
          lockInfo.attempts += 1;
          if (lockInfo.attempts >= LOCKOUT_MAX_ATTEMPTS) {
            lockInfo.lockedUntil = nowMs + LOCKOUT_SECONDS * 1000;
            lockInfo.attempts = 0;
            cache.put(lockKey, JSON.stringify(lockInfo), LOCKOUT_SECONDS + 10);
            return makeResp_(400, {
              error: 'Password salah 5 kali. Akses masuk dikunci selama 5 menit.',
              lockedForSeconds: LOCKOUT_SECONDS,
            });
          }
          cache.put(lockKey, JSON.stringify(lockInfo), LOCKOUT_SECONDS + 10);
          return makeResp_(400, {
            error: 'Password piket salah. Sisa percobaan: ' + (LOCKOUT_MAX_ATTEMPTS - lockInfo.attempts) + '.',
            remainingAttempts: LOCKOUT_MAX_ATTEMPTS - lockInfo.attempts,
          });
        }

        cache.remove(lockKey);
        var tokD = signJwt_({
          userId: matchedD.id, role: matchedD.role, name: matchedD.name,
          label: matchedD.label, tokenVersion: matchedD.token_version
        });
        return makeResp_(200, { success: true, token: tokD });
      }

      if (action === 'unlock_homeroom') {
        if (!body.name || !body.password) return makeResp_(400, { error: 'Nama dan password wali kelas wajib diisi.' });
        var curSess = token ? verifyJwt_(token) : null;
        var cleanName = String(body.name).trim().toLowerCase();
        var dbHr = getFullDatabase_();
        var hrUsers = dbHr.users.filter(function (u) { return u.role === 'homeroom' && u.is_active; });
        var adminHr = dbHr.users.filter(function (u) { return u.role === 'admin' && u.is_active; })[0];

        var matchedHr = hrUsers.filter(function (u) {
          var un = u.name.toLowerCase().trim();
          return un === cleanName || un.indexOf(cleanName) >= 0 || cleanName.indexOf(un) >= 0;
        })[0];
        if (!matchedHr && body.classId) {
          matchedHr = hrUsers.filter(function (u) { return u.class_id === body.classId; })[0];
        }

        var targetClassId = body.classId;
        if (!matchedHr) {
          var matchedClass = dbHr.classes.filter(function (c) {
            var tn = String(c.homeroom_teacher_name || '').toLowerCase().trim();
            return tn === cleanName || (tn && (tn.indexOf(cleanName) >= 0 || cleanName.indexOf(tn) >= 0)) ||
              c.name.toLowerCase().trim() === cleanName || c.id.toLowerCase().trim() === cleanName ||
              (body.classId && c.id === body.classId);
          })[0];
          if (matchedClass) {
            targetClassId = matchedClass.id;
            var masterHr = dbHr.users.filter(function (u) { return u.id === 'user_homeroom_master'; })[0] || hrUsers[0];
            var pwOk = (masterHr && verifyPassword_(body.password, masterHr.password_hash)) ||
              (adminHr && verifyPassword_(body.password, adminHr.password_hash));
            if (!pwOk) return makeResp_(400, { error: 'Password wali kelas salah.' });
            var newHr = {
              id: 'user_homeroom_' + matchedClass.id.toLowerCase().replace(/[^a-z0-9]/g, '_'),
              role: 'homeroom',
              name: matchedClass.homeroom_teacher_name || ('Wali Kelas ' + matchedClass.name),
              class_id: matchedClass.id,
              email: matchedClass.homeroom_teacher_email,
              label: 'Wali Kelas ' + matchedClass.name,
              password_hash: masterHr ? masterHr.password_hash : hashPassword_(body.password),
              token_version: 1,
              is_active: true,
            };
            saveUser_(ssAuth, newHr, 'Sistem');
            matchedHr = newHr;
          }
        }
        if (!matchedHr) return makeResp_(400, { error: 'Akun atau kelas untuk "' + body.name + '" tidak ditemukan.' });

        var hrPwValid = verifyPassword_(body.password, matchedHr.password_hash) ||
          (adminHr && verifyPassword_(body.password, adminHr.password_hash));
        if (!hrPwValid) return makeResp_(400, { error: 'Password wali kelas salah.' });

        targetClassId = matchedHr.class_id || targetClassId || '10-RPL-1';
        var tokHr = signJwt_({
          userId: matchedHr.id, role: matchedHr.role, name: matchedHr.name, label: matchedHr.label,
          tokenVersion: matchedHr.token_version, lockedMenuRole: 'homeroom', lockedMenuClassId: targetClassId
        });
        return makeResp_(200, { success: true, token: tokHr, classId: targetClassId, teacherName: matchedHr.name });
      }

      if (action === 'unlock_student_affairs') {
        if (!body.password) return makeResp_(400, { error: 'Password wajib diisi.' });
        var usersSA = getFullDatabase_().users;
        var saUser = usersSA.filter(function (u) { return u.role === 'student_affairs' && u.is_active; })[0];
        var adminSA = usersSA.filter(function (u) { return u.role === 'admin' && u.is_active; })[0];
        var okSA = (saUser && verifyPassword_(body.password, saUser.password_hash)) ||
                   (adminSA && verifyPassword_(body.password, adminSA.password_hash));
        if (!okSA) return makeResp_(400, { error: 'Password kesiswaan salah.' });
        var actSA = saUser || adminSA;
        var tokSA = signJwt_({
          userId: actSA.id, role: actSA.role, name: actSA.name, label: actSA.label,
          tokenVersion: actSA.token_version, lockedMenuRole: 'student_affairs'
        });
        return makeResp_(200, { success: true, token: tokSA });
      }

      if (action === 'unlock_admin') {
        if (!body.password) return makeResp_(400, { error: 'Password admin wajib diisi.' });
        var usersA = getFullDatabase_().users;
        var adminA = usersA.filter(function (u) { return u.role === 'admin' && u.is_active; })[0];
        if (!adminA || !verifyPassword_(body.password, adminA.password_hash)) {
          return makeResp_(400, { error: 'Password admin salah.' });
        }
        var tokA = signJwt_({
          userId: adminA.id, role: 'admin', name: adminA.name, label: adminA.label,
          tokenVersion: adminA.token_version, lockedMenuRole: 'admin'
        });
        return makeResp_(200, { success: true, token: tokA });
      }

      if (action === 'verify_session') {
        if (!token) return makeResp_(401, { error: 'Unauthorized' });
        var v2 = validateTokenFn(token);
        if (!v2.valid) return makeResp_(401, { error: v2.reason, sessionInvalidated: Boolean(v2.invalidated) });
        return makeResp_(200, { valid: true, session: v2.session });
      }

      if (action === 'refresh_session') {
        if (!token) return makeResp_(401, { error: 'Unauthorized' });
        var vr = validateTokenFn(token);
        if (!vr.valid) return makeResp_(401, { error: vr.reason, sessionInvalidated: Boolean(vr.invalidated) });
        var refTok = signJwt_({
          userId: vr.user.id,
          role: vr.session.role || vr.user.role,
          name: vr.session.name || vr.user.name,
          label: vr.session.label || vr.user.label,
          tokenVersion: vr.user.token_version,
          lockedMenuRole: vr.session.lockedMenuRole,
          lockedMenuClassId: vr.session.lockedMenuClassId,
        });
        return makeResp_(200, { valid: true, token: refTok, session: vr.session });
      }

      if (action === 'manage_accounts') {
        var vMA = validateTokenFn(token);
        if (!vMA.valid) return makeResp_(401, { error: vMA.reason || 'Sesi tidak valid atau telah berakhir.', sessionInvalidated: Boolean(vMA.invalidated) });

        if (method === 'GET') {
          var listU = getFullDatabase_().users.map(function (u) {
            return {
              id: u.id, role: u.role, name: u.name, class_id: u.class_id,
              label: u.label, token_version: u.token_version, is_active: u.is_active, created_at: u.created_at
            };
          });
          return makeResp_(200, { users: listU });
        }

        if (method === 'POST') {
          var lockAuth = LockService.getScriptLock();
          lockAuth.waitLock(15000);
          try {
            var dbMA = getFullDatabase_();
            var usersMA = dbMA.users;
            var targetRole = body.targetRole;
            var newPassword = body.newPassword;
            var targetUserId = body.targetUserId;
            var classId = body.classId;
            var userIn = body.user;

            if (targetRole && newPassword) {
              if (String(newPassword).trim().length < 4) return makeResp_(400, { error: 'Password baru minimal 4 karakter.' });
              var newHash = hashPassword_(String(newPassword).trim());
              var targetU = null;
              var refreshedTok;

              if (targetRole === 'admin') {
                targetU = usersMA.filter(function (u) { return u.role === 'admin'; })[0] || {
                  id: 'user_admin_main', role: 'admin', name: 'Administrator Sekolah', label: 'Admin Sistem', token_version: 1, is_active: true
                };
                targetU.password_hash = newHash;
                targetU.token_version = (targetU.token_version || 1) + 1;
                targetU = saveUser_(ssAuth, targetU, vMA.session.name);
                refreshedTok = signJwt_({
                  userId: vMA.session.userId, role: vMA.session.role, name: vMA.session.name,
                  label: vMA.session.label, lockedMenuRole: vMA.session.lockedMenuRole,
                  lockedMenuClassId: vMA.session.lockedMenuClassId, tokenVersion: targetU.token_version
                });
              } else if (targetRole === 'student_affairs') {
                targetU = usersMA.filter(function (u) { return u.role === 'student_affairs'; })[0] || {
                  id: 'user_student_affairs', role: 'student_affairs', name: 'Bagian Kesiswaan & Tatib', label: 'Tim Kesiswaan', token_version: 1, is_active: true
                };
                targetU.password_hash = newHash;
                targetU.token_version = (targetU.token_version || 1) + 1;
                targetU = saveUser_(ssAuth, targetU, vMA.session.name);
              } else if (targetRole === 'duty') {
                targetU = usersMA.filter(function (u) { return u.role === 'duty'; })[0] || {
                  id: 'user_duty_main', role: 'duty', name: 'Petugas Piket Utama', label: 'Gerbang Utama & Pos Piket', token_version: 1, is_active: true
                };
                targetU.password_hash = newHash;
                targetU.token_version = (targetU.token_version || 1) + 1;
                targetU = saveUser_(ssAuth, targetU, vMA.session.name);
              } else if (targetRole === 'homeroom') {
                if (classId) {
                  var tc = dbMA.classes.filter(function (c) { return c.id === classId; })[0];
                  targetU = usersMA.filter(function (u) { return u.role === 'homeroom' && u.class_id === classId; })[0] || {
                    id: 'user_homeroom_' + classId.toLowerCase().replace(/[^a-z0-9]/g, '_'),
                    role: 'homeroom', name: (tc && tc.homeroom_teacher_name) || ('Wali Kelas ' + classId),
                    class_id: classId, email: tc && tc.homeroom_teacher_email,
                    label: 'Wali Kelas ' + ((tc && tc.name) || classId), token_version: 1, is_active: true
                  };
                  targetU.password_hash = newHash;
                  targetU.token_version = (targetU.token_version || 1) + 1;
                  targetU = saveUser_(ssAuth, targetU, vMA.session.name);
                } else {
                  usersMA.filter(function (u) { return u.role === 'homeroom'; }).forEach(function (hr) {
                    hr.password_hash = newHash;
                    hr.token_version = (hr.token_version || 1) + 1;
                    saveUser_(ssAuth, hr, vMA.session.name);
                  });
                  var mHr = usersMA.filter(function (u) { return u.id === 'user_homeroom_master'; })[0] || {
                    id: 'user_homeroom_master', role: 'homeroom', name: 'Wali Kelas Umum',
                    label: 'Sandi Bersama Seluruh Wali Kelas', token_version: 1, is_active: true
                  };
                  mHr.password_hash = newHash;
                  mHr.token_version = (mHr.token_version || 1) + 1;
                  targetU = saveUser_(ssAuth, mHr, vMA.session.name);
                }
              }
              return makeResp_(200, { success: true, user: targetU, refreshedToken: refreshedTok });
            }

            if (targetUserId && newPassword) {
              if (String(newPassword).trim().length < 4) return makeResp_(400, { error: 'Password baru minimal 4 karakter.' });
              var tU = usersMA.filter(function (u) { return u.id === targetUserId; })[0];
              if (!tU) return makeResp_(404, { error: 'Akun tidak ditemukan.' });
              tU.password_hash = hashPassword_(String(newPassword).trim());
              tU.token_version = (tU.token_version || 1) + 1;
              tU = saveUser_(ssAuth, tU, vMA.session.name);
              var refTok2;
              if (vMA.session.userId === tU.id) {
                refTok2 = signJwt_({
                  userId: vMA.session.userId, role: vMA.session.role, name: vMA.session.name,
                  label: vMA.session.label, lockedMenuRole: vMA.session.lockedMenuRole,
                  lockedMenuClassId: vMA.session.lockedMenuClassId, tokenVersion: tU.token_version
                });
              }
              return makeResp_(200, { success: true, user: tU, refreshedToken: refTok2 });
            }

            if (!userIn || !userIn.id || !userIn.role || !userIn.name) {
              return makeResp_(400, { error: 'Data akun tidak lengkap.' });
            }
            var exU = usersMA.filter(function (u) { return u.id === userIn.id; })[0];
            if (!exU && (!newPassword || String(newPassword).trim().length < 4)) {
              return makeResp_(400, { error: 'Password minimal 4 karakter untuk akun baru.' });
            }
            var pwHash = exU ? exU.password_hash : '';
            var tv = exU ? exU.token_version : 1;
            if (newPassword && String(newPassword).trim().length >= 4) {
              pwHash = hashPassword_(String(newPassword).trim());
              tv += 1;
            }
            userIn.password_hash = pwHash;
            userIn.token_version = tv;
            var savedU = saveUser_(ssAuth, userIn, vMA.session.name);
            var refTok3;
            if (vMA.session.userId === savedU.id && newPassword && String(newPassword).trim().length >= 4) {
              refTok3 = signJwt_({
                userId: vMA.session.userId, role: vMA.session.role, name: vMA.session.name,
                label: vMA.session.label, lockedMenuRole: vMA.session.lockedMenuRole,
                lockedMenuClassId: vMA.session.lockedMenuClassId, tokenVersion: savedU.token_version
              });
            }
            return makeResp_(200, { success: true, user: savedU, refreshedToken: refTok3 });
          } finally {
            lockAuth.releaseLock();
          }
        }

        if (method === 'DELETE') {
          if (body.id === 'user_admin_main') return makeResp_(400, { error: 'Akun admin utama tidak boleh dihapus.' });
          softDeleteRow_(ssAuth, { tabName: SHEET_TABS.USERS, id: body.id, actorName: vMA.session.name, reason: 'Hapus akun pengguna' });
          return makeResp_(200, { success: true });
        }
      }

      return makeResp_(400, { error: 'Aksi auth tidak dikenali.' });
    }

    // 5. /api/attendance
    if (pathname === '/api/attendance') {
      var ssAtt = getSpreadsheet_();
      if (method === 'GET') {
        return makeResp_(200, { records: getFullDatabase_().attendance, serverTime: new Date().toISOString() });
      }

      if (method === 'POST') {
        var incomingScans = Array.isArray(body.scans) ? body.scans : [body];
        if (incomingScans.length === 0) return makeResp_(400, { error: 'Tidak ada data scan presensi untuk diproses.' });

        var lockAtt = LockService.getScriptLock();
        lockAtt.waitLock(15000);
        try {
          var dbAtt = getFullDatabase_();
          var serverNow = new Date();
          var curDateStr = toDateYmd_(serverNow);
          var clockNow = getLocalClockParts_(serverNow);
          var autoSwitch = dbAtt.settings.auto_session_switch !== false;
          var sessTok = token ? verifyJwt_(token) : null;
          var actorNameAtt = (sessTok && sessTok.name) || 'Sistem Presensi';

          var prepared = [];
          var stuByRec = {};
          var sessByRec = {};
          var immedRejections = [];

          incomingScans.forEach(function (item) {
            var code = item && item.code;
            var studentId = item && item.studentId;
            var sessionId = item && item.sessionId;
            var status = item && item.status;
            var notes = item && item.notes;
            var attMethod = item && item.method;
            var deviceId = item && item.deviceId;
            var manualOverride = Boolean(item && item.manualOverride);
            var photoBase64 = item && item.photoBase64;
            var photoFileName = item && item.photoFileName;

            var student = null;
            if (code) {
              var clean = String(code).trim().toLowerCase();
              student = dbAtt.students.filter(function (s) {
                return s.nis.toLowerCase() === clean || s.rfid_uid.toLowerCase() === clean || s.card_code.toLowerCase() === clean;
              })[0];
            } else if (studentId) {
              student = dbAtt.students.filter(function (s) { return s.nis === String(studentId).trim(); })[0];
            }

            if (!student) {
              immedRejections.push({ code: code, studentId: studentId, message: 'Kartu atau NIS "' + (code || studentId || '-') + '" tidak terdaftar dalam database siswa.' });
              return;
            }

            var sched = resolveSessionSchedule_(dbAtt.sessions, serverNow, autoSwitch, manualOverride ? sessionId : null);
            var matchedSess = null;
            if (manualOverride && sessionId) {
              matchedSess = dbAtt.sessions.filter(function (s) { return s.id === sessionId; })[0];
            } else if (autoSwitch && sched.liveWindowSession) {
              matchedSess = sched.liveWindowSession;
            } else if (sessionId) {
              matchedSess = dbAtt.sessions.filter(function (s) { return s.id === sessionId && s.is_active; })[0];
            }
            var activeSess = matchedSess || sched.activeSession || dbAtt.sessions.filter(function (s) { return s.is_active; })[0] || dbAtt.sessions[0];

            var activeLeave = dbAtt.leave_requests.filter(function (l) {
              return l.student_id === student.nis && l.status === 'approved' && curDateStr >= l.start_date && curDateStr <= l.end_date;
            })[0];

            if (activeLeave && !status) {
              immedRejections.push({
                code: code, studentId: student.nis,
                message: 'Siswa ' + student.name + ' berstatus ' + String(activeLeave.type).toUpperCase() + ' hari ini: ' + activeLeave.reason
              });
              return;
            }

            var attStatus = status || 'Hadir';
            var lateMinutes = 0;
            if (!status && activeSess && activeSess.on_time_limit) {
              var limitParts = String(activeSess.on_time_limit).split(':');
              var limitMin = (Number(limitParts[0]) || 0) * 60 + (Number(limitParts[1]) || 0);
              var diffMin = clockNow.totalMinutes - limitMin;
              if (diffMin > 0) {
                lateMinutes = diffMin;
                attStatus = 'Terlambat';
              }
            }

            var photoId = '';
            if (photoBase64) {
              photoId = uploadPhotoToDrive_(photoBase64, photoFileName || ('presensi_' + student.nis + '_' + Date.now() + '.jpg'));
            }

            var nowIso = serverNow.toISOString();
            var recId = randomId_('att');
            var record = {
              id: recId,
              student_id: student.nis,
              session_id: activeSess.id,
              date: curDateStr,
              timestamp: nowIso,
              status: attStatus,
              late_minutes: lateMinutes,
              method: attMethod || (String(code || '').indexOf('RFID-') === 0 ? 'rfid' : 'barcode'),
              device_id: deviceId || 'kiosk_main',
              photo_id: photoId,
              notes: notes || '',
              version: 1,
              created_at: nowIso,
              updated_at: nowIso,
              diubah_pada: nowIso,
            };
            prepared.push(record);
            stuByRec[recId] = student;
            sessByRec[recId] = activeSess;
          });

          var batchRes = appendAttendanceBatch_(ssAtt, prepared, actorNameAtt);
          batchRes.saved.forEach(function (rec) {
            if (rec.status === 'Terlambat' || rec.status === 'Alpha') {
              var st = stuByRec[rec.id];
              if (st) {
                notifyParent_({
                  student: st,
                  triggerType: rec.status === 'Terlambat' ? 'terlambat' : 'alpha',
                  status: rec.status + ' (' + rec.late_minutes + ' menit)',
                });
              }
            }
          });

          var allRej = immedRejections.concat(batchRes.rejectedDuplicates.map(function (d) {
            return { studentId: d.student_id, isDuplicate: true, message: d.reason };
          }));

          if (!Array.isArray(body.scans)) {
            if (batchRes.saved.length === 0 && allRej.length > 0) {
              return makeResp_(400, {
                error: allRej[0].message,
                isDuplicate: Boolean(allRej[0].isDuplicate),
                student: prepared[0] ? stuByRec[prepared[0].id] : undefined,
              });
            }
            var single = batchRes.saved[0];
            return makeResp_(200, {
              success: true,
              record: single,
              student: stuByRec[single.id],
              session: sessByRec[single.id],
              serverTime: serverNow.toISOString(),
              snapshot: buildDatabasePayload_(),
            });
          }

          return makeResp_(200, {
            success: true,
            savedCount: batchRes.saved.length,
            rejectedCount: allRej.length,
            results: batchRes.saved.map(function (rec) {
              return { record: rec, student: stuByRec[rec.id], session: sessByRec[rec.id] };
            }),
            rejectedDuplicates: allRej,
            serverTime: serverNow.toISOString(),
            snapshot: buildDatabasePayload_(),
          });
        } finally {
          lockAtt.releaseLock();
        }
      }

      if (method === 'PUT') {
        var vAttPut = validateTokenAgainstSheet_(token);
        if (!vAttPut.valid) return makeResp_(401, { error: vAttPut.reason || 'Unauthorized', sessionInvalidated: Boolean(vAttPut.invalidated) });
        var sessPut = vAttPut.session;
        var lockPut = LockService.getScriptLock();
        lockPut.waitLock(15000);
        try {
          var nowIsoPut = new Date().toISOString();
          var patchAtt = {
            audited_by: sessPut.name || 'Petugas',
            audit_reason: body.reason || 'Koreksi presensi',
            updated_at: nowIsoPut,
            diubah_pada: nowIsoPut,
          };
          if (body.updates && body.updates.status) patchAtt.status_presensi = body.updates.status;
          if (body.updates && body.updates.late_minutes !== undefined) patchAtt.late_minutes = body.updates.late_minutes;
          if (body.updates && body.updates.notes !== undefined) patchAtt.notes = body.updates.notes;

          var updRes = updateRowPartial_(ssAtt, {
            tabName: SHEET_TABS.PRESENSI,
            id: body.id,
            newRowObj: patchAtt,
            expectedUpdatedAt: body.expected_updated_at,
            forceOverwrite: Boolean(body.forceOverwrite),
            actorName: sessPut.name || 'Petugas',
            reason: body.reason || 'Koreksi presensi',
          });
          if (updRes.conflict) return makeResp_(409, { error: 'Data sudah diubah oleh pengguna lain sebelum Anda menyimpan.', conflict: true, current: updRes.current });
          if (!updRes.updated) return makeResp_(404, { error: 'Data presensi tidak ditemukan.' });
          try { syncSessionRecapSheet_(ssAtt, updRes.oldObj.date); } catch (e) {}
          return makeResp_(200, { success: true, record: updRes.oldObj, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockPut.releaseLock();
        }
      }

      if (method === 'DELETE') {
        var vAttDel = validateTokenAgainstSheet_(token);
        if (!vAttDel.valid) return makeResp_(401, { error: vAttDel.reason || 'Unauthorized', sessionInvalidated: Boolean(vAttDel.invalidated) });
        var sessDel = vAttDel.session;
        var lockAttDel = LockService.getScriptLock();
        lockAttDel.waitLock(15000);
        try {
          var okDel = softDeleteRow_(ssAtt, {
            tabName: SHEET_TABS.PRESENSI,
            id: body.id,
            actorName: sessDel.name || 'Petugas',
            reason: body.reason || 'Pembatalan presensi',
          });
          return makeResp_(200, { success: okDel, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockAttDel.releaseLock();
        }
      }
    }

    // 6. /api/out-of-class
    if (pathname === '/api/out-of-class') {
      var ssOoc = getSpreadsheet_();
      if (method === 'GET') {
        var lockOocGet = LockService.getScriptLock();
        if (lockOocGet.tryLock(5000)) {
          try {
            autoCloseOverdueOutOfClass_(ssOoc);
          } finally {
            lockOocGet.releaseLock();
          }
        }
        return makeResp_(200, { records: getFullDatabase_().out_of_class });
      }

      if (method === 'POST') {
        if (!body.studentId || !body.type || !body.durationMinutes) {
          return makeResp_(400, { error: 'Data izin keluar tidak lengkap.' });
        }
        var lockOoc = LockService.getScriptLock();
        lockOoc.waitLock(15000);
        try {
          var dbOoc = getFullDatabase_();
          var stuOoc = dbOoc.students.filter(function (s) { return s.nis === body.studentId; })[0];
          if (!stuOoc) return makeResp_(400, { error: 'Siswa tidak ditemukan.' });
          var sessOoc = token ? verifyJwt_(token) : null;
          var nowOoc = new Date();
          var dueOoc = new Date(nowOoc.getTime() + Number(body.durationMinutes) * 60000);
          var newOoc = {
            id: randomId_('ooc'),
            student_id: stuOoc.nis,
            class_id: stuOoc.class_id,
            type: body.type,
            duration_minutes: Number(body.durationMinutes),
            started_at: nowOoc.toISOString(),
            due_at: dueOoc.toISOString(),
            late_return_minutes: 0,
            status: 'active',
            idempotency_key: body.idempotencyKey || ('key_' + Date.now()),
            version: 1,
            created_at: nowOoc.toISOString(),
            updated_at: nowOoc.toISOString(),
          };
          var oocRes = startOutOfClass_(ssOoc, newOoc, (sessOoc && sessOoc.name) || 'Petugas Piket');
          if (!oocRes.success) return makeResp_(400, { error: oocRes.error });
          return makeResp_(200, { success: true, record: oocRes.record, student: stuOoc, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockOoc.releaseLock();
        }
      }

      if (method === 'PUT') {
        var lockOocPut = LockService.getScriptLock();
        lockOocPut.waitLock(15000);
        try {
          var dbPutOoc = getFullDatabase_();
          var existingOoc = dbPutOoc.out_of_class.filter(function (r) { return r.id === body.id; })[0];
          if (!existingOoc) return makeResp_(400, { error: 'Catatan izin keluar tidak ditemukan.' });
          if (existingOoc.status === 'returned' || existingOoc.status === 'auto_closed') {
            return makeResp_(200, { success: true, alreadyReturned: true, record: existingOoc });
          }

          var nowRet = new Date();
          var nowRetIso = nowRet.toISOString();
          var actualMin = Math.max(1, Math.round((nowRet.getTime() - new Date(existingOoc.started_at).getTime()) / 60000));
          var lateRetMin = Math.max(0, Math.round((nowRet.getTime() - new Date(existingOoc.due_at).getTime()) / 60000));
          var sessOocPut = token ? verifyJwt_(token) : null;
          var actorOocPut = (sessOocPut && sessOocPut.name) || 'Petugas Piket';

          var updOoc = updateRowPartial_(ssOoc, {
            tabName: SHEET_TABS.IZIN_KELUAR,
            id: body.id,
            newRowObj: {
              status_izin: 'returned',
              returned_at: nowRetIso,
              actual_minutes: actualMin,
              late_return_minutes: lateRetMin,
              return_method: body.returnMethod || 'click',
              return_notes: body.notes || '',
              audited_by: actorOocPut,
              audit_reason: body.auditReason || '',
              updated_at: nowRetIso,
              diubah_pada: nowRetIso,
            },
            expectedUpdatedAt: body.expected_updated_at,
            forceOverwrite: Boolean(body.forceOverwrite),
            actorName: actorOocPut,
            reason: body.auditReason || 'Konfirmasi kembali ke kelas',
          });
          if (updOoc.conflict) return makeResp_(409, { error: 'Data izin keluar telah diperbarui pengguna lain.', conflict: true, current: updOoc.current });

          var updatedOocRec = {
            id: existingOoc.id, student_id: existingOoc.student_id, class_id: existingOoc.class_id,
            type: existingOoc.type, duration_minutes: existingOoc.duration_minutes,
            started_at: existingOoc.started_at, due_at: existingOoc.due_at,
            status: 'returned', returned_at: nowRetIso, actual_minutes: actualMin,
            late_return_minutes: lateRetMin, return_method: body.returnMethod || 'click',
            return_notes: body.notes, updated_at: nowRetIso, diubah_pada: nowRetIso,
          };

          if (lateRetMin > 0) {
            var stuRet = dbPutOoc.students.filter(function (s) { return s.nis === existingOoc.student_id; })[0];
            if (stuRet) {
              notifyParent_({
                student: stuRet,
                triggerType: 'melebihi_waktu',
                status: 'Melebihi Waktu Izin Keluar (+' + lateRetMin + ' menit)',
                lateReturnMinutes: lateRetMin,
              });
            }
          }

          return makeResp_(200, { success: true, record: updatedOocRec, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockOocPut.releaseLock();
        }
      }
    }

    // 7. /api/violations
    if (pathname === '/api/violations') {
      var ssVio = getSpreadsheet_();
      if (method === 'GET') {
        var dbVio = getFullDatabase_();
        return makeResp_(200, { violations: dbVio.violations, types: dbVio.violation_types });
      }
      if (method === 'POST') {
        var lockVio = LockService.getScriptLock();
        lockVio.waitLock(15000);
        try {
          var dbVioPost = getFullDatabase_();
          var stuV = dbVioPost.students.filter(function (s) { return s.nis === body.studentId; })[0];
          if (!stuV) return makeResp_(400, { error: 'Siswa tidak ditemukan.' });
          var vt = dbVioPost.violation_types.filter(function (t) { return t.id === body.violationTypeId; })[0];
          if (!vt) return makeResp_(400, { error: 'Jenis pelanggaran tidak valid.' });

          var evidenceId = '';
          if (body.evidenceBase64) {
            evidenceId = uploadPhotoToDrive_(body.evidenceBase64, body.evidenceFileName || ('bukti_' + stuV.nis + '_' + Date.now() + '.jpg'));
          }

          var sessV = token ? verifyJwt_(token) : null;
          var recordedBy = (sessV && sessV.name) || 'Petugas';
          var nowV = new Date().toISOString();
          var vioRec = {
            id: randomId_('vio'),
            student_id: stuV.nis,
            class_id: stuV.class_id,
            violation_type_id: vt.id,
            type_name: vt.name,
            category: vt.category,
            points: body.customPoints !== undefined ? Number(body.customPoints) : vt.default_points,
            notes: body.notes || '',
            location: body.location || '',
            evidence_photo_url: evidenceId,
            recorded_by: recordedBy,
            recorded_at: nowV,
            version: 1,
            created_at: nowV,
            updated_at: nowV,
            status: 'aktif',
            diubah_pada: nowV,
          };
          appendRows_(ssVio, SHEET_TABS.PELANGGARAN, [vioRec]);
          appendLog_(ssVio, {
            waktu: nowV, pengguna: recordedBy, id_data: vioRec.id, tabel: SHEET_TABS.PELANGGARAN,
            aksi: 'tambah', nilai_baru: JSON.stringify(vioRec)
          });

          var studentVios = dbVioPost.violations.concat([vioRec]).filter(function (v) { return v.student_id === stuV.nis; });
          var totalPoints = studentVios.reduce(function (acc, cur) {
            return acc + (cur.category === 'prestasi' ? -cur.points : cur.points);
          }, 0);

          notifyParent_({
            student: stuV,
            triggerType: 'pelanggaran',
            status: 'Pelanggaran: ' + vt.name,
            violationName: vt.name,
            points: vioRec.points,
          });

          var threshold = (dbVioPost.notification_settings && dbVioPost.notification_settings.warning_threshold_points) || 25;
          if (totalPoints >= threshold && vt.category !== 'prestasi') {
            notifyParent_({
              student: stuV,
              triggerType: 'ambang_peringatan',
              status: 'Poin Pelanggaran Mencapai Ambang Batas SP (' + totalPoints + ' poin)',
              violationName: vt.name,
              points: totalPoints,
            });
          }

          return makeResp_(200, { success: true, violation: vioRec, studentTotalPoints: totalPoints, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockVio.releaseLock();
        }
      }
      if (method === 'DELETE') {
        var vVDel = validateTokenAgainstSheet_(token);
        if (!vVDel.valid) return makeResp_(401, { error: vVDel.reason || 'Unauthorized', sessionInvalidated: Boolean(vVDel.invalidated) });
        var sessVDel = vVDel.session;
        var lockVDel = LockService.getScriptLock();
        lockVDel.waitLock(15000);
        try {
          var okVDel = softDeleteRow_(ssVio, {
            tabName: SHEET_TABS.PELANGGARAN,
            id: body.id,
            actorName: sessVDel.name || 'Admin',
            reason: body.reason || 'Koreksi pelanggaran',
          });
          return makeResp_(200, { success: okVDel, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockVDel.releaseLock();
        }
      }
    }

    // 8. /api/violation-types
    if (pathname === '/api/violation-types') {
      var ssVt = getSpreadsheet_();
      if (method === 'GET') return makeResp_(200, { types: getFullDatabase_().violation_types });
      var vVt = validateTokenAgainstSheet_(token);
      if (!vVt.valid) return makeResp_(401, { error: vVt.reason || 'Unauthorized', sessionInvalidated: Boolean(vVt.invalidated) });
      var sessVt = vVt.session;

      if (method === 'POST') {
        if (!body.name || !body.code || !body.category) return makeResp_(400, { error: 'Nama, kode, dan kategori wajib diisi.' });
        var lockVt = LockService.getScriptLock();
        lockVt.waitLock(15000);
        try {
          var nowVt = new Date().toISOString();
          var cleanVt = {
            id: String(body.id || ('vt_' + Date.now())).trim(),
            code: String(body.code).trim(),
            name: String(body.name).trim(),
            category: body.category,
            default_points: parseNum_(body.default_points, 5),
            is_active: body.is_active !== false,
            description: String(body.description || '').trim(),
            created_at: body.created_at || nowVt,
            updated_at: nowVt,
            status: 'aktif',
            diubah_pada: nowVt,
          };
          var updVt = updateRowPartial_(ssVt, {
            tabName: SHEET_TABS.JENIS_PELANGGARAN,
            id: cleanVt.id,
            newRowObj: cleanVt,
            expectedUpdatedAt: body.expected_updated_at,
            forceOverwrite: Boolean(body.forceOverwrite),
            actorName: sessVt.name || 'Admin',
            reason: 'Simpan jenis pelanggaran',
          });
          if (updVt.conflict) return makeResp_(409, { error: 'Konflik edit jenis pelanggaran.', conflict: true, current: updVt.current });
          if (!updVt.updated) {
            appendRows_(ssVt, SHEET_TABS.JENIS_PELANGGARAN, [cleanVt]);
            appendLog_(ssVt, { waktu: nowVt, pengguna: sessVt.name || 'Admin', id_data: cleanVt.id, tabel: SHEET_TABS.JENIS_PELANGGARAN, aksi: 'tambah', nilai_baru: JSON.stringify(cleanVt) });
          }
          return makeResp_(200, { success: true, violationType: cleanVt, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockVt.releaseLock();
        }
      }
      if (method === 'DELETE') {
        var lockVtDel = LockService.getScriptLock();
        lockVtDel.waitLock(15000);
        try {
          softDeleteRow_(ssVt, { tabName: SHEET_TABS.JENIS_PELANGGARAN, id: body.id, actorName: sessVt.name || 'Admin', reason: 'Hapus jenis pelanggaran' });
          return makeResp_(200, { success: true, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockVtDel.releaseLock();
        }
      }
    }

    // 9. /api/students
    if (pathname === '/api/students') {
      var ssStu = getSpreadsheet_();
      if (method === 'GET') return makeResp_(200, { students: getFullDatabase_().students });
      var vStu = validateTokenAgainstSheet_(token);
      if (!vStu.valid) return makeResp_(401, { error: vStu.reason || 'Unauthorized', sessionInvalidated: Boolean(vStu.invalidated) });
      var sessStu = vStu.session;
      var actorStu = sessStu.name || 'Admin';

      if (method === 'POST') {
        var lockStu = LockService.getScriptLock();
        lockStu.waitLock(15000);
        try {
          if (query.action === 'batch_import') {
            var listIn = body.students;
            if (!Array.isArray(listIn) || listIn.length === 0) return makeResp_(400, { error: 'Daftar siswa kosong.' });

            var nowBatch = new Date().toISOString();

            // 1. Auto-create missing classes in ONE batch append
            var existingClsRows = readTabWithRowNumbers_(ssStu, SHEET_TABS.KELAS);
            var activeClsMap = {};
            existingClsRows.forEach(function (cr) {
              if (cr.data.status !== 'dihapus' && cr.data.id) {
                activeClsMap[String(cr.data.id).trim().toLowerCase()] = String(cr.data.id).trim();
              }
            });
            var newClassesMap = {};
            var newClassesArr = [];
            listIn.forEach(function (s) {
              var cid = String((s && s.class_id) || '').trim();
              if (!cid) return;
              var normCid = cid.toLowerCase();
              if (!activeClsMap[normCid] && !newClassesMap[normCid]) {
                var grade = '10';
                var gMatch = cid.match(/^(10|11|12)/i) || cid.match(/^(X|XI|XII)\b/i);
                if (gMatch) {
                  var gUp = String(gMatch[1]).toUpperCase();
                  grade = gUp === 'X' ? '10' : gUp === 'XI' ? '11' : gUp === 'XII' ? '12' : gUp;
                }
                var majorParts = cid.split('-');
                var major = majorParts.length > 1 ? String(majorParts[1]).trim() : 'Umum';
                var clsRec = {
                  id: cid,
                  name: cid,
                  grade: grade,
                  major: major || 'Umum',
                  homeroom_teacher_name: 'Wali Kelas ' + cid,
                  homeroom_teacher_email: cid.toLowerCase().replace(/[^a-z0-9]/g, '.') + '@sekolah.sch.id',
                  quota_limit: 2,
                  created_at: nowBatch,
                  updated_at: nowBatch,
                  status: 'aktif',
                  diubah_pada: nowBatch,
                };
                newClassesMap[normCid] = true;
                activeClsMap[normCid] = cid;
                newClassesArr.push(clsRec);
              }
            });
            if (newClassesArr.length > 0) {
              appendRows_(ssStu, SHEET_TABS.KELAS, newClassesArr);
            }

            // 2. Read Siswa tab ONCE and batch updates/appends without per-row re-reads
            var existingStu = readTabWithRowNumbers_(ssStu, SHEET_TABS.SISWA);
            var existingMap = {};
            existingStu.forEach(function (r) { existingMap[r.data.id] = r; });

            var stuHeaders = SHEET_HEADERS[SHEET_TABS.SISWA];
            var stuSheet = ssStu.getSheetByName(SHEET_TABS.SISWA);
            var toAppendStu = [];
            var updatedStu = 0;

            listIn.forEach(function (s) {
              if (!s || !s.nis || !s.name || !s.class_id) return;
              var nis = String(s.nis).trim();
              var rawClassId = String(s.class_id).trim();
              var resolvedClassId = activeClsMap[rawClassId.toLowerCase()] || rawClassId;
              var existingEntry = existingMap[nis];
              var hasActiveExisting = Boolean(existingEntry && existingEntry.data.status !== 'dihapus');
              var preservedPhoto = String(s.photo_url || '').trim() || (hasActiveExisting ? String(existingEntry.data.photo_url || '').trim() : '');

              var rec = {
                id: nis,
                nis: nis,
                nisn: String(s.nisn || '').trim(),
                name: String(s.name).trim(),
                class_id: resolvedClassId,
                gender: s.gender === 'P' ? 'P' : 'L',
                rfid_uid: String(s.rfid_uid || ('RFID-' + nis)).trim(),
                card_code: String(s.card_code || s.rfid_uid || nis).trim(),
                photo_url: preservedPhoto,
                parent_name: String(s.parent_name || '').trim(),
                parent_email: String(s.parent_email || '').trim(),
                created_at: (hasActiveExisting && existingEntry.data.created_at) ? existingEntry.data.created_at : (s.created_at || nowBatch),
                updated_at: nowBatch,
                status: 'aktif',
                diubah_pada: nowBatch,
              };

              if (hasActiveExisting) {
                var oldData = existingEntry.data;
                var changedCols = [];
                for (var hi = 0; hi < stuHeaders.length; hi++) {
                  var colName = stuHeaders[hi];
                  if (colName === 'updated_at' || colName === 'diubah_pada') continue;
                  var oldVal = oldData[colName] !== undefined ? String(oldData[colName]) : '';
                  var newVal = rec[colName] !== undefined && rec[colName] !== null ? String(rec[colName]) : '';
                  if (oldVal !== newVal) {
                    changedCols.push({ index: hi + 1, value: rec[colName] });
                  }
                }
                if (changedCols.length > 0 && stuSheet) {
                  for (var ci = 0; ci < changedCols.length; ci++) {
                    stuSheet.getRange(existingEntry.rowNumber, changedCols[ci].index).setValue(
                      changedCols[ci].value === undefined || changedCols[ci].value === null ? '' : changedCols[ci].value
                    );
                  }
                  var updColIdx = stuHeaders.indexOf('updated_at');
                  var chgColIdx = stuHeaders.indexOf('diubah_pada');
                  if (updColIdx >= 0) stuSheet.getRange(existingEntry.rowNumber, updColIdx + 1).setValue(nowBatch);
                  if (chgColIdx >= 0) stuSheet.getRange(existingEntry.rowNumber, chgColIdx + 1).setValue(nowBatch);
                  existingEntry.data = rec;
                  updatedStu++;
                }
              } else {
                toAppendStu.push(rec);
                existingMap[nis] = { rowNumber: -1, data: rec };
              }
            });

            if (toAppendStu.length > 0) {
              appendRows_(ssStu, SHEET_TABS.SISWA, toAppendStu);
            }
            if (toAppendStu.length > 0 || updatedStu > 0 || newClassesArr.length > 0) {
              appendLog_(ssStu, {
                waktu: nowBatch,
                pengguna: actorStu,
                id_data: 'batch_' + (toAppendStu.length + updatedStu),
                tabel: SHEET_TABS.SISWA,
                aksi: 'tambah',
                nilai_baru: JSON.stringify({ inserted: toAppendStu.length, updated: updatedStu, classesCreated: newClassesArr.length }),
                reason: 'Impor Excel/CSV batch',
              });
            }
            return makeResp_(200, {
              success: true,
              inserted: toAppendStu.length,
              updated: updatedStu,
              classesCreated: newClassesArr.length,
              serverTime: new Date().toISOString(),
              snapshot: buildDatabasePayload_(),
            });
          }

          if (!body.nis || !body.name || !body.class_id) return makeResp_(400, { error: 'NIS, Nama, dan Kelas wajib diisi.' });
          var photoUrlStu = body.photo_url || '';
          if (body.photoBase64) {
            photoUrlStu = uploadPhotoToDrive_(body.photoBase64, 'siswa_' + body.nis + '_' + Date.now() + '.jpg');
          }
          var nowStu = new Date().toISOString();
          var nisClean = String(body.nis).trim();
          var stuPayload = {
            id: nisClean, nis: nisClean, nisn: String(body.nisn || '').trim(),
            name: String(body.name).trim(), class_id: String(body.class_id).trim(),
            gender: body.gender === 'P' ? 'P' : 'L',
            rfid_uid: String(body.rfid_uid || '').trim(),
            card_code: String(body.card_code || body.rfid_uid || '').trim(),
            photo_url: String(photoUrlStu).trim(),
            parent_name: String(body.parent_name || '').trim(),
            parent_email: String(body.parent_email || '').trim(),
            created_at: body.created_at || nowStu,
            updated_at: nowStu, status: 'aktif', diubah_pada: nowStu,
          };
          var updStu = updateRowPartial_(ssStu, {
            tabName: SHEET_TABS.SISWA, id: nisClean, newRowObj: stuPayload,
            expectedUpdatedAt: body.expected_updated_at, forceOverwrite: Boolean(body.forceOverwrite),
            actorName: actorStu, reason: 'Simpan data siswa',
          });
          if (updStu.conflict) return makeResp_(409, { error: 'Konflik data siswa.', conflict: true, current: updStu.current });
          if (!updStu.updated) {
            appendRows_(ssStu, SHEET_TABS.SISWA, [stuPayload]);
            appendLog_(ssStu, { waktu: nowStu, pengguna: actorStu, id_data: nisClean, tabel: SHEET_TABS.SISWA, aksi: 'tambah', nilai_baru: JSON.stringify(stuPayload) });
          }
          return makeResp_(200, { success: true, student: stuPayload, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockStu.releaseLock();
        }
      }

      if (method === 'DELETE') {
        var lockStuDel = LockService.getScriptLock();
        lockStuDel.waitLock(15000);
        try {
          if (body.action === 'clear_all') {
            var activeRows = readTabWithRowNumbers_(ssStu, SHEET_TABS.SISWA).filter(function (r) { return r.data.status !== 'dihapus'; });
            activeRows.forEach(function (r) {
              softDeleteRow_(ssStu, { tabName: SHEET_TABS.SISWA, id: r.data.id, actorName: actorStu, reason: 'Kosongkan data siswa' });
            });
            return makeResp_(200, { success: true, count: activeRows.length, message: activeRows.length + ' data siswa berhasil dihapus.', serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
          }
          if (Array.isArray(body.nisses) && body.nisses.length > 0) {
            var cDel = 0;
            body.nisses.forEach(function (n) {
              if (softDeleteRow_(ssStu, { tabName: SHEET_TABS.SISWA, id: n, actorName: actorStu, reason: 'Hapus siswa' })) cDel++;
            });
            return makeResp_(200, { success: true, count: cDel, message: cDel + ' siswa berhasil dihapus.', serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
          }
          if (body.nis) {
            var okStu = softDeleteRow_(ssStu, { tabName: SHEET_TABS.SISWA, id: body.nis, actorName: actorStu, reason: 'Hapus siswa' });
            return makeResp_(200, { success: okStu, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
          }
          return makeResp_(400, { error: 'Parameter nis, nisses, atau action diperlukan.' });
        } finally {
          lockStuDel.releaseLock();
        }
      }
    }

    // 10. /api/classes
    if (pathname === '/api/classes') {
      var ssCls = getSpreadsheet_();
      if (method === 'GET') return makeResp_(200, { classes: getFullDatabase_().classes });
      var vCls = validateTokenAgainstSheet_(token);
      if (!vCls.valid) return makeResp_(401, { error: vCls.reason || 'Unauthorized', sessionInvalidated: Boolean(vCls.invalidated) });
      var sessCls = vCls.session;
      var actorCls = sessCls.name || 'Admin';

      if (method === 'POST') {
        var lockCls = LockService.getScriptLock();
        lockCls.waitLock(15000);
        try {
          var nowCls = new Date().toISOString();
          var cleanCls = {
            id: String(body.id).trim(),
            name: String(body.name || body.id).trim(),
            grade: String(body.grade || '10').trim(),
            major: String(body.major || '').trim(),
            homeroom_teacher_name: String(body.homeroom_teacher_name || '').trim(),
            homeroom_teacher_email: String(body.homeroom_teacher_email || '').trim(),
            quota_limit: parseNum_(body.quota_limit, 2),
            created_at: body.created_at || nowCls,
            updated_at: nowCls, status: 'aktif', diubah_pada: nowCls,
          };
          var updCls = updateRowPartial_(ssCls, {
            tabName: SHEET_TABS.KELAS, id: cleanCls.id, newRowObj: cleanCls,
            expectedUpdatedAt: body.expected_updated_at, forceOverwrite: Boolean(body.forceOverwrite),
            actorName: actorCls, reason: 'Simpan kelas',
          });
          if (updCls.conflict) return makeResp_(409, { error: 'Konflik edit kelas.', conflict: true, current: updCls.current });
          if (!updCls.updated) {
            appendRows_(ssCls, SHEET_TABS.KELAS, [cleanCls]);
            appendLog_(ssCls, { waktu: nowCls, pengguna: actorCls, id_data: cleanCls.id, tabel: SHEET_TABS.KELAS, aksi: 'tambah', nilai_baru: JSON.stringify(cleanCls) });
          }

          // Sync homeroom user record if present
          var hrU = getFullDatabase_().users.filter(function (u) { return u.role === 'homeroom' && u.class_id === cleanCls.id; })[0];
          if (hrU) {
            var changedHr = false;
            if (cleanCls.homeroom_teacher_name && hrU.name !== cleanCls.homeroom_teacher_name) { hrU.name = cleanCls.homeroom_teacher_name; changedHr = true; }
            if (cleanCls.homeroom_teacher_email && hrU.email !== cleanCls.homeroom_teacher_email) { hrU.email = cleanCls.homeroom_teacher_email; changedHr = true; }
            if (changedHr) saveUser_(ssCls, hrU, actorCls);
          }
          return makeResp_(200, { success: true, class: cleanCls, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockCls.releaseLock();
        }
      }
      if (method === 'DELETE') {
        var delId = body.id || query.id;
        var lockClsDel = LockService.getScriptLock();
        lockClsDel.waitLock(15000);
        try {
          if (delId) softDeleteRow_(ssCls, { tabName: SHEET_TABS.KELAS, id: delId, actorName: actorCls, reason: 'Hapus kelas' });
          return makeResp_(200, { success: true, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockClsDel.releaseLock();
        }
      }
    }

    // 11. /api/sessions
    if (pathname === '/api/sessions') {
      var ssSess = getSpreadsheet_();
      if (method === 'GET') return makeResp_(200, { sessions: getFullDatabase_().sessions });
      var vSess = validateTokenAgainstSheet_(token);
      if (!vSess.valid) return makeResp_(401, { error: vSess.reason || 'Unauthorized', sessionInvalidated: Boolean(vSess.invalidated) });
      var sessAuth = vSess.session;
      var actorSess = sessAuth.name || 'Admin';

      if (method === 'POST') {
        var lockSess = LockService.getScriptLock();
        lockSess.waitLock(15000);
        try {
          var nowSess = new Date().toISOString();
          var cleanSess = {
            id: String(body.id || ('sesi_' + Date.now())).trim(),
            name: String(body.name).trim(),
            start_time: String(body.start_time || '06:00').trim(),
            on_time_limit: String(body.on_time_limit || '07:00').trim(),
            end_time: String(body.end_time || '08:00').trim(),
            active_days: JSON.stringify(Array.isArray(body.active_days) ? body.active_days : [1, 2, 3, 4, 5, 6]),
            late_tolerance_minutes: parseNum_(body.late_tolerance_minutes, 0),
            is_active: body.is_active !== false,
            is_override: Boolean(body.is_override),
            created_at: body.created_at || nowSess,
            updated_at: nowSess, status: 'aktif', diubah_pada: nowSess,
          };
          var updSess = updateRowPartial_(ssSess, {
            tabName: SHEET_TABS.SESI_PRESENSI, id: cleanSess.id, newRowObj: cleanSess,
            expectedUpdatedAt: body.expected_updated_at, forceOverwrite: Boolean(body.forceOverwrite),
            actorName: actorSess, reason: 'Simpan sesi presensi',
          });
          if (updSess.conflict) return makeResp_(409, { error: 'Konflik edit sesi.', conflict: true, current: updSess.current });
          if (!updSess.updated) {
            appendRows_(ssSess, SHEET_TABS.SESI_PRESENSI, [cleanSess]);
            appendLog_(ssSess, { waktu: nowSess, pengguna: actorSess, id_data: cleanSess.id, tabel: SHEET_TABS.SESI_PRESENSI, aksi: 'tambah', nilai_baru: JSON.stringify(cleanSess) });
          }
          cleanSess.active_days = parseJsonArray_(cleanSess.active_days, [1, 2, 3, 4, 5, 6]);
          return makeResp_(200, { success: true, session: cleanSess, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockSess.releaseLock();
        }
      }
      if (method === 'DELETE') {
        var delSessId = body.id || query.id;
        var lockSessDel = LockService.getScriptLock();
        lockSessDel.waitLock(15000);
        try {
          if (delSessId) softDeleteRow_(ssSess, { tabName: SHEET_TABS.SESI_PRESENSI, id: delSessId, actorName: actorSess, reason: 'Hapus sesi presensi' });
          return makeResp_(200, { success: true, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockSessDel.releaseLock();
        }
      }
    }

    // 12. /api/settings
    if (pathname === '/api/settings') {
      if (method === 'GET') return makeResp_(200, { settings: getFullDatabase_().settings });
      var vSet = validateTokenAgainstSheet_(token);
      if (!vSet.valid) return makeResp_(401, { error: vSet.reason || 'Unauthorized', sessionInvalidated: Boolean(vSet.invalidated) });
      var sessSet = vSet.session;
      var lockSet = LockService.getScriptLock();
      lockSet.waitLock(15000);
      try {
        var patchSet = {};
        for (var sk in body) patchSet[sk] = body[sk];
        if (patchSet.logoBase64) {
          patchSet.logo_url = uploadPhotoToDrive_(patchSet.logoBase64, 'logo_sekolah_' + Date.now() + '.jpg');
          delete patchSet.logoBase64;
        }
        var resSet = updateSettings_(patchSet, sessSet.name || 'Admin');
        if (resSet.conflict) return makeResp_(409, { error: 'Konflik pengaturan.', conflict: true, current: resSet.current });
        return makeResp_(200, { success: true, settings: resSet.settings, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
      } finally {
        lockSet.releaseLock();
      }
    }

    // 13. /api/notifications
    if (pathname === '/api/notifications') {
      if (method === 'GET') {
        var dbN = getFullDatabase_();
        return makeResp_(200, {
          settings: dbN.notification_settings,
          logs: dbN.notification_logs,
          emailConnected: true,
          emailTransport: 'apps_script_gmail',
          senderEmail: getActiveSenderEmail_(),
        });
      }
      var actorN = 'Admin';
      if (token && token !== 'undefined' && token !== 'null') {
        var vn = validateTokenAgainstSheet_(token);
        if (!vn.valid && vn.invalidated) {
          return makeResp_(401, { error: vn.reason || 'Unauthorized', sessionInvalidated: true });
        }
        if (vn.valid && vn.session && vn.session.name) actorN = vn.session.name;
      }
      if (query.action === 'test_email') {
        if (!body.email) return makeResp_(400, { error: 'Email tujuan wajib diisi.' });
        return makeResp_(200, sendTestEmail_(body.email));
      }
      if (query.action === 'send_weekly_recap') {
        var recRes = body.classId ? sendWeeklyHomeroomRecap_(body.classId) : sendAllWeeklyRecaps_();
        return makeResp_(200, recRes);
      }
      var lockNotif = LockService.getScriptLock();
      lockNotif.waitLock(15000);
      try {
        var updNotif = updateNotificationSettings_(body, actorN);
        if (updNotif.conflict) return makeResp_(409, { error: 'Konflik pengaturan notifikasi.', conflict: true, current: updNotif.current });
        return makeResp_(200, { success: true, settings: updNotif.settings, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
      } finally {
        lockNotif.releaseLock();
      }
    }

    // 14. /api/leave-requests
    if (pathname === '/api/leave-requests') {
      var ssLr = getSpreadsheet_();
      if (method === 'GET') return makeResp_(200, { requests: getFullDatabase_().leave_requests });
      if (method === 'POST') {
        var lockLrP = LockService.getScriptLock();
        lockLrP.waitLock(15000);
        try {
          var nowLr = new Date().toISOString();
          var lrRow = {
            id: randomId_('lr'),
            student_id: body.student_id,
            class_id: body.class_id,
            type: body.type || 'Izin',
            start_date: body.start_date,
            end_date: body.end_date,
            reason: body.reason || '',
            letter_file_url: body.letter_file_url || '',
            status_persetujuan: 'pending',
            approved_by: '',
            approved_at: '',
            rejection_reason: '',
            created_at: nowLr, updated_at: nowLr, status: 'aktif', diubah_pada: nowLr,
          };
          appendRows_(ssLr, SHEET_TABS.IZIN_TIDAK_MASUK, [lrRow]);
          appendLog_(ssLr, { waktu: nowLr, pengguna: 'Pengaju Izin', id_data: lrRow.id, tabel: SHEET_TABS.IZIN_TIDAK_MASUK, aksi: 'tambah', nilai_baru: JSON.stringify(lrRow) });
          return makeResp_(200, { success: true, request: lrRow, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockLrP.releaseLock();
        }
      }
      if (method === 'PUT') {
        var vLr = validateTokenAgainstSheet_(token);
        if (!vLr.valid) return makeResp_(401, { error: vLr.reason || 'Unauthorized', sessionInvalidated: Boolean(vLr.invalidated) });
        var sessLr = vLr.session;
        var lockLrPut = LockService.getScriptLock();
        lockLrPut.waitLock(15000);
        try {
          var dbLr = getFullDatabase_();
          var exLr = dbLr.leave_requests.filter(function (r) { return r.id === body.id; })[0];
          if (!exLr) return makeResp_(404, { error: 'Pengajuan izin tidak ditemukan.' });
          var nowLrU = new Date().toISOString();
          var patchLr = {
            status_persetujuan: body.status,
            approved_by: sessLr.name || 'Wali Kelas',
            approved_at: nowLrU,
            rejection_reason: body.rejectionReason || '',
            updated_at: nowLrU,
            diubah_pada: nowLrU,
          };
          var updLr = updateRowPartial_(ssLr, {
            tabName: SHEET_TABS.IZIN_TIDAK_MASUK, id: body.id, newRowObj: patchLr,
            expectedUpdatedAt: body.expected_updated_at, forceOverwrite: Boolean(body.forceOverwrite),
            actorName: sessLr.name || 'Wali Kelas', reason: 'Status izin: ' + body.status,
          });
          if (updLr.conflict) return makeResp_(409, { error: 'Konflik persetujuan izin.', conflict: true, current: updLr.current });
          if (body.status === 'approved') {
            var stuLr = dbLr.students.filter(function (s) { return s.nis === exLr.student_id; })[0];
            if (stuLr) {
              notifyParent_({
                student: stuLr, triggerType: 'izin_sakit',
                status: 'Izin / Sakit Disetujui (' + exLr.type + ': ' + exLr.start_date + ' s/d ' + exLr.end_date + ')',
              });
            }
          }
          return makeResp_(200, { success: true, request: updLr.oldObj, serverTime: new Date().toISOString(), snapshot: buildDatabasePayload_() });
        } finally {
          lockLrPut.releaseLock();
        }
      }
    }

    // 15. /api/audit
    if (pathname === '/api/audit') {
      return makeResp_(200, { logs: getFullDatabase_().audit_logs });
    }

    // 16. /api/simulate
    if (pathname === '/api/simulate') {
      var lockSim = LockService.getScriptLock();
      lockSim.waitLock(15000);
      try {
        var ssSim = getSpreadsheet_();
        var dbSim = getFullDatabase_();
        var ts1 = dbSim.students[0];
        var tSess = dbSim.sessions[0];
        if (!ts1 || !tSess) return makeResp_(400, { error: 'Data siswa atau sesi masih kosong di Google Sheets.' });

        if (body.testType === 'duplicate_attendance') {
          var nowS = new Date();
          var dStr = toDateYmd_(nowS);
          var resSim = appendAttendanceBatch_(ssSim, [
            { id: 'att_sim_1_' + Date.now(), student_id: ts1.nis, session_id: tSess.id, date: dStr, timestamp: nowS.toISOString(), status: 'Hadir', late_minutes: 0, method: 'rfid', device_id: 'device_gate_1', version: 1, created_at: nowS.toISOString(), updated_at: nowS.toISOString() },
            { id: 'att_sim_2_' + Date.now(), student_id: ts1.nis, session_id: tSess.id, date: dStr, timestamp: nowS.toISOString(), status: 'Hadir', late_minutes: 0, method: 'barcode', device_id: 'device_gate_2', version: 1, created_at: nowS.toISOString(), updated_at: nowS.toISOString() },
          ], 'Simulasi');
          return makeResp_(200, {
            test: 'duplicate_attendance',
            saved: resSim.saved.length,
            rejectedDuplicates: resSim.rejectedDuplicates,
            conclusion: resSim.rejectedDuplicates.length > 0
              ? 'SUKSES: Hanya satu presensi yang diterima, duplikat hari yang sama berhasil ditolak.'
              : 'Simulasi selesai.',
          });
        }

        if (body.testType === 'out_of_class_quota_race') {
          var clsStus = dbSim.students.filter(function (s) { return s.class_id === ts1.class_id; });
          var st1 = clsStus[0];
          var st2 = clsStus[1] || dbSim.students[1] || st1;
          var o1 = startOutOfClass_(ssSim, {
            id: 'ooc_sim_1_' + Date.now(), student_id: st1.nis, class_id: st1.class_id, type: 'BAK',
            duration_minutes: 5, started_at: new Date().toISOString(), due_at: new Date(Date.now() + 300000).toISOString(),
            late_return_minutes: 0, status: 'active', idempotency_key: 'key_sim_1_' + Date.now(), version: 1
          }, 'Simulasi');
          var o2 = startOutOfClass_(ssSim, {
            id: 'ooc_sim_2_' + Date.now(), student_id: st2.nis, class_id: st2.class_id, type: 'BAB',
            duration_minutes: 10, started_at: new Date().toISOString(), due_at: new Date(Date.now() + 600000).toISOString(),
            late_return_minutes: 0, status: 'active', idempotency_key: 'key_sim_2_' + Date.now(), version: 1
          }, 'Simulasi');
          return makeResp_(200, {
            test: 'out_of_class_quota_race',
            req1: { success: o1.success, error: o1.error },
            req2: { success: o2.success, error: o2.error },
            conclusion: 'Pengujian kuota kelas langsung ke Google Sheets selesai dievaluasi.',
          });
        }

        return makeResp_(400, { error: 'Jenis pengujian tidak valid.' });
      } finally {
        lockSim.releaseLock();
      }
    }

    return makeResp_(404, { error: 'Endpoint ' + pathname + ' tidak ditemukan.' });
  } catch (err) {
    return makeResp_(500, { error: (err && err.message) ? err.message : String(err) });
  }
}
