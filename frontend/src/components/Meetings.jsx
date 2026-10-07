import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  Sparkles,
  Smile,
  MoreVertical,
  Activity,
  CalendarPlus,
  Check,
  User,
  Users,
  FileText,
  Clock,
  MoreHorizontal,
  Calendar,
  MessageSquare,
  Share2,
  Copy,
  Plus,
  Send,
  X,
  UserPlus,
  Upload,
  Play,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Radio,
  Trash2,
  ListChecks,
} from 'lucide-react';
import { api, getAuthToken } from '../api';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export default function Meetings({
  workspaceId,
  workspace,
  workspaces = [],
  onSelectWorkspace,
  user,
  sessions,
  onRefreshSessions,
  onRefreshDocuments,
}) {
  const currentUserName = user?.name || 'You';
  const currentUserId = String(user?.id || 'local-user');
  const teamWorkspace = workspaces.find((w) => w.type === 'team' || w.type === 'group' || (w.id !== workspaceId && w.join_code));

  // 1. Meeting Lobby vs In-Call State
  const [activeRoom, setActiveRoom] = useState(null);
  const [ongoingWorkspaceMeeting, setOngoingWorkspaceMeeting] = useState(null);
  const [meetingTitleInput, setMeetingTitleInput] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // 2. Past Meeting Detail Modal State
  const [selectedPastMeeting, setSelectedPastMeeting] = useState(null);
  const [pastMeetingTab, setPastMeetingTab] = useState('mom'); // 'mom' | 'transcript' | 'actions'
  const [copiedPastMeeting, setCopiedPastMeeting] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [isRegeneratingMom, setIsRegeneratingMom] = useState(false);

  // 3. In-Call Media & Participant State
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [copiedCode, setCopiedCode] = useState(false);

  // Real connected participants
  const [participants, setParticipants] = useState([
    {
      id: currentUserId,
      name: currentUserName,
      isLocal: true,
      role: 'Host',
      mic: true,
      cam: true,
    },
  ]);

  // Remote streams dictionary { [peerId]: MediaStream }
  const [remoteStreams, setRemoteStreams] = useState({});

  // In-call collaboration
  const [activeDrawer, setActiveDrawer] = useState(null);
  const [inCallChat, setInCallChat] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Real live transcript from speech recognition
  const [liveTranscript, setLiveTranscript] = useState([]);
  const [currentCaption, setCurrentCaption] = useState('');
  const [actionItems, setActionItems] = useState([]);
  const [syncedActionIds, setSyncedActionIds] = useState(new Set());
  const [newActionInput, setNewActionInput] = useState('');
  const [showAddAction, setShowAddAction] = useState(false);

  // References
  const localVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const timerRef = useRef(null);
  const audioContextRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const wsRef = useRef(null);
  const peerConnectionsRef = useRef({});

  // Query server for active room in workspace and sync participant list
  const fetchActiveRooms = async () => {
    if (!workspaceId) return;
    try {
      const rooms = await api.listActiveVideoRooms(workspaceId).catch(() => []);
      if (rooms && rooms.length > 0) {
        const room = rooms[0];
        setOngoingWorkspaceMeeting(room);
        if (room.participants && room.participants.length > 0) {
          setParticipants(room.participants);
        }
      } else {
        setOngoingWorkspaceMeeting(null);
      }
    } catch (e) {
      setOngoingWorkspaceMeeting(null);
    }
  };

  useEffect(() => {
    fetchActiveRooms();
    const interval = setInterval(fetchActiveRooms, 1000);
    return () => clearInterval(interval);
  }, [workspaceId, activeRoom]);

  // In-call timer
  useEffect(() => {
    if (activeRoom) {
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setCallDuration(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeRoom]);

  // WebRTC Helper: Create Peer Connection for remote peer
  const createPeerConnection = (peerId, peerName) => {
    if (peerConnectionsRef.current[peerId]) {
      return peerConnectionsRef.current[peerId];
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionsRef.current[peerId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: 'video_signal_ice_candidate',
            target_id: peerId,
            candidate: event.candidate,
          })
        );
      }
    };

    return pc;
  };

  // Local media setup (Webcam / Mic / Audio Analyzer / Speech Recognition)
  useEffect(() => {
    let audioInterval = null;

    if (activeRoom) {
      const startLocalMedia = async () => {
        if (navigator.mediaDevices?.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true,
            });
            localStreamRef.current = stream;
            setIsCameraOn(true);
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
            }

            try {
              const AudioContext = window.AudioContext || window.webkitAudioContext;
              if (AudioContext) {
                const audioCtx = new AudioContext();
                audioContextRef.current = audioCtx;
                const source = audioCtx.createMediaStreamSource(stream);
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                source.connect(analyser);
                const dataArray = new Uint8Array(analyser.frequencyBinCount);

                audioInterval = setInterval(() => {
                  analyser.getByteFrequencyData(dataArray);
                  const volume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                  setIsSpeaking(volume > 15);
                }, 120);
              }
            } catch (audioErr) {
              console.warn('Audio analyser error:', audioErr);
            }

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  event: 'video_signal_join',
                  room_id: activeRoom.room_id,
                })
              );
            }
          } catch (err) {
            console.warn('Camera access lock or blocked, switching to avatar mode:', err);
            setIsCameraOn(false);

            try {
              const audioOnlyStream = await navigator.mediaDevices.getUserMedia({ audio: true });
              localStreamRef.current = audioOnlyStream;
            } catch (aErr) {}

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  event: 'video_signal_join',
                  room_id: activeRoom.room_id,
                })
              );
            }
          }
        }
      };

      startLocalMedia();

      // Real-time Speech Recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';

          recognition.onresult = (event) => {
            const current = event.resultIndex;
            const transcript = event.results[current][0].transcript;
            setCurrentCaption(transcript);

            if (event.results[current].isFinal) {
              const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const newEntry = {
                id: `tr-${Date.now()}`,
                speaker: currentUserName,
                initial: currentUserName.slice(0, 2).toUpperCase(),
                color: 'bg-indigo-100 text-indigo-700',
                time: now,
                text: transcript,
              };

              setLiveTranscript((prev) => [...prev, newEntry]);
              setCurrentCaption('');

              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                  JSON.stringify({
                    event: 'transcript_broadcast',
                    entry: newEntry,
                  })
                );
              }

              const lower = transcript.toLowerCase();
              if (
                lower.includes('schedule') ||
                lower.includes('sync') ||
                lower.includes('by ') ||
                lower.includes('deadline') ||
                lower.includes('action') ||
                lower.includes('will do') ||
                lower.includes('need to')
              ) {
                const actionObj = {
                  id: `action-${Date.now()}`,
                  text: transcript,
                  assignee: currentUserName,
                  timeframe: 'Identified from speech',
                };
                setActionItems((prev) => [...prev, actionObj]);
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(
                    JSON.stringify({
                      event: 'action_item_broadcast',
                      action: actionObj,
                    })
                  );
                }
              }
            }
          };

          recognition.onerror = (e) => console.warn('Speech rec error:', e);
          try {
            recognition.start();
          } catch {}
          speechRecognitionRef.current = recognition;
        } catch (recErr) {
          console.warn('Speech recognition error:', recErr);
        }
      }
    }

    return () => {
      if (audioInterval) clearInterval(audioInterval);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {}
      }
      Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
      peerConnectionsRef.current = {};
    };
  }, [activeRoom, currentUserName]);

  // WebSocket signaling and room event synchronization
  useEffect(() => {
    if (!workspaceId) return;
    try {
      const token = getAuthToken();
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/workspaces/${workspaceId}/events?token=${token}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (activeRoom) {
          ws.send(
            JSON.stringify({
              event: 'video_signal_join',
              room_id: activeRoom.room_id,
            })
          );
        }
      };

      ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.event === 'video_room_started') {
            setOngoingWorkspaceMeeting({
              room_id: payload.room_id,
              name: payload.room_name,
              creator_name: payload.creator,
              participants: payload.participants || [],
            });
            if (payload.participants) {
              setParticipants(payload.participants);
            }
          } else if (payload.event === 'video_room_ended') {
            setOngoingWorkspaceMeeting(null);
            if (activeRoom && activeRoom.room_id === payload.room_id) {
              handleEndCall();
            }
          } else if (payload.event === 'video_room_user_joined') {
            if (payload.participants) {
              setParticipants(payload.participants);
            }
            fetchActiveRooms();
          } else if (payload.event === 'video_room_user_left') {
            setParticipants((prev) => prev.filter((p) => String(p.id) !== String(payload.user_id)));
            if (peerConnectionsRef.current[payload.user_id]) {
              peerConnectionsRef.current[payload.user_id].close();
              delete peerConnectionsRef.current[payload.user_id];
            }
            setRemoteStreams((prev) => {
              const updated = { ...prev };
              delete updated[payload.user_id];
              return updated;
            });
            fetchActiveRooms();
          }

          // Real-time transcript broadcast sync
          else if (payload.event === 'transcript_broadcast' && payload.entry) {
            setLiveTranscript((prev) => {
              if (prev.some((e) => e.id === payload.entry.id)) return prev;
              return [...prev, payload.entry];
            });
          } else if (payload.event === 'action_item_broadcast' && payload.action) {
            setActionItems((prev) => {
              if (prev.some((a) => a.id === payload.action.id)) return prev;
              return [...prev, payload.action];
            });
          }

          // WebRTC P2P signaling
          if (activeRoom && payload.sender_id && String(payload.sender_id) !== currentUserId) {
            const peerId = payload.sender_id;

            if (payload.event === 'video_signal_join') {
              const pc = createPeerConnection(peerId, payload.sender_name);
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              ws.send(
                JSON.stringify({
                  event: 'video_signal_offer',
                  target_id: peerId,
                  offer: offer,
                })
              );
            } else if (payload.event === 'video_signal_offer' && (!payload.target_id || String(payload.target_id) === currentUserId)) {
              const pc = createPeerConnection(peerId, payload.sender_name);
              await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              ws.send(
                JSON.stringify({
                  event: 'video_signal_answer',
                  target_id: peerId,
                  answer: answer,
                })
              );
            } else if (payload.event === 'video_signal_answer' && (!payload.target_id || String(payload.target_id) === currentUserId)) {
              const pc = peerConnectionsRef.current[peerId];
              if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
              }
            } else if (payload.event === 'video_signal_ice_candidate' && (!payload.target_id || String(payload.target_id) === currentUserId)) {
              const pc = peerConnectionsRef.current[peerId];
              if (pc && payload.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
              }
            }
          }
        } catch (e) {}
      };

      wsRef.current = ws;
      return () => {
        if (wsRef.current) wsRef.current.close();
      };
    } catch (err) {}
  }, [workspaceId, activeRoom]);

  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // 1. Action: Start or Join Single Workspace Live Meeting
  const handleStartInstantMeeting = async (title) => {
    if (ongoingWorkspaceMeeting) {
      return handleJoinOngoingMeeting(ongoingWorkspaceMeeting);
    }

    const finalTitle = title || meetingTitleInput.trim() || `${workspace?.name || 'Team'} Live Meeting`;
    try {
      const room = await api.createVideoRoom(workspaceId, finalTitle);
      setActiveRoom(room);
      setOngoingWorkspaceMeeting(room);
      if (room.participants && room.participants.length > 0) {
        setParticipants(room.participants);
      } else {
        setParticipants([{ id: currentUserId, name: currentUserName, isLocal: true, role: 'Host', mic: true, cam: true }]);
      }
      setLiveTranscript([]);
      setActionItems([]);
      fetchActiveRooms();
    } catch (err) {
      const fallbackRoom = {
        room_id: `room-${Date.now()}`,
        name: finalTitle,
        participants: [{ id: currentUserId, name: currentUserName, role: 'Host' }],
      };
      setActiveRoom(fallbackRoom);
      setOngoingWorkspaceMeeting(fallbackRoom);
    }
  };

  // 2. Action: Join Ongoing Workspace Meeting
  const handleJoinOngoingMeeting = async (room) => {
    try {
      const joined = await api.joinVideoRoom(workspaceId, room.room_id).catch(() => room);
      setActiveRoom(joined);
      setOngoingWorkspaceMeeting(joined);
      if (joined.participants && joined.participants.length > 0) {
        setParticipants(joined.participants);
      }
      fetchActiveRooms();
    } catch (err) {
      setActiveRoom(room);
    }
  };

  // 3. Action: Join with code
  const handleJoinWithCode = async (e) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    if (ongoingWorkspaceMeeting) {
      return handleJoinOngoingMeeting(ongoingWorkspaceMeeting);
    }
    handleStartInstantMeeting(`Room: ${joinCodeInput.trim().toUpperCase()}`);
    setJoinCodeInput('');
  };

  // 4. Action: Upload audio recording for autonomous AI MoM synthesis
  const handleUploadAudio = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAudio(true);
    setUploadProgress(`Processing ${file.name} through AI audio pipeline...`);

    try {
      const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      await api.uploadSessionFile(workspaceId, file, title);
      setUploadProgress('AI Synthesis complete! Meeting minutes generated.');
      setTimeout(() => {
        setIsUploadingAudio(false);
        setUploadProgress('');
        if (onRefreshSessions) onRefreshSessions();
        if (onRefreshDocuments) onRefreshDocuments();
      }, 2000);
    } catch (err) {
      alert(`Upload processing error: ${err.message}`);
      setIsUploadingAudio(false);
      setUploadProgress('');
    }
  };

  // 5. Action: Delete a Past Meeting Session
  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm('Are you sure you want to permanently delete this meeting session and its transcript/MoM?')) {
      return;
    }
    setIsDeletingSession(true);
    try {
      if (workspaceId) {
        await api.deleteSession(workspaceId, sessionId);
      }
      if (selectedPastMeeting && selectedPastMeeting.id === sessionId) {
        setSelectedPastMeeting(null);
      }
      if (onRefreshSessions) onRefreshSessions();
    } catch (err) {
      alert(`Failed to delete meeting: ${err.message}`);
    } finally {
      setIsDeletingSession(false);
    }
  };

  // 6. Action: Re-generate MoM for a Past Meeting
  const handleRegeneratePastMeetingMom = async (sessionId) => {
    setIsRegeneratingMom(true);
    try {
      if (workspaceId) {
        const updated = await api.generateSessionMom(workspaceId, sessionId);
        setSelectedPastMeeting(updated);
      }
      if (onRefreshSessions) onRefreshSessions();
    } catch (err) {
      alert(`Failed to regenerate minutes: ${err.message}`);
    } finally {
      setIsRegeneratingMom(false);
    }
  };

  // 7. Action: Copy Past Meeting Content to Clipboard
  const handleCopyPastMeetingContent = () => {
    if (!selectedPastMeeting) return;
    const content =
      pastMeetingTab === 'transcript'
        ? selectedPastMeeting.transcript || 'No transcript available.'
        : `${selectedPastMeeting.title}\n\n${selectedPastMeeting.ai_summary || 'No summary available.'}`;
    navigator.clipboard.writeText(content);
    setCopiedPastMeeting(true);
    setTimeout(() => setCopiedPastMeeting(false), 2000);
  };

  // Media controls
  const toggleCamera = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsCameraOn(track.enabled);
      }
    } else {
      setIsCameraOn(!isCameraOn);
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsMicOn(track.enabled);
      }
    } else {
      setIsMicOn(!isMicOn);
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      if (navigator.mediaDevices?.getDisplayMedia) {
        try {
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          screenStreamRef.current = screenStream;
          setIsScreenSharing(true);
          if (screenVideoRef.current) {
            screenVideoRef.current.srcObject = screenStream;
          }
          screenStream.getVideoTracks()[0].onended = () => {
            setIsScreenSharing(false);
            if (screenStreamRef.current) {
              screenStreamRef.current.getTracks().forEach((t) => t.stop());
            }
          };
        } catch (err) {
          console.warn('Screen share canceled:', err);
        }
      } else {
        setIsScreenSharing(true);
      }
    } else {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      setIsScreenSharing(false);
    }
  };

  const triggerReaction = (emoji) => {
    const id = Date.now() + Math.random();
    setFloatingReactions((prev) => [...prev, { id, emoji, left: Math.random() * 60 + 20 }]);
    setShowEmojiPicker(false);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2500);
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setInCallChat((prev) => [...prev, { sender: currentUserName, text: chatInput.trim(), time: now }]);
    setChatInput('');
  };

  const handleCopyJoinCode = () => {
    if (workspace?.join_code) {
      navigator.clipboard.writeText(workspace.join_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    }
  };

  const handleSyncAction = async (action) => {
    try {
      if (workspaceId) {
        await api.createCalendarEvent(workspaceId, {
          title: action.text,
          description: `Action item created during live meeting`,
          event_date: new Date().toISOString().split('T')[0],
          event_time: '03:00 PM',
          event_type: 'meeting',
          priority: 'high',
          source: 'ai_detected',
        });
      }
      setSyncedActionIds((prev) => new Set([...prev, action.id]));
    } catch (e) {
      setSyncedActionIds((prev) => new Set([...prev, action.id]));
    }
  };

  const handleAddActionItem = (e) => {
    e.preventDefault();
    if (!newActionInput.trim()) return;
    const actionObj = {
      id: `action-${Date.now()}`,
      text: newActionInput.trim(),
      assignee: currentUserName,
      timeframe: 'Manual Action Item',
    };
    setActionItems((prev) => [...prev, actionObj]);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: 'action_item_broadcast',
          action: actionObj,
        })
      );
    }
    setNewActionInput('');
    setShowAddAction(false);
  };

  const handleGenerateMinutes = async () => {
    try {
      const transcriptText = liveTranscript.map((t) => `${t.speaker} (${t.time}): ${t.text}`).join('\n');
      const actionText = actionItems.map((a) => `* [ ] **${a.assignee}:** ${a.text}`).join('\n');

      const momContent = `# Minutes of Meeting: ${activeRoom?.name || 'Team Sync'}\n\n**Date:** ${new Date().toLocaleDateString()}\n**Participants:** ${participants.map((p) => p.name).join(', ')}\n**Duration:** ${formatDuration(callDuration)}\n\n## 📝 Live Meeting Discussion\n${transcriptText || 'Live discussion notes captured during session.'}\n\n## ✅ Action Items & Commitments\n${actionText || '* No action items recorded.'}\n\n---\n*Synthesized autonomously by NexaMind Copilot*`;

      if (workspaceId) {
        await api.createDocument(workspaceId, {
          title: `MoM: ${activeRoom?.name || 'Live Meeting'} (${new Date().toLocaleDateString()})`,
          content: momContent,
        });
      }
      alert('AI Synthesis Complete: Real Meeting Minutes (MoM) saved to Documents.');
      if (onRefreshDocuments) onRefreshDocuments();
    } catch (err) {
      alert(`MoM error: ${err.message}`);
    }
  };

  const handleEndCall = async () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (activeRoom && workspaceId) {
      await api.endVideoRoom(workspaceId, activeRoom.room_id, {
        notes: liveTranscript.map((t) => `${t.speaker}: ${t.text}`).join('\n'),
      }).catch(() => {});
    }
    setActiveRoom(null);
    setOngoingWorkspaceMeeting(null);
    if (onRefreshSessions) onRefreshSessions();
  };

  const upcomingMeetings = [
    { title: 'Architecture Review & API Specs', time: 'Today, 02:00 PM', duration: '45m', type: 'Sprint Milestone' },
    { title: 'Sprint 42 Planning & Backlog Sync', time: 'Tomorrow, 10:30 AM', duration: '30m', type: 'Sprint Sync' },
  ];

  return (
    <div className="h-full w-full font-sans antialiased text-[#191C1E]">
      {/* ------------------------------------------------------------- */}
      {/* CASE A: MEETING CENTER LOBBY (SCROLLABLE PAGE)                 */}
      {/* ------------------------------------------------------------- */}
      {!activeRoom ? (
        <div className="space-y-6 max-w-6xl mx-auto py-2">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#191C1E]">
                Meetings & Video Hub
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Start instant video calls, join your team's ongoing meeting, or inspect recorded sessions, transcripts, and AI MoMs.
              </p>
            </div>

            <button
              onClick={() => handleStartInstantMeeting()}
              style={{ backgroundColor: '#4F46E5', color: '#FFFFFF' }}
              className="px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm hover:opacity-95 transition flex items-center gap-2"
            >
              <Video className="w-4 h-4 text-white" />
              <span>{ongoingWorkspaceMeeting ? 'Join Team Meeting' : '+ Start Team Meeting'}</span>
            </button>
          </div>

          {/* Solo Workspace Mode Notice with Quick Switch Button */}
          {workspace?.type === 'personal' && teamWorkspace && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-amber-900 shadow-sm animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0 font-bold">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-xs">You are currently in your Solo Workspace ({workspace?.name || 'Personal Account'})</p>
                  <p className="text-[11px] text-amber-800">Team video calls take place in your Team Group Workspace. Switch to "{teamWorkspace.name}" to connect with your team.</p>
                </div>
              </div>
              <button
                onClick={() => onSelectWorkspace && onSelectWorkspace(teamWorkspace.id)}
                className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition shrink-0 flex items-center gap-1.5"
              >
                <Users className="w-4 h-4" />
                <span>Switch to {teamWorkspace.name}</span>
              </button>
            </div>
          )}

          {/* 🔴 PROMINENT LIVE ONGOING WORKSPACE MEETING HERO BANNER */}
          {ongoingWorkspaceMeeting && (
            <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-indigo-50 border-2 border-emerald-400 p-6 rounded-2xl shadow-md flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-in">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30 shrink-0">
                  <Radio className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="bg-rose-500 text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                      LIVE NOW
                    </span>
                    <span className="text-xs font-mono text-emerald-800 font-bold">
                      {ongoingWorkspaceMeeting.participants?.length || 1} Team Member(s) Connected
                    </span>
                  </div>
                  <h3 className="font-extrabold text-base text-[#191C1E] mt-1">
                    {ongoingWorkspaceMeeting.name || 'Workspace Live Video Conference'}
                  </h3>
                  <p className="text-xs text-slate-600">
                    Host: <strong>{ongoingWorkspaceMeeting.creator_name || 'Team Member'}</strong> • One group meeting for the entire workspace.
                  </p>
                </div>
              </div>

              <button
                onClick={() => handleJoinOngoingMeeting(ongoingWorkspaceMeeting)}
                style={{ backgroundColor: '#10B981', color: '#FFFFFF' }}
                className="px-6 py-3 rounded-xl text-sm font-bold shadow-lg shadow-emerald-600/30 hover:bg-emerald-600 transition flex items-center gap-2 shrink-0 active:scale-95"
              >
                <Video className="w-4 h-4 text-white" />
                <span>Join Ongoing Meeting Now</span>
              </button>
            </div>
          )}

          {/* 3 Action Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Card 1: Start / Join Single Meeting */}
            <div className="bg-white border border-[#E2E8F0] p-6 rounded-2xl shadow-sm hover-lift space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#4F46E5] shadow-sm">
                  <Video className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#191C1E]">
                    {ongoingWorkspaceMeeting ? 'Join Team Meeting' : 'Start Instant Meeting'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {ongoingWorkspaceMeeting
                      ? 'A live call is already ongoing in your workspace. Connect directly with your team.'
                      : 'Launch a video room for the workspace with live speech transcription and Copilot action items.'}
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                {!ongoingWorkspaceMeeting && (
                  <input
                    type="text"
                    placeholder="Meeting title (e.g. Sprint Sync)..."
                    className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-3.5 py-2 text-xs text-[#191C1E] focus:outline-none"
                    value={meetingTitleInput}
                    onChange={(e) => setMeetingTitleInput(e.target.value)}
                  />
                )}
                <button
                  onClick={() => handleStartInstantMeeting()}
                  style={{ backgroundColor: ongoingWorkspaceMeeting ? '#10B981' : '#4F46E5', color: '#FFFFFF' }}
                  className="w-full py-2.5 rounded-xl text-xs font-bold shadow-sm hover:opacity-95 transition flex items-center justify-center gap-2"
                >
                  <Video className="w-4 h-4 text-white" />
                  <span>{ongoingWorkspaceMeeting ? 'Join Ongoing Call' : 'Start Meeting Now'}</span>
                </button>
              </div>
            </div>

            {/* Card 2: Join Meeting with Code */}
            <div className="bg-white border border-[#E2E8F0] p-6 rounded-2xl shadow-sm hover-lift space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-[#8B5CF6] shadow-sm">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#191C1E]">Join with Room Code</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Connect to your team's ongoing call by entering their room ID or workspace join code.
                  </p>
                </div>
              </div>

              <form onSubmit={handleJoinWithCode} className="space-y-2 pt-2">
                <input
                  type="text"
                  placeholder="Enter code (e.g. ROOM-1234)..."
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2 text-xs text-[#191C1E] focus:outline-none"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={!joinCodeInput.trim()}
                  className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white py-2.5 rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center gap-2"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span>Join Room</span>
                </button>
              </form>
            </div>

            {/* Card 3: Upload Audio for AI MoM */}
            <div className="bg-white border border-[#E2E8F0] p-6 rounded-2xl shadow-sm hover-lift space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-[#0EA5E9] shadow-sm">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#191C1E]">Upload Audio for AI MoM</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Upload recorded audio (.mp3, .wav) to automatically transcribe and synthesize meeting minutes.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/*"
                  className="hidden"
                  onChange={handleUploadAudio}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAudio}
                  className="w-full bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white py-2.5 rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isUploadingAudio ? 'Processing Audio...' : 'Upload Audio File'}</span>
                </button>
                {uploadProgress && (
                  <p className="text-[11px] font-mono text-slate-500 mt-1.5 text-center truncate">
                    {uploadProgress}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Upcoming Scheduled Syncs */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#191C1E] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#4F46E5]" />
                <span>Upcoming Workspace Meetings</span>
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {upcomingMeetings.map((m, idx) => (
                <div
                  key={idx}
                  className="bg-white border border-[#E2E8F0] p-5 rounded-2xl shadow-sm hover:border-[#4F46E5] transition flex items-center justify-between"
                >
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono font-bold bg-indigo-50 text-[#4F46E5] px-2 py-0.5 rounded">
                      {m.type}
                    </span>
                    <h4 className="font-bold text-sm text-[#191C1E]">{m.title}</h4>
                    <p className="text-xs text-slate-500 flex items-center gap-2 font-mono">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{m.time} ({m.duration})</span>
                    </p>
                  </div>

                  <button
                    onClick={() => handleStartInstantMeeting(m.title)}
                    className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1.5 shrink-0"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>Join</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Past Meeting Minutes Archive */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#191C1E] flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#8B5CF6]" />
                <span>Recorded Sessions & Minutes (MoM) Archive</span>
              </h2>
              <span className="text-xs font-mono text-slate-400">
                {sessions?.length || 0} Recorded Session(s)
              </span>
            </div>

            <div className="bg-white border border-[#E2E8F0] rounded-2xl divide-y divide-[#E2E8F0] overflow-hidden shadow-sm">
              {(sessions && sessions.length > 0) ? (
                sessions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setSelectedPastMeeting(s);
                      setPastMeetingTab('mom');
                    }}
                    className="p-4 flex items-center justify-between hover:bg-[#F8FAFC] transition cursor-pointer group"
                  >
                    <div className="space-y-1 pr-4 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-xs text-[#191C1E] group-hover:text-[#4F46E5] transition truncate">
                          {s.title}
                        </h4>
                        <span className="text-[10px] font-mono text-slate-400">
                          {s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-1 max-w-xl">
                        {s.ai_summary || s.transcript || 'Click to view full transcript & generated MoM.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 border border-emerald-200/60 px-2 py-1 rounded font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        <span>MoM Ready</span>
                      </span>

                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(s.id);
                        }}
                        title="Delete this meeting session"
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs space-y-2">
                  <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                  <p>No meeting sessions recorded yet.</p>
                  <p className="text-[11px] text-slate-500">
                    Start a video call or upload an audio file to generate automated minutes.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ------------------------------------------------------------- */}
          {/* PAST MEETING DETAIL MODAL (TRANSCRIPT, MOM & DELETE)          */}
          {/* ------------------------------------------------------------- */}
          {selectedPastMeeting && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-scale-up">
                {/* Modal Header */}
                <div className="p-5 md:p-6 border-b border-[#E2E8F0] flex items-start justify-between bg-gradient-to-r from-slate-50 to-indigo-50/30">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold bg-indigo-100 text-[#4F46E5] px-2 py-0.5 rounded">
                        Recorded Session
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        {selectedPastMeeting.created_at ? new Date(selectedPastMeeting.created_at).toLocaleString() : 'Past Meeting'}
                      </span>
                    </div>
                    <h2 className="text-lg md:text-xl font-bold text-[#191C1E]">
                      {selectedPastMeeting.title}
                    </h2>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Copy Content Button */}
                    <button
                      onClick={handleCopyPastMeetingContent}
                      className="p-2 rounded-xl bg-white border border-[#E2E8F0] text-slate-600 hover:text-indigo-600 hover:border-indigo-200 text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
                      title="Copy to Clipboard"
                    >
                      {copiedPastMeeting ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                      <span className="hidden sm:inline">{copiedPastMeeting ? 'Copied!' : 'Copy'}</span>
                    </button>

                    {/* Delete Session Button */}
                    <button
                      onClick={() => handleDeleteSession(selectedPastMeeting.id)}
                      disabled={isDeletingSession}
                      className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 hover:text-rose-700 text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
                      title="Delete Session"
                    >
                      <Trash2 className="w-4 h-4 text-rose-600" />
                      <span className="hidden sm:inline">{isDeletingSession ? 'Deleting...' : 'Delete'}</span>
                    </button>

                    {/* Close Button */}
                    <button
                      onClick={() => setSelectedPastMeeting(null)}
                      className="p-2 rounded-xl bg-white border border-[#E2E8F0] text-slate-400 hover:text-[#191C1E] transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Modal Navigation Tabs */}
                <div className="flex items-center gap-2 px-6 pt-3 border-b border-[#E2E8F0] bg-white">
                  <button
                    onClick={() => setPastMeetingTab('mom')}
                    className={`pb-3 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition ${
                      pastMeetingTab === 'mom'
                        ? 'border-[#4F46E5] text-[#4F46E5]'
                        : 'border-transparent text-slate-500 hover:text-[#191C1E]'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    <span>Meeting Minutes (MoM)</span>
                  </button>

                  <button
                    onClick={() => setPastMeetingTab('transcript')}
                    className={`pb-3 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition ${
                      pastMeetingTab === 'transcript'
                        ? 'border-[#4F46E5] text-[#4F46E5]'
                        : 'border-transparent text-slate-500 hover:text-[#191C1E]'
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    <span>Full Transcript</span>
                  </button>

                  <button
                    onClick={() => setPastMeetingTab('actions')}
                    className={`pb-3 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition ${
                      pastMeetingTab === 'actions'
                        ? 'border-[#4F46E5] text-[#4F46E5]'
                        : 'border-transparent text-slate-500 hover:text-[#191C1E]'
                    }`}
                  >
                    <ListChecks className="w-4 h-4" />
                    <span>Action Items ({selectedPastMeeting.action_items?.length || 0})</span>
                  </button>
                </div>

                {/* Modal Tab Content */}
                <div className="flex-1 overflow-y-auto p-6 text-sm text-[#191C1E] bg-[#FAFAFA] min-h-[260px]">
                  {pastMeetingTab === 'mom' && (
                    <div className="space-y-4">
                      {selectedPastMeeting.ai_summary ? (
                        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-sm prose prose-sm max-w-none text-slate-800 leading-relaxed whitespace-pre-wrap font-sans">
                          {selectedPastMeeting.ai_summary}
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-white border border-[#E2E8F0] rounded-2xl text-slate-400 space-y-3">
                          <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                          <p>No meeting minutes generated yet for this recording.</p>
                          <button
                            onClick={() => handleRegeneratePastMeetingMom(selectedPastMeeting.id)}
                            disabled={isRegeneratingMom}
                            className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition inline-flex items-center gap-2"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>{isRegeneratingMom ? 'Synthesizing with AI...' : 'Generate MoM Now'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {pastMeetingTab === 'transcript' && (
                    <div className="space-y-3">
                      {selectedPastMeeting.transcript ? (
                        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-sm text-xs font-mono text-slate-700 leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                          {selectedPastMeeting.transcript}
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-white border border-[#E2E8F0] rounded-2xl text-slate-400 space-y-2">
                          <Mic className="w-8 h-8 text-slate-300 mx-auto" />
                          <p>No speech transcript recorded for this session.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {pastMeetingTab === 'actions' && (
                    <div className="space-y-3">
                      {selectedPastMeeting.action_items && selectedPastMeeting.action_items.length > 0 ? (
                        <div className="space-y-2.5">
                          {selectedPastMeeting.action_items.map((item, idx) => (
                            <div
                              key={idx}
                              className="bg-white border border-[#E2E8F0] border-l-4 border-l-[#F43F5E] rounded-xl p-3.5 shadow-sm flex items-start justify-between gap-3"
                            >
                              <div>
                                <span className="bg-[#F43F5E]/10 text-[#F43F5E] text-[10px] font-mono font-bold px-2 py-0.5 rounded">
                                  Action Item
                                </span>
                                <p className="text-xs font-semibold text-[#191C1E] mt-1.5">
                                  {typeof item === 'string' ? item : item.text || item.title || JSON.stringify(item)}
                                </p>
                              </div>

                              <button
                                onClick={() => handleSyncAction({ id: `item-${idx}`, text: typeof item === 'string' ? item : item.text || item.title })}
                                className="bg-[#4F46E5]/10 hover:bg-[#4F46E5]/20 text-[#4F46E5] px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 shrink-0"
                              >
                                <CalendarPlus className="w-3.5 h-3.5" />
                                <span>Sync to Cal</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-white border border-[#E2E8F0] rounded-2xl text-slate-400 space-y-2">
                          <ListChecks className="w-8 h-8 text-slate-300 mx-auto" />
                          <p>No individual action items detected for this meeting.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="p-4 border-t border-[#E2E8F0] bg-white flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-500">
                    Status: <strong className="text-emerald-600 uppercase">{selectedPastMeeting.status || 'Completed'}</strong>
                  </span>

                  <button
                    onClick={() => setSelectedPastMeeting(null)}
                    className="px-5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#191C1E] text-xs font-bold transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ------------------------------------------------------------- */
        /* CASE B: ACTIVE LIVE MEETING ROOM (FULL SCREEN DARK STAGE)     */
        /* ------------------------------------------------------------- */
        <div className="fixed inset-0 z-50 flex bg-[#181C24] text-white overflow-hidden">
          {/* Main Video Room Area */}
          <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#181C24]">
            {/* Top Bar */}
            <div className="h-14 px-6 border-b border-slate-800/80 bg-[#12151C] flex items-center justify-between flex-shrink-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-[#F43F5E] animate-pulse"></div>
                <h1 className="text-base md:text-lg font-bold text-white tracking-tight">
                  {activeRoom.name || 'Live Video Meeting'}
                </h1>
                <span className="text-xs font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                  {formatDuration(callDuration)}
                </span>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded">
                  {participants.length} {participants.length === 1 ? 'Person (You)' : 'People Connected'}
                </span>
              </div>

              {/* Invite Code Quick Link */}
              <div className="flex items-center gap-2">
                {workspace?.join_code && (
                  <button
                    onClick={handleCopyJoinCode}
                    className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-xl border border-slate-700 transition"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-indigo-400" />}
                    <span>{copiedCode ? 'Code Copied!' : `Join Code: ${workspace.join_code}`}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Video Streams & Participants Grid */}
            <div className="flex-1 p-4 md:p-6 overflow-hidden flex flex-col gap-4 min-h-0 relative">
              {/* Floating Emojis Burst */}
              <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
                {floatingReactions.map((r) => (
                  <div
                    key={r.id}
                    className="absolute text-4xl animate-bounce transition-all duration-1000"
                    style={{ left: `${r.left}%`, bottom: '20%' }}
                  >
                    {r.emoji}
                  </div>
                ))}
              </div>

              {/* Dynamic Video Layout based on Real Participant Count */}
              <div className="flex-1 flex flex-col gap-4 min-h-0">
                {isScreenSharing ? (
                  /* Screen Sharing Spotlight View */
                  <div className="flex-1 rounded-2xl overflow-hidden bg-black border border-slate-700/80 shadow-2xl relative flex items-center justify-center min-h-0">
                    <video
                      ref={screenVideoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-contain bg-black"
                    />
                    <div className="absolute bottom-4 left-4 bg-black/75 backdrop-blur-md px-3.5 py-1.5 rounded-xl flex items-center gap-2 border border-white/10 text-xs font-mono">
                      <Monitor className="w-4 h-4 text-indigo-400" />
                      <span>{currentUserName} (Screen Sharing)</span>
                    </div>
                  </div>
                ) : (
                  /* Real Connected Participants Video Grid */
                  <div
                    className={`grid gap-4 flex-1 min-h-0 ${
                      participants.length === 1
                        ? 'grid-cols-1 max-w-4xl mx-auto w-full'
                        : participants.length === 2
                        ? 'grid-cols-1 md:grid-cols-2'
                        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                    }`}
                  >
                    {participants.map((p) => {
                      const isMe = p.isLocal || (user?.id && String(p.id) === String(user.id)) || p.name === currentUserName;
                      const remoteStream = remoteStreams[p.id];

                      return (
                        <div
                          key={p.id}
                          className={`relative rounded-2xl overflow-hidden bg-black border shadow-2xl flex items-center justify-center group ${
                            isMe && isSpeaking
                              ? 'border-emerald-500 ring-2 ring-emerald-500/50'
                              : 'border-slate-800'
                          }`}
                        >
                          {isMe ? (
                            /* Local User Real Camera Feed or Avatar */
                            <>
                              <video
                                ref={localVideoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`w-full h-full object-cover ${isCameraOn ? '' : 'hidden'}`}
                              />
                              {!isCameraOn && (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950 text-white space-y-3 p-6">
                                  <div className="w-24 h-24 rounded-full bg-indigo-600 border-2 border-indigo-400 flex items-center justify-center text-3xl font-bold shadow-xl">
                                    {p.name.slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="text-center">
                                    <h3 className="font-bold text-base">{p.name} (You)</h3>
                                    <p className="text-xs text-slate-400 font-mono">Live In Meeting</p>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            /* Remote Real Participant Feed with WebRTC Stream or Avatar */
                            remoteStream ? (
                              <video
                                autoPlay
                                playsInline
                                ref={(el) => {
                                  if (el && el.srcObject !== remoteStream) {
                                    el.srcObject = remoteStream;
                                  }
                                }}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950 text-white space-y-3 p-6">
                                <div className="w-24 h-24 rounded-full bg-purple-600 border-2 border-purple-400 flex items-center justify-center text-3xl font-bold shadow-xl animate-pulse">
                                  {p.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="text-center">
                                  <h3 className="font-bold text-base text-white">{p.name}</h3>
                                  <span className="text-[11px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded-full font-mono font-bold">
                                    Connected Live
                                  </span>
                                </div>
                              </div>
                            )
                          )}

                          {/* Participant Status Badge */}
                          <div className="absolute bottom-3 left-3 bg-black/75 backdrop-blur-md px-3 py-1 rounded-xl flex items-center gap-2 border border-white/10 text-xs font-mono z-20">
                            {isMe ? (
                              isMicOn ? (
                                <Activity className={`w-3.5 h-3.5 ${isSpeaking ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
                              ) : (
                                <MicOff className="w-3.5 h-3.5 text-rose-400" />
                              )
                            ) : (
                              <Mic className="w-3.5 h-3.5 text-emerald-400" />
                            )}
                            <span className="font-medium text-white">{p.name} {isMe ? '(You)' : ''}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Real-time Join Invitation Banner when alone */}
                {participants.length === 1 && (
                  <div className="bg-[#12151C] border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
                    <div className="flex items-center gap-3 text-xs text-slate-300">
                      <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                        <UserPlus className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-bold text-white">Waiting for other team members to join...</p>
                        <p className="text-slate-400 text-[11px]">Share your workspace join code so your real team members can join this call.</p>
                      </div>
                    </div>

                    {workspace?.join_code && (
                      <button
                        onClick={handleCopyJoinCode}
                        className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2 shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedCode ? 'Copied to Clipboard!' : `Copy Join Code (${workspace.join_code})`}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom In-Call Controls Bar */}
            <div className="h-18 px-6 bg-[#12151C] border-t border-slate-800/80 flex items-center justify-between flex-shrink-0 z-20">
              {/* Left: Mic and Cam Toggles */}
              <div className="flex items-center gap-2.5">
                <button
                  onClick={toggleMic}
                  style={isMicOn ? { backgroundColor: '#2D3748', color: '#FFFFFF' } : { backgroundColor: '#EF4444', color: '#FFFFFF' }}
                  className="p-3 rounded-full transition shadow-md hover:scale-105 active:scale-95"
                  title={isMicOn ? 'Mute Mic' : 'Unmute Mic'}
                >
                  {isMicOn ? <Mic className="w-4 h-4 text-white" /> : <MicOff className="w-4 h-4 text-white" />}
                </button>
                <button
                  onClick={toggleCamera}
                  style={isCameraOn ? { backgroundColor: '#2D3748', color: '#FFFFFF' } : { backgroundColor: '#EF4444', color: '#FFFFFF' }}
                  className="p-3 rounded-full transition shadow-md hover:scale-105 active:scale-95"
                  title={isCameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
                >
                  {isCameraOn ? <Video className="w-4 h-4 text-white" /> : <VideoOff className="w-4 h-4 text-white" />}
                </button>
              </div>

              {/* Center: Share Screen, Reactions, In-Call Chat, Participants */}
              <div className="flex items-center gap-2.5 relative">
                <button
                  onClick={toggleScreenShare}
                  style={isScreenSharing ? { backgroundColor: '#4F46E5', color: '#FFFFFF' } : { backgroundColor: '#2D3748', color: '#FFFFFF' }}
                  className="p-3 rounded-full transition shadow-md hover:scale-105 active:scale-95"
                  title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
                >
                  <Monitor className="w-4 h-4 text-white" />
                </button>

                {/* Emoji Reaction Popover */}
                <div className="relative">
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    style={{ backgroundColor: '#2D3748', color: '#FFFFFF' }}
                    className="p-3 rounded-full transition shadow-md hover:scale-105 active:scale-95"
                    title="Send Reaction"
                  >
                    <Smile className="w-4 h-4 text-white" />
                  </button>

                  {showEmojiPicker && (
                    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-700 rounded-2xl p-2 flex gap-2 shadow-2xl z-50 animate-fade-in">
                      {['👏', '🔥', '❤️', '🎉', '👍', '💡'].map((em) => (
                        <button
                          key={em}
                          onClick={() => triggerReaction(em)}
                          className="text-xl p-1.5 hover:bg-slate-800 rounded-xl transition hover:scale-125"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setActiveDrawer(activeDrawer === 'chat' ? null : 'chat')}
                  style={activeDrawer === 'chat' ? { backgroundColor: '#4F46E5', color: '#FFFFFF' } : { backgroundColor: '#2D3748', color: '#FFFFFF' }}
                  className="p-3 rounded-full transition shadow-md hover:scale-105 active:scale-95 relative"
                  title="In-call Chat"
                >
                  <MessageSquare className="w-4 h-4 text-white" />
                  {inCallChat.length > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#4F46E5]"></span>
                  )}
                </button>

                <button
                  onClick={() => setActiveDrawer(activeDrawer === 'participants' ? null : 'participants')}
                  style={activeDrawer === 'participants' ? { backgroundColor: '#4F46E5', color: '#FFFFFF' } : { backgroundColor: '#2D3748', color: '#FFFFFF' }}
                  className="p-3 rounded-full transition shadow-md hover:scale-105 active:scale-95"
                  title="Participants"
                >
                  <Users className="w-4 h-4 text-white" />
                </button>
              </div>

              {/* Right: End Call */}
              <button
                onClick={handleEndCall}
                style={{ backgroundColor: '#F43F5E', color: '#FFFFFF' }}
                className="px-6 py-2.5 rounded-full font-bold text-xs shadow-lg shadow-rose-600/40 hover:bg-rose-600 transition flex items-center gap-2 active:scale-95"
              >
                <PhoneOff className="w-4 h-4 text-white" />
                <span>End Call</span>
              </button>
            </div>
          </div>

          {/* In-Call Side Drawers */}
          {activeDrawer && (
            <div className="w-72 bg-[#12151C] border-l border-slate-800 flex flex-col h-full flex-shrink-0 z-20 text-white animate-fade-in">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-300">
                  {activeDrawer === 'chat' ? 'In-Call Chat' : `Participants (${participants.length})`}
                </h3>
                <button onClick={() => setActiveDrawer(null)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {activeDrawer === 'chat' ? (
                <div className="flex-1 flex flex-col p-4 space-y-3 min-h-0">
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {inCallChat.length === 0 ? (
                      <div className="text-center text-slate-500 py-12 text-xs italic">
                        No messages yet in this meeting.
                      </div>
                    ) : (
                      inCallChat.map((m, i) => (
                        <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs space-y-1">
                          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                            <span className="font-bold text-indigo-400">{m.sender}</span>
                            <span>{m.time}</span>
                          </div>
                          <p className="text-slate-200">{m.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleSendChat} className="flex gap-1.5 pt-2 border-t border-slate-800">
                    <input
                      type="text"
                      placeholder="Send a message..."
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                    />
                    <button type="submit" className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                  {participants.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-[10px]">
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-white">{p.name} {(user?.id && String(p.id) === String(user.id)) || p.name === currentUserName ? '(You)' : ''}</div>
                          <div className="text-[10px] text-slate-400">{p.role || 'Member'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400">
                        {p.mic !== false ? <Mic className="w-3.5 h-3.5 text-emerald-400" /> : <MicOff className="w-3.5 h-3.5 text-rose-400" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Right Sidebar: Real Copilot Speech & Audio Pipeline */}
          <aside className="w-[360px] bg-[#F8FAFC] text-[#191C1E] border-l border-[#E2E8F0] h-full flex flex-col shadow-[-4px_0_24px_rgba(0,0,0,0.05)] flex-shrink-0 font-sans z-20">
            {/* Header */}
            <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-white">
              <h2 className="text-base font-bold text-[#191C1E] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#8B5CF6] ai-pulse rounded-full" />
                <span>Copilot</span>
              </h2>
              <span className="bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 px-2 py-0.5 rounded text-xs font-mono font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></span>
                Listening
              </span>
            </div>

            {/* Pipeline Body */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
              {/* REAL LIVE TRANSCRIPT */}
              <div>
                <h3 className="text-xs font-mono uppercase font-bold text-slate-500 mb-3 tracking-wider flex items-center justify-between">
                  <span>Live Transcript</span>
                  <span className="text-[10px] text-slate-400 font-normal">Real Speech Capture</span>
                </h3>

                {liveTranscript.length === 0 && !currentCaption ? (
                  <div className="p-4 bg-white border border-[#E2E8F0] rounded-xl text-center text-slate-400 text-xs space-y-2">
                    <Mic className="w-6 h-6 text-[#4F46E5] mx-auto animate-pulse" />
                    <p className="font-semibold text-slate-700">Copilot is listening...</p>
                    <p className="text-[11px]">Speak into your microphone and words will be transcribed here and synced to all participants live.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {liveTranscript.map((entry) => (
                      <div key={entry.id} className="flex gap-2.5 text-xs bg-white border border-[#E2E8F0] p-2.5 rounded-xl shadow-sm">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${entry.color}`}
                        >
                          {entry.initial}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-[#191C1E] text-xs">{entry.speaker}</span>
                            <span className="text-[10px] font-mono text-slate-400">{entry.time}</span>
                          </div>
                          <p className="text-slate-700 text-xs mt-1 leading-relaxed">{entry.text}</p>
                        </div>
                      </div>
                    ))}

                    {/* Current Live Word Buffer */}
                    {currentCaption && (
                      <div className="flex gap-2.5 text-xs bg-indigo-50 border border-indigo-200 p-2.5 rounded-xl">
                        <div className="w-7 h-7 rounded-full bg-[#4F46E5] text-white flex items-center justify-center shrink-0">
                          <Mic className="w-3.5 h-3.5 animate-pulse" />
                        </div>
                        <div className="flex-1 pt-0.5">
                          <p className="text-xs italic text-[#4F46E5] font-medium leading-relaxed">
                            "{currentCaption}..."
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="h-px bg-[#E2E8F0] w-full"></div>

              {/* REAL ACTION ITEMS PREVIEW */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-mono uppercase font-bold text-slate-500 tracking-wider">
                    Action Items ({actionItems.length})
                  </h3>
                  <button
                    onClick={() => setShowAddAction(!showAddAction)}
                    className="text-[11px] font-bold text-[#4F46E5] hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>

                {showAddAction && (
                  <form onSubmit={handleAddActionItem} className="mb-3 flex gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      placeholder="e.g. Follow up on database migration..."
                      className="flex-1 bg-white border border-[#E2E8F0] rounded-xl px-3 py-1.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
                      value={newActionInput}
                      onChange={(e) => setNewActionInput(e.target.value)}
                    />
                    <button type="submit" className="bg-[#4F46E5] text-white px-3 py-1.5 rounded-xl text-xs font-bold">
                      Add
                    </button>
                  </form>
                )}

                {actionItems.length === 0 ? (
                  <div className="p-3 bg-white border border-[#E2E8F0] rounded-xl text-center text-slate-400 text-xs italic">
                    Action items detected from your speech will appear here.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {actionItems.map((action) => {
                      const isSynced = syncedActionIds.has(action.id);

                      return (
                        <div
                          key={action.id}
                          className="bg-white border border-[#E2E8F0] border-l-4 border-l-[#F43F5E] rounded-xl p-3.5 shadow-sm"
                        >
                          <div className="flex items-start justify-between mb-1.5">
                            <span className="bg-[#F43F5E]/10 text-[#F43F5E] text-[10px] font-mono font-bold px-2 py-0.5 rounded">
                              Action Item
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">{action.timeframe}</span>
                          </div>

                          <p className="text-xs font-semibold text-[#191C1E] mb-2 leading-snug">
                            {action.text}
                          </p>

                          <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                            <span className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                              <User className="w-3 h-3 text-slate-400" /> {action.assignee}
                            </span>

                            <button
                              onClick={() => handleSyncAction(action)}
                              className="bg-[#4F46E5]/10 hover:bg-[#4F46E5]/20 text-[#4F46E5] transition-colors px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1"
                            >
                              {isSynced ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-[#10B981]" />
                                  <span>Synced</span>
                                </>
                              ) : (
                                <>
                                  <CalendarPlus className="w-3.5 h-3.5" />
                                  <span>Sync to Cal</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Generate Minutes Button */}
            <div className="p-4 border-t border-[#E2E8F0] bg-white">
              <button
                onClick={handleGenerateMinutes}
                className="w-full flex items-center justify-center gap-2 border border-[#E2E8F0] bg-white hover:bg-[#F2F4F6] transition-colors py-2.5 rounded-xl text-xs font-bold text-[#191C1E] shadow-sm active:scale-95"
              >
                <FileText className="w-4 h-4 text-[#4F46E5]" />
                <span>Generate & Save Minutes (MoM)</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
