import { MEETING_STAGING_IDS, meetingStagingScenarios } from './meetingStaging';

const ANCHOR = new Date('2026-09-06T12:00:00.000Z');

describe('meetingStagingScenarios', () => {
  it('provides the eight documented read-only scenarios with stable shared IDs', () => {
    const first = meetingStagingScenarios(ANCHOR);
    const second = meetingStagingScenarios(new Date(ANCHOR));

    expect(first.map(value => value.kind)).toEqual([
      'awaiting_rsvp',
      'live',
      'completed_recording',
      'recording_processing',
      'no_recording',
      'cancelled',
      'restricted',
      'hse_follow_up',
    ]);
    expect(first.map(value => value.listItem.id)).toEqual(second.map(value => value.listItem.id));
    expect(first[0]?.listItem.id).toBe(MEETING_STAGING_IDS.meetings.awaiting);
    expect(first[0]?.listItem.schedule.calendarEntryId).toBe(MEETING_STAGING_IDS.calendarEntries.awaiting);

    for (const value of first) {
      expect(Object.values(value.listItem.capabilities).every(capability => capability === false)).toBe(true);
      if (value.detail) {
        expect(Object.values(value.detail.capabilities).every(capability => capability === false)).toBe(true);
        expect(value.detail.discussionThreadId).toMatch(/^83000000-/);
      }
    }
  });

  it('builds a complete governed meeting record for the detailed staging view', () => {
    const completed = meetingStagingScenarios(ANCHOR).find(value => value.kind === 'completed_recording');

    expect(completed?.detail?.status).toBe('completed');
    expect(completed?.detail?.recordLinks[0]).toMatchObject({
      module: 'hse',
      recordType: 'hse_incident',
      recordId: 'INC-2026-0184',
    });
    expect(completed?.artifacts[0]).toMatchObject({ kind: 'recording', status: 'ready', scanStatus: 'clean', playable: true });
    expect(completed?.transcript).toHaveLength(10);
    expect(completed?.chapters).toHaveLength(4);
    expect(completed?.summaries[0]).toMatchObject({ status: 'reviewed', source: 'hybrid' });
    expect(completed?.summaries[0]?.provenance?.inputArtifactIds).toEqual([completed?.artifacts[0]?.id]);
    expect(completed?.detail?.agendaItems).toHaveLength(4);
    expect(completed?.actionItems).toHaveLength(3);
    expect(completed?.detail?.labels.map(label => label.name)).toEqual(['Safety Review', 'Follow-up']);
    expect(completed?.metrics).toMatchObject({ invitedCount: 4, attendedCount: 4, attendanceRate: 1 });
  });

  it('keeps protected content absent and models HSE follow-up promotion explicitly', () => {
    const scenarios = meetingStagingScenarios(ANCHOR);
    const restricted = scenarios.find(value => value.kind === 'restricted');
    const hse = scenarios.find(value => value.kind === 'hse_follow_up');

    expect(restricted).toMatchObject({ detail: null, access: { allowed: false } });
    expect(restricted?.artifacts).toEqual([]);
    expect(restricted?.transcript).toEqual([]);

    expect(hse?.detail?.recordLinks[0]).toMatchObject({ module: 'hse', recordType: 'hse_capa_action' });
    const accepted = hse?.actionItems.find(item => item.status === 'accepted');
    const proposed = hse?.actionItems.find(item => item.status === 'proposed');
    expect(accepted).toMatchObject({ destination: 'calendar_task' });
    expect(typeof accepted?.calendarTaskId).toBe('string');
    expect(proposed).toMatchObject({ destination: 'module_handoff', handoffId: null });
  });

  it('keeps recording-processing and no-recording states distinct', () => {
    const scenarios = meetingStagingScenarios(ANCHOR);
    const processing = scenarios.find(value => value.kind === 'recording_processing');
    const noRecording = scenarios.find(value => value.kind === 'no_recording');

    expect(processing?.detail?.currentSession).toMatchObject({
      status: 'processing',
      recordingStatus: 'processing',
      transcriptStatus: 'queued',
    });
    expect(processing?.artifacts).toHaveLength(1);
    expect(noRecording?.detail).toMatchObject({ recordingPolicy: 'off', transcriptPolicy: 'off' });
    expect(noRecording?.artifacts).toEqual([]);
  });
});
