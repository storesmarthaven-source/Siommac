/**
 * src/ui/gallery/CompareExisting.tsx — the visual selection pass.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The first consolidation pass picked a canonical design by INHERITANCE: the
 * component that already lived in `@ui` became the visual authority, and every
 * other implementation was migrated onto it and deleted. That was never
 * justified. The pre-v2 `@ui/Button` had three consumers against raw `<button>`
 * in 281 files, and it had no CSS of its own — it wrapped the HSE classes. It
 * was the least-adopted implementation in its own family.
 *
 * "Newest wins" is the same mistake with the sign flipped. Age is context.
 *
 * SCOPE (set by the user, 2026-08-10): only the treatments on the CURRENTLY
 * BUILT pages are candidates — HR Onboarding (`.obx-*`), HR/Finance Aurora
 * (`.hrfin-*`), Settings v2 (`.stg-*`) and Access Control. The legacy-page
 * treatments (HSE `.hse-btn` / `.inc-action-btn` / `.vt-table`, the Employees
 * `.emp-card`, the Bootstrap-era buttons) are NOT choices; they appear in the
 * `retire` table because they have to be removed, and the size of that removal
 * is part of the decision.
 *
 * So: every CURRENT implementation is rendered LIVE, side by side,
 * with its source, its adoption, what it actually supports, what it does about
 * accessibility, and its known defects. Then the user chooses — per ASPECT, not
 * per component, because the right answer is usually "this one's shape, that
 * one's disabled state, the new engine's keyboard model".
 *
 * Selections are recorded locally and exported as text. This screen decides
 * nothing on its own; it produces the brief that a consolidation is built from.
 */

import { type VNode } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  type ComponentDef, type ComparisonSet, type ImplSpecimen, type ImplGeneration,
} from '../registry';
import { Badge } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { LucideIcon } from '../LucideIcon';
import './compareExisting.css';

/* ── Decision store ─────────────────────────────────────────────────────────
   Kept in localStorage, keyed by family. A selection pass takes a while and
   must survive a reload — the same reason the token draft is persisted. */

const KEY = 'siomac.uikit.decisions';

export type FamilyDecision = Record<string, string>;   // aspectId → specimenId
type AllDecisions = Record<string, FamilyDecision>;    // familyId → …

function readDecisions(): AllDecisions {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AllDecisions) : {};
  } catch { return {}; }
}

function useDecisions(familyId: string): {
  picks: FamilyDecision;
  set: (aspectId: string, specimenId: string) => void;
  clear: () => void;
} {
  const [all, setAll] = useState<AllDecisions>(readDecisions);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
  }, [all]);

  const set = useCallback((aspectId: string, specimenId: string): void => {
    setAll(prev => ({ ...prev, [familyId]: { ...prev[familyId], [aspectId]: specimenId } }));
  }, [familyId]);

  const clear = useCallback((): void => {
    setAll(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== familyId)));
  }, [familyId]);

  return { picks: all[familyId] ?? {}, set, clear };
}

/* ── Generation labelling ───────────────────────────────────────────────────
   Neutral wording on purpose. "Legacy" reads as "bad" and "new" reads as
   "good"; neither is what the label means. */

const GENERATION: Record<ImplGeneration, { label: string; tone: 'neutral' | 'info' | 'accent' | 'success' }> = {
  original:    { label: 'Original',        tone: 'neutral' },
  'kit-legacy':{ label: 'Kit, pre-v2',     tone: 'neutral' },
  module:      { label: 'Module-built',    tone: 'info' },
  recent:      { label: 'Recent screens',  tone: 'accent' },
  v2:          { label: 'UI Kit v2',       tone: 'success' },
};

/* ── Specimen card ──────────────────────────────────────────────────────────*/

