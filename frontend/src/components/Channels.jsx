import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Plus,
  Send,
  Hash,
  Users,
  Search,
  Smile,
  X,
  Reply,
  Lock,
  MoreVertical,
  Check,
  Circle,
  CornerDownRight,
  ChevronRight,
  Flame,
  ThumbsUp,
  Heart,
  Rocket,
  PartyPopper,
  Eye,
  ArrowLeft,
  UserPlus,
  AtSign,
  Pencil,
  Trash2,
  Video,
} from 'lucide-react';
import { api } from '../api';
import { connectChannel, mergeMessages } from '../lib/channelSocket';
import { navigateTo, onDeepLink } from '../lib/deepLink';
import { useAttachmentDraft } from '../lib/chatAttachments';
import { newId } from '../lib/meetingClient';
import FormattedChatMessage from './FormattedChatMessage';
import { AttachButton, AttachmentTray, DropZone } from './chat/AttachmentComposer';
import FilePickerDialog from './chat/FilePickerDialog';
import { startCall } from './calls/CallManager';
import MessageAttachments from './chat/MessageAttachments';
import { notify, confirmDialog } from '../context/ToastContext';

const PAGE_SIZE = 100;

const QUICK_REACTIONS = [
  { emoji: '👍', label: 'Like' },
  { emoji: '❤️', label: 'Heart' },
  { emoji: '🚀', label: 'Rocket' },
  { emoji: '🎉', label: 'Tada' },
  { emoji: '👀', label: 'Eyes' },
  { emoji: '🔥', label: 'Fire' },
];

