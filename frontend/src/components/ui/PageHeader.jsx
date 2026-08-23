import React from 'react';

export default function PageHeader({ title, description, actions, accent = 'indigo' }) {
  const accentClass = accent === 'solo' ? 'text-solo' : 'text-indigo-400';
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
      <div>
        <h2 className={`text-xl font-bold text-slate-100 tracking-tight ${accentClass}`}>{title}</h2>
        {description && <p className="text-sm text-slate-400 mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
