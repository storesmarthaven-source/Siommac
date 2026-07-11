/**
 * src/components/sections/Finance/StatutoryFormsOverview.tsx
 *
 * Finance ▸ Payroll ▸ Statutory Forms (Wave 7).
 * Tabs: Generate (TD4 year-end) · Employer Profile · Generated Forms.
 * TD4/TD4 Summary generate from LOCKED payroll runs; NI184/NI187 land in 7b.
 */
import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import {
  HrfinPageHeader, HrfinTable, HrfinPill, HrfinIcon,
  type HrfinColumn, type HrfinTone,
} from '@ui';
import {
  useEmployerProfile, useStatutoryForms, useStatutoryFormMutation,
  financeStatutoryFormsApi,
  type EmployerProfile, type StatutoryForm, type StatutoryFormType,
} from '@api/finance/statutoryForms';
import { EmployeePicker } from './_shared/pickers';
import { EmployeeCell } from './_shared/EmployeeCell';
import { money } from './hrfinFormat';

const CURRENT_YEAR = new Date().getFullYear();
const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const FORM_LABEL: Record<StatutoryFormType, string> = {
  td4: 'TD4', td4_summary: 'TD4 Summary', ni184: 'NI184', ni187: 'NI187',
};

type Tab = 'generate' | 'profile' | 'forms';
const TABS: { key: Tab; label: string }[] = [
  { key: 'generate', label: 'Generate' },
  { key: 'profile',  label: 'Employer Profile' },
  { key: 'forms',    label: 'Generated Forms' },
];

// ── Employer Profile tab ────────────────────────────────────────────────────────

const PROFILE_FIELDS: { key: keyof EmployerProfile; label: string; required?: boolean; placeholder?: string }[] = [
  { key: 'legalName',         label: 'Legal name',            required: true,  placeholder: 'e.g. Acme Security Services Ltd' },
  { key: 'tradingName',       label: 'Trading name',          placeholder: 'if different from legal name' },
  { key: 'birFileNumber',     label: 'BIR employer file no.', required: true,  placeholder: 'appears on TD4' },
  { key: 'nisEmployerNumber', label: 'NIBTT employer no.',    required: true,  placeholder: 'appears on NI184/NI187' },
  { key: 'addressLine1',      label: 'Address line 1' },
  { key: 'addressLine2',      label: 'Address line 2' },
  { key: 'city',              label: 'City / Town' },
  { key: 'country',           label: 'Country' },
  { key: 'phone',             label: 'Phone' },
  { key: 'email',             label: 'Email' },
];

