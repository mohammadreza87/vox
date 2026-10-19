/**
 * The cloud character's shapes and colours, shared by the animated Studio
 * component and the still profile photo rendered for Telegram.
 */

import type { AgentLook } from './types';

export const PALETTE: Record<string, { base: string; light: string; shadow: string; glow: string; name: string }> = {
  apricot: { base: '#FFB38A', light: '#FFD9C2', shadow: '#E5835A', glow: '#FF9E6B', name: 'Apricot' },
  rose: { base: '#FF9DB5', light: '#FFD1DD', shadow: '#E06A8A', glow: '#FF7FA3', name: 'Rosé' },
  butter: { base: '#FFE07A', light: '#FFF1BF', shadow: '#E0B23E', glow: '#FFD84D', name: 'Butter' },
  matcha: { base: '#A8E07A', light: '#D7F5BF', shadow: '#6FB247', glow: '#9BF06A', name: 'Matcha' },
  lagoon: { base: '#6FE0D0', light: '#BFF5EE', shadow: '#34AFA0', glow: '#4FF2DC', name: 'Lagoon' },
  sky: { base: '#8CC8FF', light: '#CFE6FF', shadow: '#5294DC', glow: '#6BB8FF', name: 'Sky' },
  lilac: { base: '#C3A6FF', light: '#E6DBFF', shadow: '#8D6BDB', glow: '#B08CFF', name: 'Lilac' },
  ash: { base: '#B9BEC8', light: '#E3E6EB', shadow: '#868C99', glow: '#D5DAE3', name: 'Ash' },
};

export const FAMILIES = {
  puff: { c: [[100, 112, 52], [62, 118, 34], [138, 118, 34], [78, 82, 30], [122, 80, 34]], b: [100, 140, 70, 26], fx: 0, fy: 0 },
  tower: { c: [[100, 108, 44], [64, 128, 30], [136, 128, 30], [100, 62, 32], [128, 88, 24]], b: [100, 146, 64, 18], fx: 0, fy: -4 },
  drift: { c: [[96, 112, 48], [54, 124, 28], [146, 116, 36], [112, 74, 30], [74, 84, 22]], b: [100, 142, 72, 20], fx: -4, fy: 0 },
} as const;

/** A still, fully formed, smiling cloud on the Studio background, as SVG. */
export function cloudSvg(look: Pick<AgentLook, 'hue' | 'family' | 'features'>, size = 640): string {
  const pal = PALETTE[look.hue] ?? PALETTE.lilac;
  const fam = FAMILIES[look.family] ?? FAMILIES.puff;
  const features = look.features ?? { cheeks: true, lashes: false, brows: false };
  const { fx, fy } = fam;
  const ey = 108 + fy;
  const lobes = (fill: string) => fam.c.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`).join('')
    + `<ellipse cx="${fam.b[0]}" cy="${fam.b[1]}" rx="${fam.b[2]}" ry="${fam.b[3]}" fill="${fill}"/>`;
  const eyes = [78 + fx, 122 + fx].map((x, i) => {
    const dir = i === 0 ? -1 : 1, ox = x + dir * 5;
    return `<ellipse cx="${x}" cy="${ey}" rx="6.5" ry="9" fill="#1A1C22"/>`
      + `<circle cx="${x + 2}" cy="${ey - 3}" r="2.2" fill="#fff"/><circle cx="${x - 2}" cy="${ey + 3}" r="1" fill="#fff" opacity="0.8"/>`
      + (features.lashes ? `<path d="M${ox} ${ey - 7} l${dir * 3.5} -2.5 M${ox + dir} ${ey - 4} l${dir * 4} -1" fill="none" stroke="#1A1C22" stroke-width="2.5" stroke-linecap="round"/>` : '')
      + (features.brows ? `<path d="M${x - 5} ${93 + fy} L${x + 5} ${93 + fy + (i === 0 ? -1 : 1)}" fill="none" stroke="#1A1C22" stroke-width="3" stroke-linecap="round" opacity="0.6"/>` : '');
  }).join('');
  const cheeks = features.cheeks
    ? `<ellipse cx="${64 + fx}" cy="${122 + fy}" rx="8" ry="5" fill="${pal.shadow}" opacity="0.35"/><ellipse cx="${136 + fx}" cy="${122 + fy}" rx="8" ry="5" fill="${pal.shadow}" opacity="0.35"/>`
    : '';
  const mouth = `<path d="M${92 + fx} ${128 + fy} Q${100 + fx} ${134 + fy} ${108 + fx} ${128 + fy}" fill="none" stroke="#1A1C22" stroke-width="3.5" stroke-linecap="round"/>`;
  // Telegram crops profile photos to a circle: keep the character centred with room around it.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-20 -15 240 240">
<defs>
<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="78" cy="66" r="138"><stop offset="0" stop-color="${pal.light}"/><stop offset="0.55" stop-color="${pal.base}"/><stop offset="1" stop-color="${pal.shadow}"/></radialGradient>
<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
</defs>
<rect x="-20" y="-15" width="240" height="240" fill="#0E1013"/>
<g filter="url(#f)" opacity="0.45">${lobes(pal.glow)}</g>
${lobes('url(#g)')}${cheeks}${eyes}${mouth}
</svg>`;
}
