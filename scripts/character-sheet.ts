/**
 * Character contact sheets (PLAN A1): renders the v2 character library to PNG
 * via sharp, for visual review in reports/character/.
 *
 *   node --import tsx scripts/character-sheet.ts   # every sheet (npx tsx where the launcher is allowed)
 *   node --import tsx scripts/character-sheet.ts hair gallery
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import {
  ACCESSORIES, FAMILY_IDS, GROUND_COLOR, HAIR_STYLES, PRESET_LOOKS, SPECIES, characterModel, characterSvg, isCompatible, modelToSvg, rootTransform,
  type Expression,
} from '../src/lib/studio/character';
import { HUES, type Accessory, type AccentColor, type CharacterLook, type CloudSpecies, type HairStyle, type HairTone, type Stage } from '../src/lib/studio/types';

const OUT = path.resolve(__dirname, '../reports/character');
/** The product lead's favourite AI portraits: the style the vector matches (override with VOX_REF_DIR). */
const REF_DIR = process.env.VOX_REF_DIR ?? '/tmp/claude-501/voxdesign/ref';
const BG = GROUND_COLOR;
const LABEL = '#8A90A0';

interface Tile { look: CharacterLook; label?: string; stage?: Stage; expr?: Expression; mode?: 'still' | 'live'; bg?: 'none' | 'halo'; fit?: 'circle'; empty?: string }

/** One character as an inner <svg> at (x, y): every tile gets its own id prefix. */
function inner(t: Tile, x: number, y: number, size: number, uid: string, lodSize = size): string {
  if (t.empty) return `<text x="${x + size / 2}" y="${y + size / 2}" fill="#3A3F4A" font-family="Helvetica, Arial" font-size="${Math.max(10, size / 10)}" text-anchor="middle">${t.empty}</text>`;
  if (t.mode === 'live') {
    const m = characterModel(t.look, { uid, mode: 'live', stage: t.stage ?? 4, expr: t.expr, size: lodSize });
    return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 200 200" overflow="visible"><g transform="${rootTransform(m)}">${modelToSvg(m)}</g></svg>`;
  }
  const svg = characterSvg(t.look, { uid, stage: t.stage ?? 4, expr: t.expr, size: lodSize, bg: t.bg, fit: t.fit });
  return svg.replace(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+"/, `<svg x="${x}" y="${y}" width="${size}" height="${size}" overflow="visible"`);
}

interface SheetOpts { cols: number; tile: number; title: string; rowLabels?: string[]; colLabels?: string[]; labelH?: number; gap?: number }

async function sheet(file: string, tiles: Tile[], o: SheetOpts) {
  const gap = o.gap ?? 8, labelH = o.labelH ?? (tiles.some((t) => t.label) ? 18 : 0);
  const left = o.rowLabels ? 132 : 16, top = 44 + (o.colLabels ? 20 : 0);
  const rows = Math.ceil(tiles.length / o.cols);
  const W = left + o.cols * (o.tile + gap) + 8, H = top + rows * (o.tile + labelH + gap) + 12;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${BG}"/>`,
    `<text x="16" y="28" fill="#E6E8EE" font-family="Helvetica, Arial" font-size="16" font-weight="600">${o.title}</text>`];
  o.colLabels?.forEach((l, c) => parts.push(`<text x="${left + c * (o.tile + gap) + o.tile / 2}" y="${top - 8}" fill="${LABEL}" font-family="Helvetica, Arial" font-size="12" text-anchor="middle">${l}</text>`));
  tiles.forEach((t, i) => {
    const c = i % o.cols, r = Math.floor(i / o.cols);
    const x = left + c * (o.tile + gap), y = top + r * (o.tile + labelH + gap);
    parts.push(inner(t, x, y, o.tile, `t${i}x`));
    if (t.label) parts.push(`<text x="${x + o.tile / 2}" y="${y + o.tile + 13}" fill="${LABEL}" font-family="Helvetica, Arial" font-size="11" text-anchor="middle">${t.label}</text>`);
  });
  o.rowLabels?.forEach((l, r) => parts.push(`<text x="16" y="${top + r * (o.tile + labelH + gap) + o.tile / 2 + 4}" fill="${LABEL}" font-family="Helvetica, Arial" font-size="12">${l}</text>`));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, file));
  console.log(`  ${file}  ${tiles.length} tiles`);
}

