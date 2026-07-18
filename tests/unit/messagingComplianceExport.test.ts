import {
  normalizeMessagingComplianceExportSnapshot,
  renderMessagingComplianceExport,
  type ComplianceExportSnapshot,
} from '../../netlify/functions/lib/messaging/complianceExportRenderer';

const snapshot: ComplianceExportSnapshot = {
  case: {
    id: 'case-0001',
    caseNo: 'MCC-2026-0001',
    title: 'Payroll access investigation',
    caseType: 'security_investigation',
    status: 'approved',
    requestedBy: { id: 'user-001', displayName: 'Alicia Ramdeen' },
  },
  thread: {
    id: 'case-thread-001',
    threadId: 'thread-001',
    subject: 'July payroll review',
    threadType: 'group',
    sourceModule: 'finance',
    sourceEntityType: 'payroll_run',
    sourceEntityId: 'run-001',
  },
  purpose: 'Investigate an approved access-control incident.',
  range: {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-18T00:00:00.000Z',
  },
  generatedAt: '2026-07-18T04:00:00.000Z',
  messages: [
    {
      id: 'message-002',
      sequence: 2,
      author: { id: 'user-003', displayName: 'Finance Manager' },
      body: 'Second message',
      isSystem: false,
      editedAt: null,
      deletedAt: null,
      createdAt: '2026-07-02T09:00:00.000Z',
      attachments: [],
    },
    {
      id: 'message-001',
      sequence: 1,
      author: { id: 'user-002', displayName: 'Payroll Officer' },
      body: '<b>Literal markup</b>\r\n<script>alert("x")</script>',
      isSystem: false,
      editedAt: '2026-07-01T09:02:00.000Z',
      deletedAt: null,
      createdAt: '2026-07-01T09:00:00.000Z',
      attachments: [
        {
          id: 'attachment-001',
          fileName: 'evidence.txt',
          contentType: 'text/plain',
          sizeBytes: 27,
          attachmentType: 'evidence',
          scanStatus: 'clean',
          storagePath: 'private/thread-001/secret.txt',
          signedUrl: 'https://storage.example.test/private-token',
        } as never,
      ],
    },
    {
      id: 'message-003',
      sequence: 3,
      author: null,
      body: 'This must not survive deletion.',
      isSystem: false,
      editedAt: null,
      deletedAt: '2026-07-03T10:05:00.000Z',
      createdAt: '2026-07-03T10:00:00.000Z',
      attachments: [],
    },
  ],
};

describe('Messenger Compliance V1 export renderer', () => {
  it('renders byte-identical canonical JSON and deterministic PDF for the same snapshot', async () => {
    const firstJson = await renderMessagingComplianceExport(snapshot, 'json');
    const secondJson = await renderMessagingComplianceExport({ ...snapshot }, 'json');
    expect(firstJson.buffer.equals(secondJson.buffer)).toBe(true);
    expect(firstJson.contentType).toBe('application/json');
    expect(firstJson.fileExtension).toBe('json');
    expect(firstJson.messageCount).toBe(3);

    const firstPdf = await renderMessagingComplianceExport(snapshot, 'pdf');
    const secondPdf = await renderMessagingComplianceExport(snapshot, 'pdf');
    expect(firstPdf.buffer.equals(secondPdf.buffer)).toBe(true);
    expect(firstPdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(firstPdf.buffer.toString('latin1')).toContain('%%EOF');
    expect(firstPdf.contentType).toBe('application/pdf');
    expect(firstPdf.fileExtension).toBe('pdf');
    expect(firstPdf.messageCount).toBe(3);
  });

  it('sorts every JSON object key and terminates the artifact with one LF', async () => {
    const result = await renderMessagingComplianceExport(snapshot, 'json');
    const text = result.buffer.toString('utf8');

    expect(text.startsWith('{"case":')).toBe(true);
    expect(text.indexOf('"generatedAt"')).toBeLessThan(text.indexOf('"messageCount"'));
    expect(text.indexOf('"messageCount"')).toBeLessThan(text.indexOf('"messages"'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\r');

    const parsed = JSON.parse(text) as { messages: Array<Record<string, unknown>> };
    expect(Object.keys(parsed.messages[0] ?? {})).toEqual([
      'attachments',
      'author',
      'body',
      'createdAt',
      'deletedAt',
      'editedAt',
      'id',
      'isSystem',
      'sequence',
    ]);
  });

  it('keeps markup as plain text, normalizes line endings, and marks deleted bodies', async () => {
    const normalized = normalizeMessagingComplianceExportSnapshot(snapshot);
    expect(normalized.messages.map(message => message.id)).toEqual([
      'message-001',
      'message-002',
      'message-003',
    ]);
    expect(normalized.messages[0]?.body).toBe('<b>Literal markup</b>\n<script>alert("x")</script>');
    expect(normalized.messages[2]?.body).toBe('[Message deleted]');

    const result = await renderMessagingComplianceExport(snapshot, 'json');
    const text = result.buffer.toString('utf8');
    expect(text).not.toContain('<script>');
    expect(text).toContain('\\u003cscript\\u003e');
    const parsed = JSON.parse(text) as { messages: Array<{ body: string }> };
    expect(parsed.messages[0]?.body).toBe('<b>Literal markup</b>\n<script>alert("x")</script>');
  });

  it('exports attachment metadata only and strips storage paths and signed URLs', async () => {
    const json = await renderMessagingComplianceExport(snapshot, 'json');
    const pdf = await renderMessagingComplianceExport(snapshot, 'pdf');
    const jsonText = json.buffer.toString('utf8');
    const pdfText = pdf.buffer.toString('latin1');

    for (const forbidden of [
      'storagePath',
      'signedUrl',
      'private/thread-001/secret.txt',
      'https://storage.example.test/private-token',
    ]) {
      expect(jsonText).not.toContain(forbidden);
      expect(pdfText).not.toContain(forbidden);
    }

    const parsed = JSON.parse(jsonText) as {
      messages: Array<{ attachments: Array<Record<string, unknown>> }>;
    };
    expect(Object.keys(parsed.messages[0]?.attachments[0] ?? {})).toEqual([
      'attachmentType',
      'contentType',
      'fileName',
      'id',
      'scanStatus',
      'sizeBytes',
    ]);
  });

  it('changes JSON and PDF bytes when a material input changes', async () => {
    const changed: ComplianceExportSnapshot = {
      ...snapshot,
      purpose: 'A different approved investigation purpose.',
    };
    const [baseJson, changedJson, basePdf, changedPdf] = await Promise.all([
      renderMessagingComplianceExport(snapshot, 'json'),
      renderMessagingComplianceExport(changed, 'json'),
      renderMessagingComplianceExport(snapshot, 'pdf'),
      renderMessagingComplianceExport(changed, 'pdf'),
    ]);

    expect(baseJson.buffer.equals(changedJson.buffer)).toBe(false);
    expect(basePdf.buffer.equals(changedPdf.buffer)).toBe(false);
  });

  it('rejects missing required metadata and invalid ranges', async () => {
    await expect(renderMessagingComplianceExport(
      { ...snapshot, purpose: '   ' },
      'json',
    )).rejects.toThrow('purpose is required');
    await expect(renderMessagingComplianceExport(
      {
        ...snapshot,
        range: {
          from: '2026-07-19T00:00:00.000Z',
          to: '2026-07-18T00:00:00.000Z',
        },
      },
      'pdf',
    )).rejects.toThrow('range.from must not be after range.to');
  });
});
