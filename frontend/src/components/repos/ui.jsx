import React from 'react';
import { Globe, Loader2, Lock, User, X } from 'lucide-react';
import { useDialog } from '../../lib/dialog';

const VARIANTS = {
  primary: 'bg-[#4F46E5] hover:bg-[#4338CA] text-white border-transparent',
  secondary: 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300',
  danger: 'bg-white hover:bg-rose-50 text-rose-700 border-rose-300',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent',
  ghost: 'bg-transparent hover:bg-slate-100 text-slate-700 border-transparent',
};

export function Btn({ variant = 'secondary', size = 'md', busy = false, className = '', children, ...props }) {
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm' };
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed min-h-[36px] ${VARIANTS[variant]} ${sizes[size]} ${className}`}
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

const TONES = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  purple: 'bg-violet-50 text-violet-700 border-violet-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export function Badge({ tone = 'slate', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Who can see a repository: only you (personal workspace), only invited people, or the whole workspace. */
export function VisibilityBadge({ repo, personal }) {
  if (personal) return <Badge tone="amber"><User className="w-3 h-3" />Personal · only you</Badge>;
  if (repo.visibility === 'private') return <Badge tone="amber"><Lock className="w-3 h-3" />Private</Badge>;
  return <Badge><Globe className="w-3 h-3" />Workspace</Badge>;
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status">
      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> {label}…
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="text-center py-12 px-4">
      {Icon && <Icon className="w-9 h-9 text-slate-300 mx-auto mb-3" aria-hidden="true" />}
      <p className="font-semibold text-slate-800">{title}</p>
      {children && <div className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ user, size = 6 }) {
  const name = user?.name || '?';
  const dims = { 5: 'w-5 h-5 text-[10px]', 6: 'w-6 h-6 text-[11px]', 8: 'w-8 h-8 text-xs' }[size];
  if (user?.avatar_url) return <img src={user.avatar_url} alt="" className={`${dims} rounded-full object-cover shrink-0`} />;
  return (
    <span className={`${dims} rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0`} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="block text-sm font-semibold text-slate-800 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 placeholder-slate-400';

export function Panel({ children, className = '' }) {
  return <div className={`bg-white border border-slate-200 rounded-xl ${className}`}>{children}</div>;
}

/** Light dialog used by the repository screens (focus trap and Escape via useDialog). */
export function Dialog({ title, onClose, children, footer, wide = false }) {
  const ref = useDialog(true, onClose);
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col outline-none`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
