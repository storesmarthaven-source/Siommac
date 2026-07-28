/**
 * Unit coverage for per-employee document health: the expiry-window state the
 * compliance engine lacked, plus grouping, counts and percentages.
 *
 * The rules are pure, so they are exercised directly without a database.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDocumentHealth, categoryOf, classifyDocumentHealth,
  type HealthDocRow,
} from '../../netlify/functions/lib/hr/documentHealth';
import type { DocumentRequirement } from '../../netlify/functions/lib/hr/documentsRequirements';

const TODAY = '2026-07-28';

function req(over: Partial<DocumentRequirement> & { documentType: string }): DocumentRequirement {
  return {
    id: `req-${over.documentType}`, label: over.documentType, appliesToScope: 'all',
    appliesToValue: null, requiresExpiry: false, reminderDays: [], minConfidentiality: null,
    isActive: true, blocksOnboarding: false, allowWaiver: false, ...over,
  } as DocumentRequirement;
}

function doc(over: Partial<HealthDocRow> & { document_type: string }): HealthDocRow {
  return {
    id: `doc-${over.document_type}`, employee_id: 'EMP-1', title: over.document_type,
    status: 'verified', expiry_date: null, confidentiality: 'internal',
    verified_at: null, uploaded_at: null, ...over,
  };
}

describe('expiry-window classification', () => {
  it('reports missing when there is no document at all', () => {
    expect(classifyDocumentHealth(undefined, false, TODAY)).toBe('missing');
  });

  it('treats archived and rejected as missing, not as held', () => {
    expect(classifyDocumentHealth(doc({ document_type: 'id', status: 'archived' }), false, TODAY)).toBe('missing');
    expect(classifyDocumentHealth(doc({ document_type: 'id', status: 'rejected' }), false, TODAY)).toBe('missing');
  });

  it('reports expired before anything else', () => {
    expect(classifyDocumentHealth(
      doc({ document_type: 'id', status: 'verified', expiry_date: '2026-07-27' }), false, TODAY,
    )).toBe('expired');
  });

  it('reports expiring inside the window and healthy outside it', () => {
    expect(classifyDocumentHealth(
      doc({ document_type: 'id', status: 'verified', expiry_date: '2026-08-10' }), false, TODAY,
    )).toBe('expiring');
    expect(classifyDocumentHealth(
      doc({ document_type: 'id', status: 'verified', expiry_date: '2026-12-31' }), false, TODAY,
    )).toBe('verified');
  });

  it('counts the boundary day as expiring, not as healthy', () => {
    expect(classifyDocumentHealth(
      doc({ document_type: 'id', status: 'verified', expiry_date: '2026-08-27' }), false, TODAY,
    )).toBe('expiring');
  });

  it('treats a requirement that demands an expiry date but has none as unverified', () => {
    expect(classifyDocumentHealth(
      doc({ document_type: 'id', status: 'verified', expiry_date: null }), true, TODAY,
    )).toBe('unverified');
  });

  it('reports an uploaded-but-unreviewed document as unverified', () => {
    expect(classifyDocumentHealth(
      doc({ document_type: 'id', status: 'uploaded' }), false, TODAY,
    )).toBe('unverified');
  });
});

describe('category grouping', () => {
  it('groups on the segment before the first underscore', () => {
    expect(categoryOf('identity_national_id')).toEqual({ key: 'identity', label: 'Identity' });
    expect(categoryOf('training')).toEqual({ key: 'training', label: 'Training' });
  });
});

describe('health summary', () => {
  it('reports zeroes — never NaN — when nothing is required', () => {
    const h = buildDocumentHealth([], [], TODAY);
    expect(h).toMatchObject({
      requiredCount: 0, verifiedCount: 0, expiringCount: 0, missingCount: 0,
      verifiedPercent: 0, expiringPercent: 0, missingPercent: 0, totalDocuments: 0,
    });
  });

  it('counts and percentages are of the REQUIRED set', () => {
    const requirements = [
      req({ documentType: 'identity_id' }),
      req({ documentType: 'identity_nis' }),
      req({ documentType: 'training_safety', requiresExpiry: true }),
      req({ documentType: 'employment_contract' }),
    ];
    const documents = [
      doc({ document_type: 'identity_id', status: 'verified', verified_at: '2025-01-08T00:00:00Z' }),
      doc({ document_type: 'identity_nis', status: 'verified' }),
      doc({ document_type: 'training_safety', status: 'verified', expiry_date: '2026-08-05' }),
      // employment_contract absent -> missing
    ];
    const h = buildDocumentHealth(requirements, documents, TODAY);
    expect(h.requiredCount).toBe(4);
    expect(h.verifiedCount).toBe(2);
    expect(h.expiringCount).toBe(1);
    expect(h.missingCount).toBe(1);
    expect(h.verifiedPercent).toBe(50);
    expect(h.expiringPercent).toBe(25);
    expect(h.missingPercent).toBe(25);
    expect(h.totalDocuments).toBe(3);
  });

  it('emits a row for a required document that is absent, so missing is visible', () => {
    const h = buildDocumentHealth([req({ documentType: 'statutory_td1', label: 'TD1 Declaration' })], [], TODAY);
    const item = h.groups.flatMap(g => g.items).find(i => i.documentType === 'statutory_td1');
    expect(item).toMatchObject({
      state: 'missing', documentId: null, required: true, title: 'TD1 Declaration', detail: 'Not provided',
    });
  });

  it('still lists a held document that no active requirement expects', () => {
    const h = buildDocumentHealth([], [doc({ document_type: 'other_reference', status: 'verified' })], TODAY);
    const item = h.groups.flatMap(g => g.items).find(i => i.documentType === 'other_reference');
    expect(item).toMatchObject({ required: false, state: 'verified' });
    // ...but it must not inflate the required-set percentages.
    expect(h.requiredCount).toBe(0);
    expect(h.verifiedPercent).toBe(0);
  });

  it('prefers the verified document when a type has several', () => {
    const h = buildDocumentHealth(
      [req({ documentType: 'identity_id' })],
      [
        doc({ document_type: 'identity_id', id: 'd-old', status: 'uploaded', uploaded_at: '2026-01-01T00:00:00Z' }),
        doc({ document_type: 'identity_id', id: 'd-good', status: 'verified' }),
      ],
      TODAY,
    );
    const item = h.groups.flatMap(g => g.items).find(i => i.required);
    expect(item?.documentId).toBe('d-good');
    expect(item?.state).toBe('verified');
  });

  it('rolls per-group counts up and sorts groups by label', () => {
    const h = buildDocumentHealth(
      [
        req({ documentType: 'training_safety' }),
        req({ documentType: 'identity_id' }),
        req({ documentType: 'identity_nis' }),
      ],
      [
        doc({ document_type: 'identity_id', status: 'verified' }),
        doc({ document_type: 'training_safety', status: 'verified', expiry_date: '2026-08-01' }),
      ],
      TODAY,
    );
    expect(h.groups.map(g => g.label)).toEqual(['Identity', 'Training']);
    const identity = h.groups.find(g => g.key === 'identity')!;
    expect(identity).toMatchObject({ currentCount: 1, missingCount: 1, expiringCount: 0 });
    const training = h.groups.find(g => g.key === 'training')!;
    expect(training).toMatchObject({ currentCount: 0, expiringCount: 1, missingCount: 0 });
    expect(h.categoryCount).toBe(2);
  });

  it('counts an expired required document as missing coverage, not as expiring', () => {
    const h = buildDocumentHealth(
      [req({ documentType: 'identity_id' })],
      [doc({ document_type: 'identity_id', status: 'verified', expiry_date: '2026-01-01' })],
      TODAY,
    );
    expect(h.missingCount).toBe(1);
    expect(h.expiringCount).toBe(0);
    expect(h.verifiedCount).toBe(0);
  });
});
