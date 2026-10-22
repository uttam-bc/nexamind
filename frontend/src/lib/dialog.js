import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(node) {
  return Array.from(node.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

// Modal dialog behaviour (WCAG 2.1.2, 2.4.3): moves focus into the dialog, keeps Tab inside it,
// closes on Escape, and returns focus to whatever was focused before it opened.
export function useDialog(open, onClose) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const node = ref.current;

    const timer = setTimeout(() => {
      if (!node || node.contains(document.activeElement)) return;
      const preferred = node.querySelector('[data-autofocus]') || focusableIn(node)[0] || node;
      preferred.focus();
    }, 0);

    const onKeyDown = (event) => {
      if (!node) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(node);
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [open]);

  return ref;
}

let dialogCounter = 0;
export function nextDialogId(prefix = 'dialog') {
  dialogCounter += 1;
  return `${prefix}-${dialogCounter}`;
}
