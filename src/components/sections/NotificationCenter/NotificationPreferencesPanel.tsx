/** Per-user delivery preferences and quiet mode on the canonical notifications API. */

import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  ActivityDots, Badge, Button, Dialog, EmptyState, FeatureSurface, IconTile, LucideIcon,
  RadioGroup, Switch, Tabs, TabPanel, type LucideName, type TabItem,
} from '@ui';
import {
  useNotificationPreferences, useSetNotificationPreference, useMuteNotifications,
  type NotificationPreference,
} from '@api/communications';
import { saveUiPreference } from '@api/uiPreferences';
import {
  getToastRuntimePreferences,
  setToastRuntimePreferences,
  subscribeToastRuntimePreferences,
} from '@ui/toast';
import {
  TOAST_PREFERENCE_KEY,
  type ToastDurationMode,
  type ToastPosition,
  type ToastPreference,
} from '../../../../types/uiPreferences';
import './notificationPreferences.css';

type DeliveryChannel = 'in_app' | 'email' | 'whatsapp';
type PreferenceSection = 'delivery' | 'in_app' | 'quiet';
type QuietPreset = 'hour' | 'tomorrow' | 'resumed';

const TOAST_POSITION_OPTIONS: readonly { value: ToastPosition; label: string }[] = [
  { value: 'top-right', label: 'Top Right' },
  { value: 'bottom-right', label: 'Bottom Right' },
  { value: 'bottom-center', label: 'Bottom Center' },
];

const TOAST_DURATION_OPTIONS: readonly { value: ToastDurationMode; label: string; description: string; icon: LucideName }[] = [
  { value: 'standard', label: 'Standard', description: 'Close after 6 seconds', icon: 'Clock3' },
  { value: 'extended', label: 'Extended', description: 'Close after 10 seconds', icon: 'Timer' },
  { value: 'persistent', label: 'Until Dismissed', description: 'Keep alerts visible', icon: 'Infinity' },
];

interface PreferenceRowDef {
  eventType: string;
  label: string;
  description: string;
}

interface PreferenceGroup {
  title: string;
  description: string;
  icon: LucideName;
  critical?: boolean;
  rows: readonly PreferenceRowDef[];
}

const GROUPS: readonly PreferenceGroup[] = [
  {
    title: 'Critical Alerts',
    description: 'Safety events that always remain available in SIOMAC.',
    icon: 'ShieldAlert',
    critical: true,
    rows: [
      { eventType: 'hse.incident.critical', label: 'Critical Incidents', description: 'A critical incident is reported.' },
      { eventType: 'hse.ptw.expired', label: 'Expired Permits', description: 'A permit to work passes its expiry.' },
      { eventType: 'hse.capa.escalated', label: 'Escalated CAPA', description: 'An overdue corrective action is escalated.' },
    ],
  },
  {
    title: 'Calendar & Tasks',
    description: 'Reminders and changes that affect your schedule.',
    icon: 'CalendarClock',
    rows: [
      { eventType: 'calendar.reminder.due', label: 'Scheduled Reminders', description: 'A task or activity reaches a reminder time.' },
      { eventType: 'calendar.task.overdue', label: 'Overdue Tasks', description: 'An incomplete task passes its due time.' },
      { eventType: 'calendar.activity.rescheduled', label: 'Rescheduled Activities', description: 'An activity changes date or time.' },
      { eventType: 'calendar.activity.cancelled', label: 'Cancelled Activities', description: 'An activity you were invited to is cancelled.' },
      { eventType: 'calendar.activity.response_changed', label: 'Attendee Responses', description: 'An attendee responds to an activity you own.' },
    ],
  },
  {
    title: 'Health, Safety & Environment',
    description: 'Operational safety reports, assignments and approvals.',
    icon: 'HardHat',
    rows: [
      { eventType: 'hse.incident.submitted', label: 'Incident Reports', description: 'A new incident is logged.' },
      { eventType: 'hse.capa.assigned', label: 'CAPA Assigned to Me', description: 'You become the owner of a corrective action.' },
      { eventType: 'hse.capa.overdue', label: 'Overdue CAPA', description: 'A corrective action passes its due date.' },
      { eventType: 'hse.risk.approval_required', label: 'Risk & JSA Approvals', description: 'A risk assessment or JSA needs your decision.' },
    ],
  },
  {
    title: 'Workflow',
    description: 'Assignments and decisions from enterprise workflows.',
    icon: 'Workflow',
    rows: [
      { eventType: 'workflow.task.assigned', label: 'Workflow Tasks', description: 'A workflow step is assigned to you.' },
    ],
  },
  {
    title: 'Announcements',
    description: 'Organisation-wide information and broadcasts.',
    icon: 'Megaphone',
    rows: [
      { eventType: 'communications.broadcast', label: 'Announcements', description: 'An authorised broadcast is sent to your audience.' },
    ],
  },
];

