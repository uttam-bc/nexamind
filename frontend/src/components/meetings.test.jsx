import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getNotificationPrefs: vi.fn(),
  setNotificationPrefs: vi.fn(),
  listMeetings: vi.fn(),
  getWorkspaceMembers: vi.fn(),
  scheduleMeeting: vi.fn(),
}));
vi.mock('../api', () => ({
  api,
  openSocket: () => {
    const ws = new EventTarget();
    ws.close = () => {};
    ws.send = () => {};
    return ws;
  },
}));
vi.mock('../context/ToastContext', () => ({ notify: vi.fn(), confirmDialog: vi.fn().mockResolvedValue(true) }));

import NotificationBell from './NotificationBell';
import { EndDialog, gridClass, describeMediaError, formatDuration } from './meetings/MeetingRoom';
import Meetings from './Meetings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('End meeting dialog', () => {
  it('offers the host "End for me" and "End for all"', () => {
    const onEndForAll = vi.fn();
    const onEndForMe = vi.fn();
    render(<EndDialog isHost onEndForMe={onEndForMe} onEndForAll={onEndForAll} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('End for all'));
    fireEvent.click(screen.getByText('End for me'));
    expect(onEndForAll).toHaveBeenCalledTimes(1);
    expect(onEndForMe).toHaveBeenCalledTimes(1);
  });

  it('gives participants only a leave confirmation', () => {
    render(<EndDialog isHost={false} onEndForMe={() => {}} onEndForAll={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText('End for all')).toBeNull();
    expect(screen.getByText('Leave meeting')).toBeTruthy();
  });

  it('disables the buttons while ending, so it is not sent twice', () => {
    render(<EndDialog isHost busy onEndForMe={() => {}} onEndForAll={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Ending…').closest('button').disabled).toBe(true);
  });
});

describe('meeting helpers', () => {
  it('lays tiles out by participant count', () => {
    expect(gridClass(1)).toBe('grid-cols-1');
    expect(gridClass(2)).toContain('sm:grid-cols-2');
    expect(gridClass(6)).toContain('md:grid-cols-3');
  });
  it('explains device errors', () => {
    expect(describeMediaError({ name: 'NotAllowedError' }, 'Camera')).toMatch(/blocked/);
    expect(describeMediaError({ name: 'NotReadableError' }, 'Camera')).toMatch(/another app/);
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('NotificationBell', () => {
  it('shows the unread count, opens the list and marks everything read', async () => {
    api.listNotifications.mockResolvedValue({
      items: [
        { id: 'n1', title: 'Priya invited you to “Sync”', created_at: new Date().toISOString(), read_at: null, link: { tab: 'meetings', meeting_id: 'm1' } },
        { id: 'n2', title: 'Old one', created_at: '2026-01-01T00:00:00Z', read_at: '2026-01-02T00:00:00Z' },
      ],
      unread_count: 1,
      has_more: false,
    });
    api.markAllNotificationsRead.mockResolvedValue({ unread_count: 0 });
    api.markNotificationsRead.mockResolvedValue({ unread_count: 0 });
    const onNavigate = vi.fn();
    render(<NotificationBell onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('unread-count').textContent).toBe('1'));
    fireEvent.click(screen.getByLabelText('Notifications, 1 unread'));
    fireEvent.click(screen.getByText('Priya invited you to “Sync”'));
    expect(api.markNotificationsRead).toHaveBeenCalledWith(['n1']);
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'meetings', meeting_id: 'm1' });
  });

  it('says so when there is nothing', async () => {
    api.listNotifications.mockResolvedValue({ items: [], unread_count: 0, has_more: false });
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => expect(screen.getByText("You're all caught up.")).toBeTruthy());
  });
});

describe('Meetings lobby', () => {
  it('shows only real meetings from the API (no placeholders)', async () => {
    api.listMeetings.mockResolvedValue([]);
    api.getWorkspaceMembers.mockResolvedValue([]);
    render(<Meetings workspaceId="w" workspace={{ type: 'team' }} user={{ id: 'u', name: 'U' }} sessions={[]} />);
    await waitFor(() => expect(screen.getByText('No meetings scheduled.')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/ROOM-|Participant 2|John|Sarah/);
  });

  it('refuses to schedule without a date and sends one request id per dialog', async () => {
    api.listMeetings.mockResolvedValue([]);
    api.getWorkspaceMembers.mockResolvedValue([]);
    api.scheduleMeeting.mockImplementation(async (wid, body) => ({ ...body, id: 'm1', invitees: [], status: 'scheduled' }));
    render(<Meetings workspaceId="w" workspace={{ type: 'team' }} user={{ id: 'u', name: 'U' }} sessions={[]} />);
    fireEvent.click(await screen.findByText('Schedule one'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Planning' } });
    fireEvent.submit(screen.getByRole('dialog'));
    expect(await screen.findByText('Pick a date and time.')).toBeTruthy();
    expect(api.scheduleMeeting).not.toHaveBeenCalled();

    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: tomorrow } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.submit(screen.getByRole('dialog'));
    await waitFor(() => expect(api.scheduleMeeting).toHaveBeenCalledTimes(1));
    const body = api.scheduleMeeting.mock.calls[0][1];
    expect(body.title).toBe('Planning');
    expect(body.client_request_id).toMatch(/^[0-9a-f]{16,}$/);
    expect(body.scheduled_start).toMatch(/^\d{4}-\d{2}-\d{2}T10:00:00[+-]\d{2}:\d{2}$/);
  });
});

describe('In-call chat replies', () => {
  const messages = [
    { id: 'm1', client_message_id: 'c1', sender_id: 'u2', sender_name: 'Priya', content: 'Can someone share the deck?', created_at: '2026-10-25T10:00:00Z' },
    { id: 'm2', client_message_id: 'c2', sender_id: 'u1', sender_name: 'Asha', content: 'Sharing now', created_at: '2026-10-25T10:01:00Z',
      reply_to_id: 'm1', reply_to: { id: 'm1', sender_name: 'Priya', excerpt: 'Can someone share the deck?', available: true } },
    { id: 'm3', client_message_id: 'c3', sender_id: 'u2', sender_name: 'Priya', content: 'Thanks', created_at: '2026-10-25T10:02:00Z',
      reply_to_id: 'gone', reply_to: { id: 'gone', available: false } },
  ];

  it('replies to a specific message, shows the preview and can cancel it', async () => {
    const { ChatPanel } = await import('./meetings/MeetingRoom');
    window.HTMLElement.prototype.scrollIntoView = () => {};
    const onSend = vi.fn();
    render(<ChatPanel messages={messages} userId="u1" onSend={onSend} />);
    fireEvent.click(screen.getAllByLabelText('Reply to Priya')[0]);
    expect(screen.getByTestId('reply-preview').textContent).toContain('Replying to Priya');
    fireEvent.click(screen.getByLabelText('Cancel reply'));
    expect(screen.queryByTestId('reply-preview')).toBeNull();

    fireEvent.click(screen.getAllByText('Reply')[0]);
    fireEvent.change(screen.getByLabelText('Message everyone'), { target: { value: 'On it' } });
    fireEvent.submit(screen.getByLabelText('Message everyone').closest('form'));
    expect(onSend).toHaveBeenCalledWith('On it', expect.objectContaining({ id: 'm1', sender_name: 'Priya' }), null);
    expect(screen.queryByTestId('reply-preview')).toBeNull();
  });

  it('shows the quoted original, and an unavailable original gracefully', async () => {
    const { ChatPanel } = await import('./meetings/MeetingRoom');
    window.HTMLElement.prototype.scrollIntoView = () => {};
    render(<ChatPanel messages={messages} userId="u1" onSend={() => {}} />);
    expect(screen.getByLabelText('Replying to Priya: Can someone share the deck?')).toBeTruthy();
    expect(screen.getByText('Original message unavailable')).toBeTruthy();
  });
});
