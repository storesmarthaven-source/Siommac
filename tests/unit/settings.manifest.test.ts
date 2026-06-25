/**
 * tests/unit/settings.manifest.test.ts
 *
 * Build gate (Spec §32/§39): every registered module settings manifest must
 * validate, setting keys must be globally unique, and every permission a setting
 * references (requiresPermission / minimumManagePermission) must exist in the
 * backend PERMISSION_KEYS catalogue. These modules are pure (no Supabase/env), so
 * we import them directly.
 */

import { moduleSettingsManifests } from '../../netlify/functions/lib/settings/manifests';
import { validateModuleSettingsManifest } from '../../netlify/functions/lib/settings/validateManifest';
import { PERMISSION_KEYS } from '../../netlify/functions/lib/permissions';

const KEYSET = new Set<string>(PERMISSION_KEYS as readonly string[]);

describe('settings manifests build gate', () => {
  it('every registered manifest validates', () => {
    for (const manifest of moduleSettingsManifests) {
      expect(() => validateModuleSettingsManifest(manifest)).not.toThrow();
    }
  });

  it('setting keys are globally unique', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const m of moduleSettingsManifests) {
      for (const s of m.settings) {
        if (seen.has(s.settingKey)) dupes.push(s.settingKey);
        seen.add(s.settingKey);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('every referenced permission exists in the catalogue', () => {
    const missing: string[] = [];
    for (const m of moduleSettingsManifests) {
      for (const s of m.settings) {
        if (!KEYSET.has(s.requiresPermission)) missing.push(`${s.settingKey} → ${s.requiresPermission}`);
        if (s.minimumManagePermission && !KEYSET.has(s.minimumManagePermission)) {
          missing.push(`${s.settingKey} → ${s.minimumManagePermission}`);
        }
      }
    }
    if (missing.length) throw new Error(`Manifest settings reference uncatalogued permissions:\n  ${missing.join('\n  ')}`);
    expect(missing).toEqual([]);
  });
});
