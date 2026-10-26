import React from 'react';
import { User, Users } from 'lucide-react';

// Solo / Group switch. The thumb slides to the chosen side in that workspace's colour; the change of
// room itself (accent and ground) is revealed from this control by the parent's roomTransition.
export default function WorkspaceSwitch({ isSolo, onChange, compact = false, className = '' }) {
  const item = (active) =>
    `relative z-10 flex items-center justify-center gap-1.5 rounded-pill font-semibold transition-colors duration-base ${
      compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-[13px]'
    } ${active ? 'text-white' : 'text-slate-600 hover:text-slate-900'}`;
  return (
    <div role="group" aria-label="Workspace mode" className={`relative grid grid-cols-2 rounded-pill bg-slate-100 p-1 ${className}`}>
      <span
        aria-hidden="true"
        className={`absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-pill transition-[transform,background-color] duration-panel ease-in-out ${
          isSolo ? 'translate-x-0 bg-solo-600' : 'translate-x-full bg-group-600'
        }`}
      />
      <button type="button" aria-pressed={isSolo} onClick={(e) => onChange('personal', e)} className={item(isSolo)}>
        <User className={`h-3.5 w-3.5 ${compact ? 'hidden min-[380px]:block' : ''}`} aria-hidden="true" />
        <span>Solo</span>
      </button>
      <button type="button" aria-pressed={!isSolo} onClick={(e) => onChange('team', e)} className={item(!isSolo)}>
        <Users className={`h-3.5 w-3.5 ${compact ? 'hidden min-[380px]:block' : ''}`} aria-hidden="true" />
        <span>Group</span>
      </button>
    </div>
  );
}
