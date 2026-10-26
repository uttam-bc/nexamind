import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarPlus, FileText, FolderKanban, Hash, Lock, MessageSquare, Sparkles, User, Video } from 'lucide-react';
import { api } from '../api';
import AiReminderToast from './AiReminderToast';

// Workspace home, in the Editorial-greeting layout: a serif greeting that states today's one fact,
// four count tiles, then rows whose panels share the 12-column lines (3/3/3/3, 9/3, 6/6).
const rise = (i) => ({ animationDelay: `${i * 30}ms` });
const PRIORITY = { urgent: 'Urgent', high: 'High' };
const STATUS = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done' };

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const relative = (iso) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.round(diff / 3600000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso));
};

// "2:00 PM" or "14:00" as minutes after midnight, so a day's events sort in time order.
const minutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec((t || '').trim());
  if (!m) return -1; // all-day first
  let h = Number(m[1]) % 12;
  if (!m[3]) h = Number(m[1]);
  else if (/p/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
};

const money = (n) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n || 0));

function Panel({ title, count, hideCount = false, onViewAll, viewLabel = 'View all', className = '', style, children }) {
  return (
    <section className={`rounded-2xl bg-slate-50 p-5 animate-settle ${className}`} style={style}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {count != null && !hideCount && (
          <span className="rounded-pill bg-white px-2 py-0.5 text-xs tabular-nums text-slate-600 ring-1 ring-slate-200">{count}</span>
        )}
        {onViewAll && (
          <button type="button" onClick={onViewAll} className="ml-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-slate-600 transition-colors duration-fast hover:text-slate-900">
            {viewLabel} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({ onClick, children }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="-mx-2 flex min-h-[52px] w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-fast hover:bg-white/70"
      >
        {children}
      </button>
    </li>
  );
}

// Rows sit on the panel itself, separated by hairlines.
function Rows({ children }) {
  return <ul className="divide-y divide-slate-200">{children}</ul>;
}

function LoadingRows() {
  return (
    <div className="space-y-3 py-2" role="status" aria-label="Loading">
      <div className="skeleton h-4 w-3/4" />
      <div className="skeleton h-4 w-1/2" />
      <div className="skeleton h-4 w-2/3" />
    </div>
  );
}

function Empty({ children, action }) {
  return (
    <div className="flex min-h-[126px] flex-col items-start justify-center gap-3 rounded-xl border border-dashed border-slate-300 px-4">
      <p className="text-sm text-slate-600">{children}</p>
      {action}
    </div>
  );
}

export default function Dashboard({ loading = false, workspace, user, tasks = [], channels = [], documents = [], sessions = [], financeSummary, onNavigateTab, onRefreshAll }) {
  const isSolo = workspace?.type === 'personal';
  const chatTab = isSolo ? 'solo_chat' : 'channels';
  const [events, setEvents] = useState(null);
  const [eventsVersion, setEventsVersion] = useState(0);

  // Today's calendar for the greeting and the Today panel (the rest comes from App's lists).
  useEffect(() => {
    if (!workspace?.id) return undefined;
    let cancelled = false;
    setEvents(null);
    api
      .listCalendarEvents(workspace.id)
      .then((list) => !cancelled && setEvents(Array.isArray(list) ? list : []))
      .catch(() => !cancelled && setEvents([]));
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, eventsVersion]);

  const openTasks = tasks.filter((t) => t.status !== 'done');
  const doneTasks = tasks.length - openTasks.length;
  const conversations = isSolo ? channels.filter((c) => c.is_direct) : channels.filter((c) => !c.is_direct);
  const today = localDay();
  const todays = useMemo(
    () =>
      (events || [])
        .filter((e) => (e.event_date || '').startsWith(today))
        .sort((a, b) => minutes(a.event_time) - minutes(b.event_time)),
    [events, today]
  );
  const comingUp = useMemo(() => {
    const end = new Date();
    end.setDate(end.getDate() + 7);
    const last = localDay(end);
    return (events || [])
      .filter((e) => (e.event_date || '').slice(0, 10) > today && (e.event_date || '').slice(0, 10) <= last)
      .sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '') || minutes(a.event_time) - minutes(b.event_time))
      .slice(0, 3);
  }, [events, today]);
  const dayName = (iso) => {
    const [y, m, d] = (iso || '').slice(0, 10).split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
  };
  const urgentOpen = openTasks
    .slice()
    .sort((a, b) => ['urgent', 'high', 'medium', 'low'].indexOf(a.priority) - ['urgent', 'high', 'medium', 'low'].indexOf(b.priority));
  const recentDocs = documents
    .slice()
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .slice(0, 4);
  const recentMeetings = sessions.slice(0, 4);

  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const firstName = (user?.name || '').split(' ')[0] || 'there';
  // The greeting's one fact, from today's data.
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const next = todays.find((e) => minutes(e.event_time) >= nowMinutes) || todays.find((e) => minutes(e.event_time) === -1);
  // No fact until this workspace's data has arrived: a half-loaded room must not claim anything.
  const fact = loading || events == null
    ? ''
    : next
      ? `${next.title}${next.event_time ? ` at ${next.event_time}` : ' today'}.`
      : openTasks.length
        ? `${openTasks.length} ${openTasks.length === 1 ? 'task is' : 'tasks are'} open.`
        : 'Nothing is waiting on you.';
  const dateLine = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  const runwayMonths = financeSummary?.runway_months;
  // A workspace with no money recorded has no runway to report.
  const hasFinance = !!financeSummary && (Number(financeSummary.cash_balance) !== 0 || Number(financeSummary.net_burn_rate) !== 0);
  const runway = !hasFinance ? '—' : runwayMonths == null ? 'No burn' : `${runwayMonths} mo`;

  const tiles = [
    { label: 'Open tasks', value: openTasks.length, caption: doneTasks ? `${doneTasks} done` : 'Ready when you are', tab: 'projects' },
    { label: 'Docs', value: documents.length, caption: documents.length ? `Last edit ${relative(recentDocs[0]?.updated_at).toLowerCase()}` : 'Write the first page', tab: 'documents' },
    { label: isSolo ? 'Direct chats' : 'Channels', value: conversations.length, caption: isSolo ? 'People you talk to' : 'Team conversations', tab: chatTab },
    {
      label: 'Runway',
      value: runway,
      caption: hasFinance ? `${money(financeSummary.cash_balance)} cash · ${money(financeSummary.net_burn_rate)}/mo` : 'Add transactions in Finance',
      tab: 'finance',
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1100px] pb-10 pt-2 md:pt-6">
      <header className="animate-settle">
        <h1 className="font-serif text-[2.5rem] leading-[1.05] tracking-[-0.01em] text-slate-900 sm:text-5xl">
          {hello}, {firstName}.{' '}
          {fact && <span className="text-slate-500 animate-fade-in">{fact}</span>}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          <span>{dateLine}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5 text-indigo-700">
            {isSolo ? <User className="h-3.5 w-3.5" aria-hidden="true" /> : <Hash className="h-3.5 w-3.5" aria-hidden="true" />}
            {workspace?.name || (isSolo ? 'Solo workspace' : 'Group workspace')}
          </span>
        </p>
      </header>

      <div className="mt-10 grid grid-cols-12 gap-4">
        {tiles.map((t, i) => (
          <button
            key={t.label}
            type="button"
            onClick={() => onNavigateTab(t.tab)}
            style={rise(i + 1)}
            className="col-span-6 flex h-32 flex-col justify-between rounded-2xl bg-slate-50 p-4 text-left animate-settle transition-colors duration-fast hover:bg-slate-100 lg:col-span-3"
          >
            <span className="text-[13px] text-slate-600">{t.label}</span>
            {loading ? (
              <span className="skeleton block h-8 w-14" aria-label="Loading" />
            ) : (
              <span className="text-[32px] leading-none tabular-nums text-slate-900">{t.value}</span>
            )}
            <span className="truncate text-xs text-slate-500">{loading ? ' ' : t.caption}</span>
          </button>
        ))}

        <Panel
          title="Today"
          count={events ? todays.length : null}
          onViewAll={() => onNavigateTab('calendar')}
          viewLabel="Calendar"
          className="col-span-12 lg:col-span-9"
          style={rise(5)}
        >
          {events == null ? (
            <div className="space-y-2" role="status" aria-label="Loading today's schedule">
              <div className="skeleton h-[63px]" />
              <div className="skeleton h-[63px]" />
            </div>
          ) : todays.length === 0 ? (
            <Empty
              action={
                <button type="button" onClick={() => onNavigateTab('calendar')} className="btn-secondary text-xs">
                  <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add an event
                </button>
              }
            >
              Nothing on the calendar today.
            </Empty>
          ) : (
            <Rows>
              {todays.slice(0, 4).map((e) => (
                <Row key={e.id} onClick={() => onNavigateTab(e.meeting_id ? 'meetings' : 'calendar')}>
                  <span className="w-20 shrink-0 text-sm tabular-nums text-slate-500">{e.event_time || 'All day'}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{e.title}</span>
                  <span
                    className={`shrink-0 rounded-pill px-2 py-0.5 text-xs ${
                      e.event_type === 'deadline' ? 'bg-rose-50 text-rose-800' : 'bg-indigo-50 text-indigo-800'
                    }`}
                  >
                    {e.meeting_id ? 'Meeting' : (e.event_type || 'event').replace(/^\w/, (c) => c.toUpperCase())}
                  </span>
                </Row>
              ))}
            </Rows>
          )}
          {events != null && todays.length > 0 && todays.length < 3 && comingUp.length === 0 && (
            <p className="mt-2 border-t border-slate-200 pt-3 text-sm text-slate-500">
              Nothing else on the calendar this week.{' '}
              <button type="button" onClick={() => onNavigateTab('calendar')} className="font-medium text-indigo-700 hover:underline">
                Plan something
              </button>
            </p>
          )}
          {events != null && todays.length < 3 && comingUp.length > 0 && (
            <div className="mt-2 border-t border-slate-200 pt-3">
              <p className="mb-1 text-xs text-slate-500">Coming up</p>
              <Rows>
                {comingUp.map((e) => (
                  <Row key={e.id} onClick={() => onNavigateTab(e.meeting_id ? 'meetings' : 'calendar')}>
                    <span className="w-24 shrink-0 text-sm tabular-nums text-slate-500">{dayName(e.event_date)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{e.title}</span>
                    {e.event_time && <span className="shrink-0 text-xs tabular-nums text-slate-500">{e.event_time}</span>}
                  </Row>
                ))}
              </Rows>
            </div>
          )}
          <AiReminderToast
            workspaceId={workspace?.id}
            onEventCreated={() => {
              setEventsVersion((v) => v + 1);
              onRefreshAll?.();
            }}
            onNavigateCalendar={() => onNavigateTab('calendar')}
          />
        </Panel>

        <Panel hideCount={loading} title="Copilot" className="col-span-12 lg:col-span-3" style={rise(6)}>
          <p className="text-sm leading-relaxed text-slate-600">Ask about anything this workspace has written, said or decided.</p>
          <div className="mt-3 divide-y divide-slate-200">
            {['What did we decide this week?', 'Draft tasks from the last meeting', 'Summarise the launch plan'].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onNavigateTab('ai_agent')}
                className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded-lg px-2 py-2.5 text-left text-[13px] text-slate-700 transition-colors duration-fast hover:bg-white/70 hover:text-slate-900"
              >
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden="true" />
                {q}
              </button>
            ))}
          </div>
        </Panel>

        <Panel hideCount={loading} title={isSolo ? 'Your tasks' : 'Sprint tasks'} count={openTasks.length} onViewAll={() => onNavigateTab('projects')} className="col-span-12 md:col-span-6" style={rise(7)}>
          {loading ? (
            <LoadingRows />
          ) : openTasks.length === 0 ? (
            <Empty
              action={
                <button type="button" onClick={() => onNavigateTab('projects')} className="btn-secondary text-xs">
                  <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" /> Open the board
                </button>
              }
            >
              No open tasks. Approved meeting minutes add theirs here.
            </Empty>
          ) : (
            <Rows>
              {urgentOpen.slice(0, 4).map((t) => (
                <Row key={t.id} onClick={() => onNavigateTab('projects')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{t.title}</span>
                    <span className="block text-xs text-slate-500">
                      {STATUS[t.status] || t.status}
                      {t.due_date && ` · due ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(t.due_date))}`}
                    </span>
                  </span>
                  {PRIORITY[t.priority] && (
                    <span className={`shrink-0 rounded-pill px-2 py-0.5 text-xs ${t.priority === 'urgent' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
                      {PRIORITY[t.priority]}
                    </span>
                  )}
                </Row>
              ))}
            </Rows>
          )}
        </Panel>

        <Panel hideCount={loading} title="Recent docs" count={documents.length} onViewAll={() => onNavigateTab('documents')} className="col-span-12 md:col-span-6" style={rise(8)}>
          {loading ? (
            <LoadingRows />
          ) : recentDocs.length === 0 ? (
            <Empty
              action={
                <button type="button" onClick={() => onNavigateTab('documents')} className="btn-secondary text-xs">
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Write a page
                </button>
              }
            >
              No pages yet. Upload a .docx or PDF and it becomes an editable page.
            </Empty>
          ) : (
            <Rows>
              {recentDocs.map((d) => (
                <Row key={d.id} onClick={() => onNavigateTab('documents')}>
                  {d.icon ? (
                    <span className="text-base" aria-hidden="true">{d.icon}</span>
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{d.title || 'Untitled'}</span>
                  <span className="shrink-0 text-xs text-slate-500">{relative(d.updated_at)}</span>
                </Row>
              ))}
            </Rows>
          )}
        </Panel>

        <Panel hideCount={loading} title={isSolo ? 'Direct chats' : 'Channels'} count={conversations.length} onViewAll={() => onNavigateTab(chatTab)} viewLabel="Open chat" className="col-span-12 md:col-span-6" style={rise(9)}>
          {loading ? (
            <LoadingRows />
          ) : conversations.length === 0 ? (
            <Empty
              action={
                <button type="button" onClick={() => onNavigateTab(chatTab)} className="btn-secondary text-xs">
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> {isSolo ? 'Message someone' : 'Create a channel'}
                </button>
              }
            >
              {isSolo ? 'No direct chats yet.' : 'No channels yet.'}
            </Empty>
          ) : (
            <Rows>
              {conversations.slice(0, 4).map((c) => (
                <Row key={c.id} onClick={() => onNavigateTab(chatTab)}>
                  {c.is_direct ? (
                    <User className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  ) : c.is_private ? (
                    <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  ) : (
                    <Hash className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{c.is_direct ? c.name.replace('dm-', '@') : c.name}</span>
                    {c.description && <span className="block truncate text-xs text-slate-500">{c.description}</span>}
                  </span>
                </Row>
              ))}
            </Rows>
          )}
        </Panel>

        <Panel hideCount={loading} title="Recent meetings" count={sessions.length} onViewAll={() => onNavigateTab('meetings')} viewLabel="Meetings" className="col-span-12 md:col-span-6" style={rise(10)}>
          {loading ? (
            <LoadingRows />
          ) : recentMeetings.length === 0 ? (
            <Empty
              action={
                <button type="button" onClick={() => onNavigateTab('meetings')} className="btn-secondary text-xs">
                  <Video className="h-3.5 w-3.5" aria-hidden="true" /> Start a meeting
                </button>
              }
            >
              No meetings recorded yet. Minutes appear here after a call ends.
            </Empty>
          ) : (
            <Rows>
              {recentMeetings.map((m) => (
                <Row key={m.id} onClick={() => onNavigateTab('meetings')}>
                  <Video className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{m.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{m.mom_status === 'approved' ? 'Minutes approved' : relative(m.created_at)}</span>
                </Row>
              ))}
            </Rows>
          )}
        </Panel>
      </div>
    </div>
  );
}
