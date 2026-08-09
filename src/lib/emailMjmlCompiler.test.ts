import { describe, expect, it } from 'vitest';
import { compileEmailDocument } from './emailMjmlCompiler';
import { createStarterEmailDocument } from './emailTemplateDocument';
import type { EmailTemplateFamily } from '../../types/emailTemplates';

// The contract's fixture gate: every starter template must compile through the
// pinned MJML renderer with zero validation errors, and the compiled artifact
// must be real client-ready HTML (Outlook conditionals included), because
// preview and send use the COMPILED output, never raw MJML.
const STARTERS: readonly (readonly [EmailTemplateFamily, string])[] = [
  ['onboarding', 'onboarding.case_created'],
  ['onboarding', 'onboarding.tasks_pending'],
  ['onboarding', 'onboarding.documents_missing'],
  ['onboarding', 'onboarding.start_approaching'],
  ['onboarding', 'onboarding.completed'],
  ['user_invitation', 'identity.invitation_created'],
  ['user_invitation', 'identity.invitation_reminder'],
  ['user_invitation', 'identity.invitation_expiring'],
  ['user_invitation', 'identity.invitation_reissued'],
  ['worker_invitation', 'worker.invitation_created'],
  ['worker_invitation', 'worker.site_assigned'],
  ['worker_invitation', 'worker.documents_required'],
  ['worker_invitation', 'worker.invitation_reminder'],
] as const;

describe('MJML email compiler (contract fixture)', () => {
  it('compiles every starter template with zero MJML errors', async () => {
    for (const [family, trigger] of STARTERS) {
      const document = createStarterEmailDocument(family, trigger);
      const compiled = await compileEmailDocument(document, trigger);
      expect(compiled.errors, `${trigger}: ${compiled.errors.join(' | ')}`).toEqual([]);
      expect(compiled.html).toContain('<!doctype html>');
      expect(compiled.html).toContain('<!--[if mso');
      expect(compiled.mjml.startsWith('<mjml>')).toBe(true);
      expect(compiled.text.length).toBeGreaterThan(40);
    }
  }, 60000);

  it('keeps the welcome content and brand through compilation', async () => {
    const document = createStarterEmailDocument('onboarding', 'onboarding.case_created');
    const compiled = await compileEmailDocument(document, 'Employee Welcome');
    expect(compiled.html).toContain('Welcome aboard');
    expect(compiled.html).toContain('{{recipient.firstName}}');
    expect(compiled.html).toContain('#1F2D51');
    expect(compiled.html).toContain('Open Onboarding Workspace');
    // smart fact grid travels via mj-raw untouched
    expect(compiled.html).toContain('Start date');
  });
});
