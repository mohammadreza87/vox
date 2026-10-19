'use client';

import { useId } from 'react';
import type { AgentLook } from '../_lib/client';
import { mediaUrl } from '../_lib/client';
import { FAMILIES, PALETTE } from '@/lib/studio/cloud-art';

export type Expression = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'sleeping';

export { PALETTE };

interface CloudProps {
  look: Pick<AgentLook, 'hue' | 'family' | 'features'>;
  expr?: Expression;
  /** Forming stage 1–4: the face gains detail as the agent matures */
  stage?: number;
  size?: number;
  label?: string;
}

/** The live, animated cloud character (vector, so it can move and talk). */
export function Cloud({ look, expr = 'idle', stage = 4, size = 120, label = 'Agent' }: CloudProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pal = PALETTE[look.hue] ?? PALETTE.lilac;
  const fam = FAMILIES[look.family] ?? FAMILIES.puff;
  const features = look.features ?? { cheeks: true, lashes: false, brows: false };
  const st = Math.max(1, Math.min(4, stage));
  const { fx, fy } = fam;
  const happy = expr === 'happy' && st >= 3;
  const sleeping = expr === 'sleeping';
  const listening = expr === 'listening';
  const thinking = expr === 'thinking';
  const featureOn = st >= 3;
  const ey = 108 + fy;

  const lobes = fam.c.map(([cx, cy, r], i) => ({ cx, cy, r, op: st === 1 ? (i < 3 ? 1 : 0) : st === 2 ? (i === 0 ? 1 : 0.7) : 1 }));

  const eyes = [78 + fx, 122 + fx].map((x, i) => {
    let rx = 6.5, ry = 9, cx = x, cy = ey;
    if (st === 1) { rx = 4; ry = 4; } else if (st === 2) { rx = 5; ry = 7; }
    if (listening && st > 1) { rx = 7.5; ry = 11; }
    if (thinking) { cx = x - 4; cy = ey - 5; ry = Math.min(ry, 8); }
    const dir = i === 0 ? -1 : 1;
    const ox = x + dir * 5;
    return {
      x, cx, cy, rx, ry, dir, ox,
      arc: happy ? `M${x - 7} ${ey + 2} Q${x} ${ey - 6} ${x + 7} ${ey + 2}` : `M${x - 7} ${ey} Q${x} ${ey + 5} ${x + 7} ${ey}`,
    };
  });

  const mx = 100 + fx, my = 130 + fy;
  let mouth: 'smile' | 'filled' | 'talk' | 'dot' | 'none' = st >= 2 ? 'smile' : 'none';
  let mouthD = st === 2 ? `M${95 + fx} ${129 + fy} L${105 + fx} ${129 + fy}` : `M${92 + fx} ${128 + fy} Q${100 + fx} ${134 + fy} ${108 + fx} ${128 + fy}`;
  if (st >= 2) {
    if (expr === 'speaking') mouth = 'talk';
    else if (happy) { mouth = 'filled'; mouthD = `M${90 + fx} ${126 + fy} Q${100 + fx} ${140 + fy} ${110 + fx} ${126 + fy}Z`; }
    else if (thinking) mouthD = `M${94 + fx} ${129 + fy} L${104 + fx} ${127 + fy}`;
    else if (listening) mouthD = `M${96 + fx} ${129 + fy} L${104 + fx} ${129 + fy}`;
    else if (sleeping) mouth = 'dot';
  }
  const bodyClass = sleeping ? 'vx-breathe vx-slow' : happy ? 'vx-hop' : 'vx-breathe';
  const glowOp = listening ? 0.7 : expr === 'speaking' ? 0.65 : 0.45;
  const blink = st >= 2 && !sleeping && !happy ? 'vx-blink' : undefined;
  const g = `g${uid}`, f = `f${uid}`;

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={`${label}, ${expr}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <radialGradient id={g} gradientUnits="userSpaceOnUse" cx="78" cy="66" r="138">
          <stop offset="0" stopColor={pal.light} />
          <stop offset="0.55" stopColor={pal.base} />
          <stop offset="1" stopColor={pal.shadow} />
        </radialGradient>
        <filter id={f} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" /></filter>
      </defs>
      <g className={bodyClass} style={{ filter: sleeping ? 'saturate(.6)' : undefined }}>
        <g className="vx-glow" filter={`url(#${f})`} opacity={glowOp}>
          {lobes.map((l, i) => <circle key={i} cx={l.cx} cy={l.cy} r={l.r} fill={pal.glow} opacity={l.op} />)}
          <ellipse cx={fam.b[0]} cy={fam.b[1]} rx={fam.b[2]} ry={fam.b[3]} fill={pal.glow} />
        </g>
        {lobes.map((l, i) => <circle key={i} cx={l.cx} cy={l.cy} r={l.r} fill={`url(#${g})`} opacity={l.op} style={{ transition: 'opacity .9s' }} />)}
        <ellipse cx={fam.b[0]} cy={fam.b[1]} rx={fam.b[2]} ry={fam.b[3]} fill={`url(#${g})`} />
        {(features.cheeks || happy) && featureOn && (
          <>
            <ellipse cx={64 + fx} cy={122 + fy} rx={8} ry={5} fill={pal.shadow} opacity={happy ? 0.7 : 0.35} />
            <ellipse cx={136 + fx} cy={122 + fy} rx={8} ry={5} fill={pal.shadow} opacity={happy ? 0.7 : 0.35} />
          </>
        )}
        {eyes.map((e, i) => (
          <g key={i}>
            {happy || sleeping ? (
              <path d={e.arc} fill="none" stroke="#1A1C22" strokeWidth={3.5} strokeLinecap="round" />
            ) : (
              <g className={blink}>
                <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill="#1A1C22" style={{ transition: 'all .3s' }} />
                <circle cx={e.cx + 2} cy={e.cy - 3} r={listening ? 3 : st === 1 ? 1.2 : 2.2} fill="#fff" />
                {st === 4 && <circle cx={e.cx - 2} cy={e.cy + 3} r={1} fill="#fff" opacity={0.8} />}
              </g>
            )}
            {features.lashes && featureOn && !sleeping && (
              <path d={`M${e.ox} ${ey - 7} l${e.dir * 3.5} -2.5 M${e.ox + e.dir} ${ey - 4} l${e.dir * 4} -1`} fill="none" stroke="#1A1C22" strokeWidth={2.5} strokeLinecap="round" />
            )}
            {features.brows && featureOn && (
              <path d={`M${e.x - 5} ${93 + fy} L${e.x + 5} ${93 + fy + (i === 0 ? -1 : 1)}`} fill="none" stroke="#1A1C22" strokeWidth={3} strokeLinecap="round" opacity={0.6} />
            )}
          </g>
        ))}
        {mouth === 'smile' && <path d={mouthD} fill="none" stroke="#1A1C22" strokeWidth={3.5} strokeLinecap="round" />}
        {mouth === 'filled' && <path d={mouthD} fill="#1A1C22" />}
        {mouth === 'talk' && (
          <g className="vx-talk">
            <ellipse cx={mx} cy={my} rx={8} ry={7} fill="#1A1C22" />
            <ellipse cx={mx} cy={my + 3} rx={4.5} ry={2.6} fill={pal.shadow} />
          </g>
        )}
        {mouth === 'dot' && <circle cx={mx} cy={my} r={2} fill="#1A1C22" />}
        {listening && st >= 2 && <circle cx={152} cy={92} r={14} fill={`url(#${g})`} />}
      </g>
      {thinking && (
        <g className="vx-orbit">
          <circle cx={150} cy={46} r={3} fill={pal.light} />
          <circle cx={162} cy={67} r={2.5} fill={pal.light} />
          <circle cx={138} cy={67} r={2} fill={pal.light} />
        </g>
      )}
      {sleeping && (
        <>
          <circle className="vx-rise" cx={150} cy={70} r={3} fill={pal.light} />
          <circle className="vx-rise vx-d1" cx={158} cy={62} r={2.4} fill={pal.light} />
          <circle className="vx-rise vx-d2" cx={164} cy={54} r={1.8} fill={pal.light} />
        </>
      )}
    </svg>
  );
}

/** Stage of the progressive face from the forming day (1–7) */
export function stageFor(formingDay: number | null, status: string): number {
  if (status === 'draft' || status === 'awaiting_bot') return 4;
  if (formingDay === null) return 4;
  return formingDay <= 2 ? 1 : formingDay <= 4 ? 2 : formingDay <= 6 ? 3 : 4;
}

/** Still avatar (generated or custom) when set; otherwise the live cloud. */
export function AgentFace({ look, size, expr, stage, label, preferCloud }: CloudProps & { preferCloud?: boolean }) {
  const avatar = (look as AgentLook).avatar;
  if (avatar && !preferCloud) {
    const pal = PALETTE[look.hue] ?? PALETTE.lilac;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={mediaUrl(avatar)} alt={label ?? 'Avatar'} width={size} height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block', boxShadow: `0 0 0 3px ${pal.base}33` }} />
    );
  }
  return <Cloud look={look} size={size} expr={expr} stage={stage} label={label} />;
}
