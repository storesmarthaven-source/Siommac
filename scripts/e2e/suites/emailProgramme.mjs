/**
 * scripts/e2e/suites/emailProgramme.mjs — the whole email-delivery programme, in one run.
 *
 *   npm run test:e2e -- emailProgramme
 *
 * ⭐ THIS SUITE CONTAINS NO TESTS OF ITS OWN. It imports the six real suites and runs them against
 * the same harness, so the aggregate is the SAME assertions rather than a seventh copy of them.
 * Duplicating them to create a consolidated run would double the maintenance and, worse, let the
 * copy drift from the original while both stayed green.
 *
 * Traceability from each required behaviour to the assertion that proves it:
 *   docs/module-contracts/EMAIL_DELIVERY_E2E_MATRIX.md
 *
 * ⚠ Run it by its EXACT name. The runner selects by substring, so `-- email` matches the six
 * suites AND this aggregate, and would execute every test twice.
 *
 * ⛔ NO REAL EMAIL is sent by any suite below. Every path is a refusal, a dry run, or an outcome
 * that stops before the provider is contacted.
 */

import notificationDeliveries from './notificationDeliveries.mjs';
import emailDelivery from './emailDelivery.mjs';
import emailWebhook from './emailWebhook.mjs';
import emailReconciliation from './emailReconciliation.mjs';
import emailRetry from './emailRetry.mjs';
import emailRetryPayslip from './emailRetryPayslip.mjs';
import emailTemplateSend from './emailTemplateSend.mjs';

export const title = 'Platform — EMAIL DELIVERY PROGRAMME (aggregate)';

/**
 * Order is deliberate: configuration and the send path first, then the provider lifecycle, then
 * the operator surfaces that read what the earlier suites produced. A failure early therefore
 * explains the failures after it, instead of the reverse.
 */
const SUITES = [
  ['Canonical send + configuration', emailDelivery],
  ['Notification delivery evidence', notificationDeliveries],
  ['Provider webhooks + lifecycle', emailWebhook],
  ['Retry dispatch', emailRetry],
  ['Payslip retry', emailRetryPayslip],
  ['Email Template Studio send', emailTemplateSend],
  ['Reconciliation + settings/status', emailReconciliation],
];

export default async function run(h) {
  for (const [label, suite] of SUITES) {
    h.section(`▣ ${label}`);
    await suite(h);
  }
}
