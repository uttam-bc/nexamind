import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Mic,
  MicOff,
  Search,
  UserPlus,
  MessageSquare,
  Check,
  CheckCheck,
  Copy,
  Smile,
  Video,
  Clock,
  Sparkles,
  Users,
  Shield,
  Circle,
  Phone,
  MoreVertical,
  X,
  User,
} from 'lucide-react';
import { api } from '../api';
import FeatureHeader from './FeatureHeader';
import FormattedChatMessage from './FormattedChatMessage';

export default function SoloChat({
  workspaceId,
  user,
  onNavigateTab,
  onRefreshAll,
  onBack,
}) {
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // User search modal state for starting 1-on-1 chats
  const [showUserSearchModal, setShowUserSearchModal] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [startChatError, setStartChatError] = useState('');

  // Voice recording / speech recognition
  const [isRecording, setIsRecording] = useState(false);
  const speechRecognitionRef = useRef(null);

  const messagesEndRef = useRef(null);
  const pollingRef = useRef(null);

  // 1. Load DM channels for this workspace
  useEffect(() => {
    if (!workspaceId) return;
    loadDmChannels();
  }, [workspaceId]);

  const loadDmChannels = async (autoSelectFirst = true) => {
    try {
      setLoading(true);
      const allChannels = await api.listChannels(workspaceId);
      // Strictly 1-on-1 direct messages only - NO group channels allowed in Solo Chat!
      const dmList = (allChannels || []).filter(
        (c) => c.is_private && (c.name.startsWith('dm-') || c.name.includes('-'))
      );
      setChannels(dmList);

      if (autoSelectFirst && dmList.length > 0) {
        if (!activeChannel || !dmList.some((c) => c.id === activeChannel.id)) {
          selectChannel(dmList[0]);
        }
      }
    } catch (err) {
      console.warn('Error loading DM channels:', err);
    } finally {
      setLoading(false);
    }
  };

  // 2. Select a DM channel and load its messages
  const selectChannel = async (channel) => {
    if (!channel) return;
    setActiveChannel(channel);
    try {
      const msgs = await api.listMessages(workspaceId, channel.id);
      setMessages(msgs || []);
    } catch (err) {
      console.warn('Error loading channel messages:', err);
    }
  };

  // 3. Poll messages in active channel every 3 seconds for real-time live chat
  useEffect(() => {
    if (!workspaceId || !activeChannel) return;

    const poll = async () => {
      try {
        const msgs = await api.listMessages(workspaceId, activeChannel.id);
        if (msgs) {
          setMessages(msgs);
        }
      } catch (err) {
        // silent polling error
      }
    };

    pollingRef.current = setInterval(poll, 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [workspaceId, activeChannel]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 4. Send Message
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const content = inputText.trim();
    if (!content || !activeChannel || sending) return;

    setInputText('');
    setSending(true);

    // Optimistic UI update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: tempId,
      content,
      sender_id: user?.id,
      sender_name: user?.name || 'You',
      sender_username: user?.username || 'you',
      created_at: new Date().toISOString(),
      reactions: [],
      pending: true,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const sent = await api.postMessage(workspaceId, activeChannel.id, content);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? sent : m)));
      if (onRefreshAll) onRefreshAll();
    } catch (err) {
      alert(`Could not send message: ${err.message}`);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 5. Search users to start new direct 1-on-1 chat
  const handleSearchUsers = async (query) => {
    setUserSearchQuery(query);
    setStartChatError('');
    if (!query.trim() || query.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }
    setIsSearchingUsers(true);
    try {
      const clean = query.startsWith('@') ? query.slice(1) : query;
      const res = await api.searchUsers(clean);
      // Filter out yourself if you only want to message other users
      setUserSearchResults(res || []);
    } catch (err) {
      console.warn('User search error:', err);
    } finally {
      setIsSearchingUsers(false);
    }
  };

  const handleStartChatWithUser = async (targetUser) => {
    if (!targetUser?.username) return;
    try {
      setStartChatError('');
      const channel = await api.createOrOpenDm(workspaceId, targetUser.username);
      setShowUserSearchModal(false);
      setUserSearchQuery('');
      setUserSearchResults([]);
      // Refresh DM list and select new channel
      await loadDmChannels(false);
      selectChannel(channel);
    } catch (err) {
      setStartChatError(err.message || 'Could not start conversation with user');
    }
  };

  // 6. Voice Input (Speech Recognition)
  const toggleVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice dictation is supported in Chrome, Edge, and modern browsers.');
      return;
    }

    if (!isRecording) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => setIsRecording(true);
        recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        };
        recognition.onerror = () => setIsRecording(false);
        recognition.onend = () => setIsRecording(false);

        recognition.start();
        speechRecognitionRef.current = recognition;
      } catch (err) {
        setIsRecording(false);
      }
    } else {
      speechRecognitionRef.current?.stop();
      setIsRecording(false);
    }
  };

  // 7. Toggle Reaction
  const handleToggleReaction = async (messageId, emoji) => {
    if (!activeChannel) return;
    try {
      await api.toggleReaction(workspaceId, activeChannel.id, messageId, emoji);
      // refresh messages
      const updated = await api.listMessages(workspaceId, activeChannel.id);
      setMessages(updated);
    } catch (err) {
      console.warn('Reaction error:', err);
    }
  };

  // Derive other user's display details from channel
  const getParticipantDetails = (channel) => {
    if (!channel) return { name: 'Direct Chat', username: 'user', initial: 'U', isSelf: false };
    const myUsername = (user?.username || '').toLowerCase();

    // Channel name format: dm-u1-u2 or dm-u1-notes
    if (channel.name.endsWith('-notes')) {
      return {
        name: `${user?.name || 'You'} (Personal Notes)`,
        username: myUsername,
        initial: user?.name?.[0]?.toUpperCase() || 'Y',
        isSelf: true,
      };
    }

    if (channel.name.startsWith('dm-')) {
      const parts = channel.name.replace('dm-', '').split('-');
      if (parts.length >= 2) {
        const otherHandle = parts[0].toLowerCase() === myUsername ? parts[1] : parts[0];
        return {
          name: `@${otherHandle}`,
          username: otherHandle,
          initial: otherHandle[0]?.toUpperCase() || 'U',
          isSelf: false,
        };
      }
    }

    // Fallback: description parsing
    if (channel.description && channel.description.includes('@')) {
      const matches = channel.description.match(/@([a-zA-Z0-9_]+)/g);
      if (matches && matches.length > 0) {
        const otherMatch = matches.find((m) => m.slice(1).toLowerCase() !== myUsername) || matches[0];
        const cleanHandle = otherMatch.slice(1);
        return {
          name: `@${cleanHandle}`,
          username: cleanHandle,
          initial: cleanHandle[0]?.toUpperCase() || 'U',
          isSelf: false,
        };
      }
    }

    return {
      name: channel.name.replace('dm-', '@'),
      username: channel.name.replace('dm-', ''),
      initial: 'U',
      isSelf: false,
    };
  };

  const filteredChannels = channels.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const details = getParticipantDetails(c);
    return (
      details.name.toLowerCase().includes(q) ||
      details.username.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q)
    );
  });

  const activeParticipant = activeChannel ? getParticipantDetails(activeChannel) : null;

  return (
    <div className="h-full flex flex-col select-none">
      {/* 0. Feature Header with Back Button (Item 1) */}
      <FeatureHeader
        title="Direct Messages"
        icon={MessageSquare}
        badge="1-on-1 User Chat"
        onBack={onBack}
        actions={
          <button
            onClick={() => setShowUserSearchModal(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-xs active:scale-95"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ Message User</span>
          </button>
        }
      />

      {/* Main Chat Workspace Frame */}
      <div className="flex-1 flex gap-5 overflow-hidden min-h-0 pt-2">
        {/* 1. Left Sidebar: Direct Conversations List */}
        <div className="w-80 bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-col shadow-xs flex-shrink-0">
          {/* Top Bar: Search & New Chat */}
          <div className="space-y-2.5 mb-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                <span>Conversations ({channels.length})</span>
              </span>
              <button
                onClick={() => setShowUserSearchModal(true)}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-bold hover:underline"
              >
                + New Chat
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search direct chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 placeholder-slate-400 transition"
              />
            </div>
          </div>

          {/* Conversation Thread Items */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {loading && channels.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-400">Loading chats...</div>
            ) : filteredChannels.length === 0 ? (
              <div className="text-center py-12 px-4 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto text-indigo-600">
                  <UserPlus className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-xs text-slate-800">No Direct Chats Yet</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    In Solo mode, you can message any user directly by their @username.
                  </p>
                </div>
                <button
                  onClick={() => setShowUserSearchModal(true)}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
                >
                  Find a User to Chat
                </button>
              </div>
            ) : (
              filteredChannels.map((chan) => {
                const isSelected = activeChannel?.id === chan.id;
                const details = getParticipantDetails(chan);

                return (
                  <button
                    key={chan.id}
                    onClick={() => selectChannel(chan)}
                    className={`w-full text-left p-3 rounded-xl transition flex items-center gap-3 border ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-bold shadow-xs'
                        : 'bg-white border-transparent hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {/* User Avatar */}
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-xs shadow-xs">
                        {details.initial}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-emerald-500" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {details.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {chan.created_at ? new Date(chan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] text-indigo-600 font-mono font-medium">
                          @{details.username}
                        </span>
                        <span className="text-[10px] text-slate-400 truncate">
                          • 1-on-1 Direct Message
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 2. Right Main Panel: Active 1-on-1 User Conversation */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col h-full overflow-hidden min-h-0">
          {activeChannel && activeParticipant ? (
            <>
              {/* Chat Header */}
              <div className="p-3.5 sm:p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-sm shadow-xs">
                      {activeParticipant.initial}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-emerald-500" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-sm text-slate-900">
                        {activeParticipant.name}
                      </h3>
                      <span className="bg-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">
                        @{activeParticipant.username}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Private Direct Message • Only visible to you and @{activeParticipant.username}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (onNavigateTab) onNavigateTab('meetings');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-700 transition"
                    title="Start Video Meeting with user"
                  >
                    <Video className="w-3.5 h-3.5 text-indigo-600" />
                    <span className="hidden sm:inline">Start Call</span>
                  </button>
                </div>
              </div>

              {/* Message Stream */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/20">
                {messages.length === 0 ? (
                  <div className="text-center py-16 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto text-indigo-600">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-800">
                        No messages yet with {activeParticipant.name}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                        Say hello! Send an idea, question, or note to begin your conversation.
                      </p>
                    </div>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOutgoing = msg.sender_id === user?.id || msg.sender_username === user?.username;

                    return (
                      <div
                        key={msg.id}
                        className={`flex gap-3 max-w-2xl group ${
                          isOutgoing ? 'ml-auto flex-row-reverse' : 'mr-auto'
                        }`}
                      >
                        {/* Avatar for incoming */}
                        {!isOutgoing && (
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-xs">
                            {msg.sender_name?.[0]?.toUpperCase() || 'U'}
                          </div>
                        )}

                        <div className={`space-y-1 ${isOutgoing ? 'items-end' : 'items-start'}`}>
                          {/* Sender name for incoming messages */}
                          {!isOutgoing && (
                            <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-500 font-medium">
                              <span className="font-bold text-slate-800">{msg.sender_name}</span>
                              {msg.sender_username && (
                                <span className="font-mono text-indigo-600">
                                  @{msg.sender_username}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Message Bubble */}
                          <div
                            className={`p-3.5 px-4 rounded-2xl text-sm leading-relaxed ${
                              isOutgoing
                                ? 'bg-indigo-600 text-white rounded-tr-none shadow-sm font-medium whitespace-pre-wrap'
                                : 'bg-white border border-slate-200 text-slate-900 rounded-tl-none shadow-xs font-normal'
                            }`}
                          >
                            {isOutgoing ? (
                              msg.content
                            ) : (
                              <FormattedChatMessage content={msg.content} isUser={false} />
                            )}
                          </div>

                          {/* Time & Reactions */}
                          <div
                            className={`flex items-center gap-2 px-1 text-[10px] text-slate-400 font-mono ${
                              isOutgoing ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            <span>
                              {msg.created_at
                                ? new Date(msg.created_at).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : ''}
                            </span>
                            {isOutgoing && (
                              <CheckCheck className="w-3.5 h-3.5 text-indigo-500 inline" />
                            )}

                            {/* Quick Emoji Reaction Pill */}
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition ml-2">
                              {['👍', '❤️', '🔥', '🚀'].map((em) => (
                                <button
                                  key={em}
                                  type="button"
                                  onClick={() => handleToggleReaction(msg.id, em)}
                                  className="hover:scale-125 transition text-xs"
                                >
                                  {em}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Display Reactions */}
                          {msg.reactions && msg.reactions.length > 0 && (
                            <div className="flex items-center gap-1 pt-0.5">
                              {msg.reactions.map((r, rIdx) => (
                                <button
                                  key={rIdx}
                                  onClick={() => handleToggleReaction(msg.id, r.emoji)}
                                  className={`px-2 py-0.5 rounded-full border text-[11px] flex items-center gap-1 transition ${
                                    r.has_reacted
                                      ? 'bg-indigo-50 border-indigo-300 text-indigo-800 font-bold'
                                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  <span>{r.emoji}</span>
                                  <span className="font-mono">{r.count}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Input Bar */}
              <form
                onSubmit={handleSendMessage}
                className="p-3 sm:p-4 border-t border-slate-200 bg-white flex items-center gap-2"
              >
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  className={`p-2.5 rounded-xl border transition ${
                    isRecording
                      ? 'bg-rose-50 border-rose-300 text-rose-600 animate-pulse'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                  title={isRecording ? 'Listening... click to stop' : 'Voice Dictation'}
                >
                  {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message @${activeParticipant.username}... (Press Enter to send)`}
                  disabled={sending}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 placeholder-slate-400 shadow-xs"
                />

                <button
                  type="submit"
                  disabled={!inputText.trim() || sending}
                  className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white rounded-xl transition shadow-sm active:scale-95"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 max-w-md mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
                <MessageSquare className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">1-on-1 User Direct Messages</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  In Solo mode, conversations are strictly 1-on-1 with other users. Select an existing conversation from the list or start a new chat.
                </p>
              </div>
              <button
                onClick={() => setShowUserSearchModal(true)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-2xl text-xs font-bold shadow-md shadow-indigo-600/30 transition active:scale-95"
              >
                <UserPlus className="w-4 h-4" />
                <span>Message a User by @Username</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. User Search Modal to Start New 1-on-1 Chat */}
      {showUserSearchModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 w-full max-w-md shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-600" />
                <h3 className="font-extrabold text-lg text-slate-900">
                  New 1-on-1 Direct Message
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowUserSearchModal(false);
                  setUserSearchQuery('');
                  setUserSearchResults([]);
                }}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Find any colleague or team member by their unique @username or name to start a private conversation.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">
                Search @Username or Name
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. @alex, john, sarah..."
                  value={userSearchQuery}
                  onChange={(e) => handleSearchUsers(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                />
                {isSearchingUsers && (
                  <span className="absolute right-3 top-2.5 text-[10px] text-slate-400 font-mono animate-pulse">
                    searching...
                  </span>
                )}
              </div>
            </div>

            {startChatError && (
              <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs font-medium">
                {startChatError}
              </div>
            )}

            {/* User Search Results */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {userSearchResults.length > 0 ? (
                userSearchResults.map((u) => {
                  const isCurrent = u.id === user?.id;
                  return (
                    <div
                      key={u.id}
                      className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-indigo-50/60 hover:border-indigo-200 flex items-center justify-between transition text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-xs">
                          {u.name?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{u.name}</span>
                            {isCurrent && (
                              <span className="text-[9px] bg-slate-200 text-slate-700 px-1 rounded">
                                you
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-indigo-600 font-mono">
                            @{u.username}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleStartChatWithUser(u)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs active:scale-95"
                      >
                        Message
                      </button>
                    </div>
                  );
                })
              ) : userSearchQuery.trim().length >= 2 && !isSearchingUsers ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No users found matching "{userSearchQuery}".
                </div>
              ) : (
                <div className="text-center py-6 text-xs text-slate-400">
                  Type at least 2 characters to search users.
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowUserSearchModal(false);
                  setUserSearchQuery('');
                  setUserSearchResults([]);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
