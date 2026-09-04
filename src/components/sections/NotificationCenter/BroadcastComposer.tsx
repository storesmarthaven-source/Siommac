/** Admin broadcast composer on the canonical UI Kit dialog and communications API. */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  Alert, Button, Dialog, EmptyState, FormField, FormGrid2, IconTile, LucideIcon,
  Select, Textarea, TextInput,
} from '@ui';
import { useBroadcastNotification } from '@api/communications';
import { navGlobalCatalog } from '@components/nav/navCore';
import { useSessionStore } from '@store/session';
import './broadcastComposer.css';

type AudienceType = 'all' | 'role' | 'site' | 'department' | 'users';
type Severity = 'info' | 'success' | 'warning' | 'critical';

const AUDIENCE = [
  { value: 'all', label: 'All Active Users' },
  { value: 'role', label: 'A Specific Role' },
  { value: 'site', label: 'A Project Site' },
  { value: 'department', label: 'A Department' },
  { value: 'users', label: 'Specific Users' },
] as const;

const SEVERITIES = [
  { value: 'info', label: 'Information' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
] as const;

const ROLES = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Administrator' },
  { value: 'superadmin', label: 'Super Administrator' },
] as const;

const DEFAULT_DESTINATION = 's-notification-center';

const TARGET_LABELS: Record<Exclude<AudienceType, 'all'>, string> = {
  role: 'Role',
  site: 'Project Site ID',
  department: 'Department ID',
  users: 'User IDs',
};

const TARGET_PLACEHOLDERS: Record<Exclude<AudienceType, 'all'>, string> = {
  role: 'Choose a role',
  site: 'For example, SITE-001',
  department: 'For example, DEPT-001',
  users: 'USR-001, USR-002',
};

function getDestinationOptions(role: string): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [
    { value: DEFAULT_DESTINATION, label: 'Notification Center' },
  ];
  const added = new Set(options.map(option => option.value));

  for (const group of navGlobalCatalog(role).groups) {
    for (const item of group.items) {
      if (!item.visible) continue;

      if (!item.isGroup && !added.has(item.id)) {
        options.push({ value: item.id, label: item.label });
        added.add(item.id);
      }

      for (const child of item.children ?? []) {
        if (!child.visible || added.has(child.id)) continue;
        options.push({ value: child.id, label: `${item.label} › ${child.label}` });
        added.add(child.id);
      }
    }
  }

  return options;
}

