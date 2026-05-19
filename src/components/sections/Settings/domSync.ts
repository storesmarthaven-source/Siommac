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
  const safe = name && String(name).trim() ? String(name).trim() : 'My Company';
  const sb = document.getElementById('companyName');
  const ab = document.getElementById('aboutCompanyName');
  if (sb) sb.textContent = safe;
  if (ab) ab.textContent = safe;
}

export function applyCompanyLogoToDom(url: string): void {
  // Login screen logo
  const loginLogo = document.getElementById('loginLogo') as HTMLImageElement | null;
  if (loginLogo) {
    loginLogo.src            = url || 'assets/images/logo.png';
    loginLogo.style.display  = '';
    loginLogo.style.borderRadius = '';
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
  const brand = document.querySelector('.sidebar-brand') as HTMLElement | null;
  if (!brand) return;
  const icon      = brand.querySelector('i') as HTMLElement | null;
  const nameSpan  = brand.querySelector('#companyName') as HTMLElement | null;
  const existImg  = brand.querySelector('img.sb-brand-img') as HTMLImageElement | null;

  if (url) {
    if (icon)     icon.style.display     = 'none';
    if (nameSpan) nameSpan.style.display = 'none';
    const img = existImg ?? document.createElement('img') as HTMLImageElement;
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
