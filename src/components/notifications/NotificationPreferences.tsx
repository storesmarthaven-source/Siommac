/**
 * src/components/notifications/NotificationPreferences.tsx
 *
 * Per-user notification preference editor.
 *
 * Renders a toggleable grid of all notification types. Each row shows:
 *   - Human-readable label (from NOTIFICATION_TYPE_LABELS)
 *   - "In-app" toggle  (controls whether the panel shows this type)
 *   - "Email" toggle   (Phase 2f — shown greyed with "Coming soon" tooltip)
 *   - "WhatsApp" toggle (Phase 2f — shown greyed with "Coming soon" tooltip)
 *
 * Data: TanStack Query (useMyNotificationPreferences + useUpdateNotificationPreference).
 * Optimistic updates applied — the toggle feels instant.
 *
 * USAGE (embedded in SettingsSection "notifications" tab):
 *   import { NotificationPreferences } from '@components/notifications';
 *   <NotificationPreferences />
 *
 * @see docs/ARCHITECTURE.md §10-Realtime
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 * @see docs/PHASE_PLAN.md §Phase-2c
 */

import { h }                           from 'preact';
import type { CSSProperties }          from 'preact';
import {
  useMyNotificationPreferences,
  useUpdateNotificationPreference,
}                                      from '@lib/notifications';
import {
  NotificationTypeSchema,
  NOTIFICATION_TYPE_LABELS,
}                                      from '@api/schemas/notification';
import type { NotificationType, NotificationPreferenceRow } from '@api/schemas/notification';
import { toast }                       from '@store';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_TYPES = NotificationTypeSchema.options;

/** Default preference when the DB has no row for a type */
const DEFAULT_PREF: Omit<NotificationPreferenceRow, 'user_id' | 'type'> = {
  enabled:  true,
  in_app:   true,
  email:    false,
  whatsapp: false,
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    maxWidth: '700px',
  } as CSSProperties,
  table: {
    width:          '100%',
    borderCollapse: 'collapse' as const,
    fontSize:       '14px',
  } as CSSProperties,
  th: {
    padding:       '8px 12px',
    textAlign:     'left' as const,
    fontWeight:    600,
    color:         '#6b7280',
    borderBottom:  '1px solid #e5e7eb',
    fontSize:      '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  } as CSSProperties,
  thCenter: {
    textAlign: 'center' as const,
  } as CSSProperties,
  td: {
    padding:      '10px 12px',
    borderBottom: '1px solid #f3f4f6',
    verticalAlign: 'middle' as const,
  } as CSSProperties,
  tdCenter: {
    textAlign: 'center' as const,
  } as CSSProperties,
  label: {
    color:      '#374151',
    fontWeight: 500,
  } as CSSProperties,
  toggle: {
    position:      'relative' as const,
    display:       'inline-block',
    width:         '40px',
    height:        '22px',
    verticalAlign: 'middle',
  } as CSSProperties,
  toggleInput: {
    opacity: 0,
    width:   0,
    height:  0,
    position: 'absolute' as const,
  } as CSSProperties,
  soon: {
    display:    'inline-block',
    fontSize:   '11px',
    color:      '#9ca3af',
    background: '#f3f4f6',
    borderRadius: '4px',
    padding:    '2px 6px',
  } as CSSProperties,
  error: {
    padding: '16px',
    color:   '#b91c1c',
    background: '#fee2e2',
    borderRadius: '8px',
  } as CSSProperties,
  skeleton: {
    height:     '16px',
    background: 'linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%)',
    backgroundSize: '200% 100%',
    animation:  'shimmer 1.4s infinite',
    borderRadius: '4px',
    display:    'inline-block',
    width:      '70%',
  } as CSSProperties,
} as const;

