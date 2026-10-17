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

  // Load messages, mark channel read, and connect WebSocket when activeChannel changes
  useEffect(() => {
    if (activeChannel && workspaceId) {
      loadMessagesAndConnectWS(activeChannel.id);
      // Mark read
      api.markChannelRead(workspaceId, activeChannel.id).catch(() => {});
      if (onMarkRead) onMarkRead(activeChannel.id);
      // Close thread if switching channel
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
      // Fetch root messages for Teams feed view
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
              // It's a thread reply
              setThreadReplies((prev) => {
                if (threadRootMessage && incoming.parent_id === threadRootMessage.id) {
                  if (prev.some((m) => m.id === incoming.id)) return prev;
                  return [...prev, incoming];
                }
                return prev;
              });
              // Update reply_count on the root message in main stream
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === incoming.parent_id
                    ? { ...m, reply_count: (m.reply_count || 0) + 1 }
                    : m
                )
              );
            } else {
              // It's a root message
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
          console.warn('WS message parse error:', err);
        }
      };

      wsRef.current = ws;
    } catch (e) {
      console.warn('WS connection error:', e);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChannel || isSending) return;
    setIsSending(true);

    const content = inputText.trim();
    try {
      const sent = await api.postMessage(workspaceId, activeChannel.id, { content });
      setMessages((prev) => {
        if (prev.some((m) => m.id === sent.id)) return prev;
        return [...prev, sent];
      });
      setInputText('');
    } catch (err) {
      alert(`Send error: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  // Open Teams Thread Side Panel
  const handleOpenThread = async (msg) => {
    setThreadRootMessage(msg);
    setThreadReplies([]);
    try {
      const replies = await api.listMessages(workspaceId, activeChannel.id, msg.id, false);
      setThreadReplies(replies || []);
    } catch (err) {
      console.warn('Could not load thread replies:', err);
    }
  };

  // Send Thread Reply
  const handleSendThreadReply = async (e) => {
    e.preventDefault();
    if (!threadInputText.trim() || !threadRootMessage || isThreadSending) return;
    setIsThreadSending(true);

    try {
      const sent = await api.postMessage(workspaceId, activeChannel.id, {
        content: threadInputText.trim(),
        parent_id: threadRootMessage.id,
      });
      setThreadReplies((prev) => {
        if (prev.some((m) => m.id === sent.id)) return prev;
        return [...prev, sent];
      });
      // Increment reply_count on the root message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === threadRootMessage.id
            ? { ...m, reply_count: (m.reply_count || 0) + 1 }
            : m
        )
      );
      setThreadInputText('');
    } catch (err) {
      alert(`Thread reply error: ${err.message}`);
    } finally {
      setIsThreadSending(false);
    }
  };

  // Toggle Reaction on message
  const handleToggleReaction = async (messageId, emoji) => {
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
      alert(`Create subchat error: ${err.message}`);
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

  const generalChannel = (channels || []).find((c) => c.name === 'general');
  const subchatChannels = (channels || []).filter((c) => c.name !== 'general');

  const filteredSubchats = subchatChannels.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex overflow-hidden -m-6 md:-m-8 bg-[#F8FAFC] text-[#191C1E] font-sans">
      {/* 1. Left Channel Navigation Sidebar */}
      <aside className="w-72 bg-white border-r border-[#E2E8F0] flex flex-col h-full flex-shrink-0 select-none shadow-sm">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#4F46E5]" />
            <h2 className="font-bold text-sm text-[#191C1E] tracking-tight">Teams & Channels</h2>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            title="Create New Channel"
            className="p-1.5 bg-[#F2F4F6] hover:bg-[#ECEEF0] text-[#4F46E5] rounded-xl transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Channel Search */}
        <div className="p-3 border-b border-[#E2E8F0]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search channels..."
              className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl pl-9 pr-3 py-1.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5] placeholder-slate-400 transition"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Channel Lists */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Main Workspace Channel (#general) */}
          <div>
            <div className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Main Workspace</span>
              <span className="bg-indigo-50 text-[#4F46E5] text-[9px] px-1.5 py-0.5 rounded font-bold">
                Teams
              </span>
            </div>

            {generalChannel ? (
              <button
                onClick={() => setActiveChannel(generalChannel)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition ${
                  activeChannel?.id === generalChannel.id
                    ? 'bg-[#4F46E5] text-white shadow-sm font-bold'
                    : 'text-slate-700 hover:bg-[#F2F4F6]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 shrink-0" />
                  <span className="truncate">general</span>
                </div>
                {unreadCounts[generalChannel.id] > 0 && activeChannel?.id !== generalChannel.id && (
                  <span className="bg-[#4F46E5] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {unreadCounts[generalChannel.id]}
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={() => {
                  api.createChannel(workspaceId, {
                    name: 'general',
                    description: 'General team channel',
                  }).then(() => onRefreshChannels && onRefreshChannels());
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs text-[#4F46E5] bg-indigo-50 hover:bg-indigo-100 font-bold transition flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5" /> Initialize #general
              </button>
            )}
          </div>

          {/* Subchannels & Topic Channels */}
          <div>
            <div className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Channels ({filteredSubchats.length})</span>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-[10px] text-[#4F46E5] hover:underline font-bold"
              >
                + Channel
              </button>
            </div>

            <div className="space-y-1">
              {filteredSubchats.length === 0 ? (
                <div className="px-2 py-3 text-center text-slate-400 text-xs italic bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
                  No subchannels yet. Click "+ Channel" to create one.
                </div>
              ) : (
                filteredSubchats.map((ch) => {
                  const isActive = activeChannel?.id === ch.id;
                  const unread = unreadCounts[ch.id] || 0;

                  return (
                    <button
                      key={ch.id}
                      onClick={() => setActiveChannel(ch)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                        isActive
                          ? 'bg-[#4F46E5] text-white shadow-sm font-bold'
                          : 'text-slate-700 hover:bg-[#F2F4F6]'
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
                        <span className="bg-[#4F46E5] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {unread}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Active Collaborators Presence Strip */}
          <div className="pt-2 border-t border-[#E2E8F0]">
            <div className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Live Presence</span>
              <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            </div>
            <div className="space-y-1 px-1">
              {presenceList.slice(0, 4).map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-1 px-2 rounded-lg text-xs text-slate-600 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="relative">
                      <div className="w-5 h-5 rounded-full bg-indigo-100 text-[#4F46E5] flex items-center justify-center text-[10px] font-bold">
                        {p.user_name ? p.user_name.slice(0, 2).toUpperCase() : 'US'}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${
                          p.status === 'online'
                            ? 'bg-emerald-500'
                            : p.status === 'away'
                            ? 'bg-amber-500'
                            : p.status === 'busy'
                            ? 'bg-rose-500'
                            : 'bg-slate-400'
                        }`}
                      />
                    </div>
                    <span className="truncate font-medium text-slate-700">{p.user_name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 capitalize">{p.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* 2. Main Chat Conversation Area */}
      <main className="flex-1 flex flex-col h-full bg-white overflow-hidden shadow-sm relative">
        {activeChannel ? (
          <>
            {/* Chat Top Header */}
            <header className="p-4 border-b border-[#E2E8F0] bg-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-[#4F46E5] flex items-center justify-center font-bold">
                  {activeChannel.is_private ? <Lock className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#191C1E] flex items-center gap-2">
                    <span>#{activeChannel.name}</span>
                    {activeChannel.name === 'general' && (
                      <span className="text-[9px] font-mono bg-indigo-100 text-[#4F46E5] px-2 py-0.5 rounded-full font-bold">
                        General Channel
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-sans">
                    {activeChannel.description ||
                      (activeChannel.name === 'general'
                        ? 'General workspace chat for all team members.'
                        : 'Dedicated discussion channel.')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-mono flex items-center gap-1.5 bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-1.5 rounded-xl">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>{presenceList.length || 1} Present</span>
                </span>
              </div>
            </header>

            {/* Message Feed */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F8FAFC]">
              {messages.length === 0 ? (
                <div className="text-center py-16 text-slate-400 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-white border border-[#E2E8F0] flex items-center justify-center mx-auto text-[#4F46E5] shadow-sm">
                    <Hash className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-[#191C1E]">
                      Welcome to #{activeChannel.name}!
                    </h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Start the conversation, share updates, or reply in threads.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg) => {
                  const isHovered = activeHoverMessageId === msg.id;
                  const replyCount = msg.reply_count || 0;

                  return (
                    <div
                      key={msg.id}
                      onMouseEnter={() => setActiveHoverMessageId(msg.id)}
                      onMouseLeave={() => setActiveHoverMessageId(null)}
                      className="flex gap-3 group relative rounded-2xl p-2 transition hover:bg-white/80"
                    >
                      {/* Avatar with Presence Dot */}
                      <div className="relative shrink-0 mt-0.5">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-xs font-bold text-[#4F46E5]">
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
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-xs text-[#191C1E]">
                            {msg.sender_name || 'Teammate'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {/* Message Bubble */}
                        <div className="mt-1 bg-white border border-[#E2E8F0] rounded-2xl rounded-tl-none p-3.5 shadow-sm text-xs text-[#191C1E] max-w-2xl leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </div>

                        {/* Reaction Badges List */}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {msg.reactions.map((r, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleToggleReaction(msg.id, r.emoji)}
                                className={`px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border transition ${
                                  r.has_reacted
                                    ? 'bg-indigo-50 border-[#4F46E5] text-[#4F46E5] font-bold shadow-sm'
                                    : 'bg-white border-[#E2E8F0] text-slate-600 hover:border-slate-300'
                                }`}
                              >
                                <span>{r.emoji}</span>
                                <span className="font-mono text-[10px]">{r.count}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Teams Thread Reply Trigger */}
                        <div className="mt-1.5 flex items-center gap-3 text-xs">
                          {replyCount > 0 ? (
                            <button
                              onClick={() => handleOpenThread(msg)}
                              className="text-xs font-bold text-[#4F46E5] hover:underline flex items-center gap-1"
                            >
                              <CornerDownRight className="w-3.5 h-3.5" />
                              <span>
                                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                              </span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenThread(msg)}
                              className="opacity-0 group-hover:opacity-100 text-[11px] font-medium text-slate-400 hover:text-[#4F46E5] transition flex items-center gap-1"
                            >
                              <Reply className="w-3 h-3" /> Reply in thread
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Hover Action Bar (Reactions + Reply) */}
                      {isHovered && (
                        <div className="absolute right-4 -top-3 bg-white border border-[#E2E8F0] rounded-xl px-2 py-1 shadow-lg flex items-center gap-1 z-10 animate-in fade-in zoom-in-95">
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
                            className="p-1 text-slate-500 hover:text-[#4F46E5] hover:bg-indigo-50 rounded-lg transition"
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

            {/* Message Input Form */}
            <form
              onSubmit={handleSendMessage}
              className="p-4 border-t border-[#E2E8F0] bg-white flex items-center gap-2"
            >
              <input
                type="text"
                placeholder={`Message #${activeChannel.name}...`}
                className="flex-1 bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] placeholder-slate-400 focus:outline-none transition"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />

              <button
                type="submit"
                disabled={!inputText.trim() || isSending}
                className="bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
            Select or create a channel to start communicating with your team.
          </div>
        )}
      </main>

      {/* 3. Microsoft Teams Dedicated Thread Side Panel */}
      {threadRootMessage && (
        <aside className="w-96 bg-white border-l border-[#E2E8F0] flex flex-col h-full flex-shrink-0 shadow-lg animate-in slide-in-from-right duration-200">
          {/* Thread Panel Header */}
          <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CornerDownRight className="w-4 h-4 text-[#4F46E5]" />
              <h3 className="font-bold text-sm text-[#191C1E]">Thread</h3>
            </div>
            <button
              onClick={() => setThreadRootMessage(null)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Root Message Card */}
          <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC] space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-[#4F46E5] flex items-center justify-center text-[10px] font-bold">
                {threadRootMessage.sender_name
                  ? threadRootMessage.sender_name.slice(0, 2).toUpperCase()
                  : 'US'}
              </div>
              <div>
                <span className="font-bold text-xs text-[#191C1E]">
                  {threadRootMessage.sender_name || 'Teammate'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono ml-2">
                  {new Date(threadRootMessage.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
            <div className="text-xs text-slate-800 leading-relaxed bg-white p-3 rounded-xl border border-slate-200">
              {threadRootMessage.content}
            </div>
            {/* Root Reactions */}
            {threadRootMessage.reactions && threadRootMessage.reactions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {threadRootMessage.reactions.map((r, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleToggleReaction(threadRootMessage.id, r.emoji)}
                    className="px-2 py-0.5 rounded-full text-xs flex items-center gap-1 bg-white border border-[#E2E8F0] text-slate-600"
                  >
                    <span>{r.emoji}</span>
                    <span className="font-mono text-[10px]">{r.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Thread Replies List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC]">
            {threadReplies.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                No replies yet. Be the first to reply in this thread!
              </div>
            ) : (
              threadReplies.map((reply) => (
                <div key={reply.id} className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                    {reply.sender_name ? reply.sender_name.slice(0, 2).toUpperCase() : 'US'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold text-[11px] text-[#191C1E]">
                        {reply.sender_name || 'Teammate'}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400">
                        {new Date(reply.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="mt-1 bg-white border border-[#E2E8F0] rounded-xl p-2.5 text-xs text-[#191C1E] leading-relaxed shadow-sm">
                      {reply.content}
                    </div>

                    {/* Reply Reactions */}
                    {reply.reactions && reply.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {reply.reactions.map((r, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleToggleReaction(reply.id, r.emoji)}
                            className="px-1.5 py-0.5 rounded-full text-[10px] flex items-center gap-1 bg-white border border-[#E2E8F0]"
                          >
                            <span>{r.emoji}</span>
                            <span className="font-mono">{r.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={threadEndRef} />
          </div>

          {/* Thread Reply Input Form */}
          <form
            onSubmit={handleSendThreadReply}
            className="p-3 border-t border-[#E2E8F0] bg-white flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="Reply to thread..."
              className="flex-1 bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-3 py-2 text-xs text-[#191C1E] placeholder-slate-400 focus:outline-none transition"
              value={threadInputText}
              onChange={(e) => setThreadInputText(e.target.value)}
            />
            <button
              type="submit"
              disabled={!threadInputText.trim() || isThreadSending}
              className="bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white p-2 rounded-xl transition shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </aside>
      )}

      {/* Create Channel Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] max-w-sm w-full space-y-4 shadow-2xl text-[#191C1E]">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#191C1E]">Create Teams Channel</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Create a dedicated channel for team syncs, engineering tasks, or topic-based rooms.
            </p>

            <form onSubmit={handleCreateSubchat} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Channel Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400 text-xs">#</span>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="frontend-team"
                    className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl pl-7 pr-3 py-2 text-xs text-[#191C1E] focus:outline-none"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dedicated discussion for frontend devs"
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#191C1E] focus:outline-none"
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="private-check"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="rounded border-[#CBD5E1] text-[#4F46E5]"
                />
                <label htmlFor="private-check" className="text-xs text-slate-700 cursor-pointer">
                  Private Channel (Restricted to invited members)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-sm"
                >
                  Create Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
