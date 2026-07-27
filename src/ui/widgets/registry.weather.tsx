/**
 * registry.weather.tsx — platform Weather widget.
 *
 * Reads the authenticated /api/weather/snapshot proxy (Open-Meteo server-side; see
 * routes/weather.ts) through the ONE shared DTO in types/weather.ts. Location is per
 * INSTANCE: each placement carries its own coordinates in widget config, so two copies on
 * the same board can watch two sites.
 *
 * Sizes are in the canonical grid unit (cellHeight 6 + 12px gap → 18h − 12 px), and minRows
 * is a genuine RENDER floor, not the default size — see the platform guard tests.
 */

import { type VNode } from 'preact';
import { useWeatherSnapshot } from '@api/weather';
import type { WeatherDay, WeatherHour, WeatherSnapshot } from '../../../types/weather';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { defineWidget } from './defineWidget';
import { findWidgetDataSource, registerWidgetDataSource } from './dataSources';
import type { WidgetDef, WidgetRenderProps, WidgetSizeDef } from './types';
import './weatherWidget.css';

const WEATHER_SOURCE = {
  sourceKey: 'platform.weather',
  label: 'Weather API',
  refreshIntervalMs: 15 * 60_000,
  permissions: ['platform.weather.view'],
};

if (!findWidgetDataSource(WEATHER_SOURCE.sourceKey)) {
  registerWidgetDataSource({
    key: WEATHER_SOURCE.sourceKey,
    label: WEATHER_SOURCE.label,
    endpoint: '/api/weather/snapshot',
    permission: 'platform.weather.view',
    scope: 'organization',
    refresh: { mode: 'interval', intervalMs: WEATHER_SOURCE.refreshIntervalMs },
    authenticated: true,
  });
}

/** Same footprint as the workforce-pulse cards (PULSE_SIZES) — a short, wide band. The card is
 *  laid out horizontally to match, and reveals its stats row then its outlook as height allows
 *  (container queries in weatherWidget.css), so every size shows a complete card, never a
 *  half-clipped one. */
const WEATHER_SIZES: WidgetSizeDef[] = [
  { key: 'compact',  label: 'Compact',  grid: { w: 4, h: 6 },  min: { w: 3, h: 6 }, description: 'Conditions only' },
  { key: 'standard', label: 'Standard', grid: { w: 6, h: 11 }, min: { w: 3, h: 6 }, description: 'Conditions plus stats' },
  { key: 'wide',     label: 'Wide',     grid: { w: 8, h: 17 }, min: { w: 3, h: 6 }, description: 'Conditions, stats and outlook' },
];

/** Trinidad & Tobago — a sensible first render before anyone configures a location. */
const DEFAULT_CONFIG: Record<string, unknown> = {
  latitude: 10.6549,
  longitude: -61.5019,
  place: 'Port of Spain',
};

/** WMO code → icon. Grouped by family; anything unmapped falls back to cloud. */
function weatherIcon(code: number, isDay: boolean): LucideName {
  if (code === 0) return isDay ? 'Sun' : 'Moon';
  if (code === 1 || code === 2) return isDay ? 'CloudSun' : 'CloudMoon';
  if (code === 3) return 'Cloud';
  if (code === 45 || code === 48) return 'CloudFog';
  if (code >= 51 && code <= 57) return 'CloudDrizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'CloudRain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'CloudSnow';
  if (code >= 95) return 'CloudLightning';
  return 'Cloud';
}

const round = (value: number): string => `${Math.round(value)}°`;

/** WMO code → backdrop scene. Drives the animated sky layer and the card's colour ramp; the
 *  families match weatherIcon() so the icon and the backdrop can never disagree. */
