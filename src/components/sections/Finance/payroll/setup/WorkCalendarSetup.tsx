// Shared Work Calendar (F-CAL) admin console — holiday sets, work-calendar patterns, pay-group /
// organization assignments, and a resolve preview. Self-gated on hr.work_calendar.view; every
// mutation is a caller-idempotent command through the authenticated API (no fixtures).
// Contract: docs/module-contracts/shared-work-calendar-delivery-contract.md (Rev 5).
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { HrfinWizardModal, HrfinPill, HrfinPageHeader, type HrfinTone } from '@ui';
import { usePayGroups } from '@api/finance/payroll';
import {
  workCalendarsApi, requestKey, useHolidayCalendars, useWorkCalendars, useHolidayCalendar, useWorkCalendar,
  useHolidays, useAssignments, useWorkCalendarMutation,
  type HolidayVersionDto, type WorkVersionDto, type HolidayDateDto, type ResolvePreview, type AssignmentScope,
} from '@api/hr/workCalendars';
import {
  ISO_WEEKDAYS, WEEKDAY_LABEL, WEEKDAY_FULL, HOLIDAY_TYPES, DEFAULT_TZ,
  emptyHolidayForm, holidayFieldErrors, holidayFormValid, toHolidayInput, type HolidayFormState,
  emptyPatternForm, patternFieldErrors, patternFormValid, buildWeekdayFractions, sortedWeekdays, type PatternFormState,
  periodError, effectiveError, assignmentWindowError, friendlyError, type VersionWindow,
} from './workCalendarRules';
import './workCalendar.css';

const today = (): string => new Date().toISOString().slice(0, 10);
const title = (v: string): string => v.replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
const range = (from: string | null, to: string | null): string => `${from ?? '—'}${to ? ` – ${to}` : ' – Open'}`;
const statusTone = (s: string): HrfinTone => (s === 'published' || s === 'active' ? 'ok' : s === 'draft' ? 'wn' : s === 'cancelled' ? 'bad' : 'nu');
const patternSummary = (w: number[]): string => (w.length ? sortedWeekdays(w).map(d => WEEKDAY_LABEL[d]).join(' ') : '—');
const shortSum = (c: string | null): string => (c ? `${c.slice(0, 12)}…` : '—');

// Prompt for the effective-from date of a copy_version draft (the correction path for immutable
// published/superseded versions). Returns null when cancelled or malformed.
async function copyEffectiveDate(title: string, sourceFrom: string | null): Promise<string | null> {
  const value = sourceFrom && sourceFrom > today() ? sourceFrom : today();
  const effectiveFrom = await dialog.prompt({
    title, text: 'Effective-from date for the corrected draft (YYYY-MM-DD). The source content is cloned into a new editable draft you then edit and publish.',
    value, placeholder: 'YYYY-MM-DD', confirmText: 'Create Draft',
  });
  if (effectiveFrom === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) { await dialog.error('Enter the date as YYYY-MM-DD.'); return null; }
  return effectiveFrom;
}

const SUBTABS = [
  { key: 'holiday-sets', label: 'Holiday Sets' },
  { key: 'work-calendars', label: 'Work Calendars' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'resolve', label: 'Resolve Preview' },
] as const;
type SubTab = typeof SUBTABS[number]['key'];

