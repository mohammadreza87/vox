'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { api, haptic, tg, type AgentView } from '../../_lib/client';
import { learningApi } from '../../_lib/learning-client';
import { preferenceLearningApi } from '../../_lib/preference-learning-client';
import type { ClientObservationInput } from '@/lib/adaptive/observation/contracts';
import { predictionHttpTransport } from '@/lib/adaptive/prediction/client';
import { VoicePartialConsumer, type VoicePartialCapability } from '@/lib/adaptive/prediction/voice-client';
import { VoicePreparationPanel } from '../VoicePreparationPanel';
import { TaskOutcome } from '../TaskOutcome';
import { Cloud, PALETTE, stageFor, type Expression } from '../Cloud';
import { errorMessage, LoadingFill, useNav } from '../StudioApp';
import { Icon, TopBar } from '../ui';

type Phase = 'ready' | 'listening' | 'thinking' | 'speaking';
type LiveSession = { endSession(): Promise<void>; setMicMuted(muted: boolean): void; getInputVolume(): number };
interface Line { who: 'you' | 'agent'; text: string }

const EXPR: Record<Phase, Expression> = { ready: 'idle', listening: 'listening', thinking: 'thinking', speaking: 'speaking' };
const HINT: Record<Phase, string> = { ready: 'Tap to talk', listening: 'Listening — tap to send', thinking: 'Thinking…', speaking: 'Tap to interrupt' };
const LIVE_HINT: Record<Phase, string> = { ready: 'Tap to start the call', listening: 'Listening…', thinking: 'Connecting…', speaking: 'Speaking — just talk to interrupt' };

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
  const [space, setSpace] = useState<'work' | 'personal'>('work');
  const [locale, setLocale] = useState<'en' | 'fa'>('en');
  const [partialCapability, setPartialCapability] = useState<VoicePartialCapability>();
  const [prepareWhileSpeaking, setPrepareWhileSpeaking] = useState(false);
  const [feedbackTurnId, setFeedbackTurnId] = useState<string | null>(null);
  const partial = useRef<VoicePartialConsumer | null>(null);
  useEffect(() => () => { void preferenceLearningApi.cancel(space, id); }, [id, space]);
  const changePreparation = (value: boolean) => {
    partial.current?.setOptIn(value);
    setPrepareWhileSpeaking(value && partialCapability?.available === true);
  };

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const cancelled = useRef(false);
  const generation = useRef(0);
  const playback = useRef<{ agentId: string; space: 'work' | 'personal'; turnId: string; generation: number; requestedAt: number; outcomes: Set<ClientObservationInput['outcome']> } | null>(null);
  const clearPlayback = () => {
    playback.current = null;
    if (player.current) {
      player.current.onplaying = null; player.current.onended = null; player.current.onerror = null;
      player.current.pause();
    }
  };
  const reportPlayback = (outcome: ClientObservationInput['outcome']) => {
    const turn = playback.current;
    if (!turn || !turn.turnId || turn.generation !== generation.current || cancelled.current || turn.outcomes.has(outcome)) return;
    turn.outcomes.add(outcome);
    // Optional evidence must never affect the call, including when reporting is unavailable.
    try { void learningApi.event({ eventId: crypto.randomUUID(), agentId: turn.agentId, space: turn.space, turnId: turn.turnId, outcome,
      durationMs: Math.min(86_400_000, Math.max(0, performance.now() - turn.requestedAt)) }).catch(() => undefined); }
    catch { /* best effort */ }
  };
  // Live mode: ElevenLabs streams both ways and handles turn-taking.
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const micMuted = useRef(false);
  const session = useRef<LiveSession | null>(null);
  const liveMeter = useRef<number | null>(null);
  const liveUnavailable = useRef(false);
  const liveGeneration = useRef(0);

  useEffect(() => {
    // Reset on (re)mount: React StrictMode runs this effect's cleanup once in dev.
    cancelled.current = false;
    const current = ++generation.current;
    const active = () => !cancelled.current && generation.current === current;
    if (agent?.id !== id) setAgent(null);
    setPhase('ready'); setLines([]); setLive(false); liveUnavailable.current = false;
    setFeedbackTurnId(null); setPrepareWhileSpeaking(false); setPartialCapability(undefined);
    micMuted.current = false; setMuted(false);
    api.agent(id).then((r) => { if (active()) setAgent(r.agent); }).catch((e) => { if (active()) { nav.toast(errorMessage(e), 'error'); nav.back(); } });
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(t);
      // Navigation can unmount the screen without the explicit hang-up handler.
      // Record only audio that actually started, while its captured turn is valid.
      if (playback.current?.outcomes.has('playback_started')) reportPlayback('interrupted');
      cancelled.current = true;
      generation.current = current + 1;
      clearPlayback();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((tr) => tr.stop());
      if (meter.current) { cancelAnimationFrame(meter.current.raf); void meter.current.ctx.close(); }
      recorder.current = null;
      stream.current = null;
      meter.current = null;
      void endLive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, space]);

  const ensureStream = async (current: number) => {
    if (stream.current) return stream.current;
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (cancelled.current || generation.current !== current) { s.getTracks().forEach(tr => tr.stop()); return null; }
    stream.current = s;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (cancelled.current || generation.current !== current) return;
        analyser.getByteFrequencyData(data);
        setLevel(data.reduce((a, b) => a + b, 0) / data.length / 128);
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };
      meter.current = { ctx, raf: requestAnimationFrame(tick) };
    } catch { /* level meter is decorative */ }
    return s;
  };

  const start = async () => {
    const current = generation.current;
    const turnAgentId = id; const turnSpace = space;
    setFeedbackTurnId(null);
    // A user gesture unlocks playback for the replies that follow.
    if (!player.current) { player.current = new Audio(); player.current.play().catch(() => undefined); }
    try {
      const s = await ensureStream(current);
      if (!s || cancelled.current || generation.current !== current) return;
      const mime = pickMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      const recordedChunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
      rec.onstop = () => { if (!cancelled.current && generation.current === current) void send(new Blob(recordedChunks, { type: rec.mimeType || mime || 'audio/webm' }), turnAgentId, turnSpace, current); };
      rec.start();
      recorder.current = rec;
      haptic.tap();
      setPhase('listening');
    } catch {
      if (cancelled.current || generation.current !== current) return;
      haptic.error();
      nav.toast('Microphone access is needed for calls.', 'error');
    }
  };

  const send = async (blob: Blob, turnAgentId: string, turnSpace: 'work' | 'personal', current: number) => {
    const active = () => !cancelled.current && generation.current === current;
    if (!active()) return;
    if (blob.size < 2000) { setPhase('ready'); return; }
    setPhase('thinking');
    try {
      const requestedAt = performance.now();
      const r = await api.callTurn(turnAgentId, blob, turnSpace);
      if (!active()) return;
      if (!r.transcript) { nav.toast("Didn't catch that — try again."); setPhase('ready'); return; }
      setLines((l) => [...l, { who: 'you', text: r.transcript }, { who: 'agent', text: r.reply }]);
      setFeedbackTurnId(r.turnId ?? null);
      if (r.audio && player.current) {
        clearPlayback();
        const p = player.current;
        const turn = { agentId: turnAgentId, space: turnSpace, turnId: r.turnId ?? '', generation: current, requestedAt, outcomes: new Set<ClientObservationInput['outcome']>() };
        playback.current = turn;
        const currentPlayback = () => active() && player.current === p && playback.current === turn;
        p.onplaying = () => { if (currentPlayback()) reportPlayback('playback_started'); };
        p.onended = () => { if (currentPlayback()) { reportPlayback('playback_completed'); clearPlayback(); setPhase('ready'); } };
        p.onerror = () => { if (currentPlayback()) { reportPlayback('playback_failed'); clearPlayback(); setPhase('ready'); } };
        p.src = `data:audio/mpeg;base64,${r.audio}`;
        setPhase('speaking');
        await p.play().catch(() => { if (currentPlayback()) { reportPlayback('playback_failed'); clearPlayback(); setPhase('ready'); } });
      } else {
        setPhase('ready');
      }
    } catch (e) {
      if (!active()) return;
      haptic.error();
      nav.toast(errorMessage(e), 'error');
      setPhase('ready');
    }
  };

  const endLive = async () => {
    liveGeneration.current++;
    partial.current?.dispose(); partial.current = null;
    const s = session.current;
    if (!s) return;
    session.current = null;
    if (liveMeter.current) cancelAnimationFrame(liveMeter.current);
    await s.endSession().catch(() => undefined);
    void api.callEnd(id, space).catch(() => undefined);
  };

  /** Opens a live call; returns false when the server only supports tap-to-talk. */
  const startLive = async (): Promise<boolean> => {
    if (liveUnavailable.current) return false;
    const current = generation.current;
    const liveEpoch = ++liveGeneration.current;
    const active = () => !cancelled.current && generation.current === current && liveGeneration.current === liveEpoch;
    setPhase('thinking');
    try {
      const call = await api.liveCall(id, space);
      if (!active()) return true;
      if (!call.live) { liveUnavailable.current = true; setPhase('ready'); return false; }
      partial.current?.dispose();
      const voicePartial = new VoicePartialConsumer({ ...predictionHttpTransport(() => tg()?.initData ?? ''),
        agentId: id, space, sessionId: crypto.randomUUID(), capability: call.partialPrediction });
      partial.current = voicePartial;
      micMuted.current = false; setMuted(false);
      setPartialCapability(call.partialPrediction); setPrepareWhileSpeaking(false); setFeedbackTurnId(null);
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
      if (!active()) return true;
      const { Conversation } = await import('@elevenlabs/client');
      if (!active()) return true;
      const conv = await Conversation.startSession({
        signedUrl: call.signedUrl,
        customLlmExtraBody: { call: call.callToken },
        overrides: { agent: { firstMessage: call.firstMessage, ...(call.language ? { language: call.language as never } : {}) }, tts: { voiceId: call.voiceId } },
        onModeChange: ({ mode }) => { if (active()) { voicePartial.setListening(mode === 'listening' && !micMuted.current); setPhase(mode === 'speaking' ? 'speaking' : 'listening'); } },
        onDebug: event => { if (active()) voicePartial.onDebug(event); },
        onInterruption: () => { if (active()) voicePartial.cancel(); },
        onMessage: ({ message, role }) => { if (active()) {
          if (role === 'user') voicePartial.finishTurn();
          if (message.trim()) setLines((l) => [...l, { who: role === 'user' ? 'you' : 'agent', text: message }]);
        } },
        onError: (message) => { if (active()) { voicePartial.dispose(); setPartialCapability(undefined); setPrepareWhileSpeaking(false); nav.toast(message || 'The call dropped.', 'error'); } },
        onDisconnect: () => { if (active()) { voicePartial.dispose(); setPartialCapability(undefined); setPrepareWhileSpeaking(false);
          if (session.current) { session.current = null; setPhase('ready'); void api.callEnd(id, space).catch(() => undefined); }
        } },
      });
      if (!active()) { await conv.endSession(); return true; }
      session.current = conv;
      setLive(true);
      setSeconds(0);
      setPhase('listening');
      haptic.success();
      const tick = () => {
        if (!active()) return;
        setLevel(Math.min(1, (session.current?.getInputVolume() ?? 0) * 2));
        liveMeter.current = requestAnimationFrame(tick);
      };
      liveMeter.current = requestAnimationFrame(tick);
      return true;
    } catch (e) {
      if (!active()) return true;
      partial.current?.dispose(); setPartialCapability(undefined); setPrepareWhileSpeaking(false);
      haptic.error();
      nav.toast(e instanceof DOMException ? 'Microphone access is needed for calls.' : errorMessage(e), 'error');
      setPhase('ready');
      return true;
    }
  };

  const toggleMute = () => {
    if (!session.current) return;
    haptic.select();
    const next = !micMuted.current;
    session.current.setMicMuted(next); micMuted.current = next;
    partial.current?.setListening(!next && phase === 'listening');
    setMuted(next);
  };

  const tap = () => {
    if (live) {
      if (session.current) toggleMute();
      else void startLive();
      return;
    }
    if (phase === 'ready') void startLive().then((handled) => { if (!handled && !cancelled.current) void start(); });
    else if (phase === 'listening') { haptic.soft(); recorder.current?.stop(); }
    else if (phase === 'speaking') { reportPlayback('interrupted'); clearPlayback(); setPhase('ready'); void start(); }
  };

  const hangUp = () => { haptic.heavy(); reportPlayback('interrupted'); clearPlayback(); void endLive(); nav.back(); };

  if (!agent) return <><TopBar onBack={nav.back} /><LoadingFill /></>;
  const pal = PALETTE[agent.look.hue];
  const last = lines.slice(-2);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflowY: 'auto' }}>
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

      <div role="group" aria-label="Conversation space" style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '12px 16px', position: 'relative' }}>
        {(['work', 'personal'] as const).map(value => <button key={value} className="vx-chip" disabled={phase !== 'ready' || !!session.current} aria-pressed={space === value} onClick={() => { setSpace(value); setLines([]); setLive(false); liveUnavailable.current = false; }}>{value === 'work' ? 'Work' : 'Personal'}</button>)}
        <button className="vx-chip" onClick={() => nav.push({ name: 'privacy' })}>Privacy</button>
      </div>
      <div style={{ padding: '0 24px', position: 'relative' }}>
        <label className="vx-small">Language / زبان <select value={locale} onChange={event => setLocale(event.target.value as 'en' | 'fa')}>
          <option value="en">English</option><option value="fa">فارسی</option>
        </select></label>
      </div>
      <VoicePreparationPanel capability={partialCapability} enabled={prepareWhileSpeaking} onChange={changePreparation} locale={locale} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', gap: 18 }}>
        <motion.div animate={{ scale: phase === 'listening' ? 1 + level * 0.08 : 1 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
          <Cloud look={agent.look} size={220} expr={EXPR[phase]} stage={stageFor(agent.formingDay, agent.status)} label={agent.persona.name} />
        </motion.div>
        <AnimatePresence mode="wait">
          <motion.div key={phase} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="vx-small vx-2" aria-live="polite">
            {live ? (muted && session.current ? 'Muted — tap the mic to talk' : LIVE_HINT[phase]) : HINT[phase]}
          </motion.div>
        </AnimatePresence>
      </div>
      {feedbackTurnId && !live && <div style={{ padding: '0 24px', position: 'relative' }}>
        <TaskOutcome key={`${id}:${space}:${feedbackTurnId}`} agentId={id} space={space} turnId={feedbackTurnId} locale={locale} />
      </div>}

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
          aria-label={live && session.current ? (muted ? 'Unmute' : 'Mute') : phase === 'listening' ? 'Send' : 'Talk'}
          aria-pressed={live && session.current ? muted : undefined}
          animate={{ background: phase === 'listening' && !muted ? '#D6FF5C' : '#1E2228', color: phase === 'listening' && !muted ? '#0E1013' : '#F2F1EC',
            boxShadow: phase === 'listening' ? `0 0 0 ${6 + level * 18}px rgba(214,255,92,.18)` : '0 0 0 0 rgba(214,255,92,0)' }}
          transition={{ duration: 0.12 }}
          style={{ width: 84, height: 84, borderRadius: '50%', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: phase === 'thinking' ? 0.5 : 1 }}>
          <Icon name={live && session.current ? (muted ? 'micOff' : 'mic') : phase === 'listening' ? 'send' : 'mic'} size={32} width={2} />
        </motion.button>
        <motion.button onClick={hangUp} whileTap={{ scale: 0.92 }} aria-label="End call"
          style={{ width: 56, height: 56, borderRadius: '50%', border: 'none', background: '#FF6B5E', color: '#0E1013', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name="end" size={24} width={2} style={{ transform: 'rotate(135deg)' }} />
        </motion.button>
      </div>
    </div>
  );
}
