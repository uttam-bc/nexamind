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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-200">
      <div className="flex items-center gap-3">
        {onBack && (
          <button aria-label="Back to dashboard"
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 hover:border-indigo-300 rounded-xl shadow-sm transition hover:-translate-x-0.5 active:translate-x-0"
            title="Return to Dashboard"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-indigo-600" />
            <span>Back</span>
          </button>
        )}

        <div className="flex items-center gap-2">
          {Icon && (
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Icon className="w-4 h-4" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">
                {title}
              </h1>
              {badge && (
                <span className="text-xs font-mono font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                  {badge}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-slate-500 font-sans">{subtitle}</p>
            )}
          </div>
        </div>
      </div>

      {actions && <div className="flex items-center gap-2 self-end sm:self-auto">{actions}</div>}
    </div>
  );
}
