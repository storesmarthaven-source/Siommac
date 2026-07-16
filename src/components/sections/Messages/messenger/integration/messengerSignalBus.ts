// integration/messengerSignalBus.ts — module-global bridge between SIOMAC's
// communication_signals realtime subscription (src/hooks/useRealtimeSignals.ts,
// mounted once in the app shell) and the Messenger's per-session RealtimeGateway.
//
// The realtime hook calls emitMessagesSignal() whenever a messages-domain signal
// fires; the mounted MessengerWorkspace subscribes and forwards it into its
// gateway as a `snapshot-changed` refetch event. When the Messenger is not
// mounted the emit is a no-op.
type Listener = () => void;

const listeners = new Set<Listener>();

/** Called by useRealtimeSignals on every messages-domain signal. */
export function emitMessagesSignal(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to messages-domain realtime signals. Returns an unsubscribe fn. */
export function onMessagesSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
