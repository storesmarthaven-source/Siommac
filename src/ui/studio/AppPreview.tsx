/**
 * src/ui/studio/AppPreview.tsx — "if I publish this theme, what will SIOMAC feel like?"
 *
 * A composition of REAL canonical components inside a realistic application
 * frame. Four scenes (Dashboard · Forms · Data · Workflow) at three real widths.
 *
 * ⭐ NO backend. The preview uses deterministic local sample data on purpose: a
 * design-system preview that goes blank because Payroll or HSE is down is not a
 * design-system preview. Nothing here calls an endpoint.
 *
 * ⭐ Heavy components (DataTable, Wizard, Dialog, Tabs, Menu) render through the
 * REGISTRY — `def.render(defaultProps(def))` — the same path the workbench and
 * the Brand board use. That is deliberate: hand-rolling a second DataTable
 * "for the preview" is exactly the parallel demo system this programme exists to
 * avoid, and it would drift the moment the real one changed. Simple controls
 * (Button, Badge, Card, TextInput, Select) are composed directly, because
 * composing them IS the point of a scene.
 *
 * ⭐ Widths CONSTRAIN, never `transform: scale()`. A scaled preview shrinks
 * pixels without changing the width the layout computes against, so media
 * queries never fire and wrapping, table overflow and dialog sizing all lie.
 * At 375px the application rail collapses to a topbar rather than being squeezed.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '../primitives/Button';
import { Badge } from '../primitives/Badge';
import { TextInput } from '../primitives/TextInput';
import { Card, CardHeader } from '../containers/Card';
import { FormField } from '../forms/FormField';
import { SelectInput } from '../components/Field';
import { findComponent, defaultProps } from '../registry';

export type Scene = 'dashboard' | 'forms' | 'data' | 'workflow';
export const SCENES: { id: Scene; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'forms',     label: 'Forms' },
  { id: 'data',      label: 'Data' },
  { id: 'workflow',  label: 'Workflow' },
];

export type PreviewWidth = 'desktop' | 'tablet' | 'mobile';
export const WIDTHS: { id: PreviewWidth; label: string; px: number }[] = [
  { id: 'desktop', label: 'Desktop', px: 1440 },
  { id: 'tablet',  label: 'Tablet',  px: 768 },
  { id: 'mobile',  label: 'Mobile',  px: 375 },
];

/* ── Deterministic sample data — no API, no randomness ─────────────────────── */

const NAV = ['Dashboard', 'Employees', 'HSE', 'Finance', 'Reports', 'Settings'];

const METRICS = [
  { label: 'Active employees', value: '148', tone: 'neutral' as const },
  { label: 'Open onboarding',  value: '12',  tone: 'info' as const },
  { label: 'HSE actions',      value: '5',   tone: 'warning' as const },
  { label: 'Awaiting approval', value: '3',  tone: 'danger' as const },
];

const ACTIVITY = [
  { who: 'Sarah James',   what: 'completed HSE induction',      when: '10 minutes ago', tone: 'success' as const, state: 'Complete' },
  { who: 'Andre Mohammed', what: 'submitted timesheet',          when: '1 hour ago',     tone: 'info' as const,    state: 'Submitted' },
  { who: 'Priya Ramdin',  what: 'permit to work expires today', when: '3 hours ago',    tone: 'warning' as const, state: 'Due' },
  { who: 'Kevin Charles', what: 'payroll exception raised',      when: 'Yesterday',      tone: 'danger' as const,  state: 'Blocked' },
];

const DEPARTMENTS = ['Operations', 'Civil', 'Electrical', 'Engineering', 'Finance', 'HSE'];
const EMPLOYMENT = ['Permanent', 'Contract', 'Temporary', 'Apprentice'];
const SITES = ['Port of Spain HQ', 'Point Lisas', 'San Fernando Yard', 'Offshore — Platform B'];

