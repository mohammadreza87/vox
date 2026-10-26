#!/usr/bin/env node
/**
 * Pet route weight from a `next build` (brief §3.3, acceptance row 4): every JS and CSS file
 * /studio/pet/[agentId] loads (the /studio root layout plus the page), JS brotli-compressed,
 * CSS raw, and the engine's own chunk. The same for /studio/pet/launch (Circles S4: where every
 * pet opened over a group lands), against the same ceilings.
 *
 *   node scripts/check-pet-bundle.mjs [--json]
 *
 * Fails when the route CSS is over the brief's 12 KB, or when route JS or the engine chunk grows
 * past its ceiling. The JS ceilings are a ratchet at today's weight, not the brief's targets
 * (130 KB route, 25 KB engine): React and Next's runtime alone are ~87 KB brotli, so reaching
 * them needs the rig bound without framer and the character model split. Lower the ceilings as
 * the route shrinks. Raise them only as a deliberate product call recorded in the commit message
 * (the face-range and eating pass bought ~2.7 KB of engine for the app's core moments).
 * Sibling gate: check-pet-copy.mjs (the pet copy lint); both run under `npm run check:pet` (check-pet-gates.mjs).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NEXT = join(ROOT, '.next');
const PAGE = '/studio/pet/[agentId]/page';
/** Circles S4: the group launch page (a missing page in an older build is skipped, never a pass of its own) */
const LAUNCH = '/studio/pet/launch/page';
const LAYOUT = '/studio/layout';
/** brief §3.3 */
export const TARGET = { js: 130 * 1024, css: 12_000, engine: 25 * 1024 };
/**
 * today's weight plus a little slack: a regression fails, an improvement should lower these.
 * Raised 2026-10-26, product call "Wave A: motion polish, bilingual strings, layout classes and room rail":
 * engine 39,784 B (38.9 KB) -> 45,268 B (44.2 KB) br, route JS 188,384 B (184.0 KB) -> 195,851 B (191.3 KB) br
 * (the launch page, the heavier of the two), route CSS 11,798 B -> 11,692 B raw. The catalogues, rooms, fx.css,
 * rooms.css and the motion extras already load lazily and are not counted; the stage vocabulary, micro-saccades,
 * soft-part overlap and room/settle/growth stubs (~1.75 KB together) were kept for motion quality.
 * Each ceiling is the measured weight plus 1 KB.
 */
export const CEILING = { js: 195_851 + 1024, css: TARGET.css, engine: 45_268 + 1024 };
/** a string only the engine's chunk carries (a reaction kind) */
const ENGINE_MARK = '"sleepPoke"';

const br = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

export function measure(next = NEXT, page = PAGE) {
  const app = JSON.parse(readFileSync(join(next, 'app-build-manifest.json'), 'utf8')).pages;
  const build = JSON.parse(readFileSync(join(next, 'build-manifest.json'), 'utf8'));
  if (!app[page]) throw new Error(`${page} is not in this build`);
  const files = [...new Set([...(build.rootMainFiles ?? []), ...(app[LAYOUT] ?? []), ...app[page]])];
  const out = { js: 0, css: 0, engine: 0, files: [] };
  for (const f of files) {
    const p = join(next, f);
    if (!existsSync(p)) continue;
    const b = readFileSync(p);
    if (f.endsWith('.css')) { out.css += b.length; out.files.push({ f, raw: b.length }); continue; }
    if (!f.endsWith('.js')) continue;
    const z = br(b);
    out.js += z;
    if (b.includes(ENGINE_MARK)) out.engine = Math.max(out.engine, z);
    out.files.push({ f, raw: b.length, br: z });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = JSON.parse(readFileSync(join(NEXT, 'app-build-manifest.json'), 'utf8')).pages;
  const pages = [PAGE, ...(app[LAUNCH] ? [LAUNCH] : [])];
  const json = {};
  let failed = false;
  for (const page of pages) {
    const m = measure(NEXT, page);
    json[page] = m;
    if (!process.argv.includes('--json')) {
      console.log(page);
      for (const x of m.files.sort((a, b) => (b.br ?? b.raw) - (a.br ?? a.raw))) console.log(`${(x.br === undefined ? kb(x.raw) + ' raw' : kb(x.br) + ' br').padStart(13)}  ${x.f}`);
      console.log(`route JS ${kb(m.js)} br (ceiling ${kb(CEILING.js)}, brief target ${kb(TARGET.js)})`);
      console.log(`engine chunk ${kb(m.engine)} br (ceiling ${kb(CEILING.engine)}, brief target ${kb(TARGET.engine)})`);
      console.log(`route CSS ${m.css} B raw (budget ${TARGET.css} B)\n`);
    }
    const over = ['js', 'css', 'engine'].filter((k) => m[k] > CEILING[k]);
    if (over.length) { console.error(`${page} over: ${over.join(', ')}`); failed = true; }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(json, null, 2));
  if (failed) process.exit(1);
}
