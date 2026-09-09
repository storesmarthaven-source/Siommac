import { type VNode } from 'preact';
import type { CalendarCollectionDTO } from '@api/calendar';
import { Button, Dialog, LucideIcon } from '@ui';
import { CalendarManagementPanel } from './CalendarManagementPanel';

export function CalendarManagementDialog({
  open,
  calendars,
  connectionsEnabled = true,
  onCreateCalendar,
  onClose,
}: {
  open: boolean;
  calendars: readonly CalendarCollectionDTO[];
  connectionsEnabled?: boolean;
  onCreateCalendar?: () => void;
  onClose: () => void;
}): VNode | null {
  return (
    <Dialog open={open} onClose={onClose} size="xl" variant="form" class="cal-manager-dialog">
      <Dialog.Header
        title="Manage Calendars"
        icon={<LucideIcon name="CalendarCog" size={20} />}
        onClose={onClose}
      />
      <Dialog.Body>
        <CalendarManagementPanel calendars={calendars} connectionsEnabled={connectionsEnabled} onCreateCalendar={onCreateCalendar} />
      </Dialog.Body>
      <Dialog.Footer><Button variant="primary" onClick={onClose}>Done</Button></Dialog.Footer>
    </Dialog>
  );
}
