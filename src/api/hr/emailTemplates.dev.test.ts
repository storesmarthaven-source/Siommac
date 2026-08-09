import { describe, expect, it } from 'vitest';
import { developmentEmailTemplateService } from './emailTemplates.dev';
import { createEmailBlock } from '../../lib/emailTemplateDocument';

describe('developmentEmailTemplateService', () => {
  it('builds each seeded template from its own registered trigger', async () => {
    const rows = await developmentEmailTemplateService.list({});
    const blockTypes = async (triggerKey: string) => {
      const summary = rows.find(row => row.triggerKey === triggerKey);
      expect(summary).toBeDefined();
      const detail = await developmentEmailTemplateService.get(summary!.id);
      return detail.editorSchema.blocks.flatMap(function visit(block): typeof detail.editorSchema.blocks {
        return [block, ...block.children.flatMap(visit)];
      }).map(block => block.type);
    };

    expect(await blockTypes('onboarding.case_created')).toContain('columns');
    expect(await blockTypes('onboarding.case_created')).toContain('profile_photo');
    expect(await blockTypes('onboarding.case_created')).toContain('button');
    expect(await blockTypes('onboarding.tasks_pending')).toContain('pending_tasks');
    expect(await blockTypes('onboarding.tasks_pending')).not.toContain('profile_photo');
    expect(await blockTypes('onboarding.documents_missing')).toContain('required_documents');
    expect(await blockTypes('onboarding.start_approaching')).toContain('equipment_ppe');
    expect(await blockTypes('onboarding.completed')).not.toContain('pending_tasks');
  });

  it('serves the authoritative trigger and configuration catalog', async () => {
    const catalog = await developmentEmailTemplateService.catalog();
    expect(catalog.triggers.some(trigger => trigger.key === 'onboarding.case_created')).toBe(true);
    expect(catalog.languages).toContain('English');
    expect(catalog.businessUnits).toContain('Company default');
    expect(catalog.owners).toContain('HR Operations');
  });

  it('keeps structured editor JSON as the canonical source and persists derived outputs', async () => {
    const created = await developmentEmailTemplateService.create({
      family: 'onboarding',
      startingPoint: 'blank',
      name: 'Studio Contract Test',
      description: 'Contract fixture',
      key: `studio-contract-${Date.now()}`,
      audience: 'Employee',
      triggerKey: 'onboarding.case_created',
      language: 'English',
      businessUnitLabel: 'Company default',
      ownerLabel: 'HR Operations',
      approvalRequired: true,
    });

    expect(created.editorSchema.schemaVersion).toBe(1);
    expect(created.editorSchema.blocks).toEqual([]);

    const paragraph = createEmailBlock('paragraph');
    paragraph.properties.html = 'Welcome.';

    const updated = await developmentEmailTemplateService.updateDraft({
      id: created.id,
      editorSchema: { ...created.editorSchema, blocks: [paragraph] },
      compiledHtml: '<!doctype html><html><body><p>Welcome.</p></body></html>',
      compiledText: 'Welcome.',
    });

    expect(updated.editorSchema.blocks[0]?.type).toBe('section');
    expect(updated.editorSchema.blocks[0]?.children[0]?.properties.html).toBe('Welcome.');
    expect(updated.compiledHtml).toContain('<p>Welcome.</p>');
    expect(updated.compiledText).toBe('Welcome.');
  });

  it('refuses to mutate a published version', async () => {
    const published = (await developmentEmailTemplateService.list({ statuses: ['published'] }))[0];
    expect(published).toBeDefined();
    await expect(developmentEmailTemplateService.updateDraft({ id: published!.id, subject: 'Changed' }))
      .rejects.toThrow('Published versions are immutable');
  });
});
