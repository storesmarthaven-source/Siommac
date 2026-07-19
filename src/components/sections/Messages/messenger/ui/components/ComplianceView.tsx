// ComplianceView — the compliance workspace entry inside the Messenger shell.
//
// V1 (approved compliance frontend handoff): renders the ComplianceWorkspace
// (Cases · Conversations · Access Log · case-scoped export) below the Messenger
// QueueHeader. This REPLACES the legacy ComplianceBrowser + AccessThreadDialog
// self-request/self-grant flow, which is superseded and removed at cutover
// (handoff §14.7) once the live routes land and grep proves no callers.
import '../compliance/compliance.css';
import { ComplianceWorkspace } from '../compliance/ComplianceWorkspace';

export function ComplianceView() {
  return <ComplianceWorkspace />;
}
