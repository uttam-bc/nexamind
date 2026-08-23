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
} from 'lucide-react';
import { api } from '../api';

export default function AiAssistant({
  workspaceId,
  onNavigateTab,
  onRefreshAll,
  isExpanded = false,
  onToggleExpand,
}) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Hello! I am your **NexaMind Autonomous Omni-Agent (Chief AI Officer)**.\n' +
        'I have full execution authority over your workspace. You can tell me to:\n\n' +
        '- 📝 *Draft documents & architecture specifications*\n' +
        '- 📊 *Create & organize sprint tasks on Kanban*\n' +
        '- 💻 *Create repositories, log commits, and manage issues*\n' +
        '- 💬 *Create channels and post team announcements*\n' +
        '- 📄 *Synthesize executive AI reports*\n\n' +
        'What would you like me to execute for you today?',
      tool_calls: [],
    },
  ]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [activePlanSteps, setActivePlanSteps] = useState([]);

  const messagesEndRef = useRef(null);
  const speechRecognitionRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activePlanSteps]);

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

    setInputPrompt('');
    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    setIsProcessing(true);
    setActivePlanSteps(['Analyzing intent & scoping workspace tools...', 'Executing autonomous operations...']);

    try {
      const res = await api.chatWithAgent(workspaceId, prompt);
      setActivePlanSteps([]);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.response,
          tool_calls: res.tool_calls || [],
        },
      ]);
      if (onRefreshAll) {
        await onRefreshAll();
      }
    } catch (err) {
      setActivePlanSteps([]);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Action encountered an error: ${err.message}`,
          tool_calls: [],
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const executeSamplePrompt = (prompt) => {
    setInputPrompt(prompt);
  };

  const getToolActionMeta = (toolCall) => {
    const name = toolCall.tool;
    const res = toolCall.result || {};
    if (name === 'create_task' || res.type === 'task') {
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
        tabLabel: 'Open Document Spec',
      };
    }
    if (name === 'create_transaction' || res.type === 'transaction') {
      return {
        label: 'Financial Transaction Logged',
        icon: DollarSign,
        color: 'text-emerald-400',
        tab: 'finance',
        tabLabel: 'View Financial Ledger',
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
    if (name === 'create_channel' || name === 'post_channel_message' || res.type === 'channel') {
      return {
        label: 'Channel Communication',
        icon: MessageSquare,
        color: 'text-amber-400',
        tab: 'channels',
        tabLabel: 'Open Channel',
      };
    }
    if (name === 'generate_report' || res.type === 'report') {
      return {
        label: 'Executive Report Synthesized',
        icon: FileBarChart,
        color: 'text-rose-400',
        tab: 'documents',
        tabLabel: 'Open Document Spec',
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
    return {
      label: 'Workspace Query',
      icon: Terminal,
      color: 'text-slate-400',
      tab: 'dashboard',
      tabLabel: 'View Overview',
    };
  };

  return (
    <div className="glass-panel rounded-3xl border border-slate-800 flex flex-col h-full overflow-hidden bg-slate-900/90 shadow-2xl relative">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 animate-pulse">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm text-slate-100">Autonomous Omni-Agent</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                Operator Mode
              </span>
            </div>
            <span className="text-[11px] text-slate-400">Full Execution Authority</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition"
              title={isExpanded ? 'Collapse View' : 'Expand Fullscreen Cockpit'}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Quick Capability Prompt Chips */}
      <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto text-[11px]">
        <span className="text-[10px] font-bold text-slate-500 uppercase flex-shrink-0 flex items-center gap-1">
          <Zap className="w-3 h-3 text-amber-400" /> Actions:
        </span>
        <button
          onClick={() =>
            executeSamplePrompt(
              'Draft an architecture document for "WebSocket Realtime Gateway" and add a high priority Kanban task to implement it.'
            )
          }
          className="whitespace-nowrap px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-lg transition border border-slate-700/60"
        >
          Draft Doc & Create Kanban Task
        </button>
        <button
          onClick={() =>
            executeSamplePrompt(
              'Extract all action items from our recent meeting and create tasks for them on Kanban.'
            )
          }
          className="whitespace-nowrap px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-lg transition border border-slate-700/60"
        >
          Meeting Action Items to Tasks
        </button>
        <button
          onClick={() =>
            executeSamplePrompt(
              'Create a new channel named "engineering-standups" and post a kick-off message.'
            )
          }
          className="whitespace-nowrap px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-lg transition border border-slate-700/60"
        >
          Create Channel & Post Notice
        </button>
        <button
          onClick={() =>
            executeSamplePrompt('Create a new code repository named "ai-gateway-proxy".')
          }
          className="whitespace-nowrap px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-lg transition border border-slate-700/60"
        >
          Create Code Repo
        </button>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, idx) => {
          const isAssistant = m.role === 'assistant';
          return (
            <div
              key={idx}
              className={`flex gap-3 text-xs leading-relaxed ${
                isAssistant ? 'items-start' : 'items-start flex-row-reverse'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-white text-xs flex-shrink-0 shadow-md ${
                  isAssistant
                    ? 'bg-gradient-to-tr from-indigo-600 to-purple-600'
                    : 'bg-gradient-to-tr from-slate-700 to-slate-600'
                }`}
              >
                {isAssistant ? <Bot className="w-4 h-4" /> : 'You'}
              </div>

              <div className="space-y-3 max-w-[85%]">
                <div
                  className={`p-4 rounded-2xl whitespace-pre-wrap ${
                    isAssistant
                      ? 'bg-slate-950/80 border border-slate-800 text-slate-200 shadow-sm'
                      : 'bg-indigo-600 text-white shadow-md'
                  }`}
                >
                  {m.content}
                </div>

                {/* Tool Executions Cards */}
                {isAssistant && m.tool_calls && m.tool_calls.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Executed Workspace Actions ({m.tool_calls.length})</span>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {m.tool_calls.map((tc, tIdx) => {
                        const meta = getToolActionMeta(tc);
                        const Icon = meta.icon;
                        const msg =
                          tc.result?.message ||
                          tc.result?.message_detail ||
                          `Executed ${tc.tool}`;
                        return (
                          <div
                            key={tIdx}
                            className="p-3 bg-slate-950 rounded-xl border border-slate-800/90 flex items-center justify-between gap-3 text-xs hover:border-indigo-500/40 transition"
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <div className={`p-1.5 rounded-lg bg-slate-900 ${meta.color}`}>
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="truncate">
                                <span className="font-bold text-slate-200 block truncate">
                                  {msg}
                                </span>
                                <span className="text-[10px] text-slate-500 uppercase font-mono">
                                  Tool: {tc.tool}
                                </span>
                              </div>
                            </div>

                            {onNavigateTab && (
                              <button
                                onClick={() => onNavigateTab(meta.tab)}
                                className="flex items-center gap-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex-shrink-0"
                              >
                                <span>{meta.tabLabel}</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Live Execution Plan Progress */}
        {isProcessing && (
          <div className="p-4 bg-slate-950/90 border border-indigo-500/30 rounded-2xl space-y-2.5 animate-fade-in text-xs">
            <div className="flex items-center gap-2 text-indigo-400 font-bold">
              <Sparkles className="w-4 h-4 animate-spin" />
              <span>Omni-Agent Reasoning & Autonomous Execution in Progress...</span>
            </div>
            <div className="space-y-1 pl-6 text-slate-400">
              {activePlanSteps.map((step, sIdx) => (
                <div key={sIdx} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Control Box with Voice Command Mic */}
      <form
        onSubmit={handleSend}
        className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center gap-2"
      >
        <button
          type="button"
          onClick={toggleVoiceInput}
          className={`p-3 rounded-xl transition ${
            isRecording
              ? 'bg-rose-600 text-white animate-pulse shadow-lg shadow-rose-600/40'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
          title={isRecording ? 'Listening... Click to Stop' : 'Voice Input (Click to Speak)'}
        >
          {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <input
          type="text"
          placeholder={
            isRecording
              ? 'Listening to your voice command...'
              : 'Give any command: "Draft doc, create task, log expense, create repo..."'
          }
          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
          disabled={isProcessing}
        />

        <button
          type="submit"
          disabled={isProcessing || !inputPrompt.trim()}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 text-white px-5 py-3 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition flex items-center gap-1.5 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
          <span>Execute</span>
        </button>
      </form>
    </div>
  );
}
