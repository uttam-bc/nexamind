import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  Upload,
  Play,
  CheckCircle2,
  Clock,
  Sparkles,
  FileText,
  Trash2,
  Radio,
  Volume2,
  Subtitles,
  MessageSquare,
  Copy,
  Check,
  Download,
  Search,
  Plus,
  ArrowRight,
  Square,
  CheckSquare,
  FileCheck,
  RefreshCw,
  Printer,
  FilePlus,
  Calendar,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../api';

export default function Meetings({ workspaceId, sessions, onRefreshSessions, onRefreshDocuments }) {
  const [activeRoom, setActiveRoom] = useState(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [showSidePanel, setShowSidePanel] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [liveTranscript, setLiveTranscript] = useState([]);
  const [currentCaption, setCurrentCaption] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [endingMeeting, setEndingMeeting] = useState(false);
  const [generatingMom, setGeneratingMom] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedMom, setCopiedMom] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [actionItemsStatus, setActionItemsStatus] = useState({});
  const [creatingTaskIndex, setCreatingTaskIndex] = useState(null);
  const [convertingToDoc, setConvertingToDoc] = useState(false);

  // Subtab for viewing selected session details: 'mom' | 'actions' | 'transcript'
  const [sessionDetailTab, setSessionDetailTab] = useState('mom');

  // Video and audio stream refs
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const animFrameRef = useRef(null);
  const transcriptBottomRef = useRef(null);

  // Timer
  useEffect(() => {
    if (activeRoom) {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeRoom]);

  // Scroll transcript to bottom
  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveTranscript, currentCaption]);

  // Select default session
  useEffect(() => {
    if (!selectedSession && sessions && sessions.length > 0) {
      setSelectedSession(sessions[0]);
    }
  }, [sessions]);

  // Start Real Live Video Conference
  const startLiveConference = async () => {
    try {
      const room = await api.startVideoRoom(workspaceId, 'Team Standup & Executive Sync');
      setActiveRoom(room);
      setLiveTranscript([]);
      setCurrentCaption('');
      setMeetingNotes('');

      // 1. Request real webcam & microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // 2. Real Audio Level Meter using Web Audio API
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const audioCtx = new AudioContext();
          audioContextRef.current = audioCtx;
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateVolume = () => {
            if (!mediaStreamRef.current) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            setAudioLevel(Math.min(100, Math.round(avg * 1.6)));
            animFrameRef.current = requestAnimationFrame(updateVolume);
          };
          updateVolume();
        }
      } catch (audioErr) {
        console.warn('Audio level monitor warning:', audioErr);
      }

      // 3. MediaRecorder real audio capture
      audioChunksRef.current = [];
      try {
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;
      } catch (recErr) {
        console.warn('MediaRecorder error:', recErr);
      }

      // 4. Real-time Live Speech Recognition (Web Speech API)
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              const text = transcript.trim();
              if (text) {
                setLiveTranscript((prev) => [
                  ...prev,
                  {
                    id: Date.now(),
                    speaker: 'You',
                    text,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ]);
                setCurrentCaption('');
              }
            } else {
              interim += transcript;
              setCurrentCaption(interim);
            }
          }
        };

        recognition.onerror = (e) => {
          console.warn('Live speech recognition notice:', e.error);
        };

        recognition.onend = () => {
          if (mediaStreamRef.current && activeRoom) {
            try { recognition.start(); } catch {}
          }
        };

        recognition.start();
        speechRecognitionRef.current = recognition;
      }
    } catch (err) {
      alert(`Camera/Microphone access error: ${err.message}. Please allow permissions in your browser.`);
    }
  };

  // Toggle Camera
  const toggleCamera = () => {
    if (mediaStreamRef.current) {
      const videoTracks = mediaStreamRef.current.getVideoTracks();
      videoTracks.forEach((track) => (track.enabled = !track.enabled));
      setIsCameraOn(!isCameraOn);
    }
  };

  // Toggle Microphone
  const toggleMic = () => {
    if (mediaStreamRef.current) {
      const audioTracks = mediaStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => (track.enabled = !track.enabled));
      setIsMicOn(!isMicOn);
    }
  };

  // Screen Share
  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = screenStream;
        }
        setIsScreenSharing(true);
        screenStream.getVideoTracks()[0].onended = () => {
          if (videoRef.current && mediaStreamRef.current) {
            videoRef.current.srcObject = mediaStreamRef.current;
          }
          setIsScreenSharing(false);
        };
      } catch (err) {
        console.warn('Screen share cancelled', err);
      }
    } else {
      if (videoRef.current && mediaStreamRef.current) {
        videoRef.current.srcObject = mediaStreamRef.current;
      }
      setIsScreenSharing(false);
    }
  };

  // End Live Conference & Synthesize Real AI MoM
  const endLiveConference = async () => {
    setEndingMeeting(true);
    try {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
      }
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }

      // Compile exact spoken conversation
      const spokenLines = liveTranscript.map((t) => `${t.speaker}: ${t.text}`).join('\n');
      const fullTranscript = [
        spokenLines,
        meetingNotes.trim() ? `Notes: ${meetingNotes.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const savedSession = await api.endVideoRoom(
        workspaceId,
        activeRoom.room_id,
        fullTranscript || `Meeting session held (${formatDuration(callDuration)}). Spoken discussion logged.`
      );

      setActiveRoom(null);
      await onRefreshSessions();
      setSelectedSession(savedSession);
      setSessionDetailTab('mom');
    } catch (err) {
      alert(`Failed to save session summary: ${err.message}`);
    } finally {
      setEndingMeeting(false);
    }
  };

  // 1-Click Generate / Refresh Minutes of the Meeting (MoM)
  const handleGenerateMom = async () => {
    if (!selectedSession || generatingMom) return;
    setGeneratingMom(true);
    try {
      const updated = await api.generateSessionMom(workspaceId, selectedSession.id);
      setSelectedSession(updated);
      await onRefreshSessions();
      setSessionDetailTab('mom');
    } catch (err) {
      alert(`MoM Generation failed: ${err.message}`);
    } finally {
      setGeneratingMom(false);
    }
  };

  // 1-Click Convert MoM into Workspace Block Document
  const handleConvertMoMToDocument = async () => {
    if (!selectedSession || convertingToDoc) return;
    setConvertingToDoc(true);
    try {
      const title = `Minutes of Meeting: ${selectedSession.title}`;
      const blocks = [
        { id: '1', type: 'heading', level: 1, text: title },
        { id: '2', type: 'paragraph', text: selectedSession.ai_summary || 'Minutes of Meeting recorded.' },
      ];
      await api.createDocument(workspaceId, title, { blocks });
      if (onRefreshDocuments) await onRefreshDocuments();
      alert('Minutes of the Meeting (MoM) saved as a Document spec in your Documents module!');
    } catch (err) {
      alert(`Error saving document: ${err.message}`);
    } finally {
      setConvertingToDoc(false);
    }
  };

  // 1-Click Convert Meeting Action Item into Kanban Task
  const handleConvertToTask = async (itemText, index) => {
    setCreatingTaskIndex(index);
    try {
      await api.createTask(workspaceId, {
        title: itemText,
        description: `Created directly from meeting session '${selectedSession?.title}' (Minutes of the Meeting)`,
        priority: 'high',
        status: 'todo',
      });
      alert(`Task created on Kanban board: "${itemText}"`);
    } catch (err) {
      alert(`Could not create task: ${err.message}`);
    } finally {
      setCreatingTaskIndex(null);
    }
  };

  // 1-Click Convert Meeting Action Item into Calendar Reminder
  const handleConvertToCalendarEvent = async (itemText) => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];
      await api.createCalendarEvent(workspaceId, {
        title: itemText,
        description: `Follow-up scheduled from meeting session '${selectedSession?.title}' (Minutes of the Meeting)`,
        event_date: dateStr,
        event_time: '02:00 PM',
        event_type: 'deadline',
        priority: 'high',
        source: 'meeting_action_item',
      });
      alert(`Reminder scheduled on your Calendar for tomorrow at 2:00 PM: "${itemText}"`);
    } catch (err) {
      alert(`Could not schedule reminder: ${err.message}`);
    }
  };

  const copyTranscriptToClipboard = () => {
    if (selectedSession?.transcript) {
      navigator.clipboard.writeText(selectedSession.transcript);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 2000);
    }
  };

  const copyMoMToClipboard = () => {
    if (selectedSession?.ai_summary) {
      navigator.clipboard.writeText(selectedSession.ai_summary);
      setCopiedMom(true);
      setTimeout(() => setCopiedMom(false), 2000);
    }
  };

  const exportDebriefMarkdown = () => {
    if (!selectedSession) return;
    const md = `# Minutes of the Meeting (MoM): ${selectedSession.title}
Date: ${new Date(selectedSession.created_at).toLocaleString()}
Source: ${selectedSession.source.toUpperCase()}

${selectedSession.ai_summary || 'No MoM summary generated yet.'}

## Action Items Checklist
${(selectedSession.action_items || []).map((a) => `- [ ] ${a}`).join('\n')}

## Spoken Transcript
\`\`\`
${selectedSession.transcript || 'No transcript'}
\`\`\`
`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSession.title.replace(/\s+/g, '_')}_Minutes_of_Meeting.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Upload External Audio File
  const handleUploadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', file.name.replace(/\.[^/.]+$/, ''));
      const created = await api.uploadSession(workspaceId, fd);
      await onRefreshSessions();
      setSelectedSession(created);
      setSessionDetailTab('mom');
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const copyMeetingCode = () => {
    if (activeRoom) {
      navigator.clipboard.writeText(activeRoom.room_url || window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 tracking-tight flex items-center gap-2">
            <span>Video Meetings & Minutes of the Meeting (MoM)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            WebRTC video conferencing, live speech recognition, formal executive MoM summaries, and action tracking.
          </p>
        </div>

        {!activeRoom && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-slate-300 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer border border-slate-800 transition">
              <Upload className="w-4 h-4 text-indigo-400" />
              <span>{uploading ? 'Transcribing & Generating MoM...' : 'Upload Recording'}</span>
              <input
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                disabled={uploading}
                onChange={handleUploadFile}
              />
            </label>

            <button
              onClick={startLiveConference}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition active:scale-95"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Start Live Video Call</span>
            </button>
          </div>
        )}
      </div>

      {/* ---------------- LIVE ACTIVE CONFERENCE THEATER ---------------- */}
      {activeRoom && (
        <div className="flex-1 flex flex-col bg-slate-950 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl relative min-h-[560px]">
          {/* Top Bar Overlay */}
          <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-slate-950/90 via-slate-950/50 to-transparent z-20 flex items-center justify-between pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 text-xs font-bold">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping"></span>
                <span>LIVE</span>
              </div>
              <h3 className="font-extrabold text-slate-100 text-sm tracking-tight">{activeRoom.name}</h3>
              <span className="text-xs font-mono text-slate-300 bg-slate-900/80 px-2.5 py-0.5 rounded-lg border border-slate-800">
                {formatDuration(callDuration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={copyMeetingCode}
                className="flex items-center gap-1.5 bg-slate-900/80 hover:bg-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-xl border border-slate-800 transition"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Link Copied' : 'Share Call'}</span>
              </button>
              <button
                onClick={() => setShowSidePanel(!showSidePanel)}
                className={`p-2 rounded-xl border text-xs font-semibold transition ${
                  showSidePanel
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-slate-900/80 text-slate-400 border-slate-800'
                }`}
                title="Toggle Live Discussion Drawer"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Main Video Area & Live Drawer */}
          <div className="flex-1 flex min-h-0 relative">
            {/* Live Camera Viewport */}
            <div className="flex-1 relative bg-slate-950 flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />

              {!isCameraOn && (
                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center text-slate-500">
                  <div className="w-24 h-24 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-3 shadow-xl">
                    <VideoOff className="w-10 h-10 text-slate-600" />
                  </div>
                  <span className="text-sm font-semibold text-slate-400">Camera Off</span>
                </div>
              )}

              {/* Floating Participant Overlay Badge */}
              <div className="absolute top-16 left-5 flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 shadow-lg">
                <div
                  className={`w-3 h-3 rounded-full transition-all ${
                    audioLevel > 15 ? 'bg-emerald-400 ring-4 ring-emerald-400/30' : 'bg-slate-600'
                  }`}
                />
                <span className="text-xs font-bold text-slate-200">You (Host)</span>
                {isMicOn ? (
                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <MicOff className="w-3.5 h-3.5 text-rose-400" />
                )}
              </div>

              {/* Real-time Subtitles / Closed Captions Overlay */}
              {showCaptions && (currentCaption || liveTranscript.length > 0) && (
                <div className="absolute bottom-24 inset-x-0 flex justify-center px-6 pointer-events-none z-10">
                  <div className="bg-black/85 backdrop-blur-md text-white px-5 py-2.5 rounded-2xl max-w-xl text-center text-sm font-medium leading-relaxed border border-white/10 shadow-2xl animate-fade-in">
                    {currentCaption || liveTranscript[liveTranscript.length - 1]?.text}
                  </div>
                </div>
              )}
            </div>

            {/* Side Drawer: Live Transcripts & Discussion */}
            {showSidePanel && (
              <div className="w-84 glass-panel border-l border-slate-800 bg-slate-900/95 flex flex-col p-4 z-10">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Live Spoken Captions
                    </span>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                    {liveTranscript.length} lines
                  </span>
                </div>

                {/* Spoken Captions Stream */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs">
                  {liveTranscript.map((t) => (
                    <div
                      key={t.id}
                      className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 space-y-1"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span className="font-bold text-indigo-400">{t.speaker}</span>
                        <span>{t.time}</span>
                      </div>
                      <p className="text-slate-200 leading-relaxed font-sans">{t.text}</p>
                    </div>
                  ))}

                  {currentCaption && (
                    <div className="bg-indigo-950/30 p-3 rounded-xl border border-indigo-500/30 space-y-1">
                      <div className="text-[10px] text-indigo-400 font-bold">Speaking...</div>
                      <p className="text-slate-300 italic">{currentCaption}</p>
                    </div>
                  )}

                  {liveTranscript.length === 0 && !currentCaption && (
                    <div className="text-slate-500 italic text-center py-10 text-xs">
                      Speak into your microphone. Your spoken words will appear here in real-time.
                    </div>
                  )}
                  <div ref={transcriptBottomRef} />
                </div>

                {/* Additional Meeting Notes Box */}
                <div className="pt-3 border-t border-slate-800 space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    In-Call Notes
                  </label>
                  <textarea
                    placeholder="Type key decisions or meeting notes..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-16"
                    value={meetingNotes}
                    onChange={(e) => setMeetingNotes(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bottom Floating Control Dock */}
          <div className="p-4 bg-slate-950/95 border-t border-slate-800/80 flex items-center justify-between px-8 z-20">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-emerald-400" />
              <div className="w-20 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-75 rounded-full"
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
            </div>

            {/* Central Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={toggleMic}
                className={`p-3.5 rounded-2xl transition shadow-lg ${
                  isMicOn ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-rose-600 text-white hover:bg-rose-500'
                }`}
                title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
              >
                {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              <button
                onClick={toggleCamera}
                className={`p-3.5 rounded-2xl transition shadow-lg ${
                  isCameraOn ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-rose-600 text-white hover:bg-rose-500'
                }`}
                title={isCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
              >
                {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>

              <button
                onClick={toggleScreenShare}
                className={`p-3.5 rounded-2xl transition shadow-lg ${
                  isScreenSharing ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                }`}
                title="Share Screen"
              >
                <Monitor className="w-5 h-5" />
              </button>

              <button
                onClick={() => setShowCaptions(!showCaptions)}
                className={`p-3.5 rounded-2xl transition shadow-lg ${
                  showCaptions ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
                title="Toggle Subtitles"
              >
                <Subtitles className="w-5 h-5" />
              </button>

              <button
                onClick={endLiveConference}
                disabled={endingMeeting}
                className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-6 py-3.5 rounded-2xl text-xs font-extrabold shadow-xl shadow-rose-600/30 transition active:scale-95"
              >
                <PhoneOff className="w-4 h-4" />
                <span>{endingMeeting ? 'Generating Formal MoM Debrief...' : 'End Call & Generate MoM'}</span>
              </button>
            </div>

            <div className="text-xs text-slate-500 font-mono">
              WebRTC Active
            </div>
          </div>
        </div>
      )}

      {/* ---------------- SESSIONS ARCHIVE & MINUTES OF THE MEETING (MoM) VIEWER ---------------- */}
      <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Sessions List */}
        <div className="col-span-1 glass-panel p-4 rounded-2xl border border-slate-800 flex flex-col">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Meeting Archives ({sessions.length})
            </span>
            <button onClick={onRefreshSessions} className="text-xs text-indigo-400 hover:underline">
              Refresh
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {sessions.map((s) => {
              const isSelected = selectedSession?.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSession(s)}
                  className={`w-full text-left p-3.5 rounded-xl transition border ${
                    isSelected
                      ? 'bg-indigo-600/15 border-indigo-500 text-slate-100 shadow-md'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs truncate max-w-[170px]">{s.title}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        s.status === 'done'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center justify-between">
                    <span>Source: {s.source}</span>
                    <span>{new Date(s.created_at).toLocaleDateString()}</span>
                  </div>
                </button>
              );
            })}

            {sessions.length === 0 && (
              <div className="text-center text-slate-500 py-12 text-xs">
                No meeting sessions recorded yet. Start a live call or upload a recording above.
              </div>
            )}
          </div>
        </div>

        {/* Selected Session Minutes of the Meeting (MoM) Detail */}
        <div className="col-span-2 glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col min-h-0 bg-slate-950/40">
          {selectedSession ? (
            <div className="flex flex-col h-full space-y-4">
              {/* Session Top Header */}
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-xl font-extrabold text-slate-100">{selectedSession.title}</h3>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-3">
                    <span>Source: <strong className="text-slate-300 uppercase">{selectedSession.source}</strong></span>
                    <span>•</span>
                    <span>Created: {new Date(selectedSession.created_at).toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerateMom}
                    disabled={generatingMom}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition"
                    title="Generate or Refresh Minutes of the Meeting using AI"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${generatingMom ? 'animate-spin' : ''}`} />
                    <span>{generatingMom ? 'Generating MoM...' : 'Generate MoM'}</span>
                  </button>

                  <button
                    onClick={handleConvertMoMToDocument}
                    disabled={convertingToDoc}
                    className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-3 py-1.5 rounded-xl text-xs font-semibold transition"
                    title="Save Minutes of Meeting as a Collaborative Document"
                  >
                    <FilePlus className="w-3.5 h-3.5 text-purple-400" />
                    <span>Save as Doc</span>
                  </button>

                  <button
                    onClick={exportDebriefMarkdown}
                    className="p-2 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-lg transition"
                    title="Download Markdown MoM"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => window.print()}
                    className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
                    title="Print / Save PDF MoM"
                  >
                    <Printer className="w-4 h-4" />
                  </button>

                  <button
                    onClick={async () => {
                      if (confirm('Delete this meeting session?')) {
                        await api.deleteSession(workspaceId, selectedSession.id);
                        await onRefreshSessions();
                        setSelectedSession(null);
                      }
                    }}
                    className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                    title="Delete Session"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* View Switcher Tabs: MoM | Actions | Spoken Transcript */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                  <button
                    onClick={() => setSessionDetailTab('mom')}
                    className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
                      sessionDetailTab === 'mom' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Minutes of Meeting (MoM)</span>
                  </button>

                  <button
                    onClick={() => setSessionDetailTab('actions')}
                    className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
                      sessionDetailTab === 'actions' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Action Items ({selectedSession.action_items?.length || 0})</span>
                  </button>

                  <button
                    onClick={() => setSessionDetailTab('transcript')}
                    className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
                      sessionDetailTab === 'transcript' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Spoken Transcript</span>
                  </button>
                </div>

                {sessionDetailTab === 'mom' && (
                  <button
                    onClick={copyMoMToClipboard}
                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition"
                  >
                    {copiedMom ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedMom ? 'MoM Copied' : 'Copy MoM'}</span>
                  </button>
                )}
              </div>

              {/* TAB 1: FORMAL MINUTES OF THE MEETING (MoM) */}
              {sessionDetailTab === 'mom' && (
                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  <div className="bg-slate-900/90 p-6 rounded-2xl border border-slate-800 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed shadow-inner font-sans">
                    {selectedSession.ai_summary || (
                      <div className="text-center py-10 space-y-3">
                        <Sparkles className="w-8 h-8 text-indigo-400 mx-auto animate-pulse" />
                        <p className="text-slate-400 text-xs">No Minutes of Meeting generated yet.</p>
                        <button
                          onClick={handleGenerateMom}
                          disabled={generatingMom}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold"
                        >
                          {generatingMom ? 'Generating...' : 'Synthesize MoM with AI'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: ACTION ITEMS CHECKLIST WITH 1-CLICK KANBAN CONVERSION */}
              {sessionDetailTab === 'actions' && (
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                    <span>Extracted meeting deliverables:</span>
                    <span>1-Click Convert to Kanban Task</span>
                  </div>

                  <div className="space-y-2">
                    {selectedSession.action_items && selectedSession.action_items.length > 0 ? (
                      selectedSession.action_items.map((item, idx) => {
                        const isCompleted = actionItemsStatus[idx];
                        const isCreatingThis = creatingTaskIndex === idx;
                        return (
                          <div
                            key={idx}
                            className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-200 group hover:border-indigo-500/40 transition shadow-sm"
                          >
                            <label className="flex items-start gap-3 cursor-pointer flex-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setActionItemsStatus((prev) => ({ ...prev, [idx]: !prev[idx] }))
                                }
                                className="mt-0.5 text-emerald-400 hover:scale-110 transition"
                              >
                                {isCompleted ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
                              </button>
                              <span className={`font-medium leading-relaxed ${isCompleted ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                                {item}
                              </span>
                            </label>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={() => handleConvertToCalendarEvent(item)}
                                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 transition"
                                title="Schedule reminder on Calendar"
                              >
                                <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                                <span>Reminder</span>
                              </button>
                              <button
                                onClick={() => handleConvertToTask(item, idx)}
                                disabled={isCreatingThis}
                                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-md shadow-indigo-600/30"
                                title="Add as task on Kanban board"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>{isCreatingThis ? 'Adding...' : 'Add to Kanban'}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-slate-500 italic p-6 bg-slate-900/40 rounded-xl text-center">
                        No action items recorded for this session.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: EXACT SPOKEN TRANSCRIPT */}
              {sessionDetailTab === 'transcript' && (
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Verbatim spoken conversation:</span>

                    <div className="flex items-center gap-2">
                      <div className="relative w-44">
                        <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          placeholder="Search transcript..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                          value={transcriptSearch}
                          onChange={(e) => setTranscriptSearch(e.target.value)}
                        />
                      </div>

                      <button
                        onClick={copyTranscriptToClipboard}
                        className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg text-xs flex items-center gap-1 border border-slate-800 transition"
                      >
                        {copiedTranscript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span className="text-[10px] font-semibold">{copiedTranscript ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800/80 text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed shadow-inner">
                    {transcriptSearch ? (
                      selectedSession.transcript
                        ?.split('\n')
                        .filter((line) => line.toLowerCase().includes(transcriptSearch.toLowerCase()))
                        .join('\n') || 'No matching lines found.'
                    ) : (
                      selectedSession.transcript || 'No spoken transcript available.'
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 py-16">
              <Video className="w-12 h-12 mb-3 text-slate-600" />
              <span className="text-sm font-semibold">Select a meeting session to view Minutes of the Meeting (MoM)</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
