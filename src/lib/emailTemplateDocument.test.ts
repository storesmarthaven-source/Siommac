import { describe, expect, it } from 'vitest';
import {
  applyDocumentTypography,
  createBlankEmailDocument,
  EMAIL_FONT_STACK,
  createCallToActionSection,
  createEmailBlock,
  createEmailSection,
  createStarterEmailDocument,
  applyPageGutter,
  normalizeEmailDocument,
  renderEmailMjml,
  renderEmailPreview,
  sanitizeRichText,
} from './emailTemplateDocument';

describe('emailTemplateDocument', () => {
  it('creates a genuinely blank source document', () => {
    const document = createBlankEmailDocument();
    expect(document.blocks).toEqual([]);
    // One typeface by design — there is no font setting to carry.
    expect(EMAIL_FONT_STACK).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it('builds CTA cards from independently editable primitive layers', () => {
    const card = createCallToActionSection('Next step', 'Review your plan.', 'Open plan', '/plan');
    expect(card.type).toBe('section');
    expect(card.styles.borderWidth).toBe(1);
    expect(card.children.map(block => block.type)).toEqual(['heading', 'paragraph', 'button']);
    expect(card.children[2]?.properties.href).toBe('/plan');
  });

  it('creates editable starter content rather than compiled HTML state', () => {
    const document = createStarterEmailDocument('onboarding');
    expect(document.schemaVersion).toBe(1);
    expect(document.blocks.every(block => block.type === 'section')).toBe(true);
    expect(document.settings.width).toBe(680);
    const allBlocks = document.blocks.flatMap(function visit(block): typeof document.blocks {
      return [block, ...block.children.flatMap(visit)];
    });
    const blockTypes = allBlocks.map(block => block.type);
    expect(blockTypes).not.toContain('employee_welcome_hero');
    expect(blockTypes).not.toContain('first_day_overview');
    expect(blockTypes).toContain('columns');
    expect(blockTypes).toContain('heading');
    expect(blockTypes).toContain('paragraph');
    expect(blockTypes).toContain('profile_photo');
    expect(blockTypes).toContain('button');
    expect(blockTypes).toContain('icon_list');
    expect(blockTypes).toContain('smart_fact_grid');
    // The baked welcome design uses the transactional legal_footer block by choice.
    expect(blockTypes).toContain('legal_footer');
    expect(blockTypes).not.toContain('support_contact');

    const onboardingButton = allBlocks.find(block => block.name === 'Onboarding hub button');
    const employeePhoto = allBlocks.find(block => block.name === 'Employee profile photo');
    const factGrid = allBlocks.find(block => block.type === 'smart_fact_grid');
    expect(onboardingButton?.type).toBe('button');
    expect(employeePhoto?.type).toBe('profile_photo');
    expect(factGrid?.properties.factTiles).toHaveLength(4);
    expect(allBlocks.find(block => block.name === 'Legal Footer')?.type).toBe('legal_footer');
    expect(allBlocks.every(block => block.id.length > 0)).toBe(true);

    const rendered = renderEmailPreview(document, 'Employee Welcome');
    expect(rendered.html).toContain('Your First-Day Overview');
    expect(rendered.html).toContain('{{employee.number}}');
    expect(rendered.html).toContain('{{onboarding.hubUrl}}');
    expect(rendered.html).toContain('{{support.email}}');
    expect(rendered.html).toContain('#f7b900');
    expect(rendered.html).toContain('People Operations team');
    expect(rendered.html).toContain('width="70.00%"');
    expect(rendered.html).toContain('src="{{recipient.profilePhotoUrl}}"');
    expect(rendered.html).toContain('@media only screen and (max-width:620px)');
  });

  it('renders configurable Lucide icon lists from structured items', () => {
    const document = createBlankEmailDocument();
    const list = createEmailBlock('icon_list');
    list.properties.iconItems = [{ icon: 'Mail', text: 'people@example.com' }];
    list.properties.iconShape = 'circle';
    list.properties.iconTreatment = 'solid';
    list.properties.iconBackground = '#fff2ce';
    document.blocks = [createEmailSection([list])];

    const rendered = renderEmailPreview(document, 'Configurable blocks');
    expect(rendered.html).toContain('people@example.com');
    expect(rendered.html).toContain('<svg');
    expect(rendered.html).toContain('border-radius:50%');
    expect(rendered.html).toContain('background:#fff2ce');
    expect(rendered.html).toContain('a{color:#0b57d0;text-decoration:underline}');

    list.properties.iconTreatment = 'plain';
    const plain = renderEmailPreview(document, 'Plain icons');
    expect(plain.html).toContain('border:none;border-radius:0;background:transparent');
  });

  it('normalizes loose root content into section-owned content', () => {
    const document = createBlankEmailDocument();
    const paragraph = createEmailBlock('paragraph');
    document.blocks = [paragraph, createEmailSection([createEmailBlock('heading')])];

    const normalized = normalizeEmailDocument(document);
    expect(normalized.blocks.every(block => block.type === 'section')).toBe(true);
    expect(normalized.blocks[0]?.children[0]?.id).toBe(paragraph.id);
  });

  it('removes executable and unsupported markup from rich text', () => {
    expect(sanitizeRichText('<strong class="x">Safe</strong><script>alert(1)</script><a href="x">Link</a>'))
      .toBe('<strong>Safe</strong>Link');
  });

  it('renders nested column content, image content and block dimensions', () => {
    const document = createBlankEmailDocument();
    const columns = createEmailBlock('columns');
    columns.properties.widthPercent = 80;
    columns.properties.minHeight = 140;
    columns.properties.columnWidths = [35, 65];

    const left = createEmailBlock('section');
    left.properties.verticalAlign = 'middle';
    left.properties.minHeight = 180;
    const heading = createEmailBlock('heading');
    heading.properties.html = 'Employee welcome';
    left.children = [heading];

    const right = createEmailBlock('section');
    const image = createEmailBlock('image');
    image.properties.src = 'https://assets.example.test/welcome.png';
    image.properties.alt = 'Welcome illustration';
    right.children = [image];
    columns.children = [left, right];
    document.blocks = [columns];

    const output = renderEmailPreview(document, 'Welcome');
    expect(output.html).toContain('width="80%"');
    expect(output.html).toContain('min-height:140px');
    expect(output.html).toContain('width="35.00%"');
    expect(output.html).toContain('width="65.00%"');
    expect(output.html).toContain('valign="middle"');
    expect(output.html).toContain('height="180"');
    expect(output.html).toContain('Welcome illustration');
    expect(output.text).toContain('Employee welcome');
  });

  it('renders the document typography scale into the email stylesheet', () => {
    const document = createBlankEmailDocument();
    document.settings.linkColor = '#cc0000';
    document.settings.linkUnderline = false;
    document.settings.typography.h1 = { fontSize: 44, color: '#123456' };
    document.settings.typography.body = { fontSize: 18, color: '#333333' };
    document.settings.typography.headingLineHeight = 1.1;

    const { html } = renderEmailPreview(document, 'Scale');

    expect(html).toContain('a{color:#cc0000;text-decoration:none}');
    expect(html).toContain('font-size:44px;color:#123456;line-height:1.1');
    // The body scale seeds NEW blocks; it must not override existing ones.
    expect(html).toContain('p{margin:0;font-size:inherit;color:inherit;line-height:inherit}');
    // `<style>` is RAWTEXT — entities would break the declaration. (The
    // <table> style ATTRIBUTE is separate and is correctly escaped.)
    const styleBlock = html.match(/<style>[\s\S]*?<\/style>/)![0];
    expect(styleBlock).not.toContain('&quot;');
    expect(styleBlock).toContain('font-family:"Helvetica Neue"');
  });

  it('fills the typography scale in for documents saved before it existed', () => {
    const legacy = normalizeEmailDocument({
      schemaVersion: 1,
      settings: { width: 600 },
      blocks: [],
    } as never);

    expect(legacy.settings.typography.h2.fontSize).toBe(22);
    expect(legacy.settings.linkUnderline).toBe(true);
    expect(legacy.settings.width).toBe(600);
  });

  it('applies the document scale to newly created headings and paragraphs', () => {
    const document = createBlankEmailDocument();
    document.settings.typography.h2 = { fontSize: 27, color: '#0a0a0a' };
    document.settings.typography.body = { fontSize: 19, color: '#444444' };

    const heading = applyDocumentTypography(createEmailBlock('heading'), document.settings);
    const paragraph = applyDocumentTypography(createEmailBlock('paragraph'), document.settings);
    const button = applyDocumentTypography(createEmailBlock('button'), document.settings);

    expect(heading.styles.fontSize).toBe(27);
    expect(heading.styles.color).toBe('#0a0a0a');
    expect(paragraph.styles.fontSize).toBe(19);
    expect(paragraph.styles.color).toBe('#444444');
    // Buttons carry their own contrast-critical styling.
    expect(button.styles.color).toBe('#ffffff');
  });

  it('keeps un-formatting spans so demo/preview match the canvas', () => {
    // Browsers express "not bold inside a bold block" as a styled span; the
    // sanitizer must keep the formatting override and drop everything else.
    expect(sanitizeRichText('<span style="font-weight: normal;">Plain</span>'))
      .toBe('<span style="font-weight:400">Plain</span>');
    expect(sanitizeRichText('<span style="font-weight: 600">Heavy</span>'))
      .toBe('<span style="font-weight:700">Heavy</span>');
    expect(sanitizeRichText('<span onclick="x()" data-a="b" style="color:red">Safe</span>'))
      .toBe('<span>Safe</span>');
    expect(sanitizeRichText('<span style="text-decoration-line: underline">U</span>'))
      .toBe('<span style="text-decoration:underline">U</span>');
  });

  it('wraps spacers in a weightless section so 24px of space is 24px', () => {
    const spacer = createEmailBlock('spacer');
    const section = createEmailSection([spacer]);
    expect(section.styles.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(section.styles.backgroundColor).toBe('transparent');
    expect(section.properties.minHeight).toBe(0);

    // Ordinary content keeps the normal section chrome.
    const text = createEmailSection([createEmailBlock('paragraph')]);
    expect(text.styles.backgroundColor).toBe('#ffffff');
  });

  describe('page padding — one authority for the horizontal gutter', () => {
    it('lifts drifted per-section gutters onto the document', () => {
      // The starters authored 0/8/34/36/48 within a single template, which is why changing one
      // section moved nothing predictably.
      const doc = createStarterEmailDocument('onboarding');
      expect(doc.settings.pagePadding).toBeGreaterThan(0);
      for (const section of doc.blocks) {
        expect(section.styles.padding.left).toBe(0);
        expect(section.styles.padding.right).toBe(0);
      }
    });

    it('keeps a zero-gutter band full-bleed instead of re-insetting it', () => {
      // A coloured header/footer band is MEANT to touch both edges. Migrating it to the new
      // document gutter would inset it and break the design.
      const doc = createStarterEmailDocument('onboarding');
      const bleed = doc.blocks.filter(s => s.properties.fullBleed);
      expect(bleed.length).toBe(2);
      const rendered = applyPageGutter(doc);
      for (const section of rendered.blocks) {
        const expected = section.properties.fullBleed ? 0 : doc.settings.pagePadding;
        expect(section.styles.padding.left).toBe(expected);
        expect(section.styles.padding.right).toBe(expected);
      }
    });

    it('derives the gutter from the MEDIAN, so an outlier band cannot set it', () => {
      const base = createStarterEmailDocument('onboarding');
      const legacy = JSON.parse(JSON.stringify(base));
      delete legacy.settings.pagePadding;
      // Four content sections at 30, plus one 96px outlier. The mean would be 43; the median is 30.
      legacy.blocks.forEach((s: { styles: { padding: Record<string, number> } }, i: number) => {
        const value = i === 0 ? 96 : 30;
        s.styles.padding.left = value;
        s.styles.padding.right = value;
      });
      expect(normalizeEmailDocument(legacy).settings.pagePadding).toBe(30);
    });

    it('is applied at render time, never written back into the sections', () => {
      // Two copies of the gutter could disagree — the exact problem this replaced.
      const doc = createStarterEmailDocument('onboarding');
      const before = JSON.stringify(doc);
      renderEmailMjml(doc, 'Welcome');
      renderEmailPreview(doc, 'Welcome');
      expect(JSON.stringify(doc)).toBe(before);
    });

    it('changing the setting moves the rendered gutter', () => {
      const doc = createStarterEmailDocument('onboarding');
      const wide = renderEmailMjml({ ...doc, settings: { ...doc.settings, pagePadding: 60 } }, 'W');
      const tight = renderEmailMjml({ ...doc, settings: { ...doc.settings, pagePadding: 4 } }, 'W');
      expect(wide).toContain('60px');
      expect(wide).not.toBe(tight);
    });
  });

  /**
   * ⭐⭐ A stacked column MUST release its canvas height, or it overlaps the next one.
   *
   * The columns carry `height="<minHeight>"` from the canvas, where it means a MINIMUM — a `<td>`
   * grows past it to fit content. The responsive rule forces `display:block`, and a BLOCK BOX
   * treats the same value as a FIXED height: content that reflows taller at phone width overflows
   * instead of growing, and the following column is laid out on top of it.
   *
   * Measured in Chrome at 375px before the fix: the left column was clamped to 224px while its
   * content needed 256px, so the avatar started 32px above the button's bottom edge and covered it.
   * `height:auto` restores growth while `min-height` keeps doing its real job.
   */
  it('⭐ releases fixed heights when columns stack, so they cannot overlap', () => {
    const mjml = renderEmailMjml(createStarterEmailDocument('onboarding'), 'Welcome');
    const media = mjml.match(/@media only screen and \(max-width:620px\)\{([^]*?)\}\s*<\/mj-style>/);
    expect(media).not.toBeNull();
    const rules = media?.[1] ?? '';

    const stackCol = rules.match(/\.stack-col\{([^}]*)\}/)?.[1] ?? '';
    expect(stackCol).toContain('display:block!important');
    expect(stackCol).toContain('height:auto!important');

    // Same box-model change, same hazard.
    const stackTile = rules.match(/\.stack-tile\{([^}]*)\}/)?.[1] ?? '';
    expect(stackTile).toContain('display:inline-block!important');
    expect(stackTile).toContain('height:auto!important');

    // The canvas height must still be EMITTED — the fix relaxes it responsively, it does not
    // delete the author's minimum.
    expect(mjml).toMatch(/class="stack-col"[^>]*min-height:\d+px/);
  });
});
