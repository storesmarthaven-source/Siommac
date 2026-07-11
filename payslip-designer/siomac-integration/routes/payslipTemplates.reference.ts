/**
 * REFERENCE — payslip template routes for Siomac.
 *
 * This is a template to adapt to the repo's real conventions, NOT drop-in code.
 * Follow the house rules (from CLAUDE.md / memory):
 *   - Netlify Functions / Hono, POST-only, protected via requirePermission().
 *   - `apiPost` wraps the body as { args: payload }; validate `body.args ?? body`.
 *   - requireUser resolves role from the DB (not the JWT).
 *   - Every major mutation: business row -> app_events -> audit_logs
 *     (-> workflow_tasks / notifications if rules require). Prefer the
 *     transactional-outbox RPC / runModuleMutation() over separate JS calls.
 *   - Permission keys must match the catalogue EXACTLY.
 *
 * Permission keys to add to the catalogue:
 *   payroll.templates.view    — list / get
 *   payroll.templates.manage  — create / update / setDefault / delete
 */

import type { Design } from '../../src/types'; // the shared Design contract

// --- Request/response shapes (the client's ApiTemplateStore expects these) ---

interface StoredTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  updatedAt: number; // epoch ms (Date.parse(updated_at ?? created_at))
  design: Design;
}

// Pseudo-signatures — replace `ctx`, `db`, `requirePermission`, `runModuleMutation`
// with the app's actual helpers.

export const list = async (ctx: any) => {
  const user = await ctx.requirePermission('payroll.templates.view');
  const rows = await ctx.db
    .from('payroll_payslip_templates')
    .select('id,name,is_default,design,created_at,updated_at')
    .eq('status', 'active')
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  return rows.data.map(toDTO);
};

export const get = async (ctx: any) => {
  await ctx.requirePermission('payroll.templates.view');
  const { id } = ctx.body.args ?? ctx.body;
  const { data } = await ctx.db.from('payroll_payslip_templates').select('*').eq('id', id).single();
  return data ? toDTO(data) : null;
};

export const create = async (ctx: any) => {
  const user = await ctx.requirePermission('payroll.templates.manage');
  const { name, design } = ctx.body.args ?? ctx.body;
  // Prefer the transactional-outbox RPC: writes the row + app_events + audit_logs
  // atomically. Do NOT stitch separate PostgREST calls (see MUTATION_BACKBONE_PLAN).
  const row = await ctx.runModuleMutation({
    module: 'payroll',
    action: 'payslip_template.create',
    actor: user.id,
    write: (tx: any) =>
      tx.insert('payroll_payslip_templates', {
        name: String(name).trim() || 'Untitled',
        design,
        is_default: false,
        created_by: user.id,
      }),
    events: ['payroll.payslip_template.created'],
    audit: { entity: 'payroll_payslip_templates', summary: `Created template “${name}”` },
  });
  return toDTO(row);
};

export const update = async (ctx: any) => {
  const user = await ctx.requirePermission('payroll.templates.manage');
  const { id, name, design } = ctx.body.args ?? ctx.body;
  const row = await ctx.runModuleMutation({
    module: 'payroll',
    action: 'payslip_template.update',
    actor: user.id,
    write: (tx: any) =>
      tx.update('payroll_payslip_templates', id, {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(design !== undefined ? { design } : {}),
        updated_by: user.id,
      }),
    events: ['payroll.payslip_template.updated'],
    audit: { entity: 'payroll_payslip_templates', entityId: id, summary: `Updated template` },
  });
  return row ? toDTO(row) : null;
};

export const setDefault = async (ctx: any) => {
  const user = await ctx.requirePermission('payroll.templates.manage');
  const { id } = ctx.body.args ?? ctx.body;
  // Atomic: clear existing default, set the new one (unique partial index guards it).
  await ctx.runModuleMutation({
    module: 'payroll',
    action: 'payslip_template.set_default',
    actor: user.id,
    write: async (tx: any) => {
      await tx.raw(
        `update payroll_payslip_templates set is_default = (id = $1), updated_by = $2 where status = 'active'`,
        [id, user.id],
      );
    },
    events: ['payroll.payslip_template.default_changed'],
    audit: { entity: 'payroll_payslip_templates', entityId: id, summary: 'Set default payslip template' },
  });
  return { ok: true };
};

export const remove = async (ctx: any) => {
  const user = await ctx.requirePermission('payroll.templates.manage');
  const { id } = ctx.body.args ?? ctx.body;
  // Soft delete (status = archived) — never hard-delete business rows.
  await ctx.runModuleMutation({
    module: 'payroll',
    action: 'payslip_template.archive',
    actor: user.id,
    write: (tx: any) => tx.update('payroll_payslip_templates', id, { status: 'archived', updated_by: user.id }),
    events: ['payroll.payslip_template.archived'],
    audit: { entity: 'payroll_payslip_templates', entityId: id, summary: 'Archived payslip template' },
  });
  return { ok: true };
};

function toDTO(row: any): StoredTemplate {
  return {
    id: row.id,
    name: row.name,
    isDefault: !!row.is_default,
    updatedAt: Date.parse(row.updated_at ?? row.created_at),
    design: row.design,
  };
}
