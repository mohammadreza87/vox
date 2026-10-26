'use client';

import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import type { VoiceUi } from './host';
import type { Take } from './mic';
import { t } from './strings';

/** a mic press shorter than this is a tap: show the hint, send nothing */
const MIN_HOLD_MS = 350;
/** typing pauses longer than this get a micro-nod (§2.6 listening) */
const TYPING_PAUSE_MS = 700;
/** the recorder chunk is fetched this long after the pill mounts (never with the first paint), or on the first hold */
const MIC_PREFETCH_MS = 1500;

type MicModule = typeof import('./mic');
let micModule: MicModule | null = null;
let micLoading: Promise<MicModule> | null = null;
/** The hold-to-talk recorder (mic.ts), loaded once; a failed chunk is tried again on the next hold. */
export function loadMic(): Promise<MicModule> {
  micLoading ??= import('./mic').then((m) => (micModule = m), (e) => { micLoading = null; throw e; });
  return micLoading;
}

export interface TalkPillProps {
  name: string;
  /** a guest of a public agent: the pill opens the DM instead (§1.3) */
  guest?: boolean;
  onOpenDm?: () => void;
  /** a reply is in flight: sending waits */
  busy?: boolean;
  /** focus or mic press: the engine perks to listening synchronously (≤ 100 ms) */
  onListen: (source: 'text' | 'mic') => void;
  /** blurred with nothing typed and no reply in flight */
  onIdle: () => void;
  onTypingPause?: () => void;
  /** resolves false when the turn failed: the words come back into the field (never lost to a bad network) */
  onSend: (text: string) => void | Promise<boolean>;
  /** absent when the server cannot hear (no transcription provider): no mic is shown */
  onVoice?: (audio: Blob) => void;
  /** the mic level 0…1 while recording (listening swell) */
  onMicLevel?: (level: number) => void;
  /** held while recording (closing confirmation) */
  onRecording?: (on: boolean) => void;
  /** the page's one AudioContext (resumed on the first touch) for the mic meter */
  audioContext?: () => AudioContext | null;
  /** start_param `talk`: focus on open */
  autoFocus?: boolean;
  /** before a hold records: false stops it here (the UX-02 sheet opens instead, P3) */
  micGate?: () => boolean;
  /** hands-free (§8A.2): the switch, the open mic and what it hears */
  voice?: VoiceUi;
  onHandsFree?: () => void;
}

/**
 * The talk pill (§1.4): type, or hold the mic. Focus perks the character to listening in the same
 * handler; typing pauses nod; send clears and floats the words up as a chip. The mic asks for
 * permission only on the first hold, records with MediaRecorder in the first supported container
 * (mic.ts, its own chunk), and on any failure falls back to typing (the text field is always there).
 */
