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
import { useEffect, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { StudioMark } from '@payslip/components/StudioMark';
import './styles/app.css';

// The loading screen is shown for at least this long so the boot sequence is
// actually seen (the chunk usually resolves faster). Progress + resource lines
// are paced to the same window.
const MIN_LOAD_MS = 2400;
const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

// Code-split the studio (large) so opening the designer shows the loading page
// while its chunk + fonts load, and the Finance/AC bundles stay lean. The MIN
// delay keeps the boot sequence on screen even when the import is instant.
const PayslipStudioApp = lazy(() =>
  Promise.all([import('@payslip/App'), delay(MIN_LOAD_MS)]).then(([m]) => ({ default: m.App })),
);

// Technical-sounding resources, revealed in step with the progress bar.
const RESOURCES = [
  'Loading typefaces · Inter, Manrope, Sora…',
  'Initialising canvas renderer…',
  'Mounting element inspector…',
  'Restoring autosaved session…',
  'Compiling token resolver…',
  'Warming the template store…',
  'Calibrating grid & snap guides…',
  'Finalising workspace…',
];

function StudioLoading(): VNode {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / MIN_LOAD_MS);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic — quick then settles
      setPct(Math.round(eased * 100));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const resource = RESOURCES[Math.min(RESOURCES.length - 1, Math.floor((pct / 100) * RESOURCES.length))];

  return (
    <div class="psd-loading">
      <div class="psd-load-card">
        <div class="psd-load-logo">
          <span class="psd-load-badge"><StudioMark class="psd-load-mark" /></span>
          <span class="psd-load-title">Payslip <b>Studio</b></span>
        </div>
        <div class="psd-load-bar"><div class="psd-load-fill" style={{ width: pct + '%' }} /></div>
        <div class="psd-load-meta">
          <span class="psd-load-res">{resource}</span>
          <span class="psd-load-pct">{pct}%</span>
        </div>
      </div>
      <div class="psd-load-brand">Powered by <b>Siomac</b></div>
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
