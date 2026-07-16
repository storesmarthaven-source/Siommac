// adapters/index.ts — wire the three SIOMAC adapters the Messenger UI depends on.
// The app layer (Phase 3) constructs these once and injects them via the port
// interfaces (MessagingRepository / AttachmentService / RealtimeGateway).
import { SiomacMessagingRepository } from './siomacRepository';
import { SiomacAttachmentService } from './siomacAttachments';
import { SiomacRealtimeGateway } from './siomacRealtime';
import type { AttachmentService, MessagingRepository, RealtimeGateway } from '../domain/ports';

export { SiomacMessagingRepository } from './siomacRepository';
export { SiomacAttachmentService } from './siomacAttachments';
export { SiomacRealtimeGateway } from './siomacRealtime';
export * from './mappers';

export interface SiomacMessagingAdapters {
  repository:  MessagingRepository & { loadThread(threadId: string): Promise<import('../domain/models').Message[]> };
  attachments: AttachmentService;
  realtime:    SiomacRealtimeGateway;
}

/** Construct the SIOMAC adapter set for a single signed-in Messenger session. */
export function createSiomacMessagingAdapters(): SiomacMessagingAdapters {
  return {
    repository:  new SiomacMessagingRepository(),
    attachments: new SiomacAttachmentService(),
    realtime:    new SiomacRealtimeGateway(),
  };
}
