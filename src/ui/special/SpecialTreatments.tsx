/**
 * Application-specific treatments shown beside — never inside — the canonical
 * component registry. Keeping this boundary in one component prevents a named
 * treatment from quietly becoming a Button variant or catalogue entry.
 */

import { type VNode } from 'preact';
import { CreditsButton } from './CreditsButton';

export interface SpecialTreatmentsProps {
  /** Canonical component whose foundations the treatment composes. */
  componentId: string;
}

export function SpecialTreatments({ componentId }: SpecialTreatmentsProps): VNode | null {
  if (componentId !== 'button') return null;

  return (
    <section class="sds-ov__sec sds-special" aria-labelledby="special-treatments-title">
      <div class="sds-ov__hd">
        <h4 id="special-treatments-title">Special treatments</h4>
        <p>Custom looks reserved for a named product experience.</p>
      </div>

      <article class="sds-special__card">
        <div class="sds-special__copy">
          <span class="sds-special__eyebrow">Application-specific</span>
          <h5>Credits</h5>
          <p>
            A named animated control for the Credits surface. It composes the
            canonical Button geometry, focus and motion tokens, but is not a
            selectable <code>ButtonVariant</code>.
          </p>
        </div>
        <div class="sds-special__preview">
          <CreditsButton />
        </div>
      </article>
    </section>
  );
}
