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
  Share2,
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
    isConnectingAppsScript,
    connectAppsScript,
    disconnectAppsScript,
    envStatus,
    requestConfirm,
    showToast,
  } = useApp();

  const isConnected = Boolean(appsScriptUrl);
  const [urlInput, setUrlInput] = useState(appsScriptUrl || '');
  const [copied, setCopied] = useState(false);
  const [showGuide, setShowGuide] = useState(!compact && !isConnected);
  const [showUrlEditor, setShowUrlEditor] = useState(!isConnected);
  const [inlineError, setInlineError] = useState('');

  useEffect(() => {
    setUrlInput(appsScriptUrl || '');
    if (appsScriptUrl) {
      setShowUrlEditor(false);
      setShowGuide(false);
    } else {
      setShowUrlEditor(true);
    }
  }, [appsScriptUrl]);

  const [copiedLink, setCopiedLink] = useState(false);

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

  const handleCopyDeviceLink = async () => {
    if (!appsScriptUrl || typeof window === 'undefined') return;
    const shareUrl = `${window.location.origin}/?script=${encodeURIComponent(appsScriptUrl)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      showToast('Link sinkronisasi otomatis perangkat disalin! Buka link ini di perangkat lain agar langsung tersambung.', 'success');
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      showToast(`Salin link berikut: ${shareUrl}`, 'info');
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
    const res = await connectAppsScript(urlInput);
    if (!res.ok) {
      setInlineError(res.message);
    } else {
      setShowUrlEditor(false);
    }
  };

  const handleDisconnect = async () => {
    const confirmed = await requestConfirm({
      title: 'Putuskan Backend Apps Script?',
      message:
        'Aplikasi akan kembali menggunakan backend standar (Server Lokal / Google OAuth). Data di Google Sheets tetap aman.',
      confirmLabel: 'Ya, Putuskan',
      variant: 'warning',
    });
    if (!confirmed) return;
    await disconnectAppsScript();
    setUrlInput('');
    setInlineError('');
    setShowUrlEditor(true);
  };

  const maskedUrl =
    appsScriptUrl.length > 52
      ? `${appsScriptUrl.slice(0, 38)}...${appsScriptUrl.slice(-10)}`
      : appsScriptUrl;

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
                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {isConnected ? 'Tersimpan & Aktif Otomatis' : 'Siap Dipasang'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {isConnected
                ? `URL Web App tersimpan permanen. Setiap edit, tambah, hapus, atau perubahan langsung tersinkron otomatis ke Google Sheets & Gmail (${envStatus.senderEmail || 'GmailApp'}).`
                : 'Tempel URL Web App satu kali saja — tersimpan otomatis di perangkat & server untuk seluruh sesi.'}
            </p>
          </div>
        </div>

        {isConnected && (
          <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-start sm:self-center">
            <button
              type="button"
              onClick={handleCopyDeviceLink}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 font-semibold text-[11px]"
              title="Salin link Vercel dengan koneksi Apps Script otomatis untuk perangkat/browser lain"
            >
              {copiedLink ? <CheckCircle2 className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
              <span>{copiedLink ? 'Link Disalin' : 'Link Perangkat'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowUrlEditor((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 font-semibold text-[11px]"
            >
              <Edit3 className="w-3 h-3" />
              <span>{showUrlEditor ? 'Tutup' : 'Ganti URL'}</span>
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

      {/* Saved URL summary pill when connected and editor collapsed */}
      {isConnected && !showUrlEditor && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-emerald-200 dark:border-emerald-800/80 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-mono text-slate-700 dark:text-slate-300 truncate" title={appsScriptUrl}>
              {maskedUrl}
            </span>
          </div>
          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
            Sinkron Otomatis Aktif
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
            Langkah Memasang Backend Google Apps Script (Sekali Saja):
          </p>
          <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
            <li>
              Buka Google Spreadsheet Anda lalu klik menu <strong>Ekstensi → Apps Script</strong>.
            </li>
            <li>
              Hapus kode bawaan di editor, lalu tempel seluruh isi <strong>Code.gs</strong> (gunakan tombol <em>Salin Code.gs</em> di atas) dan klik ikon <strong>Simpan</strong>.
            </li>
            <li>
              Pilih fungsi <code className="px-1 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono">setupAppsScript</code> lalu klik <strong>Jalankan</strong> &amp; izinkan akses (Sheets, Drive, dan GmailApp) menggunakan akun <span className="font-mono">kswsmp.puncakdarussalam@gmail.com</span>.
            </li>
            <li>
              Klik <strong>Terapkan (Deploy) → Deployment baru → Jenis: Aplikasi web</strong> (atau jika memperbarui kode, pilih <strong>Kelola deployment → Edit → Versi baru</strong>). Atur <em>Jalankan sebagai</em> = <strong>Saya</strong> dan <em>Yang memiliki akses</em> = <strong>Siapa saja (Anyone)</strong>, lalu tempel URL berakhiran <code className="font-mono">/exec</code> satu kali di bawah ini (jangan gunakan URL <code className="font-mono">/dev</code>).
            </li>
          </ol>
        </div>
      )}

      {/* URL Form (only visible when not connected OR user explicitly clicked Ganti URL) */}
      {showUrlEditor && (
        <form onSubmit={handleConnect} className="space-y-2">
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            URL Web App Google Apps Script (/exec)
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (inlineError) setInlineError('');
                }}
                placeholder="https://script.google.com/macros/s/.../exec"
                required
                className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-slate-400"
              />
            </div>
            <button
              type="submit"
              disabled={isConnectingAppsScript || !urlInput.trim()}
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
                  <span>{isConnected ? 'Simpan URL Baru' : 'Hubungkan & Simpan'}</span>
                </>
              )}
            </button>
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
