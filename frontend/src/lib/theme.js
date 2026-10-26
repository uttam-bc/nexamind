// Light/dark theme. index.html applies the saved (or system) theme before the first paint so the page
// never flashes the wrong colours; this module reads and changes it afterwards.
import { useEffect, useState } from 'react';
import { roomTransition } from './viewTransition';

const KEY = 'nexamind-theme'; // 'light' | 'dark'; absent = follow the system setting
const EVENT = 'nexamind:theme';

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function savedTheme() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function apply(theme, animate, origin) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  const change = () => {
    root.dataset.theme = theme;
    window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
  };
  // A click reveals the new theme from the toggle; a keyboard press changes it at once; a change of
  // the system setting cross-fades quietly.
  if (animate && origin) roomTransition(origin, change);
  else if (origin === null) change();
  else if (animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 320);
    change();
  } else change();
}

export function setTheme(theme, origin = null) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  apply(theme, true, origin);
}

// Without a saved choice the theme keeps following the operating system.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!savedTheme()) apply(systemTheme(), true);
  });
}

export function useTheme() {
  const [theme, setState] = useState(currentTheme);
  useEffect(() => {
    const onChange = (e) => setState(e.detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return [theme, setTheme];
}
