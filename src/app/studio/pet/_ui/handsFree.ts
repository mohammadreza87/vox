/**
 * Hands-free (design §8A.2, P3b), loaded only when the person turns it on: the mic stays open, a tiny AudioWorklet
 * measures each 20 ms frame's energy, vad.ts decides where speech starts and ends, and each utterance is recorded with
 * MediaRecorder and handed over to be sent. Detection runs on the device; audio leaves it only after an utterance
 * ends, like hold-to-talk. It turns itself off after a minute without speech, when the page is hidden, and on close.
 *
 * The worklet is inlined as a Blob URL (no file under public/, nothing for the route bundle to carry: this chunk loads
 * on the first switch-on). The page's CSP already allows blob: scripts for AudioWorklet modules (middleware.ts).
 */

import { createVad, type Vad } from './vad';
import { pickMicType } from './mic';

/** The worklet: mean square over 20 ms frames, posted to the page. About 300 bytes. */
const WORKLET = `registerProcessor('vox-vad',class extends AudioWorkletProcessor{constructor(){super();this.n=0;this.s=0;this.z=Math.round(sampleRate*.02)}process(i){const c=i[0]&&i[0][0];if(c)for(let k=0;k<c.length;k++){this.s+=c[k]*c[k];if(++this.n>=this.z){this.port.postMessage(this.s/this.n);this.n=0;this.s=0}}return true}})`;

/** Hidden when either is missing (some iOS Telegram WebViews, older Android ones): hold-to-talk stays. */
export function handsFreeSupported(): boolean {
  return typeof window !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && typeof MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
}

export type HandsFreeOff = 'idle' | 'hidden' | 'closed' | 'denied' | 'user';

export interface HandsFreeDeps {
  ctx: () => AudioContext | null;
  /** what the pet is doing now: no capture while it thinks; while it speaks only a louder, longer start (barge-in) */
  busy: () => 'idle' | 'thinking' | 'speaking';
  /** speech started while the pet was speaking: stop its voice and clear the sentence queue */
  bargeIn: () => void;
  /** speech started (the pet perks to listening) */
  onHear: () => void;
  onUtterance: (audio: Blob) => void;
  onOff: (why: HandsFreeOff) => void;
  now?: () => number;
}

export interface HandsFree { stop(why?: HandsFreeOff): void }

/** Opens the mic and starts listening. Rejects (and leaves nothing open) when the mic or the worklet cannot start. */
export async function startHandsFree(d: HandsFreeDeps): Promise<HandsFree> {
  const now = d.now ?? (() => performance.now());
  const ctx = d.ctx();
  if (!ctx || !ctx.audioWorklet) throw new Error('no worklet');
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  let url = '';
  let node: AudioWorkletNode | null = null;
  let src: MediaStreamAudioSourceNode | null = null;
  let sink: GainNode | null = null;
  let rec: { r: MediaRecorder; chunks: Blob[]; keep: boolean } | null = null;
  let stopped = false;
  const type = pickMicType() ?? '';

  const release = () => {
    try { node?.port.close(); node?.disconnect(); src?.disconnect(); sink?.disconnect(); } catch { /* gone */ }
    for (const t of stream.getTracks()) t.stop();
    if (url) URL.revokeObjectURL(url);
  };
  try {
    url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'vox-vad', { numberOfInputs: 1, numberOfOutputs: 1 });
    src = ctx.createMediaStreamSource(stream);
    // a silent sink: the node is pulled (processed) without a sound reaching the speaker
    sink = ctx.createGain();
    sink.gain.value = 0;
    src.connect(node).connect(sink).connect(ctx.destination);
  } catch (e) { release(); throw e; }

  const vad: Vad = createVad(now());
  const record = () => {
    if (rec) return;
    try {
      const r = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      const cur = { r, chunks: [] as Blob[], keep: false };
      r.ondataavailable = (e) => { if (e.data.size) cur.chunks.push(e.data); };
      r.onstop = () => {
        if (!cur.keep || stopped || !cur.chunks.length) return;
        d.onUtterance(new Blob(cur.chunks, { type: r.mimeType || type || 'audio/webm' }));
      };
      r.start();
      rec = cur;
    } catch { rec = null; }
  };
  const finish = (keep: boolean) => {
    const cur = rec;
    rec = null;
    if (!cur) return;
    cur.keep = keep;
    try { cur.r.stop(); } catch { /* already */ }
  };

  const off = (why: HandsFreeOff) => {
    if (stopped) return;
    stopped = true;
    finish(false);
    document.removeEventListener('visibilitychange', onVis);
    release();
    d.onOff(why);
  };
  const onVis = () => { if (document.visibilityState === 'hidden') off('hidden'); };
  document.addEventListener('visibilitychange', onVis);
  stream.getTracks()[0]?.addEventListener('ended', () => off('denied'));

  node.port.onmessage = (e: MessageEvent<number>) => {
    if (stopped) return;
    const t = now();
    const busy = d.busy();
    // the pet is thinking: not the person's silence, and nothing to capture
    if (busy === 'thinking') { if (vad.state !== 'quiet') { finish(false); vad.reset(t); } vad.hold(t); return; }
    const playing = busy === 'speaking';
    if (playing) vad.hold(t);
    const db = 10 * Math.log10(e.data > 1e-12 ? e.data : 1e-12);
    for (const ev of vad.frame(db, t, playing)) {
      if (ev === 'candidate') record();
      else if (ev === 'cancel' || ev === 'tooShort') finish(false);
      else if (ev === 'start') { if (playing) d.bargeIn(); d.onHear(); }
      else if (ev === 'end') finish(true);
      else if (ev === 'idle') off('idle');
    }
  };
  return { stop: (why = 'user') => off(why) };
}
