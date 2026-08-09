import { type ComponentChildren, type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  ActiveFilters, Button, DataTable, EmptyState, FilterDropdown, LucideIcon, Modal, PageHeader,
  StatusPill as Pill, TableSearch, TableSkeleton, useFilterDropdowns, type DtColumn,
} from '@ui';
import { dialog } from '@lib/dialog';
import { applySampleVariables, renderEmailPreview } from '@lib/emailTemplateDocument';
import { useArchiveEmailTemplate, useDuplicateEmailTemplate, useEmailTemplate, useEmailTemplates } from '@api/hr/emailTemplates';
import type { EmailTemplateFamily, EmailTemplateStatus, EmailTemplateSummary } from '../../../../../types/emailTemplates';
import { EmailTemplateBuilder } from './EmailTemplateBuilder';
import { EmailTemplateCreateDialog } from './EmailTemplateCreateDialog';
import './emailTemplateStudio.css';

const FAMILY_FILTERS: EmailTemplateFamily[] = ['onboarding', 'user_invitation', 'worker_invitation'];

/** How the library is laid out: cards, or the register table. */
type LibraryView = 'comfortable' | 'table';
const LIBRARY_VIEWS: { key: LibraryView; icon: string; title: string }[] = [
  { key: 'comfortable', icon: 'fa-table-cells-large', title: 'Card view' },
  { key: 'table', icon: 'fa-list', title: 'Table view' },
];
const FAMILY_LABELS: Record<EmailTemplateFamily, string> = {
  onboarding: 'Onboarding',
  user_invitation: 'User Invitations',
  worker_invitation: 'Worker Invitations',
};
const STATUS_FILTERS: EmailTemplateStatus[] = ['published', 'in_review', 'approved', 'draft', 'archived'];

/** The mockup renders `published` as "Active" and styles every other state as a draft. */
const STATUS_LABELS: Record<EmailTemplateStatus, string> = {
  draft: 'Draft',
  in_review: 'In Review',
  changes_requested: 'Changes Requested',
  approved: 'Approved',
  published: 'Active',
  superseded: 'Superseded',
  archived: 'Archived',
};
/** Status -> the kit's semantic chip tone. */
const STATUS_TONES: Record<EmailTemplateStatus, 'positive' | 'caution' | 'info' | 'neutral'> = {
  published: 'positive',
  approved: 'positive',
  in_review: 'info',
  draft: 'caution',
  changes_requested: 'caution',
  superseded: 'neutral',
  archived: 'neutral',
};
const TemplateStatus = ({ status }: { status: EmailTemplateStatus }): VNode =>
  <Pill tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Pill>;

const APPROVAL_LABELS: Record<string, string> = {
  not_required: 'Not required',
  not_submitted: 'Not submitted',
  pending: 'Pending review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
};

