import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';

export const OfflineIndicatorBanner: React.FC = () => {
  const { syncStatus, syncNow } = useApp();
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(0);
  const isOffline = syncStatus === 'offline' || (typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const checkQueue = () => {
      try {
        const raw = localStorage.getItem('dkb_offline_queue');
        if (raw) {
          const list = JSON.parse(raw);
          setOfflineQueueCount(Array.isArray(list) ? list.length : 0);
        } else {
          setOfflineQueueCount(0);
        }
      } catch {
        setOfflineQueueCount(0);
      }
    };

    checkQueue();
    const interval = setInterval(checkQueue, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!isOffline) {
    return null;
  }

  return (
    <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-medium flex items-center justify-between border-b border-amber-600 shadow-xs animate-in slide-in-from-top duration-300">
      <div className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>
          <strong>Mode Offline PWA Aktif:</strong> Aplikasi tetap berfungsi normal tanpa koneksi internet. Presensi, izin keluar kelas, dan pelanggaran tersimpan lokal.
          {offlineQueueCount > 0 && (
            <span className="ml-1.5 px-2 py-0.5 rounded-full bg-slate-950 text-amber-300 font-bold text-[10px]">
              {offlineQueueCount} data menunggu sinkronisasi
            </span>
          )}
        </span>
      </div>

      <button
        onClick={() => syncNow()}
        className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-900 text-amber-300 text-[11px] font-bold transition-colors shrink-0 ml-3"
      >
        <RefreshCw className="w-3 h-3" />
        <span>Coba Hubungkan</span>
      </button>
    </div>
  );
};
