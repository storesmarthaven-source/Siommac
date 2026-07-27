/**
 * types/weather.ts — ONE shared DTO for the platform weather widget, imported by BOTH the
 * backend route and the frontend hook (house rule: no per-endpoint mappers).
 *
 * Source is Open-Meteo, called SERVER-SIDE only (spec §2 — no new direct browser calls for
 * app data). It needs no API key, so there is no credential in play; the route still requires
 * an authenticated, permissioned user so the proxy can't be used anonymously.
 *
 * Everything here is observed data. The WMO numeric code is resolved to `label` server-side
 * so one mapping serves every consumer, and nothing is invented when the provider omits a
 * field — optional values stay null rather than defaulting to a plausible-looking number.
 */

/** A resolved place. Returned by search and echoed back on every snapshot. */
export interface WeatherLocation {
  /** Provider place id — stable enough to key a widget config on. */
  id: number;
  name: string;
  /** Region/state, when the provider supplies one. */
  admin1: string | null;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  /** IANA zone the observation times are expressed in. */
  timezone: string;
}

export interface WeatherCurrent {
  temperatureC: number;
  /** "Feels like" — humidity/wind adjusted. */
  apparentC: number;
  humidityPct: number;
  windKph: number;
  windDirectionDeg: number;
  /** Peak gust. Null when the provider omits it. */
  gustKph: number | null;
  precipitationMm: number;
  /** Surface pressure in hPa, null when absent. */
  pressureHpa: number | null;
  isDay: boolean;
  /** WMO weather interpretation code. */
  code: number;
  /** Human label resolved from `code` server-side. */
  label: string;
}

export interface WeatherDay {
  /** Calendar date, YYYY-MM-DD in the location's timezone. */
  date: string;
  minC: number;
  maxC: number;
  code: number;
  label: string;
  /** Null when the provider returns no probability for the day. */
  precipitationProbabilityPct: number | null;
  /** Local ISO times, null when the provider omits them (polar day/night). */
  sunrise: string | null;
  sunset: string | null;
  /** Peak UV index for the day, null when absent. */
  uvIndexMax: number | null;
}

/** One hour of the near-term series. Powers the metric-card sparklines; each field is null
 *  when the provider omitted it, so a chart draws nothing rather than a flat fake zero line. */
export interface WeatherHour {
  /** Local ISO hour, e.g. "2026-07-30T14:00". */
  time: string;
  precipitationMm: number | null;
  uvIndex: number | null;
  windKph: number | null;
}

export interface WeatherSnapshot {
  location: WeatherLocation;
  current: WeatherCurrent;
  /** Today first, then the next few days. */
  daily: WeatherDay[];
  /** Rolling series from the current hour forward — see WeatherHour. */
  hourly: WeatherHour[];
  /** When the provider observed it (ISO 8601). */
  observedAt: string;
}

// ── request ─────────────────────────────────────────────────────────────────

export interface WeatherSnapshotRequest {
  latitude: number;
  longitude: number;
  /** Echoed into the response so the card can label a place the user picked. */
  name?: string;
}
