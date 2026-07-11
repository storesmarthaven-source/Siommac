/**
 * REFERENCE E2E skeleton — payslip template routes.
 *
 * Adapt to the repo's live harness conventions in `scripts/e2e/suites/communications.mjs`
 * (the reference implementation) and `scripts/e2e/README.md`. Run against the live
 * dev server: `npm run test:e2e -- payslipTemplates`.
 *
 * House rules this suite must honour (from CLAUDE.md / memory):
 *  - Cover EVERY endpoint: list, get, create, update, setDefault, delete.
 *  - Access control: authorized passes AND unauthorized is denied with the right code
 *    (provision a REAL user with only `payroll.templates.view` — do NOT forge a JWT role;
 *    requireUser re-reads app_users.role by sub, and the harness `admin` may be superadmin).
 *  - Response shape: assert the exact StoredTemplate fields the client consumes.
 *  - §2 side-effects: after each mutation assert app_events + audit_logs rows via the
 *    service-role client.
 *  - Cleanup: tag rows with h.TAG and remove in h.onCleanup().
 *  - `fails(r, msg)` takes an AWAITED response, never a thunk/promise.
 *  - apiPost/apiPatch wrap the body as { args: payload }.
 */

function sampleDesign() {
  return {
    page: { size: 'a4', orient: 'landscape', bg: '#ffffff', grid: true },
    elements: [
      { id: 'el1', type: 'heading', x: 24, y: 24, w: 300, h: 32, z: 1, text: 'PAYSLIP',
        color: '#1a2340', bg: 'transparent', fontSize: 26, fontFamily: 'Inter, sans-serif',
        bold: true, italic: false, underline: false, align: 'left', valign: 'top',
        borderW: 0, borderColor: '#d0d5e2', borderStyle: 'solid', radius: 0, padding: 6, lineHeight: 1.4 },
    ],
  };
}

/**
 * @param {object} h  test harness (api helpers, service client `svc`, users, TAG, onCleanup, assert, fails)
 */
export default async function run(h) {
  const TAG = h.TAG;
  const admin = h.users.admin;

  // A real user that can VIEW but not MANAGE — for negative access-control paths.
  const viewer = await h.provisionUser({ permissions: ['payroll.templates.view'] });

  // ---- CREATE ----
  const created = await h.apiPost('payslipTemplates.create', { name: `${TAG} Template A`, design: sampleDesign() }, { as: admin });
  h.assert(created?.id, 'create returns an id');
  h.assert(created.name === `${TAG} Template A`, 'create echoes name');
  h.assert(created.design?.elements?.length === 1, 'create stores the design');
  h.assert(typeof created.isDefault === 'boolean', 'DTO has isDefault');
  h.onCleanup(() => h.svc.from('payroll_payslip_templates').delete().eq('id', created.id));

  // side-effects (§2)
  const ev = await h.svc.from('app_events').select('id').eq('entity_id', created.id);
  h.assert((ev.data ?? []).length >= 1, 'create emits app_events');
  const audit = await h.svc.from('audit_logs').select('id').eq('entity_id', created.id);
  h.assert((audit.data ?? []).length >= 1, 'create writes audit_logs');

  // ---- LIST / GET ----
  const list = await h.apiPost('payslipTemplates.list', {}, { as: admin });
  h.assert(Array.isArray(list) && list.some((t) => t.id === created.id), 'list includes the new template');

  const got = await h.apiPost('payslipTemplates.get', { id: created.id }, { as: admin });
  h.assert(got?.id === created.id, 'get returns the template');

  // ---- UPDATE ----
  const updated = await h.apiPost('payslipTemplates.update', { id: created.id, name: `${TAG} Template A2` }, { as: admin });
  h.assert(updated?.name === `${TAG} Template A2`, 'update changes the name');
  const audit2 = await h.svc.from('audit_logs').select('id').eq('entity_id', created.id);
  h.assert((audit2.data ?? []).length >= 2, 'update writes another audit_log');

  // ---- setDefault ----
  const second = await h.apiPost('payslipTemplates.create', { name: `${TAG} Template B`, design: sampleDesign() }, { as: admin });
  h.onCleanup(() => h.svc.from('payroll_payslip_templates').delete().eq('id', second.id));
  await h.apiPost('payslipTemplates.setDefault', { id: second.id }, { as: admin });
  const afterDefault = await h.apiPost('payslipTemplates.list', {}, { as: admin });
  const defaults = afterDefault.filter((t) => t.isDefault);
  h.assert(defaults.length === 1 && defaults[0].id === second.id, 'exactly one default, and it is B');

  // ---- DELETE (soft) ----
  await h.apiPost('payslipTemplates.delete', { id: created.id }, { as: admin });
  const afterDelete = await h.apiPost('payslipTemplates.list', {}, { as: admin });
  h.assert(!afterDelete.some((t) => t.id === created.id), 'deleted (archived) template not listed');

  // ---- ACCESS CONTROL (negative) ----
  h.fails(await h.apiPost('payslipTemplates.create', { name: `${TAG} nope`, design: sampleDesign() }, { as: viewer }),
    'create denied for view-only user');
  h.fails(await h.apiPost('payslipTemplates.setDefault', { id: second.id }, { as: viewer }),
    'setDefault denied for view-only user');
  // viewer CAN read
  const viewerList = await h.apiPost('payslipTemplates.list', {}, { as: viewer });
  h.assert(Array.isArray(viewerList), 'view-only user can list');
}