function SpecimenCard({ spec }: { spec: ImplSpecimen }): VNode {
  const gen = GENERATION[spec.generation];
  return (
    <section class="ui-cmp-card">
      <header class="ui-cmp-card-head">
        <span class="ui-cmp-letter" aria-hidden="true">{spec.id}</span>
        <div class="ui-cmp-card-title">
          <h3>{spec.name}</h3>
          <code>{spec.source}</code>
        </div>
        <div class="ui-cmp-card-tags">
          <Badge tone={gen.tone} size="sm">{gen.label}</Badge>
          {spec.usedByRecentScreens && <Badge tone="info" size="sm" variant="outline">In recent screens</Badge>}
        </div>
      </header>

      {/* The preview is the point. It renders the REAL implementation — a
          mock-up of one would make the comparison worthless. */}
      <div class="ui-cmp-preview ui-cmp-live">{spec.render()}</div>

      <dl class="ui-cmp-facts">
        <div>
          <dt>Consumers</dt>
          <dd>
            <strong>{spec.consumers}</strong> file{spec.consumers === 1 ? '' : 's'}
            {spec.consumerNote && <span class="ui-cmp-note">{spec.consumerNote}</span>}
          </dd>
        </div>
        <div>
          <dt>Supports</dt>
          <dd><ul>{spec.features.map(f => <li key={f}>{f}</li>)}</ul></dd>
        </div>
        <div>
          <dt>Accessibility</dt>
          <dd><ul>{spec.a11y.map(a => <li key={a}>{a}</li>)}</ul></dd>
        </div>
        {spec.defects && spec.defects.length > 0 && (
          <div class="ui-cmp-defects">
            <dt>Known defects</dt>
            <dd><ul>{spec.defects.map(d => <li key={d}>{d}</li>)}</ul></dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/* ── Decision panel ─────────────────────────────────────────────────────────*/

function DecisionPanel({ familyId, name, cmp }: { familyId: string; name: string; cmp: ComparisonSet }): VNode {
  const { picks, set, clear } = useDecisions(familyId);
  const [copied, setCopied] = useState(false);

  const decided = cmp.aspects.filter(a => picks[a.id]).length;

  /** The brief, as text the user can paste back. */
  const brief = (): string => {
    const lines = [
      `${name.toUpperCase()} — canonical design decision`,
      '',
      ...cmp.aspects.map(a => {
        const pick = picks[a.id];
        const spec = cmp.specimens.find(s => s.id === pick);
        return `${a.label.padEnd(20)} ${pick ? `${pick} — ${spec?.name ?? ''}` : '(not chosen)'}`;
      }),
      '',
      'Keep regardless:',
      ...(cmp.keepRegardless ?? []).map(k => `  · ${k}`),
    ];
    return lines.join('\n');
  };

  const copy = (): void => {
    void navigator.clipboard.writeText(brief()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section class="ui-cmp-decide">
      <header class="ui-cmp-decide-head">
        <div>
          <h3>Select what to keep</h3>
          <p>
            Choose per aspect, not per component — the answer can be “B’s shape, E’s icon spacing,
            the v2 keyboard model”. Nothing is migrated or deleted until this is approved.
          </p>
        </div>
        <Badge tone={decided === cmp.aspects.length ? 'success' : 'neutral'}>
          {decided}/{cmp.aspects.length} chosen
        </Badge>
      </header>

      <div class="ui-cmp-aspects">
        {cmp.aspects.map(aspect => {
          const candidates = aspect.candidates
            ? cmp.specimens.filter(s => aspect.candidates?.includes(s.id))
            : cmp.specimens;
          return (
            <fieldset key={aspect.id} class="ui-cmp-aspect">
              <legend>{aspect.label}</legend>
              <p class="ui-cmp-aspect-q">{aspect.question}</p>
              <div class="ui-cmp-choices" role="radiogroup" aria-label={aspect.label}>
                {candidates.map(s => {
                  const active = picks[aspect.id] === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      class={`ui-cmp-choice${active ? ' is-active' : ''}`}
                      onClick={() => set(aspect.id, s.id)}
                      title={s.name}
                    >
                      {s.id}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      {cmp.keepRegardless && cmp.keepRegardless.length > 0 && (
        <div class="ui-cmp-keep">
          <h4><LucideIcon name="ShieldCheck" size={14} /> Kept regardless of the visual choice</h4>
          <ul>{cmp.keepRegardless.map(k => <li key={k}>{k}</li>)}</ul>
        </div>
      )}

      <div class="ui-cmp-decide-foot">
        <Button variant="secondary" size="sm" onClick={clear} iconLeft={<LucideIcon name="RotateCcw" />}>
          Clear
        </Button>
        <Button variant="primary" size="sm" onClick={copy} iconLeft={<LucideIcon name={copied ? 'Check' : 'Copy'} />}>
          {copied ? 'Copied' : 'Copy decision'}
        </Button>
      </div>

      <pre class="ui-cmp-brief">{brief()}</pre>
    </section>
  );
}

/* ── The mode ───────────────────────────────────────────────────────────────*/

export function CompareExisting({ def }: { def: ComponentDef }): VNode {
  const cmp = def.comparison;

  if (!cmp) {
    /* Absence is shown, not implied. A family with no comparison has not been
       reviewed, and that is exactly the state that caused the reset. */
    return (
      <div class="ui-cmp-empty">
        <LucideIcon name="SearchX" size={22} />
        <strong>{def.name} has not been surveyed yet.</strong>
        <p>
          Every materially different existing implementation has to be rendered here before this
          family is consolidated. Until then nothing in it should be migrated or deleted.
        </p>
      </div>
    );
  }

  return (
    <div class="ui-cmp">
      <header class="ui-cmp-head">
        <h2>{def.name} — existing implementations</h2>
        <p>{cmp.summary}</p>
        <p class="ui-cmp-caveat">
          Counts are file counts from a grep over <code>src/**/*.tsx</code> and are approximate by
          design — they are here for order of magnitude, not as an audit.
        </p>
      </header>

      <div class="ui-cmp-grid">
        {cmp.specimens.map(s => <SpecimenCard key={s.id} spec={s} />)}
      </div>

      {cmp.retire && cmp.retire.length > 0 && (
        /* Not candidates — these belong to legacy pages and are being removed.
           Listed rather than silently omitted, because the comparison has to
           show the WORK the decision creates: "156 raw .vt-table uses" is the
           real cost of retiring the HSE register, and it should be visible at
           the moment the design is chosen, not discovered afterwards. */
        <section class="ui-cmp-retire">
          <h3><LucideIcon name="Trash2" size={15} /> Legacy-page implementations — to be removed</h3>
          <p>Not options. These are on the old pages and come out once the canonical design is set.</p>
          <table>
            <thead><tr><th>Implementation</th><th>Still on</th><th class="ui-cmp-num">Uses</th></tr></thead>
            <tbody>
              {cmp.retire.map(r => (
                <tr key={r.name}>
                  <td><strong>{r.name}</strong><code>{r.source}</code></td>
                  <td>{r.usedBy}</td>
                  <td class="ui-cmp-num">{r.uses}</td>
                </tr>
              ))}
              <tr class="ui-cmp-retire-total">
                <td colSpan={2}>Total to remove</td>
                <td class="ui-cmp-num">{cmp.retire.reduce((n, r) => n + r.uses, 0)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <DecisionPanel familyId={def.id} name={def.name} cmp={cmp} />
    </div>
  );
}
