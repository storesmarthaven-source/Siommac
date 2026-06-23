/**
 * src/components/sections/Messages/index.ts
 *
 * Public surface for the canonical Messages section.
 * The legacy MessagePanel is kept for now (retirement is a later phase).
 */

export { MessageCenter }  from './MessageCenter';
export { MessageDropdown } from './MessageDropdown';
export { mountMessageCenterSection, unmountMessageCenterSection, mountMessageDropdown } from './mount';

// Legacy — kept until explicit retirement phase
export { MessagePanel } from './MessagePanel';
