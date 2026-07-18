import { createHmac } from 'node:crypto';
import { getReqContext } from '../reqContext';
import type { ComplianceEvidenceContext } from './complianceRpc';

const EVIDENCE_DOMAIN = 'siomac:messenger-compliance-evidence:v1:';

function evidencePepper(): string {
  const pepper = process.env.COMPLIANCE_EVIDENCE_PEPPER_V1 ?? '';
  if (pepper.length < 32) {
    throw Object.assign(
      new Error('Compliance evidence hashing is unavailable.'),
      { status: 503, code: 'compliance_evidence_unavailable' },
    );
  }
  return pepper;
}

function hashEvidence(kind: 'ip' | 'user-agent', value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return createHmac('sha256', evidencePepper())
    .update(`${EVIDENCE_DOMAIN}${kind}:${normalized}`)
    .digest('hex');
}

export function complianceEvidenceContext(): ComplianceEvidenceContext {
  const request = getReqContext();
  return {
    ipHash: hashEvidence('ip', request.ip),
    userAgentHash: hashEvidence('user-agent', request.userAgent),
  };
}
