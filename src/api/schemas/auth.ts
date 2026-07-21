/**
 * src/api/schemas/auth.ts
 *
 * Zod schemas for authentication payloads and session shapes.
 *
 * VALIDATION PHILOSOPHY (per docs/CODING_STANDARDS.md §P1):
 *   - Validate at every trust boundary — login response, session hydration,
 *     permission override rows from DB.
 *   - Never throw on parse — callers use safeParse() and handle errors.
 *   - All inferred TypeScript types live here; no duplicate interfaces.
 *
 * @see docs/ARCHITECTURE.md §9-Authentication-&-Session
 * @see docs/CODING_STANDARDS.md §2-TypeScript-Rules
 * @see docs/SECURITY.md §2-Current-Vulnerabilities
 * @see docs/PHASE_PLAN.md §Phase-2b
 */

import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const UserRoleSchema = z.enum([
  'superadmin', 'admin', 'manager', 'employee',
  // Module-specific staff roles (flat; each inherits the employee baseline).
  'hr_staff', 'hr_manager', 'hse_staff',
  'finance_staff', 'finance_manager',
]);
export type  UserRole       = z.infer<typeof UserRoleSchema>;

// ── Login payload ─────────────────────────────────────────────────────────────

export const LoginPayloadSchema = z.object({
  username: z.string().min(1, 'Username is required').max(50),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional().default(false),
});

export type LoginPayload = z.infer<typeof LoginPayloadSchema>;

// ── 2FA payloads ──────────────────────────────────────────────────────────────

export const Verify2faPayloadSchema = z.object({
  preAuthToken: z.string().min(1),
  code:         z.string().length(6, 'TOTP code must be 6 digits').regex(/^\d+$/),
});

export type Verify2faPayload = z.infer<typeof Verify2faPayloadSchema>;

export const ConfirmSetupPayloadSchema = z.object({
  preAuthToken: z.string().min(1),
  code:         z.string().length(6).regex(/^\d+$/),
});

export type ConfirmSetupPayload = z.infer<typeof ConfirmSetupPayloadSchema>;

// ── Auth response — full session granted ─────────────────────────────────────

export const FullSessionSchema = z.object({
  token:          z.string().min(1),
  // Server-authoritative access-token expiry (the refresh token itself is an
  // httpOnly cookie — deliberately absent from the JSON payload).
  expiresAt:      z.number().optional(),
  userId:         z.string().min(1),
  username:       z.string().min(1),
  fullName:       z.string(),
  role:           UserRoleSchema,
  departmentId:   z.string().nullable().optional(),
  position:       z.string().nullable().optional(),
  profileImage:   z.string().nullable().optional(),
  companyName:    z.string().nullable().optional(),
  companyLogoUrl: z.string().nullable().optional(),
  colorScheme:    z.string().optional().default('navy'),
  layoutMode:     z.string().optional().default('sidebar'),
});

export type FullSession = z.infer<typeof FullSessionSchema>;

// ── Auth response — 2FA required ─────────────────────────────────────────────

export const TwoFactorRequiredSchema = z.object({
  requiresTwoFactor: z.literal(true),
  preAuthToken:      z.string().min(1),
});

export const TwoFactorSetupRequiredSchema = z.object({
  requiresSetup: z.literal(true),
  preAuthToken:  z.string().min(1),
  qrCode:        z.string().optional(),
  manualCode:    z.string().optional(),
});

// ── Permission override row (from user_permissions table) ─────────────────────

/**
 * Format: `resource.action` — e.g. `employees.view`, `leaves.approve`
 * See docs/PHASE_PLAN.md §Phase-2b for the full permission key catalogue.
 */
export const PermissionKeySchema = z.string().regex(
  /^[a-z_]+\.[a-z_]+$/,
  'Permission key must follow "resource.action" format (lowercase, underscores allowed)',
);

export type PermissionKey = z.infer<typeof PermissionKeySchema>;

export const PermissionOverrideSchema = z.object({
  // app_users.id is TEXT (not a UUID) — e.g. 'admin'. Never tighten to z.uuid()
  // or real user ids get rejected and the override is silently dropped.
  user_id:    z.string(),
  permission: PermissionKeySchema,
  granted:    z.boolean(),   // true = explicitly granted, false = explicitly denied
  // Time-boxing + revocation for grant-required (compliance) keys. Null for the
  // ordinary allow/deny overrides that have no validity window.
  valid_from:  z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  revoked_at:  z.string().nullable().optional(),
  // Provenance — who set the override and when. Nullable: the backend sends null
  // when the columns are unset; unused by the resolver, surfaced in Account Security.
  set_by:     z.string().nullable().optional(),         // setter id
  set_at:     z.string().nullable().optional(),
});

export type PermissionOverride = z.infer<typeof PermissionOverrideSchema>;
