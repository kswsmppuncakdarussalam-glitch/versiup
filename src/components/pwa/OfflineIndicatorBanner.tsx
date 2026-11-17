import React from 'react';
import { WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';

export const OfflineIndicatorBanner: React.FC = () => {
  const { syncStatus, pendingOfflineScansCount } = useApp();
  const isOffline = syncStatus === 'offline' || (typeof navigator !== 'undefined' && !navigator.onLine);

  if (!isOffline && pendingOfflineScansCount === 0) {
    return null;
  }

  return (
    <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-medium flex items-center justify-between border-b border-amber-600 shadow-xs">
      <div className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>
          <strong>{isOffline ? 'Mode Offline Aktif:' : 'Mengirim Scan Offline:'}</strong>{' '}
          {isOffline
            ? 'Scan presensi disimpan sementara di perangkat dan akan dikirim otomatis ke Google Sheets saat koneksi internet kembali.'
            : 'Sedang mengirim data presensi yang tertunda saat offline ke Google Sheets...'}
          {pendingOfflineScansCount > 0 && (
            <span className="ml-1.5 px-2 py-0.5 rounded-full bg-slate-950 text-amber-300 font-bold text-[10px]">
              {pendingOfflineScansCount} scan menunggu terkirim otomatis
            </span>
          )}
        </span>
      </div>
    </div>
  );
};
