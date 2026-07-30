// src/ui/widgets/WidgetConfigureModal.tsx — the widget SETTINGS dialog.
//
// Two panes, because settings answer two different questions and a single column forces the
// reader to interleave them:
//   LEFT  — the live tile plus the options that change it. Preview-led on purpose: every option a
//           widget exposes is a presentation choice, and you cannot judge one from a hex value.
//   RIGHT — what this widget IS. Where its numbers come from, how often they refresh, what
//           capability it needs, and where it is placed. All of it read from the widget's own
//           registry entry and its registered data source, so nothing here is decorative copy:
//           it is the same metadata the board and the permission gate act on.
//
// The right pane is also the honest answer to "is this number live?" — a static-preview widget
// says so in the same place a live one names its endpoint.
import { useMemo, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { Modal } from '@ui';
import type { WidgetConfigField, WidgetDef, WidgetSizeKey } from './types';
import { WidgetConfigFieldRenderer } from './WidgetConfigFieldRenderer';
import { WidgetLivePreview } from './WidgetLivePreview';
import { findWidgetDataSource } from './dataSources';
import './widgetConfigure.css';

/** Appearance = the look-only controls. Everything else changes WHAT is shown, not how, so the
 *  two groups answer different questions and belong apart. Derived from the field type + key so
 *  no widget has to declare a group it never knew about. */
function isAppearanceField(field: WidgetConfigField): boolean {
  return field.type === 'color'
    || /colour|color|gradient|theme|palette|accent|design|style/i.test(`${field.key} ${field.label}`);
}

interface Group { id: string; title: string; blurb: string; fields: WidgetConfigField[] }

function groupFields(schema: readonly WidgetConfigField[]): Group[] {
  const appearance = schema.filter(isAppearanceField);
  const data = schema.filter(field => !isAppearanceField(field));
  return [
    { id: 'appearance', title: 'Appearance', blurb: 'How this tile looks on the board.', fields: appearance },
    { id: 'data', title: 'Data & display', blurb: 'What the tile shows and how much of it.', fields: data },
  ].filter(group => group.fields.length > 0);
}

const REFRESH_COPY: Record<'manual' | 'interval' | 'realtime-invalidation', string> = {
  manual: 'On page load and manual refresh',
  interval: 'On a timer',
  'realtime-invalidation': 'Live — refetched when the data changes',
};

/** One labelled fact in the right pane. */
function Fact({ label, value, hint }: { label: string; value: string; hint?: string }): VNode {
  return (
    <div class="wcfg-fact">
      <dt>{label}</dt>
      <dd>{value}{hint ? <small>{hint}</small> : null}</dd>
    </div>
  );
}

export function WidgetConfigureModal({ open, widget, config, sizeKey, pageKey, zoneId, onClose, onSave }: {
  open: boolean; widget: WidgetDef; config: Record<string, unknown>; sizeKey: WidgetSizeKey;
  pageKey: string; zoneId: string; onClose: () => void; onSave: (config: Record<string, unknown>) => void;
}): VNode {
  const defaults = widget.defaultConfig;
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...defaults, ...config });
  const groups = useMemo(() => groupFields(widget.configSchema), [widget.configSchema]);

  // Comparisons run over the DECLARED SCHEMA KEYS ONLY, not the whole config object.
  //
  // A saved instance can carry keys from an earlier version of the widget's schema — this dialog
  // met exactly that: a tile still held `gradientFrom`/`gradientTo`/`gradientAngle` after the
  // gradient collapsed to a single `gradientColor`. Comparing whole objects made such an instance
  // permanently "dirty", so Save was enabled with nothing changed and the label never settled.
  // The schema is the contract; anything outside it cannot be read by the widget anyway.
  const signature = (source: Record<string, unknown>): string =>
    JSON.stringify(widget.configSchema.map(field => [field.key, source[field.key] ?? defaults[field.key] ?? null]));

  const isDirty = signature(draft) !== signature({ ...defaults, ...config });
  const isDefault = signature(draft) === signature({ ...defaults });

  const set = (key: string, value: unknown): void => setDraft(prev => ({ ...prev, [key]: value }));
  // Saved config is normalised to the schema too, so committing settings also sheds the dead keys
  // rather than carrying them forward for the life of the instance.
  const commit = (): void => onSave(Object.fromEntries(
    widget.configSchema.map(field => [field.key, draft[field.key] ?? defaults[field.key]]),
  ));

  // ── Facts for the right pane, all from the registry ──────────────────────────
  const source = findWidgetDataSource(widget.dataSource.sourceKey);
  const isLive = widget.runtimeState !== 'static-preview';
  const placed = widget.allowedSizes.find(size => size.key === sizeKey)?.grid;
  // Only an INTERVAL source has a meaningful period. `dataSource.refreshIntervalMs` is declared on
  // widgets whose registered source is realtime-invalidated too, so reading it unconditionally
  // printed "Live — refetched when the data changes / every 60s", which contradicts itself.
  const refreshMode = source?.refresh.mode ?? 'manual';
  const intervalMs = refreshMode === 'interval'
    ? source?.refresh.intervalMs ?? widget.dataSource.refreshIntervalMs
    : undefined;
  const permissions = widget.permissions?.requiredPermissions ?? widget.dataSource.permissions;

  return (
    <Modal
      open={open} title={widget.title} sub="Widget settings" icon={widget.icon}
      size="lg" overlayClass="wlib-over-top" onClose={onClose}
      footer={
        <>
          <button
            type="button" class="wcfg-reset ui-foot-left"
            disabled={isDefault}
            title={isDefault ? 'Already at the shipped defaults' : 'Restore every option to its shipped default'}
            onClick={() => setDraft({ ...defaults })}
          >
            Reset to defaults
          </button>
          <button type="button" class="wcfg-btn" onClick={onClose}>Cancel</button>
          {/* Disabled until something changed: a Save that writes an identical config would dirty
              the board's layout transaction for nothing. */}
          <button type="button" class="wcfg-btn wcfg-btn--primary" disabled={!isDirty} onClick={commit}>
            {isDirty ? 'Save changes' : 'Saved'}
          </button>
        </>
      }
    >
      <div class="wcfg">
        <div class="wcfg-main">
          {/* Preview FIRST — it is the reason the dialog exists. Live data, so what you approve is
              what the board will show, not an illustration. */}
          <section class="wcfg-stage" aria-label={`${widget.title} preview`}>
            <div class="wcfg-stage-head">
              <span class="wcfg-stage-title">{isLive ? 'Live preview' : 'Preview'}</span>
              <span class="wcfg-chip">{sizeKey}</span>
            </div>
            <div class="wcfg-stage-body">
              <WidgetLivePreview widget={widget} config={draft} sizeKey={sizeKey} pageKey={pageKey} zoneId={zoneId} live={isLive} showHeader={false} />
            </div>
          </section>

          {groups.length === 0 ? (
            <p class="wcfg-empty">This widget has no configurable options — its appearance and content are fixed.</p>
          ) : groups.map(group => (
            <section key={group.id} class="wcfg-group">
              <header>
                <h4>{group.title}</h4>
                <p>{group.blurb}</p>
              </header>
              <div class="wcfg-fields">
                {group.fields.map(field => (
                  <div class="wcfg-field" key={field.key}>
                    <WidgetConfigFieldRenderer field={field} value={draft[field.key]} onChange={value => set(field.key, value)} />
                    {field.helpText ? <small class="wcfg-help">{field.helpText}</small> : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside class="wcfg-info" aria-label="About this widget">
          <section class="wcfg-info-block">
            <h5>About</h5>
            <p>{widget.longDescription ?? widget.description}</p>
          </section>

          <section class="wcfg-info-block">
            <h5>Data source</h5>
            <span class={`wcfg-state${isLive ? ' is-live' : ''}`}>
              <i aria-hidden="true" />{isLive ? 'Authenticated API' : 'Static preview — illustrative data'}
            </span>
            <dl class="wcfg-facts">
              <Fact label="Source" value={widget.dataSource.label} />
              {source ? <Fact label="Endpoint" value={source.endpoint} /> : null}
              <Fact
                label="Refresh"
                value={REFRESH_COPY[refreshMode]}
                {...(intervalMs ? { hint: `every ${Math.round(intervalMs / 1000)}s` } : {})}
              />
              {source ? <Fact label="Scope" value={source.scope === 'organization' ? 'Organization-wide' : source.scope === 'user' ? 'Current user' : 'Single record'} /> : null}
            </dl>
          </section>

          <section class="wcfg-info-block">
            <h5>Access</h5>
            <p class="wcfg-info-note">Server-enforced. Settings here never widen what this widget can read.</p>
            <div class="wcfg-perms">
              {permissions.length
                ? permissions.map(permission => <code key={permission}>{permission}</code>)
                : <span class="wcfg-info-note">No capability required.</span>}
            </div>
          </section>

          <section class="wcfg-info-block">
            <h5>Placement</h5>
            <dl class="wcfg-facts">
              <Fact label="Module" value={`${widget.module.toUpperCase()} · ${widget.area}`} />
              <Fact label="Zone" value={zoneId} />
              <Fact
                label="Size"
                value={placed ? `${placed.w} × ${placed.h} grid units` : sizeKey}
                {...(widget.resizable === false ? { hint: 'fixed — not resizable' } : {})}
              />
            </dl>
          </section>
        </aside>
      </div>
    </Modal>
  );
}
