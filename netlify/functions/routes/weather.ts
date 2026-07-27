/**
 * routes/weather.ts
 *
 * Platform weather, proxied server-side from Open-Meteo.
 *
 * Routes (all POST, mounted at /api):
 *   /weather/snapshot  — current conditions + a short daily outlook for a coordinate
 *
 * Why a proxy at all, for public data with no API key:
 *   • Spec §2 — protected data goes through authenticated Netlify JWT APIs; no NEW direct
 *     browser calls for app data. Keeping the pattern uniform means one place to add caching,
 *     rate limiting or a paid provider later without touching any widget.
 *   • It keeps the provider off the client's network surface, so swapping providers is a
 *     server change only — the shared DTO (types/weather.ts) is the contract.
 *
 * These are READS of third-party public data. They deliberately do NOT emit app_events /
 * audit_logs: nothing about the organisation changes, and logging a widget's periodic refresh
 * would bury the audit trail in noise. The §2 mutation backbone applies to mutations.
 */

import { Hono }                from 'hono';
import { requirePermission }   from '../lib/auth';
import { z, zv }               from '../lib/validate';
import type { WeatherSnapshot, WeatherDay, WeatherHour } from '../../../types/weather';
import type { HonoVariables }  from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** A widget must never hang on a third party — fail fast and let the card show its error state. */
const UPSTREAM_TIMEOUT_MS = 6_000;
const OUTLOOK_DAYS = 4;
/** Hours of near-term series kept for the metric-card sparklines. */
const OUTLOOK_HOURS = 24;

/** WMO weather interpretation codes → one label set, resolved here so every consumer agrees. */
const WMO_LABELS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snowfall', 73: 'Moderate snowfall', 75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};
function wmoLabel(code: unknown): string {
  return typeof code === 'number' && WMO_LABELS[code] ? WMO_LABELS[code] : 'Unknown conditions';
}

/** Strings only when the provider actually sent one. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

/** Numbers only when the provider actually sent one — never coerce a missing value to 0. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fetchUpstream(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch {
    // Timeout / DNS / network — the provider is the failure, not the caller.
    throw Object.assign(new Error('The weather service is unavailable.'), { status: 502 });
  }
  if (!response.ok) throw Object.assign(new Error('The weather service returned an error.'), { status: 502 });
  return response.json();
}

// A /weather/search route (Open-Meteo geocoding) was written and then REMOVED: the widget
// config panel has no picker/search field type (WidgetConfigFieldType is text | color | select
// | multiSelect | dateRange | number | boolean | threshold | statusFilter), so nothing could
// call it. Shipping an endpoint no UI reaches is dead code. Add it back together with a
// config-panel picker field, not before.

// ── POST /weather/snapshot — current conditions + short outlook ─────────────
router.post('/weather/snapshot', async c => {
  await requirePermission(c, 'platform.weather.view');
  const body = c.get('body');
  const v = zv(c, z.object({
    latitude:  z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name:      z.string().trim().max(120).optional(),
  }), body.args ?? body);
  if (!v.ok) return v.response;
  const { latitude, longitude, name } = v.data;

  const url = `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,is_day'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max'
    + '&hourly=precipitation,uv_index,wind_speed_10m'
    + `&timezone=auto&forecast_days=${OUTLOOK_DAYS}`;

  try {
    const data = await fetchUpstream(url) as {
      timezone?: unknown;
      current?: Record<string, unknown>;
      // Partial: a missing daily key is `undefined` at runtime, so the `?? []`
      // guards below on this EXTERNAL API response are necessary, not redundant.
      daily?: Partial<Record<string, unknown[]>>;
      // Same as daily: a missing hourly key is `undefined` at runtime, so the
      // `?? []` guards below on this EXTERNAL API response are necessary.
      hourly?: Partial<Record<string, unknown[]>>;
    };
    const cur = data.current ?? {};
    const temperatureC = num(cur.temperature_2m);
    // Without a temperature there is no snapshot to render — surface it rather than ship zeros.
    if (temperatureC == null) {
      return c.json({ success: false, message: 'The weather service returned no current conditions.' }, 502);
    }

    const daily = data.daily ?? {};
    const dates = (daily.time ?? []);
    const days: WeatherDay[] = dates.map((date, i) => {
      const code = num((daily.weather_code ?? [])[i]) ?? -1;
      return {
        date: typeof date === 'string' ? date : '',
        minC: num((daily.temperature_2m_min ?? [])[i]) ?? temperatureC,
        maxC: num((daily.temperature_2m_max ?? [])[i]) ?? temperatureC,
        code,
        label: wmoLabel(code),
        precipitationProbabilityPct: num((daily.precipitation_probability_max ?? [])[i]),
        sunrise: str((daily.sunrise ?? [])[i]),
        sunset:  str((daily.sunset ?? [])[i]),
        uvIndexMax: num((daily.uv_index_max ?? [])[i]),
      };
    }).filter(d => d.date.length > 0);

    // Hourly series — trimmed to the window starting at the current hour so a sparkline reads
    // "from now on" rather than replaying the small hours of this morning.
    const hourly = data.hourly ?? {};
    const hourTimes = (hourly.time ?? []);
    const nowHour = typeof cur.time === 'string' ? (cur.time).slice(0, 13) : null;
    const startIndex = Math.max(0, nowHour ? hourTimes.findIndex(t => typeof t === 'string' && t.slice(0, 13) === nowHour) : 0);
    const hours: WeatherHour[] = hourTimes
      .slice(startIndex, startIndex + OUTLOOK_HOURS)
      .map((time, offset) => {
        const i = startIndex + offset;
        return {
          time: typeof time === 'string' ? time : '',
          precipitationMm: num((hourly.precipitation ?? [])[i]),
          uvIndex: num((hourly.uv_index ?? [])[i]),
          windKph: num((hourly.wind_speed_10m ?? [])[i]),
        };
      })
      .filter(h => h.time.length > 0);

    const code = num(cur.weather_code) ?? -1;
    const snapshot: WeatherSnapshot = {
      location: {
        id: Math.round(latitude * 1e4) * 1e4 + Math.round(longitude * 1e4),
        name: name?.length ? name : `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
        admin1: null, country: '', countryCode: '',
        latitude, longitude,
        timezone: typeof data.timezone === 'string' ? data.timezone : 'UTC',
      },
      current: {
        temperatureC,
        apparentC: num(cur.apparent_temperature) ?? temperatureC,
        humidityPct: num(cur.relative_humidity_2m) ?? 0,
        windKph: num(cur.wind_speed_10m) ?? 0,
        windDirectionDeg: num(cur.wind_direction_10m) ?? 0,
        gustKph: num(cur.wind_gusts_10m),
        precipitationMm: num(cur.precipitation) ?? 0,
        pressureHpa: num(cur.surface_pressure),
        isDay: num(cur.is_day) !== 0,
        code,
        label: wmoLabel(code),
      },
      daily: days,
      hourly: hours,
      observedAt: typeof cur.time === 'string' ? cur.time : new Date().toISOString(),
    };
    return c.json({ success: true, data: snapshot });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return c.json({ success: false, message: (e as Error).message }, status as 500 | 502);
  }
});

export default router;
