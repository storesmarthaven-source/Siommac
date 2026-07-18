import PDFDocument from 'pdfkit';

import type {
  ComplianceActorRef,
  ComplianceAttachmentMetadata,
  ComplianceCaseStatus,
  ComplianceCaseType,
  ComplianceMessage,
} from '../../../../types/messagingCompliance';

const SERIALIZER_VERSION = 'messenger-compliance-v1';
const DELETED_MESSAGE_MARKER = '[Message deleted]';
const EMPTY_MESSAGE_MARKER = '[No message body]';
const PDF_MARGIN = 42;
const PDF_NAVY = '#16325c';
const PDF_TEXT = '#172033';
const PDF_MUTED = '#5f6b7a';
const PDF_BORDER = '#d8dee8';
const PDF_SUBTLE = '#f4f6f9';
const CASE_TYPES = new Set<ComplianceCaseType>([
  'hr_investigation',
  'safety_investigation',
  'legal_request',
  'security_investigation',
  'other_formal_investigation',
]);
const CASE_STATUSES = new Set<ComplianceCaseStatus>([
  'pending_approval',
  'approved',
  'rejected',
  'closed',
]);

export interface ComplianceExportCaseSnapshot {
  id: string;
  caseNo: string;
  title: string;
  caseType: ComplianceCaseType;
  status: ComplianceCaseStatus;
  requestedBy: ComplianceActorRef;
}

export interface ComplianceExportThreadSnapshot {
  id: string;
  threadId: string;
  subject: string | null;
  threadType: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
}

export interface ComplianceExportRange {
  from: string | null;
  to: string | null;
}

export interface ComplianceExportSnapshot {
  case: ComplianceExportCaseSnapshot;
  thread: ComplianceExportThreadSnapshot;
  messages: ComplianceMessage[];
  purpose: string;
  range: ComplianceExportRange;
  generatedAt: string;
}

export type ComplianceExportRenderFormat = 'json' | 'pdf';

export interface ComplianceExportRenderResult {
  buffer: Buffer;
  contentType: 'application/json' | 'application/pdf';
  fileExtension: 'json' | 'pdf';
  messageCount: number;
}

interface SafeAttachment {
  attachmentType: string | null;
  contentType: string | null;
  fileName: string;
  id: string;
  scanStatus: string | null;
  sizeBytes: number | null;
}

interface SafeMessage {
  attachments: SafeAttachment[];
  author: ComplianceActorRef | null;
  body: string;
  createdAt: string;
  deletedAt: string | null;
  editedAt: string | null;
  id: string;
  isSystem: boolean;
  sequence: number | null;
}

interface SafeExportSnapshot {
  case: ComplianceExportCaseSnapshot;
  generatedAt: string;
  messageCount: number;
  messages: SafeMessage[];
  purpose: string;
  range: ComplianceExportRange;
  schemaVersion: string;
  thread: ComplianceExportThreadSnapshot;
}

function fail(message: string): never {
  throw new Error(`Invalid compliance export snapshot: ${message}`);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${field} is required`);
  return normalizeText(value);
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') fail(`${field} must be a string or null`);
  return normalizeText(value);
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\0').join('');
}

function isoInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${field} is required`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(`${field} must be a valid timestamp`);
  return parsed.toISOString();
}

function nullableIsoInstant(value: unknown, field: string): string | null {
  if (value === null) return null;
  return isoInstant(value, field);
}

function actorRef(value: unknown, field: string): ComplianceActorRef {
  if (!value || typeof value !== 'object') fail(`${field} is required`);
  const actor = value as ComplianceActorRef;
  return {
    displayName: nullableText(actor.displayName, `${field}.displayName`),
    id: requiredText(actor.id, `${field}.id`),
  };
}

function attachmentMetadata(value: unknown, field: string): SafeAttachment {
  if (!value || typeof value !== 'object') fail(`${field} must be an object`);
  const attachment = value as ComplianceAttachmentMetadata;
  if (attachment.sizeBytes !== null
    && (!Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes < 0)) {
    fail(`${field}.sizeBytes must be a non-negative safe integer or null`);
  }
  return {
    attachmentType: nullableText(attachment.attachmentType, `${field}.attachmentType`),
    contentType: nullableText(attachment.contentType, `${field}.contentType`),
    fileName: requiredText(attachment.fileName, `${field}.fileName`),
    id: requiredText(attachment.id, `${field}.id`),
    scanStatus: nullableText(attachment.scanStatus, `${field}.scanStatus`),
    sizeBytes: attachment.sizeBytes,
  };
}

