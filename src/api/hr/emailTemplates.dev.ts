import { EMAIL_TEMPLATE_SEEDS } from '../../lib/emailTemplateSeeds';
import type {
  CreateEmailTemplateArgs,
  CreateSavedSectionArgs,
  EmailChromeDocument,
  EmailChromeSyncResult,
  EmailSavedSection,
  EmailEditorSchema,
  EmailTemplateCatalog,
  EmailTemplateDraft,
  EmailTemplateListArgs,
  EmailTemplateSummary,
  UpdateEmailChromeArgs,
  UpdateEmailTemplateDraftArgs,
} from '../../../types/emailTemplates';
import {
  applyEmailChrome,
  createBlankEmailDocument,
  createDefaultEmailChrome,
  createStarterEmailDocument,
  documentMatchesChrome,
  normalizeEmailDocument,
  renderEmailPreview,
} from '../../lib/emailTemplateDocument';

const defaultSchema = (): EmailEditorSchema => createBlankEmailDocument();

/**
 * The nine-part tuple per starter: key, name, family, trigger key, trigger
 * label, audience, purpose, subject, preheader. Labels and purposes are the
 * approved card copy; subject and preheader are the RECIPIENT-facing lines, so
 * they must not echo the internal name or trigger.
 */
const seedDefinitions = EMAIL_TEMPLATE_SEEDS;

const seedRows: EmailTemplateDraft[] = seedDefinitions.map(([key, name, family, triggerKey, triggerLabel, audience, purpose, subject, preheader], index) => {
  const editorSchema = createStarterEmailDocument(family, triggerKey);
  const compiled = renderEmailPreview(editorSchema, name);
  return ({
  id: `development-template-${index + 1}`,
  key,
  name,
  description: purpose,
  family,
  triggerKey,
  triggerLabel,
  audience,
  language: 'English',
  businessUnitLabel: 'Company default',
  ownerLabel: index % 3 === 0 ? 'HR Operations' : 'People Operations',
  status: index < 3 ? 'published' : index === 3 ? 'in_review' : 'draft',
  approvalState: index < 3 ? 'approved' : index === 3 ? 'pending' : 'not_submitted',
  currentVersion: index < 3 ? 2 : 1,
  activeUsageCount: index < 3 ? index + 1 : 0,
  protected: index === 0 || index === 5 || index === 9,
  updatedAt: new Date(Date.UTC(2026, 6, 28 - index)).toISOString(),
  subject,
  preheader,
  editorSchema,
  compiledHtml: compiled.html,
  compiledText: compiled.text,
  });
});

let rows = seedRows;

const developmentLatency = (): Promise<void> => new Promise(resolve => globalThis.setTimeout(resolve, 80));

// Saved sections persist in localStorage so they survive a reload, which an
// in-memory array would not. The production service uses real endpoints.
const SAVED_SECTIONS_KEY = 'siomac_email_saved_sections_v1';
const CHROME_KEY = 'siomac_email_chrome_v1';

function readChrome(): EmailChromeDocument {
  try {
    const raw = globalThis.localStorage?.getItem(CHROME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EmailChromeDocument;
      if (Array.isArray(parsed?.header) && Array.isArray(parsed?.footer)) return parsed;
    }
  } catch {
    // fall through to the shipped default
  }
  const defaults = createDefaultEmailChrome();
  return { ...defaults, updatedAt: new Date().toISOString(), updatedBy: 'SIOMAC default' };
}

function writeChrome(chrome: EmailChromeDocument): void {
  try {
    globalThis.localStorage?.setItem(CHROME_KEY, JSON.stringify(chrome));
  } catch {
    // storage is unavailable in some dev contexts; chrome stays in memory
  }
}

function readSavedSections(): EmailSavedSection[] {
  try {
    const raw = globalThis.localStorage?.getItem(SAVED_SECTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as EmailSavedSection[]) : [];
  } catch {
    return [];
  }
}

