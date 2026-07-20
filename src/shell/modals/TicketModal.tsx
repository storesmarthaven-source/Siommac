/**
 * Canonical ticket dropdown mounted by main.tsx. The shared overlay remains
 * controlled by NavController, matching Messages and Notifications.
 */
export default function TicketModal() {
  return (
    <div class="hdr-modal-overlay" id="hdrTicketModal">
      <div class="hdr-modal" style="width:390px;padding:0;overflow:hidden;">
        <div id="preact-ticket-dropdown-root" />
      </div>
    </div>
  );
}
