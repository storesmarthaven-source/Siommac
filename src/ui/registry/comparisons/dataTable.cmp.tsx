/**
 * src/ui/registry/comparisons/dataTable.cmp.tsx — every real table system.
 *
 * Grouped by VISUAL SYSTEM, not by file: the raw `<table>`s on the current pages
 * all use one of the class families below, so comparing them individually would
 * be dozens of identical previews. Each specimen renders the SAME four employees
 * so header weight, row height, borders and hover are directly comparable.
 */

import { type ComparisonSet } from '../types';
import { DataTable, type DataTableColumn } from '../../data/DataTable';
import { HrfinTable, type HrfinColumn } from '../../hrfin/HrfinTable';
import { HrfinPill } from '../../hrfin/HrfinPill';
import { Badge } from '../../primitives/Badge';
import { Button } from '../../primitives/Button';
import { PersonCell } from '../../table/PersonCell';
import { LucideIcon } from '../../LucideIcon';

const noop = (): void => { /* preview */ };

interface Person { id: string; name: string; no: string; role: string; dept: string; status: 'active' | 'leave' | 'probation'; start: string }

const PEOPLE: Person[] = [
  { id: 'p1', name: 'Sarah James',      no: 'EMP-00484', role: 'Safety Officer',   dept: 'HSE',        status: 'active',    start: '2021-03-08' },
  { id: 'p2', name: 'Amara Diallo',     no: 'EMP-00010', role: 'Field Engineer',   dept: 'Operations', status: 'leave',     start: '2019-11-18' },
  { id: 'p3', name: 'Priya Ramkissoon', no: 'EMP-00034', role: 'HR Officer',       dept: 'People',     status: 'active',    start: '2022-07-04' },
  { id: 'p4', name: 'Jordan Alexander', no: 'EMP-00021', role: 'Shift Supervisor', dept: 'Operations', status: 'probation', start: '2026-06-01' },
];

const TONE = { active: 'success', leave: 'info', probation: 'warning' } as const;
const LABEL = { active: 'Active', leave: 'On leave', probation: 'Probation' } as const;

