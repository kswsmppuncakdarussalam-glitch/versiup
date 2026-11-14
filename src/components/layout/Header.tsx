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
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { formatServerTime, formatIndonesianDate, LiveClockText } from '../../utils/time.js';
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
    googleSheetsConnected,
    googleOAuthActive,
    serverDriveSyncActive,
    googleSyncing,
    syncGoogleSheetsNow,
    syncStatus,
    syncNow,
    serverVersion,
  } = useApp();

  const isAutoDriveActive = googleOAuthActive || serverDriveSyncActive;
  const isCloudConfiguredInDb = Boolean(
    settings.google_oauth_connected ||
      (settings.google_client_id?.trim() &&
        settings.google_account_email?.trim() &&
        (settings.google_sheet_id?.trim() || settings.google_drive_folder_id?.trim()))
  );

  const isLockedMenuOpen = Boolean(session?.lockedMenuRole);

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
          {settings.logo_url ? (
            <img
              src={settings.logo_url}
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

      {/* Right: Server Clock, Kiosk mode, Audio toggle, Lock indicator */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* In-App PWA Offline Install Button */}
        <PWAInstallButton compact={true} />

        {/* Real-time Multi-Device Sync Indicator */}
        <button
          onClick={() => syncNow()}
          title={
            syncStatus === 'synced'
              ? `Multi-Device Sinkron Real-Time Aktif (Versi Data: v${serverVersion}). Klik untuk sinkronkan manual.`
              : syncStatus === 'syncing'
              ? 'Sedang menyinkronkan data multi-perangkat...'
              : syncStatus === 'offline'
              ? 'Mode Offline Lokal Aktif'
              : 'Sinkronisasi tertunda (Klik untuk mencoba lagi)'
          }
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border font-medium transition-all ${
            syncStatus === 'synced'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
              : syncStatus === 'syncing'
              ? 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800 animate-pulse'
              : syncStatus === 'offline'
              ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
              : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              syncStatus === 'synced'
                ? 'bg-emerald-500'
                : syncStatus === 'syncing'
                ? 'bg-sky-500 animate-ping'
                : syncStatus === 'offline'
                ? 'bg-amber-500'
                : 'bg-rose-500'
            }`}
          />
          <span className="hidden sm:inline">
            {syncStatus === 'synced'
              ? `Real-Time (v${serverVersion})`
              : syncStatus === 'syncing'
              ? 'Sinkron...'
              : syncStatus === 'offline'
              ? 'Offline'
              : 'Coba Ulang'}
          </span>
          <span className="sm:hidden font-mono text-[10px]">
            v{serverVersion}
          </span>
        </button>

        {/* Google Drive & Sheets Auto-Sync Status Pill */}
        {googleSyncing ? (
          <div
            title="Sedang menyinkronkan data ke Google Drive & Google Sheets secara otomatis..."
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800"
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Sinkron Drive & Sheets...</span>
          </div>
        ) : isAutoDriveActive || settings.google_oauth_connected || isCloudConfiguredInDb ? (
          <button
            type="button"
            onClick={() => syncGoogleSheetsNow()}
            title={`Koneksi Permanen Aktif (${settings.google_account_email || 'kswsmp.puncakdarussalam@gmail.com'}). Email, Database, Google Drive & Sheets tetap terhubung meski refresh atau buka-tutup aplikasi. Klik untuk sinkron manual bila perlu.`}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 transition-colors"
          >
            <Database className="w-3 h-3" />
            <span>{isAutoDriveActive ? 'Email, DB, Drive & Sheets Aktif' : 'Email & Cloud Tersambung'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => syncGoogleSheetsNow()}
            title={
              googleSheetsConnected
                ? 'Klik 1x untuk menghubungkan OAuth 2.0 permanen (Email, Database, Drive & Sheets)'
                : 'Klik 1x untuk menghubungkan Google OAuth 2.0 & mengaktifkan Auto-Sync Drive & Sheets'
            }
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 transition-colors"
          >
            <Database className="w-3 h-3" />
            <span>Hubungkan OAuth 2.0 (1x)</span>
          </button>
        )}

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
