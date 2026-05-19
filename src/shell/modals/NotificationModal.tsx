/**
 * src/shell/modals/NotificationModal.tsx
 *
 * Notification bell panel — overlay anchored inside the main-content area.
 * IDs are preserved exactly as in assets/partials/app-shell.html so that
 * attSystem.ts event handlers wire up without any changes.
 *
 * Phase 1b: HTML parity with app-shell.html (static structure).
 * Phase 2c: Static structure remains — `#notifList` is populated by the
 *   `<NotificationList>` Preact component (mounted by `NotificationsPanel.ts`)
 *   using TanStack Query + Supabase Realtime.
 *
 * @see docs/SHELL_STRUCTURE.md §modals/NotificationModal
 * @see docs/ARCHITECTURE.md §10-Realtime
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2c
 */

export default function NotificationModal() {
  return (
    <div class="hdr-modal-overlay" id="hdrNotifModal">
      <div class="hdr-modal" style="width:360px;">
        <div class="hdr-modal-head">
          <span><i class="fas fa-bell" /> Notifications</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <button
              class="hdr-foot-link"
              id="notifClearAllBtn"
              style="color:var(--siomac-red);padding:3px 8px;font-size:0.75rem;"
            >
              <i class="fas fa-trash-alt" /> Clear All
            </button>
            <button class="hdr-modal-close" data-modal="hdrNotifModal">
              <i class="fas fa-times" />
            </button>
          </div>
        </div>
        <div class="hdr-modal-body" id="notifList" />
        <div class="hdr-modal-foot">
          <button class="hdr-foot-link" id="notifMarkAllBtn" style="color:var(--siomac-navy);">
            Mark All As Read
          </button>
          <button class="hdr-foot-link" id="notifRefreshBtn">
            <i class="fas fa-sync-alt" /> Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
