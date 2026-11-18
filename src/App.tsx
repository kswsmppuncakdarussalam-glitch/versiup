import React, { useState, Suspense } from 'react';
import { AppProvider, useApp } from './context/AppContext.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { Header } from './components/layout/Header.js';
import { OfflineIndicatorBanner } from './components/pwa/OfflineIndicatorBanner.js';
import { DutyLoginScreen } from './components/modals/AuthLoginModal.js';
import { CheckCircle2, AlertCircle, Info, X, Lock, AlertTriangle, RefreshCw, Trash2, ShieldCheck } from 'lucide-react';

const DashboardView = React.lazy(() => import('./views/DashboardView.js').then((m) => ({ default: m.DashboardView })));
const AttendanceView = React.lazy(() => import('./views/AttendanceView.js').then((m) => ({ default: m.AttendanceView })));
const OutOfClassView = React.lazy(() => import('./views/OutOfClassView.js').then((m) => ({ default: m.OutOfClassView })));
const ViolationsView = React.lazy(() => import('./views/ViolationsView.js').then((m) => ({ default: m.ViolationsView })));
const SystemCheckView = React.lazy(() => import('./views/SystemCheckView.js').then((m) => ({ default: m.SystemCheckView })));
const HomeroomView = React.lazy(() => import('./views/HomeroomView.js').then((m) => ({ default: m.HomeroomView })));
const StudentAffairsView = React.lazy(() => import('./views/StudentAffairsView.js').then((m) => ({ default: m.StudentAffairsView })));
const AdminView = React.lazy(() => import('./views/AdminView.js').then((m) => ({ default: m.AdminView })));

const ViewLoadingSkeleton: React.FC = () => (
  <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto animate-pulse">
    <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-lg w-1/4 mb-4" />
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 bg-slate-200 dark:bg-slate-800 rounded-xl" />
      ))}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded-xl" />
      <div className="lg:col-span-2 h-64 bg-slate-200 dark:bg-slate-800 rounded-xl" />
    </div>
  </div>
);

const LockedRolePlaceholder: React.FC<{
  role: 'homeroom' | 'student_affairs' | 'admin';
  onGoToLogin: () => void;
}> = ({ role, onGoToLogin }) => {
  const titles = {
    homeroom: 'Menu Wali Kelas Terkunci',
    student_affairs: 'Menu Kesiswaan Terkunci',
    admin: 'Menu Administrator Terkunci',
  };
  const descriptions = {
    homeroom: 'Akses Wali Kelas hanya dibuka melalui Menu Awal Login dengan memilih peran Wali Kelas.',
    student_affairs: 'Akses Kesiswaan hanya dibuka melalui Menu Awal Login dengan memilih peran Kesiswaan.',
    admin: 'Akses Administrator hanya dibuka melalui Menu Awal Login dengan memilih peran Admin.',
  };

  return (
    <div className="p-6 max-w-md mx-auto text-center my-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
      <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 mb-3.5">
        <Lock className="w-6 h-6" />
      </div>
      <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">
        {titles[role]}
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
        {descriptions[role]}
      </p>
      <button
        onClick={onGoToLogin}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition-colors shadow-xs"
      >
        <Lock className="w-3.5 h-3.5" />
        <span>Masuk Lewat Menu Awal Login</span>
      </button>
    </div>
  );
};

