/**
 * Excel export and import utilities powered by SheetJS (dynamically imported on demand)
 */

export async function exportToExcel(data: any[], fileName: string, sheetName = 'Data') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export async function exportSessionRecapToExcel(params: {
  fileName: string;
  targetDate: string;
  sessionSummaries: Array<{
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
  }>;
  classSessionSummaries: Array<{
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
  }>;
  detailRows?: Array<Record<string, any>>;
}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const summarySheetRows = params.sessionSummaries.map((row, idx) => ({
    No: idx + 1,
    Tanggal: params.targetDate,
    ID_Sesi: row.sessionId,
    Nama_Sesi: row.sessionName,
    Jam_Sesi: row.timeRange,
    Batas_Tepat_Waktu: row.onTimeLimit,
    Status_Sesi: row.statusLabel,
    Total_Siswa: row.totalStudents,
    Hadir: row.hadir,
    Terlambat: row.terlambat,
    Izin: row.izin,
    Sakit: row.sakit,
    Alpha: row.alpha,
    Belum_Presensi: row.belumPresensi,
    Total_Tercatat: row.totalRecorded,
    Persentase_Kehadiran: `${row.attendancePercent}%`,
  }));

  const classSheetRows = params.classSessionSummaries.map((cRow, idx) => ({
    No: idx + 1,
    Tanggal: params.targetDate,
    Nama_Sesi: cRow.sessionName,
    Kelas: cRow.className,
    Total_Siswa: cRow.totalStudents,
    Hadir: cRow.hadir,
    Terlambat: cRow.terlambat,
    Izin: cRow.izin,
    Sakit: cRow.sakit,
    Alpha: cRow.alpha,
    Belum_Presensi: cRow.belumPresensi,
    Total_Hadir: cRow.totalAttended,
    Persentase: `${cRow.attendancePercent}%`,
  }));

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summarySheetRows.length > 0 ? summarySheetRows : [{ Info: 'Belum ada data sesi' }]),
    'Ringkasan_Sesi'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(classSheetRows.length > 0 ? classSheetRows : [{ Info: 'Belum ada data kelas' }]),
    'Rekap_Per_Kelas_Sesi'
  );
  if (params.detailRows && params.detailRows.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(params.detailRows),
      'Detail_Presensi_Sesi'
    );
  }

  XLSX.writeFile(wb, `${params.fileName}.xlsx`);
}

export interface StudentImportRow {
  NIS: string;
  NISN?: string;
  Nama: string;
  Kelas: string;
  Jenis_Kelamin?: 'L' | 'P';
  UID_RFID?: string;
  Kode_Kartu?: string;
  Nama_Orang_Tua?: string;
  Email_Orang_Tua?: string;
  Status_Keaktifan?: string;
  isValid?: boolean;
  errors?: string[];
  sheetSource?: string;
}

