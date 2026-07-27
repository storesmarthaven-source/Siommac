/**
 * src/api/weather.ts
 *
 * TanStack Query hooks for the platform weather proxy. Reads the ONE shared DTO
 * (types/weather.ts) that the backend route returns — no per-endpoint mapper.
 */

import { useQuery } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { useSessionStore } from '@store/session';
import type { WeatherSnapshot, WeatherSnapshotRequest } from '../../types/weather';

export type { WeatherSnapshot, WeatherLocation, WeatherCurrent, WeatherDay } from '../../types/weather';

export const weatherKeys = {
  all: ['weather'] as const,
  snapshot: (req: WeatherSnapshotRequest) => [...weatherKeys.all, 'snapshot', req.latitude, req.longitude] as const,
};

/** The route envelope — apiPost resolves the WHOLE response, so the hooks unwrap `data`. */
interface SnapshotEnvelope { success: boolean; data: WeatherSnapshot; message?: string }

/** Conditions + short outlook for a coordinate. Refetches on the widget's own cadence. */
export function useWeatherSnapshot(req: WeatherSnapshotRequest | null) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: req ? weatherKeys.snapshot(req) : [...weatherKeys.all, 'snapshot', 'none'],
    queryFn: async ({ signal }) => {
      const res = await apiPost<SnapshotEnvelope>('weather/snapshot', req as unknown as Record<string, unknown>, { signal });
      return res.data;
    },
    enabled: isAuthenticated && req !== null,
    // Weather moves slowly; a widget on a dashboard shouldn't hammer the proxy.
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}
