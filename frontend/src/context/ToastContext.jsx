import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, type = 'info', duration = 4000) => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, type }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      const id = ++toastId;
      setToasts((prev) => [
        ...prev,
        {
          id,
          message,
          type: 'confirm',
          title: options.title || 'Confirm',
          confirmLabel: options.confirmLabel || 'Confirm',
          cancelLabel: options.cancelLabel || 'Cancel',
          variant: options.variant || 'danger',
          onConfirm: () => {
            dismiss(id);
            resolve(true);
          },
          onCancel: () => {
            dismiss(id);
            resolve(false);
          },
        },
      ]);
    });
  }, [dismiss]);

  const value = {
    toast,
    success: (msg) => toast(msg, 'success'),
    error: (msg) => toast(msg, 'error', 6000),
    info: (msg) => toast(msg, 'info'),
    confirm,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) =>
          t.type === 'confirm' ? (
            <div
              key={t.id}
              className="pointer-events-auto glass-panel rounded-2xl border border-slate-700/80 p-4 shadow-2xl animate-slide-up"
            >
              <p className="text-sm font-semibold text-slate-100 mb-1">{t.title}</p>
              <p className="text-xs text-slate-400 mb-4">{t.message}</p>
              <div className="flex justify-end gap-2">
                <button onClick={t.onCancel} className="btn-ghost text-xs px-3 py-1.5">
                  {t.cancelLabel}
                </button>
                <button
                  onClick={t.onConfirm}
                  className={`text-xs font-semibold px-4 py-1.5 rounded-xl transition ${
                    t.variant === 'danger'
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'btn-primary py-1.5'
                  }`}
                >
                  {t.confirmLabel}
                </button>
              </div>
            </div>
          ) : (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 glass-panel rounded-xl border p-3.5 shadow-xl animate-slide-up ${
                t.type === 'error'
                  ? 'border-rose-500/30'
                  : t.type === 'success'
                  ? 'border-emerald-500/30'
                  : 'border-slate-700/80'
              }`}
            >
              {t.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />}
              {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />}
              {t.type === 'info' && <Info className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />}
              <p className="text-xs text-slate-200 flex-1 leading-relaxed">{t.message}</p>
              <button onClick={() => dismiss(t.id)} className="text-slate-500 hover:text-slate-300 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
