'use client';

/**
 * S11L minimal voiceprint enrollment screen (UX-07; PRIV-018 to PRIV-022).
 * Not wired into StudioApp or any other screen. The disclosure is the UX-07
 * draft from docs/implementation/PRIVACY_AND_CONSENT.md, verbatim: its
 * {variables} stay literal until launch facts are supplied, and while any is
 * unresolved Enroll stays disabled. Capture is visible, cancellable and
 * bounded; no audio is kept in state after upload.
 *
 * Imports only react and the client helpers: StudioApp pulls in Privacy.tsx,
 * which is broken at the base, and Call.tsx is not owned by this step.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { haptic, request } from '../../_lib/client';

type Space = 'work' | 'personal';
type Locale = 'en' | 'fa';

export type Ux07Variable =
  | 'eligible_scope' | 'recognition_processor' | 'recognition_location' | 'sample_deletion_term' | 'sample_deletion_term_fa'
  | 'template_location' | 'template_recipients' | 'template_deletion_term' | 'template_deletion_term_fa';

export const UX07_VARIABLES: readonly Ux07Variable[] = [
  'eligible_scope', 'recognition_processor', 'recognition_location', 'sample_deletion_term', 'sample_deletion_term_fa',
  'template_location', 'template_recipients', 'template_deletion_term', 'template_deletion_term_fa',
];

/** UX-07, verbatim from PRIVACY_AND_CONSENT.md (draft pending legal and native-language review). */
export const UX07_COPY: Record<Locale, { body: string; statement: string; enroll: string; alternative: string }> = {
  en: {
    body: 'Recognize your voice? Joyixir would create a biometric voiceprint from a short sample to help label you in {eligible_scope}. Matching can be wrong and will not unlock private data or authorize actions. The sample is processed by {recognition_processor} in {recognition_location} and deleted {sample_deletion_term}. Your voiceprint is stored {template_location}, accessible to {template_recipients}, and deleted {template_deletion_term}. This does not clone your voice. You can turn recognition off and request deletion anytime in Privacy and memory. You can use person selection instead.',
    statement: 'I explicitly consent to Joyixir collecting, storing and using my voice sample and biometric voiceprint for the speaker-recognition purpose, scope, recipients and periods shown above.',
    enroll: 'Enroll my voice',
    alternative: 'Use person selection',
  },
  fa: {
    body: 'صدای شما را شناسایی کنیم؟ Joyixir از یک نمونهٔ کوتاه، الگوی زیست‌سنجی صدای شما را می‌سازد تا در {eligible_scope} به تشخیص برچسب گوینده کمک کند. تطبیق صدا ممکن است اشتباه باشد و دسترسی به داده‌های خصوصی یا اجازهٔ انجام کارها را ایجاد نمی‌کند. نمونهٔ صدا را {recognition_processor} در {recognition_location} پردازش می‌کند و {sample_deletion_term_fa} حذف می‌شود. الگوی صدا در {template_location} نگهداری می‌شود، {template_recipients} به آن دسترسی دارند و {template_deletion_term_fa} حذف می‌شود. با این کار، صدای شما شبیه‌سازی نمی‌شود. هر زمان می‌توانید شناسایی صدا را خاموش کنید و در «حریم خصوصی و حافظه» درخواست حذف بدهید. می‌توانید به‌جای آن، شخص را به‌صورت دستی انتخاب کنید.',
    statement: 'صریحاً رضایت می‌دهم که Joyixir نمونهٔ صدا و الگوی زیست‌سنجی صدای من را برای هدف شناسایی گوینده، در محدوده، با دریافت‌کنندگان و برای مدت‌های توضیح‌داده‌شده در بالا جمع‌آوری، نگهداری و استفاده کند.',
    enroll: 'ثبت الگوی صدای من',
    alternative: 'انتخاب دستی شخص',
  },
};

/** Screen strings outside UX-07; the FA lines await native-language review. */
const UI: Record<Locale, { consentMissing: string; pending: string; keepTalking: string; recording: string; stop: string; cancel: string; remove: string; uploading: string }> = {
  en: {
    consentMissing: 'Turn on Voice recognition in Privacy and memory first.',
    pending: 'Not available yet: launch details are pending review.',
    keepTalking: 'Keep talking a little longer',
    recording: 'Recording', stop: 'Stop', cancel: 'Cancel', remove: 'Delete voiceprint', uploading: 'Checking your sample…',
  },
  fa: {
    consentMissing: 'ابتدا «شناسایی صدا» را در «حریم خصوصی و حافظه» روشن کنید.',
    pending: 'هنوز در دسترس نیست: جزئیات راه‌اندازی در حال بررسی است.',
    keepTalking: 'کمی بیشتر صحبت کنید',
    recording: 'در حال ضبط', stop: 'پایان', cancel: 'لغو', remove: 'حذف الگوی صدا', uploading: 'در حال بررسی نمونه…',
  },
};

const MIN_CLIP_MS = 10_000;
const ACTION_CLASS = 'rounded-xl px-4 py-2 text-sm font-medium border border-current';

