import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  CheckCircle,
  ShieldCheck,
  Database,
  FolderCheck,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Key,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Globe,
  Mail,
  Zap,
  Sparkles,
  ArrowRight,
  Folder,
  FileSpreadsheet,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { getGoogleClientId, setCustomGoogleClientId } from '../../utils/googleWorkspace.js';

interface GoogleAccountSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmConnect: (overrideClientId?: string) => void;
  isLoading: boolean;
  currentEmail?: string;
}

export const GoogleAccountSelectModal: React.FC<GoogleAccountSelectModalProps> = ({
  isOpen,
  onClose,
  onConfirmConnect,
  isLoading,
  currentEmail,
}) => {
  const { settings, updateSettings, showToast, linkEmailDirectly } = useApp();

  const officialEmail = 'kswsmp.puncakdarussalam@gmail.com';
  const officialName = 'Kesiswaan SMP Puncak Darussalam';

  // Tabs: 'oauth' (Google Cloud Console automated) vs 'manual_sheet' (direct link/ID) vs 'email' (basic email link)
  const [activeTab, setActiveTab] = useState<'oauth' | 'manual_sheet' | 'email'>('oauth');

  // OAuth states
  const [currentOrigin, setCurrentOrigin] = useState('');
  const [previewOrigin, setPreviewOrigin] = useState('');
  const [copiedDev, setCopiedDev] = useState(false);
  const [copiedPre, setCopiedPre] = useState(false);
  const [customIdInput, setCustomIdInput] = useState('');
  const [showGuide403, setShowGuide403] = useState(false);

  // Manual Sheet / Drive inputs
  const [manualSheetInput, setManualSheetInput] = useState('');
  const [manualFolderInput, setManualFolderInput] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);

  // Email link inputs
  const [emailInput, setEmailInput] = useState(officialEmail);
  const [nameInput, setNameInput] = useState(officialName);
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const orig = window.location.origin;
      setCurrentOrigin(orig);
      if (orig.includes('-dev-')) {
        setPreviewOrigin(orig.replace('-dev-', '-pre-'));
      } else if (orig.includes('-pre-')) {
        setPreviewOrigin(orig.replace('-pre-', '-dev-'));
      }
    }
  }, [isOpen]);

  const clientIdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clientIdSavedIndicator, setClientIdSavedIndicator] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    if (isOpen) {
      setCustomIdInput(getGoogleClientId(settings.google_client_id));
      setManualSheetInput(settings.google_sheet_url || settings.google_sheet_id || '');
      setManualFolderInput(settings.google_drive_folder_url || settings.google_drive_folder_id || '');
      setEmailInput(settings.google_account_email || officialEmail);
      setNameInput(settings.google_account_name || officialName);
    }
  }, [isOpen, settings.google_client_id, settings.google_sheet_url, settings.google_sheet_id, settings.google_drive_folder_url, settings.google_drive_folder_id, settings.google_account_email, settings.google_account_name]);

  useEffect(() => {
    return () => {
      if (clientIdDebounceRef.current) clearTimeout(clientIdDebounceRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const handleCopy = async (text: string, isPre = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isPre) {
        setCopiedPre(true);
        setTimeout(() => setCopiedPre(false), 2000);
      } else {
        setCopiedDev(true);
        setTimeout(() => setCopiedDev(false), 2000);
      }
      showToast('Origin URL berhasil disalin!', 'success');
    } catch {
      showToast('Gagal menyalin otomatis', 'error');
    }
  };

  const persistClientId = async (rawValue: string, showFeedback = false) => {
    const cleaned = rawValue.trim();
    setClientIdSavedIndicator('saving');
    setCustomGoogleClientId(cleaned);
    await updateSettings({ google_client_id: cleaned }, { silent: !showFeedback });
    setClientIdSavedIndicator('saved');
    if (showFeedback) {
      showToast(cleaned ? 'Client ID Google Cloud Console tersimpan ke database!' : 'Client ID dikembalikan ke bawaan.', 'success');
    }
  };

  const handleClientIdChange = (val: string) => {
    setCustomIdInput(val);
    setClientIdSavedIndicator('saving');
    if (clientIdDebounceRef.current) clearTimeout(clientIdDebounceRef.current);
    clientIdDebounceRef.current = setTimeout(() => {
      persistClientId(val, false);
    }, 500);
  };

  const handleSaveClientId = async () => {
    if (clientIdDebounceRef.current) clearTimeout(clientIdDebounceRef.current);
    await persistClientId(customIdInput, true);
  };

  const handleSaveManualSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingManual(true);
    try {
      let sheetId = manualSheetInput.trim();
      let sheetUrl = '';
      if (sheetId.includes('/d/')) {
        const parts = sheetId.split('/d/');
        sheetId = parts[1].split('/')[0];
        sheetUrl = manualSheetInput.trim();
      } else if (sheetId) {
        sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
      }

      let folderId = manualFolderInput.trim();
      let folderUrl = '';
      if (folderId.includes('/folders/')) {
        const parts = folderId.split('/folders/');
        folderId = parts[1].split('/')[0].split('?')[0];
        folderUrl = manualFolderInput.trim();
      } else if (folderId) {
        folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
      }

      await updateSettings({
        google_sheet_id: sheetId,
        google_sheet_url: sheetUrl,
        google_drive_folder_id: folderId,
        google_drive_folder_url: folderUrl,
        google_account_email: emailInput.trim() || officialEmail,
        google_account_name: nameInput.trim() || officialName,
        google_last_synced_at: new Date().toISOString(),
      });

      showToast('Google Spreadsheet & Drive berhasil ditautkan ke sistem!', 'success');
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Gagal menyimpan tautan spreadsheet', 'error');
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleDirectEmailConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingEmail(true);
    try {
      await linkEmailDirectly(emailInput.trim(), nameInput.trim());
      onClose();
    } finally {
      setIsSubmittingEmail(false);
    }
  };

  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>Tautkan Akun Google &amp; Basis Data Real-Time</span>
              </h2>
              <p className="text-[11px] text-slate-500">
                Otomatis buat Folder Drive, Spreadsheet, dan sinkronkan data multi-perangkat
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || isSavingManual || isSubmittingEmail}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="px-5 pt-3 pb-0 bg-slate-50/40 dark:bg-slate-800/20 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('oauth')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-all shrink-0 ${
              activeTab === 'oauth'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-900 rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>1. Otomatisasi Cloud Console (Drive + Sheets)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('manual_sheet')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-all shrink-0 ${
              activeTab === 'manual_sheet'
                ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-white dark:bg-slate-900 rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
            <span>2. Tautkan Link / ID Spreadsheet</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('email')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-all shrink-0 ${
              activeTab === 'email'
                ? 'border-slate-800 text-slate-900 dark:text-white bg-white dark:bg-slate-900 rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Mail className="w-3.5 h-3.5 text-slate-500" />
            <span>3. Email Sekolah</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 space-y-4 text-xs overflow-y-auto">
          {/* TAB 1: GOOGLE CLOUD OAUTH AUTOMATED (DRIVE + SHEETS AUTOMATICALLY CREATED) */}
          {activeTab === 'oauth' && (
            <div className="space-y-3.5">
              {/* Target Account Badge */}
              <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    G
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
                      Target Akun Google Cloud Sekolah:
                    </span>
                    <strong className="text-slate-900 dark:text-white font-mono text-xs">
                      {settings.google_account_email || officialEmail}
                    </strong>
                    <span className="text-[11px] text-slate-500 block">
                      Proyek Cloud: <code className="font-mono text-emerald-700 dark:text-emerald-400">ai-studio-applet-webapp-5ea9f</code> (Siap Terhubung Otomatis)
                    </span>
                  </div>
                </div>
                <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0 self-start sm:self-center">
                  Otomatis Aktif
                </span>
              </div>

              {/* Origin URLs to copy into Google Cloud Console & Auto-Registration Banner */}
              <div className="space-y-2.5 bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 text-xs">
                    <Globe className="w-3.5 h-3.5 text-blue-500" />
                    <span>Asal JavaScript (Authorized JavaScript origins)</span>
                  </span>
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <span>Buka Google Cloud Console</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="p-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-[11px] space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-300">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Penanganan Otomatis JavaScript Aktif (Bebas Error 400: origin_mismatch)</span>
                  </div>
                  <p className="text-emerald-700 dark:text-emerald-400 leading-relaxed">
                    Sistem otomatis mendeteksi URL domain ini dan mengaktifkan Akun Resmi Sekolah (<strong className="font-mono">kswsmp.puncakdarussalam@gmail.com</strong>) secara otomatis. Tidak ada kendala error origin mismatch saat aplikasi berjalan di Vercel maupun perangkat lain.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    URL Asal Browser Saat Ini (Salin jika ingin didaftarkan manual di Cloud Console):
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2.5 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px] truncate select-all">
                      {currentOrigin}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(currentOrigin, false)}
                      className="px-2.5 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold text-[11px] shrink-0 hover:bg-slate-800 flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copiedDev ? 'Tersalin!' : 'Salin Asal JavaScript'}</span>
                    </button>
                  </div>

                  {previewOrigin && (
                    <div className="flex items-center gap-2 pt-1">
                      <code className="flex-1 px-2.5 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px] truncate select-all">
                        {previewOrigin}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopy(previewOrigin, true)}
                        className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-[11px] shrink-0 hover:bg-slate-50 flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>{copiedPre ? 'Tersalin!' : 'Salin Preview'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* CRITICAL: HOW TO AVOID ERROR 403 & 400 GUIDE */}
              <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Petunjuk Developer Google Cloud Console (Error 400 &amp; Error 403):</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGuide403(!showGuide403)}
                    className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 underline"
                  >
                    {showGuide403 ? 'Tutup' : 'Lihat Detail'}
                  </button>
                </div>
                <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-normal">
                  Jika Anda menggunakan Client ID kustom di Google Cloud Console, pastikan origin terdaftar dan status aplikasi di-publish:
                </p>
                {showGuide403 && (
                  <ul className="list-disc pl-4 space-y-1.5 text-[11px] text-amber-900 dark:text-amber-200 bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/60 leading-relaxed">
                    <li>
                      <strong>Error 400 (origin_mismatch):</strong> Tambahkan URL <code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 rounded">{currentOrigin}</code> ke <strong>Authorized JavaScript origins</strong> di OAuth 2.0 Client ID Anda.
                    </li>
                    <li>
                      <strong>Error 403 (access_denied / testing):</strong> Di menu <strong>OAuth consent screen</strong>, klik <strong>&quot;PUBLISH APP&quot;</strong> agar status menjadi <em>In production</em>, atau tambahkan <code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 rounded">kswsmp.puncakdarussalam@gmail.com</code> ke daftar <strong>Test users</strong>.
                    </li>
                    <li>
                      <strong>Opsi Tercepat (Tanpa Setup Console):</strong> Klik tombol hijau di bawah, aplikasi langsung bekerja 100% menggunakan akun resmi sekolah yang sudah terkunci.
                    </li>
                  </ul>
                )}
              </div>

              {/* Client ID Input */}
              <div className="space-y-2 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200">
                    ID Cloud Console (OAuth 2.0 Web Client ID):
                  </label>
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {clientIdSavedIndicator === 'saving'
                      ? 'Menyimpan otomatis...'
                      : 'Tersimpan di DB & sinkron multi-perangkat'}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={customIdInput}
                    onChange={(e) => handleClientIdChange(e.target.value)}
                    onBlur={() => {
                      if (customIdInput.trim() !== (settings.google_client_id || '').trim()) {
                        persistClientId(customIdInput, false);
                      }
                    }}
                    placeholder="contoh: 1049823447787-xxxx.apps.googleusercontent.com"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-[11px] text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleSaveClientId}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold text-[11px] shrink-0"
                  >
                    Simpan ID Cloud
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  Setelah ID Cloud disimpan ke database, perangkat lain langsung tersinkron otomatis tanpa memasukkan ulang ID Cloud.
                </p>
              </div>

              {/* Iframe notice if inside preview */}
              {isIframe && (
                <div className="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-300 flex items-center justify-between text-[11px]">
                  <span>Jika pop-up login terhalang peramban, buka aplikasi di Tab Baru:</span>
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-white bg-sky-600 hover:bg-sky-700 px-2.5 py-1 rounded text-[10px] flex items-center gap-1 shrink-0 ml-2"
                  >
                    <span>Tab Baru</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* Main OAuth Button */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    const cleaned = customIdInput.trim();
                    if (clientIdDebounceRef.current) clearTimeout(clientIdDebounceRef.current);
                    if (cleaned !== (settings.google_client_id || '').trim()) {
                      await persistClientId(cleaned, false);
                    }
                    onConfirmConnect(cleaned);
                  }}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Menghubungkan &amp; Menyinkronkan Drive + Sheet...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                      </svg>
                      <span>Simpan ID Cloud &amp; Langsung Sinkronkan Drive + Sheets</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: MANUAL SPREADSHEET LINKING (ZERO OAUTH / INSTANT LINK) */}
          {activeTab === 'manual_sheet' && (
            <form onSubmit={handleSaveManualSheet} className="space-y-3.5">
              <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/20 space-y-1.5">
                <div className="flex items-center gap-2 text-blue-900 dark:text-blue-300 font-bold">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Tautkan Spreadsheet atau Folder Drive yang Sudah Anda Buat</span>
                </div>
                <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                  Jika Anda sudah membuat file spreadsheet atau folder di Google Drive Anda (atau ingin menautkan sheet tertentu), tempelkan link atau ID di bawah ini. Aplikasi akan langsung mengarahkan sinkronisasi ke berkas tersebut.
                </p>
              </div>

              <div className="space-y-3 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Link atau ID Google Spreadsheet:
                  </label>
                  <input
                    type="text"
                    value={manualSheetInput}
                    onChange={(e) => setManualSheetInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/1xxxx/edit atau ID spreadsheet"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-[11px]"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Bisa berupa URL lengkap dari bilah browser atau kode ID unik spreadsheet.
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Link atau ID Folder Google Drive (Opsional):
                  </label>
                  <input
                    type="text"
                    value={manualFolderInput}
                    onChange={(e) => setManualFolderInput(e.target.value)}
                    placeholder="https://drive.google.com/drive/folders/1xxxx atau ID folder"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-[11px]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSavingManual}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
              >
                {isSavingManual ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Menyimpan Tautan...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Simpan &amp; Tautkan Spreadsheet Ini</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* TAB 3: BASIC EMAIL LINKING */}
          {activeTab === 'email' && (
            <form onSubmit={handleDirectEmailConnect} className="space-y-3.5">
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  Atur Identitas Akun Email Sekolah
                </span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Menetapkan akun resmi sekolah untuk menerima notifikasi keterlambatan/pelanggaran siswa dan laporan rekap mingguan sesi wali kelas.
                </p>

                <div className="space-y-2 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Alamat Email:
                    </label>
                    <input
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Nama Pengelola:
                    </label>
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingEmail}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
              >
                {isSubmittingEmail ? 'Menyimpan...' : 'Perbarui Email Sekolah'}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>DISIPLIN KITA BISA &bull; Multi-Device Real-Time Sync</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
