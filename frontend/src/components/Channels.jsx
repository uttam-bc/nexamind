import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Plus,
  Send,
  Hash,
  Users,
  Search,
  User,
  Sparkles,
  Lock,
  Globe,
  Smile,
  X,
  Reply,
  CheckCircle2,
  MoreVertical,
} from 'lucide-react';
import { api, getAuthToken } from '../api';

export default function Channels({
  workspaceId,
  workspace,
  user,
  channels,
  onRefreshChannels,
}) {
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Set default active channel (prioritize 'general')
  useEffect(() => {
    if (channels && channels.length > 0) {
      if (!activeChannel) {
        const generalChan = channels.find((c) => c.name === 'general') || channels[0];
        setActiveChannel(generalChan);
      }
    }
  }, [channels, activeChannel]);

  // Load messages & connect websocket when activeChannel changes
  useEffect(() => {
    if (activeChannel && workspaceId) {
      loadMessagesAndConnectWS(activeChannel.id);
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [activeChannel, workspaceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMessagesAndConnectWS = async (channelId) => {
    try {
      const msgs = await api.listMessages(workspaceId, channelId);
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
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.data.id)) return prev;
              return [...prev, payload.data];
            });
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

    let content = inputText.trim();
    if (replyingTo) {
      content = `> Replying to @${replyingTo.sender_name || 'Teammate'}: "${replyingTo.content.slice(0, 35)}..."\n${content}`;
    }

    try {
      const sent = await api.postMessage(workspaceId, activeChannel.id, { content });
      setMessages((prev) => {
        if (prev.some((m) => m.id === sent.id)) return prev;
        return [...prev, sent];
      });
      setInputText('');
      setReplyingTo(null);
    } catch (err) {
      alert(`Send error: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleCreateSubchat = async (e) => {
    e.preventDefault();
    const cleanName = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
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
            <h2 className="font-bold text-sm text-[#191C1E] tracking-tight">Channels & Subchats</h2>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            title="Create New Subchat"
            className="p-1.5 bg-[#F2F4F6] hover:bg-[#ECEEF0] text-[#4F46E5] rounded-lg transition"
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
              placeholder="Search subchats..."
              className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl pl-9 pr-3 py-1.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Channel Lists */}
        <div className="flex-1 overflow-y-auto p-3 space-y-5">
          {/* Main Team Channel (#general) */}
          <div>
            <div className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Main Workspace Chat</span>
              <span className="bg-indigo-50 text-[#4F46E5] text-[9px] px-1.5 py-0.5 rounded font-bold">
                Everyone
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
                  <Hash className="w-4 h-4" />
                  <span>general</span>
                </div>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                    activeChannel?.id === generalChannel.id
                      ? 'bg-white/20 text-white'
                      : 'bg-[#ECEEF0] text-slate-500'
                  }`}
                >
                  All Team
                </span>
              </button>
            ) : (
              <button
                onClick={() => {
                  api.createChannel(workspaceId, { name: 'general', description: 'General team channel' })
                    .then(() => onRefreshChannels && onRefreshChannels());
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs text-[#4F46E5] bg-indigo-50 hover:bg-indigo-100 font-bold transition flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5" /> Initialize #general
              </button>
            )}
          </div>

          {/* Subchats & Topic Rooms */}
          <div>
            <div className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider px-2 mb-2 flex items-center justify-between">
              <span>Team Subchats</span>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-[10px] text-[#4F46E5] hover:underline font-bold"
              >
                + Subchat
              </button>
            </div>

            <div className="space-y-1">
              {filteredSubchats.length === 0 ? (
                <div className="px-2 py-3 text-center text-slate-400 text-xs italic bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
                  No subchats yet. Click "+ Subchat" to create a room for your subgroup.
                </div>
              ) : (
                filteredSubchats.map((ch) => {
                  const isActive = activeChannel?.id === ch.id;

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
                        {ch.is_private ? <Lock className="w-3.5 h-3.5" /> : <Hash className="w-3.5 h-3.5" />}
                        <span className="truncate">{ch.name}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Workspace Team Invite Card */}
          <div className="pt-2 border-t border-[#E2E8F0]">
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] p-3 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-600 font-bold">
                <span>Workspace Members</span>
                <span className="text-[10px] font-mono text-[#4F46E5] bg-indigo-50 px-1.5 py-0.5 rounded">
                  Join Code
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">
                Share this code with your real team members to collaborate in this workspace.
              </p>
              {workspace?.join_code && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(workspace.join_code);
                    alert(`Workspace Join Code copied: ${workspace.join_code}`);
                  }}
                  className="w-full py-1.5 px-2.5 bg-white border border-[#E2E8F0] hover:border-[#4F46E5] rounded-lg text-xs font-mono font-bold text-[#4F46E5] flex items-center justify-between transition"
                >
                  <span className="truncate">{workspace.join_code}</span>
                  <span className="text-[10px] font-sans font-semibold text-slate-500">Copy</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* 2. Main Chat Canvas */}
      <main className="flex-1 flex flex-col h-full bg-white overflow-hidden shadow-sm">
        {activeChannel ? (
          <>
            {/* Chat Top Header */}
            <header className="p-4 border-b border-[#E2E8F0] bg-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-[#4F46E5] flex items-center justify-center font-bold">
                  {activeChannel.is_private ? <Lock className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#191C1E] flex items-center gap-2">
                    <span>#{activeChannel.name}</span>
                    {activeChannel.name === 'general' && (
                      <span className="text-[9px] font-mono bg-indigo-100 text-[#4F46E5] px-2 py-0.5 rounded-full font-bold">
                        Main Team Channel
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-sans">
                    {activeChannel.description ||
                      (activeChannel.name === 'general'
                        ? 'General workspace chat for all team members.'
                        : 'Subchat for dedicated team discussions.')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-mono flex items-center gap-1 bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-1 rounded-lg">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>Team Workspace</span>
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
                      {activeChannel.name === 'general'
                        ? 'This is the main channel where all team members communicate.'
                        : 'This is a dedicated subchat for this topic.'}
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg) => {
                  const isReplying = msg.content?.startsWith('> Replying to');

                  return (
                    <div key={msg.id} className="flex gap-3 group">
                      <div className="w-8 h-8 rounded-full bg-slate-200 border border-[#E2E8F0] flex items-center justify-center text-xs font-bold text-[#4F46E5] shrink-0">
                        {msg.sender_name ? msg.sender_name.slice(0, 2).toUpperCase() : 'US'}
                      </div>

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

                        <div className="mt-1 bg-white border border-[#E2E8F0] rounded-2xl rounded-tl-none p-3.5 shadow-sm text-xs text-[#191C1E] max-w-2xl leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </div>

                        <button
                          onClick={() => setReplyingTo(msg)}
                          className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-slate-400 hover:text-[#4F46E5] mt-1 transition flex items-center gap-1"
                        >
                          <Reply className="w-3 h-3" /> Reply in thread
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Replying banner */}
            {replyingTo && (
              <div className="px-6 py-2 bg-indigo-50 border-t border-indigo-100 flex items-center justify-between text-xs text-[#4F46E5]">
                <span>Replying to <strong>@{replyingTo.sender_name || 'Teammate'}</strong></span>
                <button onClick={() => setReplyingTo(null)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Message Input Form */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-[#E2E8F0] bg-white flex items-center gap-2">
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

      {/* Create Subchat Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] max-w-sm w-full space-y-4 shadow-2xl text-[#191C1E]">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#191C1E]">Create Team Subchat</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Create a focused subchannel or topic room for a subgroup of teammates (e.g. #frontend-team, #backend-sync).
            </p>

            <form onSubmit={handleCreateSubchat} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Subchat Name
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
                  Private Subgroup (Restricted to invited members)
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
                  Create Subchat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
