import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, CheckSquare, FileText, Loader2, MessageSquare, Settings2, Trash2, User, Users, Video, X } from 'lucide-react';
import { api, openSocket } from '../api';
import { notify, notifyUndo } from '../context/ToastContext';
import { mergeNotifications, timeAgo } from '../lib/notifications';

const CATEGORY_LABELS = {
  meetings: 'Meetings (invites, changes, reminders)',
  tasks: 'Tasks (assigned, due, completed)',
  messages: 'Direct messages and @mentions',
  mom: 'Meeting minutes',
};
const CATEGORY_ICONS = { meetings: Video, tasks: CheckSquare, messages: MessageSquare, mom: FileText };
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

export default function NotificationBell({ onNavigate, workspaces = [], placement = 'header' }) {
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
  // Deleted but still undoable: hidden locally, sent to the server when the Undo toast closes.
  const pendingDismiss = useRef(new Set());

  const visible = (list) => list.filter((n) => !pendingDismiss.current.has(n.id));

  const refresh = useCallback(async () => {
    try {
      const data = await api.listNotifications({ limit: 20 });
      data.items.forEach((n) => knownIds.current.add(n.id));
      setItems((prev) => visible(mergeNotifications(prev, data.items)));
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

  // Delete with Undo: the item disappears now and is dismissed on the server once the toast closes.
  const remove = (n) => {
    pendingDismiss.current.add(n.id);
    const index = items.findIndex((x) => x.id === n.id);
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.read_at) setUnread((u) => Math.max(0, u - 1));
    notifyUndo('Notification deleted', {
      onUndo: () => {
        pendingDismiss.current.delete(n.id);
        setItems((prev) => {
          const next = prev.filter((x) => x.id !== n.id);
          next.splice(Math.min(index, next.length), 0, n);
          return next;
        });
        if (!n.read_at) setUnread((u) => u + 1);
      },
      onCommit: async () => {
        try {
          const res = await api.dismissNotification(n.id);
          setUnread(res.unread_count);
        } catch (err) {
          if (err.status !== 404) {
            notify(err.message || 'Could not delete the notification', 'error');
            pendingDismiss.current.delete(n.id);
            refresh();
            return;
          }
        }
        pendingDismiss.current.delete(n.id);
      },
    });
  };

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    try {
      const data = await api.listNotifications({ limit: 20, before: last.created_at });
      setItems((prev) => visible(mergeNotifications(prev, data.items)));
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

  // Which workspace a notification belongs to, from real workspace data (not its text).
  const workspaceOf = (n) => {
    const id = n.workspace_id || n.link?.workspace_id;
    return id ? workspaces.find((w) => w.id === id) : null;
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
        className="relative text-slate-500 hover:bg-slate-100 hover:text-slate-900 p-2.5 rounded-pill transition-colors duration-fast"
      >
        <Bell className="w-4 h-4" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[1.05rem] h-[1.05rem] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white" data-testid="unread-count">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={`fixed bg-white border border-slate-200 rounded-2xl shadow-panel z-[70] flex flex-col max-h-[75vh] text-slate-900 animate-scale-in ${
            placement === 'sidebar'
              ? 'left-[15.5rem] bottom-4 w-[25rem] origin-bottom-left'
              : 'left-2 right-2 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[25rem] origin-top-right'
          }`}
        >
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="font-bold text-sm">{showPrefs ? 'Notification settings' : 'Notifications'}</h2>
            <div className="flex items-center gap-1">
              {!showPrefs && unread > 0 && (
                <button type="button" onClick={markAll} className="text-xs font-bold text-indigo-700 hover:bg-indigo-50 px-2.5 py-1 rounded-pill flex items-center gap-1 transition-colors duration-fast">
                  <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" /> Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => (showPrefs ? setShowPrefs(false) : openPrefs())}
                aria-label={showPrefs ? 'Back to notifications' : 'Notification settings'}
                className="p-1.5 rounded-pill text-slate-500 hover:bg-slate-100 transition-colors duration-fast"
              >
                {showPrefs ? <X className="w-4 h-4" aria-hidden="true" /> : <Settings2 className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
          </div>

          {showPrefs ? (
            <div className="p-4 space-y-3">
              {!prefs ? (
                <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" aria-label="Loading" />
              ) : (
                Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                    <span>{label}</span>
                    <input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={prefs[key] !== false} onChange={() => togglePref(key)} />
                  </label>
                ))
              )}
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <div className="p-4 space-y-3" role="status" aria-label="Loading notifications">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-3">
                      <div className="skeleton w-8 h-8 shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="skeleton h-3 w-3/4" />
                        <div className="skeleton h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error && !items.length ? (
                <p className="p-6 text-sm text-center text-rose-700">
                  {error}{' '}
                  <button type="button" onClick={refresh} className="underline font-bold">
                    Retry
                  </button>
                </p>
              ) : items.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-11 h-11 mx-auto mb-3 rounded-2xl bg-slate-100 flex items-center justify-center">
                    <Bell className="w-5 h-5 text-slate-500" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800">You're all caught up</p>
                  <p className="text-xs text-slate-500 mt-1">Invites, mentions and task updates show up here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {items.map((n) => {
                    const ws = workspaceOf(n);
                    const solo = ws?.type === 'personal';
                    const Icon = CATEGORY_ICONS[n.category] || Bell;
                    return (
                      <li key={n.id} className={`group relative flex ${n.read_at ? '' : 'bg-indigo-50/60'}`}>
                        <button
                          type="button"
                          onClick={() => select(n)}
                          className="flex-1 min-w-0 text-left pl-4 pr-12 py-3 flex gap-3 hover:bg-slate-50 transition-colors duration-fast"
                        >
                          <span
                            className={`relative w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                              ws ? (solo ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700') : 'bg-slate-100 text-slate-600'
                            }`}
                            aria-hidden="true"
                          >
                            <Icon className="w-4 h-4" />
                            {!n.read_at && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-indigo-600 ring-2 ring-white" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm break-words ${n.read_at ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title}</span>
                            {n.body && <span className="block text-xs text-slate-500 line-clamp-2 break-words mt-0.5">{n.body}</span>}
                            <span className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500">
                              {ws && (
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-pill font-semibold ${
                                    solo ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'
                                  }`}
                                >
                                  {solo ? <User className="w-3 h-3" aria-hidden="true" /> : <Users className="w-3 h-3" aria-hidden="true" />}
                                  <span className="max-w-[9rem] truncate">{solo ? 'Solo' : ws.name}</span>
                                </span>
                              )}
                              <span>{timeAgo(n.created_at)}</span>
                            </span>
                          </span>
                          {!n.read_at && <span className="sr-only">Unread</span>}
                        </button>
                        {/* A sibling of the main button, so deleting never opens the notification. */}
                        <button
                          type="button"
                          onClick={() => remove(n)}
                          aria-label={`Delete notification: ${n.title}`}
                          title="Delete"
                          className="absolute right-2 top-2.5 p-2 rounded-pill text-slate-400 hover:text-rose-700 hover:bg-rose-50 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color] duration-fast"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {hasMore && (
                <button type="button" onClick={loadMore} className="w-full py-2.5 text-xs font-bold text-indigo-700 hover:bg-slate-50 border-t border-slate-100">
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