type WeatherScene = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';
function weatherScene(code: number): WeatherScene {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3) return 'cloud';
  if (code === 1 || code === 2) return 'cloud';
  return 'sun';
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** Degrees → 8-point compass label; 337.5°+ wraps back to N. */
function compass(deg: number): string {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}
/** "06:12" from the provider's local ISO time; null in, null out. */
function clockTime(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(date: string, index: number): string {
  if (index === 0) return 'Today';
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-GB', { weekday: 'short' });
}

function configNumber(config: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = config?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Presentational card — shared by the live widget and the library preview so the two can
 *  never drift. Takes a resolved snapshot; knows nothing about fetching. */
function WeatherView({ snapshot }: { snapshot: WeatherSnapshot }): VNode {
  const { current, daily, location } = snapshot;
  const outlook: WeatherDay[] = daily.slice(0, 4);
  const today = daily[0];
  const sunrise = clockTime(today?.sunrise ?? null);
  const sunset = clockTime(today?.sunset ?? null);
  const observed = clockTime(snapshot.observedAt);
  const scene = weatherScene(current.code);
  return (
    <article class={`wxw is-${scene} ${current.isDay ? 'is-day' : 'is-night'}`}
      data-widget-content-root aria-label={`Weather for ${location.name}`}>
      {/* Animated conditions backdrop — rain streaks, drifting cloud, sun glow, snow or a storm
          flash, chosen from the WMO code. Purely decorative and aria-hidden; it holds no data,
          and it stops entirely under prefers-reduced-motion. */}
      <div class="wxw-sky" aria-hidden="true">
        <i class="wxw-sky-a" /><i class="wxw-sky-b" /><i class="wxw-sky-c" />
      </div>

      {/* Fixed 84px band — place pill + observation time, big temperature, condition read. */}
      <div class="wxw-band">
        <span class="wxw-pill">
          <LucideIcon name="MapPin" size={13} strokeWidth={2.2} />
          <span class="wxw-place">{location.name}</span>
        </span>
        {observed && <span class="wxw-time" title="Observed">{observed}</span>}
        <span class="wxw-ic">
          <LucideIcon name={weatherIcon(current.code, current.isDay)} size={34} strokeWidth={1.7} />
        </span>
        <span class="wxw-temp">{round(current.temperatureC)}</span>
        <span class="wxw-side">
          <span class="wxw-cond">{current.label}</span>
          <span class="wxw-feels">Feels like <b>{round(current.apparentC)}</b></span>
        </span>
      </div>

      {/* Revealed by height — see the container queries in weatherWidget.css. Every value is
          observed; anything the provider omitted is left out rather than shown as a zero. */}
      <div class="wxw-stats">
        <span title="Humidity"><LucideIcon name="Droplets" size={13} />{Math.round(current.humidityPct)}%</span>
        <span title="Wind"><LucideIcon name="Wind" size={13} />{Math.round(current.windKph)} {compass(current.windDirectionDeg)}</span>
        {current.gustKph != null && <span title="Gusting"><LucideIcon name="Gauge" size={13} />{Math.round(current.gustKph)}</span>}
        <span title="Precipitation"><LucideIcon name="CloudRain" size={13} />{current.precipitationMm.toFixed(1)}mm</span>
      </div>

      <div class="wxw-sun">
        {sunrise && <span title="Sunrise"><LucideIcon name="Sunrise" size={13} />{sunrise}</span>}
        {sunset && <span title="Sunset"><LucideIcon name="Sunset" size={13} />{sunset}</span>}
        {today?.uvIndexMax != null && <span title="Peak UV index"><LucideIcon name="SunMedium" size={13} />UV {Math.round(today.uvIndexMax)}</span>}
        {current.pressureHpa != null && <span title="Pressure"><LucideIcon name="CircleGauge" size={13} />{Math.round(current.pressureHpa)} hPa</span>}
      </div>

      {outlook.length > 1 && (
        <div class="wxw-outlook">
          {outlook.map((day, index) => (
            <div class="wxw-day" key={day.date}>
              <span class="wxw-day-l">{dayLabel(day.date, index)}</span>
              <LucideIcon name={weatherIcon(day.code, true)} size={16} strokeWidth={1.7} />
              <span class="wxw-day-t">{round(day.maxC)}<i>{round(day.minC)}</i></span>
              {day.precipitationProbabilityPct != null && (
                <span class="wxw-day-p">{Math.round(day.precipitationProbabilityPct)}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}


// ── Metric card ──────────────────────────────────────────────────────────────
// Square layout: place + high/low, oversized temperature beside the condition icon, the
// condition label, then ONE focus metric with its own visualisation along the bottom.

type WeatherMetric = 'precipitation' | 'uv' | 'wind';

/** WHO UV bands. The label is the headline on the UV card, so it must be the standard scale. */
function uvBand(uv: number): string {
  if (uv >= 11) return 'Extreme';
  if (uv >= 8) return 'Very high';
  if (uv >= 6) return 'High';
  if (uv >= 3) return 'Moderate';
  return 'Low';
}

/** Series → an SVG polyline across a 100x36 box. Returns null when there is nothing real to
 *  draw, so the card omits the chart rather than rendering a flat invented baseline. */
function sparkPath(values: (number | null)[]): string | null {
  const points = values.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  if (points.filter(v => v !== null).length < 2) return null;
  const max = Math.max(...points.map(v => v ?? 0), 0.001);
  const step = 100 / Math.max(1, points.length - 1);
  return points
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(34 - ((v ?? 0) / max) * 30).toFixed(1)}`)
    .join(' ');
}

function MetricVisual({ metric, hourly, windDeg }: { metric: WeatherMetric; hourly: WeatherHour[]; windDeg: number }): VNode | null {
  if (metric === 'wind') {
    // Compass dial — the arrow points the way the wind is blowing TO (meteorological + 180).
    return (
      <div class="wxm-compass" aria-hidden="true">
        <span class="wxm-compass-n">N</span><span class="wxm-compass-e">E</span>
        <span class="wxm-compass-s">S</span><span class="wxm-compass-w">W</span>
        <span class="wxm-compass-hub" style={`transform:rotate(${windDeg + 180}deg)`}>
          <LucideIcon name="ArrowUp" size={13} strokeWidth={2.6} />
        </span>
      </div>
    );
  }
  const series = hourly.map(h => (metric === 'uv' ? h.uvIndex : h.precipitationMm));
  const path = sparkPath(series);
  if (!path) return null;
  const peak = series.reduce<{ v: number; i: number }>((best, v, i) => (v != null && v > best.v ? { v, i } : best), { v: -Infinity, i: -1 });
  return (
    <svg class="wxm-spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <g class="wxm-spark-ticks">
        {series.map((_, i) => i % 2 === 0 && <rect key={i} x={i * (100 / Math.max(1, series.length - 1)) - 1.1} y="2" width="2.2" height="34" rx="1.1" />)}
      </g>
      <path class="wxm-spark-line" d={path} vector-effect="non-scaling-stroke" />
      {metric === 'uv' && peak.i >= 0 && (
        <circle class="wxm-spark-peak" cx={peak.i * (100 / Math.max(1, series.length - 1))} cy={34 - (peak.v / Math.max(...series.map(v => v ?? 0), 0.001)) * 30} r="2.6" />
      )}
    </svg>
  );
}

function WeatherMetricCard({ snapshot, metric }: { snapshot: WeatherSnapshot; metric: WeatherMetric }): VNode {
  const { current, daily, location, hourly } = snapshot;
  const today = daily[0];
  const scene = weatherScene(current.code);
  const uv = today?.uvIndexMax ?? null;

  const read = metric === 'precipitation'
    ? { label: 'Precipitation', value: `${current.precipitationMm.toFixed(current.precipitationMm < 10 ? 1 : 0)} mm` }
    : metric === 'uv'
      ? { label: 'UV index', value: uv != null ? uvBand(uv) : 'Not reported' }
      : { label: 'Wind', value: `${Math.round(current.windKph)} km/h` };

  return (
    <article class={`wxm is-${metric} is-${scene} ${current.isDay ? 'is-day' : 'is-night'}`}
      data-widget-content-root aria-label={`Weather for ${location.name}`}>
      <div class="wxm-top">
        <span class="wxm-place">{location.name}</span>
        {today && (
          <span class="wxm-range">
            <b>&#9650;</b>{round(today.maxC)} <b>&#9660;</b>{round(today.minC)}
          </span>
        )}
      </div>

      <div class="wxm-read">
        <span class="wxm-temp">{round(current.temperatureC)}</span>
        <span class="wxm-ic"><LucideIcon name={weatherIcon(current.code, current.isDay)} size={44} strokeWidth={1.8} /></span>
      </div>
      <div class="wxm-cond">{current.label}</div>

      <div class="wxm-foot">
        <div class="wxm-metric">
          <span class="wxm-metric-l">{read.label}</span>
          <span class="wxm-metric-v">{read.value}</span>
        </div>
        <div class="wxm-viz">
          <MetricVisual metric={metric} hourly={hourly} windDeg={current.windDirectionDeg} />
          {metric === 'uv' && uv != null && <span class="wxm-badge">{Math.round(uv)}</span>}
        </div>
      </div>
    </article>
  );
}

/** Library preview — fixed sample data, clearly labelled as a sample by the library chrome.
 *  Deliberately does NOT call the API: the catalogue renders many tiles at once. */
const PREVIEW_SNAPSHOT: WeatherSnapshot = {
  location: { id: 1, name: 'Port of Spain', admin1: null, country: 'Trinidad and Tobago', countryCode: 'TT', latitude: 10.6549, longitude: -61.5019, timezone: 'America/Port_of_Spain' },
  current: { temperatureC: 29, apparentC: 33, humidityPct: 74, windKph: 14, windDirectionDeg: 90, gustKph: 26, precipitationMm: 0.2, pressureHpa: 1013, isDay: true, code: 2, label: 'Partly cloudy' },
  daily: [
    { date: '2026-07-30', minC: 24, maxC: 31, code: 2, label: 'Partly cloudy', precipitationProbabilityPct: 30, sunrise: '2026-07-30T05:47', sunset: '2026-07-30T18:23', uvIndexMax: 11 },
    { date: '2026-07-31', minC: 24, maxC: 30, code: 61, label: 'Slight rain', precipitationProbabilityPct: 60, sunrise: '2026-07-31T05:47', sunset: '2026-07-31T18:23', uvIndexMax: 9 },
    { date: '2026-08-01', minC: 23, maxC: 30, code: 80, label: 'Slight rain showers', precipitationProbabilityPct: 55, sunrise: '2026-08-01T05:47', sunset: '2026-08-01T18:23', uvIndexMax: 10 },
    { date: '2026-08-02', minC: 24, maxC: 31, code: 1, label: 'Mainly clear', precipitationProbabilityPct: 20, sunrise: '2026-08-02T05:47', sunset: '2026-08-02T18:23', uvIndexMax: 11 },
  ],
  hourly: Array.from({ length: 24 }, (_, i) => ({
    time: `2026-07-30T${String(i).padStart(2, '0')}:00`,
    precipitationMm: [0, 0, .2, .6, 1.1, .4, 0, 0][i % 8] ?? 0,
    uvIndex: Math.max(0, Math.round(Math.sin((i - 6) / 12 * Math.PI) * 11 * 10) / 10),
    windKph: 10 + (i % 6) * 2.5,
  })),
  observedAt: '2026-07-30T12:00',
};
// ── Strip card ───────────────────────────────────────────────────────────────
// A SLIM full-width bar carrying every measurement we hold, on one line. Given enough width it
// shows the lot; as it narrows it sheds groups in reverse order of usefulness (outlook →
// pressure → sun times → gust → feels-like → condition) rather than wrapping or clipping —
// see the container queries in weatherWidget.css. Each dropped group is the least operationally
// useful one remaining, so what survives at any width is the most decision-relevant subset.

function WeatherStripCard({ snapshot }: { snapshot: WeatherSnapshot }): VNode {
  const { current, daily, location } = snapshot;
  const today = daily[0];
  const outlook: WeatherDay[] = daily.slice(0, 4);
  const scene = weatherScene(current.code);
  const sunrise = clockTime(today?.sunrise ?? null);
  const sunset = clockTime(today?.sunset ?? null);
  const uv = today?.uvIndexMax ?? null;

  return (
    <article class={`wxs is-${scene} ${current.isDay ? 'is-day' : 'is-night'}`}
      data-widget-content-root aria-label={`Weather for ${location.name}`}>
      <span class="wxs-ic"><LucideIcon name={weatherIcon(current.code, current.isDay)} size={24} strokeWidth={1.8} /></span>
      <span class="wxs-temp">{round(current.temperatureC)}</span>
      <span class="wxs-id">
        <span class="wxs-place">{location.name}</span>
        <span class="wxs-cond">{current.label}</span>
      </span>

      {today && (
        <span class="wxs-item wxs-range" title="Today’s high and low">
          <b>&#9650;</b>{round(today.maxC)}<b>&#9660;</b>{round(today.minC)}
        </span>
      )}
      <span class="wxs-item wxs-feels" title="Feels like">
        <LucideIcon name="Thermometer" size={12} />{round(current.apparentC)}
      </span>
      <span class="wxs-item" title="Humidity"><LucideIcon name="Droplets" size={12} />{Math.round(current.humidityPct)}%</span>
      <span class="wxs-item" title="Wind">
        <LucideIcon name="Wind" size={12} />{Math.round(current.windKph)} {compass(current.windDirectionDeg)}
      </span>
      {current.gustKph != null && (
        <span class="wxs-item wxs-gust" title="Gusting"><LucideIcon name="Gauge" size={12} />{Math.round(current.gustKph)}</span>
      )}
      <span class="wxs-item" title="Precipitation">
        <LucideIcon name="CloudRain" size={12} />{current.precipitationMm.toFixed(1)}mm
      </span>
      {uv != null && (
        <span class="wxs-item wxs-uv" title="Peak UV index today">
          <LucideIcon name="SunMedium" size={12} />UV {Math.round(uv)}
          <span class="wxs-uv-band">· {uvBand(uv)}</span>
        </span>
      )}
      {sunrise && <span class="wxs-item wxs-sun" title="Sunrise"><LucideIcon name="Sunrise" size={12} />{sunrise}</span>}
      {sunset && <span class="wxs-item wxs-sun" title="Sunset"><LucideIcon name="Sunset" size={12} />{sunset}</span>}
      {current.pressureHpa != null && (
        <span class="wxs-item wxs-pressure" title="Pressure">
          <LucideIcon name="CircleGauge" size={12} />{Math.round(current.pressureHpa)} hPa
        </span>
      )}

      {outlook.length > 1 && (
        <span class="wxs-days">
          {outlook.map((day, index) => (
            <span class="wxs-day" key={day.date}>
              <span class="wxs-day-l">{dayLabel(day.date, index)}</span>
              <LucideIcon name={weatherIcon(day.code, true)} size={13} strokeWidth={1.8} />
              <span class="wxs-day-t">{round(day.maxC)}<i>{round(day.minC)}</i></span>
            </span>
          ))}
        </span>
      )}
    </article>
  );
}

// ── One fetch path, SEPARATE widgets ─────────────────────────────────────────
// Each card is its own catalogue entry — discoverable as its own tile in the library — while
// sharing this single hook, these renderers and one route. Only the WidgetDef differs; no
// rendering or fetching logic is duplicated.

/** Resolves the configured location, fetches, and hands back either a state card to render or
 *  the snapshot — so loading and error handling stay identical across all four widgets. */
function useCardSnapshot(config: Record<string, unknown> | undefined):
{ state: VNode; snapshot?: undefined } | { state?: undefined; snapshot: WeatherSnapshot } {
  const latitude  = configNumber(config, 'latitude', DEFAULT_CONFIG.latitude as number);
  const longitude = configNumber(config, 'longitude', DEFAULT_CONFIG.longitude as number);
  const place = typeof config?.place === 'string' && config.place.length
    ? config.place
    : DEFAULT_CONFIG.place as string;

  const { data, isLoading, isError, error } = useWeatherSnapshot({ latitude, longitude, name: place });

  // Cold path only — never a fake "0°" while the first request is in flight. (`isLoading`
  // is already false once cached data exists, so it cannot mask a warm render.)
  if (isLoading) {
    return { state: (
      <article class="wxw" data-widget-content-root aria-label="Weather">
        <div class="wxw-state"><LucideIcon name="LoaderCircle" size={30} class="wxw-spin" /><span>Loading weather</span></div>
      </article>
    ) };
  }
  if (isError || !data) {
    return { state: (
      <article class="wxw" data-widget-content-root aria-label="Weather">
        <div class="wxw-state" role="alert">
          <LucideIcon name="CloudOff" size={30} />
          <strong>Weather unavailable</strong>
          <span>{error?.message ?? 'The weather service could not be reached.'}</span>
        </div>
      </article>
    ) };
  }
  return { snapshot: data };
}

function WeatherBandWidget({ config }: WidgetRenderProps): VNode {
  const result = useCardSnapshot(config);
  return result.state ?? <WeatherView snapshot={result.snapshot} />;
}
function WeatherStripWidget({ config }: WidgetRenderProps): VNode {
  const result = useCardSnapshot(config);
  return result.state ?? <WeatherStripCard snapshot={result.snapshot} />;
}
/** One renderer per metric — the metric is fixed by the widget, not chosen in config. */
function metricWidget(metric: WeatherMetric): (props: WidgetRenderProps) => VNode {
  return function WeatherMetricWidget({ config }: WidgetRenderProps): VNode {
    const result = useCardSnapshot(config);
    return result.state ?? <WeatherMetricCard snapshot={result.snapshot} metric={metric} />;
  };
}

/** Location is the only configurable thing on every weather card. */
const LOCATION_FIELDS: WidgetDef['configSchema'] = [
  { key: 'place', label: 'Location name', type: 'text', defaultValue: DEFAULT_CONFIG.place, required: true, helpText: 'Shown on the card.' },
  { key: 'latitude', label: 'Latitude', type: 'number', defaultValue: DEFAULT_CONFIG.latitude, required: true, helpText: 'Decimal degrees, −90 to 90.' },
  { key: 'longitude', label: 'Longitude', type: 'number', defaultValue: DEFAULT_CONFIG.longitude, required: true, helpText: 'Decimal degrees, −180 to 180.' },
];

/** Square footprint for the metric cards — w5 × h17 is ~283 × 294px on a 24-column board. */
const METRIC_SIZES: WidgetSizeDef[] = [
  { key: 'compact',  label: 'Compact',  grid: { w: 4, h: 14 }, min: { w: 2, h: 4 }, description: 'Compact metric card' },
  { key: 'standard', label: 'Standard', grid: { w: 5, h: 17 }, min: { w: 2, h: 4 }, description: 'Square metric card' },
  { key: 'wide',     label: 'Wide',     grid: { w: 6, h: 20 }, min: { w: 2, h: 4 }, description: 'Expanded metric card' },
];

/** Slim strip — WIDE and short. h4 = 60px, h5 = 78px; it wants columns, not rows, because the
 *  whole point is fitting every reading on one line. */
const STRIP_SIZES: WidgetSizeDef[] = [
  { key: 'compact',  label: 'Compact',  grid: { w: 12, h: 4 }, min: { w: 6, h: 4 }, description: 'Slim strip — core readings' },
  { key: 'standard', label: 'Standard', grid: { w: 18, h: 5 }, min: { w: 6, h: 4 }, description: 'Slim strip — most readings' },
  { key: 'wide',     label: 'Full width', grid: { w: 24, h: 5 }, min: { w: 6, h: 4 }, description: 'Slim strip — every reading plus the outlook' },
];

function weatherDefinition(input: {
  id: string; title: string; description: string; icon: string;
  sizes: WidgetSizeDef[]; defaultColumns: number; defaultRows: number;
  minColumns: number; minRows: number;
  minWidth: number; minHeight: number; previewAspect: number;
  render: (props: WidgetRenderProps) => VNode; renderPreview: () => VNode;
}): WidgetDef {
  return defineWidget({
    id: input.id, module: 'enterprise', area: 'Site Conditions',
    title: input.title, description: input.description,
    longDescription: `${input.description} Reads an authenticated server-side weather proxy; each placement carries its own location, so one board can watch several sites.`,
    icon: input.icon, category: 'Site Conditions',
    tags: ['weather', 'conditions', 'forecast', 'site'],
    previewVariant: 'metric', chrome: 'none', sizeToContent: false,
    supportedPages: ['*'], supportedZones: ['main'],
    defaultSize: 'standard', allowedSizes: input.sizes,
    sizeConstraints: {
      defaultColumns: input.defaultColumns, defaultRows: input.defaultRows,
      minColumns: input.minColumns, minRows: input.minRows,
      minWidth: input.minWidth, minHeight: input.minHeight,
      resizeStrategy: 'content-measured',
    },
    previewAspect: input.previewAspect,
    defaultConfig: DEFAULT_CONFIG, configSchema: LOCATION_FIELDS,
    dataSource: WEATHER_SOURCE, dataSourceKey: WEATHER_SOURCE.sourceKey,
    governance: { state: 'enabled', discoverable: true, requiredCapabilities: ['platform.weather.view'] },
    permissions: { requiredPermissions: ['platform.weather.view'] },
    runtimeState: 'live-api',
    motion: { kind: 'sequence', durationMs: 520, reducedMotion: 'static' },
    render: input.render, renderPreview: input.renderPreview,
  });
}

export const widgets: WidgetDef[] = [
  weatherDefinition({
    id: 'platform.weather.current', title: 'Weather', icon: 'fa-cloud-sun',
    description: 'Current conditions with an animated sky, plus stats and a 4-day outlook as the card grows.',
    sizes: WEATHER_SIZES, defaultColumns: 6, defaultRows: 11, minColumns: 3, minRows: 6,
    minWidth: 150, minHeight: 96, previewAspect: 2.2,
    render: WeatherBandWidget, renderPreview: () => <WeatherView snapshot={PREVIEW_SNAPSHOT} />,
  }),
  weatherDefinition({
    id: 'platform.weather.strip', title: 'Weather · Strip', icon: 'fa-grip-lines',
    description: 'Every reading on one slim line — conditions, high/low, humidity, wind, gust, rain, UV, sun times, pressure and the outlook.',
    sizes: STRIP_SIZES, defaultColumns: 18, defaultRows: 5, minColumns: 4, minRows: 4,
    minWidth: 260, minHeight: 60, previewAspect: 5,
    render: WeatherStripWidget, renderPreview: () => <WeatherStripCard snapshot={PREVIEW_SNAPSHOT} />,
  }),
  weatherDefinition({
    id: 'platform.weather.precipitation', title: 'Weather · Precipitation', icon: 'fa-cloud-rain',
    description: 'Rainfall now over an hourly trace, with today’s high and low.',
    sizes: METRIC_SIZES, defaultColumns: 5, defaultRows: 17, minColumns: 2, minRows: 4,
    minWidth: 120, minHeight: 56, previewAspect: 1,
    render: metricWidget('precipitation'),
    renderPreview: () => <WeatherMetricCard snapshot={PREVIEW_SNAPSHOT} metric="precipitation" />,
  }),
  weatherDefinition({
    id: 'platform.weather.uv', title: 'Weather · UV index', icon: 'fa-sun',
    description: 'Peak UV on the WHO scale (Low → Extreme) over an hourly curve.',
    sizes: METRIC_SIZES, defaultColumns: 5, defaultRows: 17, minColumns: 2, minRows: 4,
    minWidth: 120, minHeight: 56, previewAspect: 1,
    render: metricWidget('uv'),
    renderPreview: () => <WeatherMetricCard snapshot={PREVIEW_SNAPSHOT} metric="uv" />,
  }),
  weatherDefinition({
    id: 'platform.weather.wind', title: 'Weather · Wind', icon: 'fa-wind',
    description: 'Wind speed with a compass dial showing its direction.',
    sizes: METRIC_SIZES, defaultColumns: 5, defaultRows: 17, minColumns: 2, minRows: 4,
    minWidth: 120, minHeight: 56, previewAspect: 1,
    render: metricWidget('wind'),
    renderPreview: () => <WeatherMetricCard snapshot={PREVIEW_SNAPSHOT} metric="wind" />,
  }),
];
