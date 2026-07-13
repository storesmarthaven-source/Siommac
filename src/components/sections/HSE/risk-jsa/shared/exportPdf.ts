/**
 * src/components/sections/HSE/risk-jsa/shared/exportPdf.ts
 *
 * Dependency-free "Export PDF" for Risk Assessments and JSAs. Builds a printable
 * HTML document from the loaded detail and opens the browser print dialog
 * (the user picks "Save as PDF"). No external library, no server round-trip.
 */
import { dialog } from '@lib/dialog';

type Dict = Record<string, unknown>;

const esc = (v: unknown): string =>
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- intentional: utility accepts any value; String() is the correct coercion
  String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

const fmtDate = (iso: unknown): string =>
  iso ? new Date(iso as string).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function band(score: unknown): string {
  const n = Number(score);
  if (!n) return '—';
  const label = n >= 17 ? 'Critical' : n >= 10 ? 'High' : n >= 5 ? 'Medium' : 'Low';
  return `${label} · ${n}`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '<p class="muted">None recorded.</p>';
  return `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function shell(title: string, sub: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1b2d55; margin: 32px; font-size: 12px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    h2 { font-size: 13px; margin: 22px 0 6px; border-bottom: 2px solid #1b2d55; padding-bottom: 3px; text-transform: uppercase; letter-spacing: .04em; }
    .sub { color: #64748b; margin: 0 0 16px; }
    .meta { display: flex; flex-wrap: wrap; gap: 16px; margin: 8px 0 4px; color: #334155; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-size: 11px; }
    .muted { color: #94a3b8; }
    .foot { margin-top: 28px; color: #94a3b8; font-size: 10px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    @media print { body { margin: 14mm; } }
  </style></head><body>${bodyHtml}
  <div class="foot">SIOMAC HSE · generated ${esc(new Date().toLocaleString())}</div>
  </body></html>`;
}

function launch(html: string): void {
  const w = window.open('', '_blank');
  if (!w) { void dialog.error('Pop-up blocked', 'Allow pop-ups to export the PDF.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

// ── JSA ─────────────────────────────────────────────────────────────────────

export function exportJsaPdf(jsa: Dict, detail: Dict | undefined): void {
  const steps    = (detail?.steps    as Dict[]) ?? [];
  const ppe      = (detail?.ppe      as Dict[]) ?? [];
  const training = (detail?.training as Dict[]) ?? [];
  const crew     = (detail?.crew     as Dict[]) ?? [];

  const body = `
    <h1>${esc(jsa.title)}</h1>
    <p class="sub">Job Safety Analysis · ${esc(jsa.ref)}</p>
    <div class="meta">
      <span><strong>Status:</strong> ${esc(String(jsa.status).replace(/_/g, ' '))}</span>
      <span><strong>Risk:</strong> ${esc(jsa.risk_level)}</span>
      <span><strong>Site:</strong> ${esc(jsa.site_id ?? jsa.location_text ?? '—')}</span>
      <span><strong>Review due:</strong> ${fmtDate(jsa.review_due_at)}</span>
    </div>

    <h2>Job Steps</h2>
    ${table(['#', 'Task step', 'Hazards & controls', 'Initial'],
      steps.flatMap(s => {
        const hz = (s.hazards as Dict[]) ?? [];
        if (hz.length === 0) {
          return [[esc(s.step_number), esc(s.task_step),
            `${esc(s.hazard_description ?? '—')}${s.controls_summary ? `<br><span class="muted">Controls: ${esc(s.controls_summary)}</span>` : ''}`,
            band(s.initial_score)]];
        }
        return hz.map((h, i) => [
          i === 0 ? esc(s.step_number) : '', i === 0 ? esc(s.task_step) : '',
          `${esc(h.description)}${((h.controls as Dict[]) ?? []).length
            ? `<br><span class="muted">Controls: ${((h.controls as Dict[]) ?? []).map(c => esc(c.description)).join('; ')}</span>` : ''}`,
          band(h.initial_score),
        ]);
      }))}

    <h2>PPE</h2>
    ${table(['Item', 'Required', 'Notes'], ppe.map(p => [esc(p.ppe_item), p.required ? 'Yes' : 'No', esc(p.notes ?? '—')]))}

    <h2>Training & Competency</h2>
    ${table(['Requirement', 'Certification', 'Competency verified'],
      training.map(t => [esc(t.requirement_description), t.certification_required ? 'Yes' : 'No', t.competency_verification ? 'Yes' : 'No']))}

    <h2>Crew Acknowledgement</h2>
    ${table(['Name', 'Role', 'Required', 'Competency', 'Acknowledged'],
      crew.map(m => [esc(m.crew_name), esc(m.role_title ?? '—'), m.required ? 'Yes' : 'No',
        m.competency_verified ? 'Verified' : 'Unverified', m.acknowledged ? fmtDate(m.acknowledged_at) : 'No']))}
  `;
  launch(shell(`JSA ${String(jsa.ref)}`, '', body));
}

// ── Risk Assessment ─────────────────────────────────────────────────────────

export function exportAssessmentPdf(ra: Dict, detail: Dict | undefined): void {
  const hazards  = (detail?.hazards  as Dict[]) ?? [];
  const controls = (detail?.controls as Dict[]) ?? [];

  const body = `
    <h1>${esc(ra.title)}</h1>
    <p class="sub">Risk Assessment · ${esc(ra.ref)}</p>
    <div class="meta">
      <span><strong>Type:</strong> ${esc(ra.assessment_type)}</span>
      <span><strong>Status:</strong> ${esc(String(ra.status).replace(/_/g, ' '))}</span>
      <span><strong>Risk:</strong> ${esc(ra.risk_level)}</span>
      <span><strong>Site:</strong> ${esc(ra.site_id ?? ra.location_text ?? '—')}</span>
      <span><strong>Review due:</strong> ${fmtDate(ra.review_due_at)}</span>
    </div>

    <h2>Hazards</h2>
    ${table(['Hazard', 'Category', 'Initial', 'Residual', 'Notes'],
      hazards.map(h => [
        esc(h.hazard_description ?? '—'), esc(h.category ?? '—'),
        band(h.initial_score), band(h.residual_score), esc(h.notes ?? '—'),
      ]))}

    <h2>Controls</h2>
    ${table(['Control', 'Type', 'Status', 'Effectiveness'],
      controls.map(c => [esc(c.description), esc(c.control_type), esc(c.status), esc(c.effectiveness ?? '—')]))}
  `;
  launch(shell(`RA ${String(ra.ref)}`, '', body));
}
