/**
 * src/ui/registry/comparisons/button.cmp.tsx — every real Button, side by side.
 *
 * The finding that should be read FIRST: the pre-v2 `@ui/Button` had no CSS of
 * its own. It was a typed wrapper whose five variants mapped 1:1 onto
 * `.inc-action-btn` and `.hse-btn`, and it had THREE consumers while raw
 * `<button>` markup existed in 281 files. Treating it as the visual authority
 * because it lived in `@ui` was never justified — it was the HSE button with a
 * TypeScript signature on it.
 *
 * Counts are `grep` over `src/**\/*.tsx` at the time of writing, and are file
 * counts unless stated otherwise. They are approximate by design (a class name
 * inside a comment counts) and are here for ORDER OF MAGNITUDE.
 */

import { type ComparisonSet } from '../types';
import { Button } from '../../primitives/Button';
import { LucideIcon } from '../../LucideIcon';

const Row = ({ children }: { children: preact.ComponentChildren }): preact.JSX.Element => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>{children}</div>
);

export const BUTTON_COMPARISON: ComparisonSet = {
  summary:
    'Three button treatments on the currently-built pages: HR Onboarding, HR/Finance (Aurora) and Settings v2 — plus the v2 rebuild. The HSE and Bootstrap-era treatments are NOT candidates; they belong to legacy pages and are listed for removal.',

  specimens: [
    {
      id: 'A',
      name: '.obx-btn (HR Onboarding)',
      source: 'assets/styles — .obx-btn / .obx-btn.primary / .obx-mini',
      generation: 'recent',
      consumers: 17,
      consumerNote: '17 files, 110 uses. Built with the Onboarding command centre.',
      usedByRecentScreens: true,
      features: ['default / primary', '`.obx-mini` row-action size', 'disabled'],
      a11y: ['Native <button>', 'No loading state'],
      render: () => (
        <Row>
          <button type="button" class="obx-btn primary">+ Add</button>
          <button type="button" class="obx-btn">Cancel</button>
          <button type="button" class="obx-mini">Edit</button>
          <button type="button" class="obx-mini">Delete</button>
        </Row>
      ),
    },
    {
      id: 'B',
      name: '.hrfin-action (HR/Finance "Aurora")',
      source: 'src/ui/hrfin/tokens.css — .hrfin-action / .is-primary',
      generation: 'recent',
      consumers: 25,
      consumerNote: '25 files, 118 uses — the whole Finance surface.',
      usedByRecentScreens: true,
      features: ['default / is-primary', 'icon + label', 'disabled', 'used inside every hrfin dialog footer'],
      a11y: ['Native <button>', 'Loading expressed by swapping the LABEL to "Saving…", not by a spinner'],
      render: () => (
        <div class="hrfin">
          <Row>
            <button type="button" class="hrfin-action is-primary">Create draft</button>
            <button type="button" class="hrfin-action">Back</button>
            <button type="button" class="hrfin-action" disabled>Saving…</button>
          </Row>
        </div>
      ),
    },
    {
      id: 'C',
      name: '.stg-btn-* (Settings v2)',
      source: 'assets/styles/settingsV2.css — .stg-btn-outline / .stg-btn-primary',
      generation: 'recent',
      consumers: 4,
      consumerNote: '4 files, 24 uses. Scoped under `.swz`.',
      usedByRecentScreens: true,
      features: ['outline / primary', 'icon + label'],
      a11y: ['Native <button>', 'Scoped styling, so it cannot be reused outside Settings without the wrapper'],
      render: () => (
        <div class="swz">
          <Row>
            <button type="button" class="stg-btn-primary">Save changes</button>
            <button type="button" class="stg-btn-outline">Reset to inherited</button>
          </Row>
        </div>
      ),
    },
    {
      id: 'D',
      name: 'Canonical Button (UI Kit v2)',
      source: 'src/ui/primitives/Button.tsx + Button.recipe.css',
      generation: 'v2',
      consumers: 6,
      consumerNote: '6 files so far — the kit itself plus the migrated surfaces.',
      usedByRecentScreens: false,
      features: [
        '6 variants · 3 sizes', 'loading + loadingText', 'iconLeft / iconRight / iconOnly',
        'href renders a real <a>', 'pressed renders aria-pressed', 'fullWidth', 'forceState for preview',
      ],
      a11y: [
        'iconOnly REQUIRES aria-label — enforced by the type, not by review',
        'loading sets aria-busy and blocks the click',
        'focus-visible ring from --ui-focus-* tokens',
        'Every interactive rule paired with a [data-ui-state] selector',
      ],
      defects: ['Its visual treatment was chosen by inheritance, not by a design decision — which is what this comparison is for.'],
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Row>
            <Button variant="primary" iconLeft={<LucideIcon name="Plus" />}>New permit</Button>
            <Button variant="secondary">Export</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Delete</Button>
          </Row>
          <Row>
            <Button variant="primary" loading loadingText="Saving…">Save</Button>
            <Button variant="secondary" disabled>Disabled</Button>
            <Button variant="secondary" iconOnly aria-label="More actions" iconLeft={<LucideIcon name="EllipsisVertical" />} />
            <Button variant="link" href="#">Open record</Button>
          </Row>
        </div>
      ),
    },
  ],

  aspects: [
    { id: 'shape',    label: 'Shape & size',     question: 'Height, corner radius and horizontal padding of a default button.' },
    { id: 'primary',  label: 'Primary treatment', question: 'What the main call to action looks like — red fill, navy fill, or something else.' },
    { id: 'secondary',label: 'Secondary/quiet',  question: 'The neutral action: bordered, tinted, or plain text.' },
    { id: 'icons',    label: 'Icon treatment',   question: 'Icon size, gap and whether icons are nodes or class strings.' },
    { id: 'disabled', label: 'Disabled',         question: 'Dimmed, greyed-and-bordered, or flattened.' },
    { id: 'loading',  label: 'Loading',          question: 'Spinner in place of the icon, label swap ("Saving…"), or both.' },
    { id: 'danger',   label: 'Destructive',      question: 'How a destructive action is signalled.' },
  ],

  retire: [
    { name: '.hse-btn', source: 'src/components/sections/HSE/HSE.css',
      usedBy: 'HSE (126) · Notification Centre (7) · HR leftovers (6) · Messages (4) · Finance (1)', uses: 144 },
    { name: '.inc-action-btn', source: 'src/components/sections/HSE/HSE.css',
      usedBy: 'HSE Incidents (41) · Notification Centre (4)', uses: 45 },
    { name: '.btn-danger-primary / .btn-outline-secondary', source: 'assets/styles/base.css',
      usedBy: 'HSE (13) · Employees (2) · Project Sites (2)', uses: 17 },
    { name: '@ui/Button (pre-v2)', source: 'src/ui/components/Button.tsx — already deleted',
      usedBy: '3 files. It had no CSS of its own; it wrapped .inc-action-btn / .hse-btn.', uses: 3 },
  ],

  keepRegardless: [
    'The v2 API surface (one component; iconOnly/link/toggle/loading as props) — the alternative is the eight-wrapper sprawl this replaces.',
    'The type-enforced aria-label on icon-only buttons.',
    'The Button test suite and the [data-ui-state] preview hooks.',
  ],
};
