'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { api, haptic, type AgentView } from '../../_lib/client';
import { Cloud, PALETTE, stageFor, type Expression } from '../Cloud';
import { errorMessage, LoadingFill, useNav } from '../StudioApp';
import { Icon, TopBar } from '../ui';

type Phase = 'ready' | 'listening' | 'thinking' | 'speaking';
interface Line { who: 'you' | 'agent'; text: string }

const EXPR: Record<Phase, Expression> = { ready: 'idle', listening: 'listening', thinking: 'thinking', speaking: 'speaking' };
const HINT: Record<Phase, string> = { ready: 'Tap to talk', listening: 'Listening — tap to send', thinking: 'Thinking…', speaking: 'Tap to interrupt' };

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function CallScreen({ id }: { id: string }) {
  const nav = useNav();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [lines, setLines] = useState<Line[]>([]);
  const [captions, setCaptions] = useState(true);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const player = useRef<HTMLAudioElement | null>(null);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    api.agent(id).then((r) => setAgent(r.agent)).catch((e) => { nav.toast(errorMessage(e), 'error'); nav.back(); });
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(t);
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((tr) => tr.stop());
      player.current?.pause();
      if (meter.current) { cancelAnimationFrame(meter.current.raf); void meter.current.ctx.close(); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const ensureStream = async () => {
    if (stream.current) return stream.current;
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    stream.current = s;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setLevel(data.reduce((a, b) => a + b, 0) / data.length / 128);
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };
      meter.current = { ctx, raf: requestAnimationFrame(tick) };
    } catch { /* level meter is decorative */ }
    return s;
  };

  const start = async () => {
    // A user gesture unlocks playback for the replies that follow.
    if (!player.current) { player.current = new Audio(); player.current.play().catch(() => undefined); }
    try {
      const s = await ensureStream();
      const mime = pickMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => void send(new Blob(chunks.current, { type: rec.mimeType || mime || 'audio/webm' }));
      rec.start();
      recorder.current = rec;
      haptic.tap();
      setPhase('listening');
    } catch {
      haptic.error();
      nav.toast('Microphone access is needed for calls.', 'error');
    }
  };

  const send = async (blob: Blob) => {
    if (cancelled.current) return;
    if (blob.size < 2000) { setPhase('ready'); return; }
    setPhase('thinking');
    try {
      const r = await api.callTurn(id, blob);
      if (cancelled.current) return;
      if (!r.transcript) { nav.toast("Didn't catch that — try again."); setPhase('ready'); return; }
      setLines((l) => [...l, { who: 'you', text: r.transcript }, { who: 'agent', text: r.reply }]);
      if (r.audio && player.current) {
        const p = player.current;
        p.src = `data:audio/mpeg;base64,${r.audio}`;
        p.onended = () => setPhase('ready');
        setPhase('speaking');
        await p.play().catch(() => setPhase('ready'));
      } else {
        setPhase('ready');
      }
    } catch (e) {
      haptic.error();
      nav.toast(errorMessage(e), 'error');
      setPhase('ready');
    }
  };

  const tap = () => {
    if (phase === 'ready') void start();
    else if (phase === 'listening') { haptic.soft(); recorder.current?.stop(); }
    else if (phase === 'speaking') { player.current?.pause(); setPhase('ready'); void start(); }
  };

  const hangUp = () => { haptic.heavy(); nav.back(); };

  if (!agent) return <><TopBar onBack={nav.back} /><LoadingFill /></>;
  const pal = PALETTE[agent.look.hue];
  const last = lines.slice(-2);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <motion.div aria-hidden="true" animate={{ scale: phase === 'speaking' ? [1, 1.12, 1] : phase === 'listening' ? 1 + level * 0.25 : 1, opacity: phase === 'ready' ? 0.18 : 0.32 }}
        transition={phase === 'speaking' ? { duration: 1.4, repeat: Infinity } : { duration: 0.12 }}
        style={{ position: 'absolute', top: '22%', left: '50%', width: 360, height: 360, marginLeft: -180, borderRadius: '50%', background: `radial-gradient(circle, ${pal.glow}, transparent 65%)`, filter: 'blur(20px)' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0', position: 'relative' }}>
        <button className="vx-icon-btn" aria-label="Minimize" onClick={nav.back}><Icon name="back" /></button>
        <div style={{ textAlign: 'center' }}>
          <div className="vx-head">{agent.persona.name}</div>
          <div className="vx-small vx-2 vx-num">{agent.persona.role} · {mm}:{ss}</div>
        </div>
        <button className="vx-icon-btn" aria-label={captions ? 'Hide captions' : 'Show captions'} aria-pressed={captions} onClick={() => setCaptions((c) => !c)}
          style={{ color: captions ? '#D6FF5C' : undefined }}><Icon name="captions" /></button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', gap: 18 }}>
        <motion.div animate={{ scale: phase === 'listening' ? 1 + level * 0.08 : 1 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
          <Cloud look={agent.look} size={220} expr={EXPR[phase]} stage={stageFor(agent.formingDay, agent.status)} label={agent.persona.name} />
        </motion.div>
        <AnimatePresence mode="wait">
          <motion.div key={phase} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="vx-small vx-2" aria-live="polite">
            {HINT[phase]}
          </motion.div>
        </AnimatePresence>
      </div>

      <div style={{ minHeight: 120, padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-end', position: 'relative' }}>
        <AnimatePresence initial={false}>
          {captions && last.map((l, i) => (
            <motion.p key={`${lines.length}-${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: l.who === 'agent' ? 1 : 0.6, y: 0 }} exit={{ opacity: 0 }}
              style={{ margin: 0, textAlign: 'center', fontSize: l.who === 'agent' ? 17 : 14, lineHeight: l.who === 'agent' ? '24px' : '19px',
                display: '-webkit-box', WebkitLineClamp: l.who === 'agent' ? 4 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {l.text}
            </motion.p>
          ))}
        </AnimatePresence>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40, padding: '24px 16px calc(28px + env(safe-area-inset-bottom))', position: 'relative' }}>
        <span style={{ width: 56 }} />
        <motion.button onClick={tap} disabled={phase === 'thinking'} whileTap={{ scale: 0.92 }}
          aria-label={phase === 'listening' ? 'Send' : 'Talk'}
          animate={{ background: phase === 'listening' ? '#D6FF5C' : '#1E2228', color: phase === 'listening' ? '#0E1013' : '#F2F1EC',
            boxShadow: phase === 'listening' ? `0 0 0 ${6 + level * 18}px rgba(214,255,92,.18)` : '0 0 0 0 rgba(214,255,92,0)' }}
          transition={{ duration: 0.12 }}
          style={{ width: 84, height: 84, borderRadius: '50%', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: phase === 'thinking' ? 0.5 : 1 }}>
          <Icon name={phase === 'listening' ? 'send' : 'mic'} size={32} width={2} />
        </motion.button>
        <motion.button onClick={hangUp} whileTap={{ scale: 0.92 }} aria-label="End call"
          style={{ width: 56, height: 56, borderRadius: '50%', border: 'none', background: '#FF6B5E', color: '#0E1013', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name="end" size={24} width={2} style={{ transform: 'rotate(135deg)' }} />
        </motion.button>
      </div>
    </div>
  );
}
