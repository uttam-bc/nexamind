import React from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';

export default function FeatureHeader({
  title,
  subtitle,
  icon: Icon,
  onBack,
  actions,
  badge,
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 mb-5 border-b border-slate-200">
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <button
            aria-label="Back to home"
            type="button"
            onClick={onBack}
            className="group -ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors duration-fast hover:bg-slate-100 hover:text-slate-900"
            title="Back to home"
          >
            <ArrowLeft className="h-4 w-4 transition-transform duration-fast group-hover:-translate-x-0.5" aria-hidden="true" />
          </button>
        )}
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && <Icon className="h-5 w-5 shrink-0 text-indigo-600" strokeWidth={1.75} aria-hidden="true" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-[-0.01em] text-slate-900">{title}</h1>
              {badge && (
                <span className="rounded-pill bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{badge}</span>
              )}
            </div>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>
      </div>

      {actions && <div className="flex items-center gap-2 self-end sm:self-auto">{actions}</div>}
    </div>
  );
}