function writeSavedSections(sections: EmailSavedSection[]): void {
  try {
    globalThis.localStorage?.setItem(SAVED_SECTIONS_KEY, JSON.stringify(sections));
  } catch {
    // Storage can be unavailable (private mode); the session simply keeps none.
  }
}

const developmentCatalog: EmailTemplateCatalog = {
  triggers: seedDefinitions.map(([, , family, key, label, audience]) => ({ key, label, families: [family], audiences: audience.split(' & ') })),
  languages: ['English', 'Spanish'],
  businessUnits: ['Company default', 'SIOMAC Group'],
  owners: ['HR Operations', 'People Operations', 'Account Support'],
};

function applyFilters(input: EmailTemplateDraft[], args: EmailTemplateListArgs): EmailTemplateDraft[] {
  const q = args.query?.trim().toLowerCase();
  const filtered = input.filter(row =>
    (!q || [row.name, row.key, row.triggerLabel, row.ownerLabel].some(value => value.toLowerCase().includes(q)))
    && (!args.families?.length || args.families.includes(row.family))
    && (!args.statuses?.length || args.statuses.includes(row.status))
    && (!args.language || row.language === args.language)
    && (!args.owner || row.ownerLabel === args.owner)
    && (!args.usedByActiveWorkflow || row.activeUsageCount > 0));
  const direction = args.direction === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const field = args.sort ?? 'updated_at';
    const av = field === 'name' ? a.name : field === 'status' ? a.status : field === 'owner' ? a.ownerLabel : field === 'usage' ? a.activeUsageCount : a.updatedAt;
    const bv = field === 'name' ? b.name : field === 'status' ? b.status : field === 'owner' ? b.ownerLabel : field === 'usage' ? b.activeUsageCount : b.updatedAt;
    return String(av).localeCompare(String(bv)) * direction;
  });
}

