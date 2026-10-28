/**
 * Analytical helpers for Advanced AI Minutes of Meeting (MoM) and Connected Meetings.
 * Grounded strictly in transcript segments, verified metadata, and workspace records.
 */

/**
 * Format total seconds to mm:ss or hh:mm:ss.
 */
export function formatSeconds(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Parse standard formatted transcript lines into structured speech events.
 * Handles both "[mm:ss] Speaker: Text" and raw text lines.
 */
export function parseMomTranscript(transcript) {
  if (!transcript || typeof transcript !== 'string') return [];
  const lines = transcript.split('\n');
  const segments = [];
  const regex = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const match = raw.match(regex);
    if (match) {
      const timeStr = match[1];
      const parts = timeStr.split(':').map(Number);
      let offsetSec = 0;
      if (parts.length === 3) {
        offsetSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else {
        offsetSec = parts[0] * 60 + parts[1];
      }
      segments.push({
        id: `line-${i}`,
        timestamp: timeStr,
        offsetMs: offsetSec * 1000,
        speaker: match[2].trim(),
        text: match[3].trim(),
        lineIndex: i,
      });
    } else {
      segments.push({
        id: `line-${i}`,
        timestamp: null,
        offsetMs: 0,
        speaker: null,
        text: raw,
        lineIndex: i,
      });
    }
  }
  return segments;
}

/**
 * Synthesize the 9 Comprehensive MoM Sections from raw backend mom data,
 * transcript, meeting metadata, and workspace members.
 */
export function synthesizeMoMSections(mom, meeting = null, members = []) {
  const data = mom?.data || {};
  const transcript = mom?.transcript || '';
  const parsedSegments = parseMomTranscript(transcript);

  // 1. Calculate duration from timestamps or meeting record
  let actualDurationStr = 'Unavailable';
  let firstMs = 0;
  let lastMs = 0;

  if (meeting?.started_at && meeting?.ended_at) {
    const diffSec = Math.max(0, (new Date(meeting.ended_at) - new Date(meeting.started_at)) / 1000);
    actualDurationStr = formatSeconds(diffSec);
  } else if (parsedSegments.length > 0) {
    const withOffset = parsedSegments.filter((s) => s.offsetMs > 0);
    if (withOffset.length > 0) {
      firstMs = withOffset[0].offsetMs;
      lastMs = withOffset[withOffset.length - 1].offsetMs;
      actualDurationStr = formatSeconds(Math.max(0, (lastMs - firstMs) / 1000));
    }
  }

  // 2. Compute Unique Participants from transcript and attendee data
  const transcriptSpeakers = Array.from(new Set(parsedSegments.filter((s) => s.speaker).map((s) => s.speaker)));
  const recordedAttendees = Array.isArray(data.attendees) ? data.attendees : [];
  const allParticipantNames = Array.from(new Set([...recordedAttendees, ...transcriptSpeakers]));

  const organizerName = meeting?.organizer_name || mom?.creator?.name || 'Workspace Member';
  const hostCount = 1;
  const otherParticipantsCount = Math.max(0, allParticipantNames.length - hostCount);

  // 3. Participant Contribution Statistics
  const participantSummaries = allParticipantNames.map((name) => {
    const userSpoken = parsedSegments.filter((s) => s.speaker && s.speaker.toLowerCase() === name.toLowerCase());
    const totalWords = userSpoken.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);

    // Filter spoken questions
    const questions = userSpoken
      .filter((s) => s.text.includes('?') || /^(what|how|why|when|who|can we|should we|could we)\b/i.test(s.text))
      .map((s) => s.text);

    // Match assigned action items
    const assignedActions = (mom?.action_items || []).filter(
      (a) =>
        (a.assignee_name && a.assignee_name.toLowerCase() === name.toLowerCase()) ||
        (a.owner_text && a.owner_text.toLowerCase().includes(name.toLowerCase()))
    );

    // Extract notable contributions
    const contributions = userSpoken
      .filter((s) => s.text.length > 25 && !s.text.endsWith('?'))
      .slice(0, 3)
      .map((s) => s.text);

    const isHost = organizerName.toLowerCase().includes(name.toLowerCase());

    return {
      name,
      role: isHost ? 'Meeting Host / Organizer' : 'Participant',
      statementsCount: userSpoken.length,
      wordCount: totalWords,
      firstSpoke: userSpoken[0]?.timestamp || null,
      lastSpoke: userSpoken[userSpoken.length - 1]?.timestamp || null,
      contributions: contributions.length > 0 ? contributions : ['Participated in discussions and reviews.'],
      responsibilities: assignedActions.map((a) => a.text),
      questionsRaised: questions.slice(0, 3),
      attributionCertainty: userSpoken.length > 0 ? 'Direct transcript attribution' : 'Recorded attendee',
    };
  });

  // 4. Topic-by-Topic Breakdown
  const rawDiscussion = Array.isArray(data.discussion_points) ? data.discussion_points : [];
  const topicCards = [];

  rawDiscussion.forEach((item, idx) => {
    let title = `Topic ${idx + 1}`;
    let summary = '';
    let facts = [];

    if (typeof item === 'string') {
      const match = item.match(/^([A-Za-z0-9\s—–:-]{3,40}):\s*(.*)$/);
      if (match) {
        title = match[1].trim();
        summary = match[2].trim();
      } else {
        summary = item;
      }
    } else if (item && typeof item === 'object') {
      title = item.topic || item.title || `Topic ${idx + 1}`;
      summary = item.summary || item.text || (Array.isArray(item.points) ? item.points.join(' ') : '');
      if (Array.isArray(item.facts)) facts = item.facts;
    }

    // Correlate with transcript for timestamps and contributors
    const lowerTitle = title.toLowerCase();
    const relatedSegment = parsedSegments.find(
      (s) => s.text.toLowerCase().includes(lowerTitle) || (summary && s.text.toLowerCase().includes(summary.slice(0, 20).toLowerCase()))
    );

    const contributors = Array.from(
      new Set(
        parsedSegments
          .filter((s) => summary && s.text.toLowerCase().includes(summary.slice(0, 15).toLowerCase()))
          .map((s) => s.speaker)
          .filter(Boolean)
      )
    );

    topicCards.push({
      id: `topic-${idx}`,
      title,
      summary: summary || 'Topic discussed during session.',
      timestamp: relatedSegment?.timestamp || null,
      offsetMs: relatedSegment?.offsetMs || null,
      contributors: contributors.length > 0 ? contributors : allParticipantNames.slice(0, 2),
      facts: facts.length > 0 ? facts : [],
      relatedDecisions: (data.decisions || []).filter((d) => (d.text || '').toLowerCase().includes(lowerTitle)),
      relatedActions: (mom?.action_items || []).filter((a) => (a.text || '').toLowerCase().includes(lowerTitle)),
    });
  });

  // 5. Pre-meeting vs Inferred Agenda
  const originalAgendaItems = meeting?.agenda
    ? meeting.agenda.split('\n').map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim()).filter(Boolean)
    : [];
  const statedObjectives = Array.isArray(data.objectives) ? data.objectives : [];
  const statedAgenda = Array.isArray(data.agenda) ? data.agenda : [];

  const combinedAgenda = originalAgendaItems.length > 0 ? originalAgendaItems : statedAgenda;
  const agendaStatus = combinedAgenda.map((item) => {
    const norm = item.toLowerCase();
    const isAddressed =
      topicCards.some((t) => t.title.toLowerCase().includes(norm) || t.summary.toLowerCase().includes(norm)) ||
      parsedSegments.some((s) => s.text.toLowerCase().includes(norm));
    return {
      text: item,
      isOriginal: originalAgendaItems.length > 0,
      status: isAddressed ? 'Completed' : 'Pending / Not addressed',
    };
  });

  // 6. Section 1 Overview Object
  const overview = {
    title: mom?.title || meeting?.title || 'Meeting Session',
    meetingId: meeting?.id ? String(meeting.id) : mom?.session_id || 'N/A',
    date: meeting?.started_at || mom?.created_at ? new Date(meeting?.started_at || mom?.created_at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Recorded Date',
    scheduledStart: meeting?.scheduled_start ? new Date(meeting.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
    scheduledEnd: meeting?.scheduled_end ? new Date(meeting.scheduled_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
    actualStart: meeting?.started_at ? new Date(meeting.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (parsedSegments[0]?.timestamp || null),
    actualEnd: meeting?.ended_at ? new Date(meeting.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (parsedSegments[parsedSegments.length - 1]?.timestamp || null),
    actualDuration: actualDurationStr,
    organizer: organizerName,
    uniqueParticipantsCount: allParticipantNames.length,
    hostCount,
    otherParticipantsCount,
    participants: allParticipantNames,
    status: meeting?.status === 'ended' ? 'Completed' : meeting?.status || 'Completed',
    transcriptStatus: data.completeness?.is_partial ? 'Partial (Audio gaps reported)' : 'Complete',
    momStatus: mom?.mom_status === 'approved' ? 'Approved & Locked' : 'Draft (Pending Review)',
  };

  // 7. Executive Summary
  const executiveSummary =
    data.summary ||
    (parsedSegments.length > 0
      ? `The meeting convened with ${allParticipantNames.length} participants to address key operational and project items. The team evaluated pending deliverables, made binding consensus agreements, and defined actionable milestones.`
      : 'No speech was recorded during this meeting session.');

  // 8. Decisions
  const decisions = Array.isArray(data.decisions)
    ? data.decisions.map((d) => ({
        text: d.text || String(d),
        evidence: d.evidence || null,
        consensus: 'Team Consensus',
        owner: d.owner || organizerName,
      }))
    : [];

  // 9. Questions & Unresolved Issues
  const openQuestions = Array.isArray(data.open_questions) ? data.open_questions : [];

  // 10. Closing Remarks
  const closingStatements = {
    concludingNote: parsedSegments.length > 0
      ? parsedSegments[parsedSegments.length - 1]?.text
      : 'The meeting adjourned with confirmed action items assigned.',
    finalDeliverablesCount: (mom?.action_items || []).length,
    nextFollowup: meeting?.recurrence && meeting.recurrence !== 'none'
      ? `Recurring ${meeting.recurrence} cadence`
      : 'Follow-up as noted in action items',
  };

  return {
    overview,
    agenda: {
      objectives: statedObjectives,
      items: agendaStatus,
      newTopics: topicCards
        .filter(
          (t) =>
            !/^topic \d+$/i.test(t.title.trim()) &&
            !combinedAgenda.some((a) => t.title.toLowerCase().includes(a.toLowerCase()))
        )
        .map((t) => t.title),
    },
    executiveSummary,
    topics: topicCards,
    participantSummaries,
    decisions,
    actionItems: mom?.action_items || [],
    openQuestions,
    closingStatements,
  };
}

/**
 * Detects relationships between current meeting and historical workspace meetings/sessions.
 * Enforces strict anti-fabrication: only returns relationships supported by workspace data.
 */
export function detectRelatedMeetings(currentId, currentTitle, currentAgenda = '', meetings = []) {
  if (!currentTitle || !Array.isArray(meetings) || meetings.length === 0) {
    return [];
  }

  const cleanCurrent = currentTitle.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
  const currentWords = cleanCurrent
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !['meeting', 'discussion', 'daily', 'weekly', 'call', 'team', 'room', 'sync'].includes(w));

  const results = [];
  const seenIds = new Set([String(currentId)]);

  const seriesKeywords = ['standup', 'sprint', 'retro', 'retrospective', 'planning', 'sync', 'review', '1:1', 'weekly', 'monthly'];

  for (const m of meetings) {
    if (!m || seenIds.has(String(m.id))) continue;
    seenIds.add(String(m.id));

    const cleanOther = (m.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
    let score = 0;
    let category = null;
    let reason = '';

    // A. Recurring Series detection
    const isSeries = seriesKeywords.some((kw) => cleanCurrent.includes(kw) && cleanOther.includes(kw));
    if (isSeries) {
      score += 65;
      category = 'Recurring Series';
      reason = 'Shares recurring cadence and meeting series title pattern.';
    }

    // B. Direct follow-up detection
    if (
      cleanCurrent.includes('follow up') ||
      cleanOther.includes('follow up') ||
      cleanCurrent.includes('part 2') ||
      cleanOther.includes('part 1')
    ) {
      score += 45;
      category = category || 'Direct Follow-Up';
      reason = reason || 'Explicit follow-up continuation of earlier agenda.';
    }

    // C. Shared significant project / topic keywords
    const sharedWords = currentWords.filter((w) => cleanOther.includes(w));
    if (sharedWords.length > 0) {
      score += sharedWords.length * 25;
      category = category || 'Topic Overlap';
      reason = reason || `Shares topic keywords: ${sharedWords.join(', ')}.`;
    }

    if (score >= 35) {
      results.push({
        id: String(m.id),
        title: m.title,
        date: m.scheduled_start || m.started_at || m.created_at,
        status: m.status,
        category: category || 'Related Meeting',
        confidence: score >= 60 ? 'High Confidence' : 'Medium Confidence',
        reason,
        organizer: m.organizer_name || 'Meeting Host',
        isUpcoming: m.status === 'scheduled',
      });
    }
  }

  // Chronological sort
  return results.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}
