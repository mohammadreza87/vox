/**
 * Portrait A/B (PLAN A3, §7): for 10 preset looks, the gpt-image edit of the
 * stage-4 vector reference vs the text-only prompt, side by side with the
 * vector, so a reviewer can judge whether the edit keeps the ears, hair and
 * accessory. If it doesn't, flip renderPortrait to `prefer: 'text'`.
 *
 *   OPENAI_API_KEY=… node --import tsx scripts/portrait-ab.ts
 *   node --import tsx scripts/portrait-ab.ts --dry             # references, prompts and the sheet only (no key)
 *   … --looks=0,3,8 --variant=1 --model=gpt-image-1
 *
 * Writes reports/portrait-ab/<nn>-<look>/{reference.png,edit.jpg,text.jpg,prompt-*.txt},
 * results.json and sheet.png (vector | edit | text, with Telegram's circle crop).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PRESET_LOOKS } from '../src/lib/studio/character';
import { avatarPromptV2, portraitReferenceSvg, svgToPng } from '../src/lib/studio/character/portrait';
import { OpenAIMedia } from '../src/lib/studio/media';
import type { CharacterLook, PersonaSpec } from '../src/lib/studio/types';

const OUT = path.resolve(__dirname, '../reports/portrait-ab');
/** One per species, then the hardest attachments: cat bun + star, owl cap, cloud pony cap. */
const DEFAULT_LOOKS = [0, 1, 2, 3, 4, 5, 6, 8, 11, 13];
const ROLES: Record<string, string> = { headset: 'Customer support', specs: 'Research analyst', glasses: 'Finance analyst', beret: 'Brand designer', flower: 'Wellbeing coach', star: 'Creative producer', headphones: 'Backend engineer', cap: 'Ops engineer', beanie: 'Game developer', bowtie: 'Partnerships lead', scarf: 'Host', bow: 'Community manager' };

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const label = (l: CharacterLook) => [l.species, l.hair !== 'none' && l.hair, l.accessory !== 'none' && l.accessory].filter(Boolean).join('-');
const persona = (l: CharacterLook): PersonaSpec => ({
  name: 'Sample', role: ROLES[l.accessory ?? 'none'] ?? 'Teammate', tagline: '', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [],
  wontDo: '', languages: ['English'], culture: '', presentation: 'neutral', age: '', accent: '', voiceBrief: '', avatarHint: '',
});

interface Result { index: number; look: CharacterLook; dir: string; edit?: { ms: number; error?: string }; text?: { ms: number; error?: string } }

async function timed(fn: () => Promise<Buffer>, file: string): Promise<{ ms: number; error?: string }> {
  const t = Date.now();
  try { writeFileSync(file, await fn()); return { ms: Date.now() - t }; }
  catch (e) { return { ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) }; }
}

/** A tile: the image (or a placeholder note), square, with a faint Telegram circle-crop guide. */
async function tile(file: string | null, size: number, note: string): Promise<Buffer> {
  const guide = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="none" stroke="#FFFFFF" stroke-opacity=".28" stroke-dasharray="4 5"/></svg>`;
  const base = file
    ? await sharp(file).resize(size, size).png().toBuffer().catch(() => null)
    : null;
  const bg = base ?? await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#16191F"/><text x="${size / 2}" y="${size / 2}" fill="#5C6270" font-family="Helvetica, Arial" font-size="14" text-anchor="middle">${note}</text></svg>`)).png().toBuffer();
  return sharp(bg).composite([{ input: Buffer.from(guide) }]).png().toBuffer();
}

