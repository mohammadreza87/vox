'use client';
import type { VoiceHint, VoiceIdentitySnapshot, VoiceScope } from '@/lib/adaptive/voice-identity/contracts';
import { ApiError, request, tg } from './client';
export type { VoiceIdentitySnapshot, VoiceHint };
const path = (scope: VoiceScope) => new URLSearchParams(scope).toString();
export function voiceDeviceId(): string {
  const key = 'vox.voice-recognition.device.v1';
  const saved = sessionStorage.getItem(key);
  if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
  const id = crypto.randomUUID(); sessionStorage.setItem(key, id); return id;
}
export const voiceIdentityApi = {
  read: (scope: VoiceScope) => request<VoiceIdentitySnapshot>('GET', `voice-identity?${path(scope)}`),
  present: (scope: VoiceScope, expectedRevision: number, locale: 'en' | 'fa') => request<VoiceIdentitySnapshot>('POST', 'voice-identity/present', { ...scope, expectedRevision, locale }),
  enroll: (scope: VoiceScope, expectedRevision: number, receipt: string) => request<VoiceIdentitySnapshot>('POST', 'voice-identity/enroll', { ...scope, expectedRevision, receipt, statement: 'enroll_my_voice', selfOnly: true }),
  begin: (scope: VoiceScope, expectedRevision: number, mode: 'enroll' | 'test') => request<VoiceIdentitySnapshot>('POST', 'voice-identity/begin', { ...scope, expectedRevision, mode, selfOnly: true }),
  cancel: (scope: VoiceScope) => request<VoiceIdentitySnapshot>('POST', 'voice-identity/cancel', scope),
  remove: (scope: VoiceScope) => request<VoiceIdentitySnapshot>('POST', 'voice-identity/delete', scope),
  sample: async (scope: VoiceScope, captureId: string, audio: Blob, signal: AbortSignal): Promise<{ status: VoiceIdentitySnapshot; hint?: VoiceHint }> => {
    const response = await fetch(`/api/studio/voice-identity/sample?${path(scope)}&captureId=${encodeURIComponent(captureId)}`, {
      method: 'POST', headers: { 'X-Telegram-Init-Data': tg()?.initData ?? '', 'Content-Type': audio.type }, body: audio, signal,
    });
    if (!response.ok) throw new ApiError(response.status, 'voice_sample_not_confirmed');
    return response.json();
  },
};
/** Only called after the server issues a scoped, short-lived capture intent. */
export async function captureVoiceSample(capture: NonNullable<VoiceIdentitySnapshot['capture']>, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted || capture.expiresAt <= Date.now()) throw new Error('capture_cancelled');
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('microphone_unavailable');
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (signal.aborted || capture.expiresAt <= Date.now()) throw new Error('capture_cancelled');
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('microphone_unavailable');
    return await new Promise<Blob>((resolve, reject) => {
      const recorder = new MediaRecorder(stream!, { mimeType });
      let chunks: Blob[] = [], size = 0, finished = false;
      const end = (error?: Error) => {
        if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (recorder.state !== 'inactive') recorder.stop();
        if (error) { chunks = []; reject(error); }
        else { const blob = new Blob(chunks, { type: mimeType }); chunks = []; resolve(blob); }
      };
      const abort = () => end(new Error('capture_cancelled'));
      recorder.ondataavailable = event => { size += event.data.size; if (size > capture.maxBytes) end(new Error('voice_sample_too_large')); else if (!finished) chunks.push(event.data); };
      recorder.onerror = () => end(new Error('microphone_unavailable'));
      recorder.onstop = () => end();
      const timer = setTimeout(() => recorder.stop(), Math.min(capture.maxDurationMs, Math.max(0, capture.expiresAt - Date.now() - 1000)));
      signal.addEventListener('abort', abort, { once: true });
      recorder.start(250);
      if (signal.aborted) abort();
    });
  } finally { stream?.getTracks().forEach(track => track.stop()); }
}
