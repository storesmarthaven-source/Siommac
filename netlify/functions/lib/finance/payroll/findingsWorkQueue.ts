/**
 * lib/finance/payroll/findingsWorkQueue.ts — Exceptions & Approvals read model
 * (spec §15.3). The combined findings + approval-task stream is produced by the
 * DB function finance_payroll_findings_work_queue (strict keyset union); this module
 * is a thin typed wrapper. Detail + activity + the comment command live here too.
 */
import { sb } from '../../db';
import { notify } from '../../notify';
import { payrollRpcHttpError } from './rpcError';
import { getPayrollFinding, type PayrollControlFinding } from './findings';
import type {
  PayrollWorkQueueRequest,
  PayrollWorkQueueResult,
  PayrollFindingActivity,
  PayrollFindingActivityType,
  PayrollFindingDetail,
  PayrollFindingKind,
  PayrollFindingQueueSeverity,
  PayrollFindingAllowedAction,
  PayrollPageResult,
} from '../../../../../types/payrollFindings';

// ── work-queue (combined findings + approval tasks) ──────────────────────────
export async function getPayrollWorkQueue(
  req: PayrollWorkQueueRequest,
): Promise<PayrollWorkQueueResult> {
  const { data, error } = await sb.rpc('finance_payroll_findings_work_queue', {
    p_limit:      req.limit,
    p_cursor:     req.cursor ?? null,
    p_tab:        req.tab ?? 'all',
    p_kinds:      req.kinds ?? null,
    p_severities: req.severities ?? null,
    p_states:     req.states ?? null,
    p_run_ids:    req.runIds ?? null,
    p_owner_id:   req.ownerId ?? null,
    p_search:     req.search ?? null,
    p_sort:       req.sort ?? 'priority',
  });
  if (error) throw payrollRpcHttpError(error);
  // The function returns the exact PayrollWorkQueueResult shape (minus `selected`,
  // which the route hydrates separately).
  const result = data as Omit<PayrollWorkQueueResult, 'selected'>;
  return { ...result, selected: null };
}

// ── activity feed (append-only) ──────────────────────────────────────────────
interface DbActivityRow {
  id: string;
  finding_id: string;
  actor_id: string | null;
  activity_type: PayrollFindingActivityType;
  body: string | null;
  from_state: string | null;
  to_state: string | null;
  finding_version: number | null;
  created_at: string;
  actor?: { first_name: string | null; last_name: string | null; username: string | null } | null;
}

function toActivity(row: DbActivityRow): PayrollFindingActivity {
  const name = row.actor
    ? `${row.actor.first_name ?? ''} ${row.actor.last_name ?? ''}`.trim() || row.actor.username
    : null;
  return {
    id: row.id,
    findingId: row.finding_id,
    actorId: row.actor_id,
    actorName: name && name.length ? name : null,
    activityType: row.activity_type,
    body: row.body,
    fromState: row.from_state,
    toState: row.to_state,
    findingVersion: row.finding_version,
    createdAt: row.created_at,
  };
}

const ACTIVITY_SELECT =
  '*, actor:app_users!finance_payroll_finding_activity_actor_id_fkey(first_name,last_name,username)';

/** Keyset over created_at DESC, id DESC. Cursor = "<created_at>|<id>". */
export async function listFindingActivity(
  findingId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<PayrollPageResult<PayrollFindingActivity>> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  let q = sb
    .from('finance_payroll_finding_activity')
    .select(ACTIVITY_SELECT)
    .eq('finding_id', findingId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (opts.cursor) {
    const [cAt, cId] = opts.cursor.split('|');
    // rows strictly "after" the cursor in (created_at DESC, id DESC)
    q = q.or(`created_at.lt.${cAt},and(created_at.eq.${cAt},id.lt.${cId})`);
  }
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(`listFindingActivity: ${error.message}`), { status: 500 });
  const rows = (data ?? []) as DbActivityRow[];
  const page = rows.slice(0, limit);
  const next = rows.length > limit ? `${page[page.length - 1]!.created_at}|${page[page.length - 1]!.id}` : null;
  const { count } = await sb
    .from('finance_payroll_finding_activity')
    .select('id', { count: 'exact', head: true })
    .eq('finding_id', findingId);
  return { items: page.map(toActivity), nextCursor: next, total: count ?? page.length, asOf: new Date().toISOString() };
}

// ── DEC-EXC-008 mapping (finding severity → queue kind/severity) ──────────────
function kindOf(sev: PayrollControlFinding['severity']): PayrollFindingKind {
  return sev === 'blocker' ? 'blocker' : 'warning';
}
function queueSeverityOf(sev: PayrollControlFinding['severity']): PayrollFindingQueueSeverity {
  return sev === 'blocker' ? 'critical' : sev === 'warning' ? 'medium' : 'low';
}
function allowedActionsFor(f: PayrollControlFinding): PayrollFindingAllowedAction[] {
  if (f.state === 'resolved' || f.state === 'waived') return ['review', 'comment', 'reopen'];
  const base: PayrollFindingAllowedAction[] = ['review', 'assign', 'escalate', 'comment', 'resolve'];
  if (f.severity !== 'blocker') base.push('waive');
  return base;
}

