import { Hono } from 'hono';
import { deliverEventNotifications } from '../lib/appEvents';
import { requirePermission } from '../lib/auth';
import { sb } from '../lib/db';
import { requireStepUp } from '../lib/stepUp';
import { z, zv } from '../lib/validate';
import { complianceEvidenceContext } from '../lib/messaging/complianceEvidence';
import {
  createComplianceExport,
  downloadComplianceExport,
} from '../lib/messaging/complianceExport';
import {
  closeComplianceCaseTx,
  decideComplianceCaseTx,
  readComplianceConversationTx,
  requestComplianceCaseTx,
  revokeComplianceGrantTx,
} from '../lib/messaging/complianceRpc';
import {
  getComplianceCase,
  getComplianceExportById,
  listActiveCompliancePermissionHolders,
  listComplianceAccessEvents,
  listComplianceCases,
  listComplianceExports,
  searchComplianceConversations,
} from '../lib/messaging/complianceService';
import type { HonoVariables } from '../../../types/api';
import type {
  ComplianceAccessEventType,
  ComplianceCaseType,
  ComplianceMessagePage,
} from '../../../types/messagingCompliance';

const router = new Hono<{ Variables: HonoVariables }>();
const args = (c: { get: (key: string) => unknown }): unknown =>
  (c.get('body') as Record<string, unknown>).args ?? {};

const CASE_TYPES = [
  'hr_investigation',
  'safety_investigation',
  'legal_request',
  'security_investigation',
  'other_formal_investigation',
] as const satisfies readonly ComplianceCaseType[];

const ACCESS_EVENT_TYPES = [
  'case_requested',
  'case_approved',
  'case_rejected',
  'conversation_opened',
  'page_read',
  'grant_revoked',
  'export_requested',
  'export_generated',
  'export_downloaded',
  'case_closed',
] as const satisfies readonly ComplianceAccessEventType[];

const CasesListSchema = z.object({
  status: z.enum(['all', 'pending_approval', 'approved', 'rejected', 'closed']).optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().max(2_000).nullable().optional(),
});

const CaseGetSchema = z.object({ caseId: z.uuid() });

const CaseRequestSchema = z.object({
  title: z.string().trim().min(3).max(160),
  caseType: z.enum(CASE_TYPES),
  reason: z.string().trim().min(10).max(2_000),
  validUntil: z.iso.datetime(),
  threads: z.array(z.object({
    threadId: z.uuid(),
    relevanceNote: z.string().trim().min(5).max(1_000),
  })).min(1).max(20),
  idempotencyKey: z.uuid(),
});

const CaseDecisionSchema = z.object({
  caseId: z.uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(5).max(1_000),
  idempotencyKey: z.uuid(),
});

const ConversationSearchSchema = z.object({
  search: z.string().trim().max(160).optional(),
  participantUserId: z.string().min(1).max(160).optional(),
  sourceModule: z.string().trim().min(1).max(80).optional(),
  sourceEntityType: z.string().trim().min(1).max(120).optional(),
  createdFrom: z.iso.datetime().optional(),
  createdTo: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().max(2_000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.createdFrom && value.createdTo && value.createdFrom > value.createdTo) {
    context.addIssue({
      code: 'custom',
      path: ['createdTo'],
      message: 'createdTo must not be earlier than createdFrom',
    });
  }
});

const ConversationReadSchema = z.object({
  caseId: z.uuid(),
  threadId: z.uuid(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(2_000).nullable().optional(),
  idempotencyKey: z.uuid(),
});

const GrantRevokeSchema = z.object({
  grantId: z.uuid(),
  reason: z.string().trim().min(5).max(1_000),
  idempotencyKey: z.uuid(),
});

const CaseCloseSchema = z.object({
  caseId: z.uuid(),
  reason: z.string().trim().min(5).max(1_000),
  idempotencyKey: z.uuid(),
});

const AccessEventsListSchema = z.object({
  caseId: z.uuid().optional(),
  actorUserId: z.string().min(1).max(160).optional(),
  eventType: z.enum(ACCESS_EVENT_TYPES).optional(),
  threadId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(2_000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'to must not be earlier than from',
    });
  }
});