export const developmentEmailTemplateService = {
  async catalog(): Promise<EmailTemplateCatalog> {
    await developmentLatency();
    return structuredClone(developmentCatalog);
  },
  async list(args: EmailTemplateListArgs): Promise<EmailTemplateSummary[]> {
    await developmentLatency();
    return applyFilters(rows, args);
  },
  async get(id: string): Promise<EmailTemplateDraft> {
    await developmentLatency();
    const found = rows.find(row => row.id === id);
    if (!found) throw new Error('Email template not found.');
    return structuredClone(found);
  },
  async create(args: CreateEmailTemplateArgs): Promise<EmailTemplateDraft> {
    await developmentLatency();
    const now = new Date().toISOString();
    const source = args.sourceTemplateId ? rows.find(row => row.id === args.sourceTemplateId) : null;
    const created: EmailTemplateDraft = {
      id: globalThis.crypto.randomUUID(),
      key: args.key,
      name: args.name,
      description: args.description ?? null,
      family: args.family,
      triggerKey: args.triggerKey,
      triggerLabel: args.triggerKey.split('.').join(' '),
      audience: args.audience,
      language: args.language,
      businessUnitLabel: args.businessUnitLabel,
      ownerLabel: args.ownerLabel,
      status: 'draft',
      approvalState: args.approvalRequired ? 'not_submitted' : 'not_required',
      currentVersion: 1,
      activeUsageCount: 0,
      protected: false,
      updatedAt: now,
      subject: '',
      preheader: '',
      // A copy inherits its source's chrome; anything else starts from the
      // CURRENT shared chrome, not the chrome that shipped with the starter.
      editorSchema: source
        ? structuredClone(source.editorSchema)
        : applyEmailChrome(
            args.startingPoint === 'blank'
              ? defaultSchema()
              : createStarterEmailDocument(args.family, args.triggerKey),
            readChrome(),
          ),
      compiledHtml: source?.compiledHtml ?? '',
      compiledText: source?.compiledText ?? '',
    };
    rows = [created, ...rows];
    return structuredClone(created);
  },
  async updateDraft(args: UpdateEmailTemplateDraftArgs): Promise<EmailTemplateDraft> {
    await developmentLatency();
    const index = rows.findIndex(row => row.id === args.id);
    const current = rows[index];
    if (!current) throw new Error('Email template not found.');
    if (current.status === 'published') throw new Error('Published versions are immutable. Create a new draft version.');
    const updated = {
      ...current,
      ...args,
      editorSchema: args.editorSchema ? normalizeEmailDocument(args.editorSchema) : current.editorSchema,
      updatedAt: new Date().toISOString(),
    };
    rows = rows.map((row, rowIndex) => rowIndex === index ? updated : row);
    return structuredClone(updated);
  },
  async duplicate(id: string): Promise<EmailTemplateDraft> {
    const source = await this.get(id);
    return this.create({
      family: source.family,
      startingPoint: 'existing',
      sourceTemplateId: source.id,
      name: `${source.name} Copy`,
      description: source.description,
      key: `${source.key}-copy-${Date.now()}`,
      audience: source.audience,
      triggerKey: source.triggerKey,
      language: source.language,
      businessUnitLabel: source.businessUnitLabel,
      ownerLabel: source.ownerLabel,
      approvalRequired: source.approvalState !== 'not_required',
    });
  },
  async listSavedSections(): Promise<EmailSavedSection[]> {
    await developmentLatency();
    return readSavedSections();
  },
  async createSavedSection(args: CreateSavedSectionArgs): Promise<EmailSavedSection> {
    await developmentLatency();
    const name = args.name.trim();
    if (!name) throw new Error('Give the saved section a name.');
    const sections = readSavedSections();
    if (sections.some(section => section.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A saved section called "${name}" already exists.`);
    }
    const created: EmailSavedSection = {
      id: globalThis.crypto.randomUUID(),
      name,
      block: structuredClone(args.block),
      createdAt: new Date().toISOString(),
    };
    writeSavedSections([created, ...sections]);
    return structuredClone(created);
  },
  async deleteSavedSection(id: string): Promise<void> {
    await developmentLatency();
    const sections = readSavedSections();
    if (!sections.some(section => section.id === id)) throw new Error('Saved section not found.');
    writeSavedSections(sections.filter(section => section.id !== id));
  },
  async archive(id: string): Promise<void> {
    await developmentLatency();
    const current = rows.find(row => row.id === id);
    if (!current) throw new Error('Email template not found.');
    rows = rows.map(row => row.id === id ? { ...row, status: 'archived', updatedAt: new Date().toISOString() } : row);
  },
  async getChrome(): Promise<EmailChromeDocument> {
    await developmentLatency();
    return structuredClone(readChrome());
  },
  async updateChrome(args: UpdateEmailChromeArgs): Promise<EmailChromeSyncResult> {
    await developmentLatency();
    const chrome: EmailChromeDocument = {
      header: structuredClone(args.header),
      footer: structuredClone(args.footer),
      updatedAt: new Date().toISOString(),
      updatedBy: 'Development user',
    };
    writeChrome(chrome);
    // Published/archived versions keep the chrome they shipped with — that is
    // the snapshot-at-publish rule. Only editable templates re-sync.
    const syncedTemplateIds: string[] = [];
    const skippedTemplateIds: string[] = [];
    rows = rows.map(row => {
      if (row.status === 'published' || row.status === 'archived' || row.status === 'superseded') {
        skippedTemplateIds.push(row.id);
        return row;
      }
      if (documentMatchesChrome(row.editorSchema, chrome)) return row;
      const editorSchema = applyEmailChrome(row.editorSchema, chrome);
      const compiled = renderEmailPreview(editorSchema, row.name);
      syncedTemplateIds.push(row.id);
      return {
        ...row,
        editorSchema,
        compiledHtml: compiled.html,
        compiledText: compiled.text,
        updatedAt: chrome.updatedAt,
      };
    });
    return { chrome: structuredClone(chrome), syncedTemplateIds, skippedTemplateIds };
  },
};
