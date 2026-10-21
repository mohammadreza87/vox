/**
 * Motion keyframes contact sheet: the live rig's key poses rendered as stills from the same model and the
 * same pose numbers the rig plays (src/app/studio/_components/character/poses.ts), for visual review.
 *
 *   node --import tsx scripts/motion-keyframes.ts   # → reports/character/motion-keyframes.png
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BREATHE, EVOLVE, HOP, LISTEN, SHY, SQUISH, TALK, poseTransform, type BodyPose } from '../src/app/studio/_components/character/poses';
import {
  BEAK_DROP, GROUND_COLOR, RIG_LAYERS, beakLowerD, beakMouth, characterModel, mouthD, mouthOpenness, nodesToSvg, rootTransform, stageGrowth, talkMouth,
  type CharacterModel, type Expression, type RigLayer, type SvgNode,
} from '../src/lib/studio/character';
import type { CharacterLook, Stage } from '../src/lib/studio/types';

const OUT = path.resolve(__dirname, '../reports/character');
const LABEL = '#8A90A0';

interface Pose {
  label: string;
  expr?: Expression;
  stage?: Stage;
  body?: BodyPose;
  /** extra uniform scale about the ground (stage growth in flight) */
  grow?: number;
  /** face layer offset (gaze / counter-motion) and tilt */
  face?: { x?: number; y?: number; rot?: number };
  lid?: number;
  /** speaking openness 0..1 (lip-sync) */
  open?: number;
  /** shy blush scale (0 = none) */
  shy?: number;
  /** drift phase of the fx parts (0..1 through the CSS loop) */
  drift?: number;
}

const at = <T,>(a: readonly T[], i: number) => a[i];
const hop = (i: number): BodyPose => ({ sx: at(HOP.sx, i), sy: at(HOP.sy, i), y: at(HOP.y, i) });
const squish = (i: number): BodyPose => ({ sx: at(SQUISH.sx, i), sy: at(SQUISH.sy, i), rot: at(SQUISH.rot, i) });
const talk = (o: number, b: number): BodyPose => ({ sx: 1 - TALK.narrow * o, sy: 1 + TALK.stretch * o + TALK.bounceStretch * b, y: -(TALK.lift * o + TALK.bounceLift * b) });
const g34 = stageGrowth(3) / stageGrowth(4);

const POSES: Pose[] = [
  { label: 'breathe · low', body: BREATHE.low },
  { label: 'breathe · high', body: BREATHE.high },
  { label: 'blink', lid: 0.08 },
  { label: 'listening · lean in', expr: 'listening', body: { sx: LISTEN.sx, sy: LISTEN.sy }, face: { y: LISTEN.faceLift } },
  { label: 'thinking · puffs rise', expr: 'thinking', drift: 0.3 },
  { label: 'thinking · glance', expr: 'thinking', face: { x: -3.2 }, drift: 0.65 },
  { label: 'speaking · closed', expr: 'speaking', open: 0, body: talk(0, 0) },
  { label: 'speaking · half open', expr: 'speaking', open: 0.5, body: talk(0.5, 0) },
  { label: 'speaking · open + bounce', expr: 'speaking', open: 1, body: talk(1, 1) },
  { label: 'sleeping · breath', expr: 'sleeping', body: BREATHE.sleepHigh },
  { label: 'happy · anticipate', expr: 'happy', body: hop(1), face: { y: 1.5 } },
  { label: 'happy · hop apex', expr: 'happy', body: hop(2), face: { y: -1.5 } },
  { label: 'happy · land squash', expr: 'happy', body: hop(3), face: { y: 1.5 } },
  { label: 'tap · squish', expr: 'happy', body: squish(1), face: { y: 2 } },
  { label: 'tap · giggle wobble', expr: 'happy', body: squish(2), face: { y: -1 } },
  { label: 'long-press · shy', body: SHY.body, face: { x: SHY.gx, y: SHY.gy, rot: SHY.tilt }, lid: 0.82, shy: SHY.blushTo },
  { label: 'evolve · gather (3)', stage: 3, body: EVOLVE.gather, lid: 0.35, face: { y: 1.5 } },
  { label: 'evolve · puff (3→4)', stage: 4, body: EVOLVE.puff, grow: g34 + (1 - g34) * 0.6, face: { y: -1.5 } },
  { label: 'evolve · settle (4)', stage: 4, expr: 'happy', body: EVOLVE.land },
];

/** The fx drift loop (motion.css vxPuffDrift / vxZDrift), sampled: translate, scale, opacity. */
function drift(t: number): { x: number; y: number; s: number; o: number } {
  const p = ((t % 1) + 1) % 1;
  const o = p < 0.22 ? (p / 0.22) * 0.85 : p > 0.75 ? 0.85 * (1 - (p - 0.75) / 0.25) : 0.85;
  return { x: 2 * p, y: 5 - 13 * p, s: 0.55 + 0.57 * p, o };
}

function withDrift(nodes: SvgNode[], phase: number): SvgNode[] {
  return nodes.map((nd) => {
    const part = String(nd.attrs['data-part'] ?? '');
    if (!/^(puff|z)-/.test(part)) return nd;
    const d = drift(phase + (part.endsWith('2') ? 0.5 : 0));
    const [x, y] = String(nd.attrs.d).match(/M(-?[\d.]+) (-?[\d.]+)/)!.slice(1).map(Number);
    return { ...nd, attrs: { ...nd.attrs, opacity: Math.round(d.o * 100) / 100, transform: `translate(${d.x} ${d.y}) translate(${x} ${y}) scale(${d.s}) translate(${-x} ${-y})` } };
  });
}

