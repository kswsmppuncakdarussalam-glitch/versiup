import React from 'react';
import {
  Menu,
  Clock,
  Maximize2,
  Minimize2,
  Lock,
  Volume2,
  VolumeX,
  Database,
  Calendar,
  User,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { formatIndonesianDate, LiveClockText } from '../../utils/time.js';
import { useResolvedPhotoSrc } from '../common/DriveImage.js';
import { PWAInstallButton } from '../pwa/PWAInstallButton.js';

interface HeaderProps {
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const {
    currentServerTime,
    activeSession,
    sessionSchedule,
    isKioskFullscreen,
    toggleKioskFullscreen,
    session,
    activeTab,
    setActiveTab,
    lockCurrentMenu,
    settings,
    updateSettings,
    syncStatus,
    saveStatus,
    envStatus,
    appsScriptUrl,
    appsScriptSecretConfigured,
  } = useApp();

  const isLockedMenuOpen = Boolean(session?.lockedMenuRole);
  const logoSrc = useResolvedPhotoSrc(settings.logo_url);
  const isBackendConfigured = Boolean(appsScriptUrl) && appsScriptSecretConfigured && envStatus.sheetsConfigured;

  const toggleSound = () => {
    updateSettings({ tts_enabled: !settings.tts_enabled });
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
      {/* Left: Mobile menu & School info */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 -ml-1 text-slate-500 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Mobile School Logo & Title */}
        <div className="flex items-center gap-2 lg:hidden">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Logo"
              className="w-6 h-6 rounded object-contain bg-white dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700"
            />
          ) : (
            <div className="w-6 h-6 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-[10px] flex items-center justify-center">
              DKB
            </div>
          )}
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[130px]" title={settings.school_name}>
            {settings.school_name || 'DKB'}
          </span>
        </div>

        {/* Active Session Badge */}
        {activeSession ? (
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                sessionSchedule.status === 'active'
                  ? 'bg-emerald-500 animate-pulse'
                  : sessionSchedule.status === 'override'
                  ? 'bg-indigo-500'
                  : 'bg-amber-500'
              }`}
            />
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {sessionSchedule.manualSessionId ? 'Manual:' : sessionSchedule.isAutoSwitchEnabled ? 'Sesi Otomatis:' : 'Sesi:'}{' '}
              {activeSession.name}
            </span>
            <span className="text-slate-400">
              ({activeSession.start_time} - {activeSession.end_time})
            </span>
            <span className="text-[10px] text-slate-500 bg-white dark:bg-slate-900 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700">
              {sessionSchedule.status === 'upcoming' && sessionSchedule.minutesUntilNext > 0
                ? `Mulai dlm ${sessionSchedule.minutesUntilNext}m`
                : `Tepat Waktu: s/d ${activeSession.on_time_limit}`}
            </span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-700 dark:text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>Di Luar Jam Sesi Terjadwal</span>
          </div>
        )}

        {/* Active Multi-User Role Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
          <User className="w-3.5 h-3.5 text-indigo-500" />
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {session?.lockedMenuRole === 'admin'
              ? 'Administrator'
              : session?.lockedMenuRole === 'student_affairs'
              ? 'Kesiswaan'
              : session?.lockedMenuRole === 'homeroom'
              ? `Wali Kelas ${session.lockedMenuClassId || ''}`
              : 'Petugas Piket'}
          </span>
          <span className="text-[10px] text-slate-400 hidden md:inline">
            ({session?.name || 'Utama'})
          </span>
          {session?.lockedMenuRole && activeTab !== session.lockedMenuRole && (
            <button
              type="button"
              onClick={() => session.lockedMenuRole && setActiveTab(session.lockedMenuRole)}
              className="ml-1 px-1.5 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-[10px] font-semibold hover:opacity-90 transition-opacity"
            >
              Buka Portal
            </button>
          )}
        </div>
      </div>

      {/* Right: Read-only Write/Sheets Status, Server Clock, Kiosk mode, Audio toggle */}
      <div className="flex items-center gap-2 sm:gap-3">
        <PWAInstallButton compact={true} />

        {/* Read-only Write Status Pill ('Menyimpan...' / 'Tersimpan' / Error) */}
        {saveStatus.state !== 'idle' && (
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold border ${
              saveStatus.state === 'saving'
                ? 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                : saveStatus.state === 'saved'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
            }`}
          >
            {saveStatus.state === 'saving' && <RefreshCw className="w-3 h-3 animate-spin" />}
            {saveStatus.state === 'saved' && <CheckCircle2 className="w-3 h-3" />}
            {saveStatus.state === 'error' && <AlertCircle className="w-3 h-3" />}
            <span className="max-w-[160px] truncate">{saveStatus.message}</span>
          </div>
        )}

        {/* Read-only Apps Script Status (links to Cek Sistem when incomplete) */}
        <button
          type="button"
          onClick={() => setActiveTab('system_check')}
          title={
            isBackendConfigured
              ? `Terhubung langsung ke Google Apps Script Web App${envStatus.senderEmail ? ` (${envStatus.senderEmail})` : ''} (sinkron otomatis real-time). Klik untuk membuka Cek Sistem.`
              : 'Klik untuk membuka Cek Sistem dan melihat bagian konfigurasi yang belum lengkap.'
          }
          className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
            !isBackendConfigured
              ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100'
              : syncStatus === 'synced'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
              : syncStatus === 'syncing'
              ? 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800'
              : syncStatus === 'offline'
              ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
              : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800'
          }`}
        >
          <Database className="w-3 h-3" />
          <span className="max-w-[170px] truncate">
            {!appsScriptUrl || !appsScriptSecretConfigured
              ? 'Apps Script Belum Diset'
              : !envStatus.sheetsConfigured
              ? 'Cek Konfigurasi Sheets'
              : syncStatus === 'synced'
              ? 'Apps Script (Aktif)'
              : syncStatus === 'syncing'
              ? 'Memuat Sheets...'
              : syncStatus === 'offline'
              ? 'Offline Lokal'
              : 'Gangguan Koneksi'}
          </span>
        </button>

        {/* Date & Server Authoritative Clock */}
        <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs">
          <Calendar className="hidden lg:inline w-3.5 h-3.5 text-slate-400" />
          <span className="hidden lg:inline text-slate-600 dark:text-slate-300">
            {formatIndonesianDate(currentServerTime)}
          </span>
          <span className="hidden lg:inline text-slate-300 dark:text-slate-600">|</span>
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <LiveClockText className="font-mono font-semibold text-slate-900 dark:text-white" />
        </div>

        {/* Audio Mute/Unmute */}
        <button
          onClick={toggleSound}
          title={settings.tts_enabled ? 'Matikan Suara & TTS' : 'Nyalakan Suara & TTS'}
          className={`p-1.5 rounded border transition-colors ${
            settings.tts_enabled
              ? 'text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              : 'text-slate-400 bg-slate-100 dark:bg-slate-800 border-transparent'
          }`}
        >
          {settings.tts_enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>

        {/* Kiosk Fullscreen Toggle */}
        <button
          onClick={toggleKioskFullscreen}
          title={isKioskFullscreen ? 'Keluar Layar Penuh' : 'Mode Layar Penuh (Kiosk)'}
          className="p-1.5 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          {isKioskFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* "Kunci & Keluar" button if logged in with elevated role */}
        {isLockedMenuOpen && (
          <button
            onClick={lockCurrentMenu}
            title="Kunci sesi dan kembali ke Menu Awal Login"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded hover:bg-amber-100 transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kunci &amp; Keluar</span>
          </button>
        )}
      </div>
    </header>
  );
};