export const DATA_TABLE_COMPARISON: ComparisonSet = {
  summary:
    'Two table treatments on the currently-built pages — the Onboarding register (.obx-table) and the Aurora card-table (.hrfin-table) — plus the v2 rebuild. The HSE register (.vt-table) and the two pre-kit generic tables belong to legacy pages and are listed for removal.',

  specimens: [
    {
      id: 'A',
      name: '.obx-table (HR Onboarding register)',
      source: 'assets/styles — .obx-table / .obx-rowbtns / .obx-mini',
      generation: 'recent',
      consumers: 16,
      consumerNote: 'Onboarding command centre, package detail, work queue, HR overviews.',
      usedByRecentScreens: true,
      features: ['inline row buttons rather than a kebab', '`.obx-meta` muted cell', 'tinted pills', 'section-wrapped'],
      a11y: ['Real <table>', 'Row actions are real buttons, always visible (no hover-reveal)'],
      render: () => (
        <div class="obx-section">
          <div class="obx-section-body">
            <table class="obx-table">
              <thead><tr><th>Employee</th><th>Dept</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {PEOPLE.slice(0, 3).map(p => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b></td>
                    <td class="obx-meta">{p.dept}</td>
                    <td><Badge tone="info">{LABEL[p.status]}</Badge></td>
                    <td><div class="obx-rowbtns">
                      <button type="button" class="obx-mini">Edit</button>
                      <button type="button" class="obx-mini">Open</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: 'B',
      name: 'HrfinTable (Aurora card-table)',
      source: 'src/ui/hrfin/HrfinTable.tsx',
      generation: 'recent',
      consumers: 15,
      consumerNote: 'Every Finance register — AP, budgets, expenses, remittances, payroll.',
      usedByRecentScreens: true,
      features: [
        'tabs + search + filter chips in the card head', 'sortable headers', 'server pagination with a count line',
        'row-action kebab at a click position', 'loading / empty / error states', 'the table IS a card',
      ],
      a11y: ['Real <table>', 'Sort toggles are buttons', 'The kebab menu is positioned by mouse coordinates, so it is not keyboard-reachable'],
      defects: ['Row-action menu opens at the pointer position — unreachable without a mouse.'],
      render: () => (
        <div class="hrfin">
          <HrfinTable<Person>
            columns={[
              { key: 'name', label: 'Employee', sortable: true, render: r => <b>{r.name}</b> },
              { key: 'dept', label: 'Department', render: r => r.dept },
              { key: 'status', label: 'Status', render: r => <HrfinPill tone={r.status === 'active' ? 'ok' : 'dr'}>{LABEL[r.status]}</HrfinPill> },
              { key: 'start', label: 'Started', render: r => r.start },
            ] as HrfinColumn<Person>[]}
            rows={PEOPLE}
            rowKey={r => r.id}
            searchValue=""
            onSearch={noop}
            page={0}
            pageCount={4}
            total={148}
            pageSize={25}
            onPage={noop}
            noun="employees"
          />
        </div>
      ),
    },
    {
      id: 'C',
      name: 'Canonical DataTable (UI Kit v2)',
      source: 'src/ui/data/DataTable/',
      generation: 'v2',
      consumers: 3,
      consumerNote: 'The three Access Control proof migrations.',
      usedByRecentScreens: false,
      features: [
        '3 densities', 'search / filters / sort / pagination / rows-per-page', 'selection + bulk actions',
        'column chooser', 'row actions', 'sticky header', 'zebra', 'loading / empty / error',
        'client vs server mode chosen by `pagination.total`',
      ],
      a11y: [
        'Semantic <table>, scoped column headers, aria-sort on the header CELL',
        'Row actions revealed by :focus-within, so they stay keyboard-reachable',
        'Select-all scoped to the current PAGE, never to unloaded rows',
        'Row checkbox / action cell stop propagation so ticking does not also open the row',
      ],
      defects: ['Its header, row height and borders were taken from the DataTable recipe defaults, not chosen against these alternatives.'],
      render: () => (
        <DataTable<Person>
          label="Employees"
          rows={PEOPLE}
          columns={[
            { id: 'employee', header: 'Employee', minWidth: 200, sortable: true, sortValue: r => r.name,
              cell: r => <PersonCell name={r.name} image={null} sub={r.role} meta={`· ${r.no}`} size={26} /> },
            { id: 'dept', header: 'Department', sortable: true, sortValue: r => r.dept, cell: r => r.dept },
            { id: 'status', header: 'Status', width: 120, cell: r => <Badge tone={TONE[r.status]} dot>{LABEL[r.status]}</Badge> },
            { id: 'start', header: 'Started', width: 110, align: 'right', cell: r => r.start },
          ] as DataTableColumn<Person>[]}
          getRowId={r => r.id}
          search={{ value: '', onChange: noop, placeholder: 'Search employees…' }}
          sorting={{ value: { columnId: 'employee', direction: 'asc' }, onChange: noop, client: true }}
          pagination={{ page: 1, pageSize: 25, total: 148, onPageChange: noop, onPageSizeChange: noop }}
          rowActions={() => [{ id: 'view', label: 'View employee', icon: <LucideIcon name="Eye" />, onSelect: noop }]}
          toolbarActions={<Button variant="primary" size="sm" iconLeft={<LucideIcon name="Plus" />}>New employee</Button>}
        />
      ),
    },
  ],

  aspects: [
    { id: 'header',     label: 'Header style',    question: 'Plain bold row (Onboarding) · light caps inside a card head (Aurora) · the v2 tinted band + uppercase caption.' },
    { id: 'density',    label: 'Row density',     question: 'Default row height and cell padding.' },
    { id: 'borders',    label: 'Borders & grid',  question: 'Full grid lines, horizontal rules only, or a bare card with no rules.' },
    { id: 'hover',      label: 'Row hover',       question: 'Tint strength, and whether the whole row is a click target.' },
    { id: 'toolbar',    label: 'Toolbar',         question: 'Inside the card head with tabs (Aurora) · none, the section header carries it (Onboarding) · above the table (v2).' },
    { id: 'filters',    label: 'Filters',         question: 'Dropdown chips with active-chip clearing, a filter button row, or an advanced-filter drawer.' },
    { id: 'pagination', label: 'Pagination',      question: '"Showing 1–25 of 148" + arrows (Aurora) · none (Onboarding) · the v2 rows-per-page + page arrows.' },
    { id: 'selection',  label: 'Selected rows',   question: 'Tinted row + a bulk bar, or a leading checkbox column only.' },
    { id: 'rowactions', label: 'Row actions',     question: 'Always-visible inline buttons (Onboarding) · pointer-positioned kebab (Aurora) · the v2 hover-revealed kebab.' },
    { id: 'empty',      label: 'Empty state',     question: 'Icon + title + hint inside the frame, or a bare muted line.' },
  ],

  retire: [
    { name: '.vt-table + RegisterTable', source: 'assets/styles — .vt-table · src/ui/components/RegisterTable.tsx',
      usedBy: 'HSE (145) · HR leftovers (8) · Finance leftovers (3)', uses: 156 },
    { name: '@ui/DataTable (pre-v2, LegacyDataTable)', source: 'src/ui/DataTable.tsx',
      usedBy: '2 files. Visually .vt-table with a toolbar.', uses: 2 },
    { name: '@shared/DataTable', source: 'src/components/shared/DataTable.tsx',
      usedBy: '3 files. The oldest generic table in the tree.', uses: 3 },
  ],

  keepRegardless: [
    'One engine with opt-in capabilities — the alternative is the four implementations this replaces.',
    'aria-sort on the header cell, and row actions reachable via :focus-within.',
    'Select-all scoped to the current page, never to unloaded rows.',
    'Client vs server mode selected by the data already present.',
    'The DataTable test suite.',
  ],
};