const date = (value: string): string => new Intl.DateTimeFormat('en-TT', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

/**
 * Illustration shown for each template, keyed by trigger so a duplicated or
 * newly created template inherits the right artwork. Files live in
 * assets/images/email-templates/ (960x720 WebP, 4:3 — the card window's aspect,
 * so the artwork is never cropped).
 */
const TRIGGER_IMAGES: Record<string, string> = {
  'onboarding.case_created': 'employee-welcome',
  'onboarding.tasks_pending': 'complete-onboarding-tasks',
  'onboarding.documents_missing': 'missing-documents',
  'onboarding.start_approaching': 'day-one-briefing',
  'onboarding.completed': 'onboarding-complete',
  'identity.invitation_created': 'portal-invitation',
  'identity.invitation_reminder': 'invitation-reminder',
  'identity.invitation_expiring': 'invitation-expiring',
  'identity.invitation_reissued': 'invitation-reissued',
  'worker.invitation_created': 'worker-registration',
  'worker.site_assigned': 'site-assignment',
  'worker.documents_required': 'worker-compliance',
  'worker.invitation_reminder': 'worker-reminder',
};
const FAMILY_FALLBACK_IMAGES: Record<EmailTemplateFamily, string> = {
  onboarding: 'employee-welcome',
  user_invitation: 'portal-invitation',
  worker_invitation: 'worker-registration',
};
const templateImage = (row: EmailTemplateSummary): string =>
  `/assets/images/email-templates/${TRIGGER_IMAGES[row.triggerKey] ?? FAMILY_FALLBACK_IMAGES[row.family]}.webp`;

const Icon = ({ path, viewBox = '0 0 24 24' }: { path: VNode | VNode[]; viewBox?: string }): VNode =>
  <svg viewBox={viewBox} aria-hidden="true">{path}</svg>;

const IconInfo = (): VNode => <Icon path={[<circle cx="12" cy="12" r="9" />, <path d="M12 11v5M12 8h.01" />]} />;
const IconBack = (): VNode => <Icon path={[<path d="M9 5 3 12l6 7" />, <path d="M3 12h13a5 5 0 0 1 0 10h-1" />]} />;
const IconMore = (): VNode => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>;
const IconEye = (): VNode => <Icon path={[<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />, <circle cx="12" cy="12" r="2.5" />]} />;
const IconMail = (): VNode => <Icon path={[<rect x="3" y="5" width="18" height="14" rx="2" />, <path d="m3.5 7 8.5 6 8.5-6" />]} />;
const IconDuplicate = (): VNode => <Icon path={[<rect x="8" y="8" width="12" height="12" rx="2" />, <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />]} />;
const IconPerson = (): VNode => <Icon path={[<circle cx="12" cy="8" r="3.4" />, <path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" />]} />;
const IconHistory = (): VNode => <Icon path={[<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />, <path d="M3 4v4h4" />, <path d="M12 8v4.2l2.8 1.7" />]} />;
const IconExternal = (): VNode => <Icon path={[<path d="M14 4h6v6" />, <path d="M20 4 11 13" />, <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />]} />;
const IconTrigger = (): VNode => <Icon path={[<path d="M12 3v4M12 17v4M4.2 6.2l2.8 2.8M17 15l2.8 2.8M3 12h4M17 12h4" />, <circle cx="12" cy="12" r="3" />]} />;
const IconBadge = (): VNode => <Icon path={[<circle cx="12" cy="12" r="9" />, <path d="m8.5 12.5 2.5 2.5 4.5-5" />]} />;
const IconApproval = (): VNode => <Icon path={[<path d="M5 4h14v16l-7-3.5L5 20z" />, <path d="m9.5 10.5 1.8 1.8 3.2-3.4" />]} />;
const IconVersion = (): VNode => <Icon path={[<path d="m12 3 8 4.5-8 4.5-8-4.5z" />, <path d="m4 12 8 4.5 8-4.5" />, <path d="m4 16.5 8 4.5 8-4.5" />]} />;
const IconShield = (): VNode => <Icon path={[<path d="M12 3 5 6v6c0 4 3 7.2 7 9 4-1.8 7-5 7-9V6z" />]} />;
const IconKey = (): VNode => <Icon path={<path d="M5 9h14M5 15h14M10 4l-2 16M17 4l-2 16" />} />;
const IconLink = (): VNode => <Icon path={[<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />, <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />]} />;

function Fact({ icon, label, children }: { icon: VNode; label: string; children: ComponentChildren }): VNode {
  return <div class="etl-fact">{icon}<dt>{label}</dt><dd>{children}</dd></div>;
}

/** Reads the message as a recipient would — compiled, with sample values. */
function TemplatePreviewDialog({ id, onClose }: { id: string | null; onClose: () => void }): VNode | null {
  const detail = useEmailTemplate(id);
  const html = useMemo(
    () => (detail.data ? applySampleVariables(renderEmailPreview(detail.data.editorSchema, detail.data.name).html) : null),
    [detail.data],
  );
  if (!id) return null;
  return <Modal
    open
    size="lg"
    icon="fa-envelope-open-text"
    title={detail.data?.name ?? 'Preview'}
    sub={detail.data ? `Subject: ${detail.data.subject}` : 'Loading…'}
    onClose={onClose}
    footer={<Button variant="outline" onClick={onClose}>Close</Button>}
  >
    <div class="etl-preview-frame-wrap">
      {html
        ? <iframe class="etl-preview-frame" srcDoc={html} sandbox="allow-same-origin" title={`${detail.data?.name ?? 'Template'} preview`} />
        : <div class="etl-preview-loading">Rendering preview…</div>}
    </div>
  </Modal>;
}

/** One fact row on the back of a card. */
function CardFact({ label, children }: { label: string; children: ComponentChildren }): VNode {
  return <div class="etl-back-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

function TemplateCard({ row, selected, flipped, menuOpen, onSelect, onOpen, onPreview, onFlip, onMenu, onDuplicate, onArchive }: {
  row: EmailTemplateSummary;
  selected: boolean;
  flipped: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onPreview: () => void;
  onFlip: () => void;
  onMenu: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}): VNode {
  return <article class={`etl-card${selected ? ' selected' : ''}`}>
    <div class={`etl-cardstack${flipped ? ' open' : ''}`}>

      <div class="etl-cardface etl-cardface-front">
        <button class="etl-card-hit" type="button" aria-pressed={selected} onClick={onSelect} onDblClick={onOpen}>
          <span class="etl-card-visual">
            <img src={templateImage(row)} alt="" loading="lazy" width="960" height="720" />
          </span>
          <span class="etl-card-body">
            <span class="etl-card-title">
              {row.name}
              {row.protected && <span class="etl-system">System</span>}
            </span>
            {row.description && <span class="etl-card-desc">{row.description}</span>}
            <span class="etl-card-chips">
              <span class="etl-card-trigger">Trigger · {row.triggerLabel}</span>
              <TemplateStatus status={row.status} />
            </span>
            {/* The design shows a send count; no send tracking exists in the
                contract, so this reports the binding that makes it send at all. */}
            <span class="etl-card-meta">
              <span><IconLink />{row.activeUsageCount} active</span>
              <span>{date(row.updatedAt)}</span>
            </span>
          </span>
        </button>

        <div class="etl-card-actions">
          <button class="etl-card-btn primary" type="button" onClick={onPreview}><IconEye />Preview</button>
          <button class="etl-card-btn" type="button" onClick={onFlip}><IconInfo />Details</button>
          <button
            class="etl-card-btn square"
            type="button"
            aria-label={`More actions for ${row.name}`}
            aria-expanded={menuOpen}
            onClick={event => { event.stopPropagation(); onMenu(); }}
          ><IconMore /></button>
          {menuOpen && <div class="etl-menu" role="menu" onClick={event => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={onOpen}>Open in Email Studio</button>
            <button type="button" role="menuitem" onClick={onDuplicate}>Duplicate</button>
            <button
              type="button"
              role="menuitem"
              class="danger"
              disabled={row.protected || row.status === 'archived'}
              onClick={onArchive}
            >Archive template…</button>
          </div>}
        </div>
      </div>

      <div class="etl-cardface etl-cardface-back" aria-hidden={!flipped}>
        {/* Same markup and classes as the detail rail, so the back of the card
            is the rail — not a second implementation of it. */}
        <section class="etl-featured etl-featured--oncard" aria-label={`${row.name} details`}>
          <header class="etl-featured-head">
            <div class="etl-featured-kicker">
              <IconMail />
              <span>Template details</span>
            </div>
          </header>

          <div class="etl-featured-info">
            <h4 class="etl-fact-group">Governance</h4>
            <dl class="etl-feature-facts">
              <Fact icon={<IconBadge />} label="Status"><TemplateStatus status={row.status} /></Fact>
              <Fact icon={<IconApproval />} label="Approval">{APPROVAL_LABELS[row.approvalState] ?? row.approvalState}</Fact>
              <Fact icon={<IconVersion />} label="Version">v{row.currentVersion}</Fact>
              <Fact icon={<IconPerson />} label="Owner">{row.ownerLabel}</Fact>
              <Fact icon={<IconHistory />} label="Last edited">{`${date(row.updatedAt)} · ${row.ownerLabel}`}</Fact>
              <Fact icon={<IconShield />} label="Managed by">{row.protected ? 'SIOMAC system template' : 'Editable by HR'}</Fact>
            </dl>

            <h4 class="etl-fact-group">Usage &amp; wiring</h4>
            <dl class="etl-feature-facts">
              <Fact icon={<IconLink />} label="Bindings">{`${row.activeUsageCount} Active`}</Fact>
              <Fact icon={<IconTrigger />} label="Trigger">{row.triggerLabel}</Fact>
              <Fact icon={<IconKey />} label="Template key"><code>{row.key}</code></Fact>
            </dl>

            <div class="etl-featured-actions">
              <button class="etl-button navy" type="button" onClick={onOpen}><IconExternal />Open in Studio</button>
              <button class="etl-button" type="button" onClick={onFlip}><IconBack />Back</button>
            </div>
          </div>
        </section>
      </div>

    </div>
  </article>;
}

const COLUMNS: DtColumn<EmailTemplateSummary>[] = [
  {
    key: 'template',
    label: 'Template',
    isPinned: true,
    width: 'minmax(240px, 2.2fr)',
    sortAccessor: row => row.name,
    renderCell: row => <div class="etl-cell-template">
      <strong>{row.name}{row.protected && <span class="etl-system">System</span>}</strong>
      {row.description && <span>{row.description}</span>}
    </div>,
  },
  { key: 'trigger', label: 'Trigger', width: 'minmax(150px, 1fr)', sortAccessor: row => row.triggerLabel, renderCell: row => row.triggerLabel },
  { key: 'status', label: 'Status', width: '130px', sortAccessor: row => row.status, renderCell: row => <TemplateStatus status={row.status} /> },
  { key: 'bindings', label: 'Bindings', align: 'center', width: '110px', sortAccessor: row => row.activeUsageCount, renderCell: row => `${row.activeUsageCount} active` },
  { key: 'owner', label: 'Owner', width: 'minmax(130px, 1fr)', sortAccessor: row => row.ownerLabel, renderCell: row => row.ownerLabel },
  { key: 'updated', label: 'Last edited', width: '130px', sortAccessor: row => row.updatedAt, renderCell: row => date(row.updatedAt) },
];

export function EmailTemplateLibrary({ onBack, onToast }: { onBack: () => void; onToast: (message: string) => void }): VNode {
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<EmailTemplateStatus[]>([]);
  const [families, setFamilies] = useState<EmailTemplateFamily[]>([]);
  const [view, setView] = useState<LibraryView>('comfortable');
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { openId: filterOpenId, setOpenId: setFilterOpenId } = useFilterDropdowns();

  // One unfiltered list: the mockup filters the library in the page, so search,
  // status and family all narrow the same cached result set.
  const listQuery = useEmailTemplates(useMemo(() => ({ sort: 'updated_at' as const, direction: 'desc' as const }), []));
  const detailQuery = useEmailTemplate(openId);
  const duplicateMutation = useDuplicateEmailTemplate();
  const archiveMutation = useArchiveEmailTemplate();

  const allRows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter(row =>
      (row.name.toLowerCase().includes(needle) || (row.description ?? '').toLowerCase().includes(needle))
      && (families.length === 0 || families.includes(row.family))
      && (statuses.length === 0 || statuses.includes(row.status)));
  }, [allRows, families, query, statuses]);

  useEffect(() => {
    if (!menuId) return;
    const close = (): void => setMenuId(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuId]);

  async function duplicate(row: EmailTemplateSummary): Promise<void> {
    setMenuId(null);
    try {
      const created = await duplicateMutation.mutateAsync(row.id);
      onToast(`${row.name} duplicated.`);
      setOpenId(created.id);
    } catch (error) { onToast(error instanceof Error ? error.message : 'Template could not be duplicated.'); }
  }

  async function archive(row: EmailTemplateSummary): Promise<void> {
    setMenuId(null);
    if (row.activeUsageCount > 0) {
      onToast('Replace or remove active trigger bindings before archiving this template.');
      return;
    }
    if (!await dialog.confirm({ title: `Archive "${row.name}"?` })) return;
    try {
      await archiveMutation.mutateAsync(row.id);
      onToast('Template archived.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Template could not be archived.'); }
  }

  if (openId && detailQuery.data) return <EmailTemplateBuilder
    template={detailQuery.data}
    onBack={() => setOpenId(null)}
    onToast={onToast}
    onCreateEditableCopy={() => void duplicate(detailQuery.data)}
    creatingEditableCopy={duplicateMutation.isPending}
  />;
  if (openId && detailQuery.isLoading) return <div class="ets-loading-page"><table class="ets2-skeleton-table"><tbody><TableSkeleton rows={8} cols={5} /></tbody></table></div>;
  if (openId && detailQuery.isError) return <div class="ets-error-page"><EmptyState icon="fa-triangle-exclamation" tone="amber" title="Template could not be opened" text={detailQuery.error instanceof Error ? detailQuery.error.message : 'The template service is unavailable.'} actions={<Button variant="outline" onClick={() => setOpenId(null)}>Back to Templates</Button>} /></div>;

  return <div class="ets-library etl">
    <div class="etl-main">
      <PageHeader
        icon={<LucideIcon name="Mail" size={22} />}
        module="HR"
        crumbs={['Onboarding']}
        title="Email Templates"
        sub="Review each template’s purpose, trigger, status, and usage before opening it in Email Studio."
        actions={<>
          <button class="etl-hdr-btn" type="button" onClick={onBack}>
            <i class="fas fa-arrow-left" />Packages
          </button>
          <button class="etl-hdr-btn primary" type="button" onClick={() => setCreateOpen(true)}>
            <i class="fas fa-plus" />New Template
          </button>
        </>}
      />

      <div class="etl-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder="Search templates…" ariaLabel="Search email templates" />
        <FilterDropdown
          id="etl-family"
          label="Family"
          options={FAMILY_FILTERS}
          selected={families}
          onChange={next => setFamilies(next as EmailTemplateFamily[])}
          openId={filterOpenId}
          setOpenId={setFilterOpenId}
          labelFn={value => FAMILY_LABELS[value as EmailTemplateFamily]}
        />
        <FilterDropdown
          id="etl-status"
          label="Status"
          options={STATUS_FILTERS}
          selected={statuses}
          onChange={next => setStatuses(next as EmailTemplateStatus[])}
          openId={filterOpenId}
          setOpenId={setFilterOpenId}
          labelFn={value => STATUS_LABELS[value as EmailTemplateStatus]}
        />

        <div class="etl-density" role="group" aria-label="Library view">
          {LIBRARY_VIEWS.map(option => (
            <button
              key={option.key}
              class={`etl-density-btn${view === option.key ? ' on' : ''}`}
              type="button"
              aria-pressed={view === option.key}
              title={option.title}
              onClick={() => setView(option.key)}
            ><i class={`fas ${option.icon}`} /></button>
          ))}
        </div>

        <span class="etl-toolbar-count">
          {rows.length} of {allRows.length} {allRows.length === 1 ? 'template' : 'templates'}
        </span>
      </div>

      <ActiveFilters
        chips={[
          ...families.map(value => ({
            label: `Family: ${FAMILY_LABELS[value]}`,
            onRemove: () => setFamilies(current => current.filter(item => item !== value)),
          })),
          ...statuses.map(value => ({
            label: `Status: ${STATUS_LABELS[value]}`,
            onRemove: () => setStatuses(current => current.filter(item => item !== value)),
          })),
        ]}
        onClearAll={() => { setFamilies([]); setStatuses([]); }}
      />

      <div class="etl-body">
        {listQuery.isLoading && !listQuery.data
          ? <div class={`etl-grid comfortable`}>{[0, 1, 2, 3].map(key => <div key={key} class="etl-card etl-card-skeleton" />)}</div>
          : listQuery.isError
            ? <EmptyState
              icon="fa-triangle-exclamation"
              tone="amber"
              title="Email templates could not be loaded"
              text={listQuery.error instanceof Error ? listQuery.error.message : 'The template service is unavailable.'}
              actions={<Button variant="outline" onClick={() => void listQuery.refetch()}>Retry</Button>}
            />
            : rows.length === 0
              ? <EmptyState
                icon="fa-envelope-open-text"
                title="No templates match this view"
                text="Change the search or status filter, or create a new transactional email template."
                actions={<Button variant="blue" onClick={() => setCreateOpen(true)}>New Template</Button>}
              />
              : view === 'table'
                ? <DataTable<EmailTemplateSummary>
                  ariaLabel="Email templates"
                  noun="templates"
                  columns={COLUMNS}
                  rows={rows}
                  rowKey={row => row.id}
                  selectedKey={selectedId}
                  onRowClick={row => setSelectedId(row.id)}
                  rowStatus={row => (row.status === 'published' ? 'success' : row.status === 'archived' ? 'muted' : 'default')}
                  rowActions={row => [
                    { key: 'open', label: 'Open in Email Studio', icon: 'edit', onClick: () => setOpenId(row.id) },
                    { key: 'duplicate', label: 'Duplicate', icon: 'file', onClick: () => void duplicate(row) },
                    ...(row.protected || row.status === 'archived'
                      ? []
                      : [{ key: 'archive', label: 'Archive template…', icon: 'trash', tone: 'danger' as const, onClick: () => void archive(row) }]),
                  ]}
                />
                : <div class={`etl-grid ${view}`}>
                {rows.map(row => <TemplateCard
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  onSelect={() => setSelectedId(row.id)}
                  onOpen={() => setOpenId(row.id)}
                  onPreview={() => setPreviewId(row.id)}
                  flipped={flippedId === row.id}
                  onFlip={() => setFlippedId(current => (current === row.id ? null : row.id))}
                  menuOpen={menuId === row.id}
                  onMenu={() => setMenuId(current => (current === row.id ? null : row.id))}
                  onDuplicate={() => void duplicate(row)}
                  onArchive={() => void archive(row)}
                />)}
              </div>}
      </div>
    </div>

    <TemplatePreviewDialog id={previewId} onClose={() => setPreviewId(null)} />

    <EmailTemplateCreateDialog open={createOpen} templates={allRows} onClose={() => setCreateOpen(false)} onCreated={row => setOpenId(row.id)} onToast={onToast} />
  </div>;
}
