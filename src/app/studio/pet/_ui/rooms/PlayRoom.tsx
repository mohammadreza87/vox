'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TIRED_BELOW } from '@/lib/pet/types';
import type { RoundOutcome } from '@/lib/pet/play';
import { BallIcon } from '../Particles';
import { t } from '../strings';
import type { RoomProps } from '.';
import { STARFALL, StarfallRound, roundId } from './starfall';
import './rooms.css';

/** The pips (§4.2): progress as lit dots, never a digit; the screen reader hears "Round progress". */
export function Pips({ on, of = STARFALL.pips }: { on: number; of?: number }) {
  return (
    <div className="pet-pips" role="img" aria-label={t('play.starfall.pips')}>
      {Array.from({ length: of }, (_, i) => <i key={i} data-on={i < on ? '' : undefined} />)}
    </div>
  );
}

const StarIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" fill="#FFE27A" /></svg>;
const ZenIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 16a4 4 0 0 1 .6-8 5 5 0 0 1 9.6 1.4A3.3 3.3 0 0 1 17 16z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;

type Phase = 'pick' | 'play' | 'end';

/**
 * Play (design §4.2, S8, S9): a picker (Bop, Starfall, the Zen switch), then Starfall over the stage. Finishing a round
 * sends the existing `play` care action once (Joy and Energy by the existing rules, the tired guard included) and the
 * outcome enum as a `gameRound` play op; the pet reacts in its own voice from the catalogue, never a model call.
 */
