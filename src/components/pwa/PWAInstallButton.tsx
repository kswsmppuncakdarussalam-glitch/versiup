import React, { useState } from 'react';
import { Download, Share2, PlusSquare, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall.js';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA on the home screen, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop prompt flow
  if (isInstallable) {
    if (compact) {
      return (
        <button
          onClick={install}
          title="Install Aplikasi PWA (Bisa Digunakan Saat Offline)"
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded shadow-xs transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Install PWA</span>
        </button>
      );
    }

    return (
      <button
        onClick={install}
        className="flex items-center justify-center gap-2 w-full py-2 px-3 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded-lg shadow-sm transition-colors"
      >
        <Download className="w-4 h-4" />
        <span>Install Aplikasi (PWA Offline)</span>
      </button>
    );
  }

  // iOS Safari flow (since beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        {compact ? (
          <button
            onClick={() => setShowIOSGuide(true)}
            title="Cara Pasang di iOS / iPhone"
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Install di iOS</span>
          </button>
        ) : (
          <button
            onClick={() => setShowIOSGuide(true)}
            className="flex items-center justify-center gap-2 w-full py-2 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Download className="w-4 h-4 text-indigo-500" />
            <span>Pasang di Layar Utama iPhone/iPad</span>
          </button>
        )}

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  Pasang di iPhone / iPad
                </h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300">
                Aplikasi ini mendukung mode offline penuh. Ikuti langkah berikut untuk memasang ke Layar Utama:
              </p>

              <ol className="space-y-3 text-xs text-slate-700 dark:text-slate-200">
                <li className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 font-bold shrink-0 text-[11px]">
                    1
                  </span>
                  <span>
                    Buka situs ini di <strong>Safari</strong>, lalu ketuk tombol <strong>Bagikan (Share)</strong> <Share2 className="w-3.5 h-3.5 inline mx-1 text-blue-500" /> di bilah bawah.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 font-bold shrink-0 text-[11px]">
                    2
                  </span>
                  <span>
                    Gulir ke bawah dan pilih menu <strong>Tambahkan ke Layar Utama</strong> (Add to Home Screen) <PlusSquare className="w-3.5 h-3.5 inline mx-1 text-slate-600 dark:text-slate-300" />.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 font-bold shrink-0 text-[11px]">
                    3
                  </span>
                  <span>
                    Ketuk <strong>Tambah</strong> di pojok kanan atas. Ikon aplikasi akan muncul di Layar Utama Anda dan siap digunakan saat offline!
                  </span>
                </li>
              </ol>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              >
                Saya Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
