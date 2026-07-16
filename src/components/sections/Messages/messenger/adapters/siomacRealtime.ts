// adapters/siomacRealtime.ts — the RealtimeGateway port, refetch-only.
//
// SIOMAC realtime is "a signal tells the client to refetch" (communication_signals
// over Supabase Realtime), NOT an authoritative message stream. So this gateway is
// a transport-agnostic local event bus: the app layer (which can use hooks) bridges
// the SIOMAC realtime signal into it by calling `publish({ type:'snapshot-changed' })`
// whenever a messages-domain signal fires; the UI subscribes and refetches.
//
// Typing/presence are hidden for the initial release (their own future slices), so
// publishing them is a local no-op — nothing is sent server-side.
import type { RealtimeEvent, RealtimeGateway } from '../domain/ports';

export class SiomacRealtimeGateway implements RealtimeGateway {
  private readonly listeners = new Set<(event: RealtimeEvent) => void>();
  private closed = false;

  /** Deliver a realtime event to subscribers. The app bridges SIOMAC's refetch
   *  signal here as `{ type:'snapshot-changed', sourceId }`. Typing/presence are
   *  ignored until those features ship. */
  publish(event: RealtimeEvent): void {
    if (this.closed) return;
    if (event.type !== 'snapshot-changed') return;   // typing/presence not wired yet
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}
