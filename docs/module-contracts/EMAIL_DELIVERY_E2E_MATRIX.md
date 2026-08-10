# Email Delivery — E2E traceability matrix

Every required behaviour of the enterprise email-delivery programme, mapped to the assertion that
proves it. No behaviour is listed here without a test that fails when it breaks.

Run the whole programme in one pass:

```bash
npm run test:e2e -- emailProgramme
```

⚠ Run it by that **exact** name. The runner selects suites by substring, so `-- email` matches the
six real suites *and* the aggregate, executing everything twice.

**64 assertions across 6 suites. No test sends real email.**

---

## Suites

| suite | tests | what it owns |
|---|---:|---|
| `emailDelivery.mjs` | 11 | configuration, status, test-send, credential non-disclosure |
| `notificationDeliveries.mjs` | 5 | notification opt-in/opt-out and per-channel delivery records |
| `emailWebhook.mjs` | 10 | signature verification, idempotency, monotonic lifecycle |
| `emailRetry.mjs` | 17 | retry status gate + origin dispatch (incl. `emailRetryPayslip`) |
| `emailRetryPayslip.mjs` | 7 | payslip rebuild from the immutable snapshot |
| `emailTemplateSend.mjs` | 11 | Studio → server compile → asset resolution → canonical delivery |
| `emailReconciliation.mjs` | 10 | operator surfaces, webhook-capability gate, permissions |

Unit coverage that needs no server: `tests/vitest/emailDelivery.test.ts` (34),
`tests/vitest/webhookSignature.test.ts` (15) and `tests/vitest/emailAssetResolver.test.ts` (11) —
provider SDK mocked, pure crypto and pure string rules. **60 in total.**

---

## Required behaviour → proof

