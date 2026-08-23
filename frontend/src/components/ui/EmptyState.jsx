import React from 'react';

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && (
        <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-slate-500" />
        </div>
      )}
      <p className="text-sm font-semibold text-slate-300 mb-1">{title}</p>
      {description && <p className="text-xs text-slate-500 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