export const TalkPill = memo(function TalkPill(p: TalkPillProps) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [chip, setChip] = useState<{ id: number; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rec = useRef<Take | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  /** the finger is up (a release can land while the permission prompt is still open) */
  const released = useRef(false);
  const latest = useRef(p);
  latest.current = p;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // This is a request-generation counter, not a DOM ref; invalidate the latest request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      pending.current = false;
      released.current = true;
      if (pause.current) clearTimeout(pause.current);
      const r = rec.current;
      if (r) {
        r.drop(); rec.current = null;
        latest.current.onRecording?.(false);
      }
    };
  }, []);
  // the recorder chunk, fetched once the page has settled (a hold before then fetches it itself)
  const hears = !!p.onVoice && !p.guest;
  useEffect(() => {
    if (!hears) return;
    const id = setTimeout(() => { void loadMic().catch(() => { /* the hold tries again */ }); }, MIC_PREFETCH_MS);
    return () => clearTimeout(id);
  }, [hears]);
  useEffect(() => { if (p.autoFocus) input.current?.focus(); }, [p.autoFocus]);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 2400);
    return () => clearTimeout(t);
  }, [hint]);

  if (p.guest) {
    return (
      <div className="pet-talk">
        <button type="button" className="pet-pill pet-pill-dm" onClick={p.onOpenDm}>{t('talk.chatInTelegram')}</button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || p.busy) return;
    setText('');
    if (pause.current) clearTimeout(pause.current);
    setChip({ id: Date.now(), text: t });
    void p.onSend(t)?.then((ok) => { if (mounted.current && !ok) setText((now) => (now ? now : t)); });
  };

  const micDown = async () => {
    if (p.busy || pending.current || rec.current || p.voice?.open) return;
    if (p.micGate && !p.micGate()) return;
    // perk first, in this handler: the permission prompt must not delay the listening pose
    p.onListen('mic');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { fallback(); return; }
    pending.current = true;
    const ticket = ++generation.current;
    // the prompt is asked in this handler; the recorder chunk loads beside it (usually already here)
    const mod = micModule ? null : loadMic();
    mod?.catch(() => { /* handled below */ });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      if (mounted.current && ticket === generation.current) { pending.current = false; fallback(); }
      return;
    }
    let mic = micModule;
    if (!mic) {
      try { mic = await mod!; } catch { mic = null; }
    }
    // Permission may outlive a release, cancellation, identity change or the entire page.
    // Never construct/start a recorder for that abandoned request; stop every returned track.
    if (!mic || !mounted.current || ticket !== generation.current || released.current || latest.current.busy || latest.current.guest || !latest.current.onVoice) {
      for (const track of stream.getTracks()) track.stop();
      if (ticket === generation.current) pending.current = false;
      if (!mic && mounted.current && ticket === generation.current && !released.current) fallback();
      return;
    }
    pending.current = false;
    const type = mic.pickMicType() ?? '';
    const take: Take | null = mic.record(stream, type, {
      ctx: latest.current.audioContext?.(),
      level: latest.current.onMicLevel ? (l) => latest.current.onMicLevel?.(l) : undefined,
      done: (clip, held) => {
        if (rec.current === take) rec.current = null;
        if (!mounted.current || ticket !== generation.current) return;
        setRecording(false);
        latest.current.onRecording?.(false);
        if (take!.cancel || held < MIN_HOLD_MS || !clip) {
          if (!take!.cancel && held < MIN_HOLD_MS) setHint(t('talk.holdToTalk'));
          latest.current.onIdle();
          return;
        }
        latest.current.onVoice?.(clip);
      },
    });
    if (!take) { fallback(); return; }
    rec.current = take;
    setRecording(true);
    latest.current.onRecording?.(true);
    // released while the permission prompt was up: stop right away
    if (released.current) micUp(false);
  };

  const micUp = (cancel: boolean) => {
    released.current = true;
    const r = rec.current;
    if (!r) {
      if (pending.current) {
        generation.current++; pending.current = false;
        if (!cancel) setHint(t('talk.holdToTalk'));
        latest.current.onIdle();
      }
      return;
    }
    if (!r.stop(cancel)) { rec.current = null; setRecording(false); latest.current.onRecording?.(false); }
  };

  function fallback() {
    setHint(t('talk.micBlocked'));
    input.current?.focus();
  }

  const v = p.voice;
  const note = v?.open ? t('voice.listening') : v?.note;
  return (
    <div className="pet-talk">
      {chip && <span key={chip.id} className="pet-chip" onAnimationEnd={() => setChip(null)}>{chip.text}</span>}
      {(hint || note) && <span className="pet-hint" role="status">{hint ?? note}</span>}
      <form className="pet-pill" data-recording={recording ? '' : undefined} data-handsfree={v?.open ? '' : undefined} data-hearing={v?.hearing ? '' : undefined} onSubmit={submit}>
        <input ref={input} className="pet-input" value={text} enterKeyHint="send" autoComplete="off" maxLength={500}
          placeholder={recording || v?.open ? t('talk.recording') : t('talk.placeholder', { name: p.name })} aria-label={t('talk.placeholder', { name: p.name })}
          onFocus={() => p.onListen('text')}
          onBlur={() => { if (!text.trim() && !p.busy) p.onIdle(); }}
          onChange={(e) => {
            setText(e.target.value);
            if (pause.current) clearTimeout(pause.current);
            pause.current = setTimeout(() => latest.current.onTypingPause?.(), TYPING_PAUSE_MS);
          }} />
        {v?.handsFree && p.onVoice && !text.trim() && <button type="button" className="pet-hf" aria-pressed={v.open} onClick={p.onHandsFree}>{t('voice.handsFree')}</button>}
        {text.trim()
          ? <button type="submit" className="pet-send" aria-label={t('ui.send')} disabled={p.busy}><SendIcon /></button>
          : p.onVoice && (
            <button type="button" className="pet-mic" aria-label={t('talk.holdToTalk')} aria-pressed={recording} disabled={p.busy}
              onPointerDown={(e) => { e.preventDefault(); released.current = false; void micDown(); }}
              onPointerUp={() => micUp(false)}
              onPointerCancel={() => micUp(true)}
              onContextMenu={(e) => e.preventDefault()}>
              <MicIcon />
            </button>
          )}
      </form>
    </div>
  );
});

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="8.5" y="3" width="7" height="12" rx="3.5" fill="currentColor" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
