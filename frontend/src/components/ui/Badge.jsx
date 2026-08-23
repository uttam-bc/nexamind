import React from 'react';

const variants = {
  default: 'bg-slate-800/60 text-slate-300 border-slate-700/60',
  indigo: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25',
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25',
};

export default function Badge({ children, variant = 'default', className = '' }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