const ExportsListSchema = z.object({
  caseId: z.uuid(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().max(2_000).nullable().optional(),
});

const ExportCreateSchema = z.object({
  caseId: z.uuid(),
  threadId: z.uuid(),
  format: z.enum(['pdf', 'json']),
  rangeFrom: z.iso.datetime().nullable().optional(),
  rangeTo: z.iso.datetime().nullable().optional(),
  purpose: z.string().trim().min(5).max(1_000),
  acknowledgement: z.literal(true),
  idempotencyKey: z.uuid(),
}).superRefine((value, context) => {
  const hasFrom = Boolean(value.rangeFrom);
  const hasTo = Boolean(value.rangeTo);
  if (hasFrom !== hasTo) {
    context.addIssue({
      code: 'custom',
      path: ['rangeTo'],
      message: 'rangeFrom and rangeTo must be supplied together',
    });
  } else if (value.rangeFrom && value.rangeTo && value.rangeFrom > value.rangeTo) {
    context.addIssue({
      code: 'custom',
      path: ['rangeTo'],
      message: 'rangeTo must not be earlier than rangeFrom',
    });
  }
});

const ExportDownloadSchema = z.object({
  exportId: z.uuid(),
  idempotencyKey: z.uuid(),
});

function notifyCompliance(params: {
  eventType: string;
  sourceEntityType: 'message_compliance_case' | 'message_thread_access_grant';
  sourceEntityId: string;
  actorId: string;
  caseNo: string;
  status: string;
  eventId: string;
  recipients: string[];
  title: string;
  body: string;
}): void {
  const recipients = [...new Set(params.recipients)].filter(Boolean);
  if (recipients.length === 0) return;
  void deliverEventNotifications({
    eventType: params.eventType,
    sourceModule: 'communications',
    sourceEntityType: params.sourceEntityType,
    sourceEntityId: params.sourceEntityId,
    actorUserId: params.actorId,
    severity: 'warning',
    payload: {
      caseNo: params.caseNo,
      status: params.status,
    },
    explicitRecipients: recipients.map(userId => ({
      userId,
      reason: 'explicit' as const,
    })),
    notification: {
      title: params.title,
      body: params.body,
      actionRoute: 'messages/compliance',
      type: params.eventType,
    },
  }, params.eventId);
}

router.post('/communications/compliance/cases/list', async c => {
  const actor = await requirePermission(c, 'communications.compliance_read');
  const value = zv(c, CasesListSchema, args(c));
  if (!value.ok) return value.response;
  return c.json({
    success: true,
    data: await listComplianceCases(actor, value.data),
  });
});

router.post('/communications/compliance/cases/get', async c => {
  const actor = await requirePermission(c, 'communications.compliance_read');
  const value = zv(c, CaseGetSchema, args(c));
  if (!value.ok) return value.response;
  return c.json({
    success: true,
    data: await getComplianceCase(actor, value.data),
  });
});

router.post('/communications/compliance/cases/request', async c => {
  const actor = await requirePermission(c, 'communications.compliance_read');
  const value = zv(c, CaseRequestSchema, args(c));
  if (!value.ok) return value.response;
  const result = await requestComplianceCaseTx(
    actor.id,
    value.data,
    complianceEvidenceContext(),
  );
  if (!result.duplicate) {
    const approvers = (await listActiveCompliancePermissionHolders(
      'communications.compliance_read',
    )).filter(userId => userId !== actor.id);
    notifyCompliance({
      eventType: 'communications.compliance.case_requested',
      sourceEntityType: 'message_compliance_case',
      sourceEntityId: result.caseId,
      actorId: actor.id,
      caseNo: result.caseNo,
      status: result.status,
      eventId: result.eventId,
      recipients: approvers,
      title: 'Compliance case awaiting approval',
      body: `${result.caseNo} requires independent review.`,
    });
  }
  return c.json({
    success: true,
    data: await getComplianceCase(actor, { caseId: result.caseId }),
  });
});

router.post('/communications/compliance/cases/decide', async c => {
  const actor = await requirePermission(c, 'communications.compliance_read');
  await requireStepUp(c);
  const value = zv(c, CaseDecisionSchema, args(c));
  if (!value.ok) return value.response;
  const result = await decideComplianceCaseTx(
    actor.id,
    value.data,
    complianceEvidenceContext(),
  );
  const detail = await getComplianceCase(actor, { caseId: result.caseId });
  if (!result.duplicate) {
    notifyCompliance({
      eventType: result.status === 'approved'
        ? 'communications.compliance.case_approved'
        : 'communications.compliance.case_rejected',
      sourceEntityType: 'message_compliance_case',
      sourceEntityId: result.caseId,
      actorId: actor.id,
      caseNo: result.caseNo,
      status: result.status,
      eventId: result.eventId,
      recipients: [detail.requestedBy.id],
      title: result.status === 'approved'
        ? 'Compliance case approved'
        : 'Compliance case rejected',
      body: `${result.caseNo} is ${result.status}.`,
    });
  }
  return c.json({ success: true, data: detail });
});

router.post('/communications/compliance/conversations/search', async c => {
  await requirePermission(c, 'communications.compliance_read');
  const value = zv(c, ConversationSearchSchema, args(c));
  if (!value.ok) return value.response;
  return c.json({
    success: true,
    data: await searchComplianceConversations(value.data),
  });
});

router.post('/communications/compliance/conversations/read', async c => {
  const actor = await requirePermission(c, 'communications.compliance_read');
  const value = zv(c, ConversationReadSchema, args(c));
  if (!value.ok) return value.response;

  const detail = await getComplianceCase(actor, { caseId: value.data.caseId });
  const thread = detail.threads.find(item => item.threadId === value.data.threadId);
  const grant = detail.grants.find(item =>
    item.threadId === value.data.threadId
    && item.user.id === actor.id
    && item.status === 'active');
  if (!thread || !grant) {
    throw Object.assign(new Error('Active scoped compliance access is required.'), {
      status: 403,
      code: 'compliance_required',
    });
  }

  const result = await readComplianceConversationTx({
    actorId: actor.id,
    caseId: value.data.caseId,
    threadId: value.data.threadId,
    limit: value.data.limit ?? 50,
    cursor: value.data.cursor ?? null,
    idempotencyKey: value.data.idempotencyKey,
    evidence: complianceEvidenceContext(),
  });
  const page: ComplianceMessagePage = {
    case: {
      id: result.caseId,
      caseNo: result.caseNo,
      title: result.caseTitle,
      status: result.caseStatus,
      validUntil: result.caseValidUntil,
    },
    grant,
    thread: {
      id: thread.id,
      threadId: result.threadId,
      subject: result.threadSubject,
      threadType: result.threadType,
      sourceModule: result.sourceModule,
      sourceEntityType: result.sourceEntityType,
      sourceEntityId: result.sourceEntityId,
      relevanceNote: thread.relevanceNote,
    },
    messages: result.messages,
    nextCursor: result.nextCursor,
    capabilities: detail.capabilities,
  };
  return c.json({ success: true, data: page });
});

router.post('/communications/compliance/grants/revoke', async c => {
  const actor = await requirePermission(c, 'communications.compliance_read');
  const value = zv(c, GrantRevokeSchema, args(c));
  if (!value.ok) return value.response;

  const { data: grant, error } = await sb.from('message_thread_access_grants')
    .select('id, user_id')
    .eq('id', value.data.grantId)
    .maybeSingle<{ id: string; user_id: string }>();
  if (error) throw Object.assign(new Error(`Load compliance grant: ${error.message}`), { status: 500 });
  if (!grant) throw Object.assign(new Error('Compliance grant not found.'), { status: 404 });
  const revokingAnotherUser = grant.user_id !== actor.id;
  if (revokingAnotherUser) await requireStepUp(c);

  const result = await revokeComplianceGrantTx({
    actorId: actor.id,
    grantId: value.data.grantId,
    reason: value.data.reason,
    stepUpVerified: revokingAnotherUser,
    idempotencyKey: value.data.idempotencyKey,
    evidence: complianceEvidenceContext(),
  });
  if (!result.duplicate) {
    notifyCompliance({
      eventType: 'communications.compliance.grant_revoked',
      sourceEntityType: 'message_thread_access_grant',
      sourceEntityId: result.grantId,
      actorId: actor.id,
      caseNo: result.caseNo,
      status: 'revoked',
      eventId: result.eventId,
      recipients: [result.granteeUserId],
      title: 'Compliance access revoked',
      body: `${result.caseNo}: conversation access was revoked.`,
    });
  }
  return c.json({
    success: true,
    data: await getComplianceCase(actor, { caseId: result.caseId }),
  });
});

router.post('/communications/compliance/cases/close', async c => {
  const actor = await requirePermission(c, 'communications.compliance_read');
  await requireStepUp(c);
  const value = zv(c, CaseCloseSchema, args(c));
  if (!value.ok) return value.response;
  const result = await closeComplianceCaseTx({
    actorId: actor.id,
    caseId: value.data.caseId,
    reason: value.data.reason,
    idempotencyKey: value.data.idempotencyKey,
    evidence: complianceEvidenceContext(),
  });
  return c.json({
    success: true,
    data: await getComplianceCase(actor, { caseId: result.caseId }),
  });
});

router.post('/communications/compliance/access-events/list', async c => {
  await requirePermission(c, 'communications.compliance_read');
  const value = zv(c, AccessEventsListSchema, args(c));
  if (!value.ok) return value.response;
  return c.json({
    success: true,
    data: await listComplianceAccessEvents(value.data),
  });
});

router.post('/communications/compliance/exports/list', async c => {
  const actor = await requirePermission(c, 'communications.compliance_read');
  const value = zv(c, ExportsListSchema, args(c));
  if (!value.ok) return value.response;
  return c.json({
    success: true,
    data: await listComplianceExports(actor, value.data),
  });
});

router.post('/communications/compliance/exports/create', async c => {
  const actor = await requirePermission(c, 'communications.compliance_export');
  await requireStepUp(c);
  const value = zv(c, ExportCreateSchema, args(c));
  if (!value.ok) return value.response;
  const result = await createComplianceExport({
    actorId: actor.id,
    input: value.data,
    evidence: complianceEvidenceContext(),
  });
  return c.json({
    success: true,
    data: await getComplianceExportById(actor, result.request.exportId),
  });
});

router.post('/communications/compliance/exports/download', async c => {
  const actor = await requirePermission(c, 'communications.compliance_export');
  await requireStepUp(c);
  const value = zv(c, ExportDownloadSchema, args(c));
  if (!value.ok) return value.response;
  return c.json({
    success: true,
    data: await downloadComplianceExport({
      actorId: actor.id,
      exportId: value.data.exportId,
      idempotencyKey: value.data.idempotencyKey,
      evidence: complianceEvidenceContext(),
    }),
  });
});

export default router;
