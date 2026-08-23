import React from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, size = 'md', footer }) {
  if (!open) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`glass-panel rounded-2xl border border-slate-700/80 w-full ${sizes[size]} shadow-2xl animate-slide-up max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 flex-shrink-0">
            <h3 className="text-base font-bold text-slate-100">{title}</h3>
            <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-slate-800/80 flex justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
