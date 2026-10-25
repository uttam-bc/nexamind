import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Loader2, Settings2, X } from 'lucide-react';
import { api, openSocket } from '../api';
import { notify } from '../context/ToastContext';
import { mergeNotifications, timeAgo } from '../lib/notifications';

const CATEGORY_LABELS = {
  meetings: 'Meetings (invites, changes, reminders)',
  tasks: 'Tasks (assigned, due, completed)',
  messages: 'Direct messages and @mentions',
  mom: 'Meeting minutes',
};
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

export default function NotificationBell({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const knownIds = useRef(new Set());

  const refresh = useCallback(async () => {
    try {
      const data = await api.listNotifications({ limit: 20 });
      data.items.forEach((n) => knownIds.current.add(n.id));
      setItems((prev) => mergeNotifications(prev, data.items));
      setUnread(data.unread_count);
      setHasMore(data.has_more);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Real-time stream; after a reconnect, re-sync whatever was missed.
  useEffect(() => {
    let ws = null;
    let attempt = 0;
    let timer = null;
    let stopped = false;
    const connect = () => {
      ws = openSocket('/ws/notifications');
      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'hello') {
          attempt = 0;
          setUnread(msg.unread_count);
          refresh();
        } else if (msg.type === 'call') {
          // Incoming call, answered, declined or ended: the call manager reacts.
          window.dispatchEvent(new CustomEvent('nexamind:call', { detail: msg }));
        } else if (msg.type === 'notification') {
          const n = msg.notification;
          if (knownIds.current.has(n.id)) return;
          knownIds.current.add(n.id);
          setItems((prev) => mergeNotifications(prev, [n]));
          setUnread((u) => u + 1);
          notify(n.title, 'info');
          window.dispatchEvent(new CustomEvent('nexamind:notification', { detail: n }));
        }
      });
      ws.addEventListener('close', (event) => {
        if (stopped || event.code === 1008) return;
        timer = setTimeout(connect, RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]);
        attempt += 1;
      });
    };
    refresh();
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [refresh]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (ids) => {
    const unreadIds = ids.filter((id) => items.find((n) => n.id === id && !n.read_at));
    if (!unreadIds.length) return;
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read_at: stamp } : n)));
    try {
      const res = await api.markNotificationsRead(unreadIds);
      setUnread(res.unread_count);
    } catch (err) {
      notify(err.message, 'error');
      refresh();
    }
  };

  const markAll = async () => {
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    setUnread(0);
    try {
      await api.markAllNotificationsRead();
    } catch (err) {
      notify(err.message, 'error');
      refresh();
    }
  };

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    try {
      const data = await api.listNotifications({ limit: 20, before: last.created_at });
      setItems((prev) => mergeNotifications(prev, data.items));
      setHasMore(data.has_more);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const openPrefs = async () => {
    setShowPrefs(true);
    if (!prefs) setPrefs(await api.getNotificationPrefs().catch(() => null));
  };

  const togglePref = async (key) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      setPrefs(await api.setNotificationPrefs({ [key]: next[key] }));
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const select = (n) => {
    markRead([n.id]);
    setOpen(false);
    if (n.link) onNavigate?.(n.link);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative text-slate-500 hover:bg-[#ECEEF0] hover:text-[#191C1E] p-2 rounded-lg transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.05rem] h-[1.05rem] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center" data-testid="unread-count">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed sm:absolute left-2 right-2 sm:left-auto sm:right-0 top-14 sm:top-full sm:mt-2 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[70] flex flex-col max-h-[75vh] text-[#191C1E]"
        >
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="font-bold text-sm">{showPrefs ? 'Notification settings' : 'Notifications'}</h2>
            <div className="flex items-center gap-1">
              {!showPrefs && unread > 0 && (
                <button type="button" onClick={markAll} className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg flex items-center gap-1">
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => (showPrefs ? setShowPrefs(false) : openPrefs())}
                aria-label={showPrefs ? 'Back to notifications' : 'Notification settings'}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                {showPrefs ? <X className="w-4 h-4" /> : <Settings2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {showPrefs ? (
            <div className="p-4 space-y-3">
              {!prefs ? (
                <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
              ) : (
                Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                    <span>{label}</span>
                    <input type="checkbox" checked={prefs[key] !== false} onChange={() => togglePref(key)} />
                  </label>
                ))
              )}
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <div className="p-6 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : error && !items.length ? (
                <p className="p-6 text-sm text-center text-rose-600">
                  {error}{' '}
                  <button type="button" onClick={refresh} className="underline font-bold">
                    Retry
                  </button>
                </p>
              ) : items.length === 0 ? (
                <p className="p-8 text-sm text-center text-slate-500">You're all caught up.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => select(n)}
                        className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 ${n.read_at ? '' : 'bg-indigo-50/50'}`}
                      >
                        <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-indigo-600'}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm break-words ${n.read_at ? 'text-slate-600' : 'font-semibold'}`}>{n.title}</span>
                          {n.body && <span className="block text-xs text-slate-500 line-clamp-2 break-words">{n.body}</span>}
                          <span className="block text-[11px] text-slate-400 mt-0.5">{timeAgo(n.created_at)}</span>
                        </span>
                        {!n.read_at && <span className="sr-only">Unread</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {hasMore && (
                <button type="button" onClick={loadMore} className="w-full py-2.5 text-xs font-bold text-indigo-600 hover:bg-slate-50 border-t border-slate-100">
                  Show older
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
