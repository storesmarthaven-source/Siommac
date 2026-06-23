/**
 * src/shell/modals/MessageModal.tsx
 *
 * Messages header dropdown — overlay anchored inside the main-content area.
 * The #hdrMsgModal overlay (open/close driven by NavController via the `open`
 * class) is preserved; its contents are now the Preact <MessageDropdown>
 * mounted into #preact-msg-dropdown-root (main.tsx), on the canonical
 * communications engine.
 *
 * Mirrors NotificationModal.tsx exactly.
 */

export default function MessageModal() {
  return (
    <div class="hdr-modal-overlay" id="hdrMsgModal">
      <div class="hdr-modal" style="width:380px;padding:0;overflow:hidden;">
        <div id="preact-msg-dropdown-root" />
      </div>
    </div>
  );
}
