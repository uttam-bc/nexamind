import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Sparkles,
  FolderKanban,
  FileText,
  MessageSquare,
  Mic,
  MicOff,
  RotateCcw,
  Calendar,
  Trash2,
  Bot,
  User,
  Terminal,
  Brain,
  Key,
  Plus,
  Clock,
  ChevronRight,
  Database,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api';
import FeatureHeader from './FeatureHeader';
import FormattedChatMessage from './FormattedChatMessage';
import GeminiKeySettings from './GeminiKeySettings';
import { notify, confirmDialog } from '../context/ToastContext';

export default function AiAssistant({
  workspaceId,
  onNavigateTab,
  onRefreshAll,
  onSwitchWorkspace,
  onBack,
}) {
  const defaultGreeting = {
    role: 'assistant',
    content:
      'Hello! I am your **NexaMind Autonomous Agentic AI**.\n\n' +
      'I possess persistent memory and direct database authority across this workspace.\n\n' +
      'Here is what I can execute for you:\n' +
      '- 🧠 **Synthesize workspace memory** across your documents, chats, tasks, and meetings\n' +
      '- 📄 **Create & edit Notion documents**\n' +
      '- 📊 **Create, prioritize & update Kanban tasks** (To Do, In Progress, Done)\n' +
      '- 📅 **Schedule calendar meetings**\n' +
      '- 💬 **Post broadcasts to channels**\n' +
      '- 🔄 **Switch between Solo & Group spaces**\n\n' +
      'How can I assist your workflow today?',
    tool_calls: [],
    timestamp: new Date().toISOString(),
  };

  // Chat & Session states
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([defaultGreeting]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [activePlanSteps, setActivePlanSteps] = useState([]);

  // Memory & API Key drawers
  const [memoryStats, setMemoryStats] = useState(null);
  const [showMemoryDrawer, setShowMemoryDrawer] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [aiConfig, setAiConfig] = useState(null);
  const modelConfigured = !!(aiConfig?.has_personal_key || aiConfig?.server_gemini_available || aiConfig?.server_groq_available);

  const messagesEndRef = useRef(null);
  const speechRecognitionRef = useRef(null);

  // Load sessions list on workspace change
  useEffect(() => {
    if (!workspaceId) return;
    loadSessions();
    loadMemoryStats();
  }, [workspaceId]);

  const loadSessions = async () => {
    try {
      const list = await api.listAiSessions(workspaceId);
      setSessions(list || []);
      if (list && list.length > 0 && !activeSessionId) {
        // Switch to the most recent session; with none, the first message starts one.
        selectSession(list[0].id);
      }
    } catch (err) {
      console.warn('Could not load sessions:', err);
    }
  };

  const loadMemoryStats = async () => {
    try {
      const stats = await api.getMemoryStats(workspaceId);
      setMemoryStats(stats);
    } catch (err) {
      console.warn('Could not load memory stats:', err);
    }
  };

  const selectSession = async (sessionId) => {
    setActiveSessionId(sessionId);
    try {
      const history = await api.getAiSessionMessages(workspaceId, sessionId);
      if (history && history.length > 0) {
        setMessages(
          history.map((m) => ({
            role: m.role,
            content: m.content,
            tool_calls: m.tool_calls || [],
            timestamp: m.created_at,
          }))
        );
      } else {
        setMessages([defaultGreeting]);
      }
    } catch (err) {
      console.warn('Could not load session messages:', err);
      setMessages([defaultGreeting]);
    }
  };

  const handleCreateNewSession = async () => {
    try {
      const newSession = await api.createAiSession(workspaceId, 'New AI Consultation');
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setMessages([defaultGreeting]);
    } catch (err) {
      console.warn('Error creating AI session:', err);
    }
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    if (!(await confirmDialog('Delete this AI conversation thread?', { confirmLabel: 'Delete' }))) return;
    try {
      await api.deleteAiSession(workspaceId, sessionId);
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);
      if (activeSessionId === sessionId) {
        if (remaining.length > 0) {
          selectSession(remaining[0].id);
        } else {
          handleCreateNewSession();
        }
      }
    } catch (err) {
      notify(`Could not delete session: ${err.message}`, 'error');
    }
  };

  const handleReindexMemory = async () => {
    setIsReindexing(true);
    try {
      const res = await api.reindexMemory(workspaceId);
      notify(`Memory consolidation complete! Ingested: ${res.ingested_count}, Extracted: ${res.extracted_count}, Active Memories: ${res.consolidated_count}`, 'success');
      loadMemoryStats();
    } catch (err) {
      notify(`Re-index error: ${err.message}`, 'error');
    } finally {
      setIsReindexing(false);
    }
  };

  useEffect(() => {
    api.getAiConfig().then(setAiConfig).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activePlanSteps]);

  // Voice Recognition
  const toggleVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      notify('Speech recognition is not supported in this browser. Please use Chrome or Edge.', 'info');
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
          setInputPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
        };
        recognition.onerror = () => setIsRecording(false);
        recognition.onend = () => setIsRecording(false);

        recognition.start();
        speechRecognitionRef.current = recognition;
      } catch (err) {
        console.warn('Speech recognition error:', err);
        setIsRecording(false);
      }
    } else {
      speechRecognitionRef.current?.stop();
      setIsRecording(false);
    }
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const prompt = inputPrompt.trim();
    if (!prompt || isProcessing) return;

    if (!workspaceId) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '⚠️ No active workspace selected. Please select your workspace first.',
          tool_calls: [],
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }

    setInputPrompt('');
    const userMsg = { role: 'user', content: prompt, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);
    setActivePlanSteps([
      'Loading conversation context & episodic memory...',
      'Synthesizing workspace knowledge (docs, tasks, chats)...',
      modelConfigured ? 'Reasoning and running workspace actions...' : 'Running workspace commands...',
    ]);

    try {
      const res = await api.chatWithAgent(workspaceId, prompt, activeSessionId);
      if (res.session_id && res.session_id !== activeSessionId) setActiveSessionId(res.session_id);
      setActivePlanSteps([]);

      const assistantMsg = {
        role: 'assistant',
        content: res.response,
        tool_calls: res.tool_calls || [],
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // If title was auto-updated, refresh session list
      loadSessions();
      loadMemoryStats();

      // Check if workspace switch tool was executed
      if (res.tool_calls && onSwitchWorkspace) {
        const switchCall = res.tool_calls.find(
          (t) => t.tool === 'switch_workspace' || t.result?.type === 'workspace_switch'
        );
        if (switchCall && switchCall.result?.workspace_id) {
          onSwitchWorkspace(switchCall.result.workspace_id);
        }
      }

      if (onRefreshAll) await onRefreshAll();
    } catch (err) {
      setActivePlanSteps([]);
      const errorMsg = {
        role: 'assistant',
        content: `⚠️ Action encountered an issue: ${err.message}\n\n*Tip: Click the API Key button in the top bar to verify or update your Google Gemini API key.*`,
        tool_calls: [],
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getToolActionMeta = (toolCall) => {
    const name = toolCall.tool;
    const res = toolCall.result || {};

    if (name === 'switch_workspace' || res.type === 'workspace_switch') {
      return {
        label: 'Workspace Switched',
        icon: RotateCcw,
        color: 'text-amber-600',
        tab: 'dashboard',
        tabLabel: `Active: ${res.workspace_name || 'Space'}`,
      };
    }
    if (name === 'create_task' || name === 'update_task_status' || res.type === 'task') {
      return {
        label: 'Kanban Task Created / Updated',
        icon: FolderKanban,
        color: 'text-indigo-600',
        tab: 'projects',
        tabLabel: 'Open Kanban Board',
      };
    }
    if (name === 'create_document' || name === 'edit_document' || name === 'get_document' || res.type === 'document') {
      return {
        label: name === 'edit_document' ? 'Document Edited' : name === 'get_document' ? 'Document Retrieved' : 'Document Created',
        icon: FileText,
        color: 'text-purple-600',
        tab: 'documents',
        tabLabel: 'Open in Documents',
      };
    }
    if (name === 'create_channel' || name === 'post_channel_message' || res.type === 'channel') {
      return {
        label: 'Channel Communication',
        icon: MessageSquare,
        color: 'text-emerald-600',
        tab: 'channels',
        tabLabel: 'Open Channel',
      };
    }
    if (name === 'create_calendar_event' || res.type === 'calendar') {
      return {
        label: 'Calendar Event Scheduled',
        icon: Calendar,
        color: 'text-blue-600',
        tab: 'calendar',
        tabLabel: 'Open Calendar',
      };
    }
    return {
      label: 'Autonomous Operation Executed',
      icon: Terminal,
      color: 'text-slate-600',
      tab: 'dashboard',
      tabLabel: 'View Dashboard',
    };
  };

  return (
    <div className="h-full flex flex-col select-none">
      {/* 1. Header with Back Button (Item 1) & Quick Tools */}
      <FeatureHeader
        title="Agentic AI Copilot"
        icon={Bot}
        badge={modelConfigured ? 'AI model connected' : 'Offline command mode'}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            {/* Memory Vault Button */}
            <button
              onClick={() => setShowMemoryDrawer(!showMemoryDrawer)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-xs transition"
              title="View 4-Stage AI Memory Pipeline"
            >
              <Brain className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Memory Vault</span>
              {memoryStats && (
                <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded-full text-xs">
                  {memoryStats.total_memories || 0}
                </span>
              )}
            </button>

            {/* Gemini API Key Button */}
            <button
              onClick={() => setShowApiKeyModal(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition shadow-xs ${
                modelConfigured
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 animate-pulse'
              }`}
              title="Configure Google Gemini API Key"
            >
              <Key className="w-3.5 h-3.5" />
              <span>{modelConfigured ? 'AI model connected' : 'Set Gemini key'}</span>
            </button>
          </div>
        }
      />

      {/* 2. Main Body: Session Rail + Conversation Stream */}
      <div className="flex-1 flex gap-5 overflow-hidden min-h-0 pt-2">
        {/* Left Drawer: Past Conversation Sessions (Item 2) */}
        <div className="w-64 lg:w-72 bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-col shadow-xs flex-shrink-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              <span>AI Sessions</span>
            </div>
            <button aria-label="Start New Conversation Session"
              onClick={handleCreateNewSession}
              className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl transition flex items-center gap-1 text-xs font-bold"
              title="Start New Conversation Session"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Chat</span>
            </button>
          </div>

          {/* Session List */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {sessions.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                No past sessions yet.
              </div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === activeSessionId;
                return (
                  <div
                    key={sess.id}
                    onClick={() => selectSession(sess.id)}
                    className={`group w-full text-left p-2.5 rounded-xl text-xs transition cursor-pointer flex items-center justify-between ${
                      isActive
                        ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold shadow-xs'
                        : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="truncate">{sess.title || 'Untitled Session'}</div>
                      <div className="text-xs text-slate-400 font-normal mt-0.5">
                        {sess.created_at ? new Date(sess.created_at).toLocaleDateString() : 'Active'}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSession(sess.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 rounded transition"
                      title="Delete Thread"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center: Conversation Stream */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col h-full overflow-hidden min-h-0">
          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={idx}
                  className={`flex gap-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-sm shadow-xs ${
                      isUser
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                    }`}
                  >
                    {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  {/* Message Bubble */}
                  <div className={`space-y-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`p-4 rounded-2xl text-sm leading-relaxed ${
                        isUser
                          ? 'bg-indigo-600 text-white rounded-tr-none shadow-sm font-medium'
                          : 'bg-slate-50 border border-slate-200 text-slate-900 rounded-tl-none shadow-xs font-normal'
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <FormattedChatMessage content={msg.content} isUser={false} />
                      )}
                    </div>

                    {/* Tool Calls Pill / Cards */}
                    {msg.tool_calls && msg.tool_calls.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {msg.tool_calls.map((tc, tIdx) => {
                          const meta = getToolActionMeta(tc);
                          const Icon = meta.icon;
                          return (
                            <div
                              key={tIdx}
                              className="bg-white border border-slate-200 p-2.5 rounded-xl shadow-xs flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <Icon className={`w-4 h-4 ${meta.color}`} />
                                <span className="font-bold text-slate-800">{meta.label}</span>
                              </div>
                              {onNavigateTab && (
                                <button
                                  onClick={() => onNavigateTab(meta.tab)}
                                  className="text-indigo-600 hover:text-indigo-700 font-bold hover:underline flex items-center gap-1"
                                >
                                  <span>{meta.tabLabel}</span>
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="text-xs text-slate-400 px-1 font-mono">
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* In-Flight Agent Steps Animation */}
            {isProcessing && (
              <div className="flex gap-3 max-w-xl mr-auto">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shrink-0 animate-pulse">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl rounded-tl-none space-y-2 text-xs text-slate-700 shadow-xs">
                  <div className="flex items-center gap-2 font-bold text-indigo-700">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                    <span>NexaMind Agent Reasoning...</span>
                  </div>
                  {activePlanSteps.map((step, sIdx) => (
                    <div key={sIdx} className="flex items-center gap-2 text-slate-600">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Prompt Input Form */}
          <form
            onSubmit={handleSend}
            className="p-3 sm:p-4 border-t border-slate-200 bg-slate-50/50 flex items-center gap-2"
          >
            <button
              type="button"
              onClick={toggleVoiceInput}
              className={`p-2.5 rounded-xl border transition ${
                isRecording
                  ? 'bg-rose-50 border-rose-300 text-rose-600 animate-pulse'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
              title={isRecording ? 'Listening... click to stop' : 'Voice Input'}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <textarea aria-label="Message the AI copilot"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask anything, query workspace memory, or tell the AI to create tasks/docs..."
              disabled={isProcessing}
              className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 placeholder-slate-400 resize-none shadow-xs"
            />

            <button
              type="submit"
              aria-label="Send message"
              disabled={!inputPrompt.trim() || isProcessing}
              className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white rounded-xl transition shadow-sm active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Right Drawer: Memory Vault Inspection (Items 4 & 6) */}
        {showMemoryDrawer && (
          <div className="w-80 bg-white rounded-2xl border border-slate-200 p-4 flex flex-col shadow-lg flex-shrink-0 animate-in slide-in-from-right-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-indigo-600" />
                <h3 className="font-extrabold text-sm text-slate-900">Workspace Memory</h3>
              </div>
              <button
                onClick={() => setShowMemoryDrawer(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="py-3 space-y-3 flex-1 overflow-y-auto">
              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 space-y-1.5 text-xs">
                <div className="font-bold text-indigo-900">4-Stage Memory Pipeline:</div>
                <div className="text-slate-600 text-xs font-mono leading-relaxed">
                  Ingestion ➔ Extraction ➔ Consolidation ➔ Storage
                </div>
              </div>

              {/* Memory Pipeline Breakdown */}
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="font-extrabold text-indigo-600 text-lg">
                    {memoryStats?.total_memories || 0}
                  </div>
                  <div className="text-xs text-slate-500 font-medium">Active Memories</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="font-extrabold text-emerald-600 text-lg">
                    {memoryStats?.sources ? Object.keys(memoryStats.sources).length : 4}
                  </div>
                  <div className="text-xs text-slate-500 font-medium">Connected Sources</div>
                </div>
              </div>

              {/* Memory Categories */}
              {memoryStats?.categories && (
                <div className="space-y-1 pt-1">
                  <div className="text-xs uppercase font-bold text-slate-400">Categories</div>
                  {Object.entries(memoryStats.categories).map(([cat, count]) => (
                    <div key={cat} className="flex justify-between text-xs py-1 px-2 rounded-lg bg-slate-50">
                      <span className="capitalize font-medium text-slate-700">{cat}</span>
                      <span className="font-mono font-bold text-indigo-600">{count}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Re-Index Trigger */}
              <div className="pt-3">
                <button
                  onClick={handleReindexMemory}
                  disabled={isReindexing}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? 'animate-spin' : ''}`} />
                  <span>{isReindexing ? 'Consolidating Memory...' : 'Re-Index All Memories'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Gemini API Key Configuration Modal (Item 2) */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div data-modal className="bg-white rounded-3xl border border-slate-200 p-6 w-full max-w-md shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-indigo-600" />
                <h3 className="font-extrabold text-lg text-slate-900">Google Gemini API Key</h3>
              </div>
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <GeminiKeySettings compact onChange={setAiConfig} />

            <div className="flex items-center justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowApiKeyModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