// ── detail (§15.3) — finding + activity feed, kept separate from the queue ────
export async function getPayrollFindingDetail(
  findingId: string,
  activity: { cursor?: string; limit?: number } = {},
): Promise<PayrollFindingDetail | null> {
  const finding = await getPayrollFinding(findingId);
  if (!finding) return null;

  const { data: run } = await sb
    .from('finance_payroll_runs')
    .select('run_no, pay_date, net_total, employee_count')
    .eq('id', finding.runId)
    .maybeSingle<{ run_no: string; pay_date: string | null; net_total: number | null; employee_count: number | null }>();

  let ownerName: string | null = null;
  let subjectName: string | null = null;
  const ids = [finding.assigneeId, finding.employeeId].filter((x): x is string => !!x);
  if (ids.length) {
    const { data: users } = await sb
      .from('app_users').select('id, first_name, last_name, username').in('id', ids);
    const nameOf = (id: string | null) => {
      const u = (users ?? []).find(r => r.id === id);
      if (!u) return null;
      const n = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
      return n.length ? n : u.username;
    };
    ownerName = nameOf(finding.assigneeId);
    subjectName = nameOf(finding.employeeId);
  }

  const activityPage = await listFindingActivity(findingId, activity);

  return {
    id: finding.id,
    kind: kindOf(finding.severity),
    severity: queueSeverityOf(finding.severity),
    state: finding.state,
    version: finding.version,
    run: { id: finding.runId, reference: run?.run_no ?? finding.runId, payDate: run?.pay_date ?? null },
    title: finding.title,
    summary: finding.detail,
    owner: finding.assigneeId ? { type: 'user', id: finding.assigneeId, displayName: ownerName ?? finding.assigneeId } : null,
    dueAt: finding.dueAt,
    impact: { currency: 'TTD', amount: null, employeeCount: null, label: null },
    allowedActions: allowedActionsFor(finding),
    workflowTaskId: null,
    trigger: { ruleKey: finding.findingType, threshold: null, observed: finding.detail },
    subject: { employeeId: finding.employeeId, displayName: subjectName, scopeLabel: finding.domain },
    sourceEvidence: [{ type: finding.sourceType, id: finding.sourceId, label: finding.sourceType, occurredAt: finding.createdAt }],
    requiredEvidence: [],
    resolution: finding.resolvedBy && finding.resolvedAt
      ? { actorId: finding.resolvedBy, note: finding.resolutionNote ?? '', resolvedAt: finding.resolvedAt }
      : null,
    activity: activityPage,
  };
}

// ── comment command (sibling RPC; no state change, no freeze) ─────────────────
export async function commentPayrollFinding(cmd: {
  findingId: string;
  actorId: string;
  idempotencyKey: string;
  body: string;
}): Promise<{ activity: PayrollFindingActivity; findingVersion: number; duplicate: boolean }> {
  const { data, error } = await sb.rpc('finance_payroll_finding_comment_tx', {
    p_finding_id: cmd.findingId,
    p_actor_id: cmd.actorId,
    p_idempotency_key: cmd.idempotencyKey,
    p_body: cmd.body,
  });
  if (error) throw payrollRpcHttpError(error);
  const result = data as {
    finding: { id: string; run_id: string; version: number; title: string; detail: string; severity: string };
    activityId: string;
    eventId?: string | null;
    duplicate?: boolean;
  };

  const { data: actRow } = await sb
    .from('finance_payroll_finding_activity')
    .select(ACTIVITY_SELECT)
    .eq('id', result.activityId)
    .maybeSingle();
  const activity = toActivity(actRow as unknown as DbActivityRow);

  if (!result.duplicate) {
    const { data: run } = await sb
      .from('finance_payroll_runs').select('created_by').eq('id', result.finding.run_id)
      .maybeSingle<{ created_by: string | null }>();
    const ownerId = run?.created_by ?? null;
    if (ownerId && ownerId !== cmd.actorId) {
      void notify({
        userId: ownerId,
        type: 'finance.payroll.finding.comment',
        title: result.finding.title,
        body: cmd.body.trim().slice(0, 280),
        eventId: result.eventId ?? null,
        module: 'finance_payroll',
        severity: 'info',
        sourceType: 'payroll_control_finding',
        sourceId: result.finding.id,
        actionRoute: 's-finance-payroll',
        actionRequired: false,
        dedupeKey: `payroll.finding.comment.${result.activityId}`,
      });
    }
  }
  return { activity, findingVersion: result.finding.version, duplicate: !!result.duplicate };
}
