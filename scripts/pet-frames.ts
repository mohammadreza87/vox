/**
 * Pet motion frame sheets (brief §4.3): every reaction runs through the real engine on a fixed 60 Hz clock with
 * a seeded rng, is sampled every 33 ms, drawn with characterModel + poseToSvg, and tiled into one PNG per
 * reaction × species (overlay: frame, ms, sx/sy, the spring last retargeted). Curve plots of sy, rot, y,
 * gaze-x and the ear angle per reaction, and the spring presets' step responses with overshoot and settle
 * numbers (asserted: `pop` within 2 % by 450 ms, `jelly` ≥ 2 visible oscillations).
 *
 *   node --import tsx scripts/pet-frames.ts [--out=DIR] [--only=hello,poke-belly] [--species=cat,owl] [--tier=lite]
 *     [--zoom=1.8] (crop the tiles toward the face) [--tile=150] (tile px) [--every=33] (sample ms) [--cols=10]
 *     [--variant=0,1,2] (force the variant index: one sheet per variant, `name__species__vN.png`)
 *
 * Besides one sheet per reaction, `feed-tap` and `feed-drag` run the whole feeding through the engine's toy API
 * (the cookie is drawn as a brown disc where the engine writes it).
 *
 *   node --import tsx scripts/pet-frames.ts --v2
 *     → reports/character/motion-keyframes-v2.png (the polished reactions: anticipation, overlap, landing blinks),
 *       stages-motion-v2.png (one hello per stage: the wisp → formed vocabulary), rooms-transitions-v2.png (each
 *       room's transition and idle, a growth moment, the settle float, Garden rain, reduced motion)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Mood } from '../src/lib/pet/types';
import { PRESET_LOOKS } from '../src/lib/studio/character';
import type { CharacterLook } from '../src/lib/studio/types';
import { breathPose, idleParams } from '../src/app/studio/pet/_engine/breath';
import { createPetEngine, type PetMotionControls } from '../src/app/studio/pet/_engine/loop';
import * as motionExtras from '../src/app/studio/pet/_engine/extras';
import { roomIdle } from '../src/app/studio/pet/_engine/reactions/rooms';
import type { MotionCue, Room } from '../src/app/studio/pet/_engine/types';
import type { Stage } from '../src/lib/studio/types';
import { poseToSvg } from '../src/app/studio/pet/_engine/poseToSvg';
import { tuningFor } from '../src/app/studio/pet/_engine/species';
import { analyse, presetKC, stepResponse } from '../src/app/studio/pet/_engine/spring';
import { SPRINGS, type ReactionEvent, type SpringPreset, type Tier } from '../src/app/studio/pet/_engine/types';
import type { PointerSample, ToyEvent } from '../src/app/studio/pet/_ui/contract';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = path.resolve(arg('out') ?? path.join(process.env.TMPDIR ?? '/tmp', 'pet-frames'));
const TIER = (arg('tier') ?? 'full') as Tier;
const ONLY = arg('only')?.split(',');
const SPECIES_ONLY = arg('species')?.split(',');
const ZOOM = Number(arg('zoom') ?? 1);
const TILE = Number(arg('tile') ?? 150);
const EVERY = Number(arg('every') ?? 33);
const COLS = Number(arg('cols') ?? 10);
/** force every reaction's variant to these indices (one sheet each, `name__species__vN.png`); default: the seeded pick */
const VARIANTS = arg('variant')?.split(',').map(Number);

