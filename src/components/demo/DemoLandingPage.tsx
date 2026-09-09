import { type VNode } from 'preact';
import { FeatureLandingPage, type LucideName } from '@ui';
import type { DemoPageId } from '@lib/demoMode';

interface LandingDefinition {
  icon: LucideName;
  title: string;
  description: string;
  cards: readonly { eyebrow: string; title: string; text: string }[];
}

const DEFINITIONS: Record<DemoPageId, LandingDefinition> = {
  messages: {
    icon: 'MessagesSquare',
    title: 'One Place for Every Operational Conversation',
    description: 'Bring people, SIOMAC records, decisions and field evidence together in a secure, accountable workspace.',
    cards: [
      { eyebrow: 'Direct & Group Messages', title: 'Keep Conversations Moving', text: 'Review presence, replies, reactions, drafts and quick actions.' },
      { eyebrow: 'Record-Linked Collaboration', title: 'Keep Work in Context', text: 'See operational records and their discussion history together.' },
      { eyebrow: 'Rich Attachments', title: 'Share More Than Text', text: 'Preview documents, field evidence, audio updates and links.' },
    ],
  },
  notifications: {
    icon: 'Bell',
    title: 'Every Operational Signal in One Clear View',
    description: 'Present alerts, approvals, assignments and reminders with the context teams need to respond confidently.',
    cards: [
      { eyebrow: 'Actionable Alerts', title: 'See What Needs Attention', text: 'Separate informational updates from work that requires a decision.' },
      { eyebrow: 'Rich Context', title: 'Understand the Signal', text: 'Review actors, source records, files, severity and due dates.' },
      { eyebrow: 'Focused Views', title: 'Find Priorities Faster', text: 'Explore module, severity, status and time-based organization.' },
    ],
  },
  tickets: {
    icon: 'TicketCheck',
    title: 'Service Requests That Stay Accountable',
    description: 'Show how requests move from intake to ownership, collaboration and resolution without losing their operational history.',
    cards: [
      { eyebrow: 'Structured Intake', title: 'Capture the Right Context', text: 'Review requester, service area, severity, files and linked records.' },
      { eyebrow: 'Clear Ownership', title: 'Move Work Forward', text: 'See assignment, watchers, status, response targets and next steps.' },
      { eyebrow: 'Complete History', title: 'Keep the Audit Trail', text: 'Inspect replies, internal notes, activity and resolution outcomes.' },
    ],
  },
  calendar: {
    icon: 'CalendarDays',
    title: 'Every Operational Commitment in One Schedule',
    description: 'Review meetings, deadlines, assigned work and source-linked operational events in a single planning workspace.',
    cards: [
      { eyebrow: 'Unified Schedule', title: 'See Work in Time', text: 'Move between daily, weekly, monthly and agenda views without losing context.' },
      { eyebrow: 'Operational Context', title: 'Keep Records Connected', text: 'Review owners, source modules, visibility, priorities and linked records.' },
      { eyebrow: 'Team Coordination', title: 'Plan Together', text: 'Inspect attendees, responses, recurring schedules and upcoming deadlines.' },
    ],
  },
  meetings: {
    icon: 'Video',
    title: 'Turn Every Meeting Into Accountable Work',
    description: 'Bring the schedule, participants, governed evidence, reviewed outcomes and follow-up actions into one secure workspace.',
    cards: [
      { eyebrow: 'Before the Meeting', title: 'Prepare With Context', text: 'Review the agenda, invite responses, labels and authorised linked records.' },
      { eyebrow: 'During the Meeting', title: 'Keep Evidence Together', text: 'Connect attendance, recording consent, chapters and speaker-attributed transcripts.' },
      { eyebrow: 'After the Meeting', title: 'Turn Decisions Into Action', text: 'Publish reviewed outcomes and promote accepted actions to Calendar, Workflow or a destination module.' },
    ],
  },
};

export function DemoLandingPage({ page, stagedEnabled, onEnter }: {
  page: DemoPageId;
  stagedEnabled: boolean;
  onEnter: () => void;
}): VNode {
  const definition = DEFINITIONS[page];
  return <FeatureLandingPage
    icon={definition.icon}
    title={definition.title}
    description={definition.description}
    cardGroupLabel={`${page} capabilities`}
    cards={definition.cards.map(card => ({
      id: card.eyebrow,
      eyebrow: card.eyebrow,
      title: card.title,
      description: card.text,
    }))}
    action={{
      label: 'Explore Staged Workspace',
      disabled: !stagedEnabled,
      disabledLabel: 'Staged Workspace Disabled',
      onSelect: onEnter,
    }}
    assurance="Read-Only Staged Data"
  />;
}
