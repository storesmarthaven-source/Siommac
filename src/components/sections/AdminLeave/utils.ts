/**
 * src/components/sections/AdminLeave/utils.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export function fmtLeaveDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day:   'numeric',
      year:  'numeric',
    });
  } catch {
    return d;
  }
}

export function capStr(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function leaveTypeBg(type: string): string {
  const map: Record<string, string> = {
    sick:    '#FEF3C7',
    casual:  '#EFF6FF',
    annual:  '#F0FDF4',
    medical: '#FDF4FF',
  };
  return map[type.toLowerCase()] ?? '#EFF6FF';
}

export function leaveTypeFg(type: string): string {
  const map: Record<string, string> = {
    sick:    '#92400E',
    casual:  '#1E40AF',
    annual:  '#166534',
    medical: '#6B21A8',
  };
  return map[type.toLowerCase()] ?? '#1E40AF';
}

export function leaveStatusBg(status: string): string {
  const map: Record<string, string> = {
    pending:  '#FFFBEB',
    approved: '#F0FDF4',
    rejected: '#FFF1F2',
  };
  return map[status.toLowerCase()] ?? '#FFFBEB';
}

export function leaveStatusFg(status: string): string {
  const map: Record<string, string> = {
    pending:  '#B45309',
    approved: '#15803D',
    rejected: '#BE123C',
  };
  return map[status.toLowerCase()] ?? '#B45309';
}

/** Build print-ready leave document HTML (mirrors legacy buildLeaveDocHtml) */
export function buildLeaveDocHtml(d: {
  id:             string;
  type:           string;
  fromDate:       string;
  toDate:         string;
  days:           number;
  status:         string;
  reason:         string | null;
  appliedAt:      string | null;
  reviewedAt:     string | null;
  reviewedBy:     string | null;
  reviewNotes:    string | null;
  companyName:    string | null;
  companyLogoUrl: string | null;
  employee: {
    fullName:   string;
    position:   string;
    department: string;
    username:   string;
  };
}): string {
  const esc = (s: string | null | undefined): string =>
    (s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const today        = new Date().toISOString().slice(0, 10);
  const status       = (d.status ?? 'pending').toLowerCase();
  const statusBadge  = ({
    approved: '<span style="color:#1a8a3a;font-weight:700;">APPROVED</span>',
    rejected: '<span style="color:#c1272d;font-weight:700;">REJECTED</span>',
    pending:  '<span style="color:#b8860b;font-weight:700;">PENDING</span>',
  } as Record<string, string>)[status] ?? '—';
  const reviewedDate = d.reviewedAt ? d.reviewedAt.slice(0, 10) : '____________';

  return (
    '<div class="leave-doc">'
    + '<div class="leave-doc-header">'
    + (d.companyLogoUrl ? `<img src="${esc(d.companyLogoUrl)}" alt="Logo" class="leave-doc-logo">` : '')
    + `<h1>${esc(d.companyName ?? 'Company')}</h1>`
    + '<h2>Leave Application</h2>'
    + '</div>'

    + '<div class="leave-doc-meta">'
    + `<div><strong>Date:</strong> ${esc((d.appliedAt ?? today).slice(0, 10))}</div>`
    + `<div><strong>Application No.:</strong> ${esc(d.id)}</div>`
    + '</div>'

    + `<div class="leave-doc-to"><strong>To,</strong><br>The HR Manager,<br>${esc(d.companyName ?? 'Company')}</div>`

    + `<div class="leave-doc-subject"><strong>Subject:</strong> Application for ${esc(capStr(d.type))} Leave</div>`

    + '<div>Respected Sir/Madam,</div>'

    + '<p class="leave-doc-body-text">'
    + `I, <strong>${esc(d.employee.fullName)}</strong>, working as <strong>${esc(d.employee.position || '—')}</strong>`
    + ` in the <strong>${esc(d.employee.department || '—')}</strong> department, would like to request`
    + ` <strong>${esc(capStr(d.type))} Leave</strong>`
    + ` from <strong>${esc(d.fromDate)}</strong> to <strong>${esc(d.toDate)}</strong>,`
    + ` totaling <strong>${d.days} day${d.days === 1 ? '' : 's'}</strong>.`
    + '</p>'

    + `<p class="leave-doc-body-text"><strong>Reason:</strong> ${esc(d.reason ?? '—')}</p>`

    + '<p class="leave-doc-body-text">I will ensure that all my pending tasks are handed over before my leave begins. Kindly approve my application.</p>'

    + '<p class="leave-doc-body-text">Thank you for your kind consideration.</p>'

    + '<div class="leave-doc-sign">'
    + '<div>Yours sincerely,</div>'
    + '<div class="leave-doc-sign-line">_____________________________</div>'
    + `<div><strong>${esc(d.employee.fullName)}</strong></div>`
    + `<div>${esc(d.employee.position ?? '')}</div>`
    + `<div>${esc(d.employee.username)}</div>`
    + '</div>'

    + '<div class="leave-doc-hr">'
    + '<div class="leave-doc-hr-title">For HR / Manager Use Only</div>'
    + '<table>'
    + `<tr><td>Status</td><td>${statusBadge}</td></tr>`
    + `<tr><td>Reviewed By</td><td>${esc(d.reviewedBy ?? '____________')}</td></tr>`
    + `<tr><td>Date</td><td>${esc(reviewedDate)}</td></tr>`
    + `<tr><td>Notes</td><td>${esc(d.reviewNotes ?? '—')}</td></tr>`
    + '</table>'
    + '<div class="leave-doc-sign-line" style="margin-top:36px;">_____________________________</div>'
    + '<div>Authorized Signature</div>'
    + '</div>'
    + '</div>'
  );
}

export const PRINT_CSS = [
  '@page { size: A4; margin: 14mm; }',
  'body { font-family: "Times New Roman", Times, serif; color: #000; line-height: 1.6; font-size: 12pt; margin: 0; padding: 0; }',
  '.leave-doc { padding: 0; max-width: 100%; min-height: auto; }',
  '.leave-doc-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 22px; }',
  '.leave-doc-header h1 { font-size: 22pt; margin: 6px 0 4px; font-weight: 700; }',
  '.leave-doc-header h2 { font-size: 14pt; margin: 0; text-transform: uppercase; letter-spacing: 3px; font-weight: 700; color: #333; }',
  '.leave-doc-logo { max-height: 64px; max-width: 120px; object-fit: contain; margin-bottom: 6px; }',
  '.leave-doc-meta { display: flex; justify-content: space-between; margin-bottom: 22px; font-size: 11pt; }',
  '.leave-doc-to { margin-bottom: 18px; }',
  '.leave-doc-subject { margin-bottom: 18px; padding-bottom: 4px; border-bottom: 1px solid #444; }',
  '.leave-doc-body-text { margin: 12px 0; text-align: justify; text-indent: 30px; }',
  '.leave-doc-sign { margin-top: 36px; }',
  '.leave-doc-sign-line { margin-top: 50px; margin-bottom: 4px; }',
  '.leave-doc-hr { margin-top: 40px; border-top: 2px solid #000; padding-top: 16px; }',
  '.leave-doc-hr-title { text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 14px; }',
  '.leave-doc-hr table { width: 100%; border-collapse: collapse; font-size: 11pt; }',
  '.leave-doc-hr table td { padding: 6px 8px; border: 1px solid #000; }',
  ".leave-doc-hr table td:first-child { background: #f0f0f0; font-weight: 600; width: 28%; }",
].join('\n');
