import { type VNode } from 'preact';
import { Button, Checkbox, Dialog, FormField, LucideIcon, SegmentedControl, Select } from '@ui';
import type { CalendarTitleIconType } from '../../../../types/calendar';
import type { CalendarWeatherLocation } from '../../../../types/uiPreferences';
import type { CalendarScope, CalendarViewMode } from './calendarViewModel';

export function CalendarSettingsDialog({
  open,
  view,
  zoom,
  showAllDay,
  showWeather,
  showHolidays,
  weatherLocation,
  titleIconType,
  scope,
  sources,
  hiddenSources,
  onViewChange,
  onZoomChange,
  onShowAllDayChange,
  onShowWeatherChange,
  onShowHolidaysChange,
  onWeatherLocationChange,
  onTitleIconTypeChange,
  onScopeChange,
  onToggleSource,
  onClose,
}: {
  open: boolean;
  view: CalendarViewMode;
  zoom: number;
  showAllDay: boolean;
  showWeather: boolean;
  showHolidays: boolean;
  weatherLocation: CalendarWeatherLocation;
  titleIconType: CalendarTitleIconType;
  scope: CalendarScope;
  sources: string[];
  hiddenSources: ReadonlySet<string>;
  onViewChange: (view: CalendarViewMode) => void;
  onZoomChange: (zoom: number) => void;
  onShowAllDayChange: (show: boolean) => void;
  onShowWeatherChange: (show: boolean) => void;
  onShowHolidaysChange: (show: boolean) => void;
  onWeatherLocationChange: (location: CalendarWeatherLocation) => void;
  onTitleIconTypeChange: (type: CalendarTitleIconType) => void;
  onScopeChange: (scope: CalendarScope) => void;
  onToggleSource: (source: string) => void;
  onClose: () => void;
}): VNode | null {
  return (
    <Dialog open={open} onClose={onClose} size="xl" variant="form" class="cal-settings-dialog">
      <Dialog.Header title="Calendar Settings" sub="Personalise the way your calendar looks and behaves" icon={<LucideIcon name="Settings2" size={18} />} onClose={onClose} />
      <Dialog.Body>
        <div class="cal-settings-preferences">
        <Dialog.Section title="Calendar View" desc="Choose the layout used for your schedule.">
          <SegmentedControl size="sm" value={view} onChange={onViewChange} label="Default calendar view" options={[
            { value: 'day', label: 'Day', icon: <LucideIcon name="CalendarDays" size={14} /> },
            { value: 'week', label: 'Week', icon: <LucideIcon name="CalendarRange" size={14} /> },
            { value: 'month', label: 'Month', icon: <LucideIcon name="Calendar" size={14} /> },
            { value: 'agenda', label: 'Schedule', icon: <LucideIcon name="List" size={14} /> },
            { value: 'tasks', label: 'Tasks', icon: <LucideIcon name="ListChecks" size={14} /> },
          ]} />
        </Dialog.Section>
        <Dialog.Section title="Timeline" desc="Control spacing without changing event times.">
          <SegmentedControl size="sm" value={zoom <= .9 ? 'compact' : zoom >= 1.1 ? 'spacious' : 'comfortable'} onChange={value => onZoomChange(value === 'compact' ? .85 : value === 'spacious' ? 1.15 : 1)} label="Timeline spacing" options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'spacious', label: 'Spacious' },
          ]} />
          <Checkbox checked={showAllDay} onChange={onShowAllDayChange} label="Show all-day section" />
        </Dialog.Section>
        <Dialog.Section title="Day Context" desc="Choose the optional context shown beside each date.">
          <div class="cal-settings-context-toggles">
            <Checkbox checked={showWeather} onChange={onShowWeatherChange} label="Show weather in day headers" />
            <Checkbox checked={showHolidays} onChange={onShowHolidaysChange} label="Show holiday header artwork" />
          </div>
          <FormField label="Weather location">
            <Select value={weatherLocation} disabled={!showWeather} onChange={value => onWeatherLocationChange(value as CalendarWeatherLocation)} options={[
              { value: 'port-of-spain', label: 'Port of Spain, Trinidad' },
              { value: 'san-fernando', label: 'San Fernando, Trinidad' },
              { value: 'scarborough', label: 'Scarborough, Tobago' },
            ]} />
          </FormField>
        </Dialog.Section>
        <Dialog.Section title="Event Title Icons" desc="Choose the picker available beside event and task titles. Icons are optional and appear consistently across calendar views.">
          <SegmentedControl size="sm" value={titleIconType} onChange={value => onTitleIconTypeChange(value)} label="Title icon picker" options={[
            { value: 'emoji', label: 'Emoji', icon: <LucideIcon name="SmilePlus" size={14} /> },
            { value: 'lucide', label: 'Lucide Icons', icon: <LucideIcon name="Shapes" size={14} /> },
          ]} />
        </Dialog.Section>
        <Dialog.Section title="Schedule Scope" desc="Choose which authorised items appear in the calendar.">
          <Select value={scope} onChange={value => onScopeChange(value as CalendarScope)} options={[
            { value: 'all', label: 'All authorised schedules' },
            { value: 'mine', label: 'My schedule' },
            { value: 'shared', label: 'Team schedule' },
            { value: 'public', label: 'Organisation schedule' },
            { value: 'archived', label: 'Completed and cancelled' },
          ]} />
        </Dialog.Section>
        {sources.length ? <Dialog.Section title="Visible Sources" desc="Turn calendar sources on or off.">
          <div class="cal-settings-sources">
            {sources.map(source => <Checkbox key={source} checked={!hiddenSources.has(source)} onChange={() => onToggleSource(source)} label={source === 'calendar' ? 'Calendar' : source.split(/[-_]/g).map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ')} />)}
          </div>
        </Dialog.Section> : null}
        </div>
      </Dialog.Body>
      <Dialog.Footer><Button variant="primary" onClick={onClose}>Done</Button></Dialog.Footer>
    </Dialog>
  );
}
