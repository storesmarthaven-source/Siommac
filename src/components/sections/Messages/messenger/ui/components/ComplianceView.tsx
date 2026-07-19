// ComplianceView — the compliance workspace entry inside the Messenger shell.
//
// V1: renders the ComplianceWorkspace (Cases · Conversations · Access Log ·
// case-scoped export) below the Messenger QueueHeader. The legacy
// ComplianceBrowser + AccessThreadDialog self-request/self-grant flow has been
// removed (frontend cutover, §14.7); compliance access is now case-scoped,
// approved, and time-limited through this workspace only.
import '../compliance/compliance.css';
import { ComplianceWorkspace } from '../compliance/ComplianceWorkspace';

export function ComplianceView() {
  return <ComplianceWorkspace />;
}