function poseSvg(look: CharacterLook, p: Pose, uid: string): string {
  const m: CharacterModel = characterModel(look, { uid, mode: 'live', stage: p.stage ?? 4, expr: p.expr ?? 'idle', size: 200 });
  const [fx, ey] = m.pivots.face;
  const layer = (l: RigLayer): SvgNode[] => {
    let nodes = m.layers[l];
    if (l === 'face') {
      nodes = nodes.map((nd) => {
        if (nd.attrs['data-part'] === 'lids' && p.lid !== undefined) return { ...nd, attrs: { ...nd.attrs, transform: `translate(0 ${ey}) scale(1 ${p.lid}) translate(0 ${-ey})` } };
        if (p.open !== undefined) {
          // the rig's lip-sync: a beak species scales the lens to the beak and drops its lower mandible with it
          const t = talkMouth(p.open), bk = m.face.beak;
          const s = bk ? beakMouth(t) : t;
          if (nd.attrs['data-part'] === 'mouth') return { ...nd, attrs: { ...nd.attrs, d: mouthD(m.face.mouth.x, m.face.mouth.y, s) } };
          if (nd.attrs['data-part'] === 'beak-lo' && bk) return { ...nd, attrs: { ...nd.attrs, d: beakLowerD(bk.x, bk.top, bk.k, Math.round(mouthOpenness(t) * BEAK_DROP * bk.k * 10) / 10) } };
        }
        return nd;
      });
      if (p.shy) {
        const c = m.face.cheeks;
        nodes = [...c.x.map((x): SvgNode => ({ tag: 'ellipse', attrs: { cx: x, cy: c.y, rx: c.rx * 1.08 * p.shy!, ry: c.ry * 1.08 * p.shy!, fill: `url(#${uid}bl)` } })), ...nodes];
      }
    }
    if (l === 'fx' && p.drift !== undefined) nodes = withDrift(nodes, p.drift);
    return nodes;
  };
  const f = p.face ?? {};
  const faceT = `translate(${f.x ?? 0} ${f.y ?? 0}) rotate(${f.rot ?? 0} ${fx} ${ey})`;
  const body = RIG_LAYERS.filter((l) => m.layers[l].length)
    .map((l) => `<g data-rig="${l}"${l === 'face' ? ` transform="${faceT}"` : ''}>${nodesToSvg(layer(l))}</g>`).join('');
  const g = p.grow ?? 1;
  const pose = poseTransform(p.body ?? { sx: 1, sy: 1 });
  return `<defs>${nodesToSvg(m.defs)}</defs><g transform="${pose}"><g transform="translate(100 166) scale(${g}) translate(-100 -166)"><g transform="${rootTransform(m)}">${body}</g></g></g>`;
}

const LOOKS: Array<[string, CharacterLook]> = [
  ['lagoon cloud · glasses', { hue: 'lagoon', family: 'puff', species: 'cloud', accessory: 'glasses', features: { cheeks: true, lashes: false, brows: false } }],
  ['rose bunny · bow', { hue: 'rose', family: 'puff', species: 'bunny', accessory: 'bow', accent: 'coral', features: { cheeks: true, lashes: false, brows: true } }],
  // a beak species: the beak is the mouth, and talking drops its lower mandible
  ['matcha owl · beak', { hue: 'matcha', family: 'puff', species: 'owl', accessory: 'none', features: { cheeks: true, lashes: false, brows: false } }],
];

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const cols = 10, tile = 150, gap = 10, labelH = 18, left = 16, top = 52;
  const rowsPer = Math.ceil(POSES.length / cols);
  const W = left + cols * (tile + gap) + 6;
  const blockH = rowsPer * (tile + labelH + gap) + 26;
  const H = top + LOOKS.length * blockH + 8;
  const parts: string[] = [
    `<rect width="${W}" height="${H}" fill="${GROUND_COLOR}"/>`,
    `<text x="16" y="30" fill="#E6E8EE" font-family="Helvetica, Arial" font-size="16" font-weight="600">Motion keyframes · live rig poses (poses.ts) at stage 4 unless noted · ground origin (100, 166)</text>`,
  ];
  LOOKS.forEach(([name, look], li) => {
    const y0 = top + li * blockH;
    parts.push(`<text x="${left}" y="${y0 + 12}" fill="${LABEL}" font-family="Helvetica, Arial" font-size="13" font-weight="600">${name}</text>`);
    POSES.forEach((p, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = left + c * (tile + gap), y = y0 + 22 + r * (tile + labelH + gap);
      // a faint ground line, so lift and squash read against it
      parts.push(`<line x1="${x + 12}" x2="${x + tile - 12}" y1="${y + tile * 0.83 + 0.5}" y2="${y + tile * 0.83 + 0.5}" stroke="#2A3140" stroke-width="1"/>`);
      parts.push(`<svg x="${x}" y="${y}" width="${tile}" height="${tile}" viewBox="0 0 200 200" overflow="visible">${poseSvg(look, p, `k${li}x${i}`)}</svg>`);
      parts.push(`<text x="${x + tile / 2}" y="${y + tile + 13}" fill="${LABEL}" font-family="Helvetica, Arial" font-size="11" text-anchor="middle">${p.label}</text>`);
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
  const file = path.join(OUT, 'motion-keyframes.png');
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log(`  motion-keyframes.png  ${POSES.length * LOOKS.length} tiles`);
}

void main();
