// ============================================================================
// Orchestration — record links (Cross-Module Orchestration §7).
//
// Generic record-to-record linking. Access mirrors the timeline: you can only
// link/list/unlink records you can VIEW (source-module view permission), and you
// can only create a link between two records you can both see.
// ============================================================================

import { sb } from '../db';
import { userCan } from '../auth';
import { recordViewPermission } from './timelineService';

export interface RecordRefInput {
  module: string;
  recordType: string;
  recordId: string;
  recordNo?: string;
  title?: string;
  deepLink?: string;
}

export interface LinkActor { id: string; role?: string | null }

export async function assertCanViewRecordType(actor: LinkActor, module: string, recordType: string): Promise<void> {
  const perm = recordViewPermission(module, recordType);
  if (!perm || !(await userCan(actor, perm))) {
    throw Object.assign(new Error('You do not have permission to view this record.'), { status: 403 });
  }
}

export interface LinkRecordsInput {
  source: RecordRefInput;
  target: RecordRefInput;
  relationshipType: string;
  label?: string;
  direction?: 'outbound' | 'inbound' | 'bidirectional';
  visibility?: 'public' | 'internal' | 'restricted' | 'confidential';
  metadata?: Record<string, unknown>;
}

export async function linkRecords(actor: LinkActor, input: LinkRecordsInput) {
  // Only link records you can see — both sides.
  await assertCanViewRecordType(actor, input.source.module, input.source.recordType);
  await assertCanViewRecordType(actor, input.target.module, input.target.recordType);

  const result = await sb.from('record_links').upsert({
    source_module:      input.source.module,
    source_record_type: input.source.recordType,
    source_record_id:   input.source.recordId,
    source_record_no:   input.source.recordNo ?? null,
    source_title:       input.source.title ?? null,
    source_deep_link:   input.source.deepLink ?? null,
    target_module:      input.target.module,
    target_record_type: input.target.recordType,
    target_record_id:   input.target.recordId,
    target_record_no:   input.target.recordNo ?? null,
    target_title:       input.target.title ?? null,
    target_deep_link:   input.target.deepLink ?? null,
    relationship_type:  input.relationshipType,
    label:              input.label ?? null,
    direction:          input.direction ?? 'bidirectional',
    visibility:         input.visibility ?? 'internal',
    created_by:         actor.id,
    metadata:           input.metadata ?? {},
  }, {
    onConflict: 'source_module,source_record_type,source_record_id,target_module,target_record_type,target_record_id,relationship_type',
  }).select('*').single();

  if (result.error) throw Object.assign(new Error(result.error.message), { status: 500 });
  return result.data as Record<string, unknown>;
}

export async function listRecordLinks(actor: LinkActor, args: { module: string; recordType: string; recordId: string }) {
  await assertCanViewRecordType(actor, args.module, args.recordType);

  // Two equality queries (record as source OR as target) — avoids interpolating
  // values into a PostgREST .or() filter string.
  const [srcRes, tgtRes] = await Promise.all([
    sb.from('record_links').select('*').eq('source_record_type', args.recordType).eq('source_record_id', args.recordId),
    sb.from('record_links').select('*').eq('target_record_type', args.recordType).eq('target_record_id', args.recordId),
  ]);
  if (srcRes.error) throw Object.assign(new Error(srcRes.error.message), { status: 500 });
  if (tgtRes.error) throw Object.assign(new Error(tgtRes.error.message), { status: 500 });

  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  const sourceRows = srcRes.data as { id: string }[];
  const targetRows = tgtRes.data as { id: string }[];
  for (const row of [...sourceRows, ...targetRows]) {
    if (!seen.has(row.id)) { seen.add(row.id); out.push(row); }
  }
  out.sort((a, b) => new Date((b as { created_at: string }).created_at).getTime() - new Date((a as { created_at: string }).created_at).getTime());
  return out;
}

export async function deleteRecordLink(actor: LinkActor, args: { id: string }) {
  const { data: link } = await sb.from('record_links')
    .select('source_module, source_record_type').eq('id', args.id)
    .maybeSingle<{ source_module: string; source_record_type: string }>();
  if (!link) throw Object.assign(new Error('Link not found.'), { status: 404 });
  await assertCanViewRecordType(actor, link.source_module, link.source_record_type);

  const { error } = await sb.from('record_links').delete().eq('id', args.id);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return { id: args.id };
}