const DEFAULT_PREF: NotificationPreference = {
  event_type: '*',
  in_app: true,
  email: false,
  whatsapp: false,
};

function formatUntil(iso: string | null): string {
  if (!iso) return 'until you resume them';
  const date = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const difference = Math.round((new Date(date).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (difference === 0) return `until ${time} today`;
  if (difference === 1) return `until ${time} tomorrow`;
  return `until ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

function oneHourFromNow(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}

function tomorrowMorning(): string {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(8, 0, 0, 0);
  return value.toISOString();
}

export function NotificationPreferencesPanel({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const [activeSection, setActiveSection] = useState<PreferenceSection>('delivery');
  const preferences = useNotificationPreferences({ enabled: open });
  const setPreference = useSetNotificationPreference();
  const mute = useMuteNotifications();
  const [toastPreference, setToastPreference] = useState<ToastPreference>(() => getToastRuntimePreferences());
  const [toastSavingControl, setToastSavingControl] = useState<string | null>(null);
  const [pendingPreferenceControls, setPendingPreferenceControls] = useState<ReadonlySet<string>>(() => new Set());
  const [toastFailed, setToastFailed] = useState(false);
  const [toastSaved, setToastSaved] = useState(false);

  useEffect(() => subscribeToastRuntimePreferences(setToastPreference), []);

  async function updateToastPreference(control: string, patch: Partial<ToastPreference>): Promise<void> {
    if (toastSavingControl) return;
    const previous = getToastRuntimePreferences();
    const next = { ...previous, ...patch };
    setToastRuntimePreferences(next);
    setToastSavingControl(control);
    setToastFailed(false);
    setToastSaved(false);
    try {
      const savedPreference = await saveUiPreference(TOAST_PREFERENCE_KEY, next);
      setToastRuntimePreferences(savedPreference.value);
      setToastSaved(true);
    } catch (error) {
      console.error('Toast preference could not be saved.', error);
      setToastRuntimePreferences(previous);
      setToastFailed(true);
    } finally {
      setToastSavingControl(null);
    }
  }

  const byType = new Map<string, NotificationPreference>();
  if (preferences.data) {
    byType.set('*', preferences.data.defaults);
    for (const preference of preferences.data.preferences) byType.set(preference.event_type, preference);
  }
  const defaults = byType.get('*') ?? DEFAULT_PREF;
  const preferenceFor = (eventType: string): NotificationPreference => byType.get(eventType) ?? {
    event_type: eventType,
    in_app: defaults.in_app,
    email: defaults.email,
    whatsapp: defaults.whatsapp,
  };

  function toggle(eventType: string, channel: DeliveryChannel): void {
    const control = `${eventType}:${channel}`;
    if (pendingPreferenceControls.has(control)) return;
    const current = preferenceFor(eventType);
    setPendingPreferenceControls(active => new Set(active).add(control));
    setPreference.mutate({
      ...current,
      event_type: eventType,
      eventType,
      [channel]: !current[channel],
    }, {
      onSettled: () => setPendingPreferenceControls(active => {
        const next = new Set(active);
        next.delete(control);
        return next;
      }),
    });
  }

  const snooze = (mutedUntil: string | null): void => mute.mutate({ scope: 'all', mutedUntil });
  const resume = (): void => mute.mutate({ scope: 'all', clear: true });

  const snoozed = preferences.data?.snooze ?? null;
  const saving = setPreference.isPending || mute.isPending || toastSavingControl !== null;
  const failed = setPreference.isError || mute.isError || toastFailed;
  const saved = !saving && !failed && (setPreference.isSuccess || mute.isSuccess || toastSaved);
  const activeChannels = [defaults.in_app, defaults.email, defaults.whatsapp].filter(Boolean).length;
  const quietPreset: QuietPreset | null = !snoozed
    ? null
    : snoozed.mutedUntil === null
      ? 'resumed'
      : (() => {
          const mutedUntil = new Date(snoozed.mutedUntil);
          const expectedTomorrow = new Date();
          expectedTomorrow.setDate(expectedTomorrow.getDate() + 1);
          expectedTomorrow.setHours(8, 0, 0, 0);
          return Math.abs(mutedUntil.getTime() - expectedTomorrow.getTime()) < 60_000 ? 'tomorrow' : 'hour';
        })();
  const sectionTabs: readonly TabItem[] = [
    { id: 'delivery', label: 'Delivery Channels', icon: <LucideIcon name="RadioTower" /> },
    { id: 'in_app', label: 'In-App Alerts', icon: <LucideIcon name="PanelTop" /> },
    { id: 'quiet', label: 'Quiet Mode', icon: <LucideIcon name="MoonStar" />, badge: snoozed ? 'On' : undefined },
  ];

  function renderPreferenceRow(row: PreferenceRowDef, critical = false): VNode {
    const value = preferenceFor(row.eventType);
    return (
      <div class="nc-pref-row" key={row.eventType}>
        <div class="nc-pref-row-copy">
          <strong>{row.label}</strong>
          <span>{row.description}</span>
        </div>
        <div class="nc-pref-control">
          <Switch
            checked={critical ? true : value.in_app}
            disabled={critical}
            pending={pendingPreferenceControls.has(`${row.eventType}:in_app`)}
            aria-label={`${row.label} In-App`}
            onChange={() => toggle(row.eventType, 'in_app')}
          />
          {critical && <span class="nc-pref-lock" title="Required for safety-critical alerts"><LucideIcon name="LockKeyhole" /></span>}
        </div>
        <div class="nc-pref-control">
          <Switch
            checked={value.email}
            pending={pendingPreferenceControls.has(`${row.eventType}:email`)}
            aria-label={`${row.label} Email`}
            onChange={() => toggle(row.eventType, 'email')}
          />
        </div>
        <div class="nc-pref-control">
          <Switch
            checked={value.whatsapp}
            pending={pendingPreferenceControls.has(`${row.eventType}:whatsapp`)}
            aria-label={`${row.label} WhatsApp`}
            onChange={() => toggle(row.eventType, 'whatsapp')}
          />
        </div>
      </div>
    );
  }

  const footerStatus = saving
    ? <span class="nc-pref-save is-saving"><ActivityDots label="Saving Notification Settings" size="sm" /> Saving Changes</span>
    : failed
      ? <span class="nc-pref-save is-error"><LucideIcon name="CircleAlert" /> Changes Could Not Be Saved</span>
      : saved
        ? <span class="nc-pref-save is-saved"><LucideIcon name="CircleCheck" /> All Changes Saved</span>
        : <span class="nc-pref-save"><LucideIcon name="Cloud" /> Changes Save Automatically</span>;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      variant="form"
      layout="sidebar-left"
      closeOnBackdrop={false}
      overlayClass="nc-preferences-overlay"
      class="nc-preferences-dialog"
    >
      <Dialog.Header
        title="Notification Settings"
        sub="Choose how and when SIOMAC should notify you."
        icon={<LucideIcon name="SlidersHorizontal" />}
        onClose={onClose}
      />
      <Dialog.Body class="nc-pref-body">
        <Dialog.Layout>
          <Dialog.Sidebar class="nc-pref-sidebar">
            <Dialog.SidebarHeader
              eyebrow="Personal Notifications"
              title="Delivery Preferences"
              description="Set a default delivery policy, then tailor the events that need different handling."
            />

            <Dialog.ContextFacts items={[
              {
                label: 'Default Delivery',
                value: `${activeChannels} Active Channel${activeChannels === 1 ? '' : 's'}`,
                icon: <LucideIcon name="RadioTower" />,
              },
              {
                label: 'Configured Event Groups',
                value: `${GROUPS.length} Groups`,
                icon: <LucideIcon name="Layers3" />,
              },
              {
                label: 'Quiet Mode',
                value: snoozed ? `Active ${formatUntil(snoozed.mutedUntil)}` : 'Routine Delivery Active',
                icon: <LucideIcon name={snoozed ? 'MoonStar' : 'Bell'} />,
              },
            ]} />

            <div class="nc-pref-safety-note">
              <LucideIcon name="ShieldCheck" />
              <span><strong>Critical Alerts Stay On</strong><small>Safety-critical in-app alerts cannot be disabled or snoozed.</small></span>
            </div>
          </Dialog.Sidebar>

          <Dialog.Content class="nc-pref-main">
          <div class="nc-pref-content-head">
            <div>
              <span class="nc-pref-eyebrow">
                {activeSection === 'delivery' ? 'Personal Notifications' : activeSection === 'in_app' ? 'On-Screen Experience' : 'Notification Schedule'}
              </span>
              <h3>{activeSection === 'delivery' ? 'Delivery Channels' : activeSection === 'in_app' ? 'In-App Alerts' : 'Quiet Mode'}</h3>
              <p>
                {activeSection === 'delivery'
                  ? 'Control where each notification type reaches you.'
                  : activeSection === 'in_app'
                    ? 'Choose where toast alerts appear and how long they remain visible.'
                    : 'Pause routine delivery while critical safety alerts remain available.'}
              </p>
            </div>
          </div>
          <div class="nc-pref-section-tabs">
            <Tabs
              id="notification-preference-sections"
              items={sectionTabs}
              value={activeSection}
              onChange={value => {
                if (value === 'delivery' || value === 'in_app' || value === 'quiet') setActiveSection(value);
              }}
              label="Notification Settings Sections"
              variant="contained"
              size="sm"
            />
          </div>
          {preferences.isLoading && <div class="nc-pref-state"><ActivityDots label="Loading Notification Settings" /></div>}

          {!preferences.isLoading && preferences.isError && (
            <div class="nc-pref-state">
              <EmptyState
                size="compact"
                icon={<LucideIcon name="CloudOff" />}
                tone="gray"
                title="Settings Could Not Be Loaded"
                text="Check your connection and try again."
                actions={<Button variant="secondary" size="sm" onClick={() => void preferences.refetch()}>Try Again</Button>}
                role="alert"
              />
            </div>
          )}

          {!preferences.isLoading && !preferences.isError && (
            <>
              <TabPanel tabsId="notification-preference-sections" tabId="delivery" value={activeSection}>
                <section class="nc-pref-default">
                  <div class="nc-pref-default-heading">
                    <span class="nc-pref-default-heading-icon" aria-hidden="true"><LucideIcon name="RadioTower" /></span>
                    <div>
                      <strong>Default Delivery</strong>
                      <span>All notifications use this baseline whenever an event does not have a custom setting below.</span>
                    </div>
                  </div>
                  <FeatureSurface
                    class="nc-pref-default-surface"
                    icon={<LucideIcon name="RadioTower" />}
                    eyebrow="Default policy"
                    title="Delivery Channels"
                    description="Your baseline delivery preference for every alert."
                    actions={(
                    <div class="nc-pref-default-channels" aria-label="Default Channels">
                      <div class="nc-pref-default-channel">
                        <span><LucideIcon name="Monitor" />In-App</span>
                        <Switch
                          checked={defaults.in_app}
                          pending={pendingPreferenceControls.has('*:in_app')}
                          aria-label="Default Channels In-App"
                          onChange={() => toggle('*', 'in_app')}
                        />
                      </div>
                      <div class="nc-pref-default-channel">
                        <span><LucideIcon name="Mail" />Email</span>
                        <Switch
                          checked={defaults.email}
                          pending={pendingPreferenceControls.has('*:email')}
                          aria-label="Default Channels Email"
                          onChange={() => toggle('*', 'email')}
                        />
                      </div>
                      <div class="nc-pref-default-channel">
                        <span><LucideIcon name="MessageCircle" />WhatsApp</span>
                        <Switch
                          checked={defaults.whatsapp}
                          pending={pendingPreferenceControls.has('*:whatsapp')}
                          aria-label="Default Channels WhatsApp"
                          onChange={() => toggle('*', 'whatsapp')}
                        />
                      </div>
                    </div>
                    )}
                  />
                </section>

                <div class="nc-pref-groups">
                  {GROUPS.map(group => (
                    <section class="nc-pref-group" key={group.title}>
                      <header class="nc-pref-group-head">
                        <IconTile icon={group.icon} tone="group" size="sm" />
                        <span><strong>{group.title}</strong><small>{group.description}</small></span>
                        {group.critical && <Badge tone="danger" variant="outline" size="sm" icon={<LucideIcon name="LockKeyhole" />}>In-App Required</Badge>}
                      </header>
                      <div class="nc-pref-mobile-labels" aria-hidden="true"><span>In-App</span><span>Email</span><span>WhatsApp</span></div>
                      {group.rows.map(row => renderPreferenceRow(row, group.critical))}
                    </section>
                  ))}
                </div>
              </TabPanel>

              <TabPanel tabsId="notification-preference-sections" tabId="in_app" value={activeSection} class="nc-pref-toast-panel">
                <section class="nc-pref-toast-surface">
                  <div class="nc-pref-toast-section">
                    <div class="nc-pref-toast-section-head">
                      <IconTile icon="PanelTop" tone="group" size="sm" />
                      <div class="nc-pref-toast-section-copy">
                        <strong>Screen Position</strong>
                        <span>Select the corner or edge where new alerts should enter.</span>
                      </div>
                    </div>
                    <RadioGroup
                      class="nc-pref-position-grid"
                      label="Toast Position"
                      value={toastPreference.position}
                      inline
                      presentation="cards"
                      mediaTreatment="preview"
                      columns={3}
                      indicator="radio"
                      indicatorPosition="start"
                      density="compact"
                      selectionTreatment="outline"
                      onChange={position => void updateToastPreference('position', { position })}
                      options={TOAST_POSITION_OPTIONS.map(option => ({
                        value: option.value,
                        label: option.label,
                        media: (
                          <span class="nc-pref-position-preview">
                            <span class="nc-pref-position-appbar"><i /><i /><i /></span>
                            <span class="nc-pref-position-sidebar"><i /><i /><i /><i /></span>
                            <span class="nc-pref-position-canvas"><i /><i /><i /></span>
                            <span class={`nc-pref-position-card is-${option.value}`}><i /><span><b /><em /></span><small /></span>
                          </span>
                        ),
                      }))}
                    />
                  </div>

                  <div class="nc-pref-toast-section">
                    <div class="nc-pref-toast-section-head">
                      <span class="nc-pref-toast-section-icon" aria-hidden="true"><LucideIcon name="TimerReset" /></span>
                      <div class="nc-pref-toast-section-copy">
                        <strong>Display Time</strong>
                        <span>Give alerts the amount of attention that suits your workflow.</span>
                      </div>
                    </div>
                    <RadioGroup
                      class="nc-pref-duration-grid"
                      label="Toast Display Time"
                      value={toastPreference.durationMode}
                      inline
                      presentation="icon-cards"
                      mediaTreatment="plain"
                      columns={3}
                      indicator="radio"
                      indicatorPosition="start"
                      density="compact"
                      selectionTreatment="tint"
                      onChange={durationMode => void updateToastPreference('duration', { durationMode })}
                      options={TOAST_DURATION_OPTIONS.map(option => ({
                        value: option.value,
                        label: option.label,
                        description: option.description,
                        media: <LucideIcon name={option.icon} />,
                      }))}
                    />
                  </div>

                  <div class="nc-pref-toast-section nc-pref-toast-behavior">
                    <div class="nc-pref-toast-section-head">
                      <span class="nc-pref-toast-section-icon" aria-hidden="true"><LucideIcon name="SlidersHorizontal" /></span>
                      <div class="nc-pref-toast-section-copy">
                        <strong>Alert Behavior</strong>
                        <span>Fine-tune the detail and attention cues used by toast alerts.</span>
                      </div>
                    </div>
                    <div class="nc-pref-toast-behavior-list">
                      <label class="nc-pref-toast-behavior-row">
                        <span class="nc-pref-toast-behavior-icon"><LucideIcon name="Eye" /></span>
                        <span><strong>Show Message Previews</strong><small>Include supporting details, files and context.</small></span>
                        <Switch
                          checked={toastPreference.showPreviews}
                          pending={toastSavingControl === 'showPreviews'}
                          aria-label="Show Message Previews"
                          onChange={() => void updateToastPreference('showPreviews', { showPreviews: !toastPreference.showPreviews })}
                        />
                      </label>
                      <label class="nc-pref-toast-behavior-row">
                        <span class="nc-pref-toast-behavior-icon"><LucideIcon name="Volume2" /></span>
                        <span><strong>Notification Sound</strong><small>Play a subtle tone when a new alert arrives.</small></span>
                        <Switch
                          checked={toastPreference.playSound}
                          pending={toastSavingControl === 'playSound'}
                          aria-label="Notification Sound"
                          onChange={() => void updateToastPreference('playSound', { playSound: !toastPreference.playSound })}
                        />
                      </label>
                      <label class="nc-pref-toast-behavior-row">
                        <span class="nc-pref-toast-behavior-icon"><LucideIcon name="PanelTopOpen" /></span>
                        <span><strong>Expand Action Alerts</strong><small>Open actionable toast details as soon as they arrive.</small></span>
                        <Switch
                          checked={toastPreference.expandActionToasts}
                          pending={toastSavingControl === 'expandActionToasts'}
                          aria-label="Expand Action Alerts"
                          onChange={() => void updateToastPreference('expandActionToasts', { expandActionToasts: !toastPreference.expandActionToasts })}
                        />
                      </label>
                    </div>
                  </div>
                </section>
              </TabPanel>

              <TabPanel tabsId="notification-preference-sections" tabId="quiet" value={activeSection} class="nc-pref-quiet-panel">
                <section class="nc-pref-quiet-mode">
                  <FeatureSurface
                    class={`nc-pref-quiet-hero${snoozed ? ' is-active' : ''}`}
                    icon={<LucideIcon name={snoozed ? 'MoonStar' : 'BellRing'} />}
                    eyebrow={snoozed ? 'Focus protected' : 'Routine delivery active'}
                    title={snoozed ? 'Quiet Mode is on' : 'Pause routine interruptions'}
                    description={snoozed
                        ? `Routine toast popups are paused ${formatUntil(snoozed.mutedUntil)}. Notifications remain available and unread in Notification Center.`
                        : 'Choose a pause window to stop routine toast popups without losing a notification.'}
                    actions={<span class="nc-pref-quiet-hero-control">
                      <span><strong>{snoozed ? 'On' : 'Off'}</strong></span>
                      <Switch
                        checked={Boolean(snoozed)}
                        pending={mute.isPending}
                        aria-label="Quiet Mode"
                        onChange={() => { if (snoozed) resume(); else snooze(null); }}
                      />
                    </span>}
                  />

                  <section class="nc-pref-quiet-behavior">
                    <div class="nc-pref-quiet-section-head">
                      <IconTile icon="ListChecks" tone="group" size="sm" />
                      <span><strong>What Quiet Mode Does</strong><small>Focus changes only how routine notifications interrupt you.</small></span>
                    </div>
                    <div class="nc-pref-quiet-behavior-grid">
                      <div><LucideIcon name="BellOff" /><span><strong>Pauses Routine Popups</strong><small>Routine toast cards stop appearing while you work.</small></span></div>
                      <div><LucideIcon name="Inbox" /><span><strong>Keeps Every Notification</strong><small>New items stay unread in Notification Center.</small></span></div>
                      <div><LucideIcon name="ShieldCheck" /><span><strong>Critical Alerts Continue</strong><small>Critical safety and security alerts still appear.</small></span></div>
                    </div>
                  </section>

                  <section class="nc-pref-quiet-duration">
                    <div class="nc-pref-quiet-section-head">
                      <IconTile icon="TimerReset" tone="group" size="sm" />
                      <span><strong>Pause Duration</strong><small>Selecting a different window starts Quiet Mode immediately.</small></span>
                    </div>
                    <RadioGroup<QuietPreset>
                      class="nc-pref-quiet-presets"
                      label="Quiet Mode Durations"
                      value={quietPreset ?? ''}
                      inline
                      presentation="cards"
                      columns={3}
                      indicator="radio"
                      indicatorPosition="start"
                      density="compact"
                      selectionTreatment="outline"
                      disabled={mute.isPending}
                      onChange={preset => {
                        if (preset === 'hour') snooze(oneHourFromNow());
                        else if (preset === 'tomorrow') snooze(tomorrowMorning());
                        else snooze(null);
                      }}
                      options={[
                        { value: 'hour', label: '1 Hour', description: 'Resume automatically in one hour.' },
                        { value: 'tomorrow', label: 'Until Tomorrow', description: 'Resume tomorrow at 8:00 AM.' },
                        { value: 'resumed', label: 'Until Resumed', description: 'Stay quiet until you turn it off.' },
                      ]}
                    />
                  </section>
                </section>
              </TabPanel>
            </>
          )}
          </Dialog.Content>
        </Dialog.Layout>
      </Dialog.Body>
      <Dialog.Footer left={footerStatus}>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </Dialog.Footer>
    </Dialog>
  );
}