function EmployerProfileTab({ canManage }: { canManage: boolean }): VNode {
  const q = useEmployerProfile();
  const saveMut = useStatutoryFormMutation(financeStatutoryFormsApi.employerProfileUpdate);
  const [form, setForm] = useState<Partial<EmployerProfile> | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const model = form ?? q.data ?? null;
  const set = (k: keyof EmployerProfile, v: string) => setForm(f => ({ ...(f ?? q.data ?? {}), [k]: v }));

  async function save(): Promise<void> {
    const e: Record<string, string> = {};
    for (const f of PROFILE_FIELDS) if (f.required && !String((model as Record<string, unknown>)?.[f.key] ?? '').trim()) e[f.key] = 'Required.';
    setErrs(e);
    if (Object.keys(e).length) return;
    try { await saveMut.mutateAsync(model ?? {}); toast('Employer profile saved.'); setForm(null); }
    catch (err) { toast((err as Error).message ?? 'Failed.'); }
  }

  if (q.isLoading) return <div class="hrfin-empty">Loading employer profile…</div>;

  return (
    <div style={{ maxWidth: 720 }}>
      <p class="hse-muted" style={{ fontSize: 12, marginBottom: 14 }}>
        The employer statutory identity printed on every TD4, NI184 and NI187. BIR + NIBTT numbers are required before forms can be generated.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {PROFILE_FIELDS.map(f => (
          <label key={f.key} style={f.key === 'legalName' ? { gridColumn: '1 / -1' } : undefined}>
            <span class="hrfin-wiz-label">{f.label}{f.required ? ' *' : ''}</span>
            <input
              class="hrfin-input"
              placeholder={f.placeholder ?? ''}
              disabled={!canManage}
              value={String((model as Record<string, unknown>)?.[f.key] ?? '')}
              onInput={e => { set(f.key, (e.currentTarget as HTMLInputElement).value); setErrs(x => { const n = { ...x }; delete n[f.key]; return n; }); }}
            />
            {errs[f.key] && <span style={{ color: 'var(--danger, #d33)', fontSize: 11 }}>{errs[f.key]}</span>}
          </label>
        ))}
      </div>
      {canManage && (
        <div style={{ marginTop: 14 }}>
          <button type="button" class="hrfin-action is-primary" disabled={saveMut.isPending || !form} onClick={() => void save()}>
            {saveMut.isPending ? 'Saving…' : 'Save employer profile'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Generate tab ─────────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function GenerateTab({ canGenerate, profileReady, onGenerated }: { canGenerate: boolean; profileReady: boolean; onGenerated: () => void }): VNode {
  const [year, setYear]       = useState(CURRENT_YEAR - 1);
  const [empId, setEmpId]     = useState<string | null>(null);
  const [niYear, setNiYear]   = useState(CURRENT_YEAR);
  const [niMonth, setNiMonth] = useState(new Date().getMonth() + 1);
  const yearMut = useStatutoryFormMutation(financeStatutoryFormsApi.td4GenerateYear);
  const empMut  = useStatutoryFormMutation(financeStatutoryFormsApi.td4Generate);
  const niMut   = useStatutoryFormMutation(financeStatutoryFormsApi.niGenerate);

  async function genYear(): Promise<void> {
    try { const r = await yearMut.mutateAsync({ taxYear: year }); toast(`Generated ${r.employeeForms} TD4 + summary for ${year}.`); onGenerated(); }
    catch (e) { toast((e as Error).message ?? 'Failed.'); }
  }
  async function genEmp(): Promise<void> {
    if (!empId) return;
    try { await empMut.mutateAsync({ employeeId: empId, taxYear: year }); toast(`Generated TD4 for ${year}.`); onGenerated(); }
    catch (e) { toast((e as Error).message ?? 'Failed.'); }
  }
  async function genNi(): Promise<void> {
    try { await niMut.mutateAsync({ year: niYear, month: niMonth }); toast(`Generated NI184 + NI187 for ${MONTHS[niMonth - 1]} ${niYear}.`); onGenerated(); }
    catch (e) { toast((e as Error).message ?? 'Failed.'); }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {!profileReady && (
        <div class="hrfin-callout is-warning" style={{ marginBottom: 14 }}>
          <HrfinIcon name="alert" />
          <span>Set the employer legal name, BIR file number and NIBTT employer number in <strong>Employer Profile</strong> before generating forms.</span>
        </div>
      )}
      <label style={{ display: 'block', marginBottom: 16, maxWidth: 200 }}>
        <span class="hrfin-wiz-label">Tax year</span>
        <input class="hrfin-input" type="number" min={2000} max={2100} value={year}
          onInput={e => setYear(Number((e.currentTarget as HTMLInputElement).value) || CURRENT_YEAR)} />
      </label>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>Year-end run (all employees)</h3>
        <p class="hse-muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
          Generates a TD4 for every employee with locked-run earnings in {year}, plus the employer TD4 Summary (PDF + CSV). Figures reconcile to the run lines.
        </p>
        <button type="button" class="hrfin-action is-primary" disabled={!canGenerate || !profileReady || yearMut.isPending} onClick={() => void genYear()}>
          {yearMut.isPending ? 'Generating…' : `Generate all TD4 + Summary for ${year}`}
        </button>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Single employee</h3>
        <div style={{ maxWidth: 380, marginBottom: 12 }}>
          <EmployeePicker label="Employee" value={empId} onChange={setEmpId} error={null} />
        </div>
        <button type="button" class="hrfin-action" disabled={!canGenerate || !profileReady || !empId || empMut.isPending} onClick={() => void genEmp()}>
          {empMut.isPending ? 'Generating…' : `Generate TD4 for ${year}`}
        </button>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>NIBTT monthly return (NI184 + NI187)</h3>
        <p class="hse-muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
          Generates the NI184 contributions schedule (PDF + CSV) and the NI187 remittance summary from locked runs in the selected month.
        </p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <label style={{ maxWidth: 160 }}>
            <span class="hrfin-wiz-label">Month</span>
            <select class="hrfin-input" value={niMonth} onChange={e => setNiMonth(Number((e.currentTarget as HTMLSelectElement).value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label style={{ maxWidth: 120 }}>
            <span class="hrfin-wiz-label">Year</span>
            <input class="hrfin-input" type="number" min={2000} max={2100} value={niYear}
              onInput={e => setNiYear(Number((e.currentTarget as HTMLInputElement).value) || CURRENT_YEAR)} />
          </label>
        </div>
        <button type="button" class="hrfin-action is-primary" disabled={!canGenerate || !profileReady || niMut.isPending} onClick={() => void genNi()}>
          {niMut.isPending ? 'Generating…' : `Generate NI184 + NI187 for ${MONTHS[niMonth - 1]} ${niYear}`}
        </button>
      </div>
    </div>
  );
}

// ── Generated Forms tab ──────────────────────────────────────────────────────────

function formTone(t: StatutoryFormType): HrfinTone {
  return t === 'td4_summary' ? 'nu' : t === 'td4' ? 'ok' : 'dr';
}

const PAGE_SIZE = 25;

function FormsTab({ canView }: { canView: boolean }): VNode {
  const [typeFilter, setType] = useState<StatutoryFormType | ''>('');
  const [page, setPage] = useState(0);
  const q = useStatutoryForms(typeFilter ? { formType: typeFilter } : {});
  const dlMut = useStatutoryFormMutation(financeStatutoryFormsApi.signedUrl);
  const allForms = q.data ?? [];
  const forms = allForms.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(allForms.length / PAGE_SIZE));

  async function download(id: string, which: 'pdf' | 'data'): Promise<void> {
    try { const r = await dlMut.mutateAsync({ id, which }); window.open(r.signedUrl, '_blank'); }
    catch (e) { toast((e as Error).message ?? 'Download failed.'); }
  }

  const COLS: HrfinColumn<StatutoryForm>[] = [
    { key: 'type', label: 'Form', render: f => <HrfinPill tone={formTone(f.formType)}>{FORM_LABEL[f.formType]}</HrfinPill> },
    { key: 'year', label: 'Year / Period', render: f => <span style={{ fontSize: 12 }}>{f.taxYear ?? (f.periodStart ? `${fmtDate(f.periodStart)}–${fmtDate(f.periodEnd)}` : '—')}</span> },
    { key: 'emp', label: 'Employee', render: f => f.employeeId ? <EmployeeCell employeeId={f.employeeId} /> : <span class="hse-muted" style={{ fontSize: 12 }}>Employer-level</span> },
    { key: 'totals', label: 'Emoluments', render: f => <span style={{ fontSize: 12 }}>{typeof f.totals?.totalEmoluments === 'number' ? money(f.totals.totalEmoluments as number) : '—'}</span> },
    { key: 'created', label: 'Generated', render: f => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(f.createdAt)}</span> },
  ];

  return (
    <HrfinTable
      filters={[
        { label: 'All', onClick: () => { setType(''); setPage(0); } },
        { label: 'TD4', onClick: () => { setType('td4'); setPage(0); } },
        { label: 'TD4 Summary', onClick: () => { setType('td4_summary'); setPage(0); } },
        { label: 'NI184', onClick: () => { setType('ni184'); setPage(0); } },
        { label: 'NI187', onClick: () => { setType('ni187'); setPage(0); } },
      ]}
      columns={COLS}
      rows={forms}
      rowKey={f => f.id}
      rowActions={f => [
        { key: 'pdf', label: 'Download PDF', icon: 'download' as const, disabled: !canView, onClick: () => void download(f.id, 'pdf') },
        ...(f.dataFilePath ? [{ key: 'data', label: 'Download data (CSV)', icon: 'download' as const, disabled: !canView, onClick: () => void download(f.id, 'data') }] : []),
      ]}
      page={page}
      pageCount={pageCount}
      total={allForms.length}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      noun="statutory forms"
      loading={q.isLoading}
      emptyMessage="No statutory forms generated yet. Use the Generate tab to produce year-end TD4 forms."
    />
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────

export function StatutoryFormsOverview(): VNode {
  const [tab, setTab] = useState<Tab>('generate');
  const canGenerate = can('finance.payroll.statutory_forms.generate');
  const canView     = can('finance.payroll.statutory_forms.view');
  const profileQ = useEmployerProfile();
  const profileReady = useMemo(() => {
    const p = profileQ.data;
    return !!(p?.legalName?.trim() && p?.birFileNumber?.trim() && p?.nisEmployerNumber?.trim());
  }, [profileQ.data]);

  return (
    <div class="hrfin">
      <HrfinPageHeader
        icon="file"
        title="Statutory Forms"
        sub="Year-end BIR TD4 + TD4 Summary and NIBTT NI184/NI187, generated from locked payroll runs."
        chips={profileReady ? [] : [{ icon: 'alert' as const, label: 'Employer profile incomplete', tone: 'danger' as const }]}
      />

      <section class="hrfin-main-section">
        <div class="hrfin-tabs" style={{ marginBottom: 14 }}>
          {TABS.map(t => (
            <button key={t.key} type="button" class={t.key === tab ? 'is-active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === 'generate' && <GenerateTab canGenerate={canGenerate} profileReady={profileReady} onGenerated={() => setTab('forms')} />}
        {tab === 'profile'  && <EmployerProfileTab canManage={canGenerate} />}
        {tab === 'forms'    && <FormsTab canView={canView} />}
      </section>
    </div>
  );
}
