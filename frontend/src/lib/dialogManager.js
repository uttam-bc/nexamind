import { useEffect } from 'react';

// Accessible behaviour for the app's hand-built modals (WCAG 2.1.2, 2.4.3, 4.1.2).
// Any element marked `data-modal` becomes a modal dialog: it gets role/aria-modal and a name
// from its first heading, focus moves into it, Tab stays inside, Escape activates its close or
// cancel button, and focus returns to where it was when the dialog goes away.
// Dialogs built on `useDialog` (Modal, ConfirmDialog, the sign-in dialog) are not marked and
// manage themselves.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CLOSE_TEXT = /^(cancel|close|✕|×|x|done)$/i;

let headingCounter = 0;
const previousFocus = new WeakMap();

function visibleFocusables(node) {
  return Array.from(node.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function findCloseControl(node) {
  const explicit = node.querySelector('[data-modal-close]');
  if (explicit) return explicit;
  const buttons = Array.from(node.querySelectorAll('button'));
  return (
    buttons.find((b) => /close|cancel|dismiss/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''}`)) ||
    buttons.find((b) => CLOSE_TEXT.test(b.textContent.trim())) ||
    buttons.find((b) => b.querySelector('svg.lucide-x') && !b.textContent.trim()) ||
    null
  );
}

export function initDialog(node) {
  if (node.dataset.modalReady) return;
  node.dataset.modalReady = 'true';
  node.setAttribute('role', node.getAttribute('role') || 'dialog');
  node.setAttribute('aria-modal', 'true');
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  if (!node.hasAttribute('aria-label') && !node.hasAttribute('aria-labelledby')) {
    const heading = node.querySelector('h1, h2, h3, h4');
    if (heading) {
      if (!heading.id) heading.id = `modal-heading-${++headingCounter}`;
      node.setAttribute('aria-labelledby', heading.id);
    } else {
      node.setAttribute('aria-label', 'Dialog');
    }
  }
  const close = findCloseControl(node);
  if (close && !close.getAttribute('aria-label') && !close.textContent.trim()) {
    close.setAttribute('aria-label', 'Close dialog');
  }
  previousFocus.set(node, document.activeElement);
  setTimeout(() => {
    if (!node.isConnected || node.contains(document.activeElement)) return;
    const target = node.querySelector('[autofocus], [data-autofocus]') || visibleFocusables(node)[0] || node;
    target.focus();
  }, 0);
}

function openDialogs() {
  return Array.from(document.querySelectorAll('[data-modal]'));
}

export function useDialogManager() {
  useEffect(() => {
    const tracked = new Set();

    const scan = () => {
      const current = new Set(openDialogs());
      current.forEach((node) => {
        if (!tracked.has(node)) {
          tracked.add(node);
          initDialog(node);
        }
      });
      tracked.forEach((node) => {
        if (!current.has(node) || !node.isConnected) {
          tracked.delete(node);
          const prev = previousFocus.get(node);
          if (prev && prev.isConnected && typeof prev.focus === 'function' && openDialogs().length === 0) prev.focus();
        }
      });
    };

    const onKeyDown = (event) => {
      const dialogs = openDialogs();
      const top = dialogs[dialogs.length - 1];
      if (!top) return;
      if (event.key === 'Escape') {
        const close = findCloseControl(top);
        if (close) {
          event.preventDefault();
          close.click();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = visibleFocusables(top);
      if (items.length === 0) {
        event.preventDefault();
        top.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!top.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', onKeyDown);
    scan();
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