function normalizeKey(str: string): string {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Clean & normalize Class/Rombel name
 * e.g. "X RPL 1" -> "10-RPL-1", "XI TKJ 2" -> "11-TKJ-2", "XII MM" -> "12-MM"
 */
function cleanClassName(raw: string): string {
  let val = String(raw || '').trim();
  if (!val) return '';

  // Convert roman numerals at start: X -> 10, XI -> 11, XII -> 12
  val = val.replace(/^XII\b/i, '12')
           .replace(/^XI\b/i, '11')
           .replace(/^X\b/i, '10');

  // Replace spaces with hyphens if not already separated
  if (val.includes(' ') && !val.includes('-')) {
    val = val.replace(/\s+/g, '-');
  }

  return val;
}

/**
 * Checks if a sheet name looks like an instructional or meta sheet rather than a class data sheet
 */
function isMetaSheetName(name: string): boolean {
  const norm = normalizeKey(name);
  const metaKeywords = ['petunjuk', 'panduan', 'instruksi', 'instructions', 'template', 'format', 'cover', 'readme', 'rekap'];
  return metaKeywords.some((k) => norm.includes(k));
}

export async function parseStudentExcel(file: File, fallbackClassId: string = '10-Umum'): Promise<StudentImportRow[]> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const allRows: StudentImportRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // Convert to 2D array to accurately detect header row
    const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rawData || rawData.length === 0) continue;

    // 1. Locate header row (search top 12 rows for key column terms)
    let headerRowIdx = -1;
    let colMap: Record<string, number> = {};

    for (let r = 0; r < Math.min(rawData.length, 12); r++) {
      const row = rawData[r];
      if (!Array.isArray(row)) continue;

      const tempMap: Record<string, number> = {};

      row.forEach((cell, colIdx) => {
        const text = normalizeKey(String(cell));
        if (!text) return;

        // 1. Email MUST be checked first (since Email Orang Tua has orangtua in it)
        if (['email', 'emailorangtua', 'emailwali', 'kontak'].some((k) => text === k || text.includes('email') || text.includes('mail'))) {
          if (tempMap['parent_email'] === undefined) tempMap['parent_email'] = colIdx;
        } else if (['namaorangtua', 'orangtua', 'namawali', 'wali', 'ayah', 'namaayah', 'ibu', 'namaibu', 'parent', 'parentname'].some((k) => text === k || text.includes('orangtua') || text.includes('wali') || text.includes('parent') || text.includes('ayah') || text.includes('ibu'))) {
          if (tempMap['parent_name'] === undefined) tempMap['parent_name'] = colIdx;
        } else if (['statuskeaktifan', 'statusaktif', 'keaktifan', 'statussiswa', 'status'].some((k) => text === k || text.includes('keaktifan'))) {
          if (tempMap['status_keaktifan'] === undefined) tempMap['status_keaktifan'] = colIdx;
        } else if (['jeniskelamin', 'jk', 'gender', 'sex', 'lp'].some((k) => text === k || text.includes('kelamin') || text === 'jk' || text === 'lp')) {
          if (tempMap['gender'] === undefined) tempMap['gender'] = colIdx;
        } else if (['nisn', 'nomornisn'].some((k) => text === k || text.includes('nisn'))) {
          if (tempMap['nisn'] === undefined) tempMap['nisn'] = colIdx;
        } else if (['kodekartu', 'kodekartunis', 'cardcode', 'kodebarcode', 'barcode'].some((k) => text === k || text.includes('kodekartu') || text.includes('cardcode'))) {
          // Check Kode Kartu/NIS BEFORE RFID UID so "Kode Kartu/NIS" never overwrites "RFID UID"
          if (tempMap['card_code'] === undefined) tempMap['card_code'] = colIdx;
        } else if (['rfid', 'uidrfid', 'rfiduid', 'uid', 'nomorkartu', 'kartu'].some((k) => text === k || text.includes('rfid') || text.includes('uid'))) {
          if (tempMap['rfid'] === undefined) tempMap['rfid'] = colIdx;
        } else if (
          text === 'nis' ||
          text === 'noinduk' ||
          text === 'nomorinduk' ||
          text === 'noinduksiswa' ||
          text === 'nik' ||
          text === 'nomor' ||
          (text.startsWith('nis') && !text.includes('kelamin') && !text.includes('nisn'))
        ) {
          if (tempMap['nis'] === undefined) tempMap['nis'] = colIdx;
        } else if (
          ['namasiswa', 'namapesertadidik', 'namalengkap', 'namamurid', 'namapeserta', 'studentname', 'fullname', 'pesertadidik', 'murid', 'nama', 'name'].some((k) => text === k || text.includes('siswa') || text.includes('pesertadidik') || text.includes('murid') || text.includes('student')) ||
          text === 'nama' ||
          text === 'name' ||
          (text.startsWith('nama') && !text.includes('tua') && !text.includes('wali') && !text.includes('ayah') && !text.includes('ibu') && !text.includes('kelas') && !text.includes('sekolah'))
        ) {
          if (tempMap['nama'] === undefined) tempMap['nama'] = colIdx;
        } else if (['kelas', 'rombel', 'rombonganbelajar', 'tingkat', 'tingkatkelas', 'kelasrombel', 'class', 'grade'].some((k) => text === k || text.includes('kelas') || text.includes('rombel') || text.includes('class'))) {
          if (tempMap['kelas'] === undefined) tempMap['kelas'] = colIdx;
        }
      });

      // Header row must have at least nama or nis
      if (tempMap['nama'] !== undefined || tempMap['nis'] !== undefined) {
        headerRowIdx = r;
        colMap = tempMap;
        break;
      }
    }

    // If no header found and sheet looks like meta/instructions, skip it
    if (headerRowIdx === -1) {
      if (isMetaSheetName(sheetName)) continue;
      // Fallback: use first row as header with standard key indexing
      headerRowIdx = 0;
    }

    // Fallback: If 'nama' column wasn't identified by header, detect column with textual names
    if (colMap['nama'] === undefined) {
      for (let c = 0; c < 15; c++) {
        let nameLikeCount = 0;
        for (let r = headerRowIdx + 1; r < Math.min(rawData.length, headerRowIdx + 6); r++) {
          const val = String(rawData[r]?.[c] ?? '').trim();
          if (val && val.length > 2 && /^[a-zA-Z\s.,'-]+$/.test(val) && !val.match(/^(L|P|X|XI|XII|10|11|12|Aktif|Nonaktif)$/i)) {
            nameLikeCount++;
          }
        }
        if (nameLikeCount >= 2 && c !== colMap['nis'] && c !== colMap['gender'] && c !== colMap['kelas']) {
          colMap['nama'] = c;
          break;
        }
      }
    }

    // Infer default class from sheet name if sheet name looks like a class (e.g. "10-RPL-1", "X RPL 1", "XI-TKJ")
    let sheetInferredClass = '';
    if (!isMetaSheetName(sheetName)) {
      const cleanSheet = cleanClassName(sheetName);
      if (cleanSheet.match(/^(10|11|12|[0-9]+|[a-z]+)/i)) {
        sheetInferredClass = cleanSheet;
      }
    }

    let lastKnownClass = sheetInferredClass || fallbackClassId;

    // Process rows under header
    for (let r = headerRowIdx + 1; r < rawData.length; r++) {
      const row = rawData[r];
      if (!Array.isArray(row) || row.length === 0) continue;

      const getColVal = (key: string): string => {
        if (colMap[key] !== undefined) {
          return String(row[colMap[key]] ?? '').trim();
        }
        return '';
      };

      let nama = getColVal('nama');
      let nis = getColVal('nis');
      const nisn = getColVal('nisn');
      let rawKelas = getColVal('kelas');
      const rawGender = getColVal('gender');
      const rawRfid = getColVal('rfid');
      const rawCardCode = getColVal('card_code');
      const parentName = getColVal('parent_name');
      const parentEmail = getColVal('parent_email');
      const statusKeaktifan = getColVal('status_keaktifan');

      // Fallback: if nama is still empty, scan row cells for a cell that looks like a name
      if (!nama) {
        for (let ci = 0; ci < row.length; ci++) {
          if (
            ci === colMap['nis'] ||
            ci === colMap['kelas'] ||
            ci === colMap['gender'] ||
            ci === colMap['parent_name'] ||
            ci === colMap['status_keaktifan']
          ) continue;
          const cellVal = String(row[ci] ?? '').trim();
          if (cellVal && cellVal.length > 2 && /^[a-zA-Z\s.,'-]+$/.test(cellVal) && !cellVal.match(/^(L|P|Laki-laki|Perempuan|X|XI|XII|Aktif|Nonaktif)$/i)) {
            nama = cellVal;
            break;
          }
        }
      }

      // Skip completely empty lines
      if (!nama && !nis) continue;

      // Auto-generate NIS if missing but name is present
      if (!nis && nama) {
        nis = `SISWA-${allRows.length + 1}`;
      }

      // Auto-fill Kelas: from row -> or from sheet name -> or from previous row -> or fallback
      let kelas = cleanClassName(rawKelas);
      if (!kelas) {
        kelas = sheetInferredClass || lastKnownClass || fallbackClassId;
      } else {
        lastKnownClass = kelas;
      }

      const gender = (rawGender.toUpperCase().startsWith('P') ? 'P' : 'L') as 'L' | 'P';
      const rfid = rawRfid || `RFID-${nis}`;
      const cardCode = rawCardCode || nis;

      allRows.push({
        NIS: nis,
        NISN: nisn,
        Nama: nama || `Siswa ${nis}`,
        Kelas: kelas,
        Jenis_Kelamin: gender,
        UID_RFID: rfid,
        Kode_Kartu: cardCode,
        Nama_Orang_Tua: parentName,
        Email_Orang_Tua: parentEmail,
        Status_Keaktifan: statusKeaktifan || 'Aktif',
        sheetSource: sheetName,
      });
    }
  }

  return allRows;
}

