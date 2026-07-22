// lib/finance/payroll/payslipBatches.ts
// Payslip Batches register read model (§15.5, F-10). A "batch" = a locked payroll run's
// payslip set (no separate batch entity). Aggregates finance_payslips (generated = row,
// rendered = file_path set) + finance_payslip_deliveries (delivered = latest 'sent',
// failed = latest 'failed') per run, resolves template + owner + pay-group names, derives
// a lifecycle, and returns a page + tab counts + KPI aggregates over the full filtered set.
//
// Design mirrors runRegister.ts: query all matching runs (minimal cols), batch-fetch the
// satellites, aggregate in memory, then tab-filter + sort + offset-page.

import { sb } from '../../db';
import type {
  PayslipBatchListRequest,
  PayslipBatchListResult,
  PayslipBatchListItem,
  PayslipBatchTab,
  PayslipBatchLifecycle,
  PayslipBatchCounts,
  PayslipBatchAggregates,
} from '../../../../../types/payrollPayslipBatches';

// A batch exists once its run is locked (payslips become relevant) or later.
const BATCH_RUN_STATUSES = ['locked', 'released', 'exported'];

interface RunRow {
  id: string;
  run_no: string;
  status: string;
  pay_date: string | null;
  period_start: string;
  period_end: string;
  pay_group: string | null;
  pay_group_id: string | null;
  template_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

function lifecycleOf(counts: PayslipBatchCounts): { lifecycle: PayslipBatchLifecycle; label: string } {
  const { generated, rendered, delivered, failed } = counts;
  if (failed > 0)                             return { lifecycle: 'attention', label: 'Needs Action' };
  if (generated > 0 && delivered >= generated) return { lifecycle: 'completed', label: 'Completed' };
  if (rendered > 0 && delivered < generated)   return { lifecycle: 'active',    label: 'In Progress' };
  return { lifecycle: 'scheduled', label: generated === 0 ? 'Pending Generation' : 'Scheduled' };
}

function matchesTab(lc: PayslipBatchLifecycle, tab: PayslipBatchTab): boolean {
  switch (tab) {
    case 'all':       return true;
    case 'active':    return lc === 'active';
    case 'attention': return lc === 'attention';
    case 'scheduled': return lc === 'scheduled';
    case 'completed': return lc === 'completed';
  }
}

const CHUNK = 200;
async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...await fetch(ids.slice(i, i + CHUNK)));
  return out;
}

