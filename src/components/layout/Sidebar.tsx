import React from 'react';
import {
  UserCheck,
  DoorOpen,
  AlertTriangle,
  LayoutDashboard,
  GraduationCap,
  ShieldAlert,
  Sliders,
  LogOut,
  RefreshCw,
  WifiOff,
  AlertCircle,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { ActiveTab } from '../../types/index.js';
import { PWAInstallButton } from '../pwa/PWAInstallButton.js';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const {
    session,
    activeTab,
    setActiveTab,
    syncStatus,
    lastSyncTime,
    syncNow,
    logout,
    settings,
  } = useApp();

  const handleMenuClick = (tab: ActiveTab) => {
    onClose();
    if (tab === activeTab) return;
    setActiveTab(tab);
  };

  const menuItems = [
    { id: 'dashboard' as ActiveTab, label: '1. Dasbor & Rekap Kelas', icon: LayoutDashboard },
    { id: 'attendance' as ActiveTab, label: '2. Presensi Siswa', icon: UserCheck },
    { id: 'out_of_class' as ActiveTab, label: '3. Izin Keluar Kelas', icon: DoorOpen },
    { id: 'violations' as ActiveTab, label: '4. Pelanggaran', icon: AlertTriangle },
  ];

  const lockedRoleLabel =
    session?.lockedMenuRole === 'admin'
      ? 'Menu Admin'
      : session?.lockedMenuRole === 'student_affairs'
      ? 'Menu Kesiswaan'
      : session?.lockedMenuRole === 'homeroom'
      ? `Wali Kelas ${session.lockedMenuClassId || ''}`.trim()
      : null;

  const LockedRoleIcon =
    session?.lockedMenuRole === 'admin'
      ? Sliders
      : session?.lockedMenuRole === 'student_affairs'
      ? ShieldAlert
      : GraduationCap;

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header / Brand */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            {settings.logo_url ? (
              <img
                src={settings.logo_url}
                alt="Logo Sekolah"
                className="w-9 h-9 rounded-md object-contain bg-white dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 shadow-xs shrink-0"
              />
            ) : (
              <div className="flex items-center justify-center w-9 h-9 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-sm tracking-wider shrink-0 shadow-xs">
                DKB
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-900 dark:text-white truncate leading-tight">
                DISIPLIN KITA BISA
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={settings.school_name || 'Belum diatur'}>
                {settings.school_name || 'Nama Sekolah Belum Diatur'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 lg:hidden shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleMenuClick(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors text-left ${
                  isActive
                    ? 'bg-slate-100 text-slate-900 font-semibold dark:bg-slate-800 dark:text-white border border-slate-300 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  <span className="truncate">{item.label}</span>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Footer / Sync Status & User Profile */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 space-y-2">
          {session?.lockedMenuRole && lockedRoleLabel && activeTab !== session.lockedMenuRole && (
            <button
              type="button"
              onClick={() => {
                onClose();
                if (session.lockedMenuRole) setActiveTab(session.lockedMenuRole);
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition-colors"
            >
              <LockedRoleIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Kembali ke {lockedRoleLabel}</span>
            </button>
          )}

          {/* Real-time Sync Status indicator (Bagian 1 & 13) */}
          <div className="flex items-center justify-between px-2 py-1.5 rounded text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              {syncStatus === 'synced' && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-slate-600 dark:text-slate-300 font-medium">Tersinkron</span>
                </>
              )}
              {syncStatus === 'syncing' && (
                <>
                  <RefreshCw className="w-3 h-3 text-amber-500 animate-spin" />
                  <span className="text-amber-600 dark:text-amber-400 font-medium">Menyinkronkan...</span>
                </>
              )}
              {syncStatus === 'offline' && (
                <>
                  <WifiOff className="w-3 h-3 text-rose-500" />
                  <span className="text-rose-600 dark:text-rose-400 font-medium">Offline</span>
                </>
              )}
              {syncStatus === 'error' && (
                <>
                  <AlertCircle className="w-3 h-3 text-rose-500" />
                  <span className="text-rose-600 dark:text-rose-400 font-medium">Gagal Sinkron</span>
                </>
              )}
            </div>

            <button
              onClick={() => syncNow()}
              title="Sinkronkan Sekarang"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          <div className="text-[10px] text-slate-400 text-center">
            {lastSyncTime
              ? `Sinkron terakhir: ${lastSyncTime.toLocaleTimeString('id-ID')}`
              : 'Belum sinkron'}
          </div>

          {/* In-App PWA Offline Install Button */}
          <div className="pt-1">
            <PWAInstallButton />
          </div>

          {/* User Info & Logout */}
          <div className="pt-1 flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                {session?.name || 'Petugas Piket'}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {session?.lockedMenuRole
                  ? `Mode: ${session.lockedMenuRole.toUpperCase()}`
                  : 'Sesi Piket Aktif'}
              </p>
            </div>
            <button
              onClick={logout}
              title="Keluar ke Menu Awal Login"
              className="p-1.5 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
