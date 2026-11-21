/**
 * Client-side PDF export utilities powered by jsPDF & jspdf-autotable (dynamically imported on demand)
 * Works reliably on Desktop, Android, iOS Safari/Chrome, and Vercel without print-dialog blockers.
 */

function sanitizePdfFileName(fileName: string): string {
  const cleaned = String(fileName || 'laporan')
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '_');
  return `${cleaned || 'laporan'}.pdf`;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '-';
    }
  }
  const str = String(value).trim();
  return str || '-';
}

function formatHeaderLabel(key: string): string {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyPageFooters(doc: any, generatedLabel: string) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(12, pageHeight - 11, pageWidth - 12, pageHeight - 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(generatedLabel, 12, pageHeight - 6.5);
    doc.text(`Halaman ${i} dari ${totalPages}`, pageWidth - 12, pageHeight - 6.5, { align: 'right' });
  }
}

function drawDocumentHeader(
  doc: any,
  opts: {
    schoolName?: string;
    title: string;
    subtitle?: string;
  }
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const schoolTitle = (opts.schoolName || 'DISIPLIN KITA BISA').toUpperCase();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(schoolTitle, 12, 13);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(30, 41, 59);
  doc.text(opts.title, 12, 19);

  let nextY = 23;
  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const wrapped = doc.splitTextToSize(opts.subtitle, pageWidth - 24);
    doc.text(wrapped, 12, 24);
    nextY = 24 + wrapped.length * 4;
  }

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.line(12, nextY + 1, pageWidth - 12, nextY + 1);

  return nextY + 5;
}

