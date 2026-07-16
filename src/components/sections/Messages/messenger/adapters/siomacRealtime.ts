// adapters/siomacRealtime.ts — the RealtimeGateway port.
//
// Three transports behind ONE local event bus:
//   • snapshot-changed — SIOMAC's refetch signal (communication_signals over
//     postgres_changes) is bridged in by the workspace via publish(); refetch
//     stays the ONLY authoritative data path.
//   • typing — ephemeral broadcast on a PRIVATE channel `siomac:typing:<threadId>`
//     (participant-gated by realtime.messages RLS, migration 365). publish()
//     SENDS on the active thread's channel; received broadcasts fan to listeners.
//   • presence — Supabase presence on the shared PRIVATE channel `siomac:presence`;
//     joins/leaves fan to listeners as {type:'presence'} events.
//
// Both live channels require the server-issued ES256 realtime token
// (lib/realtimeAuth.ts): the workspace pushes it in via setAuth() whenever the
// comms summary re-mints it. Without a token (env unconfigured) the gateway
// stays a local bus — typing/presence are simply absent, nothing breaks.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@cfg';
import type { RealtimeEvent, RealtimeGateway } from '../domain/ports';
import type { ThreadId, UserId } from '../domain/models';

type SupabaseClient  = ReturnType<typeof window.supabase.createClient>;
type SupabaseChannel = ReturnType<SupabaseClient['channel']>;

/** How long a received typing=true is considered live before the UI drops it
 *  (senders refresh every TYPING_REFRESH_MS while input continues). */
export const TYPING_TTL_MS = 4_000;
export const TYPING_REFRESH_MS = 2_000;

export class SiomacRealtimeGateway implements RealtimeGateway {
  private readonly listeners = new Set<(event: RealtimeEvent) => void>();
  private closed = false;

  private client: SupabaseClient | null = null;
  private userId: UserId | null = null;

  private presenceChannel: SupabaseChannel | null = null;
  private typingChannel: SupabaseChannel | null = null;
  private typingThreadId: ThreadId | null = null;
  /** Users currently online per the last presence sync. */
  private online = new Set<UserId>();

  // ── RealtimeGateway port ────────────────────────────────────────────────────

  publish(event: RealtimeEvent): void {
    if (this.closed) return;
    if (event.type === 'snapshot-changed') {
      for (const listener of this.listeners) listener(event);
      return;
    }
    if (event.type === 'typing') {
      // Outbound: send on the active thread's private channel. Not echoed
      // locally — the sender's own composer never shows their indicator.
      if (this.typingChannel && this.typingThreadId === event.threadId) {
        void this.typingChannel.send({
          type: 'broadcast', event: 'typing',
          payload: { userId: event.userId, active: event.active },
        });
      }
      return;
    }
    // presence is transport-driven (track/untrack) — nothing to publish.
  }

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.leaveTyping();
    this.leavePresence();
    this.client = null;
  }

  // ── SIOMAC extensions (driven by MessengerWorkspace / MessagingProvider) ───

  /** Push/rotate the server-issued realtime token. First call with a token
   *  opens the presence channel; rotations re-auth the live socket in place. */
  setAuth(token: string | null, userId: UserId): void {
    if (this.closed || !token) return;
    this.userId = userId;
    if (!this.client) {
      if (typeof window === 'undefined' || !window.supabase) return;
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth:     { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 10 } },
      }) as unknown as SupabaseClient;
      (client as unknown as { realtime: { setAuth(t: string): void } }).realtime.setAuth(token);
      this.client = client;
      this.joinPresence();
      // A thread may have been selected before auth arrived — join it now.
      if (this.typingThreadId && !this.typingChannel) this.joinTyping(this.typingThreadId);
    } else {
      (this.client as unknown as { realtime: { setAuth(t: string): void } }).realtime.setAuth(token);
    }
  }

  /** Follow the active thread: leave the previous typing channel, join the
   *  new one (no-op until authed — setAuth() joins the pending thread). */
  setActiveThread(threadId: ThreadId | null): void {
    if (this.closed || threadId === this.typingThreadId) return;
    this.leaveTyping();
    this.typingThreadId = threadId;
    if (threadId && this.client) this.joinTyping(threadId);
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private emit(event: RealtimeEvent): void {
    if (this.closed) return;
    for (const listener of this.listeners) listener(event);
  }

  private joinPresence(): void {
    if (!this.client || !this.userId || this.presenceChannel) return;
    const me = this.userId;
    const channel = this.client.channel('siomac:presence', {
      config: { private: true, presence: { key: me } },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, unknown[]>;
        const next = new Set<UserId>(Object.keys(state));
        // Fan out the delta so the provider updates only what changed.
        for (const id of next) if (!this.online.has(id)) this.emit({ type: 'presence', sourceId: 'siomac-presence', userId: id, presence: 'online' });
        for (const id of this.online) if (!next.has(id)) this.emit({ type: 'presence', sourceId: 'siomac-presence', userId: id, presence: 'offline' });
        this.online = next;
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') void channel.track({ onlineAt: new Date().toISOString() });
      });
    this.presenceChannel = channel;
  }

  private leavePresence(): void {
    if (this.presenceChannel && this.client) void this.client.removeChannel(this.presenceChannel);
    this.presenceChannel = null;
    this.online = new Set();
  }

  private joinTyping(threadId: ThreadId): void {
    if (!this.client || this.typingChannel) return;
    const channel = this.client.channel(`siomac:typing:${threadId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload?: { userId?: string; active?: boolean } }) => {
        if (!payload?.userId || payload.userId === this.userId) return;
        this.emit({ type: 'typing', sourceId: 'siomac-typing', threadId, userId: payload.userId, active: payload.active === true });
      })
      .subscribe();
    this.typingChannel = channel;
  }

  private leaveTyping(): void {
    if (this.typingChannel && this.client) void this.client.removeChannel(this.typingChannel);
    this.typingChannel = null;
  }
}