// Standalone page (HR ▸ Work Calendar). The bare WorkCalendarSetup below is embedded as a tab in
// Finance ▸ Payroll Setup; this wrapper gives it its own page chrome for the HR/shared nav entry.
export function WorkCalendarPage(): VNode {
  return (
    <div class="hrfin fin-page">
      <HrfinPageHeader icon="calendar" title="Work Calendar"
        sub="Shared holiday sets, work-calendar patterns and pay-group assignments that supply authoritative working-day evidence to payroll." />
      <WorkCalendarSetup />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export function WorkCalendarSetup(): VNode {
  const [tab, setTab] = useState<SubTab>('holiday-sets');
  if (!can('hr.work_calendar.view')) {
    return <div class="wcal"><div class="wcal-state">You do not have permission to view the work calendar.</div></div>;
  }
  return (
    <div class="wcal">
      <nav class="wcal-subtabs" role="tablist" aria-label="Work Calendar Sections">
        {SUBTABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            class={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </nav>
      {tab === 'holiday-sets' ? <HolidaySetsPanel />
        : tab === 'work-calendars' ? <WorkCalendarsPanel />
        : tab === 'assignments' ? <AssignmentsPanel />
        : <ResolvePanel />}
    </div>
  );
}

// ── Shared: a directory register with loading / error / empty / populated states ──
function Directory<T extends { id: string }>({ q, search, onSearch, onNext, onPrev, hasPrev, canNew, onNew, newLabel, noun, columns, row, onOpen }: {
  q: { data?: { items: T[]; nextCursor: string | null }; isLoading: boolean; isError: boolean; error?: unknown; refetch: () => void };
  search: string; onSearch: (v: string) => void; onNext: () => void; onPrev: () => void; hasPrev: boolean;
  canNew: boolean; onNew: () => void; newLabel: string; noun: string;
  columns: string[]; row: (item: T) => VNode; onOpen: (item: T) => void;
}): VNode {
  return (
    <>
      <div class="wcal-toolbar">
        <input aria-label={`Search ${noun}`} value={search} placeholder={`Search ${noun}…`} onInput={e => onSearch(e.currentTarget.value)} />
        <div>
          <button type="button" onClick={() => q.refetch()}>Refresh</button>
          {canNew && <button type="button" class="is-primary" onClick={onNew}>{newLabel}</button>}
        </div>
      </div>
      <div class="wcal-register" aria-live="polite" aria-busy={q.isLoading && !q.data}>
        {q.isLoading && !q.data ? (
          <div class="wcal-skel">{[0, 1, 2, 3].map(i => <div key={i} class="wcal-skel-row" />)}</div>
        ) : q.isError ? (
          <div class="wcal-state is-error">{noun} could not be loaded. <button type="button" onClick={() => q.refetch()}>Retry</button></div>
        ) : !q.data?.items.length ? (
          <div class="wcal-state">{search ? `No ${noun} match your search.` : `No ${noun} yet.`}</div>
        ) : (
          <table>
            <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}<th aria-label="Open" /></tr></thead>
            <tbody>{q.data.items.map(item => (
              <tr key={item.id} tabIndex={0} onClick={() => onOpen(item)}
                onKeyDown={e => { if (e.key === 'Enter') onOpen(item); }}>
                {row(item)}
                <td><button type="button" aria-label="Open" onClick={e => { e.stopPropagation(); onOpen(item); }}>→</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div class="wcal-footer">
        <span>{q.data ? `${q.data.items.length} shown` : '—'}</span>
        <div><button type="button" disabled={!hasPrev} onClick={onPrev}>Previous</button>
          <button type="button" disabled={!q.data?.nextCursor} onClick={onNext}>Next</button></div>
      </div>
    </>
  );
}

function usePager() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<string[]>([]);
  const next = (nextCursor: string | null): void => { if (!nextCursor) return; setHistory(h => [...h, cursor ?? '']); setCursor(nextCursor); };
  const prev = (): void => { const p = history.at(-1); setCursor(p || undefined); setHistory(h => h.slice(0, -1)); };
  const reset = (): void => { setCursor(undefined); setHistory([]); };
  return { cursor, next, prev, reset, hasPrev: history.length > 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOLIDAY SETS
// ═══════════════════════════════════════════════════════════════════════════════
export function HolidaySetsPanel(): VNode {
  const [search, setSearch] = useState('');
  const pager = usePager();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canManage = can('hr.work_calendar.manage');
  const q = useHolidayCalendars({ ...(search.trim() ? { search: search.trim() } : {}), ...(pager.cursor ? { cursor: pager.cursor } : {}), limit: 25 });

  if (selected) return <HolidaySetDetail calendarId={selected} onBack={() => setSelected(null)} />;
  return (
    <>
      <Directory
        q={q} search={search} onSearch={v => { setSearch(v); pager.reset(); }}
        onNext={() => pager.next(q.data?.nextCursor ?? null)} onPrev={pager.prev} hasPrev={pager.hasPrev}
        canNew={canManage} onNew={() => setCreating(true)} newLabel="New Holiday Set" noun="holiday sets"
        columns={['Name', 'Jurisdiction', 'Created']}
        row={c => (<><td><strong>{c.name}</strong></td><td>{c.jurisdiction}</td><td>{c.createdAt.slice(0, 10)}</td></>)}
        onOpen={c => setSelected(c.id)}
      />
      {creating && <HolidayVersionModal onClose={() => setCreating(false)} onSaved={id => { setCreating(false); setSelected(id); }} />}
    </>
  );
}

function HolidaySetDetail({ calendarId, onBack }: { calendarId: string; onBack: () => void }): VNode {
  const q = useHolidayCalendar(calendarId);
  const [addVersion, setAddVersion] = useState(false);
  const [openVersion, setOpenVersion] = useState<string | null>(null);
  const copy = useWorkCalendarMutation(workCalendarsApi.holidaySetCommand);
  const canManage = can('hr.work_calendar.manage');

  if (q.isLoading) return <div class="wcal-state">Loading holiday set…</div>;
  if (q.isError || !q.data) return <div class="wcal-state is-error">Holiday set could not be loaded. <button type="button" onClick={onBack}>Back</button></div>;
  const { calendar, versions } = q.data;
  const version = openVersion ? versions.find(v => v.id === openVersion) ?? null : null;

  // Published/superseded versions are immutable — the correction path is copy → edit draft → publish.
  const doCopy = async (v: HolidayVersionDto): Promise<void> => {
    const effectiveFrom = await copyEffectiveDate('Copy Holiday Version To Draft', v.effectiveFrom);
    if (!effectiveFrom) return;
    try {
      await copy.mutateAsync({ command: 'copy_version', requestKey: requestKey(), reason: `Copied holiday v${v.versionNo} to a new draft`, sourceVersionId: v.id, effectiveFrom });
      toast(`Draft copied from v${v.versionNo}.`); void q.refetch();
    } catch (e) { void dialog.error(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <div class="wcal-detail">
      <div class="wcal-detail-head">
        <div><button type="button" onClick={onBack}>← Holiday Sets</button><h2>{calendar.name}</h2><span>Jurisdiction {calendar.jurisdiction} · {versions.length} version{versions.length === 1 ? '' : 's'}</span></div>
        {canManage && <div><button type="button" class="is-primary" onClick={() => setAddVersion(true)}>New Draft Version</button></div>}
      </div>
      <div class="wcal-panel">
        <h3>Versions</h3>
        {!versions.length ? <div class="wcal-state">No versions yet. Create a draft, add the verified holidays, then publish.</div> : (
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>Effective</th><th>Provenance</th><th>Checksum</th><th aria-label="Actions" /></tr></thead>
            <tbody>{versions.map(v => (
              <tr key={v.id} class={openVersion === v.id ? 'is-open' : ''}>
                <td>v{v.versionNo}</td><td><HrfinPill tone={statusTone(v.status)}>{title(v.status)}</HrfinPill></td>
                <td>{range(v.effectiveFrom, v.effectiveTo)}</td><td>{title(v.provenance)}</td><td class="wcal-mono">{shortSum(v.checksum)}</td>
                <td class="wcal-row-actions">
                  <button type="button" onClick={() => setOpenVersion(openVersion === v.id ? null : v.id)}>{openVersion === v.id ? 'Hide' : 'Holidays'}</button>
                  {canManage && v.status !== 'draft' && <button type="button" disabled={copy.isPending} onClick={() => void doCopy(v)}>Copy To Draft</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {version && <HolidayVersionEditor calendar={calendar} version={version} canManage={canManage} onChanged={() => void q.refetch()} />}
      {addVersion && <HolidayVersionModal calendarId={calendarId} onClose={() => setAddVersion(false)} onSaved={() => { setAddVersion(false); void q.refetch(); }} />}
    </div>
  );
}

function HolidayVersionEditor({ calendar, version, canManage, onChanged }: {
  calendar: { id: string; name: string; lockVersion: number }; version: HolidayVersionDto; canManage: boolean; onChanged: () => void;
}): VNode {
  const holidays = useHolidays(version.id);
  const [editing, setEditing] = useState<HolidayDateDto | null>(null);
  const [adding, setAdding] = useState(false);
  const remove = useWorkCalendarMutation(workCalendarsApi.holidaySetCommand);
  const publish = useWorkCalendarMutation(workCalendarsApi.holidaySetCommand);
  const isDraft = version.status === 'draft';
  const editable = isDraft && canManage;
  const window: VersionWindow = { from: version.effectiveFrom, to: version.effectiveTo };

  const doRemove = async (h: HolidayDateDto): Promise<void> => {
    const ok = await dialog.confirm({ title: `Remove ${h.nameCommon}?`, text: `Removes ${h.holidayDate} from draft v${version.versionNo}.`, confirmText: 'Remove', icon: 'warning' });
    if (!ok) return;
    try {
      await remove.mutateAsync({ command: 'remove_holiday', requestKey: requestKey(), reason: `Removed holiday ${h.holidayDate} from v${version.versionNo}`, versionId: version.id, holidayId: h.id, expectedLockVersion: version.lockVersion });
      toast('Holiday removed.'); onChanged(); void holidays.refetch();
    } catch (e) { void dialog.error(friendlyError(e instanceof Error ? e.message : null)); }
  };
  const doPublish = async (): Promise<void> => {
    const count = holidays.data?.items.length ?? 0;
    if (!count) { void dialog.error(friendlyError('calendar.holiday_set_empty')); return; }
    const ok = await dialog.confirm({ title: `Publish v${version.versionNo}?`, text: `Freezes ${count} holiday row${count === 1 ? '' : 's'}, supersedes any current published version, and makes this set payroll-eligible. Published versions are immutable.`, confirmText: 'Publish', icon: 'question' });
    if (!ok) return;
    try {
      await publish.mutateAsync({ command: 'publish_version', requestKey: requestKey(), reason: `Published holiday version v${version.versionNo}`, versionId: version.id, expectedVersionLockVersion: version.lockVersion, expectedCalendarLockVersion: calendar.lockVersion });
      toast('Holiday version published.'); onChanged();
    } catch (e) { void dialog.error(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <div class="wcal-panel">
      <div class="wcal-panel-head">
        <h3>Holidays · v{version.versionNo} <HrfinPill tone={statusTone(version.status)}>{title(version.status)}</HrfinPill></h3>
        {editable && <div class="wcal-inline-actions">
          <button type="button" onClick={() => setAdding(true)}>Add Holiday</button>
          <button type="button" class="is-primary" disabled={publish.isPending || !(holidays.data?.items.length)} onClick={() => void doPublish()}>Publish Version</button>
        </div>}
      </div>
      {holidays.isLoading && !holidays.data ? <div class="wcal-state">Loading holidays…</div>
        : holidays.isError ? <div class="wcal-state is-error">Holidays could not be loaded. <button type="button" onClick={() => holidays.refetch()}>Retry</button></div>
        : !holidays.data?.items.length ? <div class="wcal-state">No holidays yet.{editable ? ' Add the verified official dates before publishing.' : ''}</div>
        : (
          <table>
            <thead><tr><th>Date</th><th>Observed</th><th>Name</th><th>Type</th><th>Fraction</th><th>Source</th>{editable && <th aria-label="Actions" />}</tr></thead>
            <tbody>{holidays.data.items.map(h => (
              <tr key={h.id}>
                <td>{h.holidayDate}</td><td>{h.observedDate ?? '—'}</td>
                <td><strong>{h.nameCommon}</strong><small>{h.nameStatutory}</small></td>
                <td>{title(h.holidayType)}</td><td>{h.dayFraction}</td>
                <td><small>{h.sourceReference}</small></td>
                {editable && <td class="wcal-row-actions">
                  <button type="button" onClick={() => setEditing(h)}>Edit</button>
                  <button type="button" class="is-danger" disabled={remove.isPending} onClick={() => void doRemove(h)}>Remove</button>
                </td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      {(adding || editing) && (
        <HolidayEditorModal
          versionId={version.id} expectedLockVersion={version.lockVersion} window={window} existing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); onChanged(); void holidays.refetch(); }}
        />
      )}
    </div>
  );
}

export function HolidayEditorModal({ versionId, expectedLockVersion, window, existing, onClose, onSaved }: {
  versionId: string; expectedLockVersion: number; window?: VersionWindow; existing: HolidayDateDto | null;
  onClose: () => void; onSaved: () => void;
}): VNode {
  const [f, setF] = useState<HolidayFormState>(() => existing ? {
    holidayDate: existing.holidayDate, observedDate: existing.observedDate ?? '', dayFraction: existing.dayFraction === 1 ? '' : String(existing.dayFraction),
    nameStatutory: existing.nameStatutory, nameCommon: existing.nameCommon, holidayType: existing.holidayType,
    sourceReference: existing.sourceReference, sourcePublishedDate: existing.sourcePublishedDate, provenanceNote: existing.provenanceNote,
  } : emptyHolidayForm());
  const [err, setErr] = useState<string | null>(null);
  const mut = useWorkCalendarMutation(workCalendarsApi.holidaySetCommand);
  const errors = holidayFieldErrors(f, window);
  const valid = holidayFormValid(f, window);
  const set = (k: keyof HolidayFormState, v: string): void => setF(p => ({ ...p, [k]: v }));

  const save = async (): Promise<void> => {
    if (!valid) return;
    setErr(null);
    try {
      const holiday = toHolidayInput(f);
      await mut.mutateAsync(existing
        ? { command: 'update_holiday', requestKey: requestKey(), reason: `Updated holiday ${f.holidayDate}`, versionId, holidayId: existing.id, expectedLockVersion, holiday }
        : { command: 'add_holiday', requestKey: requestKey(), reason: `Added holiday ${f.holidayDate}`, versionId, expectedLockVersion, holiday });
      toast(existing ? 'Holiday updated.' : 'Holiday added.'); onSaved();
    } catch (e) { setErr(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <HrfinWizardModal open title={existing ? 'Edit Holiday' : 'Add Holiday'} stepCount={1} activeStep={0}
      onClose={onClose} primaryLabel={existing ? 'Save Holiday' : 'Add Holiday'} primaryDisabled={!valid} primaryLoading={mut.isPending} onPrimary={() => void save()}>
      <div class="wcal-form">
        {err && <div class="wcal-banner is-error" role="alert">{err}</div>}
        <div class="wcal-grid2">
          <label>Holiday Date<input type="date" value={f.holidayDate} onInput={e => set('holidayDate', e.currentTarget.value)} />{errors.holidayDate && <small class="wcal-err">{errors.holidayDate}</small>}</label>
          <label>Observed Date (Optional)<input type="date" value={f.observedDate} onInput={e => set('observedDate', e.currentTarget.value)} />{errors.observedDate && <small class="wcal-err">{errors.observedDate}</small>}</label>
        </div>
        <div class="wcal-grid2">
          <label>Statutory Name<input maxLength={200} value={f.nameStatutory} onInput={e => set('nameStatutory', e.currentTarget.value)} />{errors.nameStatutory && <small class="wcal-err">{errors.nameStatutory}</small>}</label>
          <label>Common Name<input maxLength={200} value={f.nameCommon} onInput={e => set('nameCommon', e.currentTarget.value)} />{errors.nameCommon && <small class="wcal-err">{errors.nameCommon}</small>}</label>
        </div>
        <div class="wcal-grid2">
          <label>Holiday Type<select value={f.holidayType} onChange={e => set('holidayType', e.currentTarget.value)}>
            <option value="">Select a type…</option>{HOLIDAY_TYPES.map(t => <option key={t} value={t}>{title(t)}</option>)}
          </select>{errors.holidayType && <small class="wcal-err">{errors.holidayType}</small>}</label>
          <label>Day Fraction (Optional, full day if blank)<input type="number" step="0.01" min="0" max="1" placeholder="1" value={f.dayFraction} onInput={e => set('dayFraction', e.currentTarget.value)} />{errors.dayFraction && <small class="wcal-err">{errors.dayFraction}</small>}</label>
        </div>
        <div class="wcal-grid2">
          <label>Source Reference<input maxLength={500} placeholder="e.g. T&T Public Holidays Act, s.2" value={f.sourceReference} onInput={e => set('sourceReference', e.currentTarget.value)} />{errors.sourceReference && <small class="wcal-err">{errors.sourceReference}</small>}</label>
          <label>Source Published Date<input type="date" value={f.sourcePublishedDate} onInput={e => set('sourcePublishedDate', e.currentTarget.value)} />{errors.sourcePublishedDate && <small class="wcal-err">{errors.sourcePublishedDate}</small>}</label>
        </div>
        <label>Provenance Note<textarea maxLength={1000} placeholder="Why this date/observance is authoritative for this jurisdiction and year." value={f.provenanceNote} onInput={e => set('provenanceNote', e.currentTarget.value)} />{errors.provenanceNote && <small class="wcal-err">{errors.provenanceNote}</small>}</label>
      </div>
    </HrfinWizardModal>
  );
}

// Create a new holiday calendar (no calendarId) OR add a draft version to an existing one.
function HolidayVersionModal({ calendarId, onClose, onSaved }: { calendarId?: string; onClose: () => void; onSaved: (calendarId: string) => void }): VNode {
  const [name, setName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('TT');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useWorkCalendarMutation(workCalendarsApi.holidaySetCommand);
  const isNew = !calendarId;
  const nameErr = isNew && name.trim().length < 2 ? 'Name must be at least 2 characters.' : null;
  const jurErr = isNew && jurisdiction.trim().length < 2 ? 'Jurisdiction is required.' : null;
  const effErr = effectiveError(from, to);
  const valid = !nameErr && !jurErr && !effErr;

  const save = async (): Promise<void> => {
    if (!valid) return;
    setErr(null);
    try {
      const res = await mut.mutateAsync({
        command: 'create_version', requestKey: requestKey(), reason: isNew ? `Created holiday set ${name.trim()}` : 'Added holiday set version',
        ...(calendarId ? { calendarId } : { calendar: { name: name.trim(), jurisdiction: jurisdiction.trim().toUpperCase() } }),
        effectiveFrom: from, ...(to ? { effectiveTo: to } : {}), timezone: DEFAULT_TZ,
      });
      toast(isNew ? 'Holiday set created.' : 'Draft version created.'); onSaved(res.calendar.id);
    } catch (e) { setErr(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <HrfinWizardModal open title={isNew ? 'New Holiday Set' : 'New Draft Version'} stepCount={1} activeStep={0}
      onClose={onClose} primaryLabel="Create Draft" primaryDisabled={!valid} primaryLoading={mut.isPending} onPrimary={() => void save()}>
      <div class="wcal-form">
        {err && <div class="wcal-banner is-error" role="alert">{err}</div>}
        {isNew && <div class="wcal-grid2">
          <label>Name<input maxLength={120} placeholder="Trinidad & Tobago National" value={name} onInput={e => setName(e.currentTarget.value)} />{nameErr && <small class="wcal-err">{nameErr}</small>}</label>
          <label>Jurisdiction<input maxLength={20} value={jurisdiction} onInput={e => setJurisdiction(e.currentTarget.value)} />{jurErr && <small class="wcal-err">{jurErr}</small>}</label>
        </div>}
        <div class="wcal-grid2">
          <label>Effective From<input type="date" value={from} onInput={e => setFrom(e.currentTarget.value)} /></label>
          <label>Effective To (Optional)<input type="date" min={from} value={to} onInput={e => setTo(e.currentTarget.value)} /></label>
        </div>
        {effErr && <small class="wcal-err">{effErr}</small>}
        <div class="wcal-note">Timezone {DEFAULT_TZ}. Add the verified official holidays to this draft, then publish — an empty version cannot be published.</div>
      </div>
    </HrfinWizardModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORK CALENDARS
// ═══════════════════════════════════════════════════════════════════════════════
export function WorkCalendarsPanel(): VNode {
  const [search, setSearch] = useState('');
  const pager = usePager();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canManage = can('hr.work_calendar.manage');
  const q = useWorkCalendars({ ...(search.trim() ? { search: search.trim() } : {}), ...(pager.cursor ? { cursor: pager.cursor } : {}), limit: 25 });

  if (selected) return <WorkCalendarDetail calendarId={selected} onBack={() => setSelected(null)} />;
  return (
    <>
      <Directory
        q={q} search={search} onSearch={v => { setSearch(v); pager.reset(); }}
        onNext={() => pager.next(q.data?.nextCursor ?? null)} onPrev={pager.prev} hasPrev={pager.hasPrev}
        canNew={canManage} onNew={() => setCreating(true)} newLabel="New Work Calendar" noun="work calendars"
        columns={['Name', 'Created']}
        row={c => (<><td><strong>{c.name}</strong></td><td>{c.createdAt.slice(0, 10)}</td></>)}
        onOpen={c => setSelected(c.id)}
      />
      {creating && <WorkVersionModal onClose={() => setCreating(false)} onSaved={id => { setCreating(false); setSelected(id); }} />}
    </>
  );
}

function WorkCalendarDetail({ calendarId, onBack }: { calendarId: string; onBack: () => void }): VNode {
  const q = useWorkCalendar(calendarId);
  const [addVersion, setAddVersion] = useState(false);
  const [editVersion, setEditVersion] = useState<WorkVersionDto | null>(null);
  const publish = useWorkCalendarMutation(workCalendarsApi.workCalendarCommand);
  const copy = useWorkCalendarMutation(workCalendarsApi.workCalendarCommand);
  const canManage = can('hr.work_calendar.manage');

  if (q.isLoading) return <div class="wcal-state">Loading work calendar…</div>;
  if (q.isError || !q.data) return <div class="wcal-state is-error">Work calendar could not be loaded. <button type="button" onClick={onBack}>Back</button></div>;
  const { calendar, versions } = q.data;

  const doPublish = async (v: WorkVersionDto): Promise<void> => {
    const ok = await dialog.confirm({ title: `Publish v${v.versionNo}?`, text: 'Freezes the weekday pattern + holiday-set link, supersedes any current published version, and makes this calendar assignable. Published versions are immutable.', confirmText: 'Publish', icon: 'question' });
    if (!ok) return;
    try {
      await publish.mutateAsync({ command: 'publish_version', requestKey: requestKey(), reason: `Published work calendar v${v.versionNo}`, versionId: v.id, expectedVersionLockVersion: v.lockVersion, expectedCalendarLockVersion: calendar.lockVersion });
      toast('Work calendar version published.'); void q.refetch();
    } catch (e) { void dialog.error(friendlyError(e instanceof Error ? e.message : null)); }
  };
  // Immutable versions are corrected by cloning into a fresh draft (copy → edit pattern → publish).
  const doCopy = async (v: WorkVersionDto): Promise<void> => {
    const effectiveFrom = await copyEffectiveDate('Copy Work Calendar Version To Draft', v.effectiveFrom);
    if (!effectiveFrom) return;
    try {
      await copy.mutateAsync({ command: 'copy_version', requestKey: requestKey(), reason: `Copied work calendar v${v.versionNo} to a new draft`, sourceVersionId: v.id, effectiveFrom });
      toast(`Draft copied from v${v.versionNo}.`); void q.refetch();
    } catch (e) { void dialog.error(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <div class="wcal-detail">
      <div class="wcal-detail-head">
        <div><button type="button" onClick={onBack}>← Work Calendars</button><h2>{calendar.name}</h2><span>{versions.length} version{versions.length === 1 ? '' : 's'}</span></div>
        {canManage && <div><button type="button" class="is-primary" onClick={() => setAddVersion(true)}>New Draft Version</button></div>}
      </div>
      <div class="wcal-panel">
        <h3>Versions</h3>
        {!versions.length ? <div class="wcal-state">No versions yet. Create a draft pattern linked to a published holiday set, then publish.</div> : (
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>Effective</th><th>Working Days</th><th>Checksum</th>{canManage && <th aria-label="Actions" />}</tr></thead>
            <tbody>{versions.map(v => (
              <tr key={v.id}>
                <td>v{v.versionNo}</td><td><HrfinPill tone={statusTone(v.status)}>{title(v.status)}</HrfinPill></td>
                <td>{range(v.effectiveFrom, v.effectiveTo)}</td>
                <td class="wcal-mono">{patternSummary(v.workingWeekdays)}{Object.keys(v.weekdayFractions).length ? ' ·½' : ''}</td>
                <td class="wcal-mono">{shortSum(v.checksum)}</td>
                {canManage && <td class="wcal-row-actions">
                  {v.status === 'draft' ? <>
                    <button type="button" onClick={() => setEditVersion(v)}>Edit Pattern</button>
                    <button type="button" class="is-primary" disabled={publish.isPending} onClick={() => void doPublish(v)}>Publish</button>
                  </> : <button type="button" disabled={copy.isPending} onClick={() => void doCopy(v)}>Copy To Draft</button>}
                </td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {addVersion && <WorkVersionModal calendarId={calendarId} onClose={() => setAddVersion(false)} onSaved={() => { setAddVersion(false); void q.refetch(); }} />}
      {editVersion && <PatternEditorModal version={editVersion} onClose={() => setEditVersion(null)} onSaved={() => { setEditVersion(null); void q.refetch(); }} />}
    </div>
  );
}

// Weekday toggles (no preselection) + optional partial-day fractions + published-holiday picker.
export function PatternFields({ state, setState, showHolidayPicker }: { state: PatternFormState; setState: (u: (p: PatternFormState) => PatternFormState) => void; showHolidayPicker: boolean }): VNode {
  const errors = patternFieldErrors(state, { requireHoliday: showHolidayPicker });
  const toggle = (iso: number): void => setState(p => {
    const on = p.weekdays.includes(iso);
    const weekdays = on ? p.weekdays.filter(d => d !== iso) : sortedWeekdays([...p.weekdays, iso]);
    const fractions = { ...p.fractions };
    if (on) delete fractions[String(iso)];
    return { ...p, weekdays, fractions };
  });
  return (
    <>
      <fieldset class="wcal-weekdays">
        <legend>Working Weekdays</legend>
        <div role="group" aria-label="Working weekdays">
          {ISO_WEEKDAYS.map(iso => (
            <button key={iso} type="button" role="checkbox" aria-checked={state.weekdays.includes(iso)} aria-label={WEEKDAY_FULL[iso]}
              class={state.weekdays.includes(iso) ? 'on' : ''} onClick={() => toggle(iso)}>{WEEKDAY_LABEL[iso]}</button>
          ))}
        </div>
        {errors.weekdays && <small class="wcal-err">{errors.weekdays}</small>}
      </fieldset>
      {state.weekdays.length > 0 && (
        <div class="wcal-fractions">
          <span class="wcal-sub">Partial days (optional — blank = full day)</span>
          <div class="wcal-grid2">
            {sortedWeekdays(state.weekdays).map(iso => (
              <label key={iso}>{WEEKDAY_FULL[iso]}
                <input type="number" step="0.05" min="0" max="1" placeholder="1" value={state.fractions[String(iso)] ?? ''}
                  onInput={e => setState(p => ({ ...p, fractions: { ...p.fractions, [String(iso)]: e.currentTarget.value } }))} />
              </label>
            ))}
          </div>
          {errors.fractions && <small class="wcal-err">{errors.fractions}</small>}
        </div>
      )}
      {showHolidayPicker && (
        <div>
          <PublishedHolidayVersionPicker value={state.holidayCalendarVersionId} onChange={id => setState(p => ({ ...p, holidayCalendarVersionId: id }))} />
          {errors.holiday && <small class="wcal-err">{errors.holiday}</small>}
        </div>
      )}
    </>
  );
}

// Create a new work calendar (no calendarId) OR add a draft version to an existing one.
function WorkVersionModal({ calendarId, onClose, onSaved }: { calendarId?: string; onClose: () => void; onSaved: (calendarId: string) => void }): VNode {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState('');
  const [pattern, setPattern] = useState<PatternFormState>(emptyPatternForm);
  const [err, setErr] = useState<string | null>(null);
  const mut = useWorkCalendarMutation(workCalendarsApi.workCalendarCommand);
  const isNew = !calendarId;
  const nameErr = isNew && name.trim().length < 2 ? 'Name must be at least 2 characters.' : null;
  const effErr = effectiveError(from, to);
  const valid = !nameErr && !effErr && patternFormValid(pattern, { requireHoliday: true });

  const save = async (): Promise<void> => {
    if (!valid) return;
    setErr(null);
    try {
      const res = await mut.mutateAsync({
        command: 'create_version', requestKey: requestKey(), reason: isNew ? `Created work calendar ${name.trim()}` : 'Added work calendar version',
        ...(calendarId ? { calendarId } : { calendar: { name: name.trim() } }),
        effectiveFrom: from, ...(to ? { effectiveTo: to } : {}), timezone: DEFAULT_TZ,
        holidayCalendarVersionId: pattern.holidayCalendarVersionId,
        workingWeekdays: sortedWeekdays(pattern.weekdays), weekdayFractions: buildWeekdayFractions(pattern),
      });
      toast(isNew ? 'Work calendar created.' : 'Draft version created.'); onSaved(res.calendar.id);
    } catch (e) { setErr(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <HrfinWizardModal open title={isNew ? 'New Work Calendar' : 'New Draft Version'} stepCount={1} activeStep={0}
      onClose={onClose} primaryLabel="Create Draft" primaryDisabled={!valid} primaryLoading={mut.isPending} onPrimary={() => void save()}>
      <div class="wcal-form">
        {err && <div class="wcal-banner is-error" role="alert">{err}</div>}
        {isNew && <label>Name<input maxLength={120} placeholder="Local Office — 5-Day Week" value={name} onInput={e => setName(e.currentTarget.value)} />{nameErr && <small class="wcal-err">{nameErr}</small>}</label>}
        <div class="wcal-grid2">
          <label>Effective From<input type="date" value={from} onInput={e => setFrom(e.currentTarget.value)} /></label>
          <label>Effective To (Optional)<input type="date" min={from} value={to} onInput={e => setTo(e.currentTarget.value)} /></label>
        </div>
        {effErr && <small class="wcal-err">{effErr}</small>}
        <PatternFields state={pattern} setState={setPattern} showHolidayPicker />
        <div class="wcal-note">Timezone {DEFAULT_TZ}. No weekdays are selected by default — choose the working days explicitly.</div>
      </div>
    </HrfinWizardModal>
  );
}

export function PatternEditorModal({ version, onClose, onSaved }: { version: WorkVersionDto; onClose: () => void; onSaved: () => void }): VNode {
  const [pattern, setPattern] = useState<PatternFormState>(() => ({
    weekdays: sortedWeekdays(version.workingWeekdays),
    fractions: Object.fromEntries(Object.entries(version.weekdayFractions).map(([k, v]) => [k, String(v)])),
    holidayCalendarVersionId: version.holidayCalendarVersionId,
  }));
  const [err, setErr] = useState<string | null>(null);
  const mut = useWorkCalendarMutation(workCalendarsApi.workCalendarCommand);
  const valid = patternFormValid(pattern, { requireHoliday: true });

  const save = async (): Promise<void> => {
    if (!valid) return;
    setErr(null);
    try {
      await mut.mutateAsync({
        command: 'set_pattern', requestKey: requestKey(), reason: `Updated pattern for v${version.versionNo}`, versionId: version.id, expectedLockVersion: version.lockVersion,
        workingWeekdays: sortedWeekdays(pattern.weekdays), weekdayFractions: buildWeekdayFractions(pattern), holidayCalendarVersionId: pattern.holidayCalendarVersionId,
      });
      toast('Pattern updated.'); onSaved();
    } catch (e) { setErr(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <HrfinWizardModal open title={`Edit Pattern · v${version.versionNo}`} stepCount={1} activeStep={0}
      onClose={onClose} primaryLabel="Save Pattern" primaryDisabled={!valid} primaryLoading={mut.isPending} onPrimary={() => void save()}>
      <div class="wcal-form">
        {err && <div class="wcal-banner is-error" role="alert">{err}</div>}
        <PatternFields state={pattern} setState={setPattern} showHolidayPicker />
      </div>
    </HrfinWizardModal>
  );
}

// ── Published-version pickers (names/version/effective range, never raw IDs) ──────
export function PublishedHolidayVersionPicker({ value, onChange, initialCalendarId }: { value: string; onChange: (id: string) => void; initialCalendarId?: string }): VNode {
  const [calId, setCalId] = useState(initialCalendarId ?? '');
  const cals = useHolidayCalendars({ limit: 50 });
  const detail = useHolidayCalendar(calId || null);
  const published = (detail.data?.versions ?? []).filter(v => v.status === 'published');
  return (
    <div class="wcal-picker">
      <label>Holiday Set
        <select aria-label="Holiday set" value={calId} onChange={e => { setCalId(e.currentTarget.value); onChange(''); }}>
          <option value="">Select a holiday set…</option>
          {(cals.data?.items ?? []).map(c => <option key={c.id} value={c.id}>{c.name} ({c.jurisdiction})</option>)}
        </select>
      </label>
      {calId && (
        <label>Published Version
          <select aria-label="Published holiday version" value={value} onChange={e => onChange(e.currentTarget.value)} disabled={!published.length}>
            <option value="">{detail.isLoading ? 'Loading versions…' : published.length ? 'Select a published version…' : 'No published version — publish one first'}</option>
            {published.map(v => <option key={v.id} value={v.id}>v{v.versionNo} · {range(v.effectiveFrom, v.effectiveTo)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function PublishedWorkVersionPicker({ value, onChange }: { value: string; onChange: (id: string, meta?: { window: VersionWindow }) => void }): VNode {
  const [calId, setCalId] = useState('');
  const cals = useWorkCalendars({ limit: 50 });
  const detail = useWorkCalendar(calId || null);
  const published = (detail.data?.versions ?? []).filter(v => v.status === 'published');
  return (
    <div class="wcal-picker">
      <label>Work Calendar
        <select aria-label="Work calendar" value={calId} onChange={e => { setCalId(e.currentTarget.value); onChange(''); }}>
          <option value="">Select a work calendar…</option>
          {(cals.data?.items ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {calId && (
        <label>Published Version
          <select aria-label="Published work version" value={value} onChange={e => {
            const v = published.find(x => x.id === e.currentTarget.value);
            onChange(e.currentTarget.value, v ? { window: { from: v.effectiveFrom, to: v.effectiveTo } } : undefined);
          }} disabled={!published.length}>
            <option value="">{detail.isLoading ? 'Loading versions…' : published.length ? 'Select a published version…' : 'No published version — publish one first'}</option>
            {published.map(v => <option key={v.id} value={v.id}>v{v.versionNo} · {range(v.effectiveFrom, v.effectiveTo)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════════════════════
export function AssignmentsPanel(): VNode {
  const q = useAssignments();
  const groups = usePayGroups();
  const [assigning, setAssigning] = useState(false);
  const canManage = can('hr.work_calendar.manage');
  const end = useWorkCalendarMutation(workCalendarsApi.assignmentCommand);
  const cancel = useWorkCalendarMutation(workCalendarsApi.assignmentCommand);
  const groupName = useMemo(() => {
    const m = new Map((groups.data ?? []).map(g => [g.id, `${g.code} — ${g.name}`]));
    return (id: string | null): string => (id ? m.get(id) ?? id : 'Organization (default)');
  }, [groups.data]);

  const doEnd = async (id: string, effFrom: string): Promise<void> => {
    const value = effFrom > today() ? effFrom : today();
    const effectiveTo = await dialog.prompt({ title: 'End Assignment', text: 'Final effective date (YYYY-MM-DD). The assignment stays in history for past periods.', value, placeholder: 'YYYY-MM-DD', confirmText: 'End' });
    if (effectiveTo === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo) || effectiveTo < effFrom) { void dialog.error('Enter a valid date on or after the assignment start.'); return; }
    try { await end.mutateAsync({ command: 'end_assignment', requestKey: requestKey(), reason: 'Ended assignment', assignmentId: id, effectiveTo }); toast('Assignment ended.'); void q.refetch(); }
    catch (e) { void dialog.error(friendlyError(e instanceof Error ? e.message : null)); }
  };
  const doCancel = async (id: string): Promise<void> => {
    const ok = await dialog.confirm({ title: 'Cancel assignment?', text: 'Voids this assignment historically — it will never resolve for any period. Use End instead to retain past participation.', confirmText: 'Cancel Assignment', icon: 'warning' });
    if (!ok) return;
    try { await cancel.mutateAsync({ command: 'cancel_assignment', requestKey: requestKey(), reason: 'Cancelled assignment', assignmentId: id }); toast('Assignment cancelled.'); void q.refetch(); }
    catch (e) { void dialog.error(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <>
      <div class="wcal-toolbar">
        <span class="wcal-sub">Effective-dated work-calendar assignments. Pay-group overrides take precedence over the organization default; there is one active organization default at a time.</span>
        <div>
          <button type="button" onClick={() => q.refetch()}>Refresh</button>
          {canManage && <button type="button" class="is-primary" onClick={() => setAssigning(true)}>New Assignment</button>}
        </div>
      </div>
      <div class="wcal-register" aria-busy={q.isLoading && !q.data}>
        {q.isLoading && !q.data ? <div class="wcal-skel">{[0, 1, 2].map(i => <div key={i} class="wcal-skel-row" />)}</div>
          : q.isError ? <div class="wcal-state is-error">Assignments could not be loaded. <button type="button" onClick={() => q.refetch()}>Retry</button></div>
          : !q.data?.items.length ? <div class="wcal-state">No assignments yet.</div>
          : (
            <table>
              <thead><tr><th>Scope</th><th>Pay Group</th><th>Effective</th><th>Status</th>{canManage && <th aria-label="Actions" />}</tr></thead>
              <tbody>{q.data.items.map(a => (
                <tr key={a.id}>
                  <td>{title(a.scope)}</td>
                  <td>{a.scope === 'organization' ? 'Organization (default)' : (a.payGroupName ? `${a.payGroupCode ?? ''} ${a.payGroupName}`.trim() : groupName(a.payGroupId))}</td>
                  <td>{range(a.effectiveFrom, a.effectiveTo)}</td>
                  <td><HrfinPill tone={statusTone(a.status)}>{title(a.status)}</HrfinPill></td>
                  {canManage && <td class="wcal-row-actions">
                    {a.status === 'active' && <>
                      <button type="button" disabled={end.isPending} onClick={() => void doEnd(a.id, a.effectiveFrom)}>End</button>
                      <button type="button" class="is-danger" disabled={cancel.isPending} onClick={() => void doCancel(a.id)}>Cancel</button>
                    </>}
                  </td>}
                </tr>
              ))}</tbody>
            </table>
          )}
      </div>
      {assigning && <AssignModal onClose={() => setAssigning(false)} onSaved={() => { setAssigning(false); void q.refetch(); }} />}
    </>
  );
}

export function AssignModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): VNode {
  const [scope, setScope] = useState<AssignmentScope>('pay_group');
  const [payGroupId, setPayGroupId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [window, setWindow] = useState<VersionWindow | null>(null);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const groups = usePayGroups();
  const mut = useWorkCalendarMutation(workCalendarsApi.assignmentCommand);

  const scopeErr = scope === 'pay_group' && !payGroupId ? 'Select a pay group.' : null;
  const versionErr = !versionId ? 'Select a published work-calendar version.' : null;
  const effErr = effectiveError(from, to);
  const windowErr = assignmentWindowError(from, to, window);
  const valid = !scopeErr && !versionErr && !effErr && !windowErr;

  const save = async (): Promise<void> => {
    if (!valid) return;
    setErr(null);
    try {
      await mut.mutateAsync({
        command: 'assign', requestKey: requestKey(), reason: `Assigned work calendar (${scope})`, scope,
        ...(scope === 'pay_group' ? { payGroupId } : {}), workCalendarVersionId: versionId, effectiveFrom: from, ...(to ? { effectiveTo: to } : {}),
      });
      toast('Work calendar assigned.'); onSaved();
    } catch (e) { setErr(friendlyError(e instanceof Error ? e.message : null)); }
  };

  return (
    <HrfinWizardModal open title="New Assignment" stepCount={1} activeStep={0}
      onClose={onClose} primaryLabel="Assign" primaryDisabled={!valid} primaryLoading={mut.isPending} onPrimary={() => void save()}>
      <div class="wcal-form">
        {err && <div class="wcal-banner is-error" role="alert">{err}</div>}
        <div class="wcal-grid2">
          <label>Scope<select aria-label="Scope" value={scope} onChange={e => { setScope(e.currentTarget.value as AssignmentScope); setPayGroupId(''); }}>
            <option value="pay_group">Pay Group Override</option><option value="organization">Organization Default</option>
          </select></label>
          {scope === 'pay_group' && <label>Pay Group<select aria-label="Pay group" value={payGroupId} onChange={e => setPayGroupId(e.currentTarget.value)}>
            <option value="">Select a pay group…</option>
            {(groups.data ?? []).map(g => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
          </select>{scopeErr && <small class="wcal-err">{scopeErr}</small>}</label>}
        </div>
        <PublishedWorkVersionPicker value={versionId} onChange={(id, meta) => { setVersionId(id); setWindow(meta?.window ?? null); }} />
        {versionErr && <small class="wcal-err">{versionErr}</small>}
        <div class="wcal-grid2">
          <label>Effective From<input type="date" value={from} onInput={e => setFrom(e.currentTarget.value)} /></label>
          <label>Effective To (Optional)<input type="date" min={from} value={to} onInput={e => setTo(e.currentTarget.value)} /></label>
        </div>
        {effErr && <small class="wcal-err">{effErr}</small>}
        {windowErr && <small class="wcal-err">{windowErr}</small>}
        {window && <div class="wcal-note">Selected version covers {range(window.from, window.to)}. The assignment window must fall inside it.</div>}
      </div>
    </HrfinWizardModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESOLVE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════════
export function ResolvePanel(): VNode {
  const groups = usePayGroups();
  const [payGroupId, setPayGroupId] = useState('');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [result, setResult] = useState<ResolvePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const periodErr = periodError(start, end);
  const valid = !!payGroupId && !periodErr;

  const run = async (): Promise<void> => {
    if (!valid) return;
    setErr(null); setResult(null); setPending(true);
    try { setResult(await workCalendarsApi.resolve(payGroupId, start, end)); }
    catch (e) { setErr(friendlyError(e instanceof Error ? e.message : null)); }
    finally { setPending(false); }
  };

  return (
    <div class="wcal-resolve">
      <div class="wcal-panel">
        <h3>Resolve A Payroll Period</h3>
        <div class="wcal-grid3">
          <label>Pay Group<select aria-label="Pay group" value={payGroupId} onChange={e => { setPayGroupId(e.currentTarget.value); setResult(null); setErr(null); }}>
            <option value="">Select a pay group…</option>
            {(groups.data ?? []).map(g => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
          </select></label>
          <label>Period Start<input type="date" value={start} onInput={e => { setStart(e.currentTarget.value); setResult(null); }} /></label>
          <label>Period End<input type="date" min={start} value={end} onInput={e => { setEnd(e.currentTarget.value); setResult(null); }} /></label>
        </div>
        {periodErr && payGroupId && <small class="wcal-err">{periodErr}</small>}
        <div class="wcal-inline-actions"><button type="button" class="is-primary" disabled={!valid || pending} onClick={() => void run()}>{pending ? 'Resolving…' : 'Resolve'}</button></div>
        {err && <div class="wcal-banner is-error" role="alert">{err}</div>}
      </div>
      {result && <ResolveResultView result={result} />}
    </div>
  );
}

// Presentational resolution card: path, resolved names, checksums and working-day evidence
// (contract §9.4 — never a raw UUID; UT-CAL-U6). Kept prop-driven so it renders without a live call.
export function ResolveResultView({ result }: { result: ResolvePreview }): VNode {
  return (
    <div class="wcal-panel" aria-live="polite">
      <h3>Resolution</h3>
      <div class="wcal-resolve-grid">
        <div><span>Path</span><strong>{title(result.resolutionPath.scope)}</strong></div>
        <div><span>Pay Group</span><strong>{result.payGroup.code ? `${result.payGroup.code} — ${result.payGroup.name ?? ''}` : (result.payGroup.name ?? '—')}</strong></div>
        <div><span>Work Calendar</span><strong>{result.workCalendar.name} · v{result.workCalendar.versionNo ?? '—'}</strong><small>{patternSummary(result.workCalendar.workingWeekdays)} · {range(result.workCalendar.effectiveFrom, result.workCalendar.effectiveTo)}</small></div>
        <div><span>Holiday Set</span><strong>{result.holidayCalendar.name} · v{result.holidayCalendar.versionNo ?? '—'}</strong><small>{result.holidayCalendar.jurisdiction} · {range(result.holidayCalendar.effectiveFrom, result.holidayCalendar.effectiveTo)}</small></div>
        <div><span>Work Checksum</span><strong class="wcal-mono">{shortSum(result.workCalendarChecksum)}</strong></div>
        <div><span>Holiday Checksum</span><strong class="wcal-mono">{shortSum(result.holidayCalendarChecksum)}</strong></div>
      </div>
      <div class="wcal-workingdays">
        <div class="wcal-wd-count"><span>Working Days In Period</span><strong>{result.workingDays.count}</strong></div>
        {result.workingDays.excluded.length > 0 && (
          <table>
            <thead><tr><th>Excluded Date</th><th>Reason</th><th>Lost Fraction</th><th>Holiday</th></tr></thead>
            <tbody>{result.workingDays.excluded.map((x, i) => (
              <tr key={`${x.date}-${x.reason}-${i}`}><td>{x.date}</td><td>{title(x.reason)}</td><td>{x.lostFraction}</td><td>{x.holidayName ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