export default function PlayRoom({ host }: RoomProps) {
  const v = host?.view();
  const reduced = host?.root()?.dataset.tier === 'reduced';
  const [zen, setZen] = useState<boolean>(() => v?.play?.games.starfall?.zen ?? reduced);
  const [phase, setPhase] = useState<Phase>('pick');
  const [pips, setPips] = useState(0);
  const [best, setBest] = useState(false);
  const round = useRef<StarfallRound | null>(null);
  const stars = useRef<(HTMLDivElement | null)[]>([]);
  const stop = useRef<(() => void) | null>(null);
  const startedAt = useRef(0);
  const care = host?.care();
  const tired = !!care && care.energy < TIRED_BELOW;

  useEffect(() => () => { stop.current?.(); }, []);
  useEffect(() => { host?.busy('game', phase === 'play'); return () => host?.busy('game', false); }, [host, phase]);
  if (!host) return null;
  const stageEl = host.root()?.querySelector<HTMLElement>('.pet-stage') ?? null;
  const charEl = () => host.root()?.querySelector<HTMLElement>('.pet-char') ?? null;
  const e = () => host.engine();

  const end = (r: StarfallRound) => {
    stop.current?.();
    stop.current = null;
    const ms = performance.now() - startedAt.current;
    const isZen = zen;
    const isBest = !isZen && r.caught >= STARFALL.pips && !v?.play?.games.starfall?.best;
    const outcome: RoundOutcome = isZen ? 'zen' : isBest ? 'best' : 'finished';
    // one round, one play action (Joy and Energy by the existing care rules)
    host.act('play');
    const req = { op: 'gameRound' as const, game: 'starfall' as const, outcome, round: roundId() };
    void host.play(req).then((ok) => { if (!ok) setTimeout(() => void host.play(req), 3000); });
    e()?.setGaze?.(null);
    e()?.roomReact?.('roundEnd', { won: isZen || r.won, zen: isZen });
    host.say(t(isZen ? 'play.starfall.zenEnd' : r.won ? 'play.starfall.good' : 'play.starfall.nearMiss'));
    host.emit({ type: 'round', ms, zen: isZen });
    setBest(isBest);
    setPhase(isZen ? 'pick' : 'end');
  };

  const start = () => {
    if (tired) {
      // the care rule (Energy < TIRED_BELOW): a yawn and "Nap first?", never a block on anything else
      e()?.fire({ type: 'refuse', why: 'tired' });
      host.say(t('say.napFirst'));
      return;
    }
    const box = host.box();
    const field = stageEl?.getBoundingClientRect();
    const w = field?.width || window.innerWidth;
    const reach = Math.min(w / 2 - 24, box.size * 1.1);
    const cx0 = box.x + box.size / 2;
    const r = new StarfallRound({ x0: cx0 - reach, x1: cx0 + reach, y0: -20, catchY: box.y + box.size * 0.38, size: box.size, zen, reduced });
    round.current = r;
    setPips(0);
    setBest(false);
    setPhase('play');
    host.say(t(v?.play?.games.starfall ? 'play.starfall.start' : 'play.starfall.howTo'));
    let dx = 0, target = 0, last = performance.now(), nearAt = -Infinity, raf = 0;
    startedAt.current = last;
    const onMove = (ev: PointerEvent) => { const f = stageEl?.getBoundingClientRect(); target = Math.max(-reach, Math.min(reach, ev.clientX - (f?.left ?? 0) - cx0)); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') target = Math.max(-reach, Math.min(reach, target + (ev.key === 'ArrowLeft' ? -40 : 40))); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    window.addEventListener('keydown', onKey);
    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const prev = dx;
      dx += (target - dx) * Math.min(1, (dt / 1000) * 12);
      const c = charEl();
      if (c) {
        c.style.translate = `${dx}px 0`;
        // a lean with the drag's speed (the body's own springs carry the rest); none on reduced motion
        c.style.rotate = reduced ? '' : `${Math.max(-8, Math.min(8, ((dx - prev) / Math.max(1, dt)) * 6))}deg`;
      }
      for (const ev of r.step(dt, cx0 + dx)) {
        if (ev.type === 'catch') { e()?.roomReact?.('catch', { zen }); setPips(r.pips); }
        if (ev.type === 'nearMiss' && now - nearAt > 2500) { nearAt = now; e()?.roomReact?.('nearMiss', { zen }); }
      }
      // the eyes follow the star closest to the mouth line (the gaze system; a finger still wins)
      let near: (typeof r.stars)[number] | null = null;
      for (const s of r.stars) if (s.y < box.y + box.size * 0.38 && (!near || s.y > near.y)) near = s;
      e()?.setGaze?.(near ? { x: near.x, y: near.y } : null);
      r.stars.forEach((s, i) => { const el = stars.current[i]; if (el) { el.style.transform = `translate(${s.x}px, ${s.y}px)`; el.style.opacity = '1'; } });
      for (let i = r.stars.length; i < STARFALL.maxStars; i++) { const el = stars.current[i]; if (el) el.style.opacity = '0'; }
      if (r.over) { end(r); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    stop.current = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      window.removeEventListener('keydown', onKey);
      const c = charEl();
      if (c) { c.style.transition = 'translate .4s var(--ease-out), rotate .4s var(--ease-out)'; c.style.translate = ''; c.style.rotate = ''; setTimeout(() => { c.style.transition = ''; }, 450); }
    };
  };

  const toggleZen = () => setZen((z) => !z);

  if (phase === 'play') {
    return (
      <>
        {stageEl && createPortal(
          <div className="pet-field" role="application" aria-label={t('play.starfall.howTo')}>
            {Array.from({ length: STARFALL.maxStars }, (_, i) => <div key={i} ref={(d) => { stars.current[i] = d; }} className="pet-star" style={{ opacity: 0 }} />)}
            {!zen && <Pips on={pips} />}
          </div>, stageEl)}
        <div className="pet-verbs">
          <button type="button" className="pet-verb" aria-pressed={zen} title={t('play.starfall.zenOn')} disabled><i><ZenIcon /></i><span>{t('play.zen')}</span></button>
          <button type="button" className="pet-link" onClick={() => { const r = round.current; if (r) end(r); }}>{t('play.done')}</button>
        </div>
      </>
    );
  }
  if (phase === 'end') {
    return (
      <div className="pet-verbs">
        {best && <span className="pet-hint" role="status">{t('play.bestPage')}</span>}
        <button type="button" className="pet-link" onClick={start}>{t('play.again')}</button>
        <button type="button" className="pet-link" onClick={() => setPhase('pick')}>{t('play.done')}</button>
      </div>
    );
  }
  return (
    <div className="pet-verbs" data-room="play">
      <button type="button" className="pet-verb" data-tired={tired ? '' : undefined} onClick={() => host.toyEvent({ type: 'ballTap' })}>
        <i><BallIcon /></i><span>{t('toy.play.bop')}</span>
      </button>
      <button type="button" className="pet-verb" data-tired={tired ? '' : undefined} onClick={start}>
        <i><StarIcon /></i><span>{t('play.starfall.title')}</span>
      </button>
      <button type="button" className="pet-verb" aria-pressed={zen} title={t('play.starfall.zenOn')} onClick={toggleZen}>
        <i><ZenIcon /></i><span>{t('play.zen')}</span>
      </button>
      {tired && <button type="button" className="pet-link" onClick={() => host.setRoom('bedroom')}>{t('play.toBedroom')}</button>}
    </div>
  );
}
