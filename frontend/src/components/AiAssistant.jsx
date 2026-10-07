import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Sparkles,
  CheckCircle2,
  FolderKanban,
  FileText,
  DollarSign,
  Code2,
  MessageSquare,
  Mic,
  MicOff,
  RotateCcw,
  Calendar,
  Trash2,
  ExternalLink,
  Bot,
  User,
  ArrowRight,
  Terminal,
} from 'lucide-react';
import { api } from '../api';

export default function AiAssistant({
  workspaceId,
  onNavigateTab,
  onRefreshAll,
  onSwitchWorkspace,
}) {
  const defaultGreeting = {
    role: 'assistant',
    content:
      'Hello! I am your **NexaMind Autonomous Copilot**.\n\n' +
      'I have direct database and workspace authority. You can tell me in natural language to:\n' +
      '- 📄 *Create or edit files & documents in Supabase*\n' +
      '- 📊 *Create, assign & update tasks on Kanban*\n' +
      '- 📅 *Schedule meetings & calendar reminders*\n' +
      '- 💬 *Broadcast messages & share docs to channels*\n' +
      '- 🔄 *Switch between Solo & Group workspaces*\n\n' +
      'What would you like to execute next?',
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

  // Load chat history
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

  // Save chat history
  useEffect(() => {
    if (!workspaceId || messages.length === 0) return;
    const storageKey = `nexamind_ai_chat_${workspaceId}`;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, workspaceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activePlanSteps]);

  const handleClearChat = () => {
    if (confirm('Clear chat history for this workspace?')) {
      const storageKey = `nexamind_ai_chat_${workspaceId}`;
      localStorage.removeItem(storageKey);
      setMessages([defaultGreeting]);
    }
  };

  // Voice Recognition
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

        recognition.onend = () => setIsRecording(false);
        recognition.onerror = () => setIsRecording(false);

        recognition.start();
        speechRecognitionRef.current = recognition;
        setIsRecording(true);
      } catch (err) {
        console.error('Speech recognition error:', err);
      }
    } else {
      if (speechRecognitionRef.current) speechRecognitionRef.current.stop();
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
          content: '⚠️ No active workspace selected. Please select your Solo or Group workspace from the sidebar.',
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
    setActivePlanSteps(['Analyzing intent & scoping tools...', 'Executing autonomous operations in Supabase...']);

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
        color: 'text-amber-600',
        tab: 'dashboard',
        tabLabel: `Active: ${res.workspace_name || 'Space'}`,
      };
    }
    if (name === 'create_task' || name === 'update_task_status' || res.type === 'task') {
      return {
        label: 'Kanban Task Created',
        icon: FolderKanban,
        color: 'text-[#4F46E5]',
        tab: 'projects',
        tabLabel: 'Open Kanban Board',
      };
    }
    if (name === 'create_document' || name === 'edit_document' || name === 'get_document' || res.type === 'document') {
      return {
        label: name === 'edit_document' ? 'Document / File Edited' : name === 'get_document' ? 'Document Retrieved' : 'Document / File Created',
        icon: FileText,
        color: 'text-[#8B5CF6]',
        tab: 'documents',
        tabLabel: 'Open in Documents',
      };
    }
    if (name === 'create_channel' || name === 'post_channel_message' || res.type === 'channel') {
      return {
        label: 'Channel Communication',
        icon: MessageSquare,
        color: 'text-[#10B981]',
        tab: 'channels',
        tabLabel: 'Open Channel',
      };
    }
    if (name === 'create_calendar_event' || res.type === 'calendar') {
      return {
        label: 'Calendar Event Scheduled',
        icon: Calendar,
        color: 'text-[#4F46E5]',
        tab: 'calendar',
        tabLabel: 'Open Calendar',
      };
    }
    return {
      label: 'Operation Executed',
      icon: Terminal,
      color: 'text-slate-600',
      tab: 'dashboard',
      tabLabel: 'View Dashboard',
    };
  };

  const promptSuggestions = [
    'Create a file named release_specs.txt with text "API v2 architecture and caching."',
    'Schedule meeting for "Architecture Review" tomorrow at 3 PM',
    'Edit document release_specs.txt and add "Verified on staging."',
    'What is our current cash balance and runway?',
    'Send message "Sprint review starts in 10 mins" to channel general',
  ];

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm flex flex-col h-full max-w-4xl mx-auto overflow-hidden font-sans text-[#191C1E]">
      {/* Copilot Header */}
      <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-50 text-[#8B5CF6] border border-purple-200 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#191C1E] flex items-center gap-2">
              <span>Copilot Intelligence Engine</span>
              <span className="text-[9px] font-mono font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                AUTONOMOUS
              </span>
            </h2>
            <p className="text-[10px] font-mono text-slate-500">
              Direct Supabase Database Authority & Tool Execution
            </p>
          </div>
        </div>

        <button
          onClick={handleClearChat}
          title="Clear Chat History"
          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-white">
        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';

          return (
            <div
              key={idx}
              className={`flex gap-3 text-xs leading-relaxed ${
                isUser ? 'justify-end' : 'justify-start'
              }`}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-xl bg-purple-50 text-[#8B5CF6] border border-purple-200 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
              )}

              <div
                className={`rounded-2xl p-4 max-w-[82%] space-y-2.5 shadow-sm ${
                  isUser
                    ? 'bg-[#4F46E5] text-white rounded-br-none'
                    : 'bg-[#F2F4F6] text-[#191C1E] border border-[#E2E8F0] rounded-bl-none'
                }`}
              >
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>

                {/* Executed Tools Action Cards */}
                {!isUser && msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                    <div className="text-[10px] font-mono uppercase font-bold text-slate-500 tracking-wider">
                      Executed Platform Actions
                    </div>

                    {msg.tool_calls.map((toolCall, tIdx) => {
                      const meta = getToolActionMeta(toolCall);
                      const Icon = meta.icon;

                      return (
                        <div
                          key={tIdx}
                          className="bg-white rounded-xl p-3 border border-[#E2E8F0] space-y-1.5 shadow-sm"
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[11px] font-mono font-bold flex items-center gap-1.5 ${meta.color}`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                              <span>{meta.label}</span>
                            </span>
                            <span className="text-[10px] font-mono text-[#10B981] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-bold">
                              SUCCESS
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-700 font-mono">
                            {toolCall.result?.message || toolCall.result?.title || 'Operation committed to database.'}
                          </div>

                          {meta.tab && (
                            <button
                              onClick={() => onNavigateTab && onNavigateTab(meta.tab)}
                              className="text-[10px] font-mono font-bold text-[#4F46E5] hover:underline flex items-center gap-1 transition pt-0.5"
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
              </div>

              {isUser && (
                <div className="w-7 h-7 rounded-xl bg-indigo-50 text-[#4F46E5] border border-indigo-200 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}

        {/* Processing State */}
        {isProcessing && (
          <div className="flex gap-3 text-xs justify-start">
            <div className="w-7 h-7 rounded-xl bg-purple-50 text-[#8B5CF6] border border-purple-200 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 animate-spin" />
            </div>
            <div className="bg-[#F2F4F6] text-[#191C1E] border border-[#E2E8F0] rounded-2xl rounded-bl-none p-4 space-y-1.5 shadow-sm">
              <div className="flex items-center gap-2 text-[#4F46E5] font-mono text-[11px] font-bold">
                <span className="w-2 h-2 rounded-full bg-[#4F46E5] animate-pulse"></span>
                <span>Executing autonomous agent flow...</span>
              </div>
              {activePlanSteps.map((step, sIdx) => (
                <div key={sIdx} className="text-[10px] font-mono text-slate-500 pl-4">
                  › {step}
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Fast Prompt Suggestions */}
      {messages.length <= 2 && (
        <div className="px-4 py-2 border-t border-[#E2E8F0] bg-[#F8FAFC] flex gap-2 overflow-x-auto">
          {promptSuggestions.map((sug, sIdx) => (
            <button
              key={sIdx}
              onClick={() => setInputPrompt(sug)}
              className="text-[11px] font-mono text-slate-600 hover:text-[#191C1E] bg-white hover:bg-[#F2F4F6] border border-[#E2E8F0] px-3 py-1.5 rounded-lg whitespace-nowrap transition flex-shrink-0 shadow-sm"
            >
              {sug.slice(0, 36)}...
            </button>
          ))}
        </div>
      )}

      {/* Input Form Bar */}
      <form
        onSubmit={handleSend}
        className="p-3 sm:p-4 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center gap-2"
      >
        <button
          type="button"
          onClick={toggleVoiceInput}
          title={isRecording ? 'Stop Recording' : 'Voice Input'}
          className={`p-2.5 rounded-xl border transition ${
            isRecording
              ? 'bg-rose-500 text-white border-rose-600 animate-pulse'
              : 'bg-white border-[#E2E8F0] text-slate-500 hover:text-slate-900 hover:bg-[#ECEEF0]'
          }`}
        >
          {isRecording ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        <input
          type="text"
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Command Copilot: create doc, schedule meeting, edit file, send message..."
          className="flex-1 bg-white border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] placeholder-slate-400 focus:outline-none transition font-sans shadow-sm"
        />

        <button
          type="submit"
          disabled={!inputPrompt.trim() || isProcessing}
          className="bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white p-2.5 rounded-xl transition shadow-sm flex items-center justify-center shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
