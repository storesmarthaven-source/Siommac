// MessengerWorkspace — the SIOMAC entry point for the ported Messenger.
// Constructs the adapter set once per mount, injects the signed-in user from
// the session store, and bridges SIOMAC's communication_signals refetch signal
// (via the messengerSignalBus fed by useRealtimeSignals) into the Messenger's
// RealtimeGateway as `snapshot-changed`.
//
// Mounted behind the messenger feature flag alongside the legacy MessageCenter
// (Phase 4); reaching parity retires the legacy center.
import { useEffect, useMemo } from "preact/hooks";
import { useSessionStore } from "@/store/session";
import { useCommsSummary } from "@api/communications";
import { createSiomacMessagingAdapters } from "./adapters";
import { MessagingProvider } from "./app/MessagingProvider";
import { MessagesWorkspace } from "./ui/components/MessagesWorkspace";
import { onMessagesSignal } from "./integration/messengerSignalBus";
import "./ui/styles/messenger.css";

export function MessengerWorkspace() {
  const userId = useSessionStore((state) => state.userId);
  const adapters = useMemo(() => createSiomacMessagingAdapters(), []);

  useEffect(() => {
    const unsubscribe = onMessagesSignal(() => {
      adapters.realtime.publish({ type: "snapshot-changed", sourceId: "siomac-realtime" });
    });
    return () => { unsubscribe(); adapters.realtime.close(); };
  }, [adapters]);

  // Feed the server-issued realtime token into the gateway so the private
  // typing/presence channels can join; the 30s summary poll rotates it.
  const { data: summary } = useCommsSummary();
  const realtimeToken = summary?.realtimeToken ?? null;
  useEffect(() => {
    if (userId && realtimeToken) adapters.realtime.setAuth(realtimeToken, userId);
  }, [adapters, realtimeToken, userId]);

  if (!userId) {
    return <div className="sm-workspace"><div className="sm-error"><strong>Messages are unavailable</strong><span>Sign in to view your conversations.</span></div></div>;
  }

  return (
    <MessagingProvider
      repository={adapters.repository}
      realtime={adapters.realtime}
      attachments={adapters.attachments}
      currentUserId={userId}
    >
      <MessagesWorkspace />
    </MessagingProvider>
  );
}