/** Render a registry component by id, or nothing if it is not built. */
function Registry({ id }: { id: string }): VNode | null {
  const def = findComponent(id);
  if (!def?.render) return null;
  return <>{def.render(defaultProps(def), 'default')}</>;
}

/* ── Scenes ────────────────────────────────────────────────────────────────── */

function Dashboard(): VNode {
  return (
    <>
      <div class="ap-page__head">
        <div>
          <h1>Operations Dashboard</h1>
          <p>Tuesday, 12 August 2026 · Port of Spain HQ</p>
        </div>
        <div class="ap-page__actions">
          <Button variant="secondary">Export</Button>
          <Button variant="primary">New employee</Button>
        </div>
      </div>

      <div class="ap-metrics">
        {METRICS.map(m => (
          <Card key={m.label} variant="metric" tone={m.tone}>
            <span class="ap-metric__v">{m.value}</span>
            <span class="ap-metric__l">{m.label}</span>
          </Card>
        ))}
      </div>

      <div class="ap-split">
        <Card variant="panel">
          <CardHeader title="Employee register" />
          <Registry id="data-table" />
        </Card>

        <Card variant="panel">
          <CardHeader title="Needs attention" />
          <ul class="ap-activity">
            {ACTIVITY.map(a => (
              <li key={a.who}>
                <div>
                  <strong>{a.who}</strong>
                  <span>{a.what}</span>
                  <small>{a.when}</small>
                </div>
                <Badge tone={a.tone}>{a.state}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Forms(): VNode {
  const [first, setFirst] = useState('Sarah');
  const [last, setLast] = useState('');
  const [dept, setDept] = useState('Operations');
  const [type, setType] = useState('Permanent');
  const [site, setSite] = useState('Point Lisas');

  return (
    <>
      <div class="ap-page__head">
        <div>
          <h1>Create employee</h1>
          <p>Personal details, placement and reporting line.</p>
        </div>
      </div>

      <Card variant="panel">
        <CardHeader title="Employee details" />
        <div class="ap-form">
          <FormField label="First name" required>
            <TextInput value={first} onInput={setFirst} placeholder="Given name" />
          </FormField>

          {/* A real validation state, not a screenshot of one. */}
          <FormField label="Last name" required error="Last name is required.">
            <TextInput value={last} onInput={setLast} placeholder="Family name" />
          </FormField>

          <FormField label="Department" required>
            <SelectInput value={dept} onInput={setDept} options={DEPARTMENTS} />
          </FormField>

          <FormField label="Employment type" required>
            <SelectInput value={type} onInput={setType} options={EMPLOYMENT} />
          </FormField>

          <FormField label="Site">
            <SelectInput value={site} onInput={setSite} options={SITES} />
          </FormField>

          <FormField label="Employee number" helpText="Generated on save — not editable.">
            <TextInput value="EMP-00512" readOnly />
          </FormField>

          <FormField label="Daily rate" helpText="Base rate before allowances.">
            <TextInput value="480.00" prefix="TTD" onInput={() => undefined} />
          </FormField>

          <FormField label="Payroll group" helpText="Locked until the department is approved.">
            <TextInput value="Monthly — Operations" disabled />
          </FormField>
        </div>

        <div class="ap-form__foot">
          <Registry id="checkbox" />
          <div class="ap-page__actions">
            <Button variant="secondary">Cancel</Button>
            <Button variant="primary">Save employee</Button>
          </div>
        </div>
      </Card>
    </>
  );
}

function Data(): VNode {
  return (
    <>
      <div class="ap-page__head">
        <div>
          <h1>Employee directory</h1>
          <p>148 people · 6 departments · 4 sites</p>
        </div>
        <div class="ap-page__actions">
          <Button variant="secondary">Export</Button>
          <Button variant="primary">Add employee</Button>
        </div>
      </div>

      <Card variant="panel">
        <div class="ap-toolbar">
          <TextInput value="" placeholder="Search employees…" onInput={() => undefined} />
          <div class="ap-page__actions">
            <Button variant="outline">Filters</Button>
            <Button variant="outline">Columns</Button>
          </div>
        </div>
        <Registry id="data-table" />
      </Card>
    </>
  );
}

function Workflow(): VNode {
  return (
    <>
      <div class="ap-page__head">
        <div>
          <h1>Start onboarding</h1>
          <p>Sarah James · EMP-00484 · Operations</p>
        </div>
        <Badge tone="info">Step 2 of 4</Badge>
      </div>

      <Card variant="panel">
        <Registry id="wizard" />
      </Card>

      <div class="ap-split">
        <Card variant="panel">
          <CardHeader title="Readiness" />
          <ul class="ap-activity">
            <li><div><strong>Right to work</strong><span>Verified 8 Aug</span></div><Badge tone="success">Complete</Badge></li>
            <li><div><strong>HSE induction</strong><span>Booked 14 Aug</span></div><Badge tone="warning">Due</Badge></li>
            <li><div><strong>Bank details</strong><span>Not provided</span></div><Badge tone="danger">Blocked</Badge></li>
          </ul>
        </Card>

        <Card variant="panel">
          <CardHeader title="Confirmation" />
          <Registry id="dialog" />
        </Card>
      </div>

      <div class="ap-page__actions ap-page__actions--end">
        <Button variant="secondary">Back</Button>
        <Button variant="primary">Continue</Button>
      </div>
    </>
  );
}

/* ── Frame ─────────────────────────────────────────────────────────────────── */

export function AppPreview({ initialScene = 'dashboard' }: { initialScene?: Scene } = {}): VNode {
  const [scene, setScene] = useState<Scene>(initialScene);
  const [width, setWidth] = useState<PreviewWidth>('desktop');
  const w = WIDTHS.find(x => x.id === width)!;
  const mobile = width === 'mobile';

  return (
    <div class="sds-ap">
      {/* Controls are STUDIO CHROME — outside the preview scope. */}
      <div class="sds-ap__bar">
        <div class="sds-seg" role="group" aria-label="Preview scene">
          {SCENES.map(s => (
            <button type="button" key={s.id}
              class={`sds-seg__btn${s.id === scene ? ' is-on' : ''}`}
              aria-pressed={s.id === scene}
              onClick={() => setScene(s.id)}>{s.label}</button>
          ))}
        </div>
        <div class="sds-seg" role="group" aria-label="Preview width">
          {WIDTHS.map(x => (
            <button type="button" key={x.id}
              class={`sds-seg__btn${x.id === width ? ' is-on' : ''}`}
              aria-pressed={x.id === width}
              onClick={() => setWidth(x.id)}>{x.label}</button>
          ))}
        </div>
      </div>
      <p class="sds-bo__hint">
        {w.px}px — the layout is CONSTRAINED to this width, never scaled, so media queries,
        wrapping and table overflow behave as they will in the real application.
      </p>

      <div class="sds-ap__stage">
        <div class={`ap${mobile ? ' ap--mobile' : ''}`} style={{ width: `${w.px}px` }}>
          {mobile ? (
            <header class="ap__topbar">
              <button type="button" class="ap__burger" aria-label="Open navigation">☰</button>
              <strong>SIOMAC</strong>
              <span class="ap__avatar">SJ</span>
            </header>
          ) : (
            <aside class="ap__rail">
              <div class="ap__brand">SIOMAC</div>
              <nav>
                {NAV.map((n, i) => (
                  <span key={n} class={`ap__navitem${i === 0 ? ' is-on' : ''}`}>{n}</span>
                ))}
              </nav>
            </aside>
          )}

          <div class="ap__body">
            {!mobile && (
              <header class="ap__topbar">
                <TextInput value="" placeholder="Search & jump to…" onInput={() => undefined} />
                <span class="ap__avatar">SJ</span>
              </header>
            )}
            <main class="ap__page">
              {scene === 'dashboard' && <Dashboard />}
              {scene === 'forms' && <Forms />}
              {scene === 'data' && <Data />}
              {scene === 'workflow' && <Workflow />}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