/** A scripted run through the toy API: called before every tick with the ms since the start. */
type Script = (toy: (e: ToyEvent) => void, ms: number, mouth: { x: number; y: number }, ptr: (p: Omit<PointerSample, 't' | 'id'>) => void) => void;
const once = (at: number, fn: Script): Script => { let done = false; return (toy, ms, m, ptr) => { if (!done && ms >= at) { done = true; fn(toy, ms, m, ptr); } }; };
/** A finger: down on the belly, a fast swipe of `vx`/`vy` px/s for 170 ms, then let go (a fling, or a drop when slow). */
const swipe = (vx: number, vy: number): Script => {
  let phase = 0;
  const at = { x: 100, y: 130 };
  return (_toy, ms, _m, ptr) => {
    if (phase === 0) { phase = 1; ptr({ kind: 'down', ...at }); return; }
    if (phase === 1 && ms < 170) { ptr({ kind: 'move', x: at.x + (vx * ms) / 1000, y: at.y + (vy * ms) / 1000 }); return; }
    if (phase === 1) { phase = 2; ptr({ kind: 'up', x: at.x + (vx * ms) / 1000, y: at.y + (vy * ms) / 1000 }); }
  };
};
const ASLEEP_SCRIPT = (): Script => () => undefined;
const SCRIPTS: Array<[string, () => Script]> = [
  // thrown up and to the right: the flight, the wall splat, the landings and the hop home (render with --zoom=0.5)
  ['fling', () => swipe(1500, -1100)],
  // tossed straight up: the stretch along the flight, the hard landing (dizzy), the bounce
  ['fling-up', () => swipe(250, -2400)],
  // the asleep loop itself: deep breaths and a Z at each breath peak (no reaction fired)
  ['asleep', ASLEEP_SCRIPT],
  ['feed-tap', () => once(0, (toy) => toy({ type: 'cookieTap' }))],
  // lift at the slot, carry it up toward the mouth over 700 ms, hold it 350 ms just under the chin, drop it in
  ['feed-drag', () => {
    const slot = { x: 40, y: 320 }, hold = { x: 72, y: 152 };
    let lifted = false, dropped = false;
    return ((toy, ms, m) => {
      if (!lifted) { lifted = true; toy({ type: 'cookieLift', at: slot }); return; }
      if (ms < 700) { const u = ms / 700, e = u * u * (3 - 2 * u); toy({ type: 'cookieMove', at: { x: slot.x + (hold.x - slot.x) * e, y: slot.y + (hold.y - slot.y) * e } }); return; }
      if (ms < 1050) { toy({ type: 'cookieMove', at: hold }); return; }
      if (!dropped) { dropped = true; toy({ type: 'cookieDrop', at: m }); }
    }) as Script;
  }],
];

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

interface Sample { t: number; svg: string; sx: number; sy: number; y: number; rot: number; gx: number; ear: number; spring: string; parts: Array<{ kind: string; x: number; y: number; s: number; o: number }>; cookie: { x: number; y: number; s: number; o: number } }

