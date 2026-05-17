const TZ = process.env.APP_TZ ?? 'America/Port_of_Spain';

const today = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const hhmm24 = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

const dateOnly = (v: string | null | undefined): string =>
  !v ? '' : String(v).slice(0, 10);

const cap = (s: string | null | undefined): string =>
  s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '';

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number): number => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export { TZ, today, hhmm24, dateOnly, cap, num, r2, haversine };