export default function Channels({
  workspaceId,
  workspace,
  user,
  channels = [],
  unreadCounts = {},
  onRefreshChannels,
  onMarkRead,
  onBack,
}) {
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Teams Thread Side Panel State
  const [threadRootMessage, setThreadRootMessage] = useState(null);
  const [threadReplies, setThreadReplies] = useState([]);
  const [threadInputText, setThreadInputText] = useState('');
  const [isThreadSending, setIsThreadSending] = useState(false);

  // Modals & UI
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [activeHoverMessageId, setActiveHoverMessageId] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editText, setEditText] = useState('');
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // DM / Invite by Username Modal
  const [showDmModal, setShowDmModal] = useState(false);
  const [targetUsernameInput, setTargetUsernameInput] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState('');

  // Presence State
  const [presenceList, setPresenceList] = useState([]);

  const [connection, setConnection] = useState('connected');
  // Files for the next message, and the id of a send that failed (reused on retry, so it's stored once).
  const channelBase = activeChannel ? `/workspaces/${workspaceId}/channels/${activeChannel.id}` : null;
  const draft = useAttachmentDraft(channelBase);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const pendingSendId = useRef(null);
  const addFiles = (files) => draft.addFiles(files).forEach((problem) => notify(problem, 'error'));
  const openPage = (att) => navigateTo({ tab: 'documents', workspace_id: att.workspace_id, document_id: att.document_id });
  // Phones show the channel list or the open conversation, not both.
  const [mobileView, setMobileView] = useState('list');
  const openChannel = (channel) => {
    setActiveChannel(channel);
    setMobileView('chat');
  };
  const messagesEndRef = useRef(null);
  const threadRootRef = useRef(null);
  threadRootRef.current = threadRootMessage;
  const seenReplies = useRef(new Set());
  const pendingDeepLink = useRef(null);
  const threadEndRef = useRef(null);

  // Set default active channel (prioritize 'general')
  useEffect(() => {
    if (channels && channels.length > 0) {
      const linked = pendingDeepLink.current && channels.find((c) => c.id === pendingDeepLink.current);
      if (linked) {
        pendingDeepLink.current = null;
        setActiveChannel(linked);
      } else if (!activeChannel || !channels.some((c) => c.id === activeChannel.id)) {
        const generalChan = channels.find((c) => c.name === 'general') || channels[0];
        setActiveChannel(generalChan);
      }
    }
  }, [channels]);

  // Load presence list for workspace
  useEffect(() => {
    if (workspaceId) {
      api.getWorkspacePresence(workspaceId)
        .then((data) => setPresenceList(data || []))
        .catch(() => {});
    }
  }, [workspaceId]);

  // Search users when DM modal is open
  useEffect(() => {
    if (!showDmModal) return;
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchUsers(targetUsernameInput);
        setUserSearchResults((res || []).filter((u) => u.id !== user?.id));
      } catch (err) {
        console.warn('Search users error:', err);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [targetUsernameInput, showDmModal]);

  // Notifications open a specific channel (a DM or the channel you were mentioned in).
  useEffect(
    () =>
      onDeepLink('channels', (link) => {
        const target = channels.find((c) => c.id === link.channel_id);
        if (target) openChannel(target);
        else {
          pendingDeepLink.current = link.channel_id;
          onRefreshChannels?.();
        }
      }),
    [channels, onRefreshChannels],
  );

  const markRead = (channelId) => {
    api.markChannelRead(workspaceId, channelId).catch(() => {});
    if (onMarkRead) onMarkRead(channelId);
  };

  // Load the latest page and keep a live socket for the open channel. After a reconnect the
  // latest page is fetched again and merged, so nothing sent meanwhile is missed.
  useEffect(() => {
    if (!activeChannel || !workspaceId) return undefined;
    const channelId = activeChannel.id;
    let current = true;
    setMessages([]);
    draft.clear();
    pendingSendId.current = null;
    setThreadRootMessage(null);
    setThreadReplies([]);
    seenReplies.current = new Set();

    const fetchLatest = async (replace) => {
      try {
        const msgs = (await api.listMessages(workspaceId, channelId, null, true, { limit: PAGE_SIZE })) || [];
        if (!current) return;
        setMessages((prev) => (replace ? mergeMessages(prev.filter((m) => m.pending), msgs) : mergeMessages(prev, msgs)));
        if (replace) setHasOlder(msgs.length === PAGE_SIZE);
      } catch (err) {
        if (current) notify(`Could not load messages: ${err.message}`, 'error');
      }
    };
    fetchLatest(true);
    markRead(channelId);

    const disconnect = connectChannel(workspaceId, channelId, {
      onStatus: (status) => current && setConnection(status),
      onResync: () => {
        fetchLatest(false);
        const root = threadRootRef.current;
        if (root) {
          api.listMessages(workspaceId, channelId, root.id, false).then(
            (replies) => current && setThreadReplies((prev) => mergeMessages(prev, replies || [])),
            () => {},
          );
        }
      },
      onEvent: (payload) => {
        if (!current) return;
        if (payload.event === 'new_message' && payload.data) {
          const incoming = payload.data;
          if (incoming.parent_id) {
            if (threadRootRef.current?.id === incoming.parent_id) {
              setThreadReplies((prev) => mergeMessages(prev, [incoming]));
            }
            if (!seenReplies.current.has(incoming.id)) {
              seenReplies.current.add(incoming.id);
              setMessages((prev) =>
                prev.map((m) => (m.id === incoming.parent_id ? { ...m, reply_count: (m.reply_count || 0) + 1 } : m)),
              );
            }
          } else {
            setMessages((prev) => mergeMessages(prev, [incoming]));
            if (document.visibilityState === 'visible') markRead(channelId);
          }
        } else if (payload.event === 'message_edited' && payload.data) {
          const updated = payload.data;
          const apply = (list) => list.map((m) => (m.id === updated.id ? { ...m, ...updated } : m));
          setMessages(apply);
          setThreadReplies(apply);
        } else if (payload.event === 'message_deleted' && payload.message_id) {
          const drop = (list) => list.filter((m) => m.id !== payload.message_id);
          setMessages(drop);
          setThreadReplies(drop);
        } else if (payload.event === 'reaction_updated' && payload.data) {
          const { message_id, reactions } = payload.data;
          const apply = (list) => list.map((m) => (m.id === message_id ? { ...m, reactions } : m));
          setMessages(apply);
          setThreadReplies(apply);
          setThreadRootMessage((prev) => (prev && prev.id === message_id ? { ...prev, reactions } : prev));
        }
      },
    });
    return () => {
      current = false;
      disconnect();
    };
  }, [activeChannel?.id, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadReplies.length]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const textToSend = inputText.trim();
    if ((!textToSend && !draft.hasItems) || !activeChannel || isSending) return;
    if (draft.busy) {
      notify('Wait for the files to finish uploading.', 'info');
      return;
    }
    if (draft.failed) {
      notify('Some files failed to upload: retry or remove them first.', 'error');
      return;
    }
    pendingSendId.current = pendingSendId.current || newId();
    setIsSending(true);
    try {
      const created = await api.postMessage(workspaceId, activeChannel.id, {
        content: textToSend,
        ...draft.payload(),
        client_message_id: pendingSendId.current,
      });
      setMessages((prev) => mergeMessages(prev, [created]));
      setInputText('');
      draft.clear();
      pendingSendId.current = null;
    } catch (err) {
      // Text and files stay as they were; sending again reuses the same message id.
      notify(`Send failed: ${err.message}`, 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendThreadReply = async (e) => {
    e.preventDefault();
    if (!threadInputText.trim() || !threadRootMessage || isThreadSending) return;
    const replyToSend = threadInputText.trim();
    setThreadInputText('');
    setIsThreadSending(true);

    try {
      const created = await api.postMessage(workspaceId, activeChannel.id, {
        content: replyToSend,
        parent_id: threadRootMessage.id,
      });
      setThreadReplies((prev) => mergeMessages(prev, [created]));
      if (!seenReplies.current.has(created.id)) {
        seenReplies.current.add(created.id);
        setMessages((prev) =>
          prev.map((m) => (m.id === threadRootMessage.id ? { ...m, reply_count: (m.reply_count || 0) + 1 } : m)),
        );
      }
    } catch (err) {
      setThreadInputText(replyToSend);
      notify(`Thread reply failed: ${err.message}`, 'error');
    } finally {
      setIsThreadSending(false);
    }
  };

  const handleOpenThread = async (msg) => {
    setThreadRootMessage(msg);
    try {
      const replies = await api.listMessages(workspaceId, activeChannel.id, msg.id, false);
      setThreadReplies(replies || []);
    } catch (err) {
      console.warn('Could not load replies', err);
    }
  };

  const loadOlderMessages = async () => {
    if (!activeChannel || messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await api.listMessages(workspaceId, activeChannel.id, null, true, {
        before: messages[0].created_at,
        limit: PAGE_SIZE,
      });
      setMessages((prev) => mergeMessages(prev, older || []));
      setHasOlder((older || []).length === PAGE_SIZE);
    } catch (err) {
      notify(`Could not load older messages: ${err.message}`, 'error');
    } finally {
      setLoadingOlder(false);
    }
  };

  const startEditing = (msg) => {
    setEditingMessageId(msg.id);
    setEditText(msg.content);
  };

  const saveEdit = async (msg) => {
    if (!editText.trim()) {
      notify('A message cannot be empty. Delete it instead.', 'error');
      return;
    }
    try {
      const updated = await api.editMessage(workspaceId, activeChannel.id, msg.id, editText.trim());
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...updated } : m)));
      setEditingMessageId(null);
    } catch (err) {
      notify(`Could not edit the message: ${err.message}`, 'error');
    }
  };

  const handleDeleteMessage = async (msg) => {
    const ok = await confirmDialog('The message and its thread replies will be removed for everyone.', {
      title: 'Delete message?',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.deleteMessage(workspaceId, activeChannel.id, msg.id);
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      if (threadRootMessage?.id === msg.id) setThreadRootMessage(null);
    } catch (err) {
      notify(`Could not delete the message: ${err.message}`, 'error');
    }
  };

  const handleDeleteChannel = async () => {
    if (!activeChannel) return;
    const ok = await confirmDialog(`#${getChannelDisplayName(activeChannel)} and all of its messages will be deleted for everyone.`, {
      title: 'Delete channel?',
      confirmLabel: 'Delete channel',
    });
    if (!ok) return;
    try {
      await api.deleteChannel(workspaceId, activeChannel.id);
      setActiveChannel(null);
      if (onRefreshChannels) await onRefreshChannels();
      notify('Channel deleted.', 'success');
    } catch (err) {
      notify(`Could not delete the channel: ${err.message}`, 'error');
    }
  };

  const handleToggleReaction = async (messageId, emoji) => {
    if (!activeChannel) return;
    try {
      const updatedReactions = await api.toggleReaction(
        workspaceId,
        activeChannel.id,
        messageId,
        emoji
      );
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions: updatedReactions } : m))
      );
      if (threadRootMessage && threadRootMessage.id === messageId) {
        setThreadRootMessage((prev) => ({ ...prev, reactions: updatedReactions }));
      }
      setThreadReplies((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions: updatedReactions } : m))
      );
    } catch (err) {
      console.warn('Reaction error:', err);
    }
  };

  const handleCreateSubchat = async (e) => {
    e.preventDefault();
    const cleanName = newChannelName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '');
    if (!cleanName) return;

    try {
      const created = await api.createChannel(workspaceId, {
        name: cleanName,
        description: newChannelDesc.trim() || undefined,
        is_private: isPrivate,
      });
      setShowCreateModal(false);
      setNewChannelName('');
      setNewChannelDesc('');
      setIsPrivate(false);
      if (onRefreshChannels) await onRefreshChannels();
      setActiveChannel(created);
    } catch (err) {
      notify(`Create channel error: ${err.message}`, 'error');
    }
  };

  const handleOpenOrCreateDm = async (targetUsername) => {
    if (!targetUsername || dmLoading) return;
    const cleanUser = targetUsername.trim().lstrip ? targetUsername.trim().replace(/^@/, '') : targetUsername.trim().replace(/^@/, '');
    setDmLoading(true);
    setDmError('');

    try {
      const channel = await api.createOrOpenDm(workspaceId, cleanUser);
      setShowDmModal(false);
      setTargetUsernameInput('');
      if (onRefreshChannels) await onRefreshChannels();
      setActiveChannel(channel);
    } catch (err) {
      setDmError(err.message || 'Failed to start direct message');
    } finally {
      setDmLoading(false);
    }
  };

  const getUserPresenceDot = (senderName) => {
    const match = presenceList.find(
      (p) => p.user_name?.toLowerCase() === senderName?.toLowerCase()
    );
    const status = match ? match.status : 'offline';
    if (status === 'online') return 'bg-emerald-500 ring-2 ring-white';
    if (status === 'away') return 'bg-amber-500 ring-2 ring-white';
    if (status === 'busy') return 'bg-rose-500 ring-2 ring-white';
    return 'bg-slate-300 ring-2 ring-white';
  };

  // Group channels into Team Channels and Direct Messages
  const generalChannel = (channels || []).find((c) => c.name === 'general');
  const teamChannels = (channels || []).filter(
    (c) => c.name !== 'general' && !c.is_direct
  );
  const dmChannels = (channels || []).filter((c) => c.is_direct);

  const filteredTeamChannels = teamChannels.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredDmChannels = dmChannels.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getChannelDisplayName = (ch) => {
    if (ch.name.startsWith('dm-')) {
      if (ch.description && ch.description.includes('between')) {
        return ch.description.replace('Direct message between', '').trim();
      }
      return ch.name.replace('dm-', '@');
    }
    return ch.name;
  };

  return (
    <div className="h-full flex overflow-hidden -m-6 md:-m-8 bg-slate-50 text-slate-900 font-sans">
      {/* ------------------------------------------------------------- */}
      {/* 1. LEFT CHANNEL & DM SIDEBAR                                   */}
      {/* ------------------------------------------------------------- */}
      <aside className={`${mobileView === 'chat' ? 'hidden lg:flex' : 'flex'} w-full lg:w-64 xl:w-72 bg-white border-r border-slate-200 flex-col h-full flex-shrink-0 select-none shadow-sm`}>
        {/* Sidebar Header with Back Button */}
        <div className="p-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && (
              <button aria-label="Back to Dashboard"
                onClick={onBack}
                className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition"
                title="Back to Dashboard"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-indigo-600" />
              <h1 className="font-extrabold text-sm text-slate-900 tracking-tight">
                Chats & Channels
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowDmModal(true)}
              title="New DM by @username"
              className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl transition shadow-sm"
            >
              <UserPlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              title="Create Channel"
              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input aria-label="Filter channels or @users"
              type="text"
              placeholder="Filter channels or @users..."
              className="w-full bg-slate-100 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 placeholder-slate-400 transition"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Scrollable Channels & DMs */}
        <div className="flex-1 overflow-y-auto p-3 space-y-5">
          {/* Main Workspace General Channel */}
          <div>
            <div className="text-xs font-mono font-bold uppercase text-slate-400 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Main Channel</span>
              <span className="bg-indigo-50 text-indigo-700 text-xs px-1.5 py-0.5 rounded font-bold">
                Team
              </span>
            </div>

            {generalChannel ? (
              <button
                onClick={() => openChannel(generalChannel)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition ${
                  activeChannel?.id === generalChannel.id
                    ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/25'
                    : 'text-slate-800 hover:bg-slate-100 font-semibold'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 shrink-0" />
                  <span className="truncate">general</span>
                </div>
                {unreadCounts[generalChannel.id] > 0 && activeChannel?.id !== generalChannel.id && (
                  <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {unreadCounts[generalChannel.id]}
                  </span>
                )}
              </button>
            ) : null}
          </div>

          {/* Team Topic Channels */}
          <div>
            <div className="text-xs font-mono font-bold uppercase text-slate-400 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Channels ({filteredTeamChannels.length})</span>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-xs text-indigo-600 hover:underline font-bold"
              >
                + Add
              </button>
            </div>

            <div className="space-y-1">
              {filteredTeamChannels.map((ch) => {
                const isActive = activeChannel?.id === ch.id;
                const unread = unreadCounts[ch.id] || 0;

                return (
                  <button
                    key={ch.id}
                    onClick={() => openChannel(ch)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      isActive
                        ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/25'
                        : 'text-slate-800 hover:bg-slate-100 font-semibold'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {ch.is_private ? (
                        <Lock className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <Hash className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span className="truncate">{ch.name}</span>
                    </div>
                    {unread > 0 && !isActive && (
                      <span className="bg-rose-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Direct Messages (DMs) by @username */}
          <div>
            <div className="text-xs font-mono font-bold uppercase text-slate-400 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Direct Messages ({filteredDmChannels.length})</span>
              <button
                onClick={() => setShowDmModal(true)}
                className="text-xs text-indigo-600 hover:underline font-bold flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> New DM
              </button>
            </div>

            <div className="space-y-1">
              {filteredDmChannels.length === 0 ? (
                <div
                  onClick={() => setShowDmModal(true)}
                  className="px-3 py-2.5 text-center text-slate-400 hover:text-indigo-600 text-xs italic bg-slate-50 hover:bg-indigo-50/50 rounded-xl border border-dashed border-slate-200 cursor-pointer transition"
                >
                  + Message user by @username
                </div>
              ) : (
                filteredDmChannels.map((ch) => {
                  const isActive = activeChannel?.id === ch.id;
                  const unread = unreadCounts[ch.id] || 0;

                  return (
                    <button
                      key={ch.id}
                      onClick={() => openChannel(ch)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                        isActive
                          ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/25'
                          : 'text-slate-800 hover:bg-slate-100 font-semibold'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <AtSign className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                        <span className="truncate">{getChannelDisplayName(ch)}</span>
                      </div>
                      {unread > 0 && !isActive && (
                        <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                          {unread}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* User Presence Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : 'ME'}
            </div>
            <div className="min-w-0">
              <span className="font-bold text-slate-900 block truncate">{user?.name}</span>
              <span className="text-xs font-mono text-indigo-600 block truncate">
                @{user?.username || 'user'}
              </span>
            </div>
          </div>
          <span className="text-xs font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
            online
          </span>
        </div>
      </aside>

      {/* ------------------------------------------------------------- */}
      {/* 2. MAIN CHAT CONVERSATION AREA                                 */}
      {/* ------------------------------------------------------------- */}
      <main className={`${mobileView === 'list' ? 'hidden lg:flex' : 'flex'} flex-1 min-w-0 flex-col h-full bg-slate-50 overflow-hidden shadow-sm relative`}>
        {activeChannel ? (
          <>
            {/* Chat Top Header */}
            <header className="px-3 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-white flex items-center justify-between gap-2 flex-shrink-0 shadow-xs">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button type="button" onClick={() => setMobileView('list')} className="lg:hidden p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Back to channels">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
                  {activeChannel.name.startsWith('dm-') ? (
                    <AtSign className="w-5 h-5 text-indigo-600" />
                  ) : activeChannel.is_private ? (
                    <Lock className="w-5 h-5" />
                  ) : (
                    <Hash className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <span>{getChannelDisplayName(activeChannel)}</span>
                    {activeChannel.name === 'general' && (
                      <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                        Workspace General
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 font-sans mt-0.5">
                    {activeChannel.description ||
                      (activeChannel.name.startsWith('dm-')
                        ? 'Direct private message with teammate.'
                        : 'Dedicated team collaboration channel.')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {activeChannel.is_direct && (
                  <button
                    type="button"
                    onClick={() => startCall({ workspaceId, channelId: activeChannel.id, peerName: getChannelDisplayName(activeChannel) })}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl transition"
                    aria-label={`Video call ${getChannelDisplayName(activeChannel)}`}
                  >
                    <Video className="w-3.5 h-3.5 text-indigo-600" />
                    <span className="hidden sm:inline">Call</span>
                  </button>
                )}
                {!activeChannel.is_direct && activeChannel.created_by === user?.id && activeChannel.name !== 'general' && (
                  <button
                    type="button"
                    onClick={handleDeleteChannel}
                    className="text-xs font-bold text-rose-700 hover:bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl transition"
                  >
                    Delete channel
                  </button>
                )}
                <button
                  onClick={() => setShowDmModal(true)}
                  className="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite Teammate</span>
                </button>
              </div>
            </header>

            {/* Message Feed - HIGH CONTRAST & LEGIBILITY */}
            {connection === 'reconnecting' && (
              <div className="px-4 py-1.5 text-xs font-semibold bg-amber-100 text-amber-900 text-center" role="status">
                Connection lost. Reconnecting… new messages will appear when it is back.
              </div>
            )}
            <DropZone onFiles={addFiles} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 bg-slate-100/70">
              {messages.length === 0 ? (
                <div className="text-center py-20 text-slate-400 space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mx-auto text-indigo-600 shadow-sm">
                    {activeChannel.name.startsWith('dm-') ? (
                      <AtSign className="w-7 h-7" />
                    ) : (
                      <Hash className="w-7 h-7" />
                    )}
                  </div>
                  <div>
                    <h4 className="font-extrabold text-base text-slate-900">
                      Welcome to #{getChannelDisplayName(activeChannel)}!
                    </h4>
                    <p className="text-xs text-slate-600 mt-1">
                      Start the conversation, mention teammates, or reply in threads.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                {hasOlder && (
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={loadOlderMessages}
                      disabled={loadingOlder}
                      className="text-xs font-semibold text-indigo-700 hover:underline disabled:text-slate-500"
                    >
                      {loadingOlder ? 'Loading…' : 'Load older messages'}
                    </button>
                  </div>
                )}
                {messages.map((msg) => {
                  const isHovered = activeHoverMessageId === msg.id;
                  const replyCount = msg.reply_count || 0;
                  const isOwn = msg.sender_id === user?.id;

                  return (
                    <div
                      key={msg.id}
                      onMouseEnter={() => setActiveHoverMessageId(msg.id)}
                      onMouseLeave={() => setActiveHoverMessageId(null)}
                      className="flex gap-3.5 group relative rounded-2xl p-2 transition hover:bg-white/60"
                    >
                      {/* Avatar with Presence Dot */}
                      <div className="relative shrink-0 mt-0.5">
                        <div className="w-9 h-9 rounded-2xl bg-indigo-100 border border-indigo-200 flex items-center justify-center text-xs font-black text-indigo-700 shadow-sm">
                          {msg.sender_name ? msg.sender_name.slice(0, 2).toUpperCase() : 'US'}
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${getUserPresenceDot(
                            msg.sender_name
                          )}`}
                        />
                      </div>

                      {/* Message Content & Thread Hook */}
                      <div className="flex-1 min-w-0">
                        {/* Header: Name + Username + Timestamp */}
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm text-slate-900">
                            {msg.sender_name || 'Teammate'}
                          </span>
                          {msg.sender_username && (
                            <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
                              @{msg.sender_username}
                            </span>
                          )}
                          <span className="text-xs font-mono text-slate-400 ml-1">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {/* Message Bubble - CRISP, HIGH CONTRAST */}
                        {editingMessageId === msg.id ? (
                          <form
                            className="mt-1.5 max-w-3xl space-y-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              saveEdit(msg);
                            }}
                          >
                            <label htmlFor={`edit-${msg.id}`} className="sr-only">Edit message</label>
                            <textarea
                              id={`edit-${msg.id}`}
                              autoFocus
                              rows={3}
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.stopPropagation();
                                  setEditingMessageId(null);
                                }
                              }}
                              className="w-full bg-white border border-indigo-400 rounded-2xl p-3 text-sm text-slate-900"
                            />
                            <div className="flex gap-2">
                              <button type="submit" className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg">
                                Save
                              </button>
                              <button type="button" onClick={() => setEditingMessageId(null)} className="text-xs font-semibold text-slate-700 border border-slate-300 px-3 py-1.5 rounded-lg">
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            {msg.content && (
                              <div className="mt-1.5 bg-white border border-slate-200/90 rounded-2xl rounded-tl-none p-4 shadow-sm text-sm sm:text-base text-slate-900 max-w-3xl leading-relaxed font-sans font-normal break-words">
                                <FormattedChatMessage content={msg.content} isUser={false} />
                                {msg.edited_at && <span className="block mt-1 text-xs text-slate-500">(edited)</span>}
                              </div>
                            )}
                            <MessageAttachments attachments={msg.attachments} base={channelBase} onOpenPage={openPage} />
                          </>
                        )}

                        {/* Reaction Badges List */}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {msg.reactions.map((r, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleToggleReaction(msg.id, r.emoji)}
                                className={`px-2.5 py-0.5 rounded-full text-xs flex items-center gap-1.5 border transition ${
                                  r.has_reacted
                                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-bold shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                                }`}
                              >
                                <span>{r.emoji}</span>
                                <span className="font-mono text-xs font-bold">{r.count}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Teams Thread Reply Trigger */}
                        <div className="mt-1.5 flex items-center gap-3 text-xs">
                          {replyCount > 0 ? (
                            <button
                              onClick={() => handleOpenThread(msg)}
                              className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"
                            >
                              <CornerDownRight className="w-3.5 h-3.5" />
                              <span>
                                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                              </span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenThread(msg)}
                              className="opacity-0 group-hover:opacity-100 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition flex items-center gap-1"
                            >
                              <Reply className="w-3.5 h-3.5" /> Reply in thread
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Action Bar (Reactions, Reply, Edit, Delete): on hover or keyboard focus */}
                      {editingMessageId !== msg.id && (
                        <div
                          className={`absolute right-4 -top-3 bg-white border border-slate-200 rounded-xl px-2 py-1 shadow-lg flex items-center gap-1 z-10 ${
                            isHovered ? 'opacity-100' : 'opacity-0 focus-within:opacity-100'
                          }`}
                        >
                          {QUICK_REACTIONS.map((re) => (
                            <button
                              key={re.emoji}
                              title={re.label}
                              onClick={() => handleToggleReaction(msg.id, re.emoji)}
                              className="p-1 hover:bg-slate-100 rounded-lg text-sm transition hover:scale-125"
                            >
                              {re.emoji}
                            </button>
                          ))}
                          <div className="w-[1px] h-3.5 bg-slate-200 mx-0.5" />
                          <button
                            title="Reply in thread"
                            aria-label="Reply in thread"
                            onClick={() => handleOpenThread(msg)}
                            className="p-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          >
                            <Reply className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          {isOwn && (
                            <>
                              <button
                                title="Edit message"
                                aria-label="Edit message"
                                onClick={() => startEditing(msg)}
                                className="p-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                title="Delete message"
                                aria-label="Delete message"
                                onClick={() => handleDeleteMessage(msg)}
                                className="p-1 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>
            </DropZone>

            {/* Message Input Form - High Contrast, Large Readable Text */}
            <form
              onSubmit={handleSendMessage}
              onPaste={(e) => e.clipboardData?.files?.length && addFiles(e.clipboardData.files)}
              className="p-2 sm:p-4 border-t border-slate-200 bg-white flex flex-wrap items-center gap-2 sm:gap-3"
            >
              {draft.hasItems && (
                <div className="w-full">
                  <AttachmentTray draft={draft} />
                </div>
              )}
              <AttachButton onFiles={addFiles} onShareExisting={() => setShowFilePicker(true)} disabled={isSending} />
              <input aria-label="Message text"
                type="text"
                placeholder={`Type message in #${getChannelDisplayName(activeChannel)}...`}
                className="flex-1 min-w-0 bg-slate-50 border-2 border-slate-200 focus:border-indigo-600 focus:bg-white rounded-2xl px-3 sm:px-5 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none transition shadow-sm font-sans"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />

              <button
                type="submit"
                disabled={(!inputText.trim() && !draft.hasItems) || isSending || draft.busy}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-3 rounded-2xl text-xs font-bold shadow-md shadow-indigo-600/30 transition flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>Send</span>
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Select or create a channel to start communicating with your team.
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------- */}
      {showFilePicker && (
        <FilePickerDialog workspaceId={workspaceId} onPick={draft.addShared} onClose={() => setShowFilePicker(false)} />
      )}

      {/* ------------------------------------------------------------- */}
      {/* 3. DEDICATED THREAD PANEL                                      */}
      {/* ------------------------------------------------------------- */}
      {threadRootMessage && (
        <aside className="fixed inset-0 z-50 lg:static lg:z-auto w-full lg:w-96 bg-white border-l border-slate-200 flex flex-col h-full flex-shrink-0 shadow-xl animate-in slide-in-from-right duration-200">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CornerDownRight className="w-4 h-4 text-indigo-600" />
              <h3 className="font-extrabold text-sm text-slate-900">Thread Discussion</h3>
            </div>
            <button
              onClick={() => setThreadRootMessage(null)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Root Message Card */}
          <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-black">
                {threadRootMessage.sender_name
                  ? threadRootMessage.sender_name.slice(0, 2).toUpperCase()
                  : 'US'}
              </div>
              <div>
                <span className="font-bold text-xs text-slate-900">
                  {threadRootMessage.sender_name || 'Teammate'}
                </span>
                {threadRootMessage.sender_username && (
                  <span className="text-xs font-mono text-indigo-600 ml-1.5">
                    @{threadRootMessage.sender_username}
                  </span>
                )}
              </div>
            </div>
            <div className="text-sm text-slate-900 leading-relaxed bg-white p-3.5 rounded-xl border border-slate-200 font-sans shadow-sm">
              <FormattedChatMessage content={threadRootMessage.content} isUser={false} />
            </div>
          </div>

          {/* Thread Replies List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {threadReplies.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                No replies yet. Be the first to reply in this thread!
              </div>
            ) : (
              threadReplies.map((reply) => (
                <div key={reply.id} className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    {reply.sender_name ? reply.sender_name.slice(0, 2).toUpperCase() : 'US'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold text-xs text-slate-900">
                        {reply.sender_name || 'Teammate'}
                      </span>
                      {reply.sender_username && (
                        <span className="text-xs font-mono text-indigo-600">
                          @{reply.sender_username}
                        </span>
                      )}
                      <span className="text-xs text-slate-400 font-mono">
                        {new Date(reply.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-900 bg-white p-3 rounded-xl border border-slate-200 shadow-sm leading-relaxed">
                      <FormattedChatMessage content={reply.content} isUser={false} />
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={threadEndRef} />
          </div>

          {/* Thread Input Form */}
          <form
            onSubmit={handleSendThreadReply}
            className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
          >
            <input aria-label="Reply to thread"
              type="text"
              placeholder="Reply to thread..."
              className="flex-1 bg-slate-100 border border-slate-200 focus:border-indigo-600 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none transition"
              value={threadInputText}
              onChange={(e) => setThreadInputText(e.target.value)}
            />
            <button
              type="submit"
              disabled={!threadInputText.trim() || isThreadSending}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white p-2 rounded-xl transition"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </aside>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. CREATE NEW CHANNEL MODAL                                    */}
      {/* ------------------------------------------------------------- */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div data-modal className="bg-white p-6 rounded-3xl border border-slate-200 max-w-sm w-full space-y-4 shadow-2xl text-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">Create New Channel</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubchat} className="space-y-4">
              <div>
                <label htmlFor="channels-field-1" className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Channel Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-mono text-xs">#</span>
                  <input id="channels-field-1"
                    type="text"
                    required
                    placeholder="frontend-releases"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-7 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="channels-field-2" className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Description
                </label>
                <input id="channels-field-2"
                  type="text"
                  placeholder="What is this channel for?"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="private_ch"
                  className="rounded text-indigo-600 focus:ring-0"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                <label htmlFor="private_ch" className="text-xs text-slate-700 font-medium">
                  Make private (invite only)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
                >
                  Create Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 5. DIRECT MESSAGE / INVITE USER BY @USERNAME MODAL             */}
      {/* ------------------------------------------------------------- */}
      {showDmModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div data-modal className="bg-white p-6 rounded-3xl border border-slate-200 max-w-md w-full space-y-4 shadow-2xl text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <AtSign className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-extrabold text-slate-900">
                  Direct Message / Invite User
                </h3>
              </div>
              <button onClick={() => setShowDmModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 font-sans">
              Search by <strong>@username</strong> or full name to start a private 1-on-1 chat.
            </p>

            {dmError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
                {dmError}
              </div>
            )}

            {/* Input with @ Prefix */}
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-indigo-600 font-mono text-sm font-bold">@</span>
              <input aria-label="type username e.g. jason_bourne"
                type="text"
                autoFocus
                placeholder="type username e.g. jason_bourne..."
                className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-600 focus:bg-white rounded-xl pl-8 pr-4 py-2.5 text-xs text-slate-900 outline-none transition font-mono font-bold"
                value={targetUsernameInput}
                onChange={(e) => setTargetUsernameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleOpenOrCreateDm(targetUsernameInput);
                  }
                }}
              />
            </div>

            {/* Matching Users List */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {userSearchResults.length > 0 ? (
                userSearchResults.map((u) => (
                  <div
                    key={u.id}
                    onClick={() => handleOpenOrCreateDm(u.username || u.name)}
                    className="p-2.5 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/50 flex items-center justify-between cursor-pointer transition group"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                        {u.name ? u.name.slice(0, 2).toUpperCase() : 'US'}
                      </div>
                      <div>
                        <span className="font-bold text-xs text-slate-900 group-hover:text-indigo-600 transition block">
                          {u.name}
                        </span>
                        <span className="text-xs font-mono text-indigo-600">
                          @{u.username || 'user'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-bold text-indigo-600 bg-white group-hover:bg-indigo-600 group-hover:text-white px-3 py-1 rounded-lg border border-indigo-200 transition"
                    >
                      Chat
                    </button>
                  </div>
                ))
              ) : targetUsernameInput.trim() ? (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                  <span className="text-xs text-slate-600 font-mono">
                    Start chat with <strong>@{targetUsernameInput.trim()}</strong>
                  </span>
                  <button
                    onClick={() => handleOpenOrCreateDm(targetUsernameInput)}
                    disabled={dmLoading}
                    className="bg-indigo-600 text-white font-bold text-xs px-3 py-1 rounded-lg shadow-sm"
                  >
                    {dmLoading ? 'Opening...' : 'Start'}
                  </button>
                </div>
              ) : (
                <div className="text-center py-6 text-slate-400 text-xs">
                  Type a username above to search.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
