/**
 * src/components/sections/HR/RosterOverview.tsx
 *
 * HR ▸ Shift / Roster Scheduling — functional-only page.
 * Three tabs: Rosters (list + grid), Templates (shift templates + rotations +
 * coverage requirements), My Shifts (employee self-view).
 * No widget board (brief §6: "functional-only").
 * Gated by hr.roster.*; backend enforces, UI hides.
 */
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { PageHeader, Field, FormGrid, SelectInput, TextInput, EmptyState } from '@ui';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import {
  useRosters, useRoster, useShiftTemplates, useRotationPatterns,
  useCoverageRequirements, useCoverageGaps, useMyShifts, useRosterStats,
  useRosterMutation, hrRosterApi,
} from '@api/hr/roster';
import type {
  RosterStatus, AssignmentKind,
  ShiftAssignment,
} from '../../../../types/hrRoster';
import './onboardingCase.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function fmtDate(d: string | null): string { return d ? new Date(d + 'T00:00:00Z').toLocaleDateString() : '—'; }
function isoWeekStart(): string {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1);
  return d.toISOString().slice(0, 10);
}
function isoWeekEnd(start: string): string {
  const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}
function statusTone(s: RosterStatus): string {
  if (s === 'published') return 'green';
  if (s === 'draft' || s === 'returned') return 'gray';
  if (s === 'archived') return 'red';
  return 'gray';
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = 'rosters' | 'templates' | 'my-shifts';

// ── Main page ─────────────────────────────────────────────────────────────────

export function RosterOverview(): VNode {
  const [tab, setTab]     = useState<Tab>('rosters');
  const canView           = can('hr.roster.view');
  const canViewOwn        = can('hr.roster.view_own');
  const canManage         = can('hr.roster.manage');
  const canPublish        = can('hr.roster.publish');
  const canTemplates      = can('hr.roster.templates.manage');

  const _statsQ = useRosterStats();

  return (
    <div class="hr-roster">
      <PageHeader
        icon="fa-calendar-days" module="HR · Roster" title="Shift Roster"
        sub="Schedule shifts, manage rotation patterns, and publish rosters to employees."
      />

      {/* Tab bar */}
      <div class="obx-tabs" style={{ marginBottom: 16, borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 4 }}>
        {canView && (
          <button class={`obx-tab${tab === 'rosters' ? ' active' : ''}`} onClick={() => setTab('rosters')}>
            <i class="fa fa-calendar-week" /> Rosters
          </button>
        )}
        {(canManage || canTemplates) && (
          <button class={`obx-tab${tab === 'templates' ? ' active' : ''}`} onClick={() => setTab('templates')}>
            <i class="fa fa-layer-group" /> Templates
          </button>
        )}
        {canViewOwn && (
          <button class={`obx-tab${tab === 'my-shifts' ? ' active' : ''}`} onClick={() => setTab('my-shifts')}>
            <i class="fa fa-user-clock" /> My Shifts
          </button>
        )}
      </div>

      {tab === 'rosters'    && <RostersTab canManage={canManage} canPublish={canPublish} />}
      {tab === 'templates'  && <TemplatesTab canManage={canTemplates} />}
      {tab === 'my-shifts'  && <MyShiftsTab />}
    </div>
  );
}

// ── Rosters tab ───────────────────────────────────────────────────────────────

function RostersTab({ canManage, canPublish }: { canManage: boolean; canPublish: boolean }): VNode {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [newOpen, setNewOpen]           = useState(false);

  const rostersQ = useRosters({ status: statusFilter === 'all' ? undefined : statusFilter });

  if (selectedId) return <RosterDetail rosterId={selectedId} canManage={canManage} canPublish={canPublish} onBack={() => setSelectedId(null)} />;

  const rows = rostersQ.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, margin: '0 0 10px', alignItems: 'center' }}>
        <select class="ui-select" style={{ width: 180 }} value={statusFilter} onChange={e => setStatusFilter((e.target as HTMLSelectElement).value)}>
          {['all','draft','pending_approval','published','returned','archived'].map(s => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : humanize(s)}</option>
          ))}
        </select>
        {canManage && <button class="obx-btn primary" onClick={() => setNewOpen(true)}>+ New Roster</button>}
      </div>

      <div class="obx-section"><div class="obx-section-body">
        {rostersQ.isLoading && !rostersQ.data
          ? <div class="obx-empty">Loading…</div>
          : !rows.length
          ? <EmptyState icon="fa-calendar-days" title="No rosters" text={canManage ? 'Create a roster to start scheduling.' : 'No rosters match this filter.'} />
          : (
            <table class="obx-table">
              <thead>
                <tr>
                  <th>Roster</th><th>Site</th><th>Department</th>
                  <th>Period</th><th style={{ textAlign: 'center' }}>Assignments</th>
                  <th>Published</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(r.id)}>
                    <td><b>{r.rosterNo}</b><br /><span class="obx-meta">{r.title}</span></td>
                    <td class="obx-meta">{r.siteName ?? r.siteId}</td>
                    <td class="obx-meta">{r.departmentName ?? '—'}</td>
                    <td class="obx-meta">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
                    <td class="obx-meta" style={{ textAlign: 'center' }}>{r.assignmentCount}</td>
                    <td class="obx-meta">{r.publishedAt ? fmtDate(r.publishedAt) : '—'}</td>
                    <td><span class={`obx-pill ${statusTone(r.status)}`}>{humanize(r.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div></div>

      {newOpen && <NewRosterModal onClose={() => setNewOpen(false)} onCreated={id => { setNewOpen(false); setSelectedId(id); }} />}
    </div>
  );
}

// ── Roster detail (grid view) ─────────────────────────────────────────────────

function RosterDetail({ rosterId, canManage, canPublish, onBack }: {
  rosterId: string; canManage: boolean; canPublish: boolean; onBack: () => void;
}): VNode {
  const rosterQ   = useRoster(rosterId);
  const gapsQ     = useCoverageGaps(rosterId);
  const _hoursQ    = useRoster(rosterId); // reuse for employee list
  const publishMut = useRosterMutation(hrRosterApi.publish);
  const reopenMut  = useRosterMutation(hrRosterApi.reopen);
  const syncLeaveMut = useRosterMutation(hrRosterApi.syncLeave);
  const generateMut  = useRosterMutation(hrRosterApi.generate);
  const upsertAsgn   = useRosterMutation(hrRosterApi.upsertAssignment);
  const removeAsgn   = useRosterMutation(hrRosterApi.removeAssignment);

  const detail = rosterQ.data;
  const roster = detail?.roster;

  const rosterRecord = () => roster ? toActionRecord({
    title: roster.rosterNo, subtitle: humanize(roster.status), icon: 'fa-calendar-days',
    badges: [statusBadge(roster.status)],
    fields: [{ label: 'Period from', value: roster.periodStart }],
  }) : undefined;

  async function onPublish(): Promise<void> {
    if (!roster) return;
    const gaps = gapsQ.data ?? [];
    const res = await openActionModal({
      title: 'Publish roster', subtitle: roster.rosterNo, icon: 'fa-calendar-check',
      tone: gaps.length ? 'warning' : 'info', record: rosterRecord(),
      warning: gaps.length ? `There are ${gaps.length} unfilled coverage gap(s). Publishing anyway will lock the roster with those gaps.` : undefined,
      whatNext: [
        'The roster is locked and all assigned employees are notified.',
        'Further changes require reopening the roster.',
      ],
      confirmLabel: 'Publish roster',
    });
    if (!res.confirmed) return;
    try { await publishMut.mutateAsync({ rosterId }); toast('Roster published — employees notified'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to publish'); }
  }

  async function onReopen(): Promise<void> {
    if (!roster) return;
    const res = await openActionModal({
      title: 'Reopen roster', subtitle: roster.rosterNo, icon: 'fa-lock-open', tone: 'warning',
      record: rosterRecord(),
      warning: 'Reopening returns a published roster to editing. Assigned employees may already have planned around it.',
      reason: { required: false, label: 'Reason for reopening', type: 'text', placeholder: 'e.g. coverage gap discovered' },
      whatNext: [
        'Shifts and assignments become editable again.',
        'The roster must be published again to take effect.',
      ],
      confirmLabel: 'Reopen roster',
    });
    if (!res.confirmed) return;
    try { await reopenMut.mutateAsync({ rosterId, reason: res.reason ?? undefined }); toast('Roster reopened for editing'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to reopen'); }
  }

  async function onSyncLeave(): Promise<void> {
    try {
      const r = await syncLeaveMut.mutateAsync({ rosterId });
      toast(`Synced ${r.synced} leave day(s)`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Leave sync failed'); }
  }

  async function onGenerate(): Promise<void> {
    if (!roster?.rotationPatternId) {
      toast('No rotation pattern set on this roster. Assign one first.');
      return;
    }
    try {
      const r = await generateMut.mutateAsync({ rosterId });
      toast(`Generated ${r.generated} assignment(s)`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Generation failed'); }
  }

  if (rosterQ.isLoading && !detail) return (
    <div><button class="obx-back" onClick={onBack}>← Rosters</button><div class="obx-empty">Loading…</div></div>
  );
  if (!detail || !roster) return (
    <div><button class="obx-back" onClick={onBack}>← Rosters</button><div class="obx-empty">Roster not found.</div></div>
  );

  const isLocked = roster.status === 'published' || roster.status === 'archived';
  const gaps = gapsQ.data ?? [];

  // Build grid: employees × dates
  const periodDates: string[] = [];
  const d = new Date(roster.periodStart + 'T00:00:00Z');
  const end = new Date(roster.periodEnd + 'T00:00:00Z');
  while (d <= end) { periodDates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }

  // Assignment lookup: key = `${employeeId}|${date}`
  const aMap = new Map<string, ShiftAssignment>();
  for (const a of detail.assignments) aMap.set(`${a.employeeId}|${a.workDate}`, a);

  async function onCellClick(empId: string, workDate: string, current: ShiftAssignment | undefined): Promise<void> {
    if (isLocked || !canManage) return;
    const kinds: AssignmentKind[] = ['shift', 'off', 'leave', 'open'];
    const chosen = await dialog.prompt({
      title: `Assignment for ${workDate}`,
      placeholder: `Current: ${current ? humanize(current.kind) : 'none'} — enter: shift/off/leave/remove`,
    });
    if (chosen === null) return;
    if (chosen.trim() === 'remove' && current) {
      try { await removeAsgn.mutateAsync({ assignmentId: current.id }); toast('Assignment removed'); }
      catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
      return;
    }
    const kind = kinds.find(k => k === chosen.trim()) ?? 'shift';
    try {
      await upsertAsgn.mutateAsync({ rosterId, employeeId: empId, workDate, kind, source: 'manual' });
      toast('Saved');
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button class="obx-back" onClick={onBack}>← Rosters</button>
        <h2 style={{ margin: 0, fontSize: 18 }}>{roster.rosterNo} — {roster.title}</h2>
        <span class={`obx-pill ${statusTone(roster.status)}`}>{humanize(roster.status)}</span>
        <span class="obx-meta">{fmtDate(roster.periodStart)} – {fmtDate(roster.periodEnd)}</span>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {canManage && !isLocked && (
          <>
            <button class="obx-btn" onClick={() => void onGenerate()} disabled={generateMut.isPending}>
              <i class="fa fa-wand-magic-sparkles" /> Generate from Rotation
            </button>
            <button class="obx-btn" onClick={() => void onSyncLeave()} disabled={syncLeaveMut.isPending}>
              <i class="fa fa-calendar-xmark" /> Sync Leave
            </button>
          </>
        )}
        {canPublish && !isLocked && (
          <button class="obx-btn primary" onClick={() => void onPublish()} disabled={publishMut.isPending}>
            <i class="fa fa-paper-plane" /> Publish
          </button>
        )}
        {canManage && roster.status === 'published' && (
          <button class="obx-btn" onClick={() => void onReopen()} disabled={reopenMut.isPending}>
            <i class="fa fa-lock-open" /> Reopen
          </button>
        )}
      </div>

      {/* Coverage gaps panel */}
      {gaps.length > 0 && (
        <div class="obx-callout warn" style={{ marginBottom: 12 }}>
          <b><i class="fa fa-triangle-exclamation" /> Coverage gaps ({gaps.length})</b>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            {gaps.slice(0, 5).map(g => (
              <div key={`${g.workDate}|${g.shiftTemplateId}`}>
                {fmtDate(g.workDate)} · {g.shiftName}: {g.assigned}/{g.required} filled (gap: {g.gap})
              </div>
            ))}
            {gaps.length > 5 && <div>…and {gaps.length - 5} more</div>}
          </div>
        </div>
      )}

      {/* Roster grid: employees as rows, dates as columns */}
      <div class="obx-section"><div class="obx-section-body" style={{ overflowX: 'auto' }}>
        {detail.employees.length === 0
          ? <EmptyState icon="fa-users" title="No employees assigned" text="Generate from rotation or add assignments manually." />
          : (
            <table class="obx-table" style={{ minWidth: Math.max(600, 160 + periodDates.length * 70) }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 160, position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1 }}>Employee</th>
                  {periodDates.map(dt => (
                    <th key={dt} style={{ minWidth: 64, textAlign: 'center', fontSize: 11, padding: '4px 2px' }}>
                      {dt.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.employees.map(emp => (
                  <tr key={emp.id}>
                    <td style={{ position: 'sticky', left: 0, background: '#fff', fontWeight: 500, fontSize: 13, zIndex: 1 }}>
                      {emp.fullName ?? emp.id}
                    </td>
                    {periodDates.map(dt => {
                      const cell = aMap.get(`${emp.id}|${dt}`);
                      return (
                        <td key={dt}
                          style={{ textAlign: 'center', padding: '3px 2px', cursor: canManage && !isLocked ? 'pointer' : 'default',
                            background: cell ? (cell.kind === 'off' ? '#f1f5f9' : cell.kind === 'leave' ? '#fef9c3' : (cell.shiftColour ?? '#e0f2fe')) : undefined }}
                          onClick={() => void onCellClick(emp.id, dt, cell)}
                          title={cell ? `${humanize(cell.kind)}${cell.shiftName ? ' — ' + cell.shiftName : ''}` : 'Click to assign'}
                        >
                          <span style={{ fontSize: 11, fontWeight: 500 }}>
                            {cell
                              ? (cell.kind === 'shift' ? (cell.shiftCode ?? 'S') : cell.kind === 'off' ? 'OFF' : cell.kind === 'leave' ? 'LV' : 'O')
                              : <span style={{ color: '#cbd5e1' }}>—</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div></div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: '#64748b' }}>
        <span style={{ background: '#e0f2fe', padding: '2px 8px', borderRadius: 4 }}>S = Shift</span>
        <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 4 }}>OFF</span>
        <span style={{ background: '#fef9c3', padding: '2px 8px', borderRadius: 4 }}>LV = Leave</span>
        {canManage && !isLocked && <span style={{ color: '#94a3b8' }}>Click a cell to assign · type shift/off/leave/remove</span>}
      </div>
    </div>
  );
}

// ── Templates tab ─────────────────────────────────────────────────────────────

function TemplatesTab({ canManage }: { canManage: boolean }): VNode {
  const [section, setSection] = useState<'shifts' | 'rotations' | 'coverage'>('shifts');
  const templatesQ  = useShiftTemplates({ activeOnly: false });
  const rotationsQ  = useRotationPatterns();
  const coverageQ   = useCoverageRequirements();

  const [newShiftOpen, setNewShiftOpen] = useState(false);
  const _upsertShift = useRosterMutation(hrRosterApi.upsertTemplate);
  const removeShift = useRosterMutation(hrRosterApi.removeTemplate);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['shifts','rotations','coverage'] as const).map(s => (
          <button key={s} class={`obx-tab${section === s ? ' active' : ''}`} onClick={() => setSection(s)}>
            {s === 'shifts' ? 'Shift Templates' : s === 'rotations' ? 'Rotation Patterns' : 'Coverage Requirements'}
          </button>
        ))}
      </div>

      {section === 'shifts' && (
        <div>
          <div style={{ marginBottom: 10 }}>
            {canManage && <button class="obx-btn primary" onClick={() => setNewShiftOpen(true)}>+ New Shift Template</button>}
          </div>
          <div class="obx-section"><div class="obx-section-body">
            {templatesQ.isLoading && !templatesQ.data
              ? <div class="obx-empty">Loading…</div>
              : !(templatesQ.data ?? []).length
              ? <EmptyState icon="fa-clock" title="No shift templates" text="Define Day/Night/Split shifts to use in rosters." />
              : (
                <table class="obx-table">
                  <thead><tr><th>Code</th><th>Name</th><th>Start</th><th>End</th><th>Hours</th><th>Break</th><th>Site</th><th>Active</th>{canManage && <th />}</tr></thead>
                  <tbody>
                    {(templatesQ.data ?? []).map(t => (
                      <tr key={t.id}>
                        <td><b style={{ background: t.colour ?? '#e0f2fe', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{t.code}</b></td>
                        <td>{t.name}</td>
                        <td class="obx-meta">{t.startsAt.slice(0,5)}</td>
                        <td class="obx-meta">{t.endsAt.slice(0,5)}{t.crossesMidnight ? ' +1d' : ''}</td>
                        <td class="obx-meta">{t.paidHours}h</td>
                        <td class="obx-meta">{t.breakMinutes}m</td>
                        <td class="obx-meta">{t.siteId ? 'Site' : 'All'}</td>
                        <td><span class={`obx-pill ${t.isActive ? 'green' : 'gray'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
                        {canManage && (
                          <td>
                            <button class="obx-btn-sm danger" onClick={() => { void (async () => {
                              const res = await openActionModal({
                                title: 'Deactivate shift template', subtitle: t.name, icon: 'fa-power-off', tone: 'danger',
                                record: toActionRecord({
                                  title: `${t.code} · ${t.name}`, subtitle: `${t.startsAt.slice(0,5)}–${t.endsAt.slice(0,5)}${t.crossesMidnight ? ' +1d' : ''}`, icon: 'fa-clock',
                                  fields: [{ label: 'Paid hours', value: `${t.paidHours}h` }, { label: 'Scope', value: t.siteId ? 'Site' : 'All sites' }],
                                }),
                                warning: 'The template can no longer be assigned on new rosters. Existing assignments are unaffected.',
                                whatNext: ['Planners will no longer see this template when building rosters.'],
                                confirmLabel: 'Deactivate',
                              });
                              if (!res.confirmed) return;
                              try { await removeShift.mutateAsync({ id: t.id }); toast('Template deactivated'); }
                              catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
                            })(); }}>Remove</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div></div>
          {newShiftOpen && <NewShiftTemplateModal onClose={() => setNewShiftOpen(false)} onCreated={() => setNewShiftOpen(false)} />}
        </div>
      )}

      {section === 'rotations' && (
        <div class="obx-section"><div class="obx-section-body">
          {rotationsQ.isLoading && !rotationsQ.data
            ? <div class="obx-empty">Loading…</div>
            : !(rotationsQ.data ?? []).length
            ? <EmptyState icon="fa-rotate" title="No rotation patterns" text={canManage ? 'Create a pattern (e.g. 4-on-4-off) to auto-generate rosters.' : 'No rotation patterns defined.'} />
            : (
              <table class="obx-table">
                <thead><tr><th>Code</th><th>Name</th><th>Cycle Days</th><th>Days defined</th><th>Active</th></tr></thead>
                <tbody>
                  {(rotationsQ.data ?? []).map(r => (
                    <tr key={r.id}>
                      <td><b>{r.code}</b></td><td>{r.name}</td>
                      <td class="obx-meta">{r.cycleDays}</td>
                      <td class="obx-meta">{r.pattern.length} day(s) defined</td>
                      <td><span class={`obx-pill ${r.isActive ? 'green' : 'gray'}`}>{r.isActive ? 'Active' : 'Inactive'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div></div>
      )}

      {section === 'coverage' && (
        <div class="obx-section"><div class="obx-section-body">
          {coverageQ.isLoading && !coverageQ.data
            ? <div class="obx-empty">Loading…</div>
            : !(coverageQ.data ?? []).length
            ? <EmptyState icon="fa-people-group" title="No coverage requirements" text={canManage ? 'Define minimum headcount per shift to enable gap detection.' : 'No coverage requirements defined.'} />
            : (
              <table class="obx-table">
                <thead><tr><th>Shift</th><th>Site</th><th>Department</th><th>Required</th><th>Day</th><th>Active</th></tr></thead>
                <tbody>
                  {(coverageQ.data ?? []).map(r => (
                    <tr key={r.id}>
                      <td><b>{r.shiftTemplateName ?? r.shiftTemplateId}</b></td>
                      <td class="obx-meta">{r.siteId ?? 'All'}</td>
                      <td class="obx-meta">{r.departmentId ?? 'All'}</td>
                      <td class="obx-meta">{r.requiredHeadcount}</td>
                      <td class="obx-meta">{r.dayOfWeek !== null ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.dayOfWeek] ?? '?' : 'Every day'}</td>
                      <td><span class={`obx-pill ${r.isActive ? 'green' : 'gray'}`}>{r.isActive ? 'Active' : 'Inactive'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div></div>
      )}
    </div>
  );
}

// ── My Shifts tab ─────────────────────────────────────────────────────────────

function MyShiftsTab(): VNode {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(isoWeekStart());
  const [to, setTo]     = useState(isoWeekEnd(isoWeekStart()));
  const shiftsQ = useMyShifts(from, to);
  const shifts  = shiftsQ.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 13 }}>From</label>
        <input type="date" class="ui-input" value={from} onInput={e => setFrom((e.target as HTMLInputElement).value)} />
        <label style={{ fontSize: 13 }}>To</label>
        <input type="date" class="ui-input" value={to} onInput={e => setTo((e.target as HTMLInputElement).value)} />
      </div>
      <div class="obx-section"><div class="obx-section-body">
        {shiftsQ.isLoading && !shiftsQ.data
          ? <div class="obx-empty">Loading…</div>
          : !shifts.length
          ? <EmptyState icon="fa-calendar" title="No shifts scheduled" text="No published shifts found for this period." />
          : (
            <table class="obx-table">
              <thead><tr><th>Date</th><th>Shift</th><th>Start</th><th>End</th><th>Hours</th><th>Site</th><th>Note</th></tr></thead>
              <tbody>
                {shifts.map(s => (
                  <tr key={s.workDate} style={{ background: s.workDate === today ? '#f0fdf4' : undefined }}>
                    <td><b>{fmtDate(s.workDate)}</b>{s.workDate === today ? <span class="obx-pill green" style={{ marginLeft: 6, fontSize: 10 }}>Today</span> : null}</td>
                    <td>
                      {s.kind === 'shift'
                        ? <b>{s.shiftName ?? s.shiftCode ?? 'Shift'}</b>
                        : <span class={`obx-pill ${s.kind === 'leave' ? 'gray' : 'gray'}`}>{humanize(s.kind)}</span>}
                    </td>
                    <td class="obx-meta">{s.startsAt?.slice(0,5) ?? '—'}</td>
                    <td class="obx-meta">{s.endsAt?.slice(0,5) ?? '—'}</td>
                    <td class="obx-meta">{s.paidHours ? `${s.paidHours}h` : '—'}</td>
                    <td class="obx-meta">{s.siteName ?? '—'}</td>
                    <td class="obx-meta">{s.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div></div>
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

function NewRosterModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }): VNode {
  const createMut = useRosterMutation(hrRosterApi.createRoster);
  const rotationsQ = useRotationPatterns();

  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [f, setF] = useState({
    title: '', siteId: '', departmentId: '', periodStart: today, periodEnd: nextWeek,
    rotationPatternId: '',
  });

  async function submit(): Promise<void> {
    if (!f.title.trim()) { toast('Title is required'); return; }
    if (!f.siteId.trim()) { toast('Site is required'); return; }
    if (f.periodEnd < f.periodStart) { toast('End date must be after start date'); return; }
    try {
      const r = await createMut.mutateAsync({
        title: f.title, siteId: f.siteId,
        departmentId: f.departmentId || null,
        periodStart: f.periodStart, periodEnd: f.periodEnd,
        rotationPatternId: f.rotationPatternId || null,
      });
      toast(`Roster ${r.rosterNo} created`);
      onCreated(r.rosterId);
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to create roster'); }
  }

  const dayCount = (f.periodStart && f.periodEnd && f.periodEnd >= f.periodStart)
    ? Math.round((Date.parse(f.periodEnd) - Date.parse(f.periodStart)) / 86400000) + 1 : 0;
  const rotationName = (rotationsQ.data ?? []).find(r => r.id === f.rotationPatternId)?.name ?? '—';
  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Rostering', title: 'Roster Preview', description: 'Preview the roster period and coverage source before creating the draft.',
    preview: { icon: 'RO', title: f.title || 'Untitled roster', subtitle: `${f.periodStart} → ${f.periodEnd}` },
    metrics: [
      { label: 'Days', value: dayCount ? String(dayCount) : '—', tone: 'info' },
      { label: 'Rotation', value: rotationName, tone: f.rotationPatternId ? 'default' : 'muted' },
    ],
    validation: [
      ...(!f.title.trim() ? [{ message: 'Title is required.', tone: 'danger' as const }] : []),
      ...(!f.siteId.trim() ? [{ message: 'Site is required.', tone: 'danger' as const }] : []),
      ...(f.periodEnd < f.periodStart ? [{ message: 'End date must be after start date.', tone: 'danger' as const }] : []),
    ],
    whatNext: [
      { label: 'Draft roster created', description: 'Assign shifts per day, then publish to notify employees.' },
      ...(f.rotationPatternId ? [{ label: 'Rotation applied', description: 'Shifts are pre-filled from the selected rotation pattern.' }] : []),
    ],
  };
  return (
    <EnterpriseFormModal open
      title="New Roster"
      subtitle="Create a draft roster — the panel previews its period and coverage."
      icon={<i class="fas fa-calendar-days" />}
      context={context}
      primaryLabel="Create roster"
      loading={createMut.isPending}
      disabled={!f.title.trim() || !f.siteId.trim() || f.periodEnd < f.periodStart}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        <Field label="Title" wide><TextInput value={f.title} onInput={v => setF(s => ({ ...s, title: v }))} placeholder="e.g. Week 28 — Night Shift" /></Field>
        <Field label="Site ID"><TextInput value={f.siteId} onInput={v => setF(s => ({ ...s, siteId: v }))} placeholder="site_id from project_sites" /></Field>
        <Field label="Department ID"><TextInput value={f.departmentId} onInput={v => setF(s => ({ ...s, departmentId: v }))} placeholder="Optional" /></Field>
        <Field label="Period start"><TextInput type="date" value={f.periodStart} onInput={v => setF(s => ({ ...s, periodStart: v }))} /></Field>
        <Field label="Period end"><TextInput type="date" value={f.periodEnd} onInput={v => setF(s => ({ ...s, periodEnd: v }))} /></Field>
        <Field label="Rotation pattern" wide>
          <SelectInput value={f.rotationPatternId} onInput={v => setF(s => ({ ...s, rotationPatternId: v }))}
            options={[{ value: '', label: '— None (manual scheduling) —' }, ...(rotationsQ.data ?? []).map(r => ({ value: r.id, label: r.name }))]} />
        </Field>
      </FormGrid>
    </EnterpriseFormModal>
  );
}

function NewShiftTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }): VNode {
  const upsertMut = useRosterMutation(hrRosterApi.upsertTemplate);
  const [f, setF] = useState({ code: '', name: '', startsAt: '08:00', endsAt: '16:00', crossesMidnight: false, breakMinutes: 30, paidHours: 7.5, colour: '#93c5fd', isActive: true });

  async function submit(): Promise<void> {
    if (!f.code.trim() || !f.name.trim()) { toast('Code and name are required'); return; }
    try {
      await upsertMut.mutateAsync({ ...f, startsAt: f.startsAt + ':00', endsAt: f.endsAt + ':00' });
      toast('Shift template saved');
      onCreated();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
  }

  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Rostering', title: 'Shift Template Preview', description: 'Preview the shift window and paid hours before saving the template.',
    preview: { icon: f.code || 'SH', title: f.name || 'Untitled shift', subtitle: `${f.startsAt}–${f.endsAt}${f.crossesMidnight ? ' +1d' : ''}` },
    metrics: [
      { label: 'Paid hours', value: `${f.paidHours}h`, tone: 'success' },
      { label: 'Break', value: `${f.breakMinutes}m`, tone: 'default' },
    ],
    validation: [
      ...(!f.code.trim() ? [{ message: 'Code is required.', tone: 'danger' as const }] : []),
      ...(!f.name.trim() ? [{ message: 'Name is required.', tone: 'danger' as const }] : []),
    ],
    whatNext: [{ label: 'Available on rosters', description: 'Planners can assign this shift when building rosters.' }],
  };
  return (
    <EnterpriseFormModal open
      title="New Shift Template"
      subtitle="Define a reusable shift — the panel previews its hours."
      icon={<i class="fas fa-clock" />}
      context={context}
      primaryLabel="Save template"
      loading={upsertMut.isPending}
      disabled={!f.code.trim() || !f.name.trim()}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        <Field label="Code"><TextInput value={f.code} onInput={v => setF(s => ({ ...s, code: v }))} placeholder="e.g. DAY, NIGHT, SPLIT" /></Field>
        <Field label="Name"><TextInput value={f.name} onInput={v => setF(s => ({ ...s, name: v }))} placeholder="e.g. Day Shift" /></Field>
        <Field label="Start time"><TextInput type="time" value={f.startsAt} onInput={v => setF(s => ({ ...s, startsAt: v }))} /></Field>
        <Field label="End time"><TextInput type="time" value={f.endsAt} onInput={v => setF(s => ({ ...s, endsAt: v }))} /></Field>
        <Field label="Paid hours"><TextInput type="number" value={String(f.paidHours)} onInput={v => setF(s => ({ ...s, paidHours: parseFloat(v) || 0 }))} /></Field>
        <Field label="Break (min)"><TextInput type="number" value={String(f.breakMinutes)} onInput={v => setF(s => ({ ...s, breakMinutes: parseInt(v) || 0 }))} /></Field>
        <Field label="Colour"><TextInput type="color" value={f.colour} onInput={v => setF(s => ({ ...s, colour: v }))} /></Field>
      </FormGrid>
    </EnterpriseFormModal>
  );
}
