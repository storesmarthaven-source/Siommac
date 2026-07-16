// Ported from the bundle (src/integration/messagingNotifications.ts) with the
// one prescribed change: toasts go through the real SIOMAC toast system
// (@ui/toast — the AppShell Toaster is the only mounted renderer).
import type { CollaborationCard, Thread } from "../domain/models";
import { toast } from "@ui/toast";

interface OpenAction { onOpen(): void }

export function notifyChatParticipantAdded(thread: Thread, personName: string, { onOpen }: OpenAction) {
  return toast.action({
    variant: "success", title: `${personName} added to the conversation`,
    description: "They can now participate in this chat, subject to their SIOMAC module permissions.",
    moduleLabel: "Messages", statusLabel: thread.kind === "group" ? "Group chat" : "Direct chat",
    details: [{ label: "Conversation", value: thread.name }, { label: "Participant", value: personName }],
    note: "Conversation membership does not grant access to linked module records.",
    actions: [{ label: "Dismiss" }, { label: "View chat", tone: "primary", onClick: onOpen }],
  });
}

export function notifyGroupChatStarted(thread: Thread, participantCount: number, { onOpen }: OpenAction) {
  return toast.action({
    variant: "success", title: "Group conversation started",
    description: `${thread.name} is ready for team communication.`,
    moduleLabel: "Messages", statusLabel: "New group",
    details: [{ label: "Group", value: thread.name }, { label: "Participants", value: String(participantCount) }],
    actions: [{ label: "Dismiss" }, { label: "Open group", tone: "primary", onClick: onOpen }],
  });
}

export function notifyCollaborationStarted(card: CollaborationCard, { onOpen }: OpenAction) {
  return toast.rich({
    id: `collaboration-started:${card.id}`, variant: "info", title: "Collaboration started",
    description: `${card.title} is now available for collaborative follow-up.`,
    moduleLabel: card.record.type, statusLabel: card.status,
    details: [{ label: "Related record", value: `${card.record.type} · ${card.record.id}` }, { label: "Collaborators", value: String(card.collaboratorIds.length) }],
    file: { name: card.title, type: card.type === "worksheet" ? "xlsx" : "file", subtitle: card.subtitle, meta: [{ label: "Status", value: card.status }, { label: "Owner", value: "Assigned" }, { label: "Team", value: `${card.collaboratorIds.length} people` }] },
    note: "Actions remain governed by the linked module's access policy.",
    actions: [{ label: "Dismiss" }, { label: "View collaboration", tone: "primary", onClick: onOpen }],
  });
}

export function notifyCollaborationMemberAdded(card: CollaborationCard, personName: string, { onOpen }: OpenAction) {
  return toast.action({
    variant: "success", title: `${personName} added as a collaborator`,
    description: `Collaboration membership was updated for ${card.title}.`,
    moduleLabel: card.record.type, statusLabel: "Collaborator added",
    details: [{ label: "Record", value: card.record.id }, { label: "Collaborator", value: personName }],
    note: "The linked module remains authoritative for view, comment, edit, and download permissions.",
    actions: [{ label: "Dismiss" }, { label: "Review collaboration", tone: "primary", onClick: onOpen }],
  });
}