export async function downloadStudentTemplate(classList: { id: string }[] = []) {
  const XLSX = await import('xlsx');
  const firstClass = classList[0]?.id || '10-RPL-1';
  const classNames = classList.length > 0 ? classList.map((c) => c.id).join(', ') : '10-RPL-1, 11-RPL-1';
  const wb = XLSX.utils.book_new();
  const sampleData = [
    {
      NIS: '20261011',
      'Nama Siswa': 'Muhammad Faiz',
      Kelas: firstClass,
      'Jenis Kelamin': 'L',
      'RFID UID': 'RFID-8821911',
      'Kode Kartu/NIS': '20261011',
      'Nama Orang Tua': 'Bambang Faiz',
      'Email Orang Tua': 'faiz.parent@example.com',
      'Status Keaktifan': 'Aktif',
    },
    {
      NIS: '20261012',
      'Nama Siswa': 'Nadia Putri',
      Kelas: firstClass,
      'Jenis Kelamin': 'P',
      'RFID UID': 'RFID-8821912',
      'Kode Kartu/NIS': '20261012',
      'Nama Orang Tua': 'Rudi Hermanto',
      'Email Orang Tua': 'nadia.parent@example.com',
      'Status Keaktifan': 'Aktif',
    },
  ];

  const wsData = XLSX.utils.json_to_sheet(sampleData);
  XLSX.utils.book_append_sheet(wb, wsData, 'Data Siswa');

  const instructions = [
    { Kolom: 'NIS', Keterangan: 'Nomor Induk Siswa (Wajib, Unik, angka/teks)', Contoh: '20261011' },
    { Kolom: 'Nama Siswa', Keterangan: 'Nama Lengkap Siswa (Wajib)', Contoh: 'Muhammad Faiz' },
    { Kolom: 'Kelas', Keterangan: `ID Kelas terdaftar (${classNames}) — kelas baru akan otomatis dibuat jika belum ada`, Contoh: firstClass },
    { Kolom: 'Jenis Kelamin', Keterangan: 'L (Laki-laki) atau P (Perempuan)', Contoh: 'L' },
    { Kolom: 'RFID UID', Keterangan: 'Kode UID kartu RFID (opsional, otomatis RFID-<NIS> jika kosong)', Contoh: 'RFID-8821911' },
    { Kolom: 'Kode Kartu/NIS', Keterangan: 'Kode alternatif barcode/kartu (opsional, default NIS)', Contoh: '20261011' },
    { Kolom: 'Nama Orang Tua', Keterangan: 'Nama Orang Tua / Wali', Contoh: 'Bambang Faiz' },
    { Kolom: 'Email Orang Tua', Keterangan: 'Alamat email aktif untuk notifikasi presensi & kedisiplinan', Contoh: 'faiz.parent@example.com' },
    { Kolom: 'Status Keaktifan', Keterangan: 'Aktif / Nonaktif (hanya baris aktif yang akan diimpor)', Contoh: 'Aktif' },
  ];
  const wsInstructions = XLSX.utils.json_to_sheet(instructions);
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Petunjuk Format');

  XLSX.writeFile(wb, 'template_siswa_disiplin_kita_bisa.xlsx');
}
