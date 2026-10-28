import { describe, expect, it } from 'vitest';
import {
  formatSeconds,
  parseMomTranscript,
  synthesizeMoMSections,
  detectRelatedMeetings,
} from './momAnalysis';

describe('momAnalysis helper functions', () => {
  describe('formatSeconds', () => {
    it('formats seconds into mm:ss and hh:mm:ss', () => {
      expect(formatSeconds(0)).toBe('0:00');
      expect(formatSeconds(65)).toBe('1:05');
      expect(formatSeconds(3600)).toBe('1:00:00');
      expect(formatSeconds(3665)).toBe('1:01:05');
      expect(formatSeconds(-10)).toBe('0:00');
    });
  });

  describe('parseMomTranscript', () => {
    it('correctly parses timestamped lines with speakers', () => {
      const raw = `[01:15] Alice: Hello team\n[02:30] Bob: Let us discuss the sprint`;
      const segments = parseMomTranscript(raw);
      expect(segments).toHaveLength(2);
      expect(segments[0].timestamp).toBe('01:15');
      expect(segments[0].offsetMs).toBe(75000);
      expect(segments[0].speaker).toBe('Alice');
      expect(segments[0].text).toBe('Hello team');

      expect(segments[1].timestamp).toBe('02:30');
      expect(segments[1].offsetMs).toBe(150000);
      expect(segments[1].speaker).toBe('Bob');
    });

    it('handles lines without timestamps gracefully', () => {
      const raw = `Hello team without timestamp`;
      const segments = parseMomTranscript(raw);
      expect(segments).toHaveLength(1);
      expect(segments[0].timestamp).toBeNull();
      expect(segments[0].speaker).toBeNull();
      expect(segments[0].text).toBe('Hello team without timestamp');
    });
  });

  describe('synthesizeMoMSections', () => {
    it('produces the complete 9 sections with calculated duration and attribution', () => {
      const rawMom = {
        title: 'Weekly Standup #4',
        session_id: 's-123',
        status: 'done',
        mom_status: 'draft',
        transcript: `[00:00] Alice: Welcome everyone to Standup 4.\n[02:15] Bob: I completed the auth migration.\n[05:30] Alice: Great, Bob take the frontend task.`,
        action_items: [
          {
            id: 'a1',
            text: 'Finish frontend task',
            owner_text: 'Bob',
            assignee_id: 'u-bob',
            assignee_name: 'Bob',
            due_date: '2026-11-01',
            status: 'proposed',
            evidence: 'Bob take the frontend task',
          },
        ],
        data: {
          objectives: ['Review sprint progress'],
          agenda: ['Sprint updates', 'Blockers'],
          summary: 'The team completed auth migration and planned frontend work.',
          discussion_points: [
            {
              topic: 'Auth Migration',
              summary: 'Bob completed the auth migration successfully.',
            },
          ],
          decisions: [
            {
              text: 'Deploy auth service this evening',
              evidence: 'completed the auth migration',
              consensus: 'Team Consensus',
            },
          ],
          open_questions: ['Will CI pass without flakiness?'],
          attendees: ['Alice', 'Bob'],
        },
      };

      const meeting = {
        id: 'm-123',
        title: 'Weekly Standup #4',
        organizer_name: 'Alice',
        started_at: '2026-10-28T10:00:00Z',
        ended_at: '2026-10-28T10:06:00Z',
        agenda: 'Sprint updates\nBlockers',
      };

      const report = synthesizeMoMSections(rawMom, meeting, []);

      // Section 1
      expect(report.overview.title).toBe('Weekly Standup #4');
      expect(report.overview.actualDuration).toBe('6:00');
      expect(report.overview.uniqueParticipantsCount).toBe(2);

      // Section 2
      expect(report.agenda.objectives).toContain('Review sprint progress');
      expect(report.agenda.items).toHaveLength(2);

      // Section 3
      expect(report.executiveSummary).toContain('completed auth migration');

      // Section 4
      expect(report.topics).toHaveLength(1);
      expect(report.topics[0].title).toBe('Auth Migration');

      // Section 5
      expect(report.participantSummaries).toHaveLength(2);
      const bobSummary = report.participantSummaries.find((p) => p.name === 'Bob');
      expect(bobSummary).toBeDefined();
      expect(bobSummary.attributionCertainty).toBe('Direct transcript attribution');
      expect(bobSummary.responsibilities).toContain('Finish frontend task');

      // Section 6
      expect(report.decisions).toHaveLength(1);
      expect(report.decisions[0].text).toBe('Deploy auth service this evening');

      // Section 7
      expect(report.actionItems).toHaveLength(1);

      // Section 8
      expect(report.openQuestions).toContain('Will CI pass without flakiness?');

      // Section 9
      expect(report.closingStatements.finalDeliverablesCount).toBe(1);
    });
  });

  describe('detectRelatedMeetings (Part B)', () => {
    it('detects recurring series and shared workstreams', () => {
      const meetings = [
        {
          id: 'm-past-1',
          title: 'Weekly Standup #3',
          started_at: '2026-10-21T10:00:00Z',
          status: 'ended',
        },
        {
          id: 'm-unrelated',
          title: 'Finance Budget Review Q4',
          started_at: '2026-10-22T14:00:00Z',
          status: 'ended',
        },
        {
          id: 'm-next',
          title: 'Weekly Standup #5',
          scheduled_start: '2026-11-04T10:00:00Z',
          status: 'scheduled',
        },
      ];

      const related = detectRelatedMeetings('m-current', 'Weekly Standup #4', '', meetings);
      expect(related).toHaveLength(2);
      expect(related.map((r) => r.id)).toEqual(['m-past-1', 'm-next']);
      expect(related[0].category).toBe('Recurring Series');
      expect(related[0].confidence).toBe('High Confidence');
    });

    it('returns empty array when no historical meetings match (anti-fabrication)', () => {
      const meetings = [
        { id: 'm-x', title: 'Unrelated Design Critique', started_at: '2026-10-20T10:00:00Z', status: 'ended' },
      ];
      const related = detectRelatedMeetings('m-curr', 'Database Performance Tuning', '', meetings);
      expect(related).toHaveLength(0);
    });
  });
});
