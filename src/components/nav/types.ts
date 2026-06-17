/**
 * src/components/nav/types.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

export interface SectionItem {
  id:    string;
  label: string;
  icon:  string;
  sub?:  string;
}

export interface PaletteItem {
  id:      string;
  name:    string;
  primary: string;
  dark:    string;
  light:   string;
  accent:  string;
  hover:   string;
}

export interface LayoutItem {
  id:   string;
  name: string;
  desc: string;
  icon: string;
}

export interface SiomacConfig {
  SECTION_DEFS:      Record<string, SectionItem[]>;
  BASELINE_SECTIONS: SectionItem[];
  COMMON_ITEMS:      SectionItem[];
  PALETTES:          PaletteItem[];
  LAYOUTS:           LayoutItem[];
}

// Header badge counts from getHeaderCounts
export interface HeaderCounts {
  notificationIds?: string[];
  messages?:        number;
  tickets?:         number;
  pendingLeaves?:   number;
  activeSites?:     number;
}

// Notification item from getNotifications
export interface NotifItem {
  id:       string;
  type:     string;
  title:    string;
  sub:      string;
  body?:    string;
  icon:     string;
  color:    string;
  time:     string;
  rawTime?: string;
  photoUrl?: string;
}

// Message item from getMessages
export interface MsgItem {
  id:               string | number;
  fromUsername:     string;
  fromName:         string;
  fromPhoto:        string;
  toUsername:       string;
  toName:           string;
  toPhoto:          string;
  subject:          string;
  body:             string;
  isUnread:         boolean;
  readByRecipient:  boolean;
  createdAt:        string;
  latestAt?:        string;
  unreadReplyCount: number;
  otherPartyDeleted?: boolean;
  replies:          MsgReply[];
}

export interface MsgReply {
  id:          string | number;
  fromUsername: string;
  fromName:    string;
  fromPhoto:   string;
  body:        string;
  createdAt:   string;
}

// Ticket item from getTickets
export interface TicketItem {
  id:           string | number;
  ticketNumber: string;
  status:       string;
  fromUsername: string;
  fromName:     string;
  fromPhoto:    string;
  subject:      string;
  body:         string;
  createdAt:    string;
  replies:      TicketReply[];
}

export interface TicketReply {
  id:           string | number;
  fromUsername: string;
  fromName:     string;
  fromPhoto:    string;
  body:         string;
  createdAt:    string;
}
