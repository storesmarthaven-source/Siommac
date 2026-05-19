/**
 * src/shell/modals/TicketModal.tsx
 *
 * Support tickets panel — overlay with three sub-panes:
 *   • #ticketList        — ticket list (default)
 *   • #ticketDetailPane  — ticket thread + reply + status controls
 *   • #ticketComposePane — new ticket form
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html so that
 * attSystem.ts event handlers wire up without any changes.
 *
 * Phase 1b: HTML parity with app-shell.html (static structure).
 * Phase 2e: Full replacement with TicketQueue + TicketDetail backed by Supabase.
 *
 * @see docs/SHELL_STRUCTURE.md §modals/TicketModal
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

export default function TicketModal() {
  return (
    <div class="hdr-modal-overlay" id="hdrTicketModal">
      <div class="hdr-modal" style="width:420px;max-height:580px;">
        <div class="hdr-modal-head">
          <span>
            <i class="fas fa-ticket-alt" /> <span id="ticketModalTitle">Support Tickets</span>
          </span>
          <div style="display:flex;gap:6px;align-items:center;">
            <button
              class="hdr-foot-link"
              id="ticketClearClosedBtn"
              style="padding:4px 10px;font-size:0.78rem;color:var(--text-muted);"
            >
              <i class="fas fa-broom" /> Clear Closed
            </button>
            <button
              class="hdr-foot-link hdr-compose-btn"
              id="ticketNewBtn"
              title="New Ticket"
              style="padding:4px 10px;font-size:0.78rem;"
            >
              <i class="fas fa-plus" /> New Ticket
            </button>
            <button class="hdr-modal-close" data-modal="hdrTicketModal">
              <i class="fas fa-times" />
            </button>
          </div>
        </div>

        {/* Ticket list */}
        <div class="hdr-modal-body" id="ticketList" />

        {/* Ticket detail + reply */}
        <div id="ticketDetailPane" style="display:none;flex-direction:column;">
          <div class="hdr-modal-body" id="ticketDetailBody" style="flex:1;" />
          <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
            <textarea
              id="ticketReplyInput"
              rows={3}
              placeholder="Write a reply…"
              style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.82rem;font-family:inherit;resize:none;outline:none;"
            />
            <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
              <button
                class="hdr-foot-link"
                id="ticketDetailBackBtn"
                style="color:var(--siomac-navy);"
              >
                <i class="fas fa-arrow-left" /> Back
              </button>
              <div style="display:flex;gap:8px;align-items:center;">
                <select
                  id="ticketStatusSelect"
                  style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:0.78rem;font-family:inherit;outline:none;display:none;"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <button
                  class="hdr-foot-link"
                  id="ticketStatusSaveBtn"
                  style="display:none;"
                >
                  <i class="fas fa-save" /> Update Status
                </button>
                <button
                  class="hdr-foot-link"
                  id="ticketReplySendBtn"
                  style="color:var(--siomac-blue);opacity:0.4;"
                  disabled
                >
                  <i class="fas fa-paper-plane" /> Send Reply
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* New ticket compose */}
        <div id="ticketComposePane" style="display:none;padding:14px 16px;flex-direction:column;gap:10px;">
          <select
            id="ticketCategory"
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.83rem;font-family:inherit;outline:none;"
          >
            <option value="general">General</option>
            <option value="attendance">Attendance Issue</option>
            <option value="leave">Leave Problem</option>
            <option value="payroll">Payroll / Hours</option>
            <option value="technical">Technical Problem</option>
            <option value="other">Other</option>
          </select>
          <input
            id="ticketSubject"
            type="text"
            placeholder="Subject"
            maxLength={120}
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.83rem;font-family:inherit;outline:none;"
          />
          <textarea
            id="ticketBody"
            rows={5}
            placeholder="Describe your issue…"
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.82rem;font-family:inherit;resize:none;outline:none;"
          />
          <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;">
            <button class="hdr-foot-link" id="ticketCancelBtn" style="color:var(--siomac-navy);">
              <i class="fas fa-times" /> Cancel
            </button>
            <button class="hdr-foot-link" id="ticketSubmitBtn" style="color:var(--siomac-blue);">
              <i class="fas fa-paper-plane" /> Submit Ticket
            </button>
          </div>
        </div>

        <div class="hdr-modal-foot" id="ticketModalFoot">
          <button
            class="hdr-foot-link"
            id="ticketClearClosedEmpBtn"
            style="color:var(--text-muted);display:none;"
          >
            <i class="fas fa-broom" /> Clear Closed
          </button>
          <span id="ticketOpenCount" style="font-size:0.78rem;color:var(--siomac-navy);font-weight:600;margin-right:auto;" />
          <button class="hdr-foot-link" id="ticketRefreshBtn">
            <i class="fas fa-sync-alt" /> Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
