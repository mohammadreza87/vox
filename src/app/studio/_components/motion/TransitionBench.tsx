'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { haptic } from '../../_lib/haptics';
import { screenVariants, type NavCtx, type NavKind } from '../../_lib/motion';

interface Card { id: number; layer: 'root' | 'page' | 'cover'; label: string; hue: string }
const HUES = ['#C3A6FF', '#8CC8FF', '#6FE0D0', '#FF9DB5', '#A8E07A', '#FFC24B'];
const TABS = ['Agents', 'Groups', 'Org', 'You'];

/**
 * Lab bench for the screen transitions: the real variants in a phone-sized stage, so push/pop
 * parallax, covers, shared-axis tabs, RTL mirroring and the reduced fallback can be judged on device.
 */
export function TransitionBench() {
  const seq = useRef(1);
  const [stack, setStack] = useState<Card[]>([{ id: 0, layer: 'root', label: 'Agents', hue: HUES[0] }]);
  const [tab, setTab] = useState(0);
  const [rtl, setRtl] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [nav, setNav] = useState<{ kind: NavKind; delta: number }>({ kind: 'replace', delta: 0 });
  const ctx: NavCtx = { ...nav, rtl, reduced };
  const top = stack[stack.length - 1];

  const go = (kind: NavKind, delta: number, next: Card[]) => { setNav({ kind, delta }); setStack(next); };
  const card = (layer: Card['layer'], label: string): Card => ({ id: seq.current++, layer, label, hue: HUES[seq.current % HUES.length] });
  const push = (cover: boolean) => { haptic.tap(); go(cover ? 'cover' : 'push', 1, [...stack, card(cover ? 'cover' : 'page', cover ? 'Cover' : `Page ${stack.length}`)]); };
  const back = () => { if (stack.length > 1) go(top.layer === 'cover' ? 'uncover' : 'pop', -1, stack.slice(0, -1)); };
  const switchTab = (i: number) => {
    if (stack.length > 1 || i === tab) return;
    haptic.select();
    setTab(i);
    go('tab', Math.sign(i - tab), [{ ...card('root', TABS[i]), hue: HUES[i] }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div dir={rtl ? 'rtl' : 'ltr'} style={{ position: 'relative', width: '100%', maxWidth: 260, aspectRatio: '9 / 16', overflow: 'hidden', borderRadius: 28, border: '1px solid var(--hair)', background: 'var(--ground)' }}>
        <AnimatePresence initial={false} custom={ctx}>
          <motion.div key={top.id} className="vx-screen" data-layer={top.layer} custom={ctx} variants={screenVariants} initial="initial" animate="enter" exit="exit"
            style={{ padding: 16, gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
              {stack.length > 1 && <button className="vx-chip" onClick={back}>{top.layer === 'cover' ? 'Close' : 'Back'}</button>}
              <span className="vx-head">{top.label}</span>
            </div>
            <div style={{ height: 96, borderRadius: 20, background: `radial-gradient(closest-side, ${top.hue}55, transparent)` }} />
            {[0, 1, 2].map((i) => <div key={i} className="vx-card" style={{ height: 40, borderRadius: 14 }} />)}
          </motion.div>
        </AnimatePresence>
        {stack.length === 1 && (
          <div style={{ position: 'absolute', insetInline: 0, bottom: 0, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', padding: '6px 4px 10px', background: 'rgba(22,25,30,.92)', borderTop: '1px solid var(--hair)', zIndex: 6 }}>
            {TABS.map((t, i) => (
              <button key={t} onClick={() => switchTab(i)} aria-current={i === tab ? 'page' : undefined} className="vx-tab" style={{ fontSize: 10 }}>
                <span className="vx-tab-pill" style={{ width: 36, height: 22 }}>{i === tab && <motion.span className="vx-tab-pill-bg" layoutId="bench-pill" />}</span>{t}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        <button className="vx-chip" onClick={() => push(false)}>Push</button>
        <button className="vx-chip" onClick={() => push(true)}>Cover</button>
        <button className="vx-chip" onClick={back} disabled={stack.length < 2}>Back</button>
        <button className="vx-chip" aria-pressed={rtl} onClick={() => setRtl((v) => !v)}>RTL</button>
        <button className="vx-chip" aria-pressed={reduced} onClick={() => setReduced((v) => !v)}>Reduced</button>
      </div>
      <span className="vx-small vx-3">Last: {nav.kind}{rtl ? ' · mirrored' : ''}{reduced ? ' · cross-fade' : ''}</span>
    </div>
  );
}
