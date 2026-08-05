/**
 * HR > Onboarding surface coordinator.
 *
 * The Command Centre is the operational landing page. It deliberately does not mount a
 * second case register underneath the board: cross-case work belongs in Work Queue and
 * a single case opens from the Command Centre widgets or queue into Case Detail.
 */
import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { showSection } from '@components/nav/navCore';
import { useOnboardingCases } from '@api/hr/onboarding';
import type { OnboardingCaseRow } from '../../../../types/hrOnboarding';
import { OnboardingCommandCenter } from './OnboardingCommandCenter';
import type { OnboardingSurface as CommandCenterSurface } from './OnboardingCommandCenter.helpers';
import { StartOnboardingWizard } from './StartOnboardingWizard';
import { OnboardingCaseDetail } from './OnboardingCaseDetail';
import { OnboardingPackageManager } from './OnboardingPackageManager';
import { OnboardingPackageDetail } from './OnboardingPackageDetail';
import { OnboardingWorkQueue } from './OnboardingWorkQueue';
import { OnboardingReportsWorkspace } from './OnboardingReportsWorkspace';
import type { CaseFocusRequest } from './onboardingCaseFocus';
import './HR.css';

type OnboardingSurface = 'overview' | 'packages' | 'work-queue' | 'insights' | 'start';
const EMAIL_STUDIO_ID = 's-hr-email-templates';

export function OnboardingOverview({ initialCaseId = null }: { initialCaseId?: string | null } = {}): VNode {
  const [toast, setToast] = useState('');
  const [surface, setSurface] = useState<OnboardingSurface>('overview');
  const [selectedCase, setSelectedCase] = useState<OnboardingCaseRow | null>(null);
  const [openPackageKey, setOpenPackageKey] = useState<string | null>(null);
  const [jumpCaseId, setJumpCaseId] = useState<string | null>(initialCaseId);
  const [caseFocus, setCaseFocus] = useState<CaseFocusRequest | null>(null);

  useEffect(() => { if (initialCaseId) setJumpCaseId(initialCaseId); }, [initialCaseId]);

  const lookupId = jumpCaseId ?? selectedCase?.caseId ?? null;
  const caseQ = useOnboardingCases(
    { caseIds: lookupId ? [lookupId] : [], page: 1, pageSize: 1 },
    { enabled: !!lookupId },
  );

  useEffect(() => {
    const row = caseQ.data?.rows[0];
    if (!row || !jumpCaseId || row.caseId !== jumpCaseId) return;
    setSelectedCase(row);
    setSurface('overview');
    setJumpCaseId(null);
  }, [caseQ.data, jumpCaseId]);

  useEffect(() => {
    function onOpen(e: Event): void {
      const caseId = (e as CustomEvent<{ caseId?: string }>).detail?.caseId;
      if (!caseId) return;
      setCaseFocus(null);
      setJumpCaseId(caseId);
    }
    window.addEventListener('siomac:hr-onboarding-open-case', onOpen);
    return () => window.removeEventListener('siomac:hr-onboarding-open-case', onOpen);
  }, []);

  function notify(message: string): void {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }

  function openCaseById(caseId: string, focus?: CaseFocusRequest | null): void {
    setCaseFocus(focus ?? null);
    setJumpCaseId(caseId);
  }

  const liveSelected = caseQ.data?.rows[0] ?? selectedCase;
  if (liveSelected) {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingCaseDetail
          caseRow={liveSelected}
          focus={caseFocus}
          onBack={() => { setSelectedCase(null); setCaseFocus(null); }}
          onToast={notify}
        />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }

  if (openPackageKey) {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingPackageDetail
          packageKey={openPackageKey}
          onBack={() => setOpenPackageKey(null)}
          onOpenEmailTemplates={() => showSection(EMAIL_STUDIO_ID)}
          onToast={notify}
        />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }

  if (surface === 'packages') {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingPackageManager
          onBack={() => setSurface('overview')}
          onOpenPackage={setOpenPackageKey}
          onOpenEmailTemplates={() => showSection(EMAIL_STUDIO_ID)}
          onToast={notify}
        />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }

  if (surface === 'work-queue') {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingWorkQueue
          onBack={() => setSurface('overview')}
          onOpenCase={(id, focus) => openCaseById(id, focus as CaseFocusRequest | undefined)}
          onToast={notify}
        />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }

  if (surface === 'insights') {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingReportsWorkspace onBack={() => setSurface('overview')} onToast={notify} />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }

  if (surface === 'start') return <StartOnboardingWizard onBack={() => setSurface('overview')} />;

  function handleOpenSurface(commandSurface: CommandCenterSurface): void {
    switch (commandSurface) {
      case 'tasks':
      case 'handoffs':
      case 'blocked':
        setSurface('work-queue');
        break;
      case 'packages':
        setSurface('packages');
        break;
      case 'reports':
        setSurface('insights');
        break;
      case 'cases':
      case 'activity':
      default:
        break;
    }
  }

  return (
    <div class="hr-onboarding-overview">
      <OnboardingCommandCenter
        onOpenSurface={handleOpenSurface}
        onOpenCase={openCaseById}
        onNewCase={() => setSurface('start')}
        onToast={notify}
      />
      <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
