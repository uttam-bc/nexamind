import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatMoney } from './format';
import { findCloseControl, initDialog } from './dialogManager';

describe('formatMoney (NX-BUG-001)', () => {
  it('formats real numbers', () => {
    expect(formatMoney(5000)).toMatch(/^\$5,000\.00$/);
    expect(formatMoney(-18.5)).toMatch(/^-\$18\.50$/);
    expect(formatMoney(42, { sign: '+' })).toMatch(/^\+\$42\.00$/);
  });

  it('never invents a figure for missing or broken values', () => {
    for (const value of [undefined, null, NaN, Infinity, '125000']) {
      expect(formatMoney(value)).toBe('—');
    }
  });
});

describe('dialog manager (NX-A11Y-003)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('gives a marked panel dialog semantics and a name from its heading', async () => {
    document.body.innerHTML = `
      <button id="opener">Open</button>
      <div data-modal><h3>Add Task</h3><input id="title" /><button>Cancel</button></div>`;
    document.getElementById('opener').focus();
    const panel = document.querySelector('[data-modal]');
    initDialog(panel);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(panel.getAttribute('aria-labelledby')).textContent).toBe('Add Task');
  });

  it('finds the control Escape should activate', () => {
    document.body.innerHTML = `
      <div id="a"><button>Save</button><button>Cancel</button></div>
      <div id="b"><button aria-label="Close dialog"></button></div>
      <div id="c"><button>Save</button></div>`;
    expect(findCloseControl(document.getElementById('a')).textContent).toBe('Cancel');
    expect(findCloseControl(document.getElementById('b')).getAttribute('aria-label')).toBe('Close dialog');
    expect(findCloseControl(document.getElementById('c'))).toBeNull();
  });
});

describe('reminder cache (NX-PERF-005)', () => {
  it('shares one detection request between callers', async () => {
    vi.resetModules();
    const detectReminders = vi.fn().mockResolvedValue({ reminders: [{ id: 'r1', title: 'Retro' }] });
    vi.doMock('../api', () => ({ api: { detectReminders } }));
    const { getDetectedReminders, forgetReminder } = await import('./reminders');

    const [a, b] = await Promise.all([getDetectedReminders('ws1'), getDetectedReminders('ws1')]);
    expect(a).toEqual(b);
    await getDetectedReminders('ws1');
    expect(detectReminders).toHaveBeenCalledTimes(1);

    forgetReminder('ws1', 'r1');
    expect(await getDetectedReminders('ws1')).toEqual([]);
    await getDetectedReminders('ws1', { force: true });
    expect(detectReminders).toHaveBeenCalledTimes(2);
    vi.doUnmock('../api');
  });
});
