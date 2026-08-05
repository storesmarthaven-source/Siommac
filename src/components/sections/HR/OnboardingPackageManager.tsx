/**
 * src/components/sections/HR/OnboardingPackageManager.tsx
 *
 * HR ▸ Onboarding ▸ Packages — plain admin list (no widget board; this is
 * configuration, not a dashboard). Search + status filter + New Package, a table
 * of packages with a quick Activate/Retire toggle, row click drills into
 * OnboardingPackageDetail (task/handoff templates + custom actions).
 * Gated by hr.onboarding.packages.manage (oversight-tier — see the migration
 * comment in 20260714000014_hr_onboarding_packages_manage_perm.sql).
 */
import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { PageHeader, Modal, Field, FormGrid, TextInput, TextareaInput } from '@ui';
import { useOnboardingPackages, useOnboardingCreatePackage } from '@api/hr/onboarding';
import './onboardingCase.css';
import './OnboardingPackageManagement.mockup.css';
import './OnboardingPackageManagement.page.css';

const STATUS_FILTERS = ['all', 'draft', 'active', 'retired'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function humanizeStatus(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export function OnboardingPackageManager({
  onBack, onOpenPackage, onOpenEmailTemplates, onToast,
}: { onBack: () => void; onOpenPackage: (key: string) => void; onOpenEmailTemplates: () => void; onToast: (m: string) => void }): VNode {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [workerType, setWorkerType] = useState('all');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', description: '', workerTypes: '', defaultSlaDays: '10', defaultOwnerRole: '' });

  const pkgsQ = useOnboardingPackages(true);
  const createMut = useOnboardingCreatePackage();

  const workerTypes = useMemo(
    () => Array.from(new Set((pkgsQ.data ?? []).flatMap(p => p.workerTypes))).sort(),
    [pkgsQ.data],
  );
  const filteredRows = useMemo(() => {
    const all = pkgsQ.data ?? [];
    const q = query.trim().toLowerCase();
    return all.filter(p =>
      (status === 'all' || p.status === status) &&
      (workerType === 'all' || p.workerTypes.includes(workerType)) &&
      (!q || p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)));
  }, [pkgsQ.data, query, status, workerType]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / 4));
  const currentPage = Math.min(page, pageCount);
  const rows = filteredRows.slice((currentPage - 1) * 4, currentPage * 4);
  useEffect(() => { setPage(1); }, [query, status, workerType]);
  useEffect(() => {
    if (!rows.length) { setSelectedKey(null); return; }
    if (!selectedKey || !rows.some(row => row.key === selectedKey)) setSelectedKey(rows[0]!.key);
  }, [rows, selectedKey]);
  const selected = rows.find(row => row.key === selectedKey) ?? null;

  function openNew(): void {
    setForm({ label: '', description: '', workerTypes: '', defaultSlaDays: '10', defaultOwnerRole: '' });
    setModalOpen(true);
  }

  async function submitNew(): Promise<void> {
    if (!form.label.trim()) { onToast('Package label is required'); return; }
    try {
      const r = await createMut.mutateAsync({
        label: form.label.trim(), description: form.description.trim() || null,
        workerTypes: form.workerTypes.split(',').map(s => s.trim()).filter(Boolean),
        defaultSlaDays: Number(form.defaultSlaDays) || undefined, defaultOwnerRole: form.defaultOwnerRole.trim() || null,
      });
      setModalOpen(false);
      onToast('Package created');
      onOpenPackage(r.key);
    } catch (e) { onToast(e instanceof Error ? e.message : 'Failed to create package'); }
  }

  return (
    <div class="hr-onboarding-packages opm-root">
      <button class="obx-back" onClick={onBack}>← Onboarding</button>

      <PageHeader
        icon="fa-boxes-stacked"
        module="HR · Onboarding"
        title="Packages"
        sub="Configure onboarding packages, task and handoff templates, and governed requirements."
        actions={<div class="obx-actions">
          <button class="obx-btn" onClick={onOpenEmailTemplates}><i class="fas fa-envelope-open-text" /> Email Studio</button>
          <button class="obx-btn primary" onClick={openNew}>+ New Package</button>
        </div>}
      />

      <div class="package-page-grid">
        <div class="package-main-stack">
          <section class="card package-rail" aria-label="Onboarding package register">
            <div class="rail-head">
              <div><h2>Package Register</h2><p>Choose a package to review its audience, work plan and worker experience.</p></div>
              <div class="catalog-tools">
                <label class="search"><i class="fas fa-search" aria-hidden="true" /><input placeholder="Search packages" value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} /></label>
                <select class="control" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value as StatusFilter)}>
                  {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : humanizeStatus(s)}</option>)}
                </select>
                <select class="control" aria-label="Worker type" value={workerType} onChange={e => setWorkerType((e.target as HTMLSelectElement).value)}>
                  <option value="all">All worker types</option>
                  {workerTypes.map(type => <option key={type} value={type}>{humanizeStatus(type)}</option>)}
                </select>
              </div>
            </div>
            {pkgsQ.isLoading && !pkgsQ.data ? <div class="obx-empty">Loading packages…</div> : !rows.length ? <div class="obx-empty">No packages match these filters.</div> : (
              <div class="package-list">
                {rows.map(p => (
                  <button class={`package-item ${selectedKey === p.key ? 'active' : ''}`} type="button" key={p.key} data-status={p.status} onClick={() => setSelectedKey(p.key)}>
                    <div class="package-item-top">
                      <span class="package-icon"><i class="fas fa-box-open" aria-hidden="true" /></span>
                      <div class="title-line"><strong>{p.label}</strong><span class={`pill ${p.status}`}>{humanizeStatus(p.status)}</span></div>
                    </div>
                    <p>{p.description ?? 'Reusable onboarding work plan.'}</p>
                    <div class="package-meta"><span>v{p.versionNo} · {p.defaultSlaDays} day lead</span><span>{p.taskCount} tasks · {p.handoffCount} handoffs</span></div>
                  </button>
                ))}
              </div>
            )}
            <footer class="rail-foot package-register-footer">
              <span>{filteredRows.length ? `${(currentPage - 1) * 4 + 1}–${Math.min(currentPage * 4, filteredRows.length)} of ${filteredRows.length}` : 'No packages'}</span>
              <span class="package-register-pager" aria-label="Package register pages">
                <button class="btn" type="button" aria-label="Previous package page" disabled={currentPage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}><i class="fas fa-chevron-left" aria-hidden="true" /></button>
                <strong>Page {currentPage} of {pageCount}</strong>
                <button class="btn" type="button" aria-label="Next package page" disabled={currentPage === pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}><i class="fas fa-chevron-right" aria-hidden="true" /></button>
              </span>
            </footer>
          </section>
        </div>

        <aside class="package-context-rail" aria-label="Selected package context">
          <section class="rail-widget">
            <div class="rail-widget-head"><i class="fas fa-heart-pulse" aria-hidden="true" /><div><h3>Package Health</h3><p>{selected ? selected.label : 'No package selected'}</p></div></div>
            {selected ? <div class="health-score"><span class="health-check"><i class="fas fa-check" /></span><div class="health-copy"><strong>{selected.status === 'active' ? 'Ready for selection' : humanizeStatus(selected.status)}</strong><span>{selected.taskCount} tasks and {selected.handoffCount} handoffs configured.</span></div></div> : null}
          </section>
          {selected ? (
            <section class="rail-widget">
              <div class="rail-widget-head"><i class="fas fa-sliders" aria-hidden="true" /><div><h3>Operating Defaults</h3><p>Applied to future cases</p></div></div>
              <div class="rail-facts">
                <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-calendar-day" /></span><div><span>Lead Time</span><strong>{selected.defaultSlaDays} days</strong></div></div>
                <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-user-shield" /></span><div><span>Owner Queue</span><strong>{selected.defaultOwnerRole ?? 'HR Operations'}</strong></div></div>
                <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-users" /></span><div><span>Worker Types</span><strong>{selected.workerTypes.length ? selected.workerTypes.map(humanizeStatus).join(', ') : 'Employees'}</strong></div></div>
              </div>
            </section>
          ) : null}
          {selected ? <button class="btn primary" type="button" onClick={() => onOpenPackage(selected.key)}>Open Package Workspace</button> : null}
        </aside>
      </div>

      <Modal
        open={modalOpen} title="New Package" icon="fa-boxes-stacked" onClose={() => setModalOpen(false)}
        onSubmit={() => void submitNew()} submitLabel="Create Package" submitDisabled={createMut.isPending}
      >
        <FormGrid>
          <Field label="Label" wide><TextInput value={form.label} onInput={v => setForm(f => ({ ...f, label: v }))} placeholder="e.g. Standard New Hire" /></Field>
          <Field label="Description" wide><TextareaInput value={form.description} onInput={v => setForm(f => ({ ...f, description: v }))} placeholder="What this package is for" rows={2} /></Field>
          <Field label="Default SLA (days)"><TextInput type="number" value={form.defaultSlaDays} onInput={v => setForm(f => ({ ...f, defaultSlaDays: v }))} /></Field>
          <Field label="Default owner role"><TextInput value={form.defaultOwnerRole} onInput={v => setForm(f => ({ ...f, defaultOwnerRole: v }))} placeholder="e.g. hr" /></Field>
          <Field label="Worker types" wide><TextInput value={form.workerTypes} onInput={v => setForm(f => ({ ...f, workerTypes: v }))} placeholder="e.g. full_time, contractor" /></Field>
        </FormGrid>
      </Modal>
    </div>
  );
}
