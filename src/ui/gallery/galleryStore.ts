/** Draft state and authenticated control-plane workflow for Design System Studio. */
import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  applyScopedOverrides, clearAllScopedOverrides, readScopedTokenValue,
  applyThemeOverrides, cacheTheme, type ThemeOverrides,
} from '../theme/applyTheme';
import {
  configurationToOverrides, emptyDesignSystemConfiguration,
  type DesignSystemConfigurationV1, type DesignSystemDraft, type DesignSystemRevision,
  type DesignSystemValidation,
} from '../../../types/designSystem';
import {
  loadDesignSystemStudio, loadDesignSystemHistory, publishDesignSystemDraft,
  rollbackDesignSystem, saveDesignSystemDraft,
} from '@api/theme';

const RECOVERY_KEY = 'siomac.uikit.draft-recovery';

export interface GalleryDraft {
  values: ThemeOverrides;
  dirtyCount: number;
  read: (name: string) => string;
  set: (name: string, value: string) => void;
  link: (name: string, previewValue: string) => void;
  replaceGroup: (owned: readonly string[], values: ThemeOverrides) => void;
  revert: (name: string) => void;
  resetAll: () => void;
  loading: boolean;
  saving: boolean;
  error: string | null;
  publishedVersion: number;
  serverDraft: DesignSystemDraft | null;
  validation: DesignSystemValidation | null;
  publishBlockers: readonly string[];
  setPublishBlockers: (source: string, blockers: readonly string[]) => void;
  saveDraft: () => Promise<DesignSystemDraft>;
  publish: (summary?: string) => Promise<void>;
  history: () => Promise<DesignSystemRevision[]>;
  rollback: (version: number, summary: string) => Promise<void>;
  attachScope: (el: HTMLElement | null) => void;
  exportJson: () => string;
  exportCss: () => string;
  importJson: (json: string) => { ok: true; count: number } | { ok: false; error: string };
}

function readRecovery(): ThemeOverrides {
  try { return JSON.parse(localStorage.getItem(RECOVERY_KEY) ?? '{}') as ThemeOverrides; }
  catch { return {}; }
}

function storeRecovery(values: ThemeOverrides): void {
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify(values)); } catch { /* browser recovery is best-effort */ }
}

function cloneConfiguration(value: DesignSystemConfigurationV1): DesignSystemConfigurationV1 {
  return JSON.parse(JSON.stringify(value)) as DesignSystemConfigurationV1;
}

