import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Button, Dialog, FeatureSurface, IconTile, LucideIcon, Radio, RadioGroup, SegmentedControl, Switch, Tabs, TabPanel, type LucideName, type TabItem } from '@ui';
import type { CalendarTitleIconType } from '../../../../types/calendar';
import type { CalendarDefaultDuration, CalendarMonthEventLimit, CalendarSnapMinutes, CalendarWeatherLocation, CalendarWeekStart } from '../../../../types/uiPreferences';
import type { CalendarScope, CalendarViewMode } from './calendarViewModel';
import type { CalendarWeekLayout } from './TimeGridView';

type CalendarPreferenceSection = 'defaults' | 'schedule' | 'context';
type TimelineDensity = 'compact' | 'comfortable' | 'spacious';

const SECTION_TABS: readonly TabItem[] = [
  { id: 'defaults', label: 'Calendar Defaults', icon: <LucideIcon name="CalendarDays" /> },
  { id: 'schedule', label: 'Timeline & Cards', icon: <LucideIcon name="PanelTop" /> },
  { id: 'context', label: 'Context & Sources', icon: <LucideIcon name="Layers3" /> },
];

const SECTION_COPY: Readonly<Record<CalendarPreferenceSection, { eyebrow: string; title: string; description: string }>> = {
  defaults: { eyebrow: 'Personal calendar', title: 'Calendar Defaults', description: 'Choose the workspace and planning defaults Calendar uses when it opens.' },
  schedule: { eyebrow: 'Schedule canvas', title: 'Timeline & Event Cards', description: 'Control schedule scale, interaction precision and the detail shown on cards.' },
  context: { eyebrow: 'Calendar coverage', title: 'Context & Sources', description: 'Choose the operational context and authorised schedules included in Calendar.' },
};

const TITLE_ICON_EMOJI_PREVIEW = ['📅', '📍', '🛠️', '✅', '🚢', '📣', '⏱️', '👋', '🧭', '📋', '👥', '🛡️', '🌤️', '🎉', '🧲', '🏗️', '🔔', '📦'] as const;
const TITLE_ICON_LUCIDE_PREVIEW: readonly LucideName[] = ['CalendarDays', 'MapPin', 'Wrench', 'CircleCheck', 'Ship', 'Megaphone', 'Clock4', 'Hand', 'Compass', 'ClipboardList', 'Users', 'ShieldCheck', 'CloudSun', 'PartyPopper', 'Magnet', 'PanelsTopLeft', 'Bell', 'Package'];

