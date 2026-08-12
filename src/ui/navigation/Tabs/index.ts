/**
 * src/ui/navigation/Tabs — the one tab component.
 *
 * `TabPanel` is exported because it is half of the accessibility contract, not
 * implementation detail: every tab's `aria-controls` points at the panel it
 * renders. `tabDomId`/`panelDomId` are exported for tests and for the rare
 * surface that must reference a tab or panel element directly.
 */

export {
  Tabs, TabPanel, tabDomId, panelDomId,
  type TabsProps, type TabPanelProps, type TabItem,
  type TabsOrientation, type TabsVariant, type TabsSize, type TabsActivation,
} from './Tabs';