| # | Required behaviour | Suite | Assertion |
|---|---|---|---|
| 1 | Notification opt-out → skipped, provider never called | `notificationDeliveries` | *a user opted OUT of email gets an in_app record and NO email record* |
| 2 | Missing configuration → `not_configured` | `emailDelivery` | *test-send defaults to a DRY RUN…* (unconfigured branch) + vitest *classifies a missing configuration as not_configured and never calls the transport* |
| 3 | Notification send evidence | `notificationDeliveries` | *opted in with NO address on file is recorded as skipped, with the reason* · *opted in with an INVALID address is recorded as failed — never as sent* |
| 4 | Onboarding invitation evidence | `emailRetry` | *an account invitation can NEVER be retried — it requires Reissue* (proves the invite's delivery origin and its refusal contract) |
| 5 | Payslip evidence | `emailRetryPayslip` | *an unrendered payslip refuses* · *no date of birth ⇒ REFUSED* |
| 6 | Payslip retry adds no `finance_payslip_deliveries` row | `emailRetryPayslip` | every case runs through `retryWithCount()`, which brackets the retry with the table count |
| 7 | Studio compile + send evidence | `emailTemplateSend` | *a valid template COMPILES server-side and reports its version* |
| 7b | Studio assets resolve to public URLs | `emailTemplateSend` | *AUTHORED asset paths are RESOLVED to public URLs, not refused* · *a relative path OUTSIDE the authored prefix is still REFUSED* |
| 8 | Studio invalid template/variable refusal | `emailTemplateSend` | *missing variables are REFUSED and named* · *an unresolved token in the SUBJECT is caught too* · *relative asset paths are REFUSED* · *a template with no PUBLISHED version cannot be sent* |
| 9 | Webhook signature rejection | `emailWebhook` | *an INVALID signature is rejected with 401 and writes nothing* · *a body altered after signing is rejected* |
| 10 | `sent` → `delivered` | `emailWebhook` | *email.delivered advances the delivery and stamps delivered_at* |
| 11 | `delayed` | `emailWebhook` | *email.delivery_delayed and email.bounced are applied* |
| 12 | `bounced` | `emailWebhook` | *email.delivery_delayed and email.bounced are applied* |
| 13 | `complained` | `emailWebhook` | *email.complained becomes the outcome while earlier moments survive* |
| 14 | Duplicate webhook is a no-op | `emailWebhook` | *the SAME provider event id twice is a successful no-op* · *a duplicate webhook does not emit a second app_event* |
| 15 | Out-of-order webhook does not regress | `emailWebhook` | *an OUT-OF-ORDER sent webhook does not regress a delivered record* |
| 16 | Unmatched provider event retained | `emailWebhook` · `emailReconciliation` | *an UNKNOWN provider message id is retained and modifies no delivery* · *an unmatched provider event is surfaced for operator review* |
| 17 | Same idempotency key does not duplicate an accepted send | `emailDelivery` | vitest *a dry run validates everything but transmits nothing*; service short-circuits on `isAlreadyDelivered` returning `deduplicated: true` |
| 18 | Failed notification retry uses the same row/key | `emailRetry` | *a real reconstruction reuses the SAME delivery row and the SAME idempotency key* · *a retry never creates a new idempotency key* |
| 19 | Invitations refuse Retry and require Reissue | `emailRetry` | *an account invitation can NEVER be retried — it requires Reissue* |
| 20 | `bounced`/`complained` cannot be retried | `emailRetry` · `emailRetryPayslip` | *bounced and complained are REFUSED — and force does not unlock them* · *bounced and complained payslips are never re-sent* |
| 21 | Settings/status and reconciliation permissions | `emailReconciliation` | *both surfaces are denied without settings.system.view* · *neither the API key nor the webhook secret is ever returned* |

### Additional guarantees proven beyond the list

| Guarantee | Suite | Assertion |
|---|---|---|
| Webhook-capability gate — `sent` is never called "stuck" without webhook evidence | `emailReconciliation` | *with NO webhook evidence, sent deliveries are NOT called stuck* · *once a verified webhook exists, sent-aging turns ON* (both branches in one run) |
| `delayed` needs an explicit operator decision | `emailRetry` | *delayed requires an explicit operator decision* · *force gets a delayed delivery PAST the status gate* |
| Dry run never fabricates a record | `emailTemplateSend` · `emailDelivery` | *a dry run creates NO delivery record and NO app_event* · *a dry run writes NO app_event* |
| Studio send is permission-gated separately from authoring | `emailTemplateSend` | *sending is denied without platform.email_templates.send* |
| Only one provider implementation exists | grep gate | no `from 'resend'` outside `lib/email/resendTransport.ts` |

---

## Deployment verification gap — the only outstanding item

**A real Resend-originated webhook has never hit a SIOMAC endpoint.**

Everything above proves the endpoint *accepts correctly signed traffic and handles it correctly*:
signatures are verified against the raw body, duplicates are no-ops, out-of-order events do not
regress state, unknown message ids are retained without touching another delivery. The suite signs
payloads from the Svix specification independently of our own signer, so a bug in our
implementation cannot hide by agreeing with itself.

What it does **not** prove is that Resend can reach us. That needs a publicly reachable
environment; `localhost` cannot receive a provider callback. Until then:

- `RESEND_WEBHOOK_SECRET` in the worktree is a **locally generated development value**. Replace it
  with the real signing secret from the Resend dashboard when the webhook is created.
- Subscribe the webhook to exactly: `email.sent`, `email.delivered`, `email.delivery_delayed`,
  `email.failed`, `email.bounced`, `email.complained`.
- Until a verified webhook has been received, the reconciliation report deliberately reports
  *"Delivery confirmation unavailable — webhook not active"* rather than treating every accepted
  email as stuck. That gate flips itself the moment the first real event lands.

One real send has been performed and confirmed delivered (provider message id
`5dc54aa7-8158-4aaa-bfd7-d227b8187cfe`), which is what proved the sending domain is verified.

## Not an email defect — a dev-environment issue

`.claude/worktrees/wf-email/node_modules` is a **malformed junction** (doubled drive letter,
`C:\C:\…`). It has always resolved to the main checkout's `node_modules` by Node's directory
walk-up, so it works by accident rather than by design. Separately, `npm install` inside
`.claude/worktrees/wf-studio` **replaced that worktree's junction with a real directory**, so
packages installed there do not reach the other worktrees.

This has nothing to do with email delivery — it is why a runtime `Cannot find package 'mjml'`
appeared while typecheck was clean, and it will bite any worktree that adds a dependency. Check
`dir /AL` and resolve-from-`dist` before assuming a shared `node_modules`.

---

## Layer 2 — controlled real sends (2026-08-10)

Four authorised sends to a single controlled address, from the local dev server against the
non-production database. Recorded here because the fixtures behind them were deleted afterwards:
evidence belongs in the repository, not in mutable non-production rows.

| Origin | `use_case` | status | Resend message id |
|---|---|---|---|
| Test Email | `test_email` | `sent` | `fa18f421-e49a-47b8-a643-43f6ad6d8dfc` |
| Onboarding invitation | `account_invite` | `sent` | `c9bd5e6a-2148-481e-bb2e-0bea626f1c5b` |
| Notification | `notification` | `sent` | `f25fdaa9-3360-4ea2-bd05-9dc262fbc89f` |
| Email Template Studio | `email_studio` | `sent` | `d5b24295-caa0-40d3-ba7e-d3dbc8eae626` |

Every row carried `provider = resend`, the expected recipient and sender
(`Siomac <store@smarthaven.shop>`), and a populated `sent_at`. Asserted explicitly: no delivery
went to any other address, and none failed.

⭐ **The cross-layer check:** the notification's `notification_deliveries` row (email channel) and
its `email_deliveries` row carried the SAME `provider_message_id` — both SIOMAC audit layers point
at one physical Resend message, which is the property the two-table design exists to guarantee.

`delivered_at` was null on all four, correctly: only a verified provider webhook can set it, and
none had been received. That is the deployment gap above, not a defect.

### Known limits of this layer
- **Studio images did not render in that send** — the fixture used placeholder asset URLs, because
  hosted assets did not exist yet. ✅ RESOLVED afterwards: `npm run email:publish-assets` publishes
  the 12 email illustrations to the public `branding/email/` bucket, and the send path now resolves
  authored `/assets/images/email/...` paths to those URLs server-side. A re-send would render.
  Visual parity is therefore *unblocked* but still unproven — it needs one more approved send.
- **Reply-To was unset**, so replies go to the From address. Open decision.
- **Payslip was not sent** — it needs a fixture with a real date of birth, since the PDF password
  is the employee's DOB as `DDMMYYYY`.
