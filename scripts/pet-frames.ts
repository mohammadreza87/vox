/**
 * Pet motion frame sheets (brief §4.3): every reaction runs through the real engine on a fixed 60 Hz clock with
 * a seeded rng, is sampled every 33 ms, drawn with characterModel + poseToSvg, and tiled into one PNG per
 * reaction × species (overlay: frame, ms, sx/sy, the spring last retargeted). Curve plots of sy, rot, y,
 * gaze-x and the ear angle per reaction, and the spring presets' step responses with overshoot and settle
 * numbers (asserted: `pop` within 2 % by 450 ms, `jelly` ≥ 2 visible oscillations).
 *
 *   node --import tsx scripts/pet-frames.ts [--out=DIR] [--only=hello,poke-belly] [--species=cat,owl] [--tier=lite]
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Mood } from '../src/lib/pet/types';
import { PRESET_LOOKS } from '../src/lib/studio/character';
import type { CharacterLook } from '../src/lib/studio/types';
import { breathPose, idleParams } from '../src/app/studio/pet/_engine/breath';
import { createPetEngine } from '../src/app/studio/pet/_engine/loop';
import { poseToSvg } from '../src/app/studio/pet/_engine/poseToSvg';
import { tuningFor } from '../src/app/studio/pet/_engine/species';
import { analyse, presetKC, stepResponse } from '../src/app/studio/pet/_engine/spring';
import { SPRINGS, type ReactionEvent, type SpringPreset, type Tier } from '../src/app/studio/pet/_engine/types';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = path.resolve(arg('out') ?? path.join(process.env.TMPDIR ?? '/tmp', 'pet-frames'));
const TIER = (arg('tier') ?? 'full') as Tier;
const ONLY = arg('only')?.split(',');
const SPECIES_ONLY = arg('species')?.split(',');

const CONTENT: Mood = { level: 'content', lowest: 'joy', tone: 'content', asleep: false };

/** One representative event per reaction row (a few kinds get one sheet per variant of input). */
const REACTIONS: Array<[string, ReactionEvent, Mood?]> = [
  ['hello', { type: 'hello', firstName: 'Reza' }],
  ['welcome-back', { type: 'welcomeBack', souvenir: 'I kept thinking about your trip to Shiraz' }],
  ['stage-up', { type: 'stageUp', from: 3, to: 4 }],
  ['fidget-small', { type: 'fidgetSmall' }],
  ['fidget-long', { type: 'fidgetLong' }],
  ['ambient-hungry', { type: 'ambient', tone: 'hungry' }],
  ['ambient-happy', { type: 'ambient', tone: 'happy' }],
  ['signature', { type: 'signature', index: 3 }],
  ['bored', { type: 'bored' }],
  ['wants', { type: 'wants', need: 'tummy' }],
  ['droopy', { type: 'droopy' }, { level: 'droopy', lowest: 'energy', tone: 'tired', asleep: false }],
  ['sad', { type: 'sad' }],
  ['doze', { type: 'doze' }],
  ['poke-belly', { type: 'poke', zone: 'belly', side: 0, at: { x: 100, y: 140 }, hits: 1, coolOff: false }],
  ['poke-eye', { type: 'poke', zone: 'eye', side: -1, at: { x: 83, y: 100 }, hits: 1, coolOff: false }],
  ['poke-head', { type: 'poke', zone: 'head', side: 1, at: { x: 110, y: 60 }, hits: 1, coolOff: false }],
  ['poke-cheek', { type: 'poke', zone: 'cheek', side: 1, at: { x: 128, y: 125 }, hits: 1, coolOff: false }],
  ['pet', { type: 'pet', speed: 300, dir: 1, passes: 3 }],
  ['tickle', { type: 'tickle' }],
  ['overpoke-mid', { type: 'overpoke', hits: 4, level: 'mid' }],
  ['overpoke-max', { type: 'overpoke', hits: 7, level: 'max' }],
  ['long-press', { type: 'longPress', at: { x: 100, y: 130 } }],
  ['drag-start', { type: 'dragStart', at: { x: 100, y: 130 } }],
  ['wall-hit', { type: 'wallHit', nx: -1, v: 1600 }],
  ['land', { type: 'land', v: 1800 }],
  ['land-hard', { type: 'land', v: 3000 }],
  ['shake', { type: 'shake' }],
  ['feed-notice', { type: 'feed', phase: 'notice' }],
  ['feed-bite', { type: 'feed', phase: 'bite' }],
  ['feed-chomp', { type: 'feed', phase: 'chomp', chomp: 4 }],
  ['feed-swallow', { type: 'feed', phase: 'swallow' }],
  ['feed-satisfied', { type: 'feed', phase: 'satisfied' }],
  ['too-full', { type: 'tooFull' }],
  ['play-start', { type: 'playStart', tired: false }],
  ['play-tired', { type: 'playStart', tired: true }],
  ['ball-near', { type: 'ballNear' }],
  ['bop', { type: 'bop', nx: 0, ny: -1 }],
  ['miss', { type: 'miss', misses: 1 }],
  ['play-end-fun', { type: 'playEnd', bops: 2, won: false, misses: 1 }],
  ['play-end-sad', { type: 'playEnd', bops: 1, won: false, misses: 3 }],
  ['yawn', { type: 'yawn' }],
  ['sleep', { type: 'sleep' }],
  ['dream', { type: 'dream' }],
  ['wake', { type: 'wake', from: 'sleep', grumpy: true }],
  ['listen', { type: 'listen', source: 'text' }],
  ['ack', { type: 'ack' }],
  ['think', { type: 'think', cycle: 3 }],
  ['speak-start', { type: 'speakStart', mode: 'text' }],
  ['onset', { type: 'onset' }],
  ['speak-end', { type: 'speakEnd' }],
  ['wave', { type: 'wave' }],
  ['celebrate', { type: 'celebrate', why: 'bond' }],
];

