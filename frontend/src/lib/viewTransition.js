// The "room" transition: when the workspace (Solo/Group) or the theme changes, the new look spreads
// out in a circle from the control that was pressed. It uses the browser's View Transitions API: the
// browser snapshots the page, we apply the change synchronously, and CSS (index.css, .vt-room) clips
// the new snapshot open from the click point. Browsers without the API, and people who prefer reduced
// motion, simply get the change instantly.
import { flushSync } from 'react-dom';

let running = null;

export function roomTransition(origin, update) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) {
    update();
    return;
  }
  // A second press while one is running finishes the first immediately (interruptible).
  running?.skipTransition?.();

  const root = document.documentElement;
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  // Radius that reaches the farthest corner from the click point.
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${r}px`);
  root.classList.add('vt-room');

  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  running = transition;
  transition.finished.finally(() => {
    if (running === transition) {
      root.classList.remove('vt-room');
      running = null;
    }
  });
}

// Where a pointer click happened. Keyboard presses (event.detail === 0) return null: actions taken
// from the keyboard are repeated often and change instantly, without the reveal.
export function originOf(event) {
  if (!event || event.detail === 0) return null;
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  const r = event.currentTarget?.getBoundingClientRect?.();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}