const MainAppContent: React.FC = () => {
  const {
    session,
    activeTab,
    setActiveTab,
    logout,
    toasts,
    dismissToast,
    isInitialLoading,
    configError,
    appsScriptUrl,
    appsScriptSecretConfigured,
    confirmDialog,
    saveStatus,
    conflictPrompt,
  } = useApp();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  if (!session) {
    return <DutyLoginScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Sidebar Navigation */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {/* Main Body Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        <Header onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

        {!isInitialLoading && (configError || !appsScriptUrl || !appsScriptSecretConfigured) && (
          <div className="bg-rose-600 text-white px-4 py-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-rose-700">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <strong>Koneksi Apps Script Perlu Diperiksa:</strong>{' '}
                {configError || 'URL Web App atau SECRET_TOKEN belum diatur di perangkat ini.'}
              </span>
            </div>
            {session?.lockedMenuRole === 'admin' && activeTab !== 'system_check' && (
              <button
                type="button"
                onClick={() => setActiveTab('system_check')}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white text-rose-700 font-bold hover:bg-rose-50 shrink-0 self-start sm:self-center"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Buka Cek Sistem</span>
              </button>
            )}
          </div>
        )}

        <OfflineIndicatorBanner />

        <main className="flex-1 pb-12">
          <Suspense fallback={<ViewLoadingSkeleton />}>
            {activeTab === 'dashboard' && <DashboardView />}
            {activeTab === 'attendance' && <AttendanceView />}
            {activeTab === 'out_of_class' && <OutOfClassView />}
            {activeTab === 'violations' && <ViolationsView />}
            {activeTab === 'system_check' && <SystemCheckView />}
            {activeTab === 'homeroom' &&
              (session?.lockedMenuRole === 'homeroom' ? (
                <HomeroomView />
              ) : (
                <LockedRolePlaceholder role="homeroom" onGoToLogin={logout} />
              ))}
            {activeTab === 'student_affairs' &&
              (session?.lockedMenuRole === 'student_affairs' ? (
                <StudentAffairsView />
              ) : (
                <LockedRolePlaceholder role="student_affairs" onGoToLogin={logout} />
              ))}
            {activeTab === 'admin' &&
              (session?.lockedMenuRole === 'admin' ? (
                <AdminView />
              ) : (
                <LockedRolePlaceholder role="admin" onGoToLogin={logout} />
              ))}
          </Suspense>
        </main>
      </div>

      {/* Live Floating Write Status Indicator */}
      {saveStatus.state !== 'idle' && (
        <div className="fixed bottom-4 left-4 lg:left-68 z-50 pointer-events-none">
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg border text-xs font-semibold ${
              saveStatus.state === 'saving'
                ? 'bg-sky-900 text-white border-sky-700'
                : saveStatus.state === 'saved'
                ? 'bg-emerald-900 text-white border-emerald-700'
                : 'bg-rose-900 text-white border-rose-700'
            }`}
          >
            {saveStatus.state === 'saving' && <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-300" />}
            {saveStatus.state === 'saved' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />}
            {saveStatus.state === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-300" />}
            <span>{saveStatus.message}</span>
          </div>
        </div>
      )}

      {/* Optimistic Locking Conflict Warning Modal (409 Conflict) */}
      {conflictPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{conflictPrompt.title}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {conflictPrompt.message}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={conflictPrompt.onReloadLatest}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Pakai Data Terbaru dari Sheet
              </button>
              <button
                type="button"
                onClick={conflictPrompt.onForceOverwrite}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
              >
                Timpa Dengan Data Saya
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Confirmation Dialog (Destructive/Mutating Actions) */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-full shrink-0 ${
                  confirmDialog.variant === 'warning'
                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                    : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                }`}
              >
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{confirmDialog.title}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {confirmDialog.message}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={confirmDialog.onCancel}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {confirmDialog.cancelLabel || 'Batal'}
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold text-white shadow-xs ${
                  confirmDialog.variant === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {confirmDialog.confirmLabel || 'Ya, Lanjutkan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 p-3 rounded-lg shadow-lg border text-xs animate-in slide-in-from-bottom-2 duration-150 ${
              toast.type === 'success'
                ? 'bg-emerald-900 text-white border-emerald-700'
                : toast.type === 'error'
                ? 'bg-rose-900 text-white border-rose-700'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
              {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
              {toast.type === 'info' && <Info className="w-4 h-4 text-sky-400 shrink-0" />}
              <span className="leading-tight">{toast.message}</span>
            </div>
            <button onClick={() => dismissToast(toast.id)} className="text-white/70 hover:text-white shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainAppContent />
    </AppProvider>
  );
}