export async function listPayslipBatches(req: PayslipBatchListRequest): Promise<PayslipBatchListResult> {
  const limit  = Math.max(1, Math.min(100, req.limit ?? 25));
  const offset = Math.max(0, req.offset ?? 0);
  const tab: PayslipBatchTab = req.tab ?? 'all';
  const asOf = new Date().toISOString();

  // 1. Base filter: locked+ runs, optional search / period / pay group.
  let q = sb.from('finance_payroll_runs')
    .select('id,run_no,status,pay_date,period_start,period_end,pay_group,pay_group_id,template_id,created_by,created_at,updated_at')
    .in('status', BATCH_RUN_STATUSES);
  if (req.payGroupIds && req.payGroupIds.length > 0) q = q.in('pay_group_id', req.payGroupIds);
  if (req.search?.trim()) {
    const term = `%${req.search.trim()}%`;
    q = q.or(`run_no.ilike.${term},pay_group.ilike.${term}`);
  }
  if (req.periodFrom) q = q.gte('period_end', req.periodFrom);
  if (req.periodTo)   q = q.lte('period_start', req.periodTo);

  const { data: rawRuns, error: runsErr } = await q;
  if (runsErr) throw Object.assign(new Error('listPayslipBatches/runs: ' + runsErr.message), { status: 500 });
  const runs = (rawRuns ?? []) as unknown as RunRow[];
  const runIds = runs.map(r => r.id);

  // 2. Payslips → generated + rendered counts per run.
  const generated = new Map<string, number>();
  const rendered  = new Map<string, number>();
  const payslipRunOf = new Map<string, string>();   // payslip_id → run_id (for delivery attribution)
  if (runIds.length > 0) {
    interface PsRow { id: string; run_id: string; file_path: string | null }
    const rows = await inChunks<PsRow>(runIds, async chunk => {
      const { data, error } = await sb.from('finance_payslips').select('id,run_id,file_path').in('run_id', chunk);
      if (error) throw Object.assign(new Error('listPayslipBatches/payslips: ' + error.message), { status: 500 });
      return (data ?? []);
    });
    for (const p of rows) {
      generated.set(p.run_id, (generated.get(p.run_id) ?? 0) + 1);
      if (p.file_path != null) rendered.set(p.run_id, (rendered.get(p.run_id) ?? 0) + 1);
      payslipRunOf.set(p.id, p.run_id);
    }
  }

  // 3. Deliveries → latest per payslip → delivered/failed counts per run.
  const delivered = new Map<string, number>();
  const failed    = new Map<string, number>();
  if (runIds.length > 0) {
    interface DelRow { payslip_id: string; run_id: string; status: string; created_at: string }
    const rows = await inChunks<DelRow>(runIds, async chunk => {
      const { data, error } = await sb.from('finance_payslip_deliveries')
        .select('payslip_id,run_id,status,created_at').in('run_id', chunk);
      if (error) throw Object.assign(new Error('listPayslipBatches/deliveries: ' + error.message), { status: 500 });
      return (data ?? []);
    });
    // latest delivery per payslip
    const latest = new Map<string, DelRow>();
    for (const d of rows) {
      const prev = latest.get(d.payslip_id);
      if (!prev || d.created_at > prev.created_at) latest.set(d.payslip_id, d);
    }
    for (const d of latest.values()) {
      if (d.status === 'sent')   delivered.set(d.run_id, (delivered.get(d.run_id) ?? 0) + 1);
      else if (d.status === 'failed') failed.set(d.run_id, (failed.get(d.run_id) ?? 0) + 1);
    }
  }

  // 4. Resolve templates, owners, pay groups (page-independent — small sets).
  const templateIds = [...new Set(runs.map(r => r.template_id).filter((v): v is string => v != null))];
  const ownerIds    = [...new Set(runs.map(r => r.created_by).filter((v): v is string => v != null))];
  const payGroupIds = [...new Set(runs.map(r => r.pay_group_id).filter((v): v is string => v != null))];

  const templateMap = new Map<string, { name: string; status: string }>();
  if (templateIds.length > 0) {
    const { data, error } = await sb.from('payroll_payslip_templates').select('id,name,status').in('id', templateIds);
    if (error) throw Object.assign(new Error('listPayslipBatches/templates: ' + error.message), { status: 500 });
    for (const t of (data ?? []) as { id: string; name: string; status: string }[]) templateMap.set(t.id, { name: t.name, status: t.status });
  }
  const ownerMap = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data, error } = await sb.from('app_users').select('id, first_name, last_name, username').in('id', ownerIds);
    if (error) throw Object.assign(new Error('listPayslipBatches/owners: ' + error.message), { status: 500 });
    for (const u of (data ?? []) as { id: string; first_name: string | null; last_name: string | null; username: string | null }[]) {
      ownerMap.set(u.id, [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || u.id);
    }
  }
  const pgMap = new Map<string, string>();
  if (payGroupIds.length > 0) {
    const { data, error } = await sb.from('finance_pay_groups').select('id,name').in('id', payGroupIds);
    if (error) throw Object.assign(new Error('listPayslipBatches/pay-groups: ' + error.message), { status: 500 });
    for (const g of (data ?? []) as { id: string; name: string }[]) pgMap.set(g.id, g.name);
  }

  // 5. Build items + counts + lifecycle.
  const all: PayslipBatchListItem[] = runs.map(run => {
    const counts: PayslipBatchCounts = {
      generated: generated.get(run.id) ?? 0,
      rendered:  rendered.get(run.id) ?? 0,
      delivered: delivered.get(run.id) ?? 0,
      failed:    failed.get(run.id) ?? 0,
    };
    const { lifecycle, label } = lifecycleOf(counts);
    const tpl = run.template_id ? templateMap.get(run.template_id) : undefined;
    return {
      id: run.id,
      reference: run.run_no,
      runState: run.status,
      payGroup: { id: run.pay_group_id, name: run.pay_group_id ? (pgMap.get(run.pay_group_id) ?? run.pay_group ?? null) : (run.pay_group ?? null) },
      payDate: run.pay_date,
      template: { id: run.template_id, name: tpl?.name ?? null, status: tpl?.status ?? null },
      counts,
      lifecycle,
      lifecycleLabel: label,
      owner: { id: run.created_by, name: run.created_by ? (ownerMap.get(run.created_by) ?? null) : null },
      createdAt: run.created_at,
      updatedAt: run.updated_at ?? run.created_at,
    };
  });

  // 6. Tab counts + KPI aggregates over the FULL filtered set.
  const tabCounts: Record<PayslipBatchTab, number> = { all: 0, active: 0, attention: 0, scheduled: 0, completed: 0 };
  const aggregates: PayslipBatchAggregates = { activeBatches: 0, rendered: 0, delivered: 0, failed: 0 };
  for (const it of all) {
    tabCounts.all++;
    tabCounts[it.lifecycle]++;
    if (it.lifecycle !== 'completed') aggregates.activeBatches++;
    aggregates.rendered  += it.counts.rendered;
    aggregates.delivered += it.counts.delivered;
    aggregates.failed    += it.counts.failed;
  }

  // 7. Tab filter + sort (pay_date desc, nulls last) + offset page.
  const filtered = all
    .filter(it => matchesTab(it.lifecycle, tab))
    .sort((a, b) => {
      if (a.payDate && b.payDate) return a.payDate > b.payDate ? -1 : a.payDate < b.payDate ? 1 : (a.reference > b.reference ? -1 : 1);
      if (a.payDate) return -1;
      if (b.payDate) return 1;
      return a.reference > b.reference ? -1 : 1;
    });

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);

  return { items, total, tabCounts, aggregates, asOf };
}
