/**
 * src/components/workflow/index.ts
 *
 * Public barrel for the reusable workflow UI components. Import from
 * '@components/workflow'. Styling lives in workflow.css (import once where the
 * components are mounted).
 */

export { ApprovalInbox } from './ApprovalInbox';
export { AuditFeed } from './AuditFeed';
export { HandoffList } from './HandoffList';
export { WorkflowDrawer } from './WorkflowDrawer';
import './workflow.css';
