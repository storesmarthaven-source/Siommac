// Ported verbatim from the Messenger port bundle (src/domain/preferences.ts).
// Client-side appearance preferences (theme/density/text-size). These are NOT
// messaging data — the SIOMAC adapter persists them per-user in localStorage,
// not the backend (there is no messaging-preferences endpoint by design).
export type MessageDensity = "compact" | "comfortable" | "spacious";
export type MessageTextSize = "normal" | "large" | "extra-large";
export type ConversationSurface = "white" | "soft-gray" | "cool-blue";

export interface ChatPreferences {
  accent: string;
  surface: ConversationSurface;
  density: MessageDensity;
  messageTextSize: MessageTextSize;
  highContrast: boolean;
  reducedMotion: boolean;
  enhancedFocus: boolean;
}

export const defaultChatPreferences: ChatPreferences = {
  accent: "#001f3f",
  surface: "soft-gray",
  density: "comfortable",
  messageTextSize: "normal",
  highContrast: false,
  reducedMotion: false,
  enhancedFocus: true,
};