export function useGalleryDraft(): GalleryDraft {
  const [values, setValues] = useState<ThemeOverrides>(readRecovery);
  const [scopeEl, setScopeEl] = useState<HTMLElement | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [previewLinks, setPreviewLinks] = useState<ThemeOverrides>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<DesignSystemRevision>({
    version: 0, configuration: emptyDesignSystemConfiguration(), publishedAt: null, publishedBy: null, summary: null,
  });
  const [serverDraft, setServerDraft] = useState<DesignSystemDraft | null>(null);
  const [validation, setValidation] = useState<DesignSystemValidation | null>(null);
  const [blockersBySource, setBlockersBySource] = useState<Record<string, readonly string[]>>({});
  const publishBlockers = Object.values(blockersBySource).flat();
  const setPublishBlockers = useCallback((source: string, blockers: readonly string[]) => {
    setBlockersBySource(previous => ({ ...previous, [source]: [...blockers] }));
  }, []);

  const attachScope = useCallback((el: HTMLElement | null) => { setScopeEl(el); }, []);

  useEffect(() => {
    if (!scopeEl) return;
    clearAllScopedOverrides(scopeEl);
    applyScopedOverrides(scopeEl, values);
    applyScopedOverrides(scopeEl, previewLinks);
  }, [values, previewLinks, scopeEl]);
  useEffect(() => { storeRecovery(values); }, [values]);

  useEffect(() => {
    void (async () => {
      try {
        const state = await loadDesignSystemStudio();
        setPublished(state.published);
        setServerDraft(state.draft);
        setValidation(state.draft?.validation ?? null);
        if (state.draft) {
          const base = configurationToOverrides(state.published.configuration);
          const saved = configurationToOverrides(state.draft.configuration);
          const delta: ThemeOverrides = {};
          for (const [name, value] of Object.entries(saved)) if (base[name] !== value) delta[name] = value;
          setRemoved(new Set(Object.keys(base).filter(name => !(name in saved))));
          setValues(delta);
        }
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Studio persistence is unavailable.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const read = useCallback((name: string) => previewLinks[name] ?? values[name] ?? readScopedTokenValue(scopeEl, name), [previewLinks, values, scopeEl]);
  const set = useCallback((name: string, value: string) => {
    setRemoved(prev => { const next = new Set(prev); next.delete(name); return next; });
    setPreviewLinks(prev => { const next = { ...prev }; Reflect.deleteProperty(next, name); return next; });
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);
  const link = useCallback((name: string, previewValue: string) => {
    setRemoved(prev => new Set(prev).add(name));
    setValues(prev => { const next = { ...prev }; Reflect.deleteProperty(next, name); return next; });
    setPreviewLinks(prev => ({ ...prev, [name]: previewValue }));
  }, []);
  const replaceGroup = useCallback((owned: readonly string[], next: ThemeOverrides) => {
    setValues(prev => {
      const out = { ...prev };
      for (const name of owned) Reflect.deleteProperty(out, name);
      return { ...out, ...next };
    });
  }, []);
  const revert = useCallback((name: string) => {
    setValues(prev => { const next = { ...prev }; Reflect.deleteProperty(next, name); return next; });
    setPreviewLinks(prev => { const next = { ...prev }; Reflect.deleteProperty(next, name); return next; });
    setRemoved(prev => { const next = new Set(prev); next.delete(name); return next; });
  }, []);
  const resetAll = useCallback(() => { clearAllScopedOverrides(scopeEl); setValues({}); setPreviewLinks({}); setRemoved(new Set()); setBlockersBySource({}); }, [scopeEl]);

  const configuration = useCallback((): DesignSystemConfigurationV1 => {
    const next = cloneConfiguration(published.configuration);
    for (const name of removed) {
      Reflect.deleteProperty(next.theme.tokens, name);
      Reflect.deleteProperty(next.recipes.button.overrides, name);
    }
    for (const [name, value] of Object.entries(values)) {
      if (name.startsWith('--ui-button-') || name.startsWith('--ui-toggle-')) next.recipes.button.overrides[name] = value;
      else next.theme.tokens[name] = value;
    }
    return next;
  }, [published, removed, values]);

  const saveDraft = useCallback(async (): Promise<DesignSystemDraft> => {
    if (loading) throw new Error('Studio configuration is still loading.');
    setSaving(true); setError(null);
    try {
      const saved = await saveDesignSystemDraft(configuration(), serverDraft?.revision ?? 0);
      setServerDraft(saved); setValidation(saved.validation); return saved;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Draft save failed.'); throw reason;
    } finally { setSaving(false); }
  }, [configuration, serverDraft, loading]);

  const publish = useCallback(async (summary = 'Design system update from Studio') => {
    if (loading) throw new Error('Studio configuration is still loading.');
    if (publishBlockers.length > 0) throw new Error(publishBlockers.join(' '));
    setSaving(true); setError(null);
    try {
      const saved = await saveDesignSystemDraft(configuration(), serverDraft?.revision ?? 0);
      const next = await publishDesignSystemDraft(saved.id, saved.revision, summary);
      setPublished(next); setServerDraft(null); setValidation(null);
      const runtime = configurationToOverrides(next.configuration);
      applyThemeOverrides(runtime); cacheTheme(runtime); clearAllScopedOverrides(scopeEl); setValues({}); setPreviewLinks({}); setRemoved(new Set()); setBlockersBySource({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Publish failed.'); throw reason;
    } finally { setSaving(false); }
  }, [configuration, serverDraft, scopeEl, loading, publishBlockers]);

  const history = useCallback(async () => {
    return loadDesignSystemHistory();
  }, []);
  const rollback = useCallback(async (version: number, summary: string) => {
    setSaving(true); setError(null);
    try {
      const next = await rollbackDesignSystem(version, summary);
      setPublished(next); setServerDraft(null); setValidation(null); setValues({}); setPreviewLinks({}); setRemoved(new Set()); setBlockersBySource({});
      const runtime = configurationToOverrides(next.configuration);
      applyThemeOverrides(runtime); cacheTheme(runtime); clearAllScopedOverrides(scopeEl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rollback failed.'); throw reason;
    } finally { setSaving(false); }
  }, [scopeEl]);

  const exportJson = useCallback(() => JSON.stringify(configuration(), null, 2), [configuration]);
  const exportCss = useCallback(() => `:root {\n${Object.entries(values).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`, [values]);
  const importJson = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false as const, error: 'Expected a JSON object.' };
      const clean: ThemeOverrides = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (k.startsWith('--') && typeof v === 'string') clean[k] = v;
      if (!Object.keys(clean).length) return { ok: false as const, error: 'No CSS custom properties found.' };
      setValues(clean); return { ok: true as const, count: Object.keys(clean).length };
    } catch { return { ok: false as const, error: 'Invalid JSON.' }; }
  }, []);

  return {
    values, dirtyCount: Object.keys(values).length + removed.size, read, set, link, replaceGroup, revert, resetAll,
    loading, saving, error, publishedVersion: published.version, serverDraft, validation, publishBlockers, setPublishBlockers,
    saveDraft, publish, history, rollback, attachScope, exportJson, exportCss, importJson,
  };
}
