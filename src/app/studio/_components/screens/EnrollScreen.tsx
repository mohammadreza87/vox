'use client';

/**
 * S11L minimal voiceprint enrollment screen (UX-07, PRIV-018 to PRIV-022).
 * Not wired into StudioApp yet. The disclosure copy is the draft UX-07 text
 * from docs/implementation/PRIVACY_AND_CONSENT.md, verbatim: its {variables}
 * stay literal until they resolve to verified launch facts, and unresolved
 * variables block this flow from shipping. Recording is a bounded, visible,
 * cancellable capture; no audio is kept after the upload resolves.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../../_lib/client';

type Space = 'work' | 'personal';
interface VoiceprintStatusView {
  space: Space; available: boolean; reason?: string; enrolled: boolean;
  provider?: string; modelVersion?: string; channel?: string; createdAt?: string; lastConfirmedAt?: string;
}

/** UX-07 EN, verbatim from PRIVACY_AND_CONSENT.md (draft pending legal and native-language review). */
export const EN_COPY = {
  body: "Recognize your voice? Joyixir would create a biometric voiceprint from a short sample to help label you in {eligible_scope}. Matching can be wrong and will not unlock private data or authorize actions. The sample is processed by {recognition_processor} in {recognition_location} and deleted {sample_deletion_term}. Your voiceprint is stored {template_location}, accessible to {template_recipients}, and deleted {template_deletion_term}. This does not clone your voice. You can turn recognition off and request deletion anytime in Privacy and memory. You can use person selection instead.",
  statement: "I explicitly consent to Joyixir collecting, storing and using my voice sample and biometric voiceprint for the speaker-recognition purpose, scope, recipients and periods shown above.",
  enroll: "Enroll my voice",
  personSelection: "Use person selection",
} as const;
/** UX-07 FA, verbatim from PRIVACY_AND_CONSENT.md (draft pending legal and native-language review). */
export const FA_COPY = {
  body: "صدای شما را شناسایی کنیم؟ Joyixir از یک نمونهٔ کوتاه، الگوی زیست‌سنجی صدای شما را می‌سازد تا در {eligible_scope} به تشخیص برچسب گوینده کمک کند. تطبیق صدا ممکن است اشتباه باشد و دسترسی به داده‌های خصوصی یا اجازهٔ انجام کارها را ایجاد نمی‌کند. نمونهٔ صدا را {recognition_processor} در {recognition_location} پردازش می‌کند و {sample_deletion_term_fa} حذف می‌شود. الگوی صدا در {template_location} نگهداری می‌شود، {template_recipients} به آن دسترسی دارند و {template_deletion_term_fa} حذف می‌شود. با این کار، صدای شما شبیه‌سازی نمی‌شود. هر زمان می‌توانید شناسایی صدا را خاموش کنید و در «حریم خصوصی و حافظه» درخواست حذف بدهید. می‌توانید به‌جای آن، شخص را به‌صورت دستی انتخاب کنید.",
  statement: "صریحاً رضایت می‌دهم که Joyixir نمونهٔ صدا و الگوی زیست‌سنجی صدای من را برای هدف شناسایی گوینده، در محدوده، با دریافت‌کنندگان و برای مدت‌های توضیح‌داده‌شده در بالا جمع‌آوری، نگهداری و استفاده کند.",
  enroll: "ثبت الگوی صدای من",
  personSelection: "انتخاب دستی شخص",
} as const;

/** Content-free reasons; shown in English until reviewed FA copy exists. */
const REASON_TEXT: Record<string, string> = {
  disabled: 'Voice recognition is not available.',
  adaptive_unavailable: 'Privacy settings are unavailable right now. Try again later.',
  profile_confirmation_required: 'Confirm your profile in Privacy first.',
  capability_unavailable: 'Voice recognition is not available here.',
  biometric_consent_required: 'Turn on Voice recognition in Privacy first.',
  provider_unavailable: 'Voice recognition is not available right now.',
  thresholds_missing: 'Voice recognition is not available right now.',
  echo_guard_unavailable: 'Voice recognition is not available right now.',
};

const STOP_ENABLED_AFTER_MS = 12_000;
const MAX_RECORDING_MS = 30_000;

/**
 * Mirrors Call.tsx pickMime, limited to Opus containers the server can check.
 * Extracting a shared stream helper from Call.tsx is a follow-up (Call.tsx is
 * not owned by this step).
 */
function pickOpusMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';

export function EnrollScreen({ space, locale = 'en', onUsePersonSelection }: { space: Space; locale?: 'en' | 'fa'; onUsePersonSelection?: () => void }) {
  const copy = locale === 'fa' ? FA_COPY : EN_COPY;
  const [status, setStatus] = useState<VoiceprintStatusView | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (ticker.current) clearInterval(ticker.current);
    if (limit.current) clearTimeout(limit.current);
    ticker.current = null; limit.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    request<VoiceprintStatusView>('GET', `voice-enroll?space=${space}`)
      .then(s => { if (mounted.current) setStatus(s); })
      .catch(e => { if (mounted.current) setError(errorText(e)); });
    return () => {
      mounted.current = false;
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      recorder.current = null;
      chunks.current = [];
      release();
    };
  }, [space, release]);

  const upload = (audio: Blob) => {
    const form = new FormData();
    form.append('audio', audio, 'voice-sample');
    form.append('space', space);
    form.append('statement', 'enroll_my_voice');
    setPhase('uploading');
    request<VoiceprintStatusView>('POST', 'voice-enroll', form)
      .then(s => { if (mounted.current) setStatus(s); })
      .catch(e => { if (mounted.current) setError(errorText(e)); })
      .finally(() => { if (mounted.current) setPhase('idle'); });
  };

  const start = async () => {
    if (!agreed || !status?.available || phase !== 'idle') return;
    setError('');
    cancelled.current = false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!mounted.current) { s.getTracks().forEach(track => track.stop()); return; }
      stream.current = s;
      const mime = pickOpusMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = event => { if (event.data && event.data.size) chunks.current.push(event.data); };
      rec.onstop = () => {
        const parts = chunks.current;
        chunks.current = [];
        recorder.current = null;
        release();
        if (cancelled.current || !mounted.current) { setPhase('idle'); return; }
        upload(new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' }));
      };
      recorder.current = rec;
      const startedAt = Date.now();
      rec.start();
      setElapsed(0);
      setPhase('recording');
      ticker.current = setInterval(() => setElapsed(Date.now() - startedAt), 250);
      limit.current = setTimeout(() => { if (recorder.current?.state === 'recording') recorder.current.stop(); }, MAX_RECORDING_MS);
    } catch (e) {
      release();
      setPhase('idle');
      setError(errorText(e));
    }
  };

  const stop = () => {
    if (elapsed < STOP_ENABLED_AFTER_MS) return;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const cancel = () => {
    cancelled.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = null;
    chunks.current = [];
    release();
    setPhase('idle');
    setElapsed(0);
  };

  const remove = () => {
    request<VoiceprintStatusView>('DELETE', `voice-enroll?space=${space}`)
      .then(s => { if (mounted.current) setStatus(s); })
      .catch(e => { if (mounted.current) setError(errorText(e)); });
  };

  const seconds = Math.floor(elapsed / 1000);
  return (
    <section dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale} className="flex flex-col gap-4 p-4" aria-label="Voice recognition enrollment">
      <p>{copy.body}</p>
      {status && !status.available && (
        <p role="status" lang="en" dir="ltr">{REASON_TEXT[status.reason ?? ''] ?? REASON_TEXT.disabled}</p>
      )}
      {status?.enrolled && (
        <div role="group" aria-label="Enrolled voiceprint">
          <p dir="ltr">{status.provider} · {status.modelVersion} · {status.createdAt}</p>
          <button type="button" onClick={remove}>Delete voiceprint</button>
        </div>
      )}
      <label className="vx-privacy-checkbox">
        <input className="vx-privacy-check" type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} disabled={phase !== 'idle'} />
        <span>{copy.statement}</span>
      </label>
      {phase === 'recording' ? (
        <div role="group" aria-label="Recording">
          <p role="status">Recording · {seconds}s / {MAX_RECORDING_MS / 1000}s</p>
          <button type="button" onClick={stop} disabled={elapsed < STOP_ENABLED_AFTER_MS}>Stop</button>
          <button type="button" onClick={cancel}>Cancel</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => { void start(); }} disabled={!agreed || !status?.available || phase !== 'idle'}>{copy.enroll}</button>
          <button type="button" onClick={() => onUsePersonSelection?.()}>{copy.personSelection}</button>
        </div>
      )}
      {phase === 'uploading' && <p role="status">Checking your sample…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
