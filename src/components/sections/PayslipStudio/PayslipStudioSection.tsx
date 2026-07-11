/**
 * src/components/sections/PayslipStudio/PayslipStudioSection.tsx
 *
 * Payslip Studio embedded as an ERP section. The whole studio (ported verbatim
 * from payslip-designer/) renders under a single `.payslip-studio-root` wrapper
 * so its scoped styles cannot leak into the ERP shell. Storage is the API-backed
 * template store (lib/store) so saved layouts persist to
 * `payroll_payslip_templates` via the finance routes. Rendered from BOTH the
 * Access Control router (superadmin) and the Finance router (payroll managers) —
 * one component, two entry points.
 */

import { type VNode } from 'preact';
import { useEffect } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import './styles/app.css';

// Code-split the studio (large) so opening the designer shows a loading page
// while its chunk + fonts load, and the Finance/AC bundles stay lean.
const PayslipStudioApp = lazy(() => import('@payslip/App').then(m => ({ default: m.App })));

function StudioLoading(): VNode {
  return (
    <div class="psd-loading">
      <div class="psd-spinner" aria-hidden="true" />
      <p>Loading Payslip Studio…</p>
    </div>
  );
}

const FONTS_ID = 'payslip-studio-fonts';
// The six typefaces the studio's font picker offers. Loaded lazily (only when the
// studio is opened) so no ERP page pays for them up front.
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900' +
  '&family=Manrope:wght@400;500;600;700;800' +
  '&family=Sora:wght@400;500;600;700;800' +
  '&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700' +
  '&family=IBM+Plex+Mono:wght@400;500;600;700' +
  '&family=Space+Grotesk:wght@400;500;600;700&display=swap';

function ensureStudioFonts(): void {
  if (typeof document === 'undefined' || document.getElementById(FONTS_ID)) return;
  const link = document.createElement('link');
  link.id = FONTS_ID;
  link.rel = 'stylesheet';
  link.href = FONTS_HREF;
  document.head.appendChild(link);
}

/** `onBack` exits the full-page studio (parent navigates back to its module). */
export function PayslipStudioSection({ onBack }: { onBack?: () => void }): VNode {
  useEffect(() => { ensureStudioFonts(); }, []);
  return (
    <div class="payslip-studio-root">
      <Suspense fallback={<StudioLoading />}>
        <PayslipStudioApp onBack={onBack} />
      </Suspense>
    </div>
  );
}
