import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Terminal,
  Unplug,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Edit3,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import appsScriptSource from '../../../apps-script/Code.gs?raw';

interface AppsScriptPanelProps {
  compact?: boolean;
}

const DEFAULT_SPREADSHEET_URL =
  'https://docs.google.com/spreadsheets/d/14MkgrDI6iFV4J8b5rS_LkUZrHtYX_zzuGJUihjKdxU4/edit';

export const AppsScriptPanel: React.FC<AppsScriptPanelProps> = ({ compact = false }) => {
  const {
    appsScriptUrl,
    appsScriptSecretConfigured,
    isConnectingAppsScript,
    connectAppsScript,
    disconnectAppsScript,
    envStatus,
    requestConfirm,
    showToast,
  } = useApp();

  const isConnected = Boolean(appsScriptUrl) && appsScriptSecretConfigured;
  const [urlInput, setUrlInput] = useState('');
  const [secretInput, setSecretInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showGuide, setShowGuide] = useState(!compact && !isConnected);
  const [showUrlEditor, setShowUrlEditor] = useState(!isConnected);
  const [inlineError, setInlineError] = useState('');

  useEffect(() => {
    if (isConnected) {
      setShowUrlEditor(false);
      setShowGuide(false);
      setUrlInput('');
      setSecretInput('');
    } else {
      setShowUrlEditor(true);
    }
  }, [isConnected]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(appsScriptSource);
      setCopied(true);
      showToast('Kode Google Apps Script (Code.gs) berhasil disalin ke clipboard.', 'success');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      showToast('Gagal menyalin otomatis. Gunakan tombol Unduh Code.gs.', 'error');
    }
  };

  const handleDownloadCode = () => {
    try {
      const blob = new Blob([appsScriptSource], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Code.gs';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('File Code.gs berhasil diunduh.', 'success');
    } catch {
      showToast('Gagal mengunduh file Code.gs.', 'error');
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError('');
    const targetUrl = urlInput.trim() || appsScriptUrl;
    const res = await connectAppsScript(targetUrl, secretInput.trim() || undefined);
    if (!res.ok) {
      setInlineError(res.message);
    } else {
      setShowUrlEditor(false);
      setUrlInput('');
      setSecretInput('');
    }
  };

  const handleDisconnect = async () => {
    const confirmed = await requestConfirm({
      title: 'Putuskan Koneksi Apps Script?',
      message:
        'URL Web App dan Token Rahasia akan dihapus dari browser ini. Data di Google Sheets tetap aman.',
      confirmLabel: 'Ya, Putuskan',
      variant: 'warning',
    });
    if (!confirmed) return;
    await disconnectAppsScript();
    setUrlInput('');
    setSecretInput('');
    setInlineError('');
    setShowUrlEditor(true);
  };

  return (
    <div
      className={`rounded-xl border text-xs ${
        isConnected
          ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
      } ${compact ? 'p-3.5 space-y-3' : 'p-5 shadow-sm space-y-4'}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <div
            className={`p-2 rounded-lg shrink-0 ${
              isConnected
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`font-bold text-slate-900 dark:text-white ${compact ? 'text-xs' : 'text-sm'}`}>
                Backend Google Apps Script (.gs)
              </h3>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                  isConnected
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                }`}
              >
                {isConnected ? 'Tersimpan & Terverifikasi' : 'Belum Lengkap'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {isConnected
                ? `URL Web App & Token Rahasia tersimpan aman. Setiap perubahan langsung tersinkron ke Google Sheets, Drive privat, & GmailApp (${envStatus.senderEmail || 'Aktif'}).`
                : 'Tempel URL Web App (/exec) dan Token Rahasia (SECRET_TOKEN) satu kali saja.'}
            </p>
          </div>
        </div>

        {isConnected && (
          <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-start sm:self-center">
            <button
              type="button"
              onClick={() => setShowUrlEditor((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 font-semibold text-[11px]"
            >
              <Edit3 className="w-3 h-3" />
              <span>{showUrlEditor ? 'Tutup' : 'Ubah Koneksi'}</span>
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold text-[11px]"
            >
              <Unplug className="w-3 h-3" />
              <span>Putuskan</span>
            </button>
          </div>
        )}
      </div>

      {/* Ringkasan status tersimpan (TANPA menampilkan nilai URL atau token) */}
      {isConnected && !showUrlEditor && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-emerald-200 dark:border-emerald-800/80 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              URL Web App &amp; SECRET_TOKEN Tersimpan Aman
            </span>
          </div>
          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
            Auto-Reload 15d
          </span>
        </div>
      )}

      {/* Action buttons for Code.gs & Guide toggle */}
      {(!isConnected || !compact || showUrlEditor) && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-[11px]"
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Code.gs Disalin' : 'Salin Code.gs'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadCode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-[11px]"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span>Unduh Code.gs</span>
          </button>

          <a
            href={DEFAULT_SPREADSHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-[11px]"
          >
            <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
            <span>Buka Spreadsheet</span>
          </a>

          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 ml-auto"
          >
            <span>{showGuide ? 'Tutup Panduan' : 'Panduan Deploy (.gs)'}</span>
            {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* Step-by-step Deployment Guide */}
      {showGuide && (
        <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-2 text-[11px] text-slate-700 dark:text-slate-300">
          <p className="font-bold text-slate-900 dark:text-white">
            Panduan Deploy Google Apps Script (Tanpa Service Account &amp; Tanpa Google Cloud):
          </p>
          <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
            <li>
              Buka <strong>https://script.google.com</strong> → Proyek Baru (atau lewat <strong>Ekstensi → Apps Script</strong> di Spreadsheet), hapus kode bawaan, tempel seluruh isi <strong>Code.gs</strong> lalu Simpan.
            </li>
            <li>
              Buka <strong>Setelan Proyek (Roda Gigi) → Properti Skrip (Script Properties)</strong> lalu tambahkan 3 properti wajib:
              <code className="mx-1 px-1 rounded bg-white dark:bg-slate-900 font-mono">SPREADSHEET_ID</code>,
              <code className="mx-1 px-1 rounded bg-white dark:bg-slate-900 font-mono">DRIVE_FOLDER_ID</code>, dan
              <code className="mx-1 px-1 rounded bg-white dark:bg-slate-900 font-mono">SECRET_TOKEN</code>.
            </li>
            <li>
              Pilih fungsi <code className="px-1 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono">setupAppsScript</code> lalu klik <strong>Jalankan</strong> &amp; izinkan akses (Sheets, Drive, GmailApp) memakai akun sekolah.
            </li>
            <li>
              Klik <strong>Terapkan (Deploy) → Deployment baru → Jenis: Aplikasi Web</strong>. Atur <em>Jalankan sebagai</em> = <strong>Saya (Me)</strong> dan <em>Yang memiliki akses</em> = <strong>Siapa saja (Anyone)</strong>.
            </li>
            <li>
              Salin URL berakhiran <code className="font-mono">/exec</code> dan masukkan bersama <code className="font-mono">SECRET_TOKEN</code> pada form di bawah ini.
            </li>
          </ol>
        </div>
      )}

      {/* URL & Secret Token Form */}
      {showUrlEditor && (
        <form onSubmit={handleConnect} className="space-y-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              URL Web App Google Apps Script (/exec)
            </label>
            <div className="relative">
              <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (inlineError) setInlineError('');
                }}
                placeholder={
                  appsScriptUrl
                    ? 'URL tersimpan (kosongkan jika tidak mengubah URL)'
                    : 'https://script.google.com/macros/s/.../exec'
                }
                required={!appsScriptUrl}
                className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-slate-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Token Rahasia (SECRET_TOKEN dari Properti Skrip)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={secretInput}
                  onChange={(e) => {
                    setSecretInput(e.target.value);
                    if (inlineError) setInlineError('');
                  }}
                  placeholder={
                    appsScriptSecretConfigured
                      ? 'Token tersimpan (kosongkan jika tidak mengubah token)'
                      : 'Masukkan SECRET_TOKEN...'
                  }
                  required={!appsScriptSecretConfigured}
                  className="w-full pl-8 pr-9 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 px-2.5 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="submit"
                disabled={
                  isConnectingAppsScript ||
                  (!urlInput.trim() && !appsScriptUrl) ||
                  (!secretInput.trim() && !appsScriptSecretConfigured)
                }
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 font-semibold text-xs disabled:opacity-50 shrink-0"
              >
                {isConnectingAppsScript ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Menghubungkan...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isConnected ? 'Simpan Perubahan' : 'Hubungkan & Simpan'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {inlineError && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{inlineError}</span>
            </div>
          )}
        </form>
      )}
    </div>
  );
};
