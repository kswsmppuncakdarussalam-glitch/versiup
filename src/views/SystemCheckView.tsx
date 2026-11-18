import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileSpreadsheet,
  FolderLock,
  KeyRound,
  Mail,
  Activity,
  Loader2,
  Send,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import type { SystemCheckResult } from '../utils/apiClient.js';
import { AppsScriptPanel } from '../components/auth/AppsScriptPanel.js';

interface SystemCheckViewProps {
  embedded?: boolean;
}

const CONFIG_KEY_LABELS: Record<string, string> = {
  APPS_SCRIPT_URL: 'URL Web App Google Apps Script (Sisi Aplikasi / Frontend)',
  SECRET_TOKEN: 'Token Rahasia (SECRET_TOKEN)',
  SPREADSHEET_ID: 'ID Google Spreadsheet (Properti Skrip: SPREADSHEET_ID)',
  DRIVE_FOLDER_ID: 'ID Folder Google Drive Foto (Properti Skrip: DRIVE_FOLDER_ID)',
};

export const SystemCheckView: React.FC<SystemCheckViewProps> = ({ embedded = false }) => {
  const { runSystemCheck, appsScriptUrl, appsScriptSecretConfigured } = useApp();
  const [result, setResult] = useState<SystemCheckResult | null>(null);
  const [checking, setChecking] = useState<boolean>(true);

  const executeCheck = useCallback(async () => {
    setChecking(true);
    try {
      const res = await runSystemCheck();
      setResult(res);
    } finally {
      setChecking(false);
    }
  }, [runSystemCheck]);

  useEffect(() => {
    void executeCheck();
  }, [executeCheck, appsScriptUrl, appsScriptSecretConfigured]);

  const allConfigItems = [
    {
      id: 'client_url',
      name: CONFIG_KEY_LABELS.APPS_SCRIPT_URL,
      scope: 'Frontend',
      isFilled: Boolean(appsScriptUrl) && !(result?.emptyClientKeys || []).includes('APPS_SCRIPT_URL'),
    },
    {
      id: 'client_secret',
      name: 'Token Rahasia pada Aplikasi Frontend (SECRET_TOKEN)',
      scope: 'Frontend',
      isFilled: appsScriptSecretConfigured && !(result?.emptyClientKeys || []).includes('SECRET_TOKEN'),
    },
    {
      id: 'script_spreadsheet',
      name: CONFIG_KEY_LABELS.SPREADSHEET_ID,
      scope: 'Script Properties',
      isFilled:
        Boolean(result?.tokenAuthorized) &&
        !(result?.emptyBackendKeys || []).includes('SPREADSHEET_ID') &&
        Boolean(result?.sheets.configured),
      unknownUntilAuthorized: !result?.tokenAuthorized,
    },
    {
      id: 'script_drive',
      name: CONFIG_KEY_LABELS.DRIVE_FOLDER_ID,
      scope: 'Script Properties',
      isFilled:
        Boolean(result?.tokenAuthorized) &&
        !(result?.emptyBackendKeys || []).includes('DRIVE_FOLDER_ID') &&
        Boolean(result?.drive.configured),
      unknownUntilAuthorized: !result?.tokenAuthorized,
    },
    {
      id: 'script_secret',
      name: 'Token Rahasia di Google Apps Script (Properti Skrip: SECRET_TOKEN)',
      scope: 'Script Properties',
      isFilled: Boolean(result?.tokenAuthorized) && !(result?.emptyBackendKeys || []).includes('SECRET_TOKEN'),
      unknownUntilAuthorized: !result?.tokenAuthorized && !(result?.emptyBackendKeys || []).includes('SECRET_TOKEN'),
    },
  ];

  const emptyItems = allConfigItems.filter((item) => !item.isFilled && !item.unknownUntilAuthorized);

  return (
    <div className={embedded ? 'space-y-5 text-xs' : 'p-4 sm:p-6 max-w-5xl mx-auto space-y-5 text-xs'}>
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`p-2.5 rounded-xl shrink-0 ${
              checking
                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                : result?.ok
                ? 'bg-emerald-600 text-white'
                : 'bg-amber-600 text-white'
            }`}
          >
            {checking ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                Cek Sistem &amp; Koneksi Google Apps Script
              </h1>
              {!checking && result && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    result.ok
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                  }`}
                >
                  {result.ok ? 'SEMUA KOMPONEN SIAP' : 'PERLU PERBAIKAN KONFIGURASI'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Menguji koneksi langsung ke Google Sheets &amp; Google Drive melalui endpoint{' '}
              <code className="font-mono">doPost</code> dan <code className="font-mono">doGet</code> Apps Script,
              serta menampilkan bagian konfigurasi yang masih kosong <strong>tanpa menampilkan nilainya</strong>.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void executeCheck()}
          disabled={checking}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 font-semibold text-xs disabled:opacity-50 shrink-0"
        >
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
          <span>{checking ? 'Menguji Koneksi...' : 'Jalankan Uji Koneksi'}</span>
        </button>
      </div>

      {/* Ringkasan Bagian Konfigurasi yang Masih Kosong (Hanya Nama Bagian, TANPA Nilai) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-slate-700 dark:text-slate-300" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Status Kelengkapan Konfigurasi (Nilai Disembunyikan)
            </h2>
          </div>
          {result?.checkedAt && (
            <span className="text-[11px] text-slate-400">
              Terakhir diuji: {new Date(result.checkedAt).toLocaleTimeString('id-ID')}
            </span>
          )}
        </div>

        {emptyItems.length > 0 && (
          <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Bagian Konfigurasi yang Masih Kosong:</span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[11px] text-amber-800 dark:text-amber-300">
              {emptyItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong> ({item.scope})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          {allConfigItems.map((item) => (
            <div
              key={item.id}
              className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-white dark:bg-slate-900"
            >
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">{item.name}</p>
                <span className="text-[10px] text-slate-400">Lokasi: {item.scope} • Nilai tidak ditampilkan demi keamanan</span>
              </div>
              {item.unknownUntilAuthorized ? (
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold shrink-0">
                  Menunggu Otorisasi Token
                </span>
              ) : item.isFilled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold shrink-0">
                  <CheckCircle2 className="w-3 h-3" />
                  Terisi
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 text-[10px] font-bold shrink-0">
                  <AlertCircle className="w-3 h-3" />
                  Kosong
                </span>
              )}
            </div>
          ))}
        </div>

        {result && !result.tokenAuthorized && result.tokenError && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-start gap-2 text-[11px]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{result.tokenError}</span>
          </div>
        )}
      </div>

      {/* Hasil Uji Koneksi Google Sheets & Google Drive & Endpoint */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Google Sheets Check */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div
                className={`p-2 rounded-lg ${
                  result?.sheets.ok
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">Koneksi Google Sheets</h3>
                <p className="text-[11px] text-slate-500">Satu-satunya database aplikasi (13 tab)</p>
              </div>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                checking
                  ? 'bg-slate-100 text-slate-600'
                  : result?.sheets.ok
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
              }`}
            >
              {checking ? 'Menguji...' : result?.sheets.ok ? 'Terhubung' : 'Gagal / Kosong'}
            </span>
          </div>

          {result?.sheets.ok ? (
            <div className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">Nama Spreadsheet:</span>
                <span className="font-bold text-slate-900 dark:text-white">{result.sheets.spreadsheetName || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">Tab Lembar Kerja Terdeteksi:</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-300">
                  {result.sheets.tabsCount} / {result.sheets.expectedTabs} Tab
                </span>
              </div>
              {result.sheets.missingTabs.length > 0 && (
                <div className="pt-1 text-amber-700 dark:text-amber-300">
                  Tab belum dibuat ({result.sheets.missingTabs.join(', ')}). Jalankan <code className="font-mono">setupAppsScript</code> di Apps Script atau simpan ulang koneksi.
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
              {result?.sheets.error || 'Belum dapat menguji koneksi ke Google Sheets.'}
            </div>
          )}
        </div>

        {/* Google Drive Check */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div
                className={`p-2 rounded-lg ${
                  result?.drive.ok
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                }`}
              >
                <FolderLock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">Koneksi Google Drive (Privat)</h3>
                <p className="text-[11px] text-slate-500">Penyimpanan foto siswa, presensi &amp; bukti</p>
              </div>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                checking
                  ? 'bg-slate-100 text-slate-600'
                  : result?.drive.ok
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
              }`}
            >
              {checking ? 'Menguji...' : result?.drive.ok ? 'Siap & Privat' : 'Gagal / Kosong'}
            </span>
          </div>

          {result?.drive.ok ? (
            <div className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">Nama Folder Drive:</span>
                <span className="font-bold text-slate-900 dark:text-white">{result.drive.folderName || '-'}</span>
              </div>
              <p className="text-emerald-700 dark:text-emerald-300">
                Folder diakses privat melalui <code className="font-mono">DriveApp</code> di Apps Script tanpa perlu dijadikan publik.
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
              {result?.drive.error || 'Belum dapat mengakses folder Google Drive.'}
            </div>
          )}
        </div>
      </div>

      {/* Status Endpoint doPost, doGet, & GmailApp */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-semibold text-slate-700 dark:text-slate-200">Endpoint doPost (text/plain)</span>
          </div>
          <span className={`font-bold ${result?.doPostOk ? 'text-emerald-600' : 'text-rose-600'}`}>
            {checking ? '...' : result?.doPostOk ? 'Aktif' : 'Gagal'}
          </span>
        </div>

        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-semibold text-slate-700 dark:text-slate-200">Endpoint doGet (JSON)</span>
          </div>
          <span className={`font-bold ${result?.doGetOk ? 'text-emerald-600' : 'text-rose-600'}`}>
            {checking ? '...' : result?.doGetOk ? 'Aktif' : 'Gagal'}
          </span>
        </div>

        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-semibold text-slate-700 dark:text-slate-200">Pengirim Email (GmailApp)</span>
          </div>
          <span className={`font-bold ${result?.gmail.ok ? 'text-emerald-600' : 'text-slate-500'}`}>
            {checking ? '...' : result?.gmail.ok ? 'Siap' : 'Belum Aktif'}
          </span>
        </div>
      </div>

      {/* Form Konfigurasi Web App & Token Rahasia (tidak menampilkan nilai tersimpan) */}
      {!embedded && <AppsScriptPanel />}
    </div>
  );
};
