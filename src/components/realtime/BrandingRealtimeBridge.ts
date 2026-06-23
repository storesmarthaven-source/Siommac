/**
 * src/components/realtime/BrandingRealtimeBridge.ts
 *
 * Live-branding push. When an admin saves a new logo or company name, every
 * open session reflects it within ~1 second without a page reload.
 *
 * This is deliberately a standalone bridge: it is NOT a notification or badge
 * concern, it just happens to ride the same Supabase Realtime channel. Keeping
 * it here lets the notification/realtime cleanup proceed without disturbing
 * branding, and gives branding a single, testable entry point.
 *
 * Flow: a `settings` UPDATE arrives → fetch the public branding through the
 * authenticated API → apply logo + name to the live DOM (via SettingsView) →
 * patch the session cache so the next reload starts with the fresh branding.
 *
 * @see RealtimeController.ts (calls applyBrandingPush on settings UPDATE)
 */

import { authPost } from '@lib/api';

const SESSION_KEY = 'siomac_session_v1';

interface SettingsViewShim {
  applyCompanyLogo?: (url: string) => void;
  applyCompanyName?: (name: string) => void;
}

function settingsView(): SettingsViewShim | undefined {
  return (window as unknown as Record<string, SettingsViewShim | undefined>)['SettingsView'];
}

/** Patch the cached session so a reload starts with the fresh branding. */
function patchSessionCache(logoUrl: string, name: string): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Record<string, unknown>;
    s['companyLogoUrl'] = logoUrl;
    s['companyName']    = name;
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch { /* non-fatal */ }
}

/**
 * Fetch the latest public branding and push it into the running session.
 * Safe to call on every `settings` UPDATE — failures are swallowed.
 */
export function applyBrandingPush(): void {
  void authPost<{ success: boolean; companyLogoUrl?: string; companyName?: string }>(
    'settings/getPublicBranding', {},
  ).then(res => {
    if (!res.success) return;
    const logoUrl = res.companyLogoUrl ?? '';
    const name    = res.companyName    ?? '';
    const sv = settingsView();
    sv?.applyCompanyLogo?.(logoUrl);
    sv?.applyCompanyName?.(name);
    patchSessionCache(logoUrl, name);
  }).catch(() => { /* non-fatal */ });
}
