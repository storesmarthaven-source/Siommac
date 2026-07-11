/**
 * src/components/sections/Calendar/CalendarPage.tsx
 *
 * The Calendar & Tasks page. v1 slice: Month view + day drawer + a live stat row,
 * all wired to /calendar/list (native tasks/activities + module deadlines, with
 * recurrence expanded server-side). Today/prev/next navigation is functional.
 * (New-item dialog, Filter, and the Week/Day/Agenda views land next.)
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { useCalendarList, type CalendarItemDTO } from '@api/calendar';
import { MonthView } from './MonthView';
import { DayDrawer } from './DayDrawer';
import {
  monthGrid, toLocalDateKey, monthLabel, itemDateKey, isOverdue, startOfMonth,
} from '@lib/calendar/date';
import './calendar.css';

function StatCard({ icon, tone, value, label }: { icon: string; tone: string; value: number; label: string }): VNode {
  return (
    <div class="cal-stat">
      <span class={`cal-stat-ico ${tone}`}><i class={`fas ${icon}`} aria-hidden="true" /></span>
      <div>
        <div class="cal-stat-val">{value}</div>
        <div class="cal-stat-lbl">{label}</div>
      </div>
    </div>
  );
}

export function CalendarPage(): VNode {
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState<string>(() => toLocalDateKey(new Date()));

  // The visible window is the whole 6×7 grid (so leading/trailing days show items too).
  const grid = useMemo(() => monthGrid(viewMonth), [viewMonth]);
  const from = toLocalDateKey(grid[0]!);
  const to   = toLocalDateKey(grid[grid.length - 1]!);

  const listQ = useCalendarList({ from, to });
  const items: CalendarItemDTO[] = listQ.data ?? [];
  const cold = listQ.isLoading && !listQ.data;

  const stats = useMemo(() => ({
    total:      items.length,
    deadlines:  items.filter(i => i.type === 'deadline').length,
    tasks:      items.filter(i => i.type === 'task').length,
    activities: items.filter(i => i.type === 'activity').length,
    overdue:    items.filter(isOverdue).length,
  }), [items]);

  const dayItems = useMemo(
    () => items.filter(i => itemDateKey(i) === selectedKey),
    [items, selectedKey],
  );

  const shiftMonth = (delta: number) => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const goToday = () => { const now = new Date(); setViewMonth(startOfMonth(now)); setSelectedKey(toLocalDateKey(now)); };

  const openItem = (item: CalendarItemDTO) => { const k = itemDateKey(item); if (k) setSelectedKey(k); };

  return (
    <div class="cal-root">
      {/* Header */}
      <div class="cal-head">
        <div>
          <h1 class="cal-title">Calendar &amp; Tasks</h1>
          <p class="cal-sub">Deadlines, tasks and activities across every module — one calendar.</p>
        </div>
        <div class="cal-toolbar">
          <button class="cal-btn" onClick={goToday}>Today</button>
          <div class="cal-nav">
            <button class="cal-btn is-icon" onClick={() => shiftMonth(-1)} aria-label="Previous month"><i class="fas fa-chevron-left" /></button>
            <button class="cal-btn is-icon" onClick={() => shiftMonth(1)} aria-label="Next month"><i class="fas fa-chevron-right" /></button>
          </div>
          <div class="cal-btn" style="cursor:default"><i class="fas fa-calendar" />{monthLabel(viewMonth)}</div>
          <div class="cal-views">
            <button class="active">Month</button>
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div class="cal-stats">
        <StatCard icon="fa-calendar-days" tone="blue"   value={stats.total}      label="Total Events" />
        <StatCard icon="fa-clock"          tone="amber"  value={stats.deadlines}  label="Deadlines" />
        <StatCard icon="fa-circle-check"   tone="green"  value={stats.tasks}      label="Tasks" />
        <StatCard icon="fa-users"          tone="purple" value={stats.activities} label="Activities" />
        <StatCard icon="fa-triangle-exclamation" tone="red" value={stats.overdue} label="Overdue" />
      </div>

      {/* Body: month grid + day drawer */}
      <div class="cal-body has-drawer">
        {cold ? (
          <div class="cal-surface" style="padding:16px"><div class="cal-skel" style="height:640px" /></div>
        ) : (
          <MonthView
            month={viewMonth}
            items={items}
            selectedKey={selectedKey}
            onSelectDay={setSelectedKey}
            onOpenItem={openItem}
          />
        )}
        <DayDrawer
          date={new Date(`${selectedKey}T12:00:00`)}
          items={dayItems}
          loading={cold}
          onClose={() => setSelectedKey('')}
          onOpenItem={openItem}
        />
      </div>

      {/* Legend */}
      <div class="cal-surface" style="margin-top:14px">
        <div class="cal-legend">
          <span class="cal-legend-item"><span class="cal-dot cal-dot--deadline" /> Deadline</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot--task" /> Task</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot--activity" /> Activity</span>
          <span class="grow" />
          {listQ.isError ? <span style="color:var(--cal-red)">Failed to load — retry shortly.</span> : null}
        </div>
      </div>
    </div>
  );
}
