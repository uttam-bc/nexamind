import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  CheckCircle2,
  FolderKanban,
  FileText,
  DollarSign,
  Code2,
  MessageSquare,
  FileBarChart,
  Mic,
  MicOff,
  Maximize2,
  Minimize2,
  ArrowRight,
  Zap,
  Check,
  Play,
  RotateCcw,
  Terminal,
  Calendar,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api';

export default function AiAssistant({
  workspaceId,
  onNavigateTab,
  onRefreshAll,
  onSwitchWorkspace,
  isExpanded = false,
  onToggleExpand,
}) {
  const defaultGreeting = {
    role: 'assistant',
    content:
      'Hello! I am your **NexaMind Autonomous Omni-Agent (Chief AI Officer)**.\n' +
      'I have full execution authority over your workspace. You can tell me to:\n\n' +
      '- 📄 *Create, edit & read files & documents*\n' +
      '- 📊 *Create & organize sprint tasks on Kanban*\n' +
      '- 📅 *Schedule meetings & calendar reminders*\n' +
      '- 💬 *Send announcements & share files to channels*\n' +
      '- 💻 *Create repositories, log commits & manage issues*\n\n' +
      'What would you like me to execute for you today?',
    tool_calls: [],
    timestamp: new Date().toISOString(),
  };

  const [messages, setMessages] = useState([defaultGreeting]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [activePlanSteps, setActivePlanSteps] = useState([]);

  const messagesEndRef = useRef(null);
  const speechRecognitionRef = useRef(null);

  // Load chat history from localStorage for this workspace
  useEffect(() => {
    if (!workspaceId) return;
    const storageKey = `nexamind_ai_chat_${workspaceId}`;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch (err) {
        console.warn('Could not parse saved chat history:', err);
      }
    }
    setMessages([defaultGreeting]);
  }, [workspaceId]);

  // Save chat history to localStorage whenever messages update
  useEffect(() => {
    if (!workspaceId || messages.length === 0) return;
    const storageKey = `nexamind_ai_chat_${workspaceId}`;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, workspaceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activePlanSteps]);

  // Clear chat history
  const handleClearChat = () => {
    if (confirm('Clear chat history for this workspace?')) {
      const storageKey = `nexamind_ai_chat_${workspaceId}`;
      localStorage.removeItem(storageKey);
      setMessages([defaultGreeting]);
    }
  };

  // Voice Recognition Web API
  const toggleVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    if (!isRecording) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          const text = Array.from(event.results)
            .map((r) => r[0].transcript)
            .join('');
          setInputPrompt(text);
        };

        recognition.onend = () => {
          setIsRecording(false);
        };

        recognition.onerror = (e) => {
          console.warn('Voice input error:', e.error);
          setIsRecording(false);
        };

        recognition.start();
        speechRecognitionRef.current = recognition;
        setIsRecording(true);
      } catch (err) {
        console.error('Speech recognition error:', err);
      }
    } else {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
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
          content: '⚠️ No active workspace selected. Please select your Solo or Group workspace to proceed.',
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
    setActivePlanSteps(['Analyzing intent & scoping workspace tools...', 'Executing autonomous operations in Supabase...']);

    try {
      const res = await api.chatWithAgent(workspaceId, prompt);
      setActivePlanSteps([]);
      const assistantMsg = {
        role: 'assistant',
        content: res.response,
        tool_calls: res.tool_calls || [],
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Check if AI performed a workspace switch
      if (res.tool_calls && onSwitchWorkspace) {
        const switchCall = res.tool_calls.find(
          (t) => t.tool === 'switch_workspace' || t.result?.type === 'workspace_switch'
        );
        if (switchCall && switchCall.result?.workspace_id) {
          onSwitchWorkspace(switchCall.result.workspace_id);
        }
      }

      if (onRefreshAll) {
        await onRefreshAll();
      }
    } catch (err) {
      setActivePlanSteps([]);
      const errorMsg = {
        role: 'assistant',
        content: `⚠️ Action encountered an error: ${err.message}`,
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
        color: 'text-amber-400',
        tab: 'dashboard',
        tabLabel: `Active: ${res.workspace_name || 'Space'}`,
      };
    }
    if (name === 'create_task' || name === 'update_task_status' || res.type === 'task') {
      return {
        label: 'Kanban Task Created',
        icon: FolderKanban,
        color: 'text-indigo-400',
        tab: 'projects',
        tabLabel: 'Open Kanban Board',
      };
    }
    if (name === 'create_document' || name === 'edit_document' || name === 'get_document' || res.type === 'document') {
      return {
        label: name === 'edit_document' ? 'Document / File Edited' : name === 'get_document' ? 'Document Retrieved' : 'Document / File Created',
        icon: FileText,
        color: 'text-purple-400',
        tab: 'documents',
        tabLabel: 'Open in Documents',
      };
    }
    if (name === 'create_channel' || name === 'post_channel_message' || res.type === 'channel') {
      return {
        label: 'Channel Communication',
        icon: MessageSquare,
        color: 'text-emerald-400',
        tab: 'channels',
        tabLabel: 'Open Channel',
      };
    }
    if (name === 'create_calendar_event' || res.type === 'calendar') {
      return {
        label: 'Calendar Event Scheduled',
        icon: Calendar,
        color: 'text-indigo-400',
        tab: 'calendar',
        tabLabel: 'Open Calendar & Schedule',
      };
    }
    if (name === 'create_repo' || name === 'create_commit' || res.type === 'code_repo' || res.type === 'commit') {
      return {
        label: 'Code Repository / Commit',
        icon: Code2,
        color: 'text-cyan-400',
        tab: 'code',
        tabLabel: 'Open Code Workspace',
      };
    }
    return {
      label: 'Workspace Query',
      icon: Terminal,
      color: 'text-slate-400',
      tab: 'dashboard',
      tabLabel: 'View Overview',
    };
  };

  const samplePrompts = [
    "Create a file named notes.txt with text 'Sprint deliverables and milestones'",
    "Edit document notes.txt and add 'Verify all tests pass 100%'",
    "Send message 'Sprint review is today at 4 PM' to channel general",
    "Schedule a meeting for 'Architecture Review' tomorrow at 3 PM",
    "Create an urgent task 'Optimize database indexes'",
  ];

  return (
    <div className="glass-panel rounded-3xl border border-slate-800 flex flex-col h-full overflow-hidden bg-slate-900/90 shadow-2xl relative">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 animate-pulse">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm text-slate-100">NexaMind Omni-Agent</span>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-bold px-2 py-0.5 rounded-full border border-indigo-500/30">
                Llama 3.3 70B & Tools
              </span>
            </div>
            <span className="text-[11px] text-slate-400">Full Execution Authority (Docs, Tasks, Calendar, Channels)</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleClearChat}
            title="Clear Chat History"
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition"
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Messages Canvas */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 font-sans">
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={index}
              className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div className={`space-y-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                <div
                  className={`p-4 rounded-2xl text-xs leading-relaxed ${
                    isUser
                      ? 'bg-indigo-600 text-white font-medium rounded-tr-none shadow-md shadow-indigo-600/20'
                      : 'bg-slate-950/80 border border-slate-800 text-slate-200 rounded-tl-none shadow-sm font-sans whitespace-pre-wrap'
                  }`}
                >
                  {msg.content}
                </div>

                {/* Executed Tools Badges */}
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {msg.tool_calls.map((tc, tcIdx) => {
                      const meta = getToolActionMeta(tc);
                      const Icon = meta.icon;
                      const res = tc.result || {};
                      const resultMsg = res.message || `Executed ${tc.tool}`;
                      return (
                        <div
                          key={tcIdx}
                          className="flex items-center justify-between gap-3 bg-slate-950/90 border border-slate-800/90 px-3.5 py-2 rounded-xl text-xs group hover:border-indigo-500/50 transition shadow-md"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon className={`w-3.5 h-3.5 ${meta.color} flex-shrink-0`} />
                            <span className="font-bold text-slate-300 truncate">{meta.label}:</span>
                            <span className="text-[11px] text-slate-400 truncate max-w-[200px]">
                              {resultMsg}
                            </span>
                          </div>

                          <button
                            onClick={() => onNavigateTab && onNavigateTab(meta.tab)}
                            className="flex items-center gap-1 text-[11px] font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 px-2 py-1 rounded-lg border border-indigo-500/20 transition flex-shrink-0"
                          >
                            <span>{meta.tabLabel}</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Live Multi-Step Execution Plan */}
        {isProcessing && activePlanSteps.length > 0 && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 flex-shrink-0 animate-pulse">
              <Zap className="w-4 h-4" />
            </div>
            <div className="bg-slate-950/90 border border-indigo-500/40 p-4 rounded-2xl max-w-[85%] space-y-2 shadow-lg shadow-indigo-500/10">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-400 block">
                Autonomous Execution In Progress
              </span>
              <div className="space-y-1.5">
                {activePlanSteps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Commands */}
      <div className="px-4 py-2 border-t border-slate-800/60 bg-slate-950/40 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex-shrink-0 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-indigo-400" /> Commands:
        </span>
        {samplePrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => setInputPrompt(p)}
            className="text-[11px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white px-2.5 py-1 rounded-lg whitespace-nowrap transition"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Input Composer Form */}
      <form onSubmit={handleSend} className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleVoiceInput}
          title={isRecording ? 'Listening... click to stop' : 'Voice Command'}
          className={`p-2.5 rounded-xl border transition ${
            isRecording
              ? 'bg-rose-600 text-white border-rose-500 animate-bounce'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-800'
          }`}
        >
          {isRecording ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        <textarea
          rows={1}
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Command AI to create a file, edit documents, send messages, schedule meetings..."
          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 resize-none placeholder-slate-500 font-sans"
        />

        <button
          type="submit"
          disabled={!inputPrompt.trim() || isProcessing}
          className="p-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl shadow-lg shadow-indigo-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 flex items-center justify-center"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