async function contactSheet(results: Result[], dry: boolean) {
  const T = 300, gap = 10, left = 190, top = 64, W = left + 3 * (T + gap), H = top + results.length * (T + gap) + 8;
  const text = (x: number, y: number, s: string, size = 13, fill = '#8A90A0', anchor = 'start') =>
    `<text x="${x}" y="${y}" fill="${fill}" font-family="Helvetica, Arial" font-size="${size}" text-anchor="${anchor}">${s}</text>`;
  const labels = [
    text(16, 30, 'Portrait A/B · vector reference vs gpt-image edit (input_fidelity high) vs text-only', 16, '#E6E8EE'),
    ...['vector (reference)', 'edit', 'text only'].map((s, c) => text(left + c * (T + gap) + T / 2, top - 10, s, 13, '#8A90A0', 'middle')),
    ...results.flatMap((r, i) => [
      text(16, top + i * (T + gap) + T / 2 - 8, `${String(r.index).padStart(2, '0')} ${label(r.look)}`, 13, '#E6E8EE'),
      text(16, top + i * (T + gap) + T / 2 + 12, `${r.look.hue} · ${r.look.family}`),
      r.edit && text(16, top + i * (T + gap) + T / 2 + 30, r.edit.error ? 'edit failed' : `edit ${(r.edit.ms / 1000).toFixed(1)}s`),
      r.text && text(16, top + i * (T + gap) + T / 2 + 46, r.text.error ? 'text failed' : `text ${(r.text.ms / 1000).toFixed(1)}s`),
    ].filter((s): s is string => !!s)),
  ];
  const tiles = await Promise.all(results.flatMap((r, i) => (['reference.png', 'edit.jpg', 'text.jpg'] as const).map(async (f, c) => {
    const missing = c === 0 ? null : dry ? 'dry run' : (c === 1 ? r.edit : r.text)?.error ? 'failed' : null;
    return { input: await tile(missing ? null : path.join(r.dir, f), T, missing ?? 'missing'), left: left + c * (T + gap), top: top + i * (T + gap) };
  })));
  await sharp({ create: { width: W, height: H, channels: 3, background: '#0E1013' } })
    .composite([...tiles, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels.join('')}</svg>`), left: 0, top: 0 }])
    .png().toFile(path.join(OUT, 'sheet.png'));
}

/** Runs `fn` over `items` with at most `n` in flight (image calls are slow and rate limited). */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it); }));
}

async function main() {
  const dry = process.argv.includes('--dry');
  const key = process.env.OPENAI_API_KEY;
  if (!dry && !key) { console.error('OPENAI_API_KEY is not set. Run with a key, or with --dry for references and prompts only.'); process.exit(2); }
  const indices = arg('looks')?.split(',').map(Number).filter((i) => PRESET_LOOKS[i]) ?? DEFAULT_LOOKS;
  const variant = Number(arg('variant') ?? 0);
  const media = key ? new OpenAIMedia(key, fetch, arg('model') ?? process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1') : null;
  mkdirSync(OUT, { recursive: true });

  const results: Result[] = indices.map((index) => ({ index, look: PRESET_LOOKS[index], dir: path.join(OUT, `${String(index).padStart(2, '0')}-${label(PRESET_LOOKS[index])}`) }));
  await pool(results, 3, async (r) => {
    mkdirSync(r.dir, { recursive: true });
    const p = persona(r.look);
    const reference = await svgToPng(portraitReferenceSvg(r.look, variant), 1024);
    writeFileSync(path.join(r.dir, 'reference.png'), reference);
    writeFileSync(path.join(r.dir, 'prompt-edit.txt'), avatarPromptV2(p, r.look, variant, true));
    writeFileSync(path.join(r.dir, 'prompt-text.txt'), avatarPromptV2(p, r.look, variant, false));
    if (!media) return;
    [r.edit, r.text] = await Promise.all([
      timed(() => media.editAvatar(avatarPromptV2(p, r.look, variant, true), reference, 180_000), path.join(r.dir, 'edit.jpg')),
      timed(() => media.generateAvatar(avatarPromptV2(p, r.look, variant, false)), path.join(r.dir, 'text.jpg')),
    ]);
    console.log(`  ${path.basename(r.dir)}  edit ${r.edit.error ?? `${r.edit.ms} ms`}  text ${r.text.error ?? `${r.text.ms} ms`}`);
  });

  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ variant, model: media ? arg('model') ?? process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1' : null, dry, results: results.map(({ dir, ...r }) => ({ ...r, dir: path.basename(dir) })) }, null, 2));
  await contactSheet(results, dry);
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}/sheet.png (${results.length} looks${dry ? ', dry run' : ''}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