function messageSnapshot(value: unknown, index: number): SafeMessage {
  if (!value || typeof value !== 'object') fail(`messages[${index}] must be an object`);
  const message = value as ComplianceMessage;
  if (message.sequence !== null
    && (!Number.isSafeInteger(message.sequence) || message.sequence < 0)) {
    fail(`messages[${index}].sequence must be a non-negative safe integer or null`);
  }
  if (typeof message.isSystem !== 'boolean') fail(`messages[${index}].isSystem must be a boolean`);
  if (!Array.isArray(message.attachments)) fail(`messages[${index}].attachments must be an array`);
  if (message.body !== null && typeof message.body !== 'string') {
    fail(`messages[${index}].body must be a string or null`);
  }

  const deletedAt = nullableIsoInstant(message.deletedAt, `messages[${index}].deletedAt`);
  const rawBody = message.body === null
    ? EMPTY_MESSAGE_MARKER
    : normalizeText(message.body);

  return {
    attachments: message.attachments.map((attachment, attachmentIndex) =>
      attachmentMetadata(attachment, `messages[${index}].attachments[${attachmentIndex}]`)),
    author: message.author === null ? null : actorRef(message.author, `messages[${index}].author`),
    body: deletedAt === null ? rawBody : DELETED_MESSAGE_MARKER,
    createdAt: isoInstant(message.createdAt, `messages[${index}].createdAt`),
    deletedAt,
    editedAt: nullableIsoInstant(message.editedAt, `messages[${index}].editedAt`),
    id: requiredText(message.id, `messages[${index}].id`),
    isSystem: message.isSystem,
    sequence: message.sequence,
  };
}

function compareMessages(a: SafeMessage, b: SafeMessage): number {
  const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  const aSequence = a.sequence ?? -1;
  const bSequence = b.sequence ?? -1;
  if (aSequence !== bSequence) return aSequence - bSequence;
  return a.id.localeCompare(b.id);
}

export function normalizeMessagingComplianceExportSnapshot(
  input: ComplianceExportSnapshot,
): SafeExportSnapshot {
  const candidate: unknown = input;
  if (!candidate || typeof candidate !== 'object') fail('snapshot is required');
  const record = candidate as Record<string, unknown>;
  if (!record.case || typeof record.case !== 'object') fail('case is required');
  if (!record.thread || typeof record.thread !== 'object') fail('thread is required');
  if (!record.range || typeof record.range !== 'object') fail('range is required');
  if (!Array.isArray(record.messages)) fail('messages must be an array');
  const checkedInput = record as unknown as ComplianceExportSnapshot;
  if (!CASE_TYPES.has(checkedInput.case.caseType)) fail('case.caseType is invalid');
  if (!CASE_STATUSES.has(checkedInput.case.status)) fail('case.status is invalid');

  const range = {
    from: nullableIsoInstant(checkedInput.range.from, 'range.from'),
    to: nullableIsoInstant(checkedInput.range.to, 'range.to'),
  };
  if (range.from !== null && range.to !== null && range.from > range.to) {
    fail('range.from must not be after range.to');
  }

  const messages = checkedInput.messages.map(messageSnapshot).sort(compareMessages);
  return {
    case: {
      caseNo: requiredText(checkedInput.case.caseNo, 'case.caseNo'),
      caseType: checkedInput.case.caseType,
      id: requiredText(checkedInput.case.id, 'case.id'),
      requestedBy: actorRef(checkedInput.case.requestedBy, 'case.requestedBy'),
      status: checkedInput.case.status,
      title: requiredText(checkedInput.case.title, 'case.title'),
    },
    generatedAt: isoInstant(checkedInput.generatedAt, 'generatedAt'),
    messageCount: messages.length,
    messages,
    purpose: requiredText(checkedInput.purpose, 'purpose'),
    range,
    schemaVersion: SERIALIZER_VERSION,
    thread: {
      id: requiredText(checkedInput.thread.id, 'thread.id'),
      sourceEntityId: nullableText(checkedInput.thread.sourceEntityId, 'thread.sourceEntityId'),
      sourceEntityType: nullableText(checkedInput.thread.sourceEntityType, 'thread.sourceEntityType'),
      sourceModule: nullableText(checkedInput.thread.sourceModule, 'thread.sourceModule'),
      subject: nullableText(checkedInput.thread.subject, 'thread.subject'),
      threadId: requiredText(checkedInput.thread.threadId, 'thread.threadId'),
      threadType: requiredText(checkedInput.thread.threadType, 'thread.threadType'),
    },
  };
}

