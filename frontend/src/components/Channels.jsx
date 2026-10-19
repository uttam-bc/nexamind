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
} from 'lucide-react';
import { api, getAuthToken } from '../api';

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

  // DM / Invite by Username Modal
  const [showDmModal, setShowDmModal] = useState(false);
  const [targetUsernameInput, setTargetUsernameInput] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState('');

  // Presence State
  const [presenceList, setPresenceList] = useState([]);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const threadEndRef = useRef(null);

  // Set default active channel (prioritize 'general')
  useEffect(() => {
    if (channels && channels.length > 0) {
      if (!activeChannel || !channels.some((c) => c.id === activeChannel.id)) {
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

  // Load messages, mark channel read, and connect WebSocket when activeChannel changes
  useEffect(() => {
    if (activeChannel && workspaceId) {
      loadMessagesAndConnectWS(activeChannel.id);
      api.markChannelRead(workspaceId, activeChannel.id).catch(() => {});
      if (onMarkRead) onMarkRead(activeChannel.id);
      setThreadRootMessage(null);
      setThreadReplies([]);
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [activeChannel?.id, workspaceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadReplies]);

  const loadMessagesAndConnectWS = async (channelId) => {
    try {
      const msgs = await api.listMessages(workspaceId, channelId, null, true);
      setMessages(msgs || []);
    } catch (err) {
      console.warn('Error fetching channel messages', err);
    }

    try {
      if (wsRef.current) wsRef.current.close();
      const token = getAuthToken();
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/workspaces/${workspaceId}/channels/${channelId}?token=${token}`;
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.event === 'new_message' && payload.data) {
            const incoming = payload.data;
            if (incoming.parent_id) {
              setThreadReplies((prev) => {
                if (threadRootMessage && incoming.parent_id === threadRootMessage.id) {
                  if (prev.some((m) => m.id === incoming.id)) return prev;
                  return [...prev, incoming];
                }
                return prev;
              });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === incoming.parent_id
                    ? { ...m, reply_count: (m.reply_count || 0) + 1 }
                    : m
                )
              );
            } else {
              setMessages((prev) => {
                if (prev.some((m) => m.id === incoming.id)) return prev;
                return [...prev, incoming];
              });
            }
          } else if (payload.event === 'reaction_updated' && payload.data) {
            const { message_id, reactions } = payload.data;
            setMessages((prev) =>
              prev.map((m) => (m.id === message_id ? { ...m, reactions } : m))
            );
            if (threadRootMessage && threadRootMessage.id === message_id) {
              setThreadRootMessage((prev) => ({ ...prev, reactions }));
            }
            setThreadReplies((prev) =>
              prev.map((m) => (m.id === message_id ? { ...m, reactions } : m))
            );
          }
        } catch (err) {
          console.warn('WS message parse error', err);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.warn('WS connection error', err);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChannel || isSending) return;
    const textToSend = inputText.trim();
    setInputText('');
    setIsSending(true);

    try {
      const created = await api.postMessage(workspaceId, activeChannel.id, {
        content: textToSend,
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev;
        return [...prev, created];
      });
    } catch (err) {
      alert(`Send failed: ${err.message}`);
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
      setThreadReplies((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev;
        return [...prev, created];
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === threadRootMessage.id
            ? { ...m, reply_count: (m.reply_count || 0) + 1 }
            : m
        )
      );
    } catch (err) {
      alert(`Thread reply failed: ${err.message}`);
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
      alert(`Create channel error: ${err.message}`);
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
    (c) => c.name !== 'general' && !c.name.startsWith('dm-')
  );
  const dmChannels = (channels || []).filter((c) => c.name.startsWith('dm-'));

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
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col h-full flex-shrink-0 select-none shadow-sm">
        {/* Sidebar Header with Back Button */}
        <div className="p-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition"
                title="Back to Dashboard"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-indigo-600" />
              <h2 className="font-extrabold text-sm text-slate-900 tracking-tight">
                Chats & Channels
              </h2>
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
            <input
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
            <div className="text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Main Channel</span>
              <span className="bg-indigo-50 text-indigo-700 text-[9px] px-1.5 py-0.5 rounded font-bold">
                Team
              </span>
            </div>

            {generalChannel ? (
              <button
                onClick={() => setActiveChannel(generalChannel)}
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
                  <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {unreadCounts[generalChannel.id]}
                  </span>
                )}
              </button>
            ) : null}
          </div>

          {/* Team Topic Channels */}
          <div>
            <div className="text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Channels ({filteredTeamChannels.length})</span>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-[10px] text-indigo-600 hover:underline font-bold"
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
                    onClick={() => setActiveChannel(ch)}
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
                      <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
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
            <div className="text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Direct Messages ({filteredDmChannels.length})</span>
              <button
                onClick={() => setShowDmModal(true)}
                className="text-[10px] text-indigo-600 hover:underline font-bold flex items-center gap-0.5"
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
                      onClick={() => setActiveChannel(ch)}
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
                        <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
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
            <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[10px]">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : 'ME'}
            </div>
            <div className="min-w-0">
              <span className="font-bold text-slate-900 block truncate">{user?.name}</span>
              <span className="text-[10px] font-mono text-indigo-600 block truncate">
                @{user?.username || 'user'}
              </span>
            </div>
          </div>
          <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
            online
          </span>
        </div>
      </aside>

      {/* ------------------------------------------------------------- */}
      {/* 2. MAIN CHAT CONVERSATION AREA                                 */}
      {/* ------------------------------------------------------------- */}
      <main className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden shadow-sm relative">
        {activeChannel ? (
          <>
            {/* Chat Top Header */}
            <header className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0 shadow-xs">
              <div className="flex items-center gap-3">
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
                      <span className="text-[10px] font-mono bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
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
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-100/70">
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
                messages.map((msg) => {
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
                            <span className="text-[11px] font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
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
                        <div className="mt-1.5 bg-white border border-slate-200/90 rounded-2xl rounded-tl-none p-4 shadow-sm text-sm sm:text-base text-slate-900 max-w-3xl leading-relaxed whitespace-pre-wrap font-sans font-normal">
                          {msg.content}
                        </div>

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

                      {/* Hover Action Bar (Reactions + Reply) */}
                      {isHovered && (
                        <div className="absolute right-4 -top-3 bg-white border border-slate-200 rounded-xl px-2 py-1 shadow-lg flex items-center gap-1 z-10 animate-in fade-in zoom-in-95">
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
                            onClick={() => handleOpenThread(msg)}
                            className="p-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input Form - High Contrast, Large Readable Text */}
            <form
              onSubmit={handleSendMessage}
              className="p-4 border-t border-slate-200 bg-white flex items-center gap-3"
            >
              <input
                type="text"
                placeholder={`Type message in #${getChannelDisplayName(activeChannel)}...`}
                className="flex-1 bg-slate-50 border-2 border-slate-200 focus:border-indigo-600 focus:bg-white rounded-2xl px-5 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none transition shadow-sm font-sans"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />

              <button
                type="submit"
                disabled={!inputText.trim() || isSending}
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
      {/* 3. DEDICATED THREAD PANEL                                      */}
      {/* ------------------------------------------------------------- */}
      {threadRootMessage && (
        <aside className="w-96 bg-white border-l border-slate-200 flex flex-col h-full flex-shrink-0 shadow-xl animate-in slide-in-from-right duration-200">
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
                  <span className="text-[10px] font-mono text-indigo-600 ml-1.5">
                    @{threadRootMessage.sender_username}
                  </span>
                )}
              </div>
            </div>
            <div className="text-sm text-slate-900 leading-relaxed bg-white p-3.5 rounded-xl border border-slate-200 font-sans shadow-sm">
              {threadRootMessage.content}
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
                  <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                    {reply.sender_name ? reply.sender_name.slice(0, 2).toUpperCase() : 'US'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold text-xs text-slate-900">
                        {reply.sender_name || 'Teammate'}
                      </span>
                      {reply.sender_username && (
                        <span className="text-[10px] font-mono text-indigo-600">
                          @{reply.sender_username}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(reply.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-900 bg-white p-3 rounded-xl border border-slate-200 shadow-sm leading-relaxed">
                      {reply.content}
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
            <input
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
          <div className="bg-white p-6 rounded-3xl border border-slate-200 max-w-sm w-full space-y-4 shadow-2xl text-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">Create New Channel</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubchat} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Channel Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-mono text-xs">#</span>
                  <input
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
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Description
                </label>
                <input
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
          <div className="bg-white p-6 rounded-3xl border border-slate-200 max-w-md w-full space-y-4 shadow-2xl text-slate-900">
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
              <input
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
                        <span className="text-[10px] font-mono text-indigo-600">
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