/** Fills {variables} that have a non-blank fact; anything else stays literal and is reported missing. */
export function resolveUx07(locale: Locale, facts: Partial<Record<Ux07Variable, string>> = {}): { text: string; statement: string; missing: Ux07Variable[] } {
  const copy = UX07_COPY[locale];
  const missing: Ux07Variable[] = [];
  const text = copy.body.replace(/\{([a-z_]+)\}/g, (match, name: string) => {
    const variable = name as Ux07Variable;
    const value = UX07_VARIABLES.includes(variable) ? facts[variable]?.trim() : undefined;
    if (value) return value;
    if (!missing.includes(variable)) missing.push(variable);
    return match;
  });
  return { text, statement: copy.statement, missing };
}

interface VoiceprintStatusView {
  space: Space; available: boolean; reason?: string; consent: 'granted' | 'missing'; enrolled: boolean;
  provider?: string; modelVersion?: string; createdAt?: string;
}

/** Mirrors Call.tsx pickMime. TODO: dedupe once Call.tsx is owned by a step that can export it. */
function pickRecordingMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';

export function EnrollScreen({ space, locale, facts, onCancel }: { space: Space; locale: Locale; facts?: Partial<Record<Ux07Variable, string>>; onCancel?: () => void }) {
  const ui = UI[locale];
  const copy = UX07_COPY[locale];
  const { text, statement, missing } = resolveUx07(locale, facts);
  const [status, setStatus] = useState<VoiceprintStatusView | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const discard = useRef(false);
  const mounted = useRef(true);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    request<{ voiceprint: VoiceprintStatusView }>('GET', `voice-enroll?space=${space}`)
      .then(r => { if (mounted.current) setStatus(r.voiceprint); })
      .catch(e => { if (mounted.current) setNotice(errorText(e)); });
    return () => {
      mounted.current = false;
      discard.current = true;
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
    form.append('statement', 'accepted');
    setPhase('uploading');
    request<{ voiceprint: VoiceprintStatusView }>('POST', 'voice-enroll', form)
      .then(r => { if (mounted.current) { setStatus(r.voiceprint); haptic.success(); } })
      .catch(e => { if (mounted.current) { setNotice(errorText(e)); haptic.error(); } })
      .finally(() => { if (mounted.current) setPhase('idle'); });
  };

  const start = async () => {
    if (!agreed || missing.length || !status?.available || phase !== 'idle') return;
    setNotice('');
    discard.current = false;
    haptic.tap();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!mounted.current) { s.getTracks().forEach(track => track.stop()); return; }
      stream.current = s;
      const mime = pickRecordingMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = event => { if (event.data && event.data.size) chunks.current.push(event.data); };
      rec.onstop = () => {
        const parts = chunks.current;
        chunks.current = [];
        recorder.current = null;
        const duration = Date.now() - startedAt.current;
        release();
        if (discard.current || !mounted.current) { if (mounted.current) setPhase('idle'); return; }
        if (duration < MIN_CLIP_MS) { setNotice(ui.keepTalking); setPhase('idle'); return; }
        upload(new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' }));
      };
      recorder.current = rec;
      startedAt.current = Date.now();
      rec.start();
      setElapsed(0);
      setPhase('recording');
      ticker.current = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    } catch (e) {
      release();
      setPhase('idle');
      setNotice(errorText(e));
    }
  };

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else release();
  };

  const cancel = () => {
    discard.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = null;
    chunks.current = [];
    release();
    setPhase('idle');
    setElapsed(0);
  };

  const remove = () => {
    request<{ voiceprint: VoiceprintStatusView }>('DELETE', `voice-enroll?space=${space}`)
      .then(r => { if (mounted.current) setStatus(r.voiceprint); })
      .catch(e => { if (mounted.current) setNotice(errorText(e)); });
  };

  const direction = locale === 'fa' ? 'rtl' : 'ltr';
  if (status?.consent === 'missing') {
    return (
      <section dir={direction} lang={locale} className="flex flex-col gap-4 p-4" aria-label="Voice recognition enrollment">
        <p role="status">{ui.consentMissing}</p>
      </section>
    );
  }
  const enrollDisabled = !agreed || missing.length > 0 || !status?.available || phase !== 'idle';
  return (
    <section dir={direction} lang={locale} className="flex flex-col gap-4 p-4" aria-label="Voice recognition enrollment">
      <p>{text}</p>
      {missing.length > 0 && <p role="status">{ui.pending}</p>}
      {status?.enrolled && (
        <div role="group" aria-label={ui.remove}>
          <button type="button" className={ACTION_CLASS} onClick={remove}>{ui.remove}</button>
        </div>
      )}
      <label className="vx-privacy-checkbox">
        <input className="vx-privacy-check" type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} disabled={phase !== 'idle'} />
        <span>{statement}</span>
      </label>
      {phase === 'recording' ? (
        <div role="group" aria-label={ui.recording} className="flex gap-2 items-center">
          <p role="timer">{ui.recording} · {Math.floor(elapsed / 1000)}s</p>
          <button type="button" className={ACTION_CLASS} onClick={stop}>{ui.stop}</button>
          <button type="button" className={ACTION_CLASS} onClick={cancel}>{ui.cancel}</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className={ACTION_CLASS} onClick={() => { void start(); }} disabled={enrollDisabled}>{copy.enroll}</button>
          <button type="button" className={ACTION_CLASS} onClick={() => onCancel?.()}>{copy.alternative}</button>
        </div>
      )}
      {phase === 'uploading' && <p role="status">{ui.uploading}</p>}
      {notice && <p role="alert">{notice}</p>}
    </section>
  );
}
