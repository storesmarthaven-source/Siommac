/**
 * ComplianceState.tsx
 *
 * Lightweight workspace state for the compliance UI: which subview is active and
 * which case / conversation is selected. Kept in context (not server data) so
 * cross-view commands — e.g. a case's "Open Conversations" — can navigate the
 * workspace without prop-drilling. Server data lives in TanStack Query.
 */

import { createContext, type ComponentChildren } from 'preact';
import { useContext, useMemo, useState } from 'preact/hooks';

export type ComplianceSubview = 'cases' | 'conversations' | 'access-log';

interface ComplianceStateValue {
  subview:          ComplianceSubview;
  setSubview:       (v: ComplianceSubview) => void;
  selectedCaseId:   string | null;
  setSelectedCaseId: (id: string | null) => void;
  selectedThreadId: string | null;
  setSelectedThreadId: (id: string | null) => void;
  /** Jump to the Conversations subview scoped to a case. */
  openConversations: (caseId: string, threadId?: string | null) => void;
}

const ComplianceStateContext = createContext<ComplianceStateValue | null>(null);

export function ComplianceStateProvider({ children }: { children: ComponentChildren }) {
  const [subview, setSubview] = useState<ComplianceSubview>('cases');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const value = useMemo<ComplianceStateValue>(() => ({
    subview, setSubview,
    selectedCaseId, setSelectedCaseId,
    selectedThreadId, setSelectedThreadId,
    openConversations: (caseId, threadId = null) => {
      setSelectedCaseId(caseId);
      setSelectedThreadId(threadId);
      setSubview('conversations');
    },
  }), [subview, selectedCaseId, selectedThreadId]);

  return <ComplianceStateContext.Provider value={value}>{children}</ComplianceStateContext.Provider>;
}

export function useComplianceState(): ComplianceStateValue {
  const ctx = useContext(ComplianceStateContext);
  if (!ctx) throw new Error('useComplianceState must be used within ComplianceStateProvider');
  return ctx;
}
