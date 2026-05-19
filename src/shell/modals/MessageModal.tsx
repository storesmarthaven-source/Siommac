/**
 * src/shell/modals/MessageModal.tsx
 *
 * Messages panel — overlay with three sub-panes:
 *   • #msgList        — conversation list (default)
 *   • #msgDetailPane  — thread view + reply box
 *   • #msgComposePane — new message compose
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html so that
 * attSystem.ts event handlers wire up without any changes.
 *
 * Phase 1b: HTML parity with app-shell.html (static structure).
 * Phase 2d: Full replacement with InboxPanel + ConversationView + ComposeModal.
 *
 * @see docs/SHELL_STRUCTURE.md §modals/MessageModal
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

export default function MessageModal() {
  return (
    <div class="hdr-modal-overlay" id="hdrMsgModal">
      <div class="hdr-modal" style="width:400px;max-height:560px;">
        <div class="hdr-modal-head">
          <span>
            <i class="fas fa-comment-dots" /> <span id="msgModalTitle">Messages</span>
          </span>
          <div style="display:flex;gap:6px;align-items:center;">
            <button
              class="hdr-foot-link hdr-compose-btn"
              id="msgComposeBtn"
              title="New Message"
              style="padding:4px 10px;font-size:0.78rem;"
            >
              <i class="fas fa-plus" /> <span id="msgComposeBtnLabel">New Message</span>
            </button>
            <button class="hdr-modal-close" data-modal="hdrMsgModal">
              <i class="fas fa-times" />
            </button>
          </div>
        </div>

        {/* List view */}
        <div class="hdr-modal-body" id="msgList" style="display:block;" />

        {/* Conversation detail + reply */}
        <div id="msgDetailPane" style="display:none;flex-direction:column;height:100%;">
          <div class="hdr-modal-body" id="msgDetailBody" style="flex:1;" />
          <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
            <textarea
              id="msgReplyInput"
              rows={3}
              placeholder="Write your reply…"
              style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.82rem;font-family:inherit;resize:none;outline:none;"
            />
            <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;">
              <button class="hdr-foot-link" id="msgDetailBackBtn" style="color:var(--siomac-navy);">
                <i class="fas fa-arrow-left" /> Back
              </button>
              <button
                class="hdr-foot-link"
                id="msgReplySendBtn"
                style="color:var(--siomac-blue);opacity:0.4;"
                disabled
              >
                <i class="fas fa-paper-plane" /> Send Reply
              </button>
            </div>
          </div>
        </div>

        {/* Compose new message */}
        <div id="msgComposePane" style="display:none;padding:14px 16px;flex-direction:column;gap:10px;">
          <div id="msgToWrap">
            <select
              id="msgToSelect"
              style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.83rem;font-family:inherit;outline:none;"
            >
              <option value="">— Select recipient —</option>
            </select>
          </div>
          <input
            id="msgComposeSubject"
            type="text"
            placeholder="Subject"
            maxLength={120}
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.83rem;font-family:inherit;outline:none;"
          />
          <textarea
            id="msgComposeBody"
            rows={4}
            placeholder="Write your message…"
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.82rem;font-family:inherit;resize:none;outline:none;"
          />
          <div style="display:flex;gap:8px;justify-content:space-between;">
            <button class="hdr-foot-link" id="msgCancelComposeBtn">
              <i class="fas fa-times" /> Cancel
            </button>
            <button
              class="hdr-foot-link"
              id="msgSendBtn"
              style="color:var(--siomac-blue);opacity:0.4;"
              disabled
            >
              <i class="fas fa-paper-plane" /> Send
            </button>
          </div>
        </div>

        <div class="hdr-modal-foot" id="msgModalFoot">
          <button class="hdr-foot-link" id="msgMarkAllReadBtn" style="color:var(--siomac-navy);">
            Mark All As Read
          </button>
          <button class="hdr-foot-link" id="msgRefreshBtn">
            <i class="fas fa-sync-alt" /> Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
