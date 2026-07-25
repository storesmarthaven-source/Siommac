/**
 * src/components/sections/Finance/payroll/setup/SodChainDialog.tsx
 *
 * The payroll approval chain, drawn as a governance timeline. One row per seat —
 * Prepare → Certify → Approve → Fund → Release — showing the REAL people who can
 * fill it (avatar + name via the shared employee lookup, never a raw id) and,
 * with the visual emphasis, which earlier seats it must be a DIFFERENT person
 * from at the active segregation-of-duties level.
 *
 * The separation rules are derived server-side from the same permissions the
 * release-chain RPCs enforce, so the picture cannot drift from what the database
 * actually does — and because it reads the same query as the Governance panel, it
 * redraws the moment a level change is approved.
 */

import { type VNode, Fragment } from 'preact';
import './sodChain.css';
import { Modal } from '@ui/components/Modal';
import { Avatar } from '@/components/shared/Avatar';
import { useEmployeeNames } from '@api/finance/lookups';
import type { PayrollSodChainStep } from '@api/finance/payroll';

/** Short seat names for the "must differ from" chips. */
const SEAT_SHORT: Record<PayrollSodChainStep['key'], string> = {
  prepare: 'Prepare', certify: 'Certify', approve: 'Approve',
  fund: 'Fund', release: 'Release',
};

export function SodChainDialog({ chain, level, onClose }: {
  chain: PayrollSodChainStep[];
  level: number;
  onClose: () => void;
}): VNode {
  // One batched lookup for everyone in the chain.
  const allIds = [...new Set(chain.flatMap(s => s.holderIds))];
  const { data: people } = useEmployeeNames(allIds);
  const nameOf = (id: string): string => people?.get(id)?.fullName ?? id;

  return (
    <Modal open size="lg" title="Payroll approval chain" icon="fa-shield-halved"
      sub={`${level}-person segregation of duties`} onClose={onClose} cancelLabel="Close">
      <div class="sodc">
        <div class="sodc-band">
          <span class="sodc-band-num">{level}<span>PEOPLE</span></span>
          <p>
            Each step needs someone who holds that capability. Steps marked{' '}
            <strong>≠</strong> must be carried out by a <strong>different person</strong> from the
            steps named — enforced in the database, not just here.
          </p>
        </div>

        <div class="sodc-rail">
          {chain.map((step, i) => {
            const separated = step.mustDifferFrom.length > 0;
            const shown = step.holderIds;
            const hidden = step.holderCount - shown.length;
            return (
              <div class={`sodc-row${separated ? ' is-separated' : ''}`} key={step.key}>
                <div class="sodc-node">
                  <span class="sodc-dot">{i + 1}</span>
                </div>

                <div class="sodc-main">
                  <div class="sodc-title">
                    <h4>{step.label}</h4>
                    {separated ? (
                      <span class="sodc-rules">
                        {step.mustDifferFrom.map(k => (
                          <span class="sodc-rule" key={k}
                            title={`Must be a different person from the ${SEAT_SHORT[k].toLowerCase()} step`}>
                            <i>≠</i>{SEAT_SHORT[k]}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span class="sodc-free">no separation required</span>
                    )}
                  </div>
                  <p class="sodc-detail">{step.detail}</p>
                </div>

                <div class="sodc-people">
                  {step.holderCount === 0 ? (
                    <span class="sodc-none">Nobody holds this</span>
                  ) : (
                    <>
                      <span class="sodc-avatars">
                        {shown.map(id => (
                          <Avatar key={id} size={26} name={nameOf(id)}
                            src={people?.get(id)?.imageUrl ?? undefined} />
                        ))}
                        {hidden > 0 && <span class="sodc-more">+{hidden}</span>}
                      </span>
                      <span class="sodc-count">
                        {step.holderCount === 1 ? nameOf(shown[0]!) : `${step.holderCount} eligible`}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p class="sodc-note">
          <strong>Runs keep the level they started under.</strong> A change applies to runs created
          afterwards — a run already in progress is still judged by the chain it began with, so nobody
          is locked out mid-payroll.
        </p>
      </div>
    </Modal>
  );
}