export async function exportToPdf(params: {
  data: Array<Record<string, any>>;
  fileName: string;
  title: string;
  subtitle?: string;
  schoolName?: string;
  orientation?: 'portrait' | 'landscape' | 'auto';
}): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const firstRow = params.data[0];
  const keys = firstRow ? Object.keys(firstRow) : ['Informasi'];
  const orientation =
    params.orientation === 'portrait' || params.orientation === 'landscape'
      ? params.orientation
      : keys.length >= 6
        ? 'landscape'
        : 'portrait';

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
  });

  const nowStr = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const startY = drawDocumentHeader(doc, {
    schoolName: params.schoolName,
    title: params.title,
    subtitle: params.subtitle
      ? `${params.subtitle} • Total Data: ${params.data.length}`
      : `Tanggal Ekspor: ${nowStr} • Total Data: ${params.data.length}`,
  });

  const headers = firstRow ? keys.map(formatHeaderLabel) : ['Informasi'];
  const body =
    params.data.length > 0
      ? params.data.map((row) => keys.map((k) => formatCellValue(row[k])))
      : [['Belum ada data yang dapat ditampilkan pada laporan ini.']];

  autoTable(doc, {
    startY,
    head: [headers],
    body,
    theme: 'grid',
    margin: { top: 14, right: 12, bottom: 16, left: 12 },
    styles: {
      font: 'helvetica',
      fontSize: keys.length > 9 ? 7 : 8,
      cellPadding: 2.2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: keys.length > 9 ? 7 : 8,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  applyPageFooters(doc, `Disiplin Kita Bisa • Diunduh ${nowStr}`);
  doc.save(sanitizePdfFileName(params.fileName));
}

export async function exportSessionRecapToPdf(params: {
  fileName: string;
  targetDate: string;
  schoolName?: string;
  title?: string;
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
}): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const nowStr = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  let currentY = drawDocumentHeader(doc, {
    schoolName: params.schoolName,
    title: params.title || 'Rekapitulasi Kehadiran Siswa Per Sesi',
    subtitle: `Tanggal Rekap: ${params.targetDate} • Waktu Unduh: ${nowStr}`,
  });

  // Section 1: Ringkasan Sesi
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Ringkasan Seluruh Sesi', 12, currentY);

  autoTable(doc, {
    startY: currentY + 2,
    head: [[
      'No',
      'Nama Sesi',
      'Jam Sesi',
      'Batas Tepat',
      'Status Sesi',
      'Total',
      'Hadir',
      'Terlambat',
      'Izin',
      'Sakit',
      'Alpha',
      'Belum Scan',
      '% Hadir',
    ]],
    body:
      params.sessionSummaries.length > 0
        ? params.sessionSummaries.map((row, idx) => [
            String(idx + 1),
            row.sessionName,
            row.timeRange,
            row.onTimeLimit,
            row.statusLabel,
            String(row.totalStudents),
            String(row.hadir),
            String(row.terlambat),
            String(row.izin),
            String(row.sakit),
            String(row.alpha),
            String(row.belumPresensi),
            `${row.attendancePercent}%`,
          ])
        : [['-', 'Belum ada data sesi pada tanggal ini', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    margin: { top: 14, right: 12, bottom: 16, left: 12 },
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  currentY = ((doc as any).lastAutoTable?.finalY ?? currentY + 25) + 8;
  if (currentY > doc.internal.pageSize.getHeight() - 35) {
    doc.addPage();
    currentY = 16;
  }

  // Section 2: Rekap Per Kelas & Sesi
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Rekapitulasi Per Kelas & Sesi', 12, currentY);

  autoTable(doc, {
    startY: currentY + 2,
    head: [[
      'No',
      'Nama Sesi',
      'Kelas',
      'Total Siswa',
      'Hadir',
      'Terlambat',
      'Izin',
      'Sakit',
      'Alpha',
      'Belum Scan',
      'Total Hadir',
      '% Hadir',
    ]],
    body:
      params.classSessionSummaries.length > 0
        ? params.classSessionSummaries.map((cRow, idx) => [
            String(idx + 1),
            cRow.sessionName,
            cRow.className,
            String(cRow.totalStudents),
            String(cRow.hadir),
            String(cRow.terlambat),
            String(cRow.izin),
            String(cRow.sakit),
            String(cRow.alpha),
            String(cRow.belumPresensi),
            String(cRow.totalAttended),
            `${cRow.attendancePercent}%`,
          ])
        : [['-', 'Belum ada data rekap kelas per sesi', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    margin: { top: 14, right: 12, bottom: 16, left: 12 },
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  // Section 3: Detail Presensi Sesi (jika tersedia)
  if (params.detailRows && params.detailRows.length > 0) {
    currentY = ((doc as any).lastAutoTable?.finalY ?? currentY + 25) + 8;
    if (currentY > doc.internal.pageSize.getHeight() - 35) {
      doc.addPage();
      currentY = 16;
    }

    const detailKeys = Object.keys(params.detailRows[0]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`3. Detail Presensi Siswa (${params.detailRows.length} Baris)`, 12, currentY);

    autoTable(doc, {
      startY: currentY + 2,
      head: [detailKeys.map(formatHeaderLabel)],
      body: params.detailRows.map((row) => detailKeys.map((k) => formatCellValue(row[k]))),
      theme: 'grid',
      margin: { top: 14, right: 12, bottom: 16, left: 12 },
      styles: {
        font: 'helvetica',
        fontSize: detailKeys.length > 9 ? 7 : 7.5,
        cellPadding: 2,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
    });
  }

  applyPageFooters(doc, `Disiplin Kita Bisa • Rekap Sesi ${params.targetDate}`);
  doc.save(sanitizePdfFileName(params.fileName));
}

export async function exportOfficialSchoolReportPdf(params: {
  schoolName?: string;
  recapDate: string;
  classRows: Array<{
    no: number;
    className: string;
    totalStudents: number;
    hadir: number;
    terlambat: number;
    alpha: number;
    violationPoints: number;
  }>;
  sessionRows: Array<{
    sessionName: string;
    timeRange: string;
    hadir: number;
    terlambat: number;
    izin: number;
    sakit: number;
    alpha: number;
    attendancePercent: number;
  }>;
}): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const printDateStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Kop Resmi
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text((params.schoolName || 'SEKOLAH INDONESIA').toUpperCase(), pageWidth / 2, 16, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  doc.text('DIVISI KESISWAAN, KEDISIPLINAN & TATA TERTIB SISWA', pageWidth / 2, 21.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Laporan Resmi Rekapitulasi Presensi & Catatan Pelanggaran Siswa', pageWidth / 2, 26, { align: 'center' });

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.7);
  doc.line(14, 29, pageWidth - 14, 29);

  // Meta Info
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text(`Nomor Dokumen: DKB/KES/${new Date().getFullYear()}/04`, 14, 36);
  doc.text('Perihal: Laporan Kedisiplinan & Presensi Berkala', 14, 41);
  doc.text(`Tanggal Cetak: ${printDateStr}`, pageWidth - 14, 36, { align: 'right' });
  doc.text('Petugas Kesiswaan: Tim Kesiswaan', pageWidth - 14, 41, { align: 'right' });

  // Tabel 1: Kelas
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('A. Rekapitulasi Kedisiplinan Per Kelas', 14, 49);

  autoTable(doc, {
    startY: 51.5,
    head: [['No', 'Kelas', 'Jumlah Siswa', 'Total Hadir', 'Terlambat', 'Alpha', 'Akumulasi Poin']],
    body:
      params.classRows.length > 0
        ? params.classRows.map((r) => [
            String(r.no),
            r.className,
            String(r.totalStudents),
            String(r.hadir),
            String(r.terlambat),
            String(r.alpha),
            `${r.violationPoints} Poin`,
          ])
        : [['-', 'Belum ada data kelas', '-', '-', '-', '-', '-']],
    theme: 'grid',
    margin: { top: 14, right: 14, bottom: 18, left: 14 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
  });

  let nextY = ((doc as any).lastAutoTable?.finalY ?? 85) + 8;
  if (nextY > doc.internal.pageSize.getHeight() - 55) {
    doc.addPage();
    nextY = 18;
  }

  // Tabel 2: Rekap Sesi
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`B. Rekapitulasi Kehadiran Per Sesi (${params.recapDate})`, 14, nextY);

  autoTable(doc, {
    startY: nextY + 2.5,
    head: [['Nama Sesi', 'Jam Sesi', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha', 'Kehadiran (%)']],
    body:
      params.sessionRows.length > 0
        ? params.sessionRows.map((r) => [
            r.sessionName,
            r.timeRange,
            String(r.hadir),
            String(r.terlambat),
            String(r.izin),
            String(r.sakit),
            String(r.alpha),
            `${r.attendancePercent}%`,
          ])
        : [['Belum ada data sesi', '-', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    margin: { top: 14, right: 14, bottom: 18, left: 14 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
  });

  let signY = ((doc as any).lastAutoTable?.finalY ?? 150) + 14;
  if (signY > doc.internal.pageSize.getHeight() - 42) {
    doc.addPage();
    signY = 24;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Mengetahui,', 42, signY, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('Kepala Sekolah', 42, signY + 4.5, { align: 'center' });
  doc.text('(.......................................)', 42, signY + 23, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.text(`Tanggal, ${printDateStr}`, pageWidth - 45, signY, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('Koordinator Kesiswaan & Tatib', pageWidth - 45, signY + 4.5, { align: 'center' });
  doc.text('(.......................................)', pageWidth - 45, signY + 23, { align: 'center' });

  applyPageFooters(doc, `${params.schoolName || 'Disiplin Kita Bisa'} • Laporan Resmi Kesiswaan`);
  doc.save(sanitizePdfFileName(`Laporan_Resmi_Kesiswaan_${params.recapDate}`));
}

export async function exportWarningLetterPdf(params: {
  schoolName?: string;
  spLevel: 'SP1' | 'SP2' | 'SP3';
  studentName: string;
  nis: string;
  classId: string;
  parentName?: string;
}): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const printDateStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text((params.schoolName || 'SEKOLAH INDONESIA').toUpperCase(), pageWidth / 2, 18, { align: 'center' });

  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text('SURAT PERINGATAN KEDISIPLINAN SISWA', pageWidth / 2, 24, { align: 'center' });

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.7);
  doc.line(18, 28, pageWidth - 18, 28);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`SURAT PERINGATAN ${params.spLevel}`, pageWidth / 2, 38, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Nomor: SP/${params.spLevel}/${new Date().getFullYear()}/012`, 18, 48);
  doc.text(`Tanggal: ${printDateStr}`, pageWidth - 18, 48, { align: 'right' });

  const intro = doc.splitTextToSize(
    'Berdasarkan data catatan kedisiplinan dan tata tertib sekolah, dengan ini diterbitkan Surat Peringatan kepada siswa berikut:',
    pageWidth - 36
  );
  doc.text(intro, 18, 58);

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(18, 70, pageWidth - 36, 26, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.text(`Nama Lengkap         : ${params.studentName}`, 23, 78);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIS / Kelas          : ${params.nis} / ${params.classId}`, 23, 84.5);
  doc.text(`Nama Orang Tua/Wali  : ${params.parentName || '-'}`, 23, 91);

  const closing = doc.splitTextToSize(
    'Surat peringatan ini diterbitkan sehubungan dengan akumulasi catatan pelanggaran yang telah mencapai batas ketentuan sekolah. Diharapkan orang tua/wali siswa dapat mendampingi serta memberikan pembinaan lebih lanjut agar kedisiplinan siswa dapat meningkat.',
    pageWidth - 36
  );
  doc.text(closing, 18, 106);

  doc.text('Orang Tua / Wali Siswa,', 45, 134, { align: 'center' });
  doc.text('(..................................)', 45, 158, { align: 'center' });

  doc.text('Koordinator Kesiswaan,', pageWidth - 45, 134, { align: 'center' });
  doc.text('(..................................)', pageWidth - 45, 158, { align: 'center' });

  doc.save(sanitizePdfFileName(`Surat_${params.spLevel}_${params.nis}_${params.studentName}`));
}
