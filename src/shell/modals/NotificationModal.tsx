/**
 * src/shell/modals/NotificationModal.tsx
 *
 * Notification bell dropdown — overlay anchored inside the main-content area.
 * The `#hdrNotifModal` overlay (open/close driven by NavController via the
 * `open` class) is preserved; its contents are now the Preact
 * <NotificationDropdown> mounted into #preact-notif-dropdown-root (main.tsx),
 * on the canonical communications engine.
 */

export default function NotificationModal() {
  return (
    <div class="hdr-modal-overlay" id="hdrNotifModal">
      <div class="hdr-modal" style="width:380px;padding:0;overflow:hidden;">
        <div id="preact-notif-dropdown-root" />
      </div>
    </div>
  );
}
