/**
 * src/components/common/dialogs/DialogContextPanel.tsx
 *
 * The right-hand context pane of an enterprise form dialog. Renders any subset of the
 * seven enrichment elements (placement · preview · inherited · derived · metrics ·
 * validation · impact · approval · what-next) from a DialogContextPanelConfig.
 * Preact — uses `class`, not React `className`.
 */

import { type VNode } from 'preact';
import type { DialogContextPanelConfig, DialogContextSection, DialogTone } from './dialogContextTypes';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function toneClass(tone?: DialogTone): string {
  return tone ? `dcp-tone-${tone}` : 'dcp-tone-default';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function DialogContextPanel({
  eyebrow,
  title = 'Context',
  description,
  breadcrumb,
  preview,
  inherited,
  derived,
  metrics,
  validation,
  impact,
  whatNext,
  approval,
}: DialogContextPanelConfig): VNode {
  return (
    <aside class="dcp-panel">
      <div class="dcp-header">
        {eyebrow && <span class="dcp-eyebrow">{eyebrow}</span>}
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>

      {breadcrumb?.length ? (
        <section class="dcp-block">
          <div class="dcp-block-title">Placement</div>
          <div class="dcp-breadcrumb">
            {breadcrumb.map((item, index) => (
              <span key={`${item.label}-${index}`}>
                <strong>{item.label}</strong>
                {item.value && <em>{item.value}</em>}
                {index < breadcrumb.length - 1 && <b>›</b>}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {preview && (
        <section class="dcp-preview">
          <div class="dcp-preview-main">
            {preview.icon && <div class="dcp-preview-icon">{preview.icon}</div>}
            <div>
              <h4>{preview.title}</h4>
              {preview.subtitle && <p>{preview.subtitle}</p>}
            </div>
          </div>
          {preview.badges?.length ? (
            <div class="dcp-badges">
              {preview.badges.map((badge) => (
                <span key={badge.label} class={cx('dcp-badge', toneClass(badge.tone))}>{badge.label}</span>
              ))}
            </div>
          ) : null}
          {preview.meta?.length ? (
            <div class="dcp-meta">
              {preview.meta.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong class={toneClass(item.tone)}>{formatValue(item.value)}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {metrics?.length ? (
        <section class="dcp-metrics">
          {metrics.map((metric) => (
            <div key={metric.label} class={cx('dcp-metric', toneClass(metric.tone))}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
              {metric.helper && <small>{metric.helper}</small>}
            </div>
          ))}
        </section>
      ) : null}

      {inherited && <ContextSection section={inherited} type="inherited" />}
      {derived && <ContextSection section={derived} type="derived" />}

      {validation?.length ? (
        <section class="dcp-block">
          <div class="dcp-block-title">Live Validation</div>
          <div class="dcp-callout-list">
            {validation.map((item, index) => (
              <div key={`${item.message}-${index}`} class={cx('dcp-callout', `dcp-callout-${item.tone ?? 'info'}`)}>
                {item.message}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {impact && <ContextSection section={impact} type="impact" />}

      {approval && (
        <section class={cx('dcp-approval', approval.required ? 'dcp-approval-required' : 'dcp-approval-clear')}>
          <strong>
            {approval.required
              ? `Approval required${approval.risk ? ` · ${approval.risk} risk` : ''}`
              : 'No approval required'}
          </strong>
          <p>{approval.message}</p>
        </section>
      )}

      {whatNext?.length ? (
        <section class="dcp-next">
          <div class="dcp-block-title">What happens next</div>
          <ul>
            {whatNext.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                <strong>{item.label}</strong>
                {item.description && <span>{item.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}

function ContextSection({ section, type }: { section: DialogContextSection; type: 'inherited' | 'derived' | 'impact' }): VNode {
  return (
    <section class={cx('dcp-block', `dcp-block-${type}`)}>
      <div class="dcp-block-title">{section.title}</div>
      {section.description && <p class="dcp-block-description">{section.description}</p>}
      <div class="dcp-field-list">
        {section.fields.map((field) => (
          <div class="dcp-field-row" key={field.label}>
            <span>{field.label}</span>
            <strong class={toneClass(field.tone)}>{formatValue(field.value)}</strong>
            {field.helper && <small>{field.helper}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}
