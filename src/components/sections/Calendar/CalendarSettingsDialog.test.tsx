import { fireEvent, render, screen, within } from '@testing-library/preact';
import { vi } from 'vitest';
import { CalendarSettingsDialog } from './CalendarSettingsDialog';

describe('CalendarSettingsDialog', () => {
  it('wires professional planning, timeline, context, and visibility preferences', () => {
    const onViewChange = vi.fn();
    const onWeekLayoutChange = vi.fn();
    const onColumnZoomChange = vi.fn();
    const onWeekTimelineZoomChange = vi.fn();
    const onWeekStartsOnChange = vi.fn();
    const onSnapMinutesChange = vi.fn();
    const onShowAllDayChange = vi.fn();
    const onShowCurrentTimeChange = vi.fn();
    const onAutoFocusTimelineChange = vi.fn();
    const onDefaultDurationMinutesChange = vi.fn();
    const onShowWeekendsChange = vi.fn();
    const onDimPastEventsChange = vi.fn();
    const onShowCardLocationsChange = vi.fn();
    const onShowCardAttendeesChange = vi.fn();
    const onShowCardIconsChange = vi.fn();
    const onMonthEventLimitChange = vi.fn();
    const onScopeChange = vi.fn();
    const onToggleSource = vi.fn();
    const onShowWeatherChange = vi.fn();
    const onShowHolidaysChange = vi.fn();
    const onWeatherLocationChange = vi.fn();
    const onTitleIconTypeChange = vi.fn();

    render(<CalendarSettingsDialog
      open
      view="week"
      weekLayout="timeline"
      columnZoom={1}
      weekTimelineZoom={1.15}
      weekStartsOn="sunday"
      snapMinutes={15}
      showAllDay={false}
      showCurrentTime
      autoFocusTimeline
      defaultDurationMinutes={60}
      showWeekends
      dimPastEvents={false}
      showCardLocations
      showCardAttendees
      showCardIcons
      monthEventLimit={3}
      showWeather
      showHolidays
      weatherLocation="port-of-spain"
      titleIconType="emoji"
      scope="all"
      sources={['calendar', 'meetings']}
      hiddenSources={new Set(['meetings'])}
      onViewChange={onViewChange}
      onWeekLayoutChange={onWeekLayoutChange}
      onColumnZoomChange={onColumnZoomChange}
      onWeekTimelineZoomChange={onWeekTimelineZoomChange}
      onWeekStartsOnChange={onWeekStartsOnChange}
      onSnapMinutesChange={onSnapMinutesChange}
      onShowAllDayChange={onShowAllDayChange}
      onShowCurrentTimeChange={onShowCurrentTimeChange}
      onAutoFocusTimelineChange={onAutoFocusTimelineChange}
      onDefaultDurationMinutesChange={onDefaultDurationMinutesChange}
      onShowWeekendsChange={onShowWeekendsChange}
      onDimPastEventsChange={onDimPastEventsChange}
      onShowCardLocationsChange={onShowCardLocationsChange}
      onShowCardAttendeesChange={onShowCardAttendeesChange}
      onShowCardIconsChange={onShowCardIconsChange}
      onMonthEventLimitChange={onMonthEventLimitChange}
      onShowWeatherChange={onShowWeatherChange}
      onShowHolidaysChange={onShowHolidaysChange}
      onWeatherLocationChange={onWeatherLocationChange}
      onTitleIconTypeChange={onTitleIconTypeChange}
      onScopeChange={onScopeChange}
      onToggleSource={onToggleSource}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('tablist', { name: 'Calendar Settings Sections' })).toBeTruthy();
    expect(screen.getByText('Schedule Data Stays Authoritative')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Month/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^Monday/ }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Month events per day' })).getByRole('radio', { name: '4' }));

    fireEvent.click(screen.getByRole('tab', { name: /^Timeline & Cards/ }));
    expect(within(screen.getByRole('radiogroup', { name: 'Default event duration' })).queryByRole('radio', { name: '2 hr' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Columns/ }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Day and column scale' })).getByRole('radio', { name: '100%' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Week timeline scale' })).getByRole('radio', { name: '100%' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Calendar snap interval' })).getByRole('radio', { name: '30 min' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Default event duration' })).getByRole('radio', { name: '90 min' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Lucide/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show all-day section' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show current-time indicator' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Automatically focus active timeline' }));

    fireEvent.click(screen.getByRole('switch', { name: 'Show locations on event cards' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show attendees on event cards' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show icons on event cards' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Dim past events' }));

    fireEvent.click(screen.getByRole('tab', { name: /^Context & Sources/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'San Fernando' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show weather in day headers' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show holiday header artwork' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show weekends' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Team' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Meetings' }));

    expect(onViewChange).toHaveBeenCalledWith('month');
    expect(onWeekStartsOnChange).toHaveBeenCalledWith('monday');
    expect(onTitleIconTypeChange).toHaveBeenCalledWith('lucide');
    expect(onWeekLayoutChange).toHaveBeenCalledWith('columns');
    expect(onColumnZoomChange).toHaveBeenCalledWith(1.2);
    expect(onWeekTimelineZoomChange).toHaveBeenCalledWith(1.6);
    expect(onSnapMinutesChange).toHaveBeenCalledWith(30);
    expect(onShowAllDayChange).toHaveBeenCalledWith(true);
    expect(onShowCurrentTimeChange).toHaveBeenCalledWith(false);
    expect(onAutoFocusTimelineChange).toHaveBeenCalledWith(false);
    expect(onDefaultDurationMinutesChange).toHaveBeenCalledWith(90);
    expect(onShowWeekendsChange).toHaveBeenCalledWith(false);
    expect(onDimPastEventsChange).toHaveBeenCalledWith(true);
    expect(onShowCardLocationsChange).toHaveBeenCalledWith(false);
    expect(onShowCardAttendeesChange).toHaveBeenCalledWith(false);
    expect(onShowCardIconsChange).toHaveBeenCalledWith(false);
    expect(onMonthEventLimitChange).toHaveBeenCalledWith(4);
    expect(onShowWeatherChange).toHaveBeenCalledWith(false);
    expect(onShowHolidaysChange).toHaveBeenCalledWith(false);
    expect(onWeatherLocationChange).toHaveBeenCalledWith('san-fernando');
    expect(onScopeChange).toHaveBeenCalledWith('shared');
    expect(onToggleSource).toHaveBeenCalledWith('meetings');
  });
});