/** Run one reaction (or a toy script) on a fixed 60 Hz clock; sample every EVERY ms until it has settled (cap 4 s, scripts 5 s). */
function run(look: CharacterLook, e: ReactionEvent | (() => Script), mood: Mood = CONTENT, forced?: number): Sample[] {
  const sleeper = typeof e === 'function' && e === ASLEEP_SCRIPT;
  const script = typeof e === 'function' ? e() : null;
  if (sleeper) mood = { ...mood, asleep: true };
  if (script) e = { type: 'fidgetSmall' };
  if (typeof e === 'function') throw new Error('unreachable');
  let t = 0;
  const stage = e.type === 'stageUp' ? e.from : 4;
  const eng = createPetEngine({
    look, stage, size: 200, tier: TIER, mood, seed: 11,
    clock: { now: () => t, raf: () => 1, caf: () => undefined },
    ambient: sleeper, activity: false, timers: { set: () => 0, clear: () => undefined },
  });
  const ptr = (p: Omit<PointerSample, 't' | 'id'>) => { eng.pointer({ ...p, id: 1, t }); };
  eng.start();
  if (forced !== undefined) { const h = (eng as unknown as { history: { pick: (k: string, n: number) => number } }).history; h.pick = (_k, n) => Math.min(forced, n - 1); }
  if (e.type === 'stageUp') eng.setLook(look, e.to);
  // a sleeper's reactions start from the asleep pose
  if (e.type === 'dream' || e.type === 'wake') eng.setMood({ ...mood, asleep: true });
  for (let i = 0; i < 90 && (sleeper || e.type === 'dream' || e.type === 'wake'); i++) { t += 1000 / 60; eng.debug.tick(t); }
  const t0 = t;
  const mouthAt = () => { const g = (eng as unknown as { geom: Parameters<typeof poseToSvg>[0] }).geom.model.face.mouth; const f = eng.debug.frame!; return { x: 100 + (g.x - 100) * f.body.sx, y: 166 + (g.y - 166) * f.body.sy + f.body.y }; };
  if (script) script((x) => eng.toy(x), 0, mouthAt(), ptr); else eng.fire(e);
  const tun = tuningFor(look.species, look.family);
  const ip = idleParams({ ...mood, asleep: sleeper || e.type === 'dream' || e.type === 'wake' }, stage, tun);
  const out: Sample[] = [];
  let quiet = 0, next = t0;
  const geom = () => (eng as unknown as { geom: Parameters<typeof poseToSvg>[0] }).geom;
  const cap = sleeper ? 14000 : script ? 5000 : 4000;
  while (t - t0 < cap) {
    if (script && t > t0) script((x) => eng.toy(x), t - t0, mouthAt(), ptr);
    if (t >= next) {
      const f = eng.debug.frame!;
      const b = TIER === 'reduced' ? { sx: 1, sy: 1, rot: 0 } : breathPose((t - t0) / 1000, ip);
      out.push({ t: Math.round(t - t0), svg: poseToSvg(geom(), f, { breath: b }), sx: f.body.sx, sy: f.body.sy, y: f.body.y, rot: f.body.rot, gx: f.eyeL.dx ?? 0, ear: f.earL, spring: eng.debug.lastSpring, parts: eng.debug.particles(), cookie: eng.debug.cookie() });
      next += EVERY;
    }
    t += 1000 / 60;
    eng.debug.tick(t);
    quiet = eng.debug.awake || eng.debug.playing.length ? 0 : quiet + 1;
    if (!sleeper && quiet > 6 && t - t0 > (script ? 1500 : 300)) break;
  }
  eng.dispose();
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function sheet(name: string, species: string, frames: Sample[]): string {
  const cols = COLS, tile = TILE, pad = 8, lab = 30, top = 40;
  // zoomed out (< 1), the tile frames the whole stage (a fling's flight, the walls)
  const vw = 240 / ZOOM, cx = ZOOM < 1 ? 180 : 100, vb = `${(cx - vw / 2).toFixed(1)} ${(ZOOM > 1 ? 112 - vw / 2 : ZOOM < 1 ? 210 - vw : -25).toFixed(1)} ${vw.toFixed(1)} ${vw.toFixed(1)}`;
  const rows = Math.ceil(frames.length / cols);
  const W = cols * (tile + pad) + pad, H = top + rows * (tile + lab + pad) + pad;
  const tiles = frames.map((f, i) => {
    const x = pad + (i % cols) * (tile + pad), y = top + Math.floor(i / cols) * (tile + lab + pad);
    const ck = f.cookie.o > 0.01 ? `<g opacity="${f.cookie.o.toFixed(2)}"><circle cx="${f.cookie.x.toFixed(1)}" cy="${f.cookie.y.toFixed(1)}" r="${(20 * f.cookie.s).toFixed(1)}" fill="#C68B4E" stroke="#8A5A2B" stroke-width="2"/>`
      + [[-6, -5], [5, -2], [-2, 6], [7, 7]].map(([dx, dy]) => `<circle cx="${(f.cookie.x + dx * f.cookie.s).toFixed(1)}" cy="${(f.cookie.y + dy * f.cookie.s).toFixed(1)}" r="${(2.4 * f.cookie.s).toFixed(1)}" fill="#5A3518"/>`).join('') + '</g>' : '';
    const parts = f.parts.map((p) => `<circle cx="${(p.x).toFixed(1)}" cy="${(p.y).toFixed(1)}" r="${(3 * p.s).toFixed(1)}" fill="${PARTICLE_COLOR[p.kind] ?? '#fff'}" opacity="${p.o.toFixed(2)}"/>`).join('');
    return `<g transform="translate(${x} ${y})"><rect width="${tile}" height="${tile}" rx="10" fill="#1E2632"/>`
      + `<svg x="0" y="0" width="${tile}" height="${tile}" viewBox="${vb}" overflow="hidden">${f.svg}${ck}${parts}</svg>`
      + `<text x="4" y="${tile + 12}" font-family="Helvetica,Arial" font-size="10" fill="#C9D1DE">#${i} ${f.t}ms ${f.spring}</text>`
      + `<text x="4" y="${tile + 24}" font-family="Helvetica,Arial" font-size="10" fill="#8A93A3">sx ${f.sx.toFixed(3)} sy ${f.sy.toFixed(3)} y ${f.y.toFixed(1)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#121821"/>`
    + `<text x="${pad}" y="26" font-family="Helvetica,Arial" font-size="16" font-weight="bold" fill="#E8EDF5">${esc(name)} · ${esc(species)} · ${TIER} · ${frames.length} frames @ ${EVERY} ms</text>${tiles}</svg>`;
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
  const reactions: Array<[string, ReactionEvent | (() => Script), Mood?]> = [...REACTIONS, ...SCRIPTS].filter(([n]) => !ONLY || ONLY.includes(n));
  const perReaction: Record<string, { frames: number; durationMs: number; minSy: number; maxSy: number; maxRot: number }> = {};
  for (const [name, e, mood] of reactions) {
    for (const [sp, look] of looks) for (const fv of VARIANTS ?? [undefined]) {
      const frames = run(look, e, mood, fv);
      const tag = fv === undefined ? '' : `__v${fv}`;
      if (VARIANTS) console.log(`  ${`${name}__${sp}${tag}`.padEnd(30)} sx ${Math.min(...frames.map((f) => f.sx)).toFixed(3)}…${Math.max(...frames.map((f) => f.sx)).toFixed(3)}  sy ${Math.min(...frames.map((f) => f.sy)).toFixed(3)}…${Math.max(...frames.map((f) => f.sy)).toFixed(3)}  |rot| ≤ ${Math.max(...frames.map((f) => Math.abs(f.rot))).toFixed(1)}°  y ${Math.min(...frames.map((f) => f.y)).toFixed(1)}  ${frames[frames.length - 1]?.t} ms`);
      await png(sheet(`${name}${fv === undefined ? '' : ` v${fv}`}`, sp, frames), path.join(OUT, 'sheets', `${name}__${sp}${tag}.png`));
      if (sp === looks[0][0] && fv === (VARIANTS?.[0])) {
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

/* ---------- v2 sheets (motion pass, design §10): rows of key frames, written to reports/character ---------- */

type V2Engine = ReturnType<typeof createPetEngine>;
interface V2Row {
  label: string;
  look: CharacterLook;
  stage?: Stage;
  tier?: Tier;
  mood?: Mood;
  /** run before the first sample (t = 0) */
  start: (e: V2Engine, priv: { playBeats: (k: string, cls: string, b: unknown, now: number) => void; ctx: () => never; clock: { now(): number } }) => void;
  /** sample times (ms after start) */
  at: number[];
  /** warm-up ms before start (a settled pose) */
  warm?: number;
  /** run before the warm-up (an instant room, a mood) */
  setup?: (e: V2Engine) => void;
  /** called before every tick with the ms since start (a finger, a toy) */
  each?: (e: V2Engine, ms: number, t: number) => void;
  /** zoomed out (a toss travels off the usual crop) */
  wide?: boolean;
}
interface V2Frame { t: number; svg: string; mark: string; parts: Sample['parts']; sy: number; rot: number; y: number; cookie: Sample['cookie'] }

async function runV2(row: V2Row): Promise<{ frames: V2Frame[]; cues: string[] }> {
  let t = 0;
  const cues: Array<{ t: number; c: MotionCue }> = [];
  const eng = createPetEngine({
    look: row.look, stage: row.stage ?? 4, size: 200, tier: row.tier ?? 'full', mood: row.mood ?? CONTENT, seed: 11,
    clock: { now: () => t, raf: () => 1, caf: () => undefined }, ambient: false, activity: false, followOS: false, motionExtras, timers: { set: () => 0, clear: () => undefined },
  });
  const off = (eng as unknown as PetMotionControls).onMotion((c) => cues.push({ t, c }));
  await (eng as unknown as PetMotionControls).loadRooms();
  eng.start();
  row.setup?.(eng);
  for (let i = 0; i < Math.round((row.warm ?? 600) / (1000 / 60)); i++) { t += 1000 / 60; eng.debug.tick(t); }
  cues.length = 0;
  const t0 = t;
  let lastSample = t0 - 0.5;
  row.start(eng, eng as never);
  const geom = () => (eng as unknown as { geom: Parameters<typeof poseToSvg>[0] }).geom;
  const out: V2Frame[] = [];
  const times = [...row.at].sort((a, b) => a - b);
  let k = 0;
  while (k < times.length) {
    if (t - t0 >= times[k] - 1e-6) {
      const f = eng.debug.frame!;
      const cue = cues.find((c) => c.t > lastSample && c.t <= t);
      lastSample = t;
      out.push({ t: Math.round(t - t0), svg: poseToSvg(geom(), f), mark: cue ? cue.c.type : '', parts: eng.debug.particles(), sy: f.body.sy, rot: f.body.rot, y: f.body.y, cookie: eng.debug.cookie() });
      k++;
      continue;
    }
    row.each?.(eng, t - t0, t);
    t += 1000 / 60;
    eng.debug.tick(t);
  }
  off();
  eng.dispose();
  return { frames: out, cues: cues.map((c) => `${c.c.type}@${Math.round(c.t - t0)}`) };
}

/** Tile ids: every tile's paint servers get their own prefix (the model is built with uid 'pet'). */
const reid = (svg: string, p: string) => svg.replace(/(id="|url\(#)pet/g, `$1${p}`);

function v2Sheet(title: string, sub: string, rows: Array<{ row: V2Row; frames: V2Frame[]; note: string }>): string {
  const tile = 118, pad = 8, lab = 20, left = 190, top = 60, rowH = tile + lab + pad + 8;
  const cols = Math.max(...rows.map((r) => r.frames.length));
  const W = left + cols * (tile + pad) + pad, H = top + rows.length * rowH + pad;
  const vb = '-20 -10 240 220';
  const body = rows.map(({ row, frames, note }, ri) => {
    const y0 = top + ri * rowH;
    const head = `<text x="12" y="${y0 + 22}" font-family="Helvetica,Arial" font-size="13" font-weight="bold" fill="#E8EDF5">${esc(row.label)}</text>`
      + note.split('|').map((l, i) => `<text x="12" y="${y0 + 40 + i * 14}" font-family="Helvetica,Arial" font-size="10.5" fill="#8A93A3">${esc(l)}</text>`).join('');
    const tiles = frames.map((f, i) => {
      const x = left + i * (tile + pad);
      const parts = f.parts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(3 * p.s).toFixed(1)}" fill="${PARTICLE_COLOR[p.kind] ?? '#fff'}" opacity="${p.o.toFixed(2)}"/>`).join('')
        + (f.cookie.o > 0.01 ? `<circle cx="${f.cookie.x.toFixed(1)}" cy="${f.cookie.y.toFixed(1)}" r="${(16 * f.cookie.s).toFixed(1)}" fill="#C68B4E" stroke="#8A5A2B" stroke-width="2" opacity="${f.cookie.o.toFixed(2)}"/>` : '');
      const ring = f.mark ? `<rect x="1" y="1" width="${tile - 2}" height="${tile - 2}" rx="9" fill="none" stroke="#FFD45C" stroke-width="2"/>` : '';
      return `<g transform="translate(${x} ${y0})"><rect width="${tile}" height="${tile}" rx="10" fill="#1E2632"/>`
        + `<line x1="10" x2="${tile - 10}" y1="${(tile * (176 + 10) / 220).toFixed(1)}" y2="${(tile * (176 + 10) / 220).toFixed(1)}" stroke="#2A3340"/>`
        + `<svg x="0" y="0" width="${tile}" height="${tile}" viewBox="${row.wide ? '-40 -170 420 420' : vb}" overflow="hidden">${reid(f.svg, `r${ri}t${i}`)}${parts}</svg>${ring}`
        + `<text x="4" y="${tile + 13}" font-family="Helvetica,Arial" font-size="10" fill="#C9D1DE">${f.t} ms${f.mark ? ` · ${f.mark}` : ''}</text></g>`;
    }).join('');
    return head + tiles;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#121821"/>`
    + `<text x="12" y="26" font-family="Helvetica,Arial" font-size="17" font-weight="bold" fill="#E8EDF5">${esc(title)}</text>`
    + `<text x="12" y="44" font-family="Helvetica,Arial" font-size="11.5" fill="#8A93A3">${esc(sub)}</text>${body}</svg>`;
}

const span = (to: number, n = 10) => Array.from({ length: n }, (_, i) => Math.round((i * to) / (n - 1)));
const stats = (fr: V2Frame[]) => `sy ${Math.min(...fr.map((f) => f.sy)).toFixed(2)}…${Math.max(...fr.map((f) => f.sy)).toFixed(2)} · lift ${(-Math.min(...fr.map((f) => f.y))).toFixed(1)} px`;

async function v2() {
  const OUT2 = path.resolve(__dirname, '../reports/character');
  const bunny = PRESET_LOOKS[22], cloud = PRESET_LOOKS[0], bowBunny = PRESET_LOOKS[3];
  const fire = (e: ReactionEvent) => (eng: V2Engine) => eng.fire(e);
  const motion = (fn: (m: PetMotionControls) => void) => (eng: V2Engine) => fn(eng as unknown as PetMotionControls);

  // 1. the touched reactions, key frames (bunny with a tuft and a bow: hair and accessory overlap show)
  const keyRows: V2Row[] = [
    { label: 'hello', look: bunny, start: fire({ type: 'hello', firstName: 'Reza' }), at: [0, 50, 100, 140, 200, 260, 330, 400, 480, 600, 800] },
    { label: 'celebrate (bond)', look: bunny, start: fire({ type: 'celebrate', why: 'bond' }), at: [0, 60, 120, 170, 260, 350, 450, 560, 700, 900, 1200] },
    { label: 'land (1800 px/s)', look: bunny, start: fire({ type: 'land', v: 1800 }), at: [0, 30, 60, 100, 140, 200, 260, 340, 450, 600, 800] },
    { label: 'feed: tap the cookie', look: bunny, start: (e) => e.toy({ type: 'cookieTap' }), at: [0, 150, 350, 600, 800, 850, 950, 1100, 1350, 1700, 2100] },
    { label: 'pet (stroke ×3)', look: bunny, start: fire({ type: 'pet', speed: 300, dir: 1, passes: 3 }), at: [0, 60, 120, 200, 320, 480, 640, 800, 1000, 1200, 1500] },
    { label: 'yawn', look: bunny, start: fire({ type: 'yawn' }), at: [0, 60, 120, 220, 330, 450, 560, 650, 750, 900, 1150] },
    { label: 'sleep (drift off)', look: bunny, start: fire({ type: 'sleep' }), at: span(3200, 11) },
    { label: 'signature 6 (lit-moment move)', look: bunny, start: fire({ type: 'signature', index: 6 }), at: [0, 100, 250, 400, 550, 700, 850, 1000, 1200, 1400, 1700] },
    {
      // a sideways toss: flight, landing squash (with a blink), then the crouch and the hop home
      label: 'toss → land → hop home', look: bunny, wide: true,
      start: () => undefined,
      each: (e, ms, t) => {
        const at = { x: 100 + ms * 1.4, y: 130 - ms * 0.9 };
        if (ms === 0) e.pointer({ kind: 'down', id: 1, x: 100, y: 130, t });
        else if (ms < 170) e.pointer({ kind: 'move', id: 1, ...at, t });
        else if (ms < 187) e.pointer({ kind: 'up', id: 1, ...at, t });
      },
      at: [0, 120, 240, 360, 480, 600, 800, 1000, 1200, 1400, 1700],
    },
  ];
  const keyFrames = await Promise.all(keyRows.map(async (row) => { const r = await runV2(row); return { row, frames: r.frames, note: `${stats(r.frames)}|${r.cues.join(' ')}` }; }));
  await png(v2Sheet('Motion keyframes v2 · bunny (tuft + bow) · stage 4 · full tier',
    'anticipation crouch before every hop · face and soft parts land a beat after the body · blink on landing and on big turns · weight-scaled settles', keyFrames), path.join(OUT2, 'motion-keyframes-v2.png'));

  // 2. the four stages, the same hello and celebrate (a wisp soft and imprecise with tiny hops → formed)
  const stageRows: V2Row[] = [];
  for (const st of [1, 2, 3, 4] as Stage[]) stageRows.push({ label: `stage ${st} · hello`, look: cloud, stage: st, start: fire({ type: 'hello', firstName: 'Reza' }), at: [0, 60, 120, 180, 250, 330, 420, 520, 650, 800, 1000] });
  for (const st of [1, 4] as Stage[]) stageRows.push({ label: `stage ${st} · celebrate`, look: cloud, stage: st, start: fire({ type: 'celebrate', why: 'bond' }), at: [0, 80, 160, 240, 330, 430, 540, 660, 800, 1000, 1300] });
  const stageFrames = await Promise.all(stageRows.map(async (row) => { const r = await runV2(row); return { row, frames: r.frames, note: `${stats(r.frames)}` }; }));
  await png(v2Sheet('Stages motion v2 · cloud · the same hello on each stage, then celebrate on a wisp and a formed one',
    'wisp: slow springs, tiny hops, imprecise beats · puff: first real hops, more bounce · shaped: eye lead, darts · formed: snappiest, signatures', stageFrames), path.join(OUT2, 'stages-motion-v2.png'));

  // 3. rooms: each transition (the swap cue is ringed), each room's idle, a growth moment, the settle, rain, reduced
  const roomRows: V2Row[] = [];
  const from: Record<Room, Room> = { home: 'play', play: 'home', garden: 'play', closet: 'garden', bedroom: 'closet', book: 'bedroom' };
  for (const room of ['play', 'garden', 'closet', 'bedroom', 'book'] as Room[]) {
    roomRows.push({
      label: `→ ${room} · transition + idle`, look: bowBunny, warm: 900,
      setup: (e) => (e as unknown as PetMotionControls).setRoom(from[room], { instant: true }),
      start: (e) => (e as unknown as PetMotionControls).setRoom(room),
      at: [0, 30, 60, 100, 150, 200, 260, 340, 600, 1400, 2400],
    });
  }
  for (const room of ['play', 'garden', 'closet', 'bedroom', 'book'] as Room[]) {
    roomRows.push({
      label: `${room} · idle beat`, look: bowBunny, warm: 1200,
      setup: (e) => (e as unknown as PetMotionControls).setRoom(room, { instant: true }),
      start: (_e, priv) => priv.playBeats('roomIdle', 'idle', roomIdle(priv.ctx(), room), priv.clock.now()),
      at: [0, 150, 300, 450, 600, 800, 1000, 1200, 1400, 1700, 2000],
    });
  }
  roomRows.push({ label: 'growth moment (lit)', look: bowBunny, start: motion((m) => m.lightMoment({ fidget: 'release-planning' })), at: [0, 60, 120, 240, 400, 600, 750, 860, 1000, 1150, 1400] });
  roomRows.push({ label: 'Garden rain', look: bowBunny, warm: 1200, setup: motion((m) => m.setRoom('garden', { instant: true })), start: motion((m) => m.roomReact('rain')), at: [0, 90, 300, 500, 750, 1000, 1250, 1400, 1700, 1900, 2300] });
  roomRows.push({ label: 'Closet admire', look: bowBunny, warm: 1200, setup: motion((m) => m.setRoom('closet', { instant: true })), start: motion((m) => m.roomReact('admire')), at: [0, 60, 150, 300, 400, 480, 600, 750, 900, 1100, 1400] });
  roomRows.push({ label: 'reduced · → garden', look: bowBunny, tier: 'reduced', start: motion((m) => m.setRoom('garden')), at: [0, 60, 120, 200, 300, 500] });
  roomRows.push({ label: 'reduced · hello', look: bowBunny, tier: 'reduced', start: fire({ type: 'hello', firstName: 'Reza' }), at: [0, 60, 120, 200, 300, 500] });
  const roomFrames = await Promise.all(roomRows.map(async (row) => { const r = await runV2(row); return { row, frames: r.frames, note: `${stats(r.frames)}|${r.cues.join(' ')}` }; }));
  await png(v2Sheet('Rooms and transitions v2 · bunny with a bow · stage 4',
    'transition: eyes lead, 60 ms counter-lean, lean with the slide on an arc, the backdrop swaps (ringed), one-overshoot settle into the room pose', roomFrames), path.join(OUT2, 'rooms-transitions-v2.png'));
  console.log('v2 sheets → reports/character/{motion-keyframes,stages-motion,rooms-transitions}-v2.png');
}

if (process.argv.includes('--v2')) void v2(); else void main();
