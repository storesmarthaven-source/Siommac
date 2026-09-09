import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Button, EmptyState, LucideIcon, toast } from '@ui';
import {
  useEndMeetingSession,
  useMeeting,
  useMeetingRsvp,
  useMeetingsList,
  useStartMeetingSession,
} from '@api/meetings';
import { useDemoMode } from '@lib/demoMode';
import { DemoLandingPage } from '@/components/demo/DemoLandingPage';
import type { MeetingStagingScenario } from './meetingStaging';
import { meetingStagingScenarios } from './meetingStaging';
import { MeetingsOverview } from './MeetingsOverview';
import { MeetingsStagedWorkspace, type MeetingWorkspaceAction } from './MeetingsStagedWorkspace';
import { CreateMeetingDialog } from './CreateMeetingDialog';
import { ManageMeetingDialog, type MeetingManageAction } from './ManageMeetingDialog';
import { can } from '@lib/permissions';
import { showSection } from '@components/nav/navCore';

export function MeetingsPage(): VNode {
  const demo = useDemoMode();
  const demoPage = demo.pages.meetings;
  const [enteredDemo, setEnteredDemo] = useState(false);
  const [view, setView] = useState<'overview' | 'detail'>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageAction, setManageAction] = useState<MeetingManageAction>(null);
  const [pendingAction, setPendingAction] = useState<MeetingWorkspaceAction | null>(null);
  const list = useMeetingsList({ limit: 50 }, !demo.enabled);
  const rsvp = useMeetingRsvp();
  const startSession = useStartMeetingSession();
  const endSession = useEndMeetingSession();
  const items = useMemo(() => list.data?.items ?? [], [list.data?.items]);
  const stagedScenarios = useMemo(() => meetingStagingScenarios(), []);
  const stagedPreviews = useMemo(() => Object.fromEntries(stagedScenarios.flatMap(scenario => scenario.detail?.description ? [[scenario.listItem.id, scenario.detail.description]] : [])), [stagedScenarios]);
  const stagedTasks = useMemo(() => stagedScenarios.flatMap(scenario => scenario.actionItems), [stagedScenarios]);
  const usingStagedData = demo.enabled || import.meta.env.DEV && !list.isLoading && !list.isError && items.length === 0;
  const overviewItems = usingStagedData ? stagedScenarios.map(scenario => scenario.listItem) : items;
  const detail = useMeeting(usingStagedData ? null : selectedId, undefined);
  const liveScenario = useMemo<MeetingStagingScenario | null>(() => {
    if (!detail.data) return null;
    const selected = items.find(item => item.id === detail.data.id);
    if (!selected) return null;
    return {
      kind: detail.data.status === 'cancelled' ? 'cancelled' : detail.data.status === 'in_progress' ? 'live' : detail.data.currentSession?.recordingStatus === 'processing' ? 'recording_processing' : detail.data.currentSession?.recordingStatus === 'ready' ? 'completed_recording' : 'no_recording',
      description: 'Authorised Meetings record.', listItem: selected, detail: detail.data,
      artifacts: [], attendance: [], transcript: [], chapters: [],
      summaries: detail.data.publishedSummary ? [detail.data.publishedSummary] : [], actionItems: [], metrics: null,
      access: { allowed: true, reason: null },
    };
  }, [detail.data, items]);

  const openMeeting = (meetingId: string): void => {
    setSelectedId(meetingId);
    setView('detail');
  };

  const handleCreated = (meetingId: string): void => {
    setSelectedId(meetingId);
    setView('detail');
  };

  const returnToOverview = (): void => {
    setView('overview');
    setManageAction(null);
    setPendingAction(null);
  };

  const handleAction = async (action: MeetingWorkspaceAction): Promise<void> => {
    const meeting = detail.data;
    if (!meeting || pendingAction) return;
    if (action === 'edit' || action === 'participants' || action === 'agenda' || action === 'cancel' || action === 'archive') {
      setManageAction(action);
      return;
    }
    if (action === 'conversation') {
      showSection('s-messages');
      return;
    }
    if (action === 'join') {
      if (meeting.join?.joinUrl) window.open(meeting.join.joinUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'share') {
      try {
        await navigator.clipboard.writeText(window.location.href);
        toast.success('Meeting link copied.');
      } catch {
        toast.error('The meeting link could not be copied.');
      }
      return;
    }

    setPendingAction(action);
    try {
      if (action.startsWith('rsvp_')) {
        await rsvp.mutateAsync({
          meetingId: meeting.id,
          expectedVersion: meeting.version,
          idempotencyKey: crypto.randomUUID(),
          responseStatus: action === 'rsvp_accept' ? 'accepted' : action === 'rsvp_tentative' ? 'tentative' : 'declined',
        });
      } else if (action === 'start') {
        const occurrenceKey = meeting.currentSession?.occurrenceKey ?? meeting.schedule.startsAt ?? meeting.schedule.startsOn;
        if (!occurrenceKey) throw new Error('This meeting does not have a schedulable occurrence.');
        await startSession.mutateAsync({ meetingId: meeting.id, occurrenceKey, idempotencyKey: crypto.randomUUID() });
      } else if (action === 'end' && meeting.currentSession) {
        await endSession.mutateAsync({
          meetingId: meeting.id,
          sessionId: meeting.currentSession.id,
          expectedStatus: meeting.currentSession.status === 'ready' ? 'ready' : 'live',
          idempotencyKey: crypto.randomUUID(),
        });
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'This meeting does not have a schedulable occurrence.') toast.error(cause.message);
    } finally {
      setPendingAction(null);
    }
  };

  if (demo.enabled) {
    if (demoPage.showLandingPage && !enteredDemo) return <DemoLandingPage page="meetings" stagedEnabled={demoPage.useStagedData} onEnter={() => setEnteredDemo(true)} />;
    if (view === 'overview') return <MeetingsOverview items={overviewItems} staged previews={stagedPreviews} tasks={stagedTasks} onOpen={openMeeting} onOpenCalendar={() => showSection('s-calendar')} />;
    return <MeetingsStagedWorkspace scenarios={stagedScenarios} selectedScenarioId={selectedId ?? undefined} onScenarioChange={setSelectedId} onBack={returnToOverview} />;
  }

  if (list.isLoading) return <main class="mtg-page mtg-page-state"><EmptyState icon={<LucideIcon name="Video" />} title="Loading meetings" text="Preparing your authorised Meetings workspace." /></main>;
  if (list.isError) return <main class="mtg-page mtg-page-state"><EmptyState icon={<LucideIcon name="CloudAlert" />} title="Meetings could not be loaded" text={list.error instanceof Error ? list.error.message : 'The Meetings service is unavailable.'} actions={<Button variant="secondary" onClick={() => void list.refetch()}>Try Again</Button>} /></main>;
  if (!items.length && !import.meta.env.DEV) return <><main class="mtg-page mtg-page-state"><EmptyState icon={<LucideIcon name="CalendarPlus" />} title="No meetings yet" text="Meetings you organise or attend will appear here." actions={can('meetings.create') ? <Button variant="primary" onClick={() => setCreateOpen(true)} iconLeft={<LucideIcon name="CalendarPlus" size={16} />}>Schedule Meeting</Button> : undefined} /></main><CreateMeetingDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} /></>;
  if (view === 'overview') return <><MeetingsOverview
    items={overviewItems}
    staged={usingStagedData}
    previews={usingStagedData ? stagedPreviews : undefined}
    tasks={usingStagedData ? stagedTasks : undefined}
    onOpen={openMeeting}
    onCreate={can('meetings.create') ? () => setCreateOpen(true) : undefined}
    onOpenCalendar={() => showSection('s-calendar')}
  /><CreateMeetingDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} /></>;
  if (usingStagedData) return <><MeetingsStagedWorkspace
    scenarios={stagedScenarios}
    selectedScenarioId={selectedId ?? undefined}
    onScenarioChange={setSelectedId}
    onBack={returnToOverview}
    onCreate={can('meetings.create') ? () => setCreateOpen(true) : undefined}
  /><CreateMeetingDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} /></>;
  if (detail.isError) return <main class="mtg-page mtg-page-state"><EmptyState icon={<LucideIcon name="ShieldAlert" />} title="Meeting unavailable" text={detail.error instanceof Error ? detail.error.message : 'This meeting could not be loaded.'} /></main>;
  if (detail.isLoading || !liveScenario) return <main class="mtg-page mtg-page-state"><EmptyState icon={<LucideIcon name="FileSearch" />} title="Loading meeting" text="Preparing the selected meeting record." /></main>;

  return <><MeetingsStagedWorkspace
    staged={false}
    scenarios={[liveScenario]}
    scenarioOptions={items.map(item => ({ value: item.id, label: item.title }))}
    selectedScenarioId={selectedId ?? liveScenario.listItem.id}
    onScenarioChange={setSelectedId}
    onBack={returnToOverview}
    onCreate={can('meetings.create') ? () => setCreateOpen(true) : undefined}
    onAction={action => void handleAction(action)}
    pendingAction={pendingAction}
  /><CreateMeetingDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />{detail.data ? <ManageMeetingDialog action={manageAction} meeting={detail.data} onClose={() => setManageAction(null)} /> : null}</>;
}