/** One preset per species (PRESET_LOOKS opens with the lineup), plus the families on a cloud. */
const LOOKS: Array<[string, CharacterLook]> = [
  ...['cloud', 'cat', 'dog', 'bunny', 'bear', 'owl', 'chick'].map((sp): [string, CharacterLook] => [sp, PRESET_LOOKS.find((l) => l.species === sp)!]),
  ['cloud-tower', { ...PRESET_LOOKS[0], family: 'tower' }],
  ['cloud-drift', { ...PRESET_LOOKS[0], family: 'drift' }],
];

const PARTICLE_COLOR: Record<string, string> = { crumb: '#C68B4E', heart: '#F27A9B', z: '#9FB3D9', sparkle: '#FFD45C', note: '#8CC9A0', wisp: '#DDE6F2', tear: '#7CC4F2' };

interface Sample { t: number; svg: string; sx: number; sy: number; y: number; rot: number; gx: number; ear: number; spring: string; parts: Array<{ kind: string; x: number; y: number; s: number; o: number }> }

/** Run one reaction on a fixed 60 Hz clock; sample every 33 ms until it has settled (cap 4 s). */
function run(look: CharacterLook, e: ReactionEvent, mood: Mood = CONTENT): Sample[] {
  let t = 0;
  const stage = e.type === 'stageUp' ? e.from : 4;
  const eng = createPetEngine({
    look, stage, size: 200, tier: TIER, mood, seed: 11,
    clock: { now: () => t, raf: () => 1, caf: () => undefined },
    ambient: false, activity: false, timers: { set: () => 0, clear: () => undefined },
  });
  eng.start();
  if (e.type === 'stageUp') eng.setLook(look, e.to);
  // a sleeper's reactions start from the asleep pose
  if (e.type === 'dream' || e.type === 'wake') eng.setMood({ ...mood, asleep: true });
  for (let i = 0; i < 90 && (e.type === 'dream' || e.type === 'wake'); i++) { t += 1000 / 60; eng.debug.tick(t); }
  const t0 = t;
  eng.fire(e);
  const tun = tuningFor(look.species, look.family);
  const ip = idleParams({ ...mood, asleep: e.type === 'dream' || e.type === 'wake' }, stage, tun);
  const out: Sample[] = [];
  let quiet = 0, next = t0;
  const geom = () => (eng as unknown as { geom: Parameters<typeof poseToSvg>[0] }).geom;
  while (t - t0 < 4000) {
    if (t >= next) {
      const f = eng.debug.frame!;
      const b = TIER === 'reduced' ? { sx: 1, sy: 1, rot: 0 } : breathPose((t - t0) / 1000, ip);
      out.push({ t: Math.round(t - t0), svg: poseToSvg(geom(), f, { breath: b }), sx: f.body.sx, sy: f.body.sy, y: f.body.y, rot: f.body.rot, gx: f.eyeL.dx ?? 0, ear: f.earL, spring: eng.debug.lastSpring, parts: eng.debug.particles() });
      next += 33;
    }
    t += 1000 / 60;
    eng.debug.tick(t);
    quiet = eng.debug.awake || eng.debug.playing.length ? 0 : quiet + 1;
    if (quiet > 6 && t - t0 > 300) break;
  }
  eng.dispose();
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function sheet(name: string, species: string, frames: Sample[]): string {
  const cols = 10, tile = 150, pad = 8, lab = 30, top = 40;
  const rows = Math.ceil(frames.length / cols);
  const W = cols * (tile + pad) + pad, H = top + rows * (tile + lab + pad) + pad;
  const tiles = frames.map((f, i) => {
    const x = pad + (i % cols) * (tile + pad), y = top + Math.floor(i / cols) * (tile + lab + pad);
    const parts = f.parts.map((p) => `<circle cx="${(p.x).toFixed(1)}" cy="${(p.y).toFixed(1)}" r="${(3 * p.s).toFixed(1)}" fill="${PARTICLE_COLOR[p.kind] ?? '#fff'}" opacity="${p.o.toFixed(2)}"/>`).join('');
    return `<g transform="translate(${x} ${y})"><rect width="${tile}" height="${tile}" rx="10" fill="#1E2632"/>`
      + `<svg x="0" y="0" width="${tile}" height="${tile}" viewBox="-20 -25 240 240" overflow="hidden">${f.svg}${parts}</svg>`
      + `<text x="4" y="${tile + 12}" font-family="Helvetica,Arial" font-size="10" fill="#C9D1DE">#${i} ${f.t}ms ${f.spring}</text>`
      + `<text x="4" y="${tile + 24}" font-family="Helvetica,Arial" font-size="10" fill="#8A93A3">sx ${f.sx.toFixed(3)} sy ${f.sy.toFixed(3)} y ${f.y.toFixed(1)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#121821"/>`
    + `<text x="${pad}" y="26" font-family="Helvetica,Arial" font-size="16" font-weight="bold" fill="#E8EDF5">${esc(name)} · ${esc(species)} · ${TIER} · ${frames.length} frames @ 33 ms</text>${tiles}</svg>`;
}

/** A curve plot: sy, rot, y, gaze-x and the ear angle over time (each normalised to its own range). */
function curves(name: string, frames: Sample[]): string {
  const W = 760, H = 300, L = 50, R = 20, T = 30, B = 30;
  const tMax = Math.max(100, frames[frames.length - 1]?.t ?? 100);
  const series: Array<[string, string, (f: Sample) => number]> = [
    ['sy', '#5CC8FF', (f) => f.sy], ['rot', '#FFB65C', (f) => f.rot], ['y', '#8CE07A', (f) => f.y], ['gaze-x', '#E78BFF', (f) => f.gx], ['ear', '#FF6F7D', (f) => f.ear],
  ];
  const lines = series.map(([label, color, get], k) => {
    const vs = frames.map(get), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    const pts = frames.map((f, i) => `${(L + (f.t / tMax) * (W - L - R)).toFixed(1)},${(T + (H - T - B) * (1 - (vs[i] - lo) / span)).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8"/>`
      + `<text x="${L + k * 140}" y="18" font-family="Helvetica,Arial" font-size="11" fill="${color}">${label} ${lo.toFixed(2)}…${hi.toFixed(2)}</text>`;
  }).join('');
  const ticks = Array.from({ length: Math.floor(tMax / 250) + 1 }, (_, i) => i * 250).map((ms) => {
    const x = L + (ms / tMax) * (W - L - R);
    return `<line x1="${x}" y1="${T}" x2="${x}" y2="${H - B}" stroke="#2A3340"/><text x="${x - 10}" y="${H - 10}" font-family="Helvetica,Arial" font-size="10" fill="#8A93A3">${ms}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#121821"/>${ticks}${lines}`
    + `<text x="${W - 200}" y="${H - 10}" font-family="Helvetica,Arial" font-size="11" fill="#C9D1DE">${esc(name)} (ms)</text></svg>`;
}

/** The presets' step responses at 60 Hz, with overshoot / visible oscillations / 2 % settle time. */
function springReport(): { svg: string; rows: Array<{ preset: SpringPreset; overshoot: number; peaks: number; settleMs: number }> } {
  const W = 760, H = 320, L = 50, R = 20, T = 30, B = 30, ms = 1600;
  const colors: Record<SpringPreset, string> = { eye: '#E78BFF', snap: '#5CC8FF', pop: '#8CE07A', jelly: '#FFB65C', float: '#FF6F7D', sleepy: '#C9D1DE' };
  const rows: Array<{ preset: SpringPreset; overshoot: number; peaks: number; settleMs: number }> = [];
  const lines = (Object.keys(SPRINGS) as SpringPreset[]).map((p, k) => {
    const c = stepResponse(presetKC(p), ms, 60);
    const a = analyse(c);
    rows.push({ preset: p, ...a });
    const pts = c.map(([t, x]) => `${(L + (t / ms) * (W - L - R)).toFixed(1)},${(T + (H - T - B) * (1 - x / 1.4)).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${colors[p]}" stroke-width="1.8"/>`
      + `<text x="${L + k * 118}" y="18" font-family="Helvetica,Arial" font-size="11" fill="${colors[p]}">${p} +${(a.overshoot * 100).toFixed(0)}% ${a.settleMs.toFixed(0)}ms</text>`;
  }).join('');
  const one = T + (H - T - B) * (1 - 1 / 1.4);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#121821"/><line x1="${L}" y1="${one}" x2="${W - R}" y2="${one}" stroke="#3A4556" stroke-dasharray="4 4"/>${lines}</svg>`, rows };
}

async function png(svg: string, file: string) {
  await sharp(Buffer.from(svg)).png().toFile(file);
}

async function main() {
  for (const d of [OUT, path.join(OUT, 'sheets'), path.join(OUT, 'curves')]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
  const report: Record<string, unknown> = {};

  // spring presets: the numbers the brief asserts
  const springs = springReport();
  await png(springs.svg, path.join(OUT, 'springs.png'));
  report.springs = springs.rows;
  const pop = springs.rows.find((r) => r.preset === 'pop')!, jelly = springs.rows.find((r) => r.preset === 'jelly')!;
  const failures: string[] = [];
  if (pop.settleMs > 450) failures.push(`pop settles in ${pop.settleMs.toFixed(0)} ms (> 450)`);
  if (jelly.peaks < 2) failures.push(`jelly shows ${jelly.peaks} visible oscillations (< 2)`);
  for (const r of springs.rows) console.log(`${r.preset.padEnd(6)} overshoot ${(r.overshoot * 100).toFixed(1).padStart(5)} %  oscillations ${r.peaks}  settle(2 %) ${r.settleMs.toFixed(0)} ms`);

  const looks = LOOKS.filter(([n]) => !SPECIES_ONLY || SPECIES_ONLY.includes(n));
  const reactions = REACTIONS.filter(([n]) => !ONLY || ONLY.includes(n));
  const perReaction: Record<string, { frames: number; durationMs: number; minSy: number; maxSy: number; maxRot: number }> = {};
  for (const [name, e, mood] of reactions) {
    for (const [sp, look] of looks) {
      const frames = run(look, e, mood);
      await png(sheet(name, sp, frames), path.join(OUT, 'sheets', `${name}__${sp}.png`));
      if (sp === looks[0][0]) {
        await png(curves(`${name} · ${sp}`, frames), path.join(OUT, 'curves', `${name}.png`));
        perReaction[name] = {
          frames: frames.length, durationMs: frames[frames.length - 1]?.t ?? 0,
          minSy: Math.min(...frames.map((f) => f.sy)), maxSy: Math.max(...frames.map((f) => f.sy)), maxRot: Math.max(...frames.map((f) => Math.abs(f.rot))),
        };
      }
    }
    const r = perReaction[name];
    if (r) console.log(`${name.padEnd(16)} ${String(r.frames).padStart(3)} frames ${String(r.durationMs).padStart(5)} ms  sy ${r.minSy.toFixed(3)}…${r.maxSy.toFixed(3)}  |rot| ≤ ${r.maxRot.toFixed(1)}°`);
  }
  report.reactions = perReaction;
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${reactions.length * looks.length} sheets → ${path.join(OUT, 'sheets')}\ncurves → ${path.join(OUT, 'curves')}\nsprings → ${path.join(OUT, 'springs.png')}`);
  if (failures.length) { console.error(`FAIL: ${failures.join('; ')}`); process.exitCode = 1; }
}

void main();
