/** Inline SVG brand marks shipped as data-URIs so templates render with a logo. */

const svgURI = (svg: string): string =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

export const LOGOS = {
  hex: svgURI(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fab907"/><stop offset="1" stop-color="#fab907"/></linearGradient></defs><path d="M36 3l28.6 16.5v33L36 69 7.4 52.5v-33z" fill="url(#g)"/><text x="36" y="47" font-family="Inter,Arial" font-size="30" font-weight="800" fill="#fff" text-anchor="middle">S</text></svg>`,
  ),
  mono: svgURI(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="14" fill="none" stroke="#111a3a" stroke-width="3"/><text x="36" y="48" font-family="Fraunces,Georgia,serif" font-size="38" font-weight="600" fill="#111a3a" text-anchor="middle">S</text></svg>`,
  ),
  bars: svgURI(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="16" fill="#111a3a"/><rect x="18" y="38" width="8" height="18" rx="3" fill="#5b7cfa"/><rect x="32" y="28" width="8" height="28" rx="3" fill="#8aa2ff"/><rect x="46" y="18" width="8" height="38" rx="3" fill="#7be0a6"/></svg>`,
  ),
  ict: svgURI(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 210"><polygon points="110,12 205,178 15,178" fill="none" stroke="#111111" stroke-width="7"/><circle cx="110" cy="96" r="46" fill="#f2c200"/><text x="110" y="114" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="46" fill="#111111" text-anchor="middle">ict</text><text x="110" y="196" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="20" letter-spacing="1" fill="#111111" text-anchor="middle">IN-CORR-TECH</text><text x="110" y="210" font-family="Arial, Helvetica, sans-serif" font-weight="600" font-size="12" letter-spacing="4" fill="#111111" text-anchor="middle">LIMITED</text></svg>`,
  ),
  siomac: svgURI(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 130"><g font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="98"><text x="0" y="96" fill="#f5b800">SI</text><text x="212" y="96" fill="#e5231b">MAC</text></g><g transform="translate(163,60)"><g fill="#f5b800"><rect x="-8" y="-60" width="16" height="20" rx="2"/><rect x="-8" y="-60" width="16" height="20" rx="2" transform="rotate(45)"/><rect x="-8" y="-60" width="16" height="20" rx="2" transform="rotate(90)"/><rect x="-8" y="-60" width="16" height="20" rx="2" transform="rotate(135)"/><rect x="-8" y="-60" width="16" height="20" rx="2" transform="rotate(180)"/><rect x="-8" y="-60" width="16" height="20" rx="2" transform="rotate(225)"/><rect x="-8" y="-60" width="16" height="20" rx="2" transform="rotate(270)"/><rect x="-8" y="-60" width="16" height="20" rx="2" transform="rotate(315)"/><circle r="46"/></g><circle r="20" fill="#1e2a52"/></g><text x="452" y="70" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="30" fill="#ffffff">LTD.</text></svg>`,
  ),
  prolas: svgURI(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 470 152"><g font-family="Arial, Helvetica, sans-serif" font-weight="900" fill="#2e9d43"><text x="2" y="94" font-size="92">PR</text><text x="256" y="94" font-size="92">LAS</text></g><circle cx="212" cy="62" r="43" fill="#2e9d43"/><g fill="none" stroke="#fff" stroke-width="3.2"><circle cx="212" cy="62" r="43"/><ellipse cx="212" cy="62" rx="18" ry="43"/><line x1="169" y1="62" x2="255" y2="62"/><path d="M176 40q36 14 72 0M176 84q36-14 72 0"/></g><rect x="150" y="106" width="252" height="40" rx="3" fill="#1560bd"/><text x="276" y="135" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="29" fill="#fff" text-anchor="middle" letter-spacing="10">HOMES</text></svg>`,
  ),
} as const;

export type LogoKey = keyof typeof LOGOS;
