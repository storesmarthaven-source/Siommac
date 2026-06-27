/**
 * src/ui/examples/ThemeEditor.tsx
 *
 * Superadmin token theme editor (tokens-only). Edits the design-system tokens
 * live — colours, status family (+ strong/tint), spacing, radius, typography —
 * and the WHOLE app (including hover/focus states, which reference the same
 * tokens) updates instantly. Saving persists app-wide via the settings KV.
 *
 * Rendered inside the UI Kit tab; the catalog below doubles as live preview.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { Button } from '../components/Button';
import { StatusPill } from '../components/StatusPill';
import { TOKEN_GROUPS, ALL_TOKEN_NAMES, type TokenDef } from '../theme/tokens';
import {
  applyThemeOverrides, clearThemeOverride, clearThemeOverrides,
  readTokenValue, cacheTheme, type ThemeOverrides,
} from '../theme/applyTheme';
import { loadThemeTokens, saveThemeTokens } from '@api/theme';
import { ColorField } from './ColorField';

export function ThemeEditor(): VNode {
  const [overrides, setOverrides] = useState<ThemeOverrides>({});
  const [saving, setSaving]   = useState(false);
  const [status, setStatus]   = useState<{ tone: 'positive' | 'negative' | 'info'; msg: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  // Load saved overrides once so the editor reflects the persisted theme.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const saved = await loadThemeTokens();
        if (alive && saved) { applyThemeOverrides(saved); setOverrides(saved); }
      } catch { /* defaults stand */ }
    })();
    return () => { alive = false; };
  }, []);

  const dirtyCount = Object.keys(overrides).length;

  /** Current display value for a token: the override if set, else the live default. */
  function valueOf(name: string): string {
    return overrides[name] ?? readTokenValue(name);
  }

  function setToken(name: string, value: string): void {
    applyThemeOverrides({ [name]: value });
    setOverrides(prev => ({ ...prev, [name]: value }));
    setStatus(null);
  }

  function revertToken(name: string): void {
    clearThemeOverride(name);
    setOverrides(prev => { const next = { ...prev }; delete next[name]; return next; });
    setStatus(null);
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await saveThemeTokens(overrides);
      cacheTheme(overrides);
      setStatus({ tone: 'positive', msg: dirtyCount === 0 ? 'Reset to defaults — saved app-wide.' : `Saved ${dirtyCount} override${dirtyCount === 1 ? '' : 's'} app-wide.` });
    } catch (e) {
      setStatus({ tone: 'negative', msg: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  function resetAll(): void {
    clearThemeOverrides(ALL_TOKEN_NAMES);
    setOverrides({});
    setStatus({ tone: 'info', msg: 'Reverted to defaults — click Save to persist.' });
  }

  function applyImport(): void {
    try {
      const parsed = JSON.parse(importText) as ThemeOverrides;
      const clean: ThemeOverrides = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (ALL_TOKEN_NAMES.includes(k) && typeof v === 'string') clean[k] = v;
      }
      applyThemeOverrides(clean);
      setOverrides(clean);
      setImportOpen(false);
      setImportText('');
      setStatus({ tone: 'info', msg: `Imported ${Object.keys(clean).length} override(s) — click Save to persist.` });
    } catch {
      setStatus({ tone: 'negative', msg: 'Import failed — invalid JSON.' });
    }
  }

  const exportJson = useMemo(() => JSON.stringify(overrides, null, 2), [overrides]);

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
      background: 'var(--bg-card)', overflow: 'hidden', marginBottom: 'var(--space-6)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap',
        padding: 'var(--space-4)', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      }}>
        <span class="ui-modal-icon"><i class="fas fa-palette" /></span>
        <div style={{ marginRight: 'auto' }}>
          <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', fontSize: '0.95rem' }}>Theme editor</div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            Live, app-wide. Hover &amp; focus states update automatically — they reference these tokens.
          </div>
        </div>
        {dirtyCount > 0 && <StatusPill tone="info">{dirtyCount} changed</StatusPill>}
        <Button variant="outline" icon="fa-rotate-left" onClick={resetAll}>Reset all</Button>
        <Button variant="secondary" icon="fa-file-import" onClick={() => setImportOpen(o => !o)}>Import</Button>
        <Button variant="primary" icon="fa-floppy-disk" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save app-wide'}
        </Button>
      </div>

      {status && (
        <div style={{ padding: '8px var(--space-4)', borderBottom: '1px solid var(--border)' }}>
          <StatusPill tone={status.tone}>{status.msg}</StatusPill>
        </div>
      )}

      {importOpen && (
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '6px' }}>Paste a theme JSON (token → value), then Apply:</div>
          <textarea class="ui-textarea" style={{ minHeight: '110px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            value={importText} onInput={e => setImportText((e.target as HTMLTextAreaElement).value)}
            placeholder={'{\n  "--siomac-navy": "#1b2d54"\n}'} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '8px' }}>
            <Button variant="primary" icon="fa-check" onClick={applyImport}>Apply import</Button>
            <Button variant="outline" onClick={() => { setImportText(exportJson); }}>Load current</Button>
          </div>
        </div>
      )}

      {/* Token groups */}
      <div style={{ padding: 'var(--space-4)' }}>
        {TOKEN_GROUPS.map(group => (
          <div key={group.id} style={{ marginBottom: 'var(--space-5)' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{group.label}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>{group.desc}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-3)' }}>
              {group.tokens.map(t => (
                <TokenRow key={t.name} def={t} value={valueOf(t.name)} overridden={t.name in overrides}
                  onChange={v => setToken(t.name, v)} onRevert={() => revertToken(t.name)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenRow({ def, value, overridden, onChange, onRevert }: {
  def: TokenDef; value: string; overridden: boolean;
  onChange: (v: string) => void; onRevert: () => void;
}): VNode {
  return (
    <div style={{
      border: `1px solid ${overridden ? 'var(--siomac-navy)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-sm)', padding: '8px 10px', background: 'var(--bg-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '6px' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{def.label}</span>
        {overridden && (
          <button title="Revert to default" onClick={onRevert}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem', flexShrink: 0 }}>
            <i class="fas fa-rotate-left" />
          </button>
        )}
      </div>

      {(def.kind === 'color' || def.kind === 'color-alpha') && (
        <ColorField value={value} withAlpha={def.kind === 'color-alpha'} onChange={onChange} />
      )}

      {def.kind === 'select' && (
        <select class="ui-select" value={value} onChange={e => onChange((e.target as HTMLSelectElement).value)}
          style={{ minHeight: '32px', fontSize: '0.74rem' }}>
          {def.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {def.kind === 'text' && (
        <input type="text" class="ui-input" value={value} placeholder={def.hint}
          onInput={e => onChange((e.target as HTMLInputElement).value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', minHeight: '32px' }} />
      )}

      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '6px', fontFamily: 'var(--font-mono)' }}>{def.name}</div>
    </div>
  );
}
