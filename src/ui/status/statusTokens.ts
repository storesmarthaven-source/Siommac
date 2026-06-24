/**
 * src/ui/status/statusTokens.ts
 *
 * SINGLE SOURCE OF TRUTH for status → visual tone across the whole ERP.
 *
 * Before this file, five separate functions each re-encoded the same idea
 * ("overdue is red, pending is amber, closed is green") with slightly different
 * keyword lists:
 *   - hsePill()        (HSE/types.ts)        keyword-matched free-text status
 *   - ppePillClass()   (HSE/types.ts)        enum PPE status
 *   - incidentPill()   (HSE/Incidents.tsx)   hsePill + danger-severity override
 *   - statusPill()     (workflow/tone.ts)    enum WorkflowStatus
 *   - priorityPill()   (workflow/tone.ts)    enum Priority
 *
 * They now all delegate here. To change how a status looks app-wide, change it
 * in ONE place: the `TONE` table below, or the keyword/enum maps.
 *
 * `tone` is the semantic vocabulary every surface speaks:
 *   positive  → on track / done / compliant      (green  .vt-pill.is-on)
 *   caution   → needs attention soon / pending    (amber  .vt-pill.is-warn)
 *   negative  → off / inactive / expired / overdue (slate  .vt-pill.is-off)
 *   critical  → urgent, hard-stop                  (red    .vt-pill.is-critical)
 *   info      → neutral informational / draft      (navy   .vt-pill.is-info)
 *   neutral   → muted, no state                    (slate  .vt-pill.is-off)
 *
 * NOTE: `.is-off` renders SLATE GREY, not red — it is the "off / inactive"
 * tone. True red is `.is-critical`. This mirrors the existing CSS in
 * assets/styles/components.css and HSE.css; it is intentionally preserved.
 */

export type Tone = 'positive' | 'caution' | 'negative' | 'critical' | 'info' | 'neutral';

interface ToneVisual {
  /** Full className for a status chip. */
  pillClass: string;
  /** Solid status colour token (for dots, left-accents, text). */
  color: string;
  /** Soft same-family fill token (icon circles, chip backgrounds). */
  tint: string;
}

/** The visual contract for each semantic tone. Edit here to restyle app-wide. */
export const TONE: Record<Tone, ToneVisual> = {
  positive: { pillClass: 'vt-pill is-on',       color: 'var(--st-success)', tint: 'var(--st-success-tint)' },
  caution:  { pillClass: 'vt-pill is-warn',     color: 'var(--st-warning)', tint: 'var(--st-warning-tint)' },
  negative: { pillClass: 'vt-pill is-off',      color: 'var(--st-neutral)', tint: 'var(--st-neutral-tint)' },
  critical: { pillClass: 'vt-pill is-critical', color: 'var(--st-danger)',  tint: 'var(--st-danger-tint)'  },
  info:     { pillClass: 'vt-pill is-info',     color: 'var(--siomac-navy)',tint: 'var(--st-info-tint)'    },
  neutral:  { pillClass: 'vt-pill is-off',      color: 'var(--st-neutral)', tint: 'var(--st-neutral-tint)' },
};

/** Tone → status chip className. */
export function toneClass(tone: Tone): string {
  return TONE[tone].pillClass;
}
/** Tone → solid colour token. */
export function toneColor(tone: Tone): string {
  return TONE[tone].color;
}
/** Tone → soft tint token. */
export function toneTint(tone: Tone): string {
  return TONE[tone].tint;
}

/* ── Free-text status → tone ──────────────────────────────────────────────────
   Keyword matching, used by HSE's free-text statuses. Order matters: the first
   matching family wins. This is the union of the hsePill() keyword list. */
export function toneFromText(text: string | null | undefined): Tone {
  const t = (text ?? '').toLowerCase();
  if (/critical|blocked|overdue|stopped/.test(t)) return 'negative';
  if (/hold|pending|due|high|review/.test(t))     return 'caution';
  if (/live|ready|complete|open/.test(t))         return 'positive';
  return 'info';
}

/* ── PPE enum status → tone ───────────────────────────────────────────────────
   Faithful to ppePillClass(). */
export function toneFromPpeStatus(status: string): Tone {
  switch (status) {
    case 'available':
    case 'compliant':
    case 'active':
    case 'current':
    case 'pass':
    case 'ready':    return 'positive';
    case 'low':
    case 'upcoming':
    case 'pending':
    case 'review':
    case 'due':      return 'caution';
    case 'expired':
    case 'overdue':
    case 'missing':
    case 'fail':
    case 'urgent':   return 'negative';
    default:         return 'info';
  }
}

/* ── Workflow enum status → tone ──────────────────────────────────────────────
   Faithful to statusPill(). Accepts the WorkflowStatus string union. */
export function toneFromWorkflowStatus(status: string): Tone {
  switch (status) {
    case 'approved':
    case 'closed':    return 'positive';
    case 'pending':
    case 'in_review':
    case 'returned':  return 'caution';
    case 'rejected':
    case 'blocked':   return 'negative';
    case 'draft':     return 'info';
    default:          return 'info';
  }
}

/* ── Priority enum → tone ─────────────────────────────────────────────────────
   Faithful to priorityPill(). */
export function toneFromPriority(priority: string): Tone {
  switch (priority) {
    case 'critical': return 'negative';
    case 'high':     return 'caution';
    case 'normal':   return 'info';
    case 'low':      return 'positive';
    default:         return 'info';
  }
}

/* ── Severity enum → solid colour ─────────────────────────────────────────────
   Faithful to hseSeverityColor(): danger/warning/success/everything-else. */
export function colorFromSeverity(severity: string): string {
  switch (severity) {
    case 'danger':  return 'var(--st-danger)';
    case 'warning': return 'var(--st-warning-strong)';
    case 'success': return 'var(--st-success)';
    default:        return 'var(--st-info)';
  }
}

/** Title-case a snake/space status for display ("in_review" → "In Review"). */
export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
