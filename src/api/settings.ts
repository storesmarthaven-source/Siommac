/**
 * src/api/settings.ts
 *
 * Typed Supabase API functions for the Settings domain.
 *
 * @see docs/ARCHITECTURE.md §API-Layer
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { supabase }            from '@lib/supabase';
import { logger }              from '@lib/logger';
import type {
  SettingsMap,
  SaveCompanySettingsPayload,
  SaveStatutoryRatesPayload,
} from './schemas/settings';

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch all app settings as a key-value map.
 * The settings table stores flat string values — callers cast as needed.
 */
export async function getSettingsMap(signal?: AbortSignal): Promise<SettingsMap> {
  const query = supabase
    .from('settings')
    .select('key, value');

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/settings] getSettingsMap failed', { error });
    throw new Error(error.message);
  }

  const map: SettingsMap = {};
  for (const row of data as { key: string; value: string }[]) {
    map[row.key] = row.value;
  }
  return map;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function saveCompanySettings(
  payload: SaveCompanySettingsPayload,
): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'saveSettings',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to save company settings.');
}

export async function saveStatutoryRates(
  payload: SaveStatutoryRatesPayload,
): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'saveStatutoryRates',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to save statutory rates.');
}

/**
 * Upload a company logo to Supabase Storage and return the public URL.
 * The URL is then saved via saveCompanySettings.
 */
export async function uploadCompanyLogo(file: File): Promise<string> {
  const ext      = file.name.split('.').pop() ?? 'png';
  const path     = `company/logo.${ext}`;

  const { error } = await supabase.storage
    .from('company-assets')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (error) {
    logger.error('[api/settings] uploadCompanyLogo failed', { error });
    throw new Error(error.message);
  }

  const { data } = supabase.storage
    .from('company-assets')
    .getPublicUrl(path);

  return data.publicUrl;
}
