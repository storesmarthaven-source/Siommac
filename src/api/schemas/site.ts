/**
 * src/api/schemas/site.ts
 *
 * Zod schemas for the Project Site domain.
 *
 * @see docs/ARCHITECTURE.md §Validation
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { z } from 'zod';
import { uuid, isoTimestamp } from './employee';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const SiteStatusSchema = z.enum(['active', 'inactive', 'completed']);

// ── Site Row ──────────────────────────────────────────────────────────────────

export const SiteRowSchema = z.object({
  id:         uuid,
  name:       z.string().min(1).max(200),
  address:    z.string().nullable(),
  latitude:   z.union([z.number(), z.string()]).transform(Number),
  longitude:  z.union([z.number(), z.string()]).transform(Number),
  radius:     z.number().nonnegative().nullable(),
  status:     SiteStatusSchema.nullable(),
  description: z.string().nullable().optional(),
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
});

export type SiteRow = z.infer<typeof SiteRowSchema>;

// ── Create / Update site ──────────────────────────────────────────────────────

export const CreateSiteSchema = z.object({
  name:        z.string().min(1).max(200),
  address:     z.string().max(500).optional(),
  latitude:    z.number().min(-90).max(90),
  longitude:   z.number().min(-180).max(180),
  radius:      z.number().nonnegative().max(50_000).optional(), // metres, max 50 km
  description: z.string().max(1000).optional(),
  status:      SiteStatusSchema.optional().default('active'),
  employee_ids: z.array(uuid).optional(),
});

export type CreateSitePayload = z.infer<typeof CreateSiteSchema>;

export const UpdateSiteSchema = CreateSiteSchema.partial().extend({ id: uuid });
export type UpdateSitePayload = z.infer<typeof UpdateSiteSchema>;

// ── Site member assignment ────────────────────────────────────────────────────

export const AssignSiteMembersSchema = z.object({
  site_id:     uuid,
  user_ids:    z.array(uuid).min(1),
});

export type AssignSiteMembersPayload = z.infer<typeof AssignSiteMembersSchema>;
