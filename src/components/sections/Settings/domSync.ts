/**
 * src/components/sections/Settings/domSync.ts
 *
 * Applies company name / logo to legacy DOM nodes that remain outside the
 * Preact tree (sidebar brand, login logo, About header).
 *
 * Called after a successful save so the sidebar and login screen update
 * immediately without a full page reload.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export function applyCompanyNameToDom(name: string): void {
  const safe = name?.trim() ? name.trim() : 'My Company';
  const sb = document.getElementById('companyName');
  const ab = document.getElementById('aboutCompanyName');
  if (sb) sb.textContent = safe;
  if (ab) ab.textContent = safe;
}

export function applyCompanyLogoToDom(url: string): void {
  // Login screen logo — only the configured company logo, never a hardcoded asset.
  const loginLogo = document.getElementById('loginLogo') as HTMLImageElement | null;
  if (loginLogo) {
    if (url) {
      loginLogo.src            = url;
      loginLogo.style.display  = '';
      loginLogo.style.borderRadius = '';
    } else {
      loginLogo.removeAttribute('src');
      loginLogo.style.display  = 'none';
    }
  }

  // About section logo
  const aboutLogo     = document.getElementById('aboutLogo') as HTMLImageElement | null;
  const aboutFallback = document.getElementById('aboutLogoFallback') as HTMLElement | null;
  if (aboutLogo) {
    if (url) {
      aboutLogo.src            = url;
      aboutLogo.style.display  = 'block';
      if (aboutFallback) aboutFallback.style.display = 'none';
    } else {
      aboutLogo.style.display  = 'none';
      if (aboutFallback) aboutFallback.style.display = '';
    }
  }

  // Sidebar brand
  const brand = document.querySelector<HTMLElement>('.sidebar-brand');
  if (!brand) return;
  const icon      = brand.querySelector<HTMLElement>('i');
  const nameSpan  = brand.querySelector<HTMLElement>('#companyName');
  const existImg  = brand.querySelector<HTMLImageElement>('img.sb-brand-img');

  if (url) {
    if (icon)     icon.style.display     = 'none';
    if (nameSpan) nameSpan.style.display = 'none';
    const img = existImg ?? document.createElement('img');
    img.className = 'sb-brand-img';
    img.alt       = 'Logo';
    img.style.cssText = 'height:72px;max-width:180px;width:auto;object-fit:contain;display:block;';
    img.src = url;
    if (!existImg) brand.insertBefore(img, brand.firstChild);
  } else {
    if (icon)     icon.style.display     = '';
    if (nameSpan) nameSpan.style.display = '';
    existImg?.remove();
  }
}
