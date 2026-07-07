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
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { PageHeader, Modal, Field, FormGrid, TextInput, TextareaInput } from '@ui';
import { useOnboardingPackages, useOnboardingCreatePackage, useOnboardingSetPackageStatus } from '@api/hr/onboarding';
import type { OnboardingPackageSummary } from '../../../../types/hrOnboarding';
import './onboardingCase.css';

const STATUS_FILTERS = ['all', 'draft', 'active', 'retired'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function statusTone(s: string): 'gray' | 'green' {
  return s === 'active' ? 'green' : 'gray';
}

export function OnboardingPackageManager({
  onBack, onOpenPackage, onToast,
}: { onBack: () => void; onOpenPackage: (key: string) => void; onToast: (m: string) => void }): VNode {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ label: '', description: '', workerTypes: '', defaultSlaDays: '10', defaultOwnerRole: '' });

  const pkgsQ = useOnboardingPackages(true);
  const createMut = useOnboardingCreatePackage();
  const statusMut = useOnboardingSetPackageStatus();

  const rows = useMemo(() => {
    const all = pkgsQ.data ?? [];
    const q = query.trim().toLowerCase();
    return all.filter(p =>
      (status === 'all' || p.status === status) &&
      (!q || p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)));
  }, [pkgsQ.data, query, status]);

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

  async function toggleStatus(p: OnboardingPackageSummary): Promise<void> {
    const next = p.status === 'active' ? 'retired' : 'active';
    const verb = next === 'active' ? 'Activate' : 'Retire';
    if (!await dialog.confirm({ title: `${verb} "${p.label}"?` })) return;
    try {
      await statusMut.mutateAsync({ id: p.id, status: next });
      onToast(`Package ${next === 'active' ? 'activated' : 'retired'}`);
    } catch (e) { onToast(e instanceof Error ? e.message : 'Failed to update status'); }
  }

  return (
    <div class="hr-onboarding-packages">
      <button class="obx-back" onClick={onBack}>← Onboarding</button>

      <PageHeader
        icon="fa-boxes-stacked"
        module="HR · Onboarding"
        title="Packages"
        sub="Configure onboarding packages, task &amp; handoff templates, and custom actions."
        meta={[{ icon: 'fa-list-check', label: `${rows.length} packages` }]}
        actions={<button class="obx-btn primary" onClick={openNew}>+ New Package</button>}
      />

      <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
        <input class="ui-input" style={{ flex: 1 }} placeholder="Search packages…" value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} />
        <select class="ui-select" style={{ width: 160 }} value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value as StatusFilter)}>
          {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      <div class="obx-section">
        <div class="obx-section-body">
          {pkgsQ.isLoading && !pkgsQ.data ? <div class="obx-empty">Loading…</div> : !rows.length ? <div class="obx-empty">No packages match these filters.</div> : (
            <table class="obx-table">
              <thead><tr><th>Package</th><th>Status</th><th>Worker types</th><th>Templates</th><th>SLA</th><th>Probation</th><th>Actions</th></tr></thead>
              <tbody>{rows.map(p => (
                <tr key={p.key} style={{ cursor: 'pointer' }} onClick={() => onOpenPackage(p.key)}>
                  <td>
                    <b>{p.label}</b>
                    <div class="obx-meta" style={{ fontSize: 12 }}>{p.key} · v{p.versionNo}</div>
                  </td>
                  <td><span class={`obx-pill ${statusTone(p.status)}`}>{p.status}</span></td>
                  <td class="obx-meta">{p.workerTypes.length ? p.workerTypes.join(', ') : '—'}</td>
                  <td class="obx-meta">{p.taskCount} tasks · {p.handoffCount} handoffs</td>
                  <td class="obx-meta">{p.defaultSlaDays} days</td>
                  <td class="obx-meta">{p.probationDays != null ? `${p.probationDays}d` : '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button class="obx-mini" onClick={() => void toggleStatus(p)}>{p.status === 'active' ? 'Retire' : 'Activate'}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
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