function canonicalJsonString(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => {
      switch (character) {
        case '<': return '\\u003c';
        case '>': return '\\u003e';
        case '&': return '\\u0026';
        case '\u2028': return '\\u2028';
        case '\u2029': return '\\u2029';
        default: return character;
      }
    });
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('numbers must be finite');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalJsonString).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${canonicalJsonString(key)}:${canonicalJsonString(record[key])}`)
      .join(',')}}`;
  }
  fail(`unsupported JSON value type ${typeof value}`);
}

export function renderMessagingComplianceJson(snapshot: ComplianceExportSnapshot): Buffer {
  const safeSnapshot = normalizeMessagingComplianceExportSnapshot(snapshot);
  return renderSafeJson(safeSnapshot);
}

function renderSafeJson(snapshot: SafeExportSnapshot): Buffer {
  return Buffer.from(`${canonicalJsonString(snapshot)}\n`, 'utf8');
}

function formatRange(range: ComplianceExportRange): string {
  return `${range.from ?? 'Beginning of conversation'} to ${range.to ?? 'End of conversation'}`;
}

function drawPageHeader(
  doc: PDFKit.PDFDocument,
  snapshot: SafeExportSnapshot,
): void {
  const width = doc.page.width - PDF_MARGIN * 2;
  doc.fillColor(PDF_NAVY).font('Helvetica-Bold').fontSize(16)
    .text('Messenger Compliance Export', PDF_MARGIN, PDF_MARGIN, { width });
  doc.font('Helvetica').fontSize(8.5).fillColor(PDF_MUTED)
    .text(`Case ${snapshot.case.caseNo} | Generated ${snapshot.generatedAt}`, PDF_MARGIN, PDF_MARGIN + 22, { width });
  doc.moveTo(PDF_MARGIN, PDF_MARGIN + 39)
    .lineTo(PDF_MARGIN + width, PDF_MARGIN + 39)
    .strokeColor(PDF_BORDER)
    .lineWidth(1)
    .stroke();
  doc.y = PDF_MARGIN + 52;
}

function ensureVerticalSpace(
  doc: PDFKit.PDFDocument,
  snapshot: SafeExportSnapshot,
  requiredHeight: number,
): void {
  if (doc.y + requiredHeight <= doc.page.height - PDF_MARGIN) return;
  doc.addPage();
  drawPageHeader(doc, snapshot);
}

function drawLabelValue(
  doc: PDFKit.PDFDocument,
  snapshot: SafeExportSnapshot,
  label: string,
  value: string,
): void {
  const width = doc.page.width - PDF_MARGIN * 2;
  const height = doc.heightOfString(value, { width: width - 120 });
  ensureVerticalSpace(doc, snapshot, Math.max(18, height + 5));
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_MUTED).text(label, PDF_MARGIN, y, { width: 110 });
  doc.font('Helvetica').fontSize(9).fillColor(PDF_TEXT).text(value, PDF_MARGIN + 120, y, { width: width - 120 });
  doc.y = Math.max(doc.y, y + height) + 5;
}

function attachmentSummary(attachment: SafeAttachment): string {
  const details = [
    attachment.contentType,
    attachment.sizeBytes === null ? null : `${attachment.sizeBytes} bytes`,
    attachment.scanStatus,
  ].filter((value): value is string => value !== null && value.length > 0);
  return details.length === 0
    ? attachment.fileName
    : `${attachment.fileName} (${details.join(', ')})`;
}

