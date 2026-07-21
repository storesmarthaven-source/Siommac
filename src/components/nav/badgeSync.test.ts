/**
 * src/components/nav/badgeSync.test.ts
 *
 * syncApprovalNavBadge — the Approvals sidebar badge shows the NEW-since-last-opened
 * actionable count (unseenActionableCount), NOT the full pending backlog. Clearing
 * the badge (after the queue is opened + the watermark stamped) must never remove
 * the Approvals nav item itself — the page stays visible (it is gated on the durable
 * communications.compliance_approve capability, not on the badge). Only approvers
 * (who have the nav item) ever issue the request. Reuses the .sb-nav-badge renderer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@lib/superadminApi', () => ({ getApprovalCountsApi: vi.fn() }));
vi.mock('@lib/api', () => ({
  apiPost:                    vi.fn(),
  apiPatch:                   vi.fn(),
  apiGet:                     vi.fn(),
  apiDelete:                  vi.fn(),
  authPost:                   vi.fn(),
  apiFetch:                   vi.fn(),
  registerAuthExpiredHandler: vi.fn(),
}));

import { getApprovalCountsApi } from '@lib/superadminApi';
import { apiPost } from '@lib/api';
import { syncApprovalNavBadge, syncHeaderBadges, getLastGoodBadgeCounts, __resetBadgeSyncState } from './badgeSync';

const mockApiPost = vi.mocked(apiPost);

const mockCounts = vi.mocked(getApprovalCountsApi);

/** Build a #sidebarMenu with (optionally) the Approvals button. */
function buildSidebar(withApprovals: boolean): void {
  document.body.innerHTML =
    `<ul id="sidebarMenu">${withApprovals ? '<li><button data-section="s-ac-approvals">Approvals</button></li>' : ''}</ul>`;
}
const badge  = () => document.querySelector('#sidebarMenu button[data-section="s-ac-approvals"] .sb-nav-badge');
const button = () => document.querySelector('#sidebarMenu button[data-section="s-ac-approvals"]');

// ── syncHeaderBadges tests ────────────────────────────────────────────────────

const summary = (overrides = {}) => ({
  notificationsUnread: 3,
  messagesUnread: 2,
  ticketsUnread: 1,
  notificationsTotal: 5,
  notificationsActionRequired: 1,
  notificationsCritical: 0,
  notificationsArchived: 0,
  ticketsOpen: 4,
  workflowTasks: 0,
  handoffFailures: 0,
  realtimeChannelKey: null,
  realtimeToken: null,
  realtimeTokenExpiresAt: null,
  ...overrides,
});

function buildBadgeDom(): void {
  document.body.innerHTML = `
    <span data-pill-badge="notif"></span>
    <span data-pill-badge="msg"></span>
    <span data-pill-badge="ticket"></span>
  `;
}

describe('syncHeaderBadges', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
    __resetBadgeSyncState();
    buildBadgeDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('updates all three badges on success', async () => {
    mockApiPost.mockResolvedValue({ success: true, data: summary() } as never);
    await syncHeaderBadges();
    expect(getLastGoodBadgeCounts()).toEqual({
      notificationsUnread: 3,
      messagesUnread: 2,
      ticketsUnread: 1,
    });
  });

  it('does not clear badges when the summary request fails (preserves last known counts)', async () => {
    // First a good response to seed the last known counts.
    mockApiPost.mockResolvedValueOnce({ success: true, data: summary({ notificationsUnread: 5 }) } as never);
    await syncHeaderBadges();
    expect(getLastGoodBadgeCounts()?.notificationsUnread).toBe(5);

    // Then a failure.
    mockApiPost.mockResolvedValueOnce({ success: false });
    await syncHeaderBadges();
    // Last good counts MUST be unchanged.
    expect(getLastGoodBadgeCounts()?.notificationsUnread).toBe(5);
  });

  it('getLastGoodBadgeCounts is null before the first success', () => {
    expect(getLastGoodBadgeCounts()).toBeNull();
  });
});

// ── syncApprovalNavBadge tests ────────────────────────────────────────────────

describe('syncApprovalNavBadge — unseen-driven badge', () => {
  beforeEach(() => { mockCounts.mockReset(); });

  it('badges unseenActionableCount, NOT the full pending backlog', async () => {
    buildSidebar(true);
    mockCounts.mockResolvedValue({ success: true, pendingActionableCount: 5, unseenActionableCount: 2 });
    await syncApprovalNavBadge();
    expect(mockCounts).toHaveBeenCalled();
    expect(badge()?.textContent).toBe('2');   // unseen (2), not pending (5)
  });

  it('acknowledging the queue (unseen → 0) clears the badge but KEEPS the Approvals nav item', async () => {
    buildSidebar(true);
    mockCounts.mockResolvedValueOnce({ success: true, pendingActionableCount: 4, unseenActionableCount: 4 });
    await syncApprovalNavBadge();
    expect(badge()?.textContent).toBe('4');
    // Opening the queue stamped the watermark → unseen 0, pending backlog unchanged.
    mockCounts.mockResolvedValueOnce({ success: true, pendingActionableCount: 4, unseenActionableCount: 0 });
    await syncApprovalNavBadge();
    expect(badge()).toBeNull();          // badge cleared …
    expect(button()).not.toBeNull();     // … but the Approvals page stays visible
  });

  it('refreshes the badge when the unseen count changes (a new request arrives)', async () => {
    buildSidebar(true);
    mockCounts.mockResolvedValueOnce({ success: true, pendingActionableCount: 6, unseenActionableCount: 6 });
    await syncApprovalNavBadge();
    expect(badge()?.textContent).toBe('6');
    mockCounts.mockResolvedValueOnce({ success: true, pendingActionableCount: 7, unseenActionableCount: 3 });
    await syncApprovalNavBadge();
    expect(badge()?.textContent).toBe('3');
    expect(button()).not.toBeNull();
  });

  it('does not fetch when the actor has no Approvals nav item (non-approver)', async () => {
    buildSidebar(false);
    await syncApprovalNavBadge();
    expect(mockCounts).not.toHaveBeenCalled();
  });
});
