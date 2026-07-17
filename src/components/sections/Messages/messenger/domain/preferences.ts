// Ported verbatim from the Messenger port bundle (src/domain/preferences.ts).
// Client-side appearance preferences (theme/density/text-size). These are NOT
// messaging data — the SIOMAC adapter persists them per-user in localStorage,
// not the backend (there is no messaging-preferences endpoint by design).
export type MessageDensity = "compact" | "comfortable" | "spacious";
export type MessageTextSize = "normal" | "large" | "extra-large";
export type ConversationSurface = "white" | "soft-gray" | "cool-blue";

export interface ChatPreferences {
  accent: string;
  /** Background of RECEIVED (other-party) bubbles — light tints only, the
   *  dark-slate bubble text must stay readable. Own bubbles use `accent`. */
  receivedBubble: string;
  surface: ConversationSurface;
  density: MessageDensity;
  messageTextSize: MessageTextSize;
  highContrast: boolean;
  reducedMotion: boolean;
  enhancedFocus: boolean;
}

export const defaultChatPreferences: ChatPreferences = {
  // The brand navy (--siomac-navy in assets/styles/base.css). The port's
  // original #001f3f was mislabelled "SIOMAC Navy" — it never matched the kit.
  accent: "#1b2d54",
  receivedBubble: "#ffffff",
  surface: "soft-gray",
  density: "comfortable",
  messageTextSize: "normal",
  highContrast: false,
  reducedMotion: false,
  enhancedFocus: true,
};