function drawMessage(
  doc: PDFKit.PDFDocument,
  snapshot: SafeExportSnapshot,
  message: SafeMessage,
): void {
  const width = doc.page.width - PDF_MARGIN * 2;
  const author = message.author?.displayName ?? message.author?.id ?? (message.isSystem ? 'System' : 'Unknown user');
  const bodyHeight = doc.heightOfString(message.body, { width: width - 20, lineGap: 2 });
  const attachmentsHeight = message.attachments.length * 13;
  ensureVerticalSpace(doc, snapshot, Math.min(bodyHeight + attachmentsHeight + 48, 150));

  const top = doc.y;
  doc.rect(PDF_MARGIN, top, width, 21).fill(PDF_SUBTLE);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_NAVY)
    .text(author, PDF_MARGIN + 8, top + 6, { width: width * 0.55 });
  doc.font('Helvetica').fontSize(8).fillColor(PDF_MUTED)
    .text(message.createdAt, PDF_MARGIN + width * 0.56, top + 6, {
      align: 'right',
      width: width * 0.42 - 8,
    });

  doc.y = top + 29;
  doc.font('Helvetica').fontSize(9).fillColor(PDF_TEXT)
    .text(message.body, PDF_MARGIN + 10, doc.y, { lineGap: 2, width: width - 20 });

  if (message.attachments.length > 0) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_MUTED)
      .text('Attachments', PDF_MARGIN + 10, doc.y, { width: width - 20 });
    for (const attachment of message.attachments) {
      doc.font('Helvetica').fontSize(8).fillColor(PDF_TEXT)
        .text(`- ${attachmentSummary(attachment)}`, PDF_MARGIN + 16, doc.y, { width: width - 26 });
    }
  }

  doc.moveDown(0.6);
  doc.moveTo(PDF_MARGIN, doc.y)
    .lineTo(PDF_MARGIN + width, doc.y)
    .strokeColor(PDF_BORDER)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.8);
}

function renderSafePdf(safeSnapshot: SafeExportSnapshot): Promise<Buffer> {
  const generatedAt = new Date(safeSnapshot.generatedAt);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        compress: false,
        info: {
          Author: 'SIOMAC',
          CreationDate: generatedAt,
          Creator: SERIALIZER_VERSION,
          ModDate: generatedAt,
          Producer: SERIALIZER_VERSION,
          Subject: `Read-only Messenger evidence for ${safeSnapshot.case.caseNo}`,
          Title: `Messenger Compliance Export ${safeSnapshot.case.caseNo}`,
        },
        margin: PDF_MARGIN,
        size: 'A4',
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawPageHeader(doc, safeSnapshot);
      drawLabelValue(doc, safeSnapshot, 'CASE', `${safeSnapshot.case.caseNo} - ${safeSnapshot.case.title}`);
      drawLabelValue(doc, safeSnapshot, 'CONVERSATION', safeSnapshot.thread.subject ?? safeSnapshot.thread.threadId);
      drawLabelValue(doc, safeSnapshot, 'DATE RANGE', formatRange(safeSnapshot.range));
      drawLabelValue(doc, safeSnapshot, 'PURPOSE', safeSnapshot.purpose);
      drawLabelValue(doc, safeSnapshot, 'MESSAGES', String(safeSnapshot.messageCount));
      doc.moveDown(0.7);

      for (const message of safeSnapshot.messages) drawMessage(doc, safeSnapshot, message);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function renderMessagingCompliancePdf(snapshot: ComplianceExportSnapshot): Promise<Buffer> {
  return renderSafePdf(normalizeMessagingComplianceExportSnapshot(snapshot));
}

export async function renderMessagingComplianceExport(
  snapshot: ComplianceExportSnapshot,
  format: ComplianceExportRenderFormat,
): Promise<ComplianceExportRenderResult> {
  const safeSnapshot = normalizeMessagingComplianceExportSnapshot(snapshot);
  if (format === 'json') {
    return {
      buffer: renderSafeJson(safeSnapshot),
      contentType: 'application/json',
      fileExtension: 'json',
      messageCount: safeSnapshot.messageCount,
    };
  }
  return {
    buffer: await renderSafePdf(safeSnapshot),
    contentType: 'application/pdf',
    fileExtension: 'pdf',
    messageCount: safeSnapshot.messageCount,
  };
}
