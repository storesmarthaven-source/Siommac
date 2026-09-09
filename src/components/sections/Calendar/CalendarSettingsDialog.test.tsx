import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import { CalendarSettingsDialog } from './CalendarSettingsDialog';

describe('CalendarSettingsDialog', () => {
  it('updates timeline, all-day, scope, and visible-calendar preferences', () => {
    const onZoomChange = vi.fn();
    const onShowAllDayChange = vi.fn();
    const onScopeChange = vi.fn();
    const onToggleSource = vi.fn();
    const onShowWeatherChange = vi.fn();
    const onShowHolidaysChange = vi.fn();
    const onWeatherLocationChange = vi.fn();
    const onTitleIconTypeChange = vi.fn();
    render(<CalendarSettingsDialog open view="week" zoom={1} showAllDay={false} showWeather showHolidays weatherLocation="port-of-spain" titleIconType="emoji" scope="all" sources={['calendar', 'meetings']} hiddenSources={new Set(['meetings'])} onViewChange={vi.fn()} onZoomChange={onZoomChange} onShowAllDayChange={onShowAllDayChange} onShowWeatherChange={onShowWeatherChange} onShowHolidaysChange={onShowHolidaysChange} onWeatherLocationChange={onWeatherLocationChange} onTitleIconTypeChange={onTitleIconTypeChange} onScopeChange={onScopeChange} onToggleSource={onToggleSource} onClose={vi.fn()} />);

    expect(screen.queryByText('Manage Calendars')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Spacious' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show all-day section' }));
    fireEvent.click(screen.getAllByRole('combobox')[0]!);
    fireEvent.pointerDown(screen.getByRole('option', { name: 'San Fernando, Trinidad' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show weather in day headers' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show holiday header artwork' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Lucide Icons' }));
    fireEvent.click(screen.getAllByRole('combobox')[1]!);
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Team schedule' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Meetings' }));

    expect(onZoomChange).toHaveBeenCalledWith(1.15);
    expect(onShowAllDayChange).toHaveBeenCalledWith(true);
    expect(onShowWeatherChange).toHaveBeenCalledWith(false);
    expect(onShowHolidaysChange).toHaveBeenCalledWith(false);
    expect(onWeatherLocationChange).toHaveBeenCalledWith('san-fernando');
    expect(onTitleIconTypeChange).toHaveBeenCalledWith('lucide');
    expect(onScopeChange).toHaveBeenCalledWith('shared');
    expect(onToggleSource).toHaveBeenCalledWith('meetings');
  });
});
