/**
 * Hold-to-talk's recorder (TalkPill) and the container choice hands-free shares: its own chunk, loaded once the page is
 * idle or on the first hold (loadMic in TalkPill), never with the first paint. The permission prompt does not wait for
 * it: TalkPill asks getUserMedia in the press handler and this module only once a stream is granted.
 */

/** Container types in order of preference: Opus in WebM (Android/desktop), AAC in MP4 (iOS), Ogg. */
export const MIC_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'] as const;

export function pickMicType(rec: { isTypeSupported?(t: string): boolean } | null = typeof MediaRecorder === 'undefined' ? null : MediaRecorder): string | null {
  if (!rec) return null;
  for (const t of MIC_TYPES) {
    try { if (rec.isTypeSupported?.(t)) return t; } catch { /* old WebKit */ }
  }
  return '';
}

/** One hold's recording. */
export interface Take {
  /** the hold was cancelled (pointercancel, unmount): its clip is never handed over */
  cancel: boolean;
  /** Ends the hold; `done` then hears the clip. False when the recorder would not stop (its tracks are released). */
  stop(cancel: boolean): boolean;
  /** Unmount: release the tracks and the meter, never hand a clip over. */
  drop(): void;
}

export interface RecordOpts {
  /** the page's one AudioContext, for the mic meter */
  ctx?: AudioContext | null;
  /** the mic level 0…1 while recording (the listening swell), and 0 when it ends */
  level?: (l: number) => void;
  /** the recorder stopped: the clip (null when nothing was recorded or the hold was cancelled) and how long it was held */
  done: (clip: Blob | null, heldMs: number) => void;
}

/** Records `stream` in `type` ('' for the browser default); null when no recorder can be built (its tracks are stopped). */
export function record(stream: MediaStream, type: string, o: RecordOpts): Take | null {
  let recorder: MediaRecorder;
  try {
    recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
  } catch {
    for (const t of stream.getTracks()) t.stop();
    return null;
  }
  const chunks: Blob[] = [];
  const started = performance.now();
  let off: (() => void) | undefined;
  const release = () => { off?.(); off = undefined; for (const t of stream.getTracks()) t.stop(); };
  const take: Take = {
    cancel: false,
    stop(cancel) {
      take.cancel = cancel;
      try { recorder.stop(); return true; } catch { release(); return false; }
    },
    drop() {
      take.cancel = true;
      recorder.onstop = null; recorder.ondataavailable = null;
      try { recorder.stop(); } catch { /* already stopped */ }
      release();
    },
  };
  recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  recorder.onstop = () => {
    release();
    const clip = !take.cancel && chunks.length ? new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }) : null;
    o.done(clip, performance.now() - started);
  };
  // start() throws when the granted track already ended (revoked, device switched): release and fall back to typing
  try { recorder.start(); } catch {
    recorder.onstop = null; recorder.ondataavailable = null;
    for (const t of stream.getTracks()) t.stop();
    return null;
  }
  off = meter(stream, o.ctx, o.level);
  return take;
}

/** The mic level from an analyser, once a frame; the returned function stops it (and reports 0). */
function meter(stream: MediaStream, ctx: AudioContext | null | undefined, level: ((l: number) => void) | undefined): (() => void) | undefined {
  if (!ctx || !level) return undefined;
  try {
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const db = 20 * Math.log10(Math.sqrt(s / buf.length) || 1e-6);
      level(Math.max(0, Math.min(1, (db + 50) / 32)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); src.disconnect(); level(0); };
  } catch { return undefined; }
}
