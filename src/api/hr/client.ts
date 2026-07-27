/** Shared fail-closed handling for authenticated HR API envelopes. */

export interface HrApiEnvelope {
  success: boolean;
  message?: string;
  code?: string;
  status?: number;
}

export class HrApiError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(path: string, response: HrApiEnvelope) {
    const message = response.message?.trim();
    super(message?.length ? message : `Request to ${path} failed.`);
    this.name = 'HrApiError';
    this.code = response.code;
    this.status = response.status;
  }

  get isConflict(): boolean {
    return this.status === 409 || this.code === 'conflict' || this.code === 'stale_write';
  }
}

/**
 * Assert the application-level envelope before a query or mutation can resolve.
 * apiPost intentionally resolves network/backend rejections as `{success:false}`;
 * HR clients must turn those into rejected promises so TanStack Query enters its
 * error path and mutation success handlers/toasts never run.
 */
export function requireHrSuccess<T extends HrApiEnvelope>(response: T, path: string): T {
  if (!response.success) throw new HrApiError(path, response);
  return response;
}

export function requireHrData<T>(response: HrApiEnvelope & { data?: T }, path: string): T {
  const successful = requireHrSuccess(response, path);
  if (successful.data === undefined) {
    throw new HrApiError(path, { success: false, message: `Request to ${path} returned no data.` });
  }
  return successful.data;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/** Stable FNV-1a 64-bit content key: identical business input dedupes retries. */
export function withContentIdempotencyKey<T extends object>(scope: string, args: T): T & { idempotencyKey: string } {
  const existing = (args as { idempotencyKey?: unknown }).idempotencyKey;
  if (typeof existing === 'string' && existing.trim()) {
    return { ...args, idempotencyKey: existing };
  }

  let hash = 0xcbf29ce484222325n;
  const input = `${scope}:${canonical(args)}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return { ...args, idempotencyKey: `hr-${scope}-${hash.toString(16).padStart(16, '0')}` };
}