function sourceLabel(source: string): string {
  return source === 'calendar'
    ? 'Calendar'
    : source.split(/[-_]/g).map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

function columnDensity(zoom: number): TimelineDensity {
  return zoom <= .9 ? 'compact' : zoom >= 1.1 ? 'spacious' : 'comfortable';
}

function timelineDensity(zoom: number): TimelineDensity {
  return zoom <= .95 ? 'compact' : zoom >= 1.4 ? 'spacious' : 'comfortable';
}

function WeekLayoutPreview({ layout, density }: { layout: CalendarWeekLayout; density: TimelineDensity }): VNode {
  return <span class={`cal-settings-week-preview is-${layout} density-${density}`} aria-hidden="true">
    <span class="cal-settings-week-appbar"><i /><i /><i /></span>
    <span class="cal-settings-week-rail">{(layout === 'timeline' ? ['M', 'T', 'W', 'T', 'F'] : ['8', '9', '10', '11']).map((label, index) => <i key={`${label}-${index}`}>{label}</i>)}</span>
    <span class="cal-settings-week-canvas">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</span>
    <span class="cal-settings-week-event is-primary"><i /><span><b /><em /></span></span>
    <span class="cal-settings-week-event is-secondary"><i /><span><b /><em /></span></span>
  </span>;
}

function TitleIconLibraryPreview({ type }: { type: CalendarTitleIconType }): VNode {
  const icons = type === 'emoji' ? TITLE_ICON_EMOJI_PREVIEW : TITLE_ICON_LUCIDE_PREVIEW;
  return <span class={`cal-pref-title-icon-preview is-${type}`}>
    {icons.map((icon, index) => <i key={`${icon}-${index}`}>
      {type === 'emoji' ? icon : <LucideIcon name={icon as LucideName} size={17} strokeWidth={1.8} />}
    </i>)}
  </span>;
}

interface CalendarSettingsDialogProps {
  open: boolean;
  view: CalendarViewMode;
  weekLayout: CalendarWeekLayout;
  columnZoom: number;
  weekTimelineZoom: number;
  weekStartsOn: CalendarWeekStart;
  snapMinutes: CalendarSnapMinutes;
  showAllDay: boolean;
  showCurrentTime: boolean;
  autoFocusTimeline: boolean;
  defaultDurationMinutes: CalendarDefaultDuration;
  showWeekends: boolean;
  dimPastEvents: boolean;
  showCardLocations: boolean;
  showCardAttendees: boolean;
  showCardIcons: boolean;
  monthEventLimit: CalendarMonthEventLimit;
  showWeather: boolean;
  showHolidays: boolean;
  weatherLocation: CalendarWeatherLocation;
  titleIconType: CalendarTitleIconType;
  scope: CalendarScope;
  sources: string[];
  hiddenSources: ReadonlySet<string>;
  onViewChange: (view: CalendarViewMode) => void;
  onWeekLayoutChange: (layout: CalendarWeekLayout) => void;
  onColumnZoomChange: (zoom: number) => void;
  onWeekTimelineZoomChange: (zoom: number) => void;
  onWeekStartsOnChange: (day: CalendarWeekStart) => void;
  onSnapMinutesChange: (minutes: CalendarSnapMinutes) => void;
  onShowAllDayChange: (show: boolean) => void;
  onShowCurrentTimeChange: (show: boolean) => void;
  onAutoFocusTimelineChange: (focus: boolean) => void;
  onDefaultDurationMinutesChange: (minutes: CalendarDefaultDuration) => void;
  onShowWeekendsChange: (show: boolean) => void;
  onDimPastEventsChange: (dim: boolean) => void;
  onShowCardLocationsChange: (show: boolean) => void;
  onShowCardAttendeesChange: (show: boolean) => void;
  onShowCardIconsChange: (show: boolean) => void;
  onMonthEventLimitChange: (limit: CalendarMonthEventLimit) => void;
  onShowWeatherChange: (show: boolean) => void;
  onShowHolidaysChange: (show: boolean) => void;
  onWeatherLocationChange: (location: CalendarWeatherLocation) => void;
  onTitleIconTypeChange: (type: CalendarTitleIconType) => void;
  onScopeChange: (scope: CalendarScope) => void;
  onToggleSource: (source: string) => void;
  onClose: () => void;
}

export function CalendarSettingsDialog(props: CalendarSettingsDialogProps): VNode | null {
  const {
    open, view, weekLayout, columnZoom, weekTimelineZoom, weekStartsOn, snapMinutes,
    showAllDay, showCurrentTime, autoFocusTimeline, defaultDurationMinutes, showWeekends,
    dimPastEvents, showCardLocations, showCardAttendees, showCardIcons, monthEventLimit,
    showWeather, showHolidays, weatherLocation, titleIconType, scope, sources, hiddenSources,
    onViewChange, onWeekLayoutChange, onColumnZoomChange, onWeekTimelineZoomChange,
    onWeekStartsOnChange, onSnapMinutesChange, onShowAllDayChange, onShowCurrentTimeChange,
    onAutoFocusTimelineChange, onDefaultDurationMinutesChange, onShowWeekendsChange,
    onDimPastEventsChange, onShowCardLocationsChange, onShowCardAttendeesChange,
    onShowCardIconsChange, onMonthEventLimitChange, onShowWeatherChange,
    onShowHolidaysChange, onWeatherLocationChange, onTitleIconTypeChange,
    onScopeChange, onToggleSource, onClose,
  } = props;
  const [activeSection, setActiveSection] = useState<CalendarPreferenceSection>('defaults');
  const visibleSourceCount = sources.filter(source => !hiddenSources.has(source)).length;
  const normalizedView = view === 'agenda' || view === 'tasks' ? 'week' : view;
  const copy = SECTION_COPY[activeSection];

  return <Dialog open={open} onClose={onClose} size="xl" variant="form" layout="sidebar-left" closeOnBackdrop={false} overlayClass="cal-preferences-overlay" class="cal-preferences-dialog">
    <Dialog.Header title="Calendar Settings" sub="Choose how SIOMAC Calendar should look and behave." icon={<LucideIcon name="SlidersHorizontal" />} onClose={onClose} />
    <Dialog.Body class="cal-pref-body">
      <Dialog.Layout>
        <Dialog.Sidebar class="cal-pref-sidebar">
          <Dialog.SidebarHeader eyebrow="Personal Calendar" title="Planning Preferences" description="Set your default workspace, then tailor the timeline and information shown on event cards." />
          <Dialog.ContextFacts items={[
            { label: 'Default Workspace', value: `${normalizedView.slice(0, 1).toUpperCase()}${normalizedView.slice(1)} View`, icon: <LucideIcon name="CalendarDays" /> },
            { label: 'Week Presentation', value: weekLayout === 'timeline' ? 'Horizontal Timeline' : 'Day Columns', icon: <LucideIcon name={weekLayout === 'timeline' ? 'MoveHorizontal' : 'Columns3'} /> },
            { label: 'Planning Precision', value: `${snapMinutes}-Minute Snap`, icon: <LucideIcon name="Clock3" /> },
            { label: 'Visible Sources', value: sources.length ? `${visibleSourceCount} of ${sources.length}` : 'Calendar Only', icon: <LucideIcon name="Layers3" /> },
          ]} />
          <div class="cal-pref-safety-note"><LucideIcon name="ShieldCheck" /><span><strong>Schedule Data Stays Authoritative</strong><small>Display preferences never change saved event dates, times or permissions.</small></span></div>
        </Dialog.Sidebar>

        <Dialog.Content class="cal-pref-main">
          <div class="cal-pref-content-head"><div><span class="cal-pref-eyebrow">{copy.eyebrow}</span><h3>{copy.title}</h3><p>{copy.description}</p></div></div>
          <div class="cal-pref-section-tabs"><Tabs id="calendar-preference-sections" items={SECTION_TABS} value={activeSection} onChange={value => {
            if (value === 'defaults' || value === 'schedule' || value === 'context') setActiveSection(value);
          }} label="Calendar Settings Sections" variant="contained" size="sm" /></div>

          <TabPanel tabsId="calendar-preference-sections" tabId="defaults" value={activeSection}>
            <div class="cal-pref-panel">
              <FeatureSurface class="cal-pref-default-hero" icon={<LucideIcon name="CalendarRange" />} eyebrow="Your current default" title={`${normalizedView.slice(0, 1).toUpperCase()}${normalizedView.slice(1)} View`} description={`${weekLayout === 'timeline' ? 'Horizontal timeline' : 'Day columns'} · ${weekStartsOn === 'sunday' ? 'Sunday' : 'Monday'} week start`} actions={<div class="cal-pref-hero-metrics"><span><strong>{defaultDurationMinutes}</strong><small>Default minutes</small></span><span><strong>{monthEventLimit}</strong><small>Month cards</small></span></div>} />
              <section class="cal-pref-section">
                <div class="cal-pref-section-head"><IconTile icon="CalendarDays" tone="group" size="sm" /><span><strong>Default Calendar View</strong><small>Choose the workspace shown when Calendar opens.</small></span></div>
                <RadioGroup class="cal-pref-icon-options" label="Default calendar view" value={normalizedView} inline presentation="icon-cards" mediaTreatment="plain" columns={3} indicator="radio" indicatorPosition="start" density="compact" selectionTreatment="tint" onChange={onViewChange} options={[
                  { value: 'day', label: 'Day', description: 'One detailed schedule', media: <LucideIcon name="CalendarDays" /> },
                  { value: 'week', label: 'Week', description: 'Plan seven days', media: <LucideIcon name="CalendarRange" /> },
                  { value: 'month', label: 'Month', description: 'Review the wider period', media: <LucideIcon name="Calendar" /> },
                ]} />
              </section>
              <div class="cal-pref-control-grid">
                <section class="cal-pref-section"><div class="cal-pref-section-head"><IconTile icon="CalendarRange" tone="group" size="sm" /><span><strong>Week Starts On</strong><small>Used in Week view and both month calendars.</small></span></div><RadioGroup class="cal-pref-week-start-options" label="First day of week" value={weekStartsOn} inline presentation="cards" columns={2} indicator="radio" indicatorPosition="start" density="compact" selectionTreatment="outline" onChange={value => onWeekStartsOnChange(value as CalendarWeekStart)} options={[{ value: 'sunday', label: 'Sunday' }, { value: 'monday', label: 'Monday' }]} /></section>
                <section class="cal-pref-section"><div class="cal-pref-section-head"><IconTile icon="LayoutGrid" tone="group" size="sm" /><span><strong>Month Card Capacity</strong><small>Items shown before a day displays its overflow count.</small></span></div><RadioGroup class="cal-pref-month-capacity-options" label="Month events per day" value={`${monthEventLimit}`} inline presentation="cards" columns={3} indicator="radio" indicatorPosition="start" density="compact" selectionTreatment="outline" onChange={value => onMonthEventLimitChange(Number(value) as CalendarMonthEventLimit)} options={[{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} /></section>
              </div>
            </div>
          </TabPanel>

          <TabPanel tabsId="calendar-preference-sections" tabId="schedule" value={activeSection}>
            <div class="cal-pref-panel">
              <section class="cal-pref-section">
                <div class="cal-pref-section-head"><IconTile icon="GalleryHorizontalEnd" tone="group" size="sm" /><span><strong>Week Presentation</strong><small>Choose the Week workspace that matches the planning task.</small></span></div>
                <div class="cal-pref-presentation-grid">
                  <div class={`cal-pref-presentation-card${weekLayout === 'timeline' ? ' is-selected' : ''}`}>
                    <Radio class="cal-pref-presentation-select" name="calendar-week-presentation" value="timeline" checked={weekLayout === 'timeline'} onChange={() => onWeekLayoutChange('timeline')} label="Timeline" description="Days down the left, time across the top." />
                    <WeekLayoutPreview key={`timeline-${timelineDensity(weekTimelineZoom)}`} layout="timeline" density={timelineDensity(weekTimelineZoom)} />
                    <div class="cal-pref-presentation-scale">
                      <div class="cal-pref-presentation-scale-copy"><strong>Scale</strong><small>Horizontal width and card content.</small></div>
                      <SegmentedControl size="sm" variant="outline" fullWidth label="Week timeline scale" value={timelineDensity(weekTimelineZoom)} onChange={value => onWeekTimelineZoomChange(value === 'compact' ? .88 : value === 'spacious' ? 1.6 : 1.15)} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Balanced' }, { value: 'spacious', label: '100%' }]} />
                    </div>
                  </div>
                  <div class={`cal-pref-presentation-card${weekLayout === 'columns' ? ' is-selected' : ''}`}>
                    <Radio class="cal-pref-presentation-select" name="calendar-week-presentation" value="columns" checked={weekLayout === 'columns'} onChange={() => onWeekLayoutChange('columns')} label="Columns" description="Days across the top, time down the left." />
                    <WeekLayoutPreview key={`columns-${columnDensity(columnZoom)}`} layout="columns" density={columnDensity(columnZoom)} />
                    <div class="cal-pref-presentation-scale">
                      <div class="cal-pref-presentation-scale-copy"><strong>Scale</strong><small>Vertical card height for Day and Week Columns.</small></div>
                      <SegmentedControl size="sm" variant="outline" fullWidth label="Day and column scale" value={columnDensity(columnZoom)} onChange={value => onColumnZoomChange(value === 'compact' ? .85 : value === 'spacious' ? 1.2 : 1)} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Balanced' }, { value: 'spacious', label: '100%' }]} />
                    </div>
                  </div>
                </div>
              </section>
              <section class="cal-pref-section">
                <div class="cal-pref-section-head"><IconTile icon="SlidersHorizontal" tone="group" size="sm" /><span><strong>Timeline Behaviour</strong><small>Fine-tune the schedule canvas without altering event times.</small></span></div>
                <div class="cal-pref-behavior-list">
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="PanelTop" /></span><span><strong>All-Day Section</strong><small>Keep date-based events in a dedicated lane above timed schedules.</small></span><Switch checked={showAllDay} aria-label="Show all-day section" onChange={onShowAllDayChange} /></label>
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="ScanLine" /></span><span><strong>Current-Time Indicator</strong><small>Show SIOMAC’s accent line and live time label on today.</small></span><Switch checked={showCurrentTime} aria-label="Show current-time indicator" onChange={onShowCurrentTimeChange} /></label>
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="LocateFixed" /></span><span><strong>Open Near Active Work</strong><small>Focus on the current time or first scheduled item when a view opens.</small></span><Switch checked={autoFocusTimeline} aria-label="Automatically focus active timeline" onChange={onAutoFocusTimelineChange} /></label>
                </div>
              </section>
              <section class="cal-pref-section">
                <div class="cal-pref-section-head"><IconTile icon="PanelsTopLeft" tone="group" size="sm" /><span><strong>Event Card Content</strong><small>Choose the supporting details shown when a card has enough space.</small></span></div>
                <div class="cal-pref-behavior-list">
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="MapPin" /></span><span><strong>Locations on Cards</strong><small>Show where the event is taking place.</small></span><Switch checked={showCardLocations} aria-label="Show locations on event cards" onChange={onShowCardLocationsChange} /></label>
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="Users" /></span><span><strong>Attendees on Cards</strong><small>Show meeting participants and overflow counts.</small></span><Switch checked={showCardAttendees} aria-label="Show attendees on event cards" onChange={onShowCardAttendeesChange} /></label>
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="Shapes" /></span><span><strong>Card Icons</strong><small>Show event-type or selected title icons in Week and Month.</small></span><Switch checked={showCardIcons} aria-label="Show icons on event cards" onChange={onShowCardIconsChange} /></label>
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="History" /></span><span><strong>De-emphasise Past Events</strong><small>Reduce colour intensity after an event has ended.</small></span><Switch checked={dimPastEvents} aria-label="Dim past events" onChange={onDimPastEventsChange} /></label>
                </div>
              </section>
              <div class="cal-pref-control-grid">
                <section class="cal-pref-section"><div class="cal-pref-section-head"><IconTile icon="Magnet" tone="group" size="sm" /><span><strong>Drag & Resize Precision</strong><small>Interval used for pointer and keyboard adjustments.</small></span></div><RadioGroup class="cal-pref-precision-options" label="Calendar snap interval" value={`${snapMinutes}`} inline presentation="cards" columns={3} indicator="radio" indicatorPosition="start" density="compact" selectionTreatment="outline" onChange={value => onSnapMinutesChange(Number(value) as CalendarSnapMinutes)} options={[{ value: '15', label: '15 min' }, { value: '30', label: '30 min' }, { value: '60', label: '1 hour' }]} /></section>
                <section class="cal-pref-section"><div class="cal-pref-section-head"><IconTile icon="Clock4" tone="group" size="sm" /><span><strong>Default Event Duration</strong><small>Used for new events and meetings.</small></span></div><RadioGroup class="cal-pref-duration-options" label="Default event duration" value={`${defaultDurationMinutes}`} inline presentation="cards" columns={3} indicator="radio" indicatorPosition="start" density="compact" selectionTreatment="outline" onChange={value => onDefaultDurationMinutesChange(Number(value) as CalendarDefaultDuration)} options={[{ value: '30', label: '30 min' }, { value: '60', label: '1 hr' }, { value: '90', label: '90 min' }]} /></section>
              </div>
              <section class="cal-pref-section"><div class="cal-pref-section-head"><IconTile icon="SmilePlus" tone="group" size="sm" /><span><strong>Title Icon Picker</strong><small>Choose the icon library offered while editing event titles.</small></span></div><RadioGroup class="cal-pref-title-icon-options" label="Title icon picker" value={titleIconType} inline presentation="icon-cards" mediaTreatment="preview" columns={2} indicator="radio" indicatorPosition="start" density="compact" selectionTreatment="outline" onChange={value => onTitleIconTypeChange(value as CalendarTitleIconType)} options={[{ value: 'emoji', label: 'Emoji', media: <TitleIconLibraryPreview type="emoji" /> }, { value: 'lucide', label: 'Lucide', media: <TitleIconLibraryPreview type="lucide" /> }]} /></section>
            </div>
          </TabPanel>

          <TabPanel tabsId="calendar-preference-sections" tabId="context" value={activeSection}>
            <div class="cal-pref-panel">
              <section class="cal-pref-section">
                <div class="cal-pref-section-head"><IconTile icon="CloudSun" tone="group" size="sm" /><span><strong>Calendar Context</strong><small>Add local awareness and choose which days appear.</small></span></div>
                <div class="cal-pref-behavior-list">
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="CloudSun" /></span><span><strong>Weather in Day Headers</strong><small>Show temperature and conditions for the selected work location.</small></span><Switch checked={showWeather} aria-label="Show weather in day headers" onChange={onShowWeatherChange} /></label>
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="PartyPopper" /></span><span><strong>Public-Holiday Context</strong><small>Show published holiday artwork and labels on applicable dates.</small></span><Switch checked={showHolidays} aria-label="Show holiday header artwork" onChange={onShowHolidaysChange} /></label>
                  <label class="cal-pref-behavior-row"><span class="cal-pref-behavior-icon"><LucideIcon name="CalendarRange" /></span><span><strong>Show Weekends</strong><small>Include Saturday and Sunday in Week and Month canvases.</small></span><Switch checked={showWeekends} aria-label="Show weekends" onChange={onShowWeekendsChange} /></label>
                </div>
              </section>
              <section class="cal-pref-section"><div class="cal-pref-section-head"><IconTile icon="MapPinned" tone="group" size="sm" /><span><strong>Weather Location</strong><small>Used only for the contextual forecast shown in Calendar.</small></span></div><RadioGroup class="cal-pref-weather-options" label="Weather location" value={weatherLocation} disabled={!showWeather} inline presentation="cards" columns={3} indicator="radio" indicatorPosition="start" density="compact" selectionTreatment="outline" onChange={value => onWeatherLocationChange(value as CalendarWeatherLocation)} options={[{ value: 'port-of-spain', label: 'Port of Spain' }, { value: 'san-fernando', label: 'San Fernando' }, { value: 'scarborough', label: 'Scarborough' }]} /></section>
              <section class="cal-pref-section"><div class="cal-pref-section-head"><IconTile icon="UsersRound" tone="group" size="sm" /><span><strong>Schedule Scope</strong><small>Only schedules you are authorised to view can appear.</small></span></div><RadioGroup class="cal-pref-scope-options" label="Schedule scope" value={scope} inline presentation="cards" columns={3} indicator="radio" indicatorPosition="start" density="compact" selectionTreatment="outline" onChange={value => onScopeChange(value as CalendarScope)} options={[{ value: 'all', label: 'All Authorised' }, { value: 'mine', label: 'My Schedule' }, { value: 'shared', label: 'Team' }, { value: 'public', label: 'Organisation' }, { value: 'archived', label: 'Completed' }]} /></section>
              {sources.length > 0 ? <section class="cal-pref-source-group"><header class="cal-pref-source-head"><IconTile icon="Layers3" tone="group" size="sm" /><span><strong>Visible Sources</strong><small>Show or hide authorised SIOMAC modules and connected calendars.</small></span></header><div class="cal-pref-source-list">{sources.map(source => <label class="cal-pref-source-row" key={source}><span><strong>{sourceLabel(source)}</strong><small>{source === 'calendar' ? 'Events, tasks, deadlines and reminders created in SIOMAC.' : `Authorised items supplied by ${sourceLabel(source)}.`}</small></span><Switch checked={!hiddenSources.has(source)} aria-label={sourceLabel(source)} onChange={() => onToggleSource(source)} /></label>)}</div></section> : null}
            </div>
          </TabPanel>
        </Dialog.Content>
      </Dialog.Layout>
    </Dialog.Body>
    <Dialog.Footer left={<span class="cal-pref-save"><LucideIcon name="Cloud" /> Changes Save Automatically</span>}><Button variant="primary" onClick={onClose}>Done</Button></Dialog.Footer>
  </Dialog>;
}
