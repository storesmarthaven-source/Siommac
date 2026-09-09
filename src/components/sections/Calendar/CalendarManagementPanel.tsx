import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import type { CalendarCollectionDTO } from '@api/calendar';
import { Button, FeatureSurface, LucideIcon } from '@ui';
import { CalendarConnectionsPanel } from './CalendarConnectionsPanel';
import { CalendarCollectionEditor } from './CalendarCollectionDialog';
import { calendarCollectionPresentation } from './calendarCollectionPresentation';

export function CalendarManagementPanel({
  calendars,
  connectionsEnabled = true,
  onCreateCalendar,
}: {
  calendars: readonly CalendarCollectionDTO[];
  connectionsEnabled?: boolean;
  onCreateCalendar?: () => void;
}): VNode {
  const siomacCalendars = calendars.filter(calendar => calendar.provider == null);
  const [editingCalendarId, setEditingCalendarId] = useState<string | null>(null);

  return (
    <div class="cal-manage-panel">
      <header class="cal-manage-intro">
        <h2>Connect your calendars.</h2>
        <p>Bring every schedule into one place so SIOMAC always reflects when your teams are available.</p>
      </header>

      <div class="cal-manage-directory">
        <section class="cal-manage-native" aria-labelledby="cal-manage-library-title">
          <FeatureSurface
            class="cal-manage-feature-surface"
            icon={<LucideIcon name="CalendarPlus" />}
            eyebrow="SIOMAC calendar"
            title="Create your own calendar"
            description="Create a personal, department, or organisation schedule."
            actions={<Button variant="secondary" size="sm" iconOnly aria-label="Create a SIOMAC Calendar" disabled={!onCreateCalendar} iconLeft={<LucideIcon name="Plus" size={18} />} onClick={onCreateCalendar} />}
          />
          <div class="cal-manage-library">
            <div class="cal-manage-section-head"><div><h3 id="cal-manage-library-title">SIOMAC Calendars</h3><p>Your calendars created and managed inside SIOMAC.</p></div><span class="cal-manage-count">{siomacCalendars.length}</span></div>
            {siomacCalendars.length ? <div class="cal-manage-calendar-list">{siomacCalendars.map(calendar => {
            const style = calendar.customColor ? { background: calendar.customColor } : undefined;
            const presentation = calendarCollectionPresentation(calendar);
            const editing = editingCalendarId === calendar.id;
            return <div class={`cal-manage-calendar-entry${editing ? ' is-editing' : ''}`} key={calendar.id}>
              <article class="cal-manage-calendar-row">
                <span class="cal-manage-calendar-icon" aria-hidden="true">
                  <LucideIcon name={presentation.icon} size={21} />
                  <i class={`cal-manage-calendar-dot is-${calendar.colorKey ?? 'custom'}`} style={style} />
                </span>
                <span class="cal-manage-calendar-copy"><strong>{calendar.name}</strong><small>{presentation.meta}</small></span>
                {calendar.canEdit ? <Button variant="ghost" size="sm" iconOnly aria-label={`${editing ? 'Close settings for' : 'Edit'} ${calendar.name}`} aria-expanded={editing} aria-controls={`cal-manage-editor-${calendar.id}`} iconLeft={<LucideIcon name={editing ? 'X' : 'Pencil'} size={15} />} onClick={() => setEditingCalendarId(editing ? null : calendar.id)} /> : <LucideIcon class="cal-manage-readonly" name="LockKeyhole" size={14} />}
              </article>
              {editing ? <div class="cal-manage-inline-editor" id={`cal-manage-editor-${calendar.id}`}>
                <CalendarCollectionEditor calendar={calendar} embedded onCancel={() => setEditingCalendarId(null)} onComplete={() => setEditingCalendarId(null)} />
              </div> : null}
            </div>;
            })}</div> : <div class="cal-manage-calendar-empty"><LucideIcon name="Calendar" size={18} /><span>No SIOMAC calendars yet.</span></div>}
          </div>
        </section>

        <section class="cal-manage-connect" aria-labelledby="cal-manage-connect-title">
          <div class="cal-manage-section-head"><div><h3 id="cal-manage-connect-title">Connect an External Calendar</h3><p>Add Google, Microsoft, Apple, or a self-hosted Exchange calendar.</p></div></div>
          <CalendarConnectionsPanel enabled={connectionsEnabled} />
        </section>
      </div>
    </div>
  );
}
