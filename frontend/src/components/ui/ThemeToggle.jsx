import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../lib/theme';
import { originOf } from '../../lib/viewTransition';

// One button that flips light/dark. aria-pressed tells screen readers whether dark mode is on.
export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={(e) => setTheme(dark ? 'light' : 'dark', originOf(e))}
      aria-pressed={dark}
      aria-label="Dark mode"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`relative inline-flex items-center justify-center w-9 h-9 rounded-pill text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-fast press ${className}`}
    >
      <Sun
        className={`w-4 h-4 absolute transition-[transform,opacity] duration-base ease-out ${dark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'}`}
        aria-hidden="true"
      />
      <Moon
        className={`w-4 h-4 absolute transition-[transform,opacity] duration-base ease-out ${dark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'}`}
        aria-hidden="true"
      />
    </button>
  );
}
