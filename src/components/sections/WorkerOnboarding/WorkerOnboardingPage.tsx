import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { WorkerDocumentUpload } from './WorkerDocumentUpload';
import { Avatar } from '@/components/shared/Avatar';
import { Button, LucideIcon } from '@ui';
import { useMyOnboarding, useOnboardingCompleteTask } from '@api/hr/onboarding';
import { dialog } from '@lib/dialog';
import type { OnboardingWorkerTask } from '../../../../types/hrOnboarding';
import './workerOnboarding.css';

const DONE = new Set(['completed', 'skipped']);
const fmtDate = (value: string | null): string => value
  ? new Intl.DateTimeFormat('en-TT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
  : 'To be confirmed';
const titleCase = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

export function WorkerOnboardingPage(): VNode {
  const experienceQ = useMyOnboarding();
  const completeTask = useOnboardingCompleteTask();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const data = experienceQ.data;

  const complete = async (task: OnboardingWorkerTask): Promise<void> => {
    if (busyTaskId || DONE.has(task.status) || task.requiresEvidence) return;
    setBusyTaskId(task.taskId);
    try {
      await completeTask.mutateAsync({ taskId: task.taskId });
      await experienceQ.refetch();
    } catch (error) {
      await dialog.error(error instanceof Error ? error.message : 'The task could not be completed.');
    } finally {
      setBusyTaskId(null);
    }
  };

  if (experienceQ.isLoading) {
    return <main class="wob-root"><div class="wob-skeleton" aria-label="Loading your onboarding" /></main>;
  }
  if (experienceQ.isError) {
    return <main class="wob-root"><section class="wob-empty"><LucideIcon name="TriangleAlert" size={30} /><h1>We couldn’t load your onboarding</h1><p>Please retry. Your information has not been changed.</p><Button variant="outline" onClick={() => void experienceQ.refetch()}>Retry</Button></section></main>;
  }
  if (!data) {
    return <main class="wob-root"><section class="wob-empty"><LucideIcon name="ClipboardCheck" size={32} /><h1>No active onboarding plan</h1><p>When HR starts an onboarding plan for you, your required actions and Day-One information will appear here.</p></section></main>;
  }

  const openTasks = data.tasks.filter(task => !DONE.has(task.status));
  const openDocuments = data.documentRequests.filter(request => !['verified', 'use_existing', 'waived'].includes(request.status));

  return (
    <main class="wob-root">
      <header class="wob-hero">
        <div class="wob-person">
          <Avatar name={data.employeeName} src={data.employeePhotoUrl} size={64} />
          <div><span class="wob-eyebrow">My onboarding</span><h1>Welcome, {data.employeeName.split(' ')[0]}</h1><p>{data.packageLabel} · {data.caseNo}</p></div>
        </div>
        <div class="wob-start"><span>Planned start date</span><strong>{fmtDate(data.targetStartDate)}</strong><em class={data.dayOneReady ? 'ready' : 'progress'}>{data.dayOneReady ? 'Day-One ready' : 'In progress'}</em></div>
      </header>

      <section class="wob-progress" aria-label="Onboarding progress">
        {/* Nothing assigned is NOT "complete" — showing 100% there told workers they were
            finished while HR still had internal work outstanding. */}
        <div><span>Your progress</span><strong>{data.hasWorkerActions ? `${data.progressPercent}%` : 'Nothing to do yet'}</strong></div>
        {data.hasWorkerActions
          ? <div class="wob-track"><i style={{ width: `${data.progressPercent}%` }} /></div>
          : <p class="wob-progress-note">Your team is preparing your onboarding. Anything you need to do will appear here.</p>}
        {/* Three distinct states. "Complete" is only true when there WAS something to
            complete — otherwise this line contradicted the note above it. */}
        <p>{openTasks.length
          ? `${openTasks.length} action${openTasks.length === 1 ? '' : 's'} still need your attention.`
          : data.hasWorkerActions
            ? 'Your assigned actions are complete.'
            : 'You have no assigned actions yet.'}</p>
      </section>

      <div class="wob-layout">
        <div class="wob-main">
          {openTasks.length > 0 && <section class="wob-card">
            <header><span class="wob-icon"><LucideIcon name="ListChecks" size={19} /></span><div><h2>Your next actions</h2><p>Only work assigned directly to you appears here.</p></div></header>
            <div class="wob-list">{openTasks.map(task => <article class="wob-task" key={task.taskId}>
              <span class={`wob-state ${task.isBlocking ? 'blocking' : ''}`} />
              <div><strong>{task.title}</strong><small>{task.moduleLabel ? titleCase(task.moduleLabel) : 'Onboarding'} · Due {fmtDate(task.dueAt)}</small>{task.requiresEvidence && <em>Evidence is required before this can be completed.</em>}</div>
              {!task.requiresEvidence && <Button variant="outline" disabled={busyTaskId === task.taskId} onClick={() => void complete(task)}>{busyTaskId === task.taskId ? 'Saving…' : 'Mark complete'}</Button>}
            </article>)}</div>
          </section>}

          {openDocuments.length > 0 && <section class="wob-card">
            <header><span class="wob-icon"><LucideIcon name="Files" size={19} /></span><div><h2>Documents requested</h2><p>HR will review each submission before it is marked complete.</p></div></header>
            <div class="wob-list">{openDocuments.map(request => <article class="wob-document" key={request.requestId}>
              <span class="wob-file"><LucideIcon name="FileText" size={18} /></span>
              <div><strong>{request.label}</strong><small>{request.isRequired ? 'Required' : 'Optional'} · {titleCase(request.status)}</small>{request.rejectionReason && <em>{request.rejectionReason}</em>}</div>
              <span class={`wob-pill ${request.status}`}>{titleCase(request.status)}</span>
              <WorkerDocumentUpload request={request} onSubmitted={() => void experienceQ.refetch()} />
            </article>)}</div>
          </section>}

          {data.messages.length > 0 && <section class="wob-card">
            <header><span class="wob-icon"><LucideIcon name="Mail" size={19} /></span><div><h2>Messages</h2><p>Information sent directly to you about this onboarding plan.</p></div></header>
            <div class="wob-messages">{data.messages.map(message => <article key={message.messageId}><strong>{message.subject ?? 'Onboarding update'}</strong>{message.body && <p>{message.body}</p>}<small>{fmtDate(message.sentAt)}</small></article>)}</div>
          </section>}
        </div>

        <aside class="wob-aside">
          <section class="wob-card wob-day-one"><header><span class="wob-icon"><LucideIcon name="CalendarCheck" size={19} /></span><div><h2>Day One</h2><p>Your current readiness</p></div></header><strong>{data.dayOneReady ? 'Ready' : 'Preparation underway'}</strong><p>{data.dayOneReady
              ? 'Your required actions and documents are complete and your onboarding is ready.'
              : data.hasWorkerActions
                ? 'Complete the actions shown on this page. Internal HR work is handled separately.'
                : 'Nothing is needed from you right now. Your team will let you know if that changes.'}</p></section>
          {(data.caseOwner || data.supervisor) && <section class="wob-card"><header><span class="wob-icon"><LucideIcon name="Users" size={19} /></span><div><h2>Your key people</h2><p>Who is supporting your start</p></div></header><div class="wob-people">{data.caseOwner && <div><span>Onboarding contact</span><strong>{data.caseOwner.name ?? 'HR Operations'}</strong></div>}{data.supervisor && <div><span>Supervisor</span><strong>{data.supervisor.name ?? 'To be confirmed'}</strong></div>}</div></section>}
        </aside>
      </div>
    </main>
  );
}
