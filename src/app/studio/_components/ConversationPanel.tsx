'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LivePredictionConsumer, predictionHttpTransport } from '@/lib/adaptive/prediction/client';
import { prepareSharedImage } from '@/lib/adaptive/prediction/image-browser';
import { observeCommittedText } from '@/lib/adaptive/observation/committed-text';
import { learningApi } from '../_lib/learning-client';
import { TaskOutcome } from './TaskOutcome';
import { MessageMemoryReview } from './MessageMemoryReview';
import { useProductPause } from '../_lib/product-pause-client';
import { pauseText } from '../_lib/product-pause-copy';
import { tg, request as studioRequest } from '../_lib/client';
import { preferenceLearningApi } from '../_lib/preference-learning-client';
import { Icon, Spinner } from './ui';

/** Typed fallback and explicit image sharing use the same scoped agent context
 * as calls. Draft processing is a separate, off-by-default user choice. */
type Presentation = { density: 'compact' | 'comfortable'; receipt: string };
type ConversationLine = { role: 'you' | 'agent'; text: string; turnId?: string; started?: number; epoch?: number; session?: string; presentation?: Presentation };
function presentation(raw: unknown): Presentation | undefined {
  if (!raw || typeof raw !== 'object' || !('density' in raw) || !['compact', 'comfortable'].includes(String(raw.density)) || !('receipt' in raw) || typeof raw.receipt !== 'string' || !/^[a-f0-9]{64}$/.test(raw.receipt)) return undefined;
  return { density: raw.density as Presentation['density'], receipt: raw.receipt };
}
function CommittedReply({ line, agentId, space, current }: { line: ConversationLine; agentId: string; space: 'work' | 'personal'; current(): boolean }) {
  const [presentationRejected, setPresentationRejected] = useState(false);
  const element = useRef<HTMLSpanElement | null>(null), reported = useRef(false), latestCurrent = useRef(current);
  latestCurrent.current = current;
  useEffect(() => {
    if (!element.current || reported.current) return;
    const controller = new AbortController();
    const stop = observeCommittedText(element.current, () => {
      if (reported.current || !latestCurrent.current()) return; reported.current = true;
      if (line.turnId) void learningApi.event({ agentId, space, turnId: line.turnId, eventId: `text-${line.turnId}`, outcome: 'text_rendered',
        ...(line.started !== undefined ? { durationMs: Math.min(86_400_000, Math.max(0, performance.now() - line.started)) } : {}) }, controller.signal).catch(() => undefined);
      if (line.presentation) void studioRequest<{ recorded: boolean; duplicate: boolean }>('POST', 'experiments/exposure', { agentId, space, receipt: line.presentation.receipt }, 'json', controller.signal)
        .then(result => { if (!controller.signal.aborted && latestCurrent.current() && !result.recorded && !result.duplicate) setPresentationRejected(true); })
        .catch(() => { if (!controller.signal.aborted && latestCurrent.current()) setPresentationRejected(true); });
    }, () => latestCurrent.current());
    return () => { stop(); controller.abort(); };
  }, [line, agentId, space]);
  const density = line.presentation ? presentationRejected ? 'comfortable' : line.presentation.density : undefined;
  return <span ref={element} data-response-density={density} style={density === 'compact' ? { lineHeight: 1.35 } : undefined}>{line.text}</span>;
}
export function ConversationPanel({ agentId, space, locale = 'en', disabled = false }: {
  agentId: string; space: 'work' | 'personal'; locale?: 'en' | 'fa'; disabled?: boolean;
}) {
  const session = tg()?.initData ?? '';
  const pause = useProductPause(space, session);
  const historicBlocked = pause.coveredBlocked;
  const paused = pause.status?.productPaused === true;
  const fa = locale === 'fa';
  const t = (en: string, persian: string) => fa ? persian : en;
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState<{ sourceId: string; revision: number; dataUrl: string }>();
  const [prepare, setPrepare] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [error, setError] = useState('');
  const [lastTurnId, setLastTurnId] = useState<string>();
  const [reviewText, setReviewText] = useState<{ text: string; agentId: string; space: 'work' | 'personal' } | null>(null), [memoryStatus, setMemoryStatus] = useState('');
  const [lines, setLines] = useState<ConversationLine[]>([]);
  const consumer = useRef<LivePredictionConsumer | null>(null);
  const request = useRef<AbortController | null>(null);
  const imageRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const sessionId = useRef('');
  const latest = useRef({ draft, prepare, disabled, historicBlocked });
  latest.current = { draft, prepare, disabled, historicBlocked };
  const startPredictionTurn = useCallback(() => consumer.current?.startTurn({ agentId, space,
    sessionId: sessionId.current, turnId: crypto.randomUUID(), contextKey: crypto.randomUUID() }), [agentId, space]);
  useLayoutEffect(() => {
    sessionId.current = crypto.randomUUID();
    const current = new LivePredictionConsumer({ ...predictionHttpTransport(() => tg()?.initData ?? ''),
      onPrepared: result => setPrepared(result?.preparedContext === true), debounceMs: 350 });
    consumer.current = current;
    current.startTurn({ agentId, space, sessionId: sessionId.current, turnId: crypto.randomUUID(), contextKey: crypto.randomUUID() });
    setDraft(''); setImage(undefined); setReviewText(null); setMemoryStatus(''); setLastTurnId(undefined); setLines([]); setPrepare(false); setPrepared(false); setBusy(false); setError('');
    // Invalidate the live request generation, including any later boundary change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { void preferenceLearningApi.cancel(space, agentId); generation.current++; current.cancel(); request.current?.abort(); imageRequest.current?.abort(); consumer.current = null; };
  }, [agentId, space, session]);
  useEffect(() => {
    if (disabled) { setReviewText(null); setMemoryStatus(''); consumer.current?.cancel(); request.current?.abort(); imageRequest.current?.abort(); setPrepare(false); setPrepared(false); }
    else if (!consumer.current?.snapshotTurn()) startPredictionTurn();
  }, [disabled, startPredictionTurn]);
  const previousBoundary = useRef(`${pause.status?.accountId}:${pause.status?.useEpoch}:${historicBlocked}`);
  useEffect(() => {
    const boundary = `${pause.status?.accountId}:${pause.status?.useEpoch}:${historicBlocked}`;
    if (previousBoundary.current === boundary) return;
    previousBoundary.current = boundary;
    // A changed use boundary invalidates old prepared work and pending output.
    generation.current++; consumer.current?.cancel(); request.current?.abort(); imageRequest.current?.abort();
    setReviewText(null); setMemoryStatus(''); setPrepared(false); setPrepare(false); setBusy(false); setLoadingImage(false);
    if (!disabled) startPredictionTurn();
  }, [pause.status?.accountId, pause.status?.useEpoch, historicBlocked, disabled, startPredictionTurn]);
  const updatePrediction = (text: string, selected = image) => {
    consumer.current?.update({ text, image: selected,
      stable: latest.current.prepare && !latest.current.disabled && !latest.current.historicBlocked && text.trim().length >= 12, question: selected ? 'image_route' : 'intent_route' });
  };
  const chooseImage = async (file?: File) => {
    imageRequest.current?.abort();
    const controller = new AbortController(); imageRequest.current = controller;
    if (!file) return;
    setLoadingImage(true); setError('');
    try {
      const dataUrl = await prepareSharedImage(file, controller.signal);
      if (controller.signal.aborted) return;
      const selected = { sourceId: crypto.randomUUID(), revision: 1, dataUrl };
      setImage(selected); updatePrediction(latest.current.draft, selected);
    } catch { if (!controller.signal.aborted) setError(t('Choose a smaller PNG, JPEG or WebP image.', 'یک تصویر کوچک‌تر PNG، JPEG یا WebP انتخاب کنید.')); }
    finally { if (imageRequest.current === controller) setLoadingImage(false); }
  };
  const send = async () => {
    if (busy || disabled || loadingImage || !draft.trim()) return;
    const current = generation.current, started = performance.now(), currentSession = tg()?.initData ?? '';
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    const logicalTurn = consumer.current?.snapshotTurn();
    consumer.current?.suspend(); setPrepared(false); setBusy(true); setError('');
    let completed = false;
    try {
      // A prediction is never promoted into authority, tool input or an answer.
      const response = await fetch('/api/studio/conversation', { method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': tg()?.initData ?? '' },
        body: JSON.stringify({ agentId, space, text: draft, ...(logicalTurn ? { turn: logicalTurn } : {}), ...(image ? { image: image.dataUrl } : {}) }) });
      if (!response.ok) throw new Error('conversation_unavailable');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('reply' in data) || typeof data.reply !== 'string') throw new Error('invalid_reply');
      if (controller.signal.aborted || generation.current !== current) return;
      const reply = data.reply;
      setLastTurnId('turnId' in data && typeof data.turnId === 'string' ? data.turnId : undefined);
      setLines(previous => [...previous, { role: 'you', text: draft }, { role: 'agent', text: reply, epoch: current, session: currentSession, started, turnId: 'turnId' in data && typeof data.turnId === 'string' ? data.turnId : undefined, presentation: presentation('responsePresentation' in data ? data.responsePresentation : undefined) }].slice(-20) as typeof previous);
      completed = true; setDraft(''); setImage(undefined);
    } catch {
      if (!controller.signal.aborted && generation.current === current) setError(t('Your message could not be completed. Check Privacy and agent access before trying again.', 'پیام شما کامل نشد. پیش از تلاش دوباره حریم خصوصی و دسترسی عامل را بررسی کنید.'));
    } finally {
      if (generation.current === current) { setBusy(false); if (completed && !disabled) startPredictionTurn(); }
    }
  };
  return <section className="vx-chat" dir={fa ? 'rtl' : 'ltr'} lang={locale}
    aria-label={t('Type or share an image', 'تایپ یا اشتراک تصویر')} aria-busy={busy || loadingImage}>
    <div role="log" aria-label={t('Conversation', 'گفتگو')} aria-live="polite" className="vx-chat-log">
      <div className="vx-chat-intro">
        {paused && <p className="vx-small" role="status">{pauseText(locale, space, 'conversation')}</p>}
        <p className="vx-small vx-3">{paused ? pauseText(locale, space, 'history') : t('Uses the memories allowed in this space. Images are sent only for this turn; Vox does not save the image.', 'از حافظه‌های مجاز این فضا استفاده می‌کند. تصویر فقط برای همین نوبت ارسال می‌شود؛ وکس تصویر را ذخیره نمی‌کند.')}</p>
      </div>
      {lines.map((line, i) => <div key={i} className={`vx-bubble-row ${line.role === 'you' ? 'mine' : ''}`}>
        <p className={`vx-bubble ${line.role === 'you' ? 'mine' : ''}`}>
          <strong className="vx-sr">{line.role === 'you' ? t('You: ', 'شما: ') : t('Agent: ', 'عامل: ')}</strong>
          {line.role === 'agent' ? <CommittedReply line={line} agentId={agentId} space={space} current={() => !disabled && line.epoch === generation.current && line.session === (tg()?.initData ?? '')} /> : line.text}
        </p>
        {line.role === 'you' && <button className="vx-bubble-action" aria-describedby={historicBlocked ? 'vox-historic-review-reason' : undefined} disabled={busy || disabled || historicBlocked} onClick={() => { setMemoryStatus(''); setReviewText({ text: line.text, agentId, space }); }}>{t('Review this text for memory', 'بررسی این متن برای حافظه')}</button>}
      </div>)}
      {busy && <div className="vx-bubble-row"><p className="vx-bubble vx-typing" aria-hidden="true"><span /><span /><span /></p></div>}
    </div>
    <div className="vx-chat-dock">
      {historicBlocked && <p id="vox-historic-review-reason" className="vx-small vx-2">{paused ? pauseText(locale, space, 'historicDisabled') : pauseText(locale, space, 'unverified')}</p>}
      {!historicBlocked && reviewText !== null && reviewText.agentId === agentId && reviewText.space === space && <MessageMemoryReview key={`${agentId}:${space}`} text={reviewText.text} agentId={agentId} space={space} locale={locale} disabled={disabled}
        onClose={() => setReviewText(null)} onSaved={count => { setReviewText(null); setMemoryStatus(t(`Saved ${count} private user-reviewed claims. Manage them in Privacy.`, `${count} ادعای خصوصیِ بررسی‌شده ذخیره شد. در حریم خصوصی مدیریت کنید.`)); }} />}
      {memoryStatus && <p role="status" className="vx-banner info">{memoryStatus}</p>}
      {lastTurnId && <TaskOutcome key={`${agentId}:${space}:${lastTurnId}`} agentId={agentId} space={space} turnId={lastTurnId} locale={locale} />}
      {prepared && <p className="vx-small vx-2" role="status">{t('Context prepared for this draft. You can keep editing.', 'زمینهٔ این پیش‌نویس آماده شد. می‌توانید ویرایش را ادامه دهید.')}</p>}
      {error && <p className="vx-banner danger" role="alert">{error}</p>}
      {image && <div className="vx-chat-attachment">
        {/* Inline, minimized user selection; no third-party fetch. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.dataUrl} alt={t('Image selected for this message', 'تصویر انتخاب‌شده برای این پیام')} />
        <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || disabled} onClick={() => { setImage(undefined); if (prepare && !historicBlocked) consumer.current?.update({ text: draft, stable: draft.trim().length >= 12 }); }}>{t('Remove image', 'حذف تصویر')}</button>
      </div>}
      <div className="vx-chat-prepare">
        <label className="vx-privacy-checkbox" style={{ minHeight: 32 }}><input type="checkbox" checked={prepare} disabled={busy || disabled || historicBlocked} onChange={e => {
          setPrepare(e.target.checked); if (!e.target.checked) consumer.current?.suspend();
          else { consumer.current?.update({ text: draft, image, stable: draft.trim().length >= 12 }); }
        }} /><span className="vx-small">{t('Prepare while I type', 'آماده‌سازی هنگام تایپ')}</span></label>
        <p className="vx-small vx-3">{t('When selected, your draft and selected image may be sent to OpenAI before you press Send. Preparation stays off when unavailable and never sends a message for you.', 'با انتخاب این گزینه، پیش‌نویس و تصویر انتخاب‌شده ممکن است پیش از زدن ارسال به OpenAI فرستاده شوند. اگر آماده‌سازی در دسترس نباشد خاموش می‌ماند و هرگز از طرف شما پیامی ارسال نمی‌کند.')}</p>
      </div>
      <div className="vx-composer">
        <label className="vx-composer-attach" title={t('Image (optional)', 'تصویر (اختیاری)')}>
          <span className="vx-sr">{t('Image (optional)', 'تصویر (اختیاری)')}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || disabled || loadingImage}
            onChange={e => { void chooseImage(e.target.files?.[0]); e.target.value = ''; }} />
          <Icon name="attach" size={20} />
        </label>
        <label className="vx-composer-field"><span className="vx-sr">{t('Message', 'پیام')}</span><textarea className="vx-textarea" value={draft} rows={1} maxLength={4096} disabled={busy || disabled}
          placeholder={t('Message', 'پیام')}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          onChange={e => { setDraft(e.target.value); updatePrediction(e.target.value); }} /></label>
        <button className="vx-composer-send" disabled={busy || disabled || loadingImage || !draft.trim()} onClick={() => void send()}>
          {busy ? <Spinner size={18} /> : <Icon name="send" size={20} width={2.2} />}
          <span className="vx-sr">{busy ? t('Replying…', 'در حال پاسخ…') : t('Send', 'ارسال')}</span>
        </button>
      </div>
    </div>
  </section>;
}
