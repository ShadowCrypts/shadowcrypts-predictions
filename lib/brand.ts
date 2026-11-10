export const BRAND = {
  name: 'ShadowCrypts Predictions',
  shortName: 'ShadowCrypts',
  tagline: 'Win probabilities for every NFL, NBA, MLB and NHL game, graded in public.',
  description:
    'ShadowCrypts Predictions: win probabilities, power rankings and an open track record for every NFL, NBA, MLB and NHL game, anchored on the betting market.',
  themeColor: '#08070e'
};

/**
 * The mark: a hooded seer whose face opening is a crypt archway, with two eyes
 * glowing in the dark. The drawing (its shapes and colors) is ShadowCrypt
 * artwork, all rights reserved, not covered by the code's MIT license: see
 * ARTWORK.md. Forks draw their own here. The single source for the header, footer, favicon, app
 * icons and link previews. `rounded: false` is full-bleed (iOS rounds it
 * itself); `bleed` also shrinks the art into the central 80%, the
 * maskable-icon safe zone.
 */
export function brandMarkSvg(size: number, { rounded = true, bleed = false }: { rounded?: boolean; bleed?: boolean } = {}) {
  const box = bleed ? '-8 -8 80 80' : '0 0 64 64';
  const tile = bleed ? 'x="-8" y="-8" width="80" height="80"' : `width="64" height="64" rx="${rounded ? 15 : 0}"`;
  const rim = rounded && !bleed ? '<rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.25" fill="none" stroke="#8b5cf6" stroke-opacity="0.35" stroke-width="1.5"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${box}">
<defs>
<linearGradient id="sc-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c1236"/><stop offset="1" stop-color="#06040c"/></linearGradient>
<linearGradient id="sc-cloak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="0.45" stop-color="#7c3aed"/><stop offset="1" stop-color="#2e1065"/></linearGradient>
<radialGradient id="sc-void" cx="0.5" cy="0.35" r="0.75"><stop offset="0" stop-color="#140b2b"/><stop offset="1" stop-color="#030208"/></radialGradient>
<radialGradient id="sc-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#67e8f9" stop-opacity="0.55"/><stop offset="1" stop-color="#67e8f9" stop-opacity="0"/></radialGradient>
<clipPath id="sc-clip"><rect ${tile}/></clipPath>
</defs>
<rect ${tile} fill="url(#sc-bg)"/>
<g clip-path="url(#sc-clip)">
<path d="M32 6C23 12 14.5 22 14.5 36C14.5 43 11 50 4 57V90H60V57C53 50 49.5 43 49.5 36C49.5 22 41 12 32 6Z" fill="url(#sc-cloak)"/>
<path d="M32.2 7.2C24.6 12.6 16.2 22 15.8 35.5" fill="none" stroke="#ede9fe" stroke-opacity="0.55" stroke-width="1.3" stroke-linecap="round"/>
<path d="M13.5 50.5C17.5 55 19.5 60 20.5 68M50.5 50.5C46.5 55 44.5 60 43.5 68" fill="none" stroke="#1e0b4a" stroke-opacity="0.55" stroke-width="1.4" stroke-linecap="round"/>
<path d="M18.6 51V35A16.4 16.4 0 0 1 32 14.6A16.4 16.4 0 0 1 45.4 35V51C39 55 25 55 18.6 51Z" fill="#2a0e63" fill-opacity="0.8"/>
<path d="M21 49V35A14 14 0 0 1 32 17.5A14 14 0 0 1 43 35V49C38 52.5 26 52.5 21 49Z" fill="url(#sc-void)"/>
<ellipse cx="32" cy="35" rx="12" ry="6" fill="url(#sc-glow)"/>
<path d="M23.8 32.8L30.2 34.7L25 36.3Z" fill="#a5f3fc"/>
<path d="M40.2 32.8L33.8 34.7L39 36.3Z" fill="#a5f3fc"/>
</g>
${rim}
</svg>`;
}

/** Short fingerprint of the mark, appended to icon URLs so a redesign busts browser caches. */
export function brandMarkVersion() {
  const svg = brandMarkSvg(64);
  let hash = 0;
  for (let i = 0; i < svg.length; i += 1) hash = (Math.imul(31, hash) + svg.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/** btoa rather than Buffer so it also runs on the edge runtime the icon routes use. */
export function brandMarkDataUri(size: number, options?: Parameters<typeof brandMarkSvg>[1]) {
  return `data:image/svg+xml;base64,${btoa(brandMarkSvg(size, options))}`;
}
