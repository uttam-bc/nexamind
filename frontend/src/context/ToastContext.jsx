import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useDialog } from '../lib/dialog';

const ToastContext = createContext(null);

let toastId = 0;

// Module-level handles so plain event handlers can show messages without threading the hook
// through every component. They replace the browser's blocking alert()/confirm().
let activeApi = null;

export function notify(message, type = 'info') {
  if (activeApi) activeApi.toast(message, type, type === 'error' ? 6000 : 4000);
}

export function confirmDialog(message, options = {}) {
  if (!activeApi) return Promise.resolve(false);
  return activeApi.confirm(message, options);
}

function ConfirmDialog({ request, onResolve }) {
  const ref = useDialog(true, () => onResolve(false));
  const danger = request.variant === 'danger';
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={() => onResolve(false)}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`confirm-title-${request.id}`}
        aria-describedby={`confirm-desc-${request.id}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-5 shadow-2xl outline-none animate-slide-up"
      >
        <h2 id={`confirm-title-${request.id}`} className="text-sm font-bold text-slate-900 mb-1">{request.title}</h2>
        <p id={`confirm-desc-${request.id}`} className="text-sm text-slate-600 mb-5">{request.message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-autofocus
            onClick={() => onResolve(false)}
            className="text-sm font-semibold px-3.5 py-2 rounded-xl text-slate-700 hover:bg-slate-100 border border-slate-200"
          >
            {request.cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className={`text-sm font-semibold px-4 py-2 rounded-xl text-white transition ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmQueue, setConfirmQueue] = useState([]);

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
      setConfirmQueue((prev) => [
        ...prev,
        {
          id,
          message,
          title: options.title || 'Are you sure?',
          confirmLabel: options.confirmLabel || 'Confirm',
          cancelLabel: options.cancelLabel || 'Cancel',
          variant: options.variant || 'danger',
          resolve,
        },
      ]);
    });
  }, []);

  const resolveConfirm = useCallback((request, result) => {
    setConfirmQueue((prev) => prev.filter((r) => r.id !== request.id));
    request.resolve(result);
  }, []);

  const value = useMemo(
    () => ({
      toast,
      success: (msg) => toast(msg, 'success'),
      error: (msg) => toast(msg, 'error', 6000),
      info: (msg) => toast(msg, 'info'),
      confirm,
    }),
    [toast, confirm]
  );

  useEffect(() => {
    activeApi = value;
    return () => {
      if (activeApi === value) activeApi = null;
    };
  }, [value]);

  const currentConfirm = confirmQueue[0];

  return (
    <ToastContext.Provider value={value}>
      {children}
      {currentConfirm && (
        <ConfirmDialog
          key={currentConfirm.id}
          request={currentConfirm}
          onResolve={(result) => resolveConfirm(currentConfirm, result)}
        />
      )}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 bg-white rounded-xl border p-3.5 shadow-xl animate-slide-up ${
              t.type === 'error'
                ? 'border-rose-300'
                : t.type === 'success'
                ? 'border-emerald-300'
                : 'border-slate-200'
            }`}
          >
            {t.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" aria-hidden="true" />}
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" aria-hidden="true" />}
            {t.type === 'info' && <Info className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" aria-hidden="true" />}
            <p className="text-sm text-slate-800 flex-1 leading-relaxed">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-slate-500 hover:text-slate-800 flex-shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
