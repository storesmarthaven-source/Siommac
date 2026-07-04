# SIOMAC Widget — Acceptance Checklist

Approve a new widget (code or declarative) or a widget package only when **every** applicable box is
checked. Groups map to the enterprise blueprint sections. This is the gate referenced by
`SIOMAC_ENTERPRISE_WIDGET_SYSTEM_IMPLEMENTATION.md` §31.

## A. Registration & identity
- [ ] Registered via a `registry.<module>.tsx` package (code) OR a validated declarative package.
- [ ] `id` is globally unique (dotted, module-prefixed, e.g. `finance.payroll.run_status`); no duplicate.
- [ ] `module` is one of the ACTIVE set: `hr | finance | hse | platform`. **No legacy module/API.**
- [ ] `version` / `packageId` / `schemaVersion` set (packaged widgets).

## B. Sizing & responsiveness
- [ ] `defaultSize` is within `allowedSizes`.
- [ ] `allowedSizes` use the enterprise names (`mini|small|medium|large|wide|tall|full`); deprecated
      aliases normalized.
- [ ] `contentPriorityRules` declared; renders correctly at **every** allowed size (no clipping/overflow).
- [ ] Density behavior verified: charts simplify, legends move to tooltip below medium, labels truncate,
      actions collapse to a menu below large, numbers abbreviate below medium.

## C. States (mandatory)
- [ ] **loading** = `skeleton-shimmer` sized to footprint (never a fake `0`/empty chart).
- [ ] **empty** = icon + one-line reason (+ permission-gated CTA only).
- [ ] **error** = compact inline error + `refresh()`; wrapped in an error boundary; board survives a throw.
- [ ] **stale** handled where realtime/slow refresh applies.
- [ ] **locked** / **unavailable** render a placeholder (no data fetch) where relevant.

## D. Data contract (reuse-hooks)
- [ ] Fetches ONLY via the module's declared TanStack hook(s); no generic/ad-hoc fetch in nested UI.
- [ ] `dataSource` declares `dataSourceType`, `sourceKey`, `apiRoute` (if any), `requiredPermissions`,
      `refreshIntervalMs`/`realtimeChannel` as applicable.
- [ ] Realtime only **refetches** — the authorized source is the JWT API (§2 CLAUDE.md), never realtime.

## E. Permissions & actions
- [ ] `requiredPermissions` non-empty; every key is an **exact** RBAC catalogue string
      (e.g. `hse.ptw.view`, not `hse.permits.view`).
- [ ] Widget does not mount / is locked when the user lacks a view key.
- [ ] Each action has its own `permission`; actions are **omitted** (not just disabled) without it.
- [ ] Verified: view ≠ action (e.g. can view Payroll Run Status but Lock requires `finance.payroll.lock`).
- [ ] No mutation path bypasses the action permission.

## F. Config
- [ ] `configSchema` fields have `key`, `label`, `type`, `defaultValue`, `editableBy`, and `validation`
      where needed.
- [ ] `editableBy:'admin'` fields are hidden from the user configure modal.
- [ ] Config validated on save (client + server); unknown keys dropped (no accept-and-drop).

## G. Theming & design
- [ ] Uses shared tokens + module accent (`--wgt-*`); **no** bespoke palette.
- [ ] Follows the standard anatomy for `chrome:'standard'` (icon/title/value/subtext/status/chart/
      action-menu/footer); `chrome:'none'` widgets still consume tokens.
- [ ] Scoped CSS only (namespaced); no global style injection.
- [ ] Dark-mode / high-contrast are token swaps only (no hard-coded colors).

## H. Animation
- [ ] Uses only allowed presets; motion is subtle (mount ≤ 240ms).
- [ ] `prefers-reduced-motion: reduce` disables all non-essential motion.
- [ ] Animation never blocks data loading; widget interactive as soon as data is ready.
- [ ] `count-up` only on a KPI value change (diff-driven), not first mount.
- [ ] Chart animation suppressed for realtime / refresh < 15s.
- [ ] `alert-pulse` is brief (≤ 3 pulses) then rests; no perpetual motion.

## I. Runtime safety
- [ ] A thrown widget renders the error state and does not crash the board or siblings.
- [ ] Unknown/uninstalled widget id renders a locked "unavailable" placeholder (preserves the slot).
- [ ] HTML design widgets run only in the CSP-locked sandbox iframe (no network/app access).

## J. Governance
- [ ] Package/widget can be enabled/disabled, role-restricted, module-restricted, locked, hidden via
      `ui_widget_policy`.
- [ ] Lifecycle events (install/uninstall/update/enable/disable/config change) write `audit_logs`.
- [ ] `installPermission` enforced; non-admin cannot install/govern.

## K. Packaging (packaged widgets)
- [ ] `widget-package.json` validates against `WIDGET_PACKAGE_MANIFEST_SCHEMA.json`.
- [ ] `requiredPermissions` ⊆ RBAC catalogue; `requiredRoutes` ⊆ registered backend routes (fail-atomic).
- [ ] `compatibleSiomacVersion` set; dependencies present.
- [ ] Install is atomic; uninstall preserves instances disabled (default); update migrates config +
      preserves geometry.

## L. Testing
- [ ] Unit tests: renders at every allowed size; all states; permission show/hide; action gating.
- [ ] Animation tests: reduced-motion, realtime suppression, count-up-on-change.
- [ ] Package/governance E2E (`scripts/e2e/suites/widgets.mjs`): install (valid+invalid), enable/disable,
      role restrict, update (config migration + geometry), uninstall (preserve), audit rows, access control.
- [ ] Layout persistence: save/load/reset/default; preview never persisted.
- [ ] Full vitest + E2E suite green before "done".

## M. Migration (when replacing a legacy card)
- [ ] The board widget shows the same KPI(s) as the card it replaces.
- [ ] Existing user layouts preserved (stable instanceIds) or a matching default layout seeded.
- [ ] The legacy card component is deleted (no dual system).

---

**Sign-off:** a widget is "done" only when A–L (and M if migrating) are fully checked and the full test
suite is green. Anything partial stays out of the catalogue.