export function BroadcastComposer({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const role = useSessionStore(state => state.role) ?? 'employee';
  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [audienceValue, setAudienceValue] = useState('');
  const [severity, setSeverity] = useState<Severity>('info');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionRoute, setActionRoute] = useState(DEFAULT_DESTINATION);
  const [submitted, setSubmitted] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [sent, setSent] = useState<number | null>(null);

  const broadcast = useBroadcastNotification();
  const destinationOptions = useMemo(() => getDestinationOptions(role), [role]);
  const targetType = audienceType === 'all' ? null : audienceType;
  const audienceMissing = targetType !== null && audienceValue.trim().length === 0;
  const titleMissing = title.trim().length === 0;
  const bodyMissing = body.trim().length === 0;
  const invalid = audienceMissing || titleMissing || bodyMissing;
  const audienceLabel = AUDIENCE.find(option => option.value === audienceType)?.label ?? 'Selected Audience';
  const severityLabel = SEVERITIES.find(option => option.value === severity)?.label ?? 'Information';
  const targetValueLabel = targetType === 'role'
    ? ROLES.find(option => option.value === audienceValue)?.label ?? ''
    : audienceValue.trim();
  const recipientLabel = targetType === null
    ? 'All Active Users'
    : `${audienceLabel} · ${targetValueLabel || 'Not Selected'}`;
  const destinationLabel = destinationOptions.find(option => option.value === actionRoute)?.label ?? 'Notification Center';

  function reset(): void {
    setAudienceType('all');
    setAudienceValue('');
    setSeverity('info');
    setTitle('');
    setBody('');
    setActionRoute(DEFAULT_DESTINATION);
    setSubmitted(false);
    setRequestError('');
    setSent(null);
    broadcast.reset();
  }

  function close(): void {
    if (broadcast.isPending) return;
    reset();
    onClose();
  }

  async function send(): Promise<void> {
    setSubmitted(true);
    setRequestError('');
    if (invalid) return;

    try {
      const result = await broadcast.mutateAsync({
        audience: {
          type: audienceType,
          value: targetType !== null && targetType !== 'users' ? audienceValue.trim() : undefined,
          userIds: targetType === 'users'
            ? audienceValue.split(',').map(value => value.trim()).filter(Boolean)
            : undefined,
        },
        severity,
        title: title.trim(),
        body: body.trim(),
        actionRoute,
      });
      setSent(result.recipientCount);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'The broadcast could not be sent.');
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      size="xl"
      variant="form"
      layout="sidebar-left"
      busy={broadcast.isPending}
      closeOnBackdrop={false}
      class="nc-broadcast-dialog"
    >
      <Dialog.Header
        title="Send Broadcast"
        sub="Deliver an authorised notification to a defined SIOMAC audience."
        icon={<LucideIcon name="Megaphone" />}
        onClose={close}
      />

      <Dialog.Body class="nc-broadcast-body">
        <Dialog.Layout>
          <Dialog.Sidebar class="nc-broadcast-sidebar">
            <div class="nc-broadcast-sidebar-heading">
              <IconTile icon="Megaphone" tone="navy" size="lg" />
              <div>
                <strong>Broadcast Summary</strong>
                <span>Recipients And Delivery</span>
              </div>
            </div>

            <Dialog.ContextFacts items={[
              { label: 'Recipients', value: recipientLabel, icon: <LucideIcon name="UsersRound" /> },
              { label: 'Priority', value: severityLabel, icon: <LucideIcon name="TriangleAlert" /> },
              { label: 'Delivery', value: `In-App · ${destinationLabel}`, icon: <LucideIcon name="BellRing" /> },
            ]} />

            <div class="nc-broadcast-safety-note">
              <LucideIcon name="ShieldCheck" />
              <span>
                <strong>Authorised Delivery</strong>
                <small>Only active users resolved by this audience receive the notification.</small>
              </span>
            </div>
          </Dialog.Sidebar>

          <Dialog.Content class="nc-broadcast-main">
            {sent !== null ? (
              <EmptyState
                icon={<LucideIcon name="BadgeCheck" />}
                tone="green"
                title="Broadcast Sent"
                text={`Delivered to ${sent} recipient${sent === 1 ? '' : 's'}.`}
                note="The Notification Center summary will update automatically."
                role="status"
              />
            ) : (
              <>
                {requestError && (
                  <Alert tone="danger" title="Broadcast Could Not Be Sent" announce onDismiss={() => setRequestError('')}>
                    {requestError}
                  </Alert>
                )}

                <Dialog.Section title="Recipients & Delivery" desc="Choose exactly who should receive this announcement and where it should lead.">
                  <FormGrid2 class="nc-broadcast-recipient-grid">
                    <FormField label="Audience" required>
                      <Select<AudienceType>
                        value={audienceType}
                        onChange={value => {
                          if (!value) return;
                          setAudienceType(value);
                          setAudienceValue('');
                        }}
                        options={AUDIENCE}
                      />
                    </FormField>

                    <FormField
                      label={targetType === null ? 'Recipient Scope' : TARGET_LABELS[targetType]}
                      required={targetType !== null}
                      readOnly={targetType === null}
                      error={submitted && audienceMissing ? `${TARGET_LABELS[targetType]} is required.` : undefined}
                    >
                      {targetType === 'role' ? (
                        <Select
                          value={audienceValue}
                          onChange={setAudienceValue}
                          options={ROLES}
                          placeholder={TARGET_PLACEHOLDERS.role}
                        />
                      ) : (
                        <TextInput
                          value={targetType === null ? 'All Active SIOMAC Users' : audienceValue}
                          onInput={targetType === null ? undefined : setAudienceValue}
                          readOnly={targetType === null}
                          placeholder={targetType === null ? undefined : TARGET_PLACEHOLDERS[targetType]}
                        />
                      )}
                    </FormField>

                    <FormField label="Severity" required>
                      <Select<Severity>
                        value={severity}
                        onChange={value => { if (value) setSeverity(value); }}
                        options={SEVERITIES}
                      />
                    </FormField>

                    <FormField label="Destination">
                      <Select
                        value={actionRoute}
                        onChange={setActionRoute}
                        options={destinationOptions}
                        searchable
                      />
                    </FormField>
                  </FormGrid2>
                </Dialog.Section>

                <Dialog.Section title="Message" desc="Write a concise headline and the action recipients need to understand.">
                  <FormGrid2>
                    <FormField
                      label="Title"
                      required
                      wide
                      charCount={{ value: title.length, max: 200 }}
                      error={submitted && titleMissing ? 'Title is required.' : undefined}
                    >
                      <TextInput value={title} onInput={setTitle} placeholder="Notification headline" />
                    </FormField>

                    <FormField
                      label="Message"
                      required
                      wide
                      charCount={{ value: body.length, max: 2000 }}
                      error={submitted && bodyMissing ? 'Message is required.' : undefined}
                    >
                      <Textarea value={body} onInput={setBody} rows={5} placeholder="What should recipients know or do?" />
                    </FormField>
                  </FormGrid2>
                </Dialog.Section>
              </>
            )}
          </Dialog.Content>
        </Dialog.Layout>
      </Dialog.Body>

      <Dialog.Footer>
        {sent !== null ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              iconLeft={<LucideIcon name="Send" />}
              loading={broadcast.isPending}
              loadingText="Sending Broadcast"
              onClick={() => void send()}
            >
              Send Broadcast
            </Button>
          </>
        )}
      </Dialog.Footer>
    </Dialog>
  );
}
