import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  api: {
    listCalendarEvents: vi.fn().mockResolvedValue([]),
    detectReminders: vi.fn().mockResolvedValue({ reminders: [], count: 0 }),
  },
  openSocket: vi.fn(),
}));

import FinanceTracker from './FinanceTracker';
import KanbanBoard from './KanbanBoard';
import CalendarView from './CalendarView';

afterEach(cleanup);

describe('FinanceTracker (NX-BUG-001)', () => {
  it('shows no invented figures when the summary is missing', () => {
    render(<FinanceTracker workspaceId="w" financeSummary={null} transactions={[]} />);
    const text = document.body.textContent;
    for (const fake of ['125,000', '45,000', '18,500']) expect(text).not.toContain(fake);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('shows the real figures it is given', () => {
    render(
      <FinanceTracker
        workspaceId="w"
        financeSummary={{ cash_balance: 3500, total_income: 5000, total_expenses: 1500, net_burn_rate: 0, runway_months: null }}
        transactions={[]}
      />
    );
    expect(document.body.textContent).toContain('$3,500.00');
    expect(document.body.textContent).toContain('$5,000.00');
  });
});

describe('KanbanBoard (NX-BUG-006)', () => {
  it('shows every task, including ones in review', () => {
    const tasks = ['todo', 'in_progress', 'review', 'done'].map((status, i) => ({
      id: `t${i}`,
      title: `Task ${status}`,
      status,
      priority: 'medium',
      position: i,
    }));
    render(<KanbanBoard workspaceId="w" tasks={tasks} onRefreshTasks={() => {}} />);
    for (const task of tasks) expect(screen.getAllByText(task.title).length).toBeGreaterThan(0);
    expect(screen.getByText('All Columns').parentElement.textContent).toContain('4');
  });
});

describe('CalendarView (NX-BUG-002)', () => {
  it('shows only API suggestions, with an empty state when there are none', async () => {
    render(<CalendarView workspaceId="w" user={{ id: 'u' }} sessions={[]} />);
    await waitFor(() => expect(screen.getByText(/Nothing to schedule right now/)).toBeTruthy());
    expect(document.body.textContent).not.toContain('Team sync on system architecture');
    expect(document.body.textContent).not.toContain('Security patch & authorization token audit');
  });
});

describe('FilePreview (in-app file viewer)', () => {
  it('shows PDFs in a viewer and never renders SVG or other active content', async () => {
    const { api } = await import('../api');
    const { default: FilePreview } = await import('./FilePreview');
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    globalThis.URL.revokeObjectURL = vi.fn();
    api.fetchFileBlob = vi.fn(async (_w, _f, type) => new Blob(['x'], { type }));

    api.getFilePreview = vi.fn().mockResolvedValue({ kind: 'pdf', text: null });
    const { unmount } = render(<FilePreview workspaceId="w" file={{ id: 'f1', filename: 'report.pdf', mime_type: 'application/pdf' }} />);
    const frame = await screen.findByTitle('Preview of report.pdf');
    expect(frame.getAttribute('src')).toBe('blob:preview');
    expect(api.fetchFileBlob).toHaveBeenCalledWith('w', 'f1', 'application/pdf');
    unmount();

    api.fetchFileBlob.mockClear();
    api.getFilePreview = vi.fn().mockResolvedValue({ kind: 'none', text: null });
    render(<FilePreview workspaceId="w" file={{ id: 'f2', filename: 'logo.svg', mime_type: 'image/svg+xml' }} />);
    expect(await screen.findByText(/can't be previewed/)).toBeTruthy();
    expect(api.fetchFileBlob).not.toHaveBeenCalled();
  });

  it('shows Word/Markdown as formatted text', async () => {
    const { api } = await import('../api');
    const { default: FilePreview } = await import('./FilePreview');
    api.getFilePreview = vi.fn().mockResolvedValue({ kind: 'markdown', text: '# Hiring Plan\n\nOpen **two** roles' });
    render(<FilePreview workspaceId="w" file={{ id: 'f3', filename: 'plan.docx', mime_type: 'application/octet-stream' }} />);
    expect(await screen.findByText('Hiring Plan')).toBeTruthy();
    expect(document.querySelector('article h1')).toBeNull(); // headings start at h2 inside the preview
    expect(document.querySelector('article strong').textContent).toBe('two');
  });
});

describe('Docs library (one item per page)', () => {
  it('lists each page once, folds its original upload into it, and keeps other files', async () => {
    const { buildLibrary } = await import('./FileManager');
    const documents = [
      { id: 'd1', title: 'Launch Plan', updated_at: '2026-10-23T10:00:00' },
      { id: 'd2', title: 'Notes', updated_at: '2026-10-23T09:00:00' },
    ];
    const files = [
      { id: 'f1', filename: 'Launch Plan.docx', document_id: 'd1', created_at: '2026-10-23T08:00:00' },
      { id: 'f2', filename: 'logo.png', document_id: null, created_at: '2026-10-23T07:00:00' },
      { id: 'f3', filename: 'call.mp3', mime_type: 'audio/mpeg', document_id: null, created_at: '2026-10-23T06:00:00' },
    ];
    const items = buildLibrary(documents, files);
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ['page', 'Launch Plan'],
      ['page', 'Notes'],
      ['image', 'logo.png'],
      ['media', 'call.mp3'],
    ]);
    expect(items[0].original.id).toBe('f1');
    expect(items[1].original).toBeNull();
  });
});

describe('MarkdownDocument', () => {
  it('renders workspace images through the signed-in API, never a raw URL', async () => {
    const { api } = await import('../api');
    const { default: MarkdownDocument } = await import('./MarkdownDocument');
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:img');
    api.fetchFileBlob = vi.fn(async () => new Blob(['x'], { type: 'image/png' }));
    render(<MarkdownDocument workspaceId="w" text={'# Title\n\n![Team photo](file:abc)\n\nSee **this**.'} />);
    const img = await screen.findByAltText('Team photo');
    expect(img.getAttribute('src')).toBe('blob:img');
    expect(api.fetchFileBlob).toHaveBeenCalledWith('w', 'abc', 'image/png');
    expect(document.querySelector('strong').textContent).toBe('this');
  });
});