// Pre-merged style objects for JSX (Object.assign avoids the no-misused-spread lint rule
// that fires on CSSProperties object spreads due to its index signature).
const thCenterStyle: CSSProperties = Object.assign({}, styles.th, styles.thCenter);
const tdCenterStyle: CSSProperties = Object.assign({}, styles.td, styles.tdCenter);
const skeletonSmStyle: CSSProperties = Object.assign({}, styles.skeleton, { width: '40px' });

// ── Toggle component ──────────────────────────────────────────────────────────

interface ToggleProps {
  checked:  boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  title?:   string;
}

function Toggle({ checked, disabled, onChange, title }: ToggleProps): h.JSX.Element {
  const bg = disabled ? '#e5e7eb' : checked ? 'var(--siomac-navy,#1e3a5f)' : '#d1d5db';

  return (
    <label style={styles.toggle} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        style={styles.toggleInput}
        onChange={(e: Event) => {
          if (!disabled) onChange((e.target as HTMLInputElement).checked);
        }}
      />
      <span
        style={{
          position:     'absolute',
          top:          0, left: 0, right: 0, bottom: 0,
          background:   bg,
          borderRadius: '11px',
          transition:   'background 0.2s',
          cursor:       disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span
          style={{
            position:     'absolute',
            top:          '2px',
            left:         checked ? '20px' : '2px',
            width:        '18px',
            height:       '18px',
            background:   '#fff',
            borderRadius: '50%',
            boxShadow:    '0 1px 3px rgba(0,0,0,0.2)',
            transition:   'left 0.2s',
          }}
        />
      </span>
    </label>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NotificationPreferences(): h.JSX.Element {
  const { data: prefs, isLoading, isError } = useMyNotificationPreferences();
  const updatePref = useUpdateNotificationPreference();

  if (isError) {
    return (
      <div style={styles.error}>
        Could not load notification preferences. Please refresh and try again.
      </div>
    );
  }

  /** Look up the pref for a given type, falling back to defaults */
  function getPref(type: NotificationType): NotificationPreferenceRow {
    const found = prefs?.find(p => p.type === type);
    // We don't know user_id here — just shape it for display; mutations use the hook
    return found ?? { user_id: '', type, ...DEFAULT_PREF };
  }

  function handleToggle(
    type:    NotificationType,
    field:   'in_app' | 'email' | 'whatsapp' | 'enabled',
    current: boolean,
  ): void {
    updatePref.mutate(
      { type, [field]: !current },
      {
        onError: () => {
          toast.error('Could not save preference — please try again.');
        },
      },
    );
  }

  return (
    <div style={styles.container}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Notification type</th>
            <th style={thCenterStyle}>In-app</th>
            <th style={thCenterStyle}>Email</th>
            <th style={thCenterStyle}>WhatsApp</th>
          </tr>
        </thead>
        <tbody>
          {ALL_TYPES.map((type) => {
            const pref = getPref(type);
            const isSaving = updatePref.isPending && (updatePref.variables as { type: string })?.type === type;

            return (
              <tr key={type}>
                <td style={styles.td}>
                  {isLoading
                    ? <span style={styles.skeleton} />
                    : <span style={styles.label}>{NOTIFICATION_TYPE_LABELS[type]}</span>
                  }
                </td>
                <td style={tdCenterStyle}>
                  {isLoading
                    ? <span style={skeletonSmStyle} />
                    : (
                      <Toggle
                        checked={pref.in_app && (pref.enabled ?? true)}
                        disabled={isSaving}
                        onChange={() => handleToggle(type, 'in_app', pref.in_app)}
                        title={pref.in_app ? 'Disable in-app notifications for this type' : 'Enable in-app notifications for this type'}
                      />
                    )
                  }
                </td>
                <td style={tdCenterStyle}>
                  <span style={styles.soon} title="Email delivery launches in Phase 2f">Coming soon</span>
                </td>
                <td style={tdCenterStyle}>
                  <span style={styles.soon} title="WhatsApp delivery launches in Phase 2f">Coming soon</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
