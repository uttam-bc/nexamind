import React, { useState } from 'react';
import { X } from 'lucide-react';
import { nextDialogId, useDialog } from '../../lib/dialog';

export default function Modal({ open, onClose, title, children, size = 'md', footer, className = '', panelClassName }) {
  const ref = useDialog(open, onClose);
  const [titleId] = useState(() => nextDialogId('modal-title'));
  if (!open) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 animate-fade-in ${className}`}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        tabIndex={-1}
        className={
          panelClassName ||
          `bg-white rounded-2xl border border-slate-200 w-full ${sizes[size]} shadow-panel animate-scale-in max-h-[90vh] flex flex-col outline-none`
        }
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
            <h2 id={titleId} className="text-base font-bold text-slate-900">{title}</h2>
            <button type="button" onClick={onClose} className="btn-ghost p-1.5 rounded-lg" aria-label="Close dialog">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