// ---- looks
const base = (o: Partial<CharacterLook>): CharacterLook => ({ hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: false, brows: false }, species: 'cloud', hair: 'none', hairTone: 'deep', accessory: 'none', ...o });
const HUE_OF: Record<CloudSpecies, CharacterLook['hue']> = { cloud: 'lilac', cat: 'lagoon', dog: 'apricot', bunny: 'rose', bear: 'sky', owl: 'matcha', chick: 'butter' };
const spLabel = (l: CharacterLook) => [l.species, l.hair !== 'none' ? l.hair : '', l.accessory !== 'none' ? l.accessory : ''].filter(Boolean).join(' · ');

/** Seeded Park–Miller PRNG. */
function rng(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
export function randomLooks(count: number, seed = 7): CharacterLook[] {
  const r = rng(seed), pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const out: CharacterLook[] = [];
  while (out.length < count) {
    const accessory = r() < 0.18 ? 'none' : pick(ACCESSORIES.filter((a) => a !== 'none'));
    const l: CharacterLook = {
      hue: pick(HUES), family: pick(['puff', 'puff', 'tower', 'drift'] as const), species: pick(SPECIES),
      hair: r() < 0.28 ? 'none' : pick(HAIR_STYLES), hairTone: pick(['deep', 'deep', 'cocoa', 'ink', 'cream', 'deep', 'apricot', 'sky'] as HairTone[]),
      accessory, accent: pick(ACCENT_OPTIONS[accessory]),
      features: { cheeks: r() < 0.85, lashes: r() < 0.4, brows: r() < 0.35 },
    };
    if (isCompatible(l).ok) out.push(l);
  }
  return out;
}
const ACCENT_OPTIONS: Record<Accessory, AccentColor[]> = {
  none: ['ink'], glasses: ['ink', 'cocoa'], specs: ['ink', 'cocoa', 'navy'], beret: ['berry', 'navy', 'ink'], cap: ['navy', 'coral', 'ink'],
  beanie: ['coral', 'navy', 'cream'], headphones: ['ink', 'navy', 'cream'], headset: ['navy', 'ink'], bow: ['coral', 'berry', 'cream'],
  flower: ['cream', 'butter'], star: ['volt'], bowtie: ['navy', 'berry', 'ink'],
};

// ---- sheets
const SHEETS: Record<string, () => Promise<void>> = {
  async lineup() {
    const tiles = PRESET_LOOKS.slice(0, 7).map((look) => ({ look, label: spLabel(look) }));
    await sheet('lineup.png', tiles, { cols: 7, tile: 240, title: 'Lineup · one per species' });
  },
  async gallery() {
    // PLAN §7 acceptance: every preset plus at least 72 seeded samples
    const looks = [...PRESET_LOOKS, ...randomLooks(72)];
    await sheet('gallery.png', looks.map((look) => ({ look, label: spLabel(look) })), { cols: 12, tile: 140, title: `Gallery · ${PRESET_LOOKS.length} presets + ${looks.length - PRESET_LOOKS.length} seeded random (${looks.length} samples)` });
  },
  async 'species×family'() {
    const tiles = SPECIES.flatMap((species) => FAMILY_IDS.map((family) => ({ look: base({ species, family, hue: HUE_OF[species] }) })));
    await sheet('species×family.png', tiles, { cols: 3, tile: 190, title: 'Species × family (stage 4, no hair or accessory)', rowLabels: [...SPECIES], colLabels: [...FAMILY_IDS] });
  },
  async hair() {
    const cols: CloudSpecies[] = ['cloud', 'cat', 'dog', 'bear', 'bunny', 'owl'];
    const tones: HairTone[] = ['deep', 'cocoa', 'ink', 'cream', 'deep', 'cocoa'];
    const tiles: Tile[] = HAIR_STYLES.filter((h) => h !== 'none').flatMap((hair: HairStyle, r) => cols.map((species, c) => {
      const look = base({ species, hair, hue: HUES[(r * 3 + c) % HUES.length], hairTone: tones[(r + c) % tones.length], features: { cheeks: true, lashes: c % 2 === 0, brows: false } });
      return isCompatible(look).ok ? { look } : { look, empty: '—' };
    }));
    await sheet('hair.png', tiles, { cols: cols.length, tile: 170, title: 'Hair × species (tones vary)', rowLabels: HAIR_STYLES.filter((h) => h !== 'none'), colLabels: cols });
  },
  async combos() {
    // every hair × every head-worn accessory on the eared species and the plain cloud, so back-layer leaks and
    // hat/ear z-order show up; families rotate per row so tower and drift crowns are covered too
    const species: CloudSpecies[] = ['cat', 'bunny', 'dog', 'cloud'];
    const hats: Accessory[] = ['none', 'beret', 'cap', 'beanie', 'headphones', 'headset', 'bow', 'flower', 'star'];
    const all = HAIR_STYLES.flatMap((hair, h) => species.map((sp, s) => ({ hair, species: sp, family: FAMILY_IDS[(h + s) % 3], r: h * species.length + s })));
    const lookOf = ({ hair, species: sp, family, r }: (typeof all)[number], accessory: Accessory) =>
      base({ species: sp, family, hair, accessory, accent: undefined, hue: HUES[(r * 5 + 1) % HUES.length], hairTone: (['ink', 'deep', 'cocoa', 'cream'] as HairTone[])[r % 4] });
    // rows where no head accessory fits at all (e.g. bun on a bunny) are left out: the sheet shows real coverage
    const rows = all.filter((row) => hats.some((a) => isCompatible(lookOf(row, a)).ok));
    const tiles: Tile[] = rows.flatMap((row) => hats.map((accessory) => {
      const look = lookOf(row, accessory);
      return isCompatible(look).ok ? { look } : { look, empty: '—' };
    }));
    await sheet('combos.png', tiles, {
      cols: hats.length, tile: 112, gap: 4, title: 'Hair × head accessories on cat, bunny, dog, cloud (families rotate by row; tones rotate ink/deep/cocoa/cream)',
      rowLabels: rows.map((x) => `${x.hair} ${x.species} ${x.family[0]}`), colLabels: hats,
    });
  },
  async accessories() {
    const cols: CloudSpecies[] = ['cloud', 'cat', 'dog', 'bunny', 'bear', 'owl', 'chick'];
    const acc = ACCESSORIES.filter((a) => a !== 'none');
    const tiles: Tile[] = acc.flatMap((accessory, r) => cols.map((species, c) => {
      const look = base({ species, accessory, accent: undefined, hue: HUES[(r + c * 3) % HUES.length], family: (['puff', 'tower', 'drift'] as const)[(r + c) % 3] });
      return isCompatible(look).ok ? { look } : { look, empty: '—' };
    }));
    await sheet('accessories.png', tiles, { cols: cols.length, tile: 140, title: 'Accessories × species (families rotate)', rowLabels: acc, colLabels: cols });
  },
  async stages() {
    for (const species of SPECIES) {
      const looks = PRESET_LOOKS.filter((l) => l.species === species).slice(0, 3);
      const tiles: Tile[] = looks.flatMap((look) => ([1, 2, 3, 4] as Stage[]).map((stage) => ({ look, stage })));
      // parts are gated by stage (hair @3, accessory @4): the row label says so, so a missing layer reads as planned
      const gated = (l: CharacterLook) => [l.species, l.hair !== 'none' ? `${l.hair} @3` : '', l.accessory !== 'none' ? `${l.accessory} @4` : '', l.features.cheeks ? '' : 'no blush'].filter(Boolean).join(' · ');
      await sheet(`stages-${species}.png`, tiles, { cols: 4, tile: 180, title: `${species} · stages 1 wisp → 2 puff → 3 shaped → 4 formed`, colLabels: ['1 wisp', '2 puff', '3 shaped', '4 formed'], rowLabels: looks.map(gated) });
    }
  },
  async expressions() {
    const exprs: Expression[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sleeping'];
    const looks = [PRESET_LOOKS[0], PRESET_LOOKS[1], PRESET_LOOKS[2], PRESET_LOOKS[3], PRESET_LOOKS[5], PRESET_LOOKS[6]];
    const tiles: Tile[] = looks.flatMap((look) => exprs.map((expr) => ({ look, expr })));
    await sheet('expressions.png', tiles, { cols: exprs.length, tile: 160, title: 'Expressions (face kit; ω and beak species open the lens mouth when speaking/happy)', colLabels: exprs, rowLabels: looks.map((l) => l.species!) });
  },
  async 'small-sizes'() {
    const looks = PRESET_LOOKS.slice(0, 14);
    const sizes = [24, 32, 48, 56];
    const gap = 10, left = 56, top = 40;
    const W = left + looks.length * (56 + gap), H = top + sizes.length * (56 + gap) + 10;
    const comps: OverlayOptions[] = [];
    for (const [r, s] of sizes.entries()) for (const [c, look] of looks.entries()) {
      const png = await sharp(Buffer.from(characterSvg(look, { size: s, uid: `s${r}${c}` }))).png().toBuffer();
      comps.push({ input: png, left: left + c * (56 + gap) + (56 - s) / 2, top: top + r * (56 + gap) + (56 - s) / 2 });
    }
    const labels = `<svg width="${W}" height="${H}"><text x="12" y="24" fill="#E6E8EE" font-family="Helvetica" font-size="14" font-weight="600">Small sizes at 1× (24 / 32 / 48 / 56 px, LOD on)</text>${sizes.map((s, r) => `<text x="12" y="${top + r * 66 + 32}" fill="${LABEL}" font-family="Helvetica" font-size="12">${s}px</text>`).join('')}</svg>`;
    const img = await sharp({ create: { width: W, height: H, channels: 4, background: BG } }).composite([{ input: Buffer.from(labels), left: 0, top: 0 }, ...comps]).png().toBuffer();
    await sharp(img).toFile(path.join(OUT, 'small-sizes.png'));
    await sharp(img).resize(W * 3, H * 3, { kernel: 'nearest' }).toFile(path.join(OUT, 'small-sizes@3x.png'));
    console.log('  small-sizes.png (+@3x)');
  },
  async telegram() {
    const looks = [PRESET_LOOKS[0], PRESET_LOOKS[7], PRESET_LOOKS[1], PRESET_LOOKS[3], PRESET_LOOKS[6], PRESET_LOOKS[14], PRESET_LOOKS[22], PRESET_LOOKS[25]];
    const D = 220, gap = 14;
    const circle = Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`);
    const ring = Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2 - 1}" fill="none" stroke="#D6FF5C" stroke-opacity=".6" stroke-width="2" stroke-dasharray="6 5"/></svg>`);
    const comps: OverlayOptions[] = [];
    for (const [i, look] of looks.entries()) {
      // the photo pipeline renders at 640 and Telegram crops it to a circle
      const raw = await sharp(Buffer.from(characterSvg(look, { stage: 4, size: 640, bg: 'halo', fit: 'circle', uid: `tg${i}` }))).resize(D, D).png().toBuffer();
      const cropped = await sharp(raw).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
      comps.push({ input: await sharp(raw).composite([{ input: ring }]).png().toBuffer(), left: gap + i * (D + gap), top: 40 },
        { input: cropped, left: gap + i * (D + gap), top: 40 + D + gap });
    }
    const W = gap + looks.length * (D + gap), H = 40 + 2 * D + 2 * gap;
    const label = Buffer.from(`<svg width="${W}" height="40"><text x="${gap}" y="26" fill="#E6E8EE" font-family="Helvetica" font-size="15" font-weight="600">Telegram photo · 640 px source on the reference ground (top, crop circle dashed) and the circle crop Telegram shows (bottom)</text></svg>`);
    await sharp({ create: { width: W, height: H, channels: 4, background: '#1E2228' } }).composite([{ input: label, left: 0, top: 0 }, ...comps]).png().toFile(path.join(OUT, 'telegram.png'));
    console.log('  telegram.png');
  },
  async 'live-vs-still'() {
    const looks = PRESET_LOOKS.slice(0, 8);
    const tiles: Tile[] = looks.flatMap((look) => [{ look, label: 'still' }, { look, label: 'live (0 filters)', mode: 'live' as const }]);
    await sheet('live-vs-still.png', tiles, { cols: 8, tile: 150, title: 'Still vs live: one model, 0 filters in both, no aura' });
  },
  async 'reference-match'() {
    // each favourite portrait next to the closest vector look: same hue, round glasses, matching expression
    const T = 400, gap = 16, top = 56, labelH = 26;
    const pairs: Array<{ file: string; name: string; look: CharacterLook; expr: Expression }> = [
      { file: 'av-ag574938deba-2fc9d62d.jpg', name: 'A1 teal · glasses · blush · smile', look: PRESET_LOOKS[0], expr: 'idle' },
      { file: 'av-ag574938deba-7ddaa5dd.jpg', name: 'A2 teal · asymmetric (drift)', look: { ...PRESET_LOOKS[0], family: 'drift' }, expr: 'idle' },
      { file: 'av-aga7247280ac-5a626780.jpg', name: 'B1 blue · brows · smile', look: PRESET_LOOKS[7], expr: 'idle' },
      { file: 'av-aga7247280ac-77beb9da.jpg', name: 'B2 blue · raised brows (listening)', look: PRESET_LOOKS[7], expr: 'listening' },
    ];
    const W = gap + 4 * (T + gap), H = top + 2 * (T + labelH + gap) + 8;
    const comps: OverlayOptions[] = [];
    let labels = `<text x="${gap}" y="32" fill="#E6E8EE" font-family="Helvetica" font-size="18" font-weight="600">Reference match · favourite AI portrait (left) and the vector look (right), 400 px, Telegram framing</text>`;
    for (const [i, p] of pairs.entries()) {
      const col = (i % 2) * 2, row = Math.floor(i / 2);
      const y = top + row * (T + labelH + gap) + labelH;
      const ref = path.join(REF_DIR, p.file);
      const refPng = existsSync(ref)
        ? await sharp(ref).resize(T, T).png().toBuffer()
        : await sharp({ create: { width: T, height: T, channels: 4, background: '#2A2F3A' } }).png().toBuffer();
      const vec = await sharp(Buffer.from(characterSvg(p.look, { stage: 4, expr: p.expr, size: T, bg: 'halo', fit: 'circle', uid: `rm${i}` }))).png().toBuffer();
      comps.push({ input: refPng, left: gap + col * (T + gap), top: y }, { input: vec, left: gap + (col + 1) * (T + gap), top: y });
      labels += `<text x="${gap + col * (T + gap)}" y="${y - 8}" fill="${LABEL}" font-family="Helvetica" font-size="13">${p.name}</text>`
        + `<text x="${gap + (col + 1) * (T + gap)}" y="${y - 8}" fill="${LABEL}" font-family="Helvetica" font-size="13">vector · ${p.look.hue} ${p.look.family} · ${p.look.accessory} · ${p.expr}</text>`;
    }
    const img = sharp({ create: { width: W, height: H, channels: 4, background: '#0B0E14' } })
      .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${labels}</svg>`), left: 0, top: 0 }, ...comps]);
    await img.png().toFile(path.join(OUT, 'reference-match.png'));
    console.log('  reference-match.png');
  },
};

if (process.argv[1]?.endsWith('character-sheet.ts')) (async () => {
  mkdirSync(OUT, { recursive: true });
  const want = process.argv.slice(2);
  for (const [name, run] of Object.entries(SHEETS)) if (!want.length || want.includes(name)) await run();
})().catch((e) => { console.error(e); process.exit(1); });
