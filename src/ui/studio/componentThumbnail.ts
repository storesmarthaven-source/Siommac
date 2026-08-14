import { type ComponentCategory } from '../registry';

const line = '#dfe2e7';
const ink = '#344054';
const navy = '#1f3158';
const red = '#d92d20';

function field(y: number, width = 174): string {
  return `<rect x="93" y="${y}" width="${width}" height="28" rx="6" fill="#fff" stroke="${line}"/><rect x="104" y="${y + 10}" width="72" height="7" rx="3.5" fill="#cdd2d9"/>`;
}

function artFor(id: string, category: ComponentCategory | 'family' | 'planned'): string {
  if (category === 'planned') return `<rect x="116" y="66" width="128" height="54" rx="10" fill="#fff" stroke="${line}" stroke-dasharray="5 5"/><path d="M164 93h32M180 77v32" stroke="#b8bec7" stroke-width="2" stroke-linecap="round"/>`;
  if (id === 'buttons' || id === 'button') return `<rect x="101" y="76" width="72" height="34" rx="7" fill="#fff" stroke="#cfd4db"/><rect x="181" y="76" width="78" height="34" rx="7" fill="${navy}"/><rect x="116" y="89" width="42" height="7" rx="3.5" fill="#667085"/><rect x="198" y="89" width="44" height="7" rx="3.5" fill="#fff"/>`;
  if (id === 'segmented-control') return `<rect x="91" y="76" width="178" height="36" rx="9" fill="#fff" stroke="${line}"/><rect x="95" y="80" width="55" height="28" rx="6" fill="${navy}"/><circle cx="111" cy="94" r="4" fill="#fff"/><path d="M162 91h22M207 91h22" stroke="#98a2b3" stroke-width="6" stroke-linecap="round"/>`;
  if (['menu', 'dropdown-button', 'split-button'].includes(id)) return `<rect x="105" y="46" width="150" height="34" rx="7" fill="${navy}"/><path d="M226 46v34M236 59l5 5 5-5" stroke="#fff" stroke-width="1.6" fill="none"/><rect x="126" y="59" width="72" height="7" rx="3.5" fill="#fff"/><rect x="129" y="89" width="126" height="67" rx="8" fill="#fff" stroke="${line}"/><circle cx="145" cy="107" r="4" fill="#c9cfd7"/><circle cx="145" cy="126" r="4" fill="#c9cfd7"/><circle cx="145" cy="145" r="4" fill="#c9cfd7"/><path d="M157 107h68M157 126h52M157 145h61" stroke="#98a2b3" stroke-width="6" stroke-linecap="round"/>`;
  if (['text-input', 'date-input', 'select'].includes(id)) return `<rect x="93" y="52" width="76" height="7" rx="3.5" fill="#667085"/>${field(70)}<rect x="93" y="108" width="98" height="7" rx="3.5" fill="#667085"/>${field(126)}${id === 'date-input' ? '<rect x="244" y="78" width="12" height="12" rx="2" fill="#c7ccd4"/>' : ''}`;
  if (id === 'file-input') return `<rect x="82" y="45" width="196" height="105" rx="10" fill="#fff" stroke="${line}" stroke-dasharray="5 4"/><path d="M180 69v37m0-37-13 13m13-13 13 13" stroke="${navy}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="130" y="119" width="100" height="7" rx="3.5" fill="#98a2b3"/><rect x="149" y="134" width="62" height="5" rx="2.5" fill="#d0d5dd"/>`;
  if (id === 'otp-input') return [0, 1, 2, 3, 4, 5].map((n) => `<rect x="${74 + n * 37}" y="75" width="30" height="38" rx="6" fill="#fff" stroke="${n === 0 ? navy : line}"/><circle cx="${89 + n * 37}" cy="94" r="3.5" fill="${n < 3 ? ink : '#d0d5dd'}"/>`).join('');
  if (['checkbox', 'radio-group', 'switch'].includes(id)) {
    const control = id === 'switch'
      ? '<rect x="94" y="66" width="34" height="20" rx="10" fill="#d0d5dd"/><circle cx="105" cy="76" r="7" fill="#fff"/><rect x="94" y="100" width="34" height="20" rx="10" fill="#344f7c"/><circle cx="117" cy="110" r="7" fill="#fff"/>'
      : id === 'radio-group'
        ? '<circle cx="106" cy="76" r="10" fill="#fff" stroke="#c7ccd4"/><circle cx="106" cy="110" r="10" fill="#fff" stroke="#344f7c"/><circle cx="106" cy="110" r="5" fill="#344f7c"/>'
        : '<rect x="96" y="66" width="20" height="20" rx="5" fill="#fff" stroke="#c7ccd4"/><rect x="96" y="100" width="20" height="20" rx="5" fill="#344f7c"/><path d="m101 110 4 4 7-9" stroke="#fff" stroke-width="2" fill="none"/>';
    return `${control}<path d="M141 76h102M141 110h76" stroke="#98a2b3" stroke-width="7" stroke-linecap="round"/>`;
  }
  if (['avatar', 'avatar-group', 'person-search-select'].includes(id)) return `<circle cx="${id === 'avatar' ? 180 : 145}" cy="88" r="30" fill="#e6e9ee" stroke="#fff" stroke-width="4"/><circle cx="${id === 'avatar' ? 180 : 145}" cy="80" r="9" fill="#98a2b3"/><path d="M${id === 'avatar' ? 162 : 127} 105c5-14 31-14 36 0" fill="#98a2b3"/>${id !== 'avatar' ? '<circle cx="181" cy="88" r="30" fill="#e9e4dc" stroke="#fff" stroke-width="4"/><circle cx="217" cy="88" r="30" fill="#e1e7e3" stroke="#fff" stroke-width="4"/><circle cx="247" cy="88" r="18" fill="#fff" stroke="#d7dbe1"/><path d="M241 88h12M247 82v12" stroke="#98a2b3" stroke-width="2"/>' : '<circle cx="202" cy="111" r="7" fill="#32a36c" stroke="#fff" stroke-width="3"/>'}`;
  if (['dialog', 'drawer', 'popover', 'tooltip'].includes(id)) {
    if (id === 'drawer') return `<rect x="72" y="39" width="216" height="116" rx="8" fill="#eef0f3"/><rect x="177" y="39" width="111" height="116" rx="8" fill="#fff" stroke="${line}"/><path d="M194 61h54M194 81h72M194 96h58" stroke="#a8afb9" stroke-width="7" stroke-linecap="round"/><rect x="194" y="120" width="70" height="22" rx="5" fill="${navy}"/>`;
    if (id === 'tooltip') return `<rect x="128" y="65" width="104" height="43" rx="8" fill="${ink}"/><path d="m174 108 6 8 6-8" fill="${ink}"/><path d="M146 82h68M158 95h44" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`;
    return `<rect x="72" y="40" width="216" height="115" rx="10" fill="#eef0f3"/><rect x="111" y="56" width="138" height="84" rx="9" fill="#fff" stroke="${line}"/><rect x="129" y="74" width="70" height="8" rx="4" fill="${ink}"/><path d="M129 94h101M129 108h74" stroke="#c2c7ce" stroke-width="6" stroke-linecap="round"/><rect x="186" y="119" width="44" height="12" rx="4" fill="${navy}"/>`;
  }
  if (id === 'data-table') return `<rect x="69" y="46" width="222" height="106" rx="8" fill="#fff" stroke="${line}"/><rect x="69" y="46" width="222" height="27" rx="8" fill="#f3f4f6"/><path d="M69 73h222M69 99h222M69 125h222M123 46v106M234 46v106" stroke="${line}"/><path d="M82 59h25M137 59h43M247 59h26M82 86h27M137 86h62M247 86h21M82 112h20M137 112h51M247 112h24M82 138h30M137 138h71M247 138h18" stroke="#9ea5af" stroke-width="5" stroke-linecap="round"/>`;
  if (id === 'badge') return `<rect x="93" y="68" width="76" height="25" rx="12.5" fill="#ecfdf3" stroke="#b7e6c7"/><circle cx="108" cy="80.5" r="4" fill="#2f9c64"/><rect x="117" y="77" width="39" height="7" rx="3.5" fill="#287a52"/><rect x="181" y="99" width="86" height="25" rx="12.5" fill="#fef3f2" stroke="#f5c0bb"/><circle cx="196" cy="111.5" r="4" fill="${red}"/><rect x="205" y="108" width="47" height="7" rx="3.5" fill="#a63a31"/>`;
  if (['tabs', 'breadcrumbs', 'wizard', 'page-header', 'page-action-bar'].includes(id)) {
    if (id === 'wizard') return `<path d="M94 92h172" stroke="#d2d6dc" stroke-width="3"/><circle cx="98" cy="92" r="13" fill="${navy}"/><path d="m92 92 4 4 8-9" stroke="#fff" stroke-width="2" fill="none"/><circle cx="180" cy="92" r="13" fill="#fff" stroke="${navy}" stroke-width="2"/><circle cx="262" cy="92" r="13" fill="#fff" stroke="#c8cdd4" stroke-width="2"/><path d="M79 121h38M162 121h37M244 121h37" stroke="#98a2b3" stroke-width="6" stroke-linecap="round"/>`;
    if (id === 'page-header' || id === 'page-action-bar') return `<path d="M80 62h91M80 84h142" stroke="${ink}" stroke-width="9" stroke-linecap="round"/><path d="M80 105h112" stroke="#a5acb6" stroke-width="6" stroke-linecap="round"/><rect x="221" y="74" width="60" height="30" rx="6" fill="${navy}"/>`;
    return `<path d="M80 72h42m18 0h54m18 0h67" stroke="#98a2b3" stroke-width="7" stroke-linecap="round"/><path d="M80 93h202" stroke="#d8dce2"/><path d="M80 92h54" stroke="${navy}" stroke-width="3"/><rect x="80" y="112" width="163" height="7" rx="3.5" fill="#d0d5dd"/>`;
  }
  if (id === 'alert') return `<rect x="78" y="61" width="204" height="70" rx="9" fill="#fffaeb" stroke="#f5d889"/><circle cx="101" cy="83" r="10" fill="#f0b429"/><path d="M101 77v8m0 4h.01" stroke="#fff" stroke-width="2"/><path d="M122 78h92M122 96h138M122 111h91" stroke="#9a7b31" stroke-width="6" stroke-linecap="round"/>`;
  if (id === 'progress' || id === 'spinner') return id === 'spinner'
    ? `<circle cx="180" cy="94" r="30" fill="none" stroke="#e1e4e8" stroke-width="8"/><path d="M180 64a30 30 0 0 1 26 15" fill="none" stroke="${navy}" stroke-width="8" stroke-linecap="round"/>`
    : `<rect x="78" y="82" width="204" height="13" rx="6.5" fill="#e3e6ea"/><rect x="78" y="82" width="132" height="13" rx="6.5" fill="${navy}"/><path d="M78 65h82M249 65h33" stroke="#7f8792" stroke-width="7" stroke-linecap="round"/>`;
  if (id === 'skeleton') return `<rect x="85" y="51" width="42" height="42" rx="21" fill="#e5e7eb"/><rect x="141" y="55" width="120" height="10" rx="5" fill="#e5e7eb"/><rect x="141" y="73" width="81" height="8" rx="4" fill="#eceef0"/><rect x="85" y="108" width="190" height="9" rx="4.5" fill="#e5e7eb"/><rect x="85" y="126" width="151" height="9" rx="4.5" fill="#eceef0"/>`;
  if (id === 'card' || id === 'accordion') return id === 'accordion'
    ? `<rect x="84" y="48" width="192" height="99" rx="8" fill="#fff" stroke="${line}"/><path d="M84 81h192M84 114h192" stroke="${line}"/><path d="M101 64h91M101 97h112M101 130h77" stroke="#9ba2ac" stroke-width="7" stroke-linecap="round"/><path d="m252 61 5 5 5-5m-10 33 5 5 5-5m-10 33 5 5 5-5" stroke="#7e8792" stroke-width="1.8" fill="none"/>`
    : `<rect x="91" y="45" width="178" height="106" rx="10" fill="#fff" stroke="${line}"/><rect x="91" y="45" width="178" height="43" rx="10" fill="#f4f5f6"/><circle cx="116" cy="67" r="10" fill="#d3d7dd"/><path d="M138 64h75M138 76h48M109 108h133M109 125h94" stroke="#9da4ae" stroke-width="7" stroke-linecap="round"/><rect x="208" y="133" width="43" height="10" rx="4" fill="${navy}"/>`;
  return `<rect x="104" y="53" width="152" height="88" rx="10" fill="#fff" stroke="${line}"/><circle cx="129" cy="78" r="11" fill="#e1e4e8"/><path d="M151 74h73M151 88h52M121 112h118M121 127h86" stroke="#a0a7b1" stroke-width="7" stroke-linecap="round"/>`;
}

/** Static catalogue artwork. Editors continue to render the real component. */
export function componentThumbnailSrc(id: string, category: ComponentCategory | 'family', built = true): string {
  const artwork = artFor(id, built ? category : 'planned');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 184"><defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#e8eaed"/></pattern></defs><rect width="360" height="184" fill="#fff"/><rect width="360" height="184" fill="url(#dots)"/><path d="M54 92h252M180 24v136" stroke="#f0f1f2"/><circle cx="54" cy="92" r="14" fill="none" stroke="#f0f1f2"/><circle cx="306" cy="92" r="14" fill="none" stroke="#f0f1f2"/><rect x="50" y="20" width="260" height="144" rx="14" fill="#f6f7f8" fill-opacity=".2" stroke="#f0f1f2"/>${artwork}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
