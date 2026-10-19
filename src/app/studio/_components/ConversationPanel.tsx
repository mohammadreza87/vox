'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LivePredictionConsumer, predictionHttpTransport } from '@/lib/adaptive/prediction/client';
import { prepareSharedImage } from '@/lib/adaptive/prediction/image-browser';
import { TaskOutcome } from './TaskOutcome';
import { MessageMemoryReview } from './MessageMemoryReview';
import { tg } from '../_lib/client';
import { preferenceLearningApi } from '../_lib/preference-learning-client';

/** Typed fallback and explicit image sharing use the same scoped agent context
 * as calls. Draft processing is a separate, off-by-default user choice. */
export function ConversationPanel({ agentId, space, locale = 'en', disabled = false }: {
  agentId: string; space: 'work' | 'personal'; locale?: 'en' | 'fa'; disabled?: boolean;
}) {
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
  const [lines, setLines] = useState<Array<{ role: 'you' | 'agent'; text: string }>>([]);
  const consumer = useRef<LivePredictionConsumer | null>(null);
  const request = useRef<AbortController | null>(null);
  const imageRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const sessionId = useRef('');
  const latest = useRef({ draft, prepare, disabled });
  latest.current = { draft, prepare, disabled };
  const startPredictionTurn = useCallback(() => consumer.current?.startTurn({ agentId, space,
    sessionId: sessionId.current, turnId: crypto.randomUUID(), contextKey: crypto.randomUUID() }), [agentId, space]);
  useEffect(() => {
    sessionId.current = crypto.randomUUID();
    const current = new LivePredictionConsumer({ ...predictionHttpTransport(() => tg()?.initData ?? ''),
      onPrepared: result => setPrepared(result?.preparedContext === true), debounceMs: 350 });
    consumer.current = current;
    current.startTurn({ agentId, space, sessionId: sessionId.current, turnId: crypto.randomUUID(), contextKey: crypto.randomUUID() });
    setDraft(''); setImage(undefined); setReviewText(null); setMemoryStatus(''); setLastTurnId(undefined); setLines([]); setPrepare(false); setPrepared(false); setBusy(false); setError('');
    return () => { void preferenceLearningApi.cancel(space, agentId); generation.current++; current.cancel(); request.current?.abort(); imageRequest.current?.abort(); consumer.current = null; };
  }, [agentId, space]);
  useEffect(() => {
    if (disabled) { setReviewText(null); setMemoryStatus(''); consumer.current?.cancel(); request.current?.abort(); imageRequest.current?.abort(); setPrepare(false); setPrepared(false); }
    else if (!consumer.current?.snapshotTurn()) startPredictionTurn();
  }, [disabled, startPredictionTurn]);
  const updatePrediction = (text: string, selected = image) => {
    consumer.current?.update({ text, image: selected,
      stable: latest.current.prepare && !latest.current.disabled && text.trim().length >= 12, question: selected ? 'image_route' : 'intent_route' });
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
    const current = generation.current;
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
      setLines(previous => [...previous, { role: 'you', text: draft }, { role: 'agent', text: reply }].slice(-20) as typeof previous);
      completed = true; setDraft(''); setImage(undefined);
    } catch {
      if (!controller.signal.aborted && generation.current === current) setError(t('Your message could not be completed. Check Privacy and agent access before trying again.', 'پیام شما کامل نشد. پیش از تلاش دوباره حریم خصوصی و دسترسی عامل را بررسی کنید.'));
    } finally {
      if (generation.current === current) { setBusy(false); if (completed && !disabled) startPredictionTurn(); }
    }
  };
  return <section className="vx-card vx-privacy-card" dir={fa ? 'rtl' : 'ltr'} lang={locale}
    aria-label={t('Type or share an image', 'تایپ یا اشتراک تصویر')} aria-busy={busy || loadingImage}>
    <h2 className="vx-head">{t('Type or share an image', 'تایپ یا اشتراک تصویر')}</h2>
    <p className="vx-small vx-2">{t('Uses the memories allowed in this space. Images are sent only for this turn; Vox does not save the image.', 'از حافظه‌های مجاز این فضا استفاده می‌کند. تصویر فقط برای همین نوبت ارسال می‌شود؛ وکس تصویر را ذخیره نمی‌کند.')}</p>
    <div role="log" aria-label={t('Conversation', 'گفتگو')} aria-live="polite" style={{ maxHeight: 220, overflowY: 'auto', overflowWrap: 'anywhere' }}>
      {lines.map((line, i) => <div key={i}><p className="vx-small"><strong>{line.role === 'you' ? t('You: ', 'شما: ') : t('Agent: ', 'عامل: ')}</strong>{line.text}</p>
        {line.role === 'you' && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || disabled} onClick={() => { setMemoryStatus(''); setReviewText({ text: line.text, agentId, space }); }}>{t('Review this text for memory', 'بررسی این متن برای حافظه')}</button>}</div>)}
    </div>
    {reviewText !== null && reviewText.agentId === agentId && reviewText.space === space && <MessageMemoryReview key={`${agentId}:${space}`} text={reviewText.text} agentId={agentId} space={space} locale={locale} disabled={disabled}
      onClose={() => setReviewText(null)} onSaved={count => { setReviewText(null); setMemoryStatus(t(`Saved ${count} private user-reviewed claims. Manage them in Privacy.`, `${count} ادعای خصوصیِ بررسی‌شده ذخیره شد. در حریم خصوصی مدیریت کنید.`)); }} />}
    {memoryStatus && <p role="status">{memoryStatus}</p>}
    <label className="vx-small">{t('Message', 'پیام')}<textarea className="vx-textarea" value={draft} rows={3} maxLength={4096} disabled={busy || disabled}
      onChange={e => { setDraft(e.target.value); updatePrediction(e.target.value); }} /></label>
    <label className="vx-small">{t('Image (optional)', 'تصویر (اختیاری)')}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || disabled || loadingImage}
      onChange={e => { void chooseImage(e.target.files?.[0]); e.target.value = ''; }} /></label>
    {image && <div>
      {/* Inline, minimized user selection; no third-party fetch. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt={t('Image selected for this message', 'تصویر انتخاب‌شده برای این پیام')} style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }} />
      <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || disabled} onClick={() => { setImage(undefined); if (prepare) consumer.current?.update({ text: draft, stable: draft.trim().length >= 12 }); }}>{t('Remove image', 'حذف تصویر')}</button>
    </div>}
    <label className="vx-privacy-checkbox"><input type="checkbox" checked={prepare} disabled={busy || disabled} onChange={e => {
      setPrepare(e.target.checked); if (!e.target.checked) consumer.current?.suspend();
      else { consumer.current?.update({ text: draft, image, stable: draft.trim().length >= 12 }); }
    }} />{t('Prepare while I type', 'آماده‌سازی هنگام تایپ')}</label>
    <p className="vx-small vx-2">{t('When selected, your draft and selected image may be sent to OpenAI before you press Send. Preparation stays off when unavailable and never sends a message for you.', 'با انتخاب این گزینه، پیش‌نویس و تصویر انتخاب‌شده ممکن است پیش از زدن ارسال به OpenAI فرستاده شوند. اگر آماده‌سازی در دسترس نباشد خاموش می‌ماند و هرگز از طرف شما پیامی ارسال نمی‌کند.')}</p>
    {lastTurnId && <TaskOutcome key={`${agentId}:${space}:${lastTurnId}`} agentId={agentId} space={space} turnId={lastTurnId} locale={locale} />}
    {prepared && <p className="vx-small" role="status">{t('Context prepared for this draft. You can keep editing.', 'زمینهٔ این پیش‌نویس آماده شد. می‌توانید ویرایش را ادامه دهید.')}</p>}
    {error && <p className="vx-banner danger" role="alert">{error}</p>}
    <button className="vx-btn vx-btn-primary" disabled={busy || disabled || loadingImage || !draft.trim()} onClick={() => void send()}>{busy ? t('Replying…', 'در حال پاسخ…') : t('Send', 'ارسال')}</button>
  </section>;
}
