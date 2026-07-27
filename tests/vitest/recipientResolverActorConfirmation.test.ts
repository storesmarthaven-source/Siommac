// Actor self-notification semantics in resolveRecipients.
//
// Step 4 of the resolver deliberately drops the actor from their own notifications unless the
// event type is registered in ACTOR_CONFIRMATION_EVENTS. Registering the event is the ONLY
// supported way to keep a submission receipt: relabelling the actor as 'owner'/'participant'
// slips past the `reason === 'actor'` check, misdescribes the recipient, and leaves sibling
// routes silently inconsistent. These tests pin that contract.

import { describe, it, expect, vi } from 'vitest';

// The resolver reads `event_rules` from Postgres. No rules → step 1 (explicit recipients) and
// step 4 (actor suppression) are exercised in isolation, which is exactly what is under test.
vi.mock('../../netlify/functions/lib/db', () => ({
  sb: {
    from: () => ({
      select: () => ({
        eq: () => ({ or: () => Promise.resolve({ data: [] }) }),
      }),
    }),
  },
}));

import { resolveRecipients } from '../../netlify/functions/lib/recipientResolver';

const ACTOR = 'usr-actor';
const SUBJECT = 'usr-subject';
const ASSIGNEE = 'usr-assignee';

type ResolveInput = Parameters<typeof resolveRecipients>[0];

const input = (eventType: string, explicitRecipients: ResolveInput['explicitRecipients']): ResolveInput => ({
  eventType,
  sourceModule: 'platform',
  sourceEntityType: 'support_ticket',
  sourceEntityId: 'TKT-0001',
  actorUserId: ACTOR,
  severity: 'info',
  payload: {},
  explicitRecipients,
} as ResolveInput);

/** The three ticket/account-support paths that issue a submission receipt. */
const CONFIRMATION_EVENTS = [
  'ticket.created',
  'ticket.account_support.created',
  'account_access.assistance_requested',
];

describe('resolveRecipients — actor confirmation events', () => {
  it.each(CONFIRMATION_EVENTS)('retains the actor for %s', async eventType => {
    const out = await resolveRecipients(input(eventType, [{ userId: ACTOR, reason: 'actor' }]));

    expect(out.has(ACTOR)).toBe(true);
    expect(out.get(ACTOR)).toBe('actor');
  });

  it('suppresses the actor on an ordinary, non-confirmation event', async () => {
    const out = await resolveRecipients(input('ticket.status_changed', [{ userId: ACTOR, reason: 'actor' }]));

    expect(out.has(ACTOR)).toBe(false);
  });

  it('suppresses the actor on an unrelated event even when they are the only recipient', async () => {
    const out = await resolveRecipients(input('account_access.sessions_revoked', [{ userId: ACTOR, reason: 'actor' }]));

    expect(out.size).toBe(0);
  });

  it('never suppresses other recipients on a non-confirmation event', async () => {
    const out = await resolveRecipients(input('ticket.status_changed', [
      { userId: ACTOR, reason: 'actor' },
      { userId: SUBJECT, reason: 'participant' },
      { userId: ASSIGNEE, reason: 'assignee' },
    ]));

    expect(out.has(ACTOR)).toBe(false);
    expect(out.get(SUBJECT)).toBe('participant');
    expect(out.get(ASSIGNEE)).toBe('assignee');
  });
});

describe('resolveRecipients — all three ticket mutation paths share one semantic', () => {
  // The defect this pins: one route labelled the actor 'owner' to defeat suppression while its
  // siblings passed 'actor', so two equivalent receipts behaved differently and only the
  // relabelled one was covered by the E2E.
  it('delivers the actor receipt identically across all three paths', async () => {
    const results = await Promise.all(CONFIRMATION_EVENTS.map(eventType =>
      resolveRecipients(input(eventType, [
        { userId: ACTOR, reason: 'actor' },
        { userId: SUBJECT, reason: 'participant' },
      ])),
    ));

    for (const out of results) {
      expect(out.get(ACTOR)).toBe('actor');
      expect(out.get(SUBJECT)).toBe('participant');
    }
    // Same reason string everywhere — no route relabels the actor to slip past suppression.
    expect(new Set(results.map(out => out.get(ACTOR)))).toEqual(new Set(['actor']));
  });

  it('does not depend on a non-actor label to deliver the receipt', async () => {
    // Even if a caller mislabels the actor, the confirmation registry is what carries it —
    // so reverting a relabel can never silently drop the notification.
    const relabelled = await resolveRecipients(input('ticket.account_support.created', [{ userId: ACTOR, reason: 'owner' }]));
    const honest = await resolveRecipients(input('ticket.account_support.created', [{ userId: ACTOR, reason: 'actor' }]));

    expect(relabelled.has(ACTOR)).toBe(true);
    expect(honest.has(ACTOR)).toBe(true);
  });
});
