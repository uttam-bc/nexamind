import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Mic,
  MicOff,
  Star,
  Copy,
  Trash2,
  FolderKanban,
  Play,
  Pause,
  MessageSquare,
  CheckCheck,
  Check,
} from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context/ToastContext';
import { PageHeader, Badge, EmptyState } from './ui';

export default function SoloChat({
  workspaceId,
  user,
  onNavigateTab,
  onRefreshAll,
}) {
  const { success: toastSuccess, error: toastError } = useToast();

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('all');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const voiceTimerRef = useRef(null);

  const storageKey = `nexamind_solo_chat_${workspaceId}_${user?.id || 'default'}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setMessages(JSON.parse(saved));
      } else {
        const initial = [
          {
            id: 'm-1',
            sender: 'You',
            text: 'Welcome to your Personal Solo Chat & Quick Notes! Send yourself instant ideas, links, voice memos, and tasks like WhatsApp.',
            time: '10:00 AM',
            timestamp: Date.now() - 3600000,
            tags: ['#idea'],
            type: 'text',
            status: 'read',
            starred: true,
          },
          {
            id: 'm-2',
            sender: 'You',
            text: '💡 Next sprint idea: Add WebRTC multi-peer mesh with AI voice transcription.',
            time: '10:15 AM',
            timestamp: Date.now() - 1800000,
            tags: ['#idea', '#todo'],
            type: 'text',
            status: 'read',
            starred: false,
          },
        ];
        setMessages(initial);
        localStorage.setItem(storageKey, JSON.stringify(initial));
      }
    } catch (e) {
      console.warn('Error loading solo chat:', e);
    }
  }, [workspaceId, user?.id]);

  const saveMessages = (newMessages) => {
    setMessages(newMessages);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newMessages));
    } catch (e) {
      console.warn('Error saving solo chat:', e);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (e) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const hashtags = inputText.match(/#[a-zA-Z0-9_]+/g) || [];
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMsg = {
      id: `msg-${Date.now()}`,
      sender: 'You',
      text: inputText.trim(),
      time: timeStr,
      timestamp: Date.now(),
      tags: hashtags,
      type: 'text',
      status: 'read',
      starred: false,
    };

    saveMessages([...messages, newMsg]);
    setInputText('');
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        const now = new Date();
        const newVoiceMsg = {
          id: `voice-${Date.now()}`,
          sender: 'You',
          text: `🎙️ Voice Note (${voiceDuration}s)`,
          audioUrl,
          duration: voiceDuration,
          time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: Date.now(),
          tags: ['#voice'],
          type: 'voice',
          status: 'read',
          starred: false,
        };
        saveMessages([...messages, newVoiceMsg]);
        setIsRecordingVoice(false);
        setVoiceDuration(0);
        stream.getTracks().forEach((t) => t.stop());
        toastSuccess('Voice note recorded!');
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecordingVoice(true);
      setVoiceDuration(0);
      voiceTimerRef.current = setInterval(() => {
        setVoiceDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      toastError(`Microphone error: ${err.message}`);
    }
  };

  const stopVoiceRecording = () => {
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleStar = (id) => {
    const updated = messages.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m));
    saveMessages(updated);
  };

  const deleteMessage = (id) => {
    const updated = messages.filter((m) => m.id !== id);
    saveMessages(updated);
    toastSuccess('Note deleted.');
  };

  const copyMessage = (m) => {
    navigator.clipboard.writeText(m.text);
    setCopiedId(m.id);
    setTimeout(() => setCopiedId(null), 2000);
    toastSuccess('Note text copied to clipboard!');
  };

  const convertToTask = async (m) => {
    try {
      await api.createTask(workspaceId, {
        title: m.text.slice(0, 80),
        description: `Created from Solo Chat note at ${m.time}`,
        priority: m.tags.includes('#urgent') ? 'urgent' : 'medium',
        status: 'todo',
      });
      toastSuccess('Task created on your Kanban board!');
      if (onRefreshAll) onRefreshAll();
    } catch (err) {
      toastError(`Could not create task: ${err.message}`);
    }
  };

  const filteredMessages = messages.filter((m) => {
    const matchesSearch =
      !searchQuery || m.text.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag =
      selectedTag === 'all'
        ? true
        : selectedTag === 'starred'
        ? m.starred
        : m.tags?.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const availableTags = ['#idea', '#todo', '#link', '#urgent', '#voice', '#snippet'];

  return (
    <div className="h-full flex flex-col glass-panel rounded-3xl border border-slate-800/80 overflow-hidden bg-slate-950/60 shadow-2xl relative">
      {/* Top Header Bar */}
      <div className="p-4 bg-slate-900/60 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white font-black text-sm shadow-md shadow-emerald-600/30">
            <span>{user?.name?.[0]?.toUpperCase() || 'Y'}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-sm text-slate-100">You (Personal Notes & Chat)</h3>
              <Badge variant="emerald">Solo Mode</Badge>
            </div>
            <p className="text-[11px] text-slate-500">Message yourself • Instant thoughts, links & voice memos</p>
          </div>
        </div>

        {/* Search Bar & Tag Filter */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search chat notes..."
            className="input-base py-1.5 px-3 text-xs w-44"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-850 text-[11px]">
            <button
              onClick={() => setSelectedTag('all')}
              className={`px-3 py-1 rounded-lg font-semibold transition ${
                selectedTag === 'all' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({messages.length})
            </button>
            <button
              onClick={() => setSelectedTag('starred')}
              className={`px-2 py-1.5 rounded-lg font-semibold flex items-center gap-1 transition ${
                selectedTag === 'starred' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Tag Pills */}
      <div className="px-6 py-2 bg-slate-900/40 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto text-[11px] no-scrollbar">
        <span className="text-[10px] font-bold text-slate-500 uppercase flex-shrink-0">Filter Tags:</span>
        {availableTags.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedTag(selectedTag === t ? 'all' : t)}
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono transition border ${
              selectedTag === t
                ? 'bg-emerald-650 text-white border-emerald-500'
                : 'bg-slate-950 text-slate-450 border-slate-800 hover:border-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Chat Messages Canvas */}
      <div
        className="flex-1 overflow-y-auto p-6 space-y-4 relative"
        style={{
          backgroundImage:
            'radial-gradient(circle at 10px 10px, rgba(255,255,255,0.015) 1.5px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        {filteredMessages.map((m) => {
          return (
            <div key={m.id} className="flex justify-end group">
              <div className="max-w-md bg-emerald-950/40 border border-emerald-900/40 text-slate-100 p-3.5 rounded-2xl rounded-tr-none shadow-lg relative space-y-1.5">
                {/* Message Header Action Icons */}
                <div className="flex items-center justify-between gap-4 text-[10px] text-emerald-400/80 pb-1 border-b border-emerald-900/25">
                  <span className="font-bold uppercase tracking-wider">{m.sender}</span>
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={() => toggleStar(m.id)}
                      className="p-1 hover:text-amber-400 transition"
                      title={m.starred ? 'Unstar' : 'Star message'}
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${m.starred ? 'fill-amber-400 text-amber-400' : 'text-slate-450'}`}
                      />
                    </button>
                    <button
                      onClick={() => copyMessage(m)}
                      className="p-1 hover:text-white transition"
                      title="Copy text"
                    >
                      {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5 text-slate-450" />}
                    </button>
                    <button
                      onClick={() => convertToTask(m)}
                      className="p-1 hover:text-indigo-300 transition"
                      title="Convert to Kanban Task"
                    >
                      <FolderKanban className="w-3.5 h-3.5 text-slate-455" />
                    </button>
                    <button
                      onClick={() => deleteMessage(m.id)}
                      className="p-1 hover:text-rose-450 transition"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-slate-450" />
                    </button>
                  </div>
                </div>

                {/* Body Content */}
                {m.type === 'voice' && m.audioUrl ? (
                  <div className="flex items-center gap-3 bg-emerald-900/30 p-2.5 rounded-xl border border-emerald-800/30 my-1">
                    <button
                      onClick={() => {
                        const audio = document.getElementById(`audio-${m.id}`);
                        if (audio) {
                          if (playingAudioId === m.id) {
                            audio.pause();
                            setPlayingAudioId(null);
                          } else {
                            audio.play();
                            setPlayingAudioId(m.id);
                          }
                        }
                      }}
                      className="w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-450 flex items-center justify-center text-slate-950 font-bold shadow"
                    >
                      {playingAudioId === m.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-slate-950" />}
                    </button>
                    <audio
                      id={`audio-${m.id}`}
                      src={m.audioUrl}
                      onEnded={() => setPlayingAudioId(null)}
                      className="hidden"
                    />
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-slate-200">Voice Memo</div>
                      <div className="text-[10px] text-emerald-350 font-mono">{m.duration}s recording</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed whitespace-pre-wrap text-slate-200 font-sans">
                    {m.text}
                  </p>
                )}

                {/* Tags and Timestamp */}
                <div className="flex items-center justify-between text-[10px] pt-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    {m.tags?.map((t) => (
                      <span
                        key={t}
                        className="bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded font-mono text-[9px]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 text-emerald-400/70 font-mono">
                    <span>{m.time}</span>
                    <CheckCheck className="w-3.5 h-3.5 text-cyan-400" />
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {filteredMessages.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="No Personal Notes Found"
            description="Send a note or record a voice memo below to store key thoughts."
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Recording Banner Overlay */}
      {isRecordingVoice && (
        <div className="px-6 py-3.5 bg-rose-950/80 border-t border-rose-900/50 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3 text-rose-455 text-xs font-bold animate-pulse">
            <span className="w-3 h-3 rounded-full bg-rose-500"></span>
            <span>Recording Voice Memo... ({voiceDuration}s)</span>
          </div>
          <button
            onClick={stopVoiceRecording}
            className="btn-primary bg-rose-650 hover:bg-rose-550 text-white px-4 py-1.5 text-xs"
          >
            Done / Send Memo
          </button>
        </div>
      )}

      {/* Input Form Bar */}
      <form onSubmit={handleSendMessage} className="p-4 bg-slate-900/60 border-t border-slate-800/80 flex items-center gap-2 px-6">
        <div className="flex items-center gap-1.5 text-slate-400">
          <button
            type="button"
            onClick={() => setInputText((prev) => prev + ' #idea ')}
            className="px-2 py-1 text-[10px] bg-slate-950 hover:bg-slate-850 rounded-lg border border-slate-800/80 text-slate-350 font-mono transition"
          >
            #idea
          </button>
          <button
            type="button"
            onClick={() => setInputText((prev) => prev + ' #todo ')}
            className="px-2 py-1 text-[10px] bg-slate-950 hover:bg-slate-855 rounded-lg border border-slate-800/80 text-slate-350 font-mono transition"
          >
            #todo
          </button>
          <button
            type="button"
            onClick={() => setInputText((prev) => prev + ' #urgent ')}
            className="px-2 py-1 text-[10px] bg-slate-950 hover:bg-slate-850 rounded-lg border border-slate-800/80 text-slate-350 font-mono transition"
          >
            #urgent
          </button>
        </div>

        <input
          type="text"
          placeholder="Type a personal note, idea, link, or task (supports #tags)..."
          className="input-base flex-1"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />

        <button
          type="button"
          onClick={isRecordingVoice ? stopVoiceRecording : startVoiceRecording}
          className={`p-2.5 rounded-xl transition ${
            isRecordingVoice ? 'bg-rose-650 text-white' : 'btn-secondary p-2.5'
          }`}
          title="Record Voice Memo"
        >
          {isRecordingVoice ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-450" />}
        </button>

        <button
          type="submit"
          disabled={!inputText.trim()}
          className="btn-primary py-2.5 px-4"
          title="Send Note"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
