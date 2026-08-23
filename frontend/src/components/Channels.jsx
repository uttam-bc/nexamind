import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Plus,
  Send,
  Hash,
  Users,
  Radio,
  Sparkles,
  Info,
  Smile,
  Search,
  Reply,
  X,
  CheckCircle2,
} from 'lucide-react';
import { api, getAuthToken } from '../api';

export default function Channels({ workspaceId, channels, onRefreshChannels }) {
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [reactions, setReactions] = useState({});
  const [replyingTo, setReplyingTo] = useState(null);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    if (channels && channels.length > 0 && !activeChannel) {
      handleSelectChannel(channels[0]);
    }
  }, [channels]);

  useEffect(() => {
    if (activeChannel) {
      loadMessagesAndConnectWS(activeChannel.id);
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [activeChannel, workspaceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSelectChannel = (channel) => {
    setActiveChannel(channel);
    setReplyingTo(null);
  };

  const loadMessagesAndConnectWS = async (channelId) => {
    try {
      const msgs = await api.listMessages(workspaceId, channelId);
      setMessages(msgs);
    } catch (err) {
      console.error('Error fetching channel messages', err);
    }

    if (wsRef.current) wsRef.current.close();
    const token = getAuthToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/workspaces/${workspaceId}/channels/${channelId}?token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === 'new_message' && payload.data) {
          setMessages((prev) => [...prev, payload.data]);
        } else if (payload.event === 'typing_start') {
          if (payload.user && !typingUsers.includes(payload.user)) {
            setTypingUsers((prev) => [...prev, payload.user]);
          }
        } else if (payload.event === 'typing_stop') {
          setTypingUsers((prev) => prev.filter((u) => u !== payload.user));
        }
      } catch (err) {
        console.error('WS parsing error:', err);
      }
    };

    wsRef.current = ws;
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChannel) return;
    let content = inputText.trim();
    if (replyingTo) {
      content = `> Replying to @${replyingTo.sender_name || 'Member'}: "${replyingTo.content.slice(0, 40)}..."\n${content}`;
    }
    setInputText('');
    setReplyingTo(null);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'message', content }));
    } else {
      await api.postMessage(workspaceId, activeChannel.id, content);
      const msgs = await api.listMessages(workspaceId, activeChannel.id);
      setMessages(msgs);
    }
  };

  const handleAddReaction = (msgId, emoji) => {
    setReactions((prev) => {
      const msgReactions = prev[msgId] || {};
      const currentCount = msgReactions[emoji] || 0;
      return {
        ...prev,
        [msgId]: {
          ...msgReactions,
          [emoji]: currentCount + 1,
        },
      };
    });
  };

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (!isTyping) {
        setIsTyping(true);
        wsRef.current.send(JSON.stringify({ action: 'typing_start' }));
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setIsTyping(false);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: 'typing_stop' }));
        }
      }, 1500);
    }
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    try {
      const created = await api.createChannel(workspaceId, { name: newChannelName.trim() });
      setShowCreateModal(false);
      setNewChannelName('');
      await onRefreshChannels();
      setActiveChannel(created);
    } catch (err) {
      alert(err.message);
    }
  };

  const filteredMessages = messages.filter((m) =>
    m.content.toLowerCase().includes(messageSearch.toLowerCase())
  );

  return (
    <div className="h-full flex gap-6">
      {/* Channels Sidebar */}
      <div className="w-80 glass-panel p-4 rounded-2xl border border-slate-800 flex flex-col h-full">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
              Channels ({channels.length})
            </h3>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
            title="Create Channel"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {channels.map((channel) => {
            const isSelected = activeChannel?.id === channel.id;
            return (
              <button
                key={channel.id}
                onClick={() => handleSelectChannel(channel)}
                className={`w-full text-left p-3 rounded-xl transition flex items-center justify-between border ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500 text-slate-100 font-bold shadow-sm'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Hash className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                  <span className="text-xs truncate">{channel.name}</span>
                </div>
              </button>
            );
          })}

          {channels.length === 0 && (
            <div className="text-center text-slate-500 py-10 text-xs">No channels created.</div>
          )}
        </div>
      </div>

      {/* Chat Area & Info Drawer */}
      <div className="flex-1 glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col h-full overflow-hidden bg-slate-950/40">
        {activeChannel ? (
          <div className="flex flex-col h-full">
            {/* Channel Top Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-2.5">
                <Hash className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="font-extrabold text-base text-slate-100">{activeChannel.name}</h3>
                  <div className="text-[10px] text-slate-500">Real-time team channel</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Message Search */}
                <div className="relative w-44">
                  <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    placeholder="Search channel..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                    value={messageSearch}
                    onChange={(e) => setMessageSearch(e.target.value)}
                  />
                </div>

                <button
                  onClick={() => setShowChannelInfo(!showChannelInfo)}
                  className={`p-1.5 rounded-lg border text-xs transition ${
                    showChannelInfo
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-slate-900 text-slate-400 border-slate-800'
                  }`}
                  title="Channel Information"
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Main Chat Body & Optional Info Drawer */}
            <div className="flex-1 flex min-h-0 gap-4">
              {/* Messages Feed */}
              <div className="flex-1 overflow-y-auto space-y-3 p-2 pr-3 flex flex-col">
                {filteredMessages.map((m, idx) => {
                  const msgReactions = reactions[m.id || idx] || {};
                  return (
                    <div key={idx} className="group flex items-start gap-3 text-xs">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 flex items-center justify-center font-bold text-slate-200 text-xs flex-shrink-0 shadow">
                        {(m.sender_name || 'U').slice(0, 2).toUpperCase()}
                      </div>

                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200">{m.sender_name || 'Team Member'}</span>
                            <span className="text-[10px] text-slate-500">
                              {m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                            </span>
                          </div>

                          {/* Quick Emoji Reaction & Reply Buttons */}
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 transition">
                            {['👍', '🔥', '❤️', '🚀', '✅'].map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => handleAddReaction(m.id || idx, emoji)}
                                className="hover:scale-125 px-1 transition text-xs"
                              >
                                {emoji}
                              </button>
                            ))}
                            <button
                              onClick={() => setReplyingTo(m)}
                              className="text-slate-400 hover:text-indigo-400 px-1"
                              title="Reply"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="bg-slate-900/90 border border-slate-800/80 p-3 rounded-2xl rounded-tl-none text-slate-200 text-xs leading-relaxed max-w-2xl w-fit whitespace-pre-wrap">
                          {m.content}
                        </div>

                        {/* Render Reactions Badges */}
                        {Object.keys(msgReactions).length > 0 && (
                          <div className="flex gap-1 pt-0.5">
                            {Object.entries(msgReactions).map(([emoji, count]) => (
                              <span
                                key={emoji}
                                className="inline-flex items-center gap-1 bg-slate-900/90 border border-slate-800 text-[11px] px-2 py-0.5 rounded-full font-mono"
                              >
                                <span>{emoji}</span>
                                <span className="text-slate-400 font-bold">{count}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Channel Info Drawer */}
              {showChannelInfo && (
                <div className="w-72 bg-slate-900/95 border border-slate-800 rounded-2xl p-4 space-y-4 animate-fade-in flex flex-col">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-xs uppercase tracking-wider text-slate-400">
                      Channel Details
                    </span>
                    <button onClick={() => setShowChannelInfo(false)} className="text-slate-400 hover:text-slate-200">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-500 text-[10px] uppercase font-bold block">Channel Name</span>
                      <span className="font-bold text-slate-100">#{activeChannel.name}</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[10px] uppercase font-bold block">Topic</span>
                      <p className="text-slate-300 text-xs mt-0.5">
                        Team real-time collaboration and project synchronization.
                      </p>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[10px] uppercase font-bold block">Created</span>
                      <span className="text-slate-300">
                        {new Date(activeChannel.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[10px] uppercase font-bold block">Total Messages</span>
                      <span className="font-mono text-indigo-400 font-bold">{messages.length}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Typing Indicator */}
            {typingUsers.length > 0 && (
              <div className="text-[11px] text-indigo-400 italic px-2 py-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
                <span>{typingUsers.join(', ')} is typing...</span>
              </div>
            )}

            {/* Replying Banner */}
            {replyingTo && (
              <div className="bg-indigo-950/40 border border-indigo-500/30 p-2 rounded-xl text-xs flex items-center justify-between text-indigo-200 mb-2">
                <div className="flex items-center gap-2 truncate">
                  <Reply className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="truncate">
                    Replying to <strong>@{replyingTo.sender_name || 'Member'}</strong>: "{replyingTo.content.slice(0, 50)}..."
                  </span>
                </div>
                <button onClick={() => setReplyingTo(null)} className="text-slate-400 hover:text-slate-200">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Message Input Box */}
            <form onSubmit={handleSendMessage} className="mt-2 flex gap-2">
              <input
                type="text"
                placeholder={`Message #${activeChannel.name}...`}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500"
                value={inputText}
                onChange={handleInputChange}
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 rounded-xl text-xs font-bold transition shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-16">
            <MessageSquare className="w-12 h-12 mb-3 text-slate-600" />
            <span className="text-sm font-semibold">Select or create a channel</span>
          </div>
        )}
      </div>

      {/* Create Channel Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-slate-100">Create Channel</h3>
            <form onSubmit={handleCreateChannel} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. general-sync"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold"
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
