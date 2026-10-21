'use client';
import { useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LivePredictionConsumer, predictionHttpTransport } from '@/lib/adaptive/prediction/client';
import { prepareSharedImage } from '@/lib/adaptive/prediction/image-browser';
import { observeCommittedText } from '@/lib/adaptive/observation/committed-text';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { learningApi } from '../_lib/learning-client';
import { TaskOutcome } from './TaskOutcome';
import { MessageMemoryReview } from './MessageMemoryReview';
import { useProductPause } from '../_lib/product-pause-client';
import { pauseText } from '../_lib/product-pause-copy';
import { tg, request as studioRequest } from '../_lib/client';
import { haptic } from '../_lib/haptics';
import { preferenceLearningApi } from '../_lib/preference-learning-client';
import { AgentFace } from './Cloud';
import { Banner, Composer, Icon, Seg, Sheet, SheetHead, Switch, Typing } from './ui';
import { LiveSheet } from './screens/settings/kit';

/** Typed fallback and explicit image sharing use the same scoped agent context
 * as calls. Draft processing is a separate, off-by-default user choice. */
type Presentation = { density: 'compact' | 'comfortable'; receipt: string };
type SharedImage = { sourceId: string; revision: number; dataUrl: string };
type ConversationLine = {
  id: string; role: 'you' | 'agent'; text: string; turnId?: string; started?: number; epoch?: number; session?: string; presentation?: Presentation;
  /** Your line only: shown at once, then confirmed, or kept with Retry when it could not be sent. */
  status?: 'sending' | 'failed'; image?: SharedImage;
};
export type ChatAgent = { name: string; look: CharacterLook; stage?: Stage };
function presentation(raw: unknown): Presentation | undefined {
  if (!raw || typeof raw !== 'object' || !('density' in raw) || !['compact', 'comfortable'].includes(String(raw.density)) || !('receipt' in raw) || typeof raw.receipt !== 'string' || !/^[a-f0-9]{64}$/.test(raw.receipt)) return undefined;
  return { density: raw.density as Presentation['density'], receipt: raw.receipt };
}
let lineSeq = 0;
const nextId = () => `line-${++lineSeq}`;
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

/**
 * The chat (UI §5.3): bubbles, one composer with an attach tool, a thinking cloud while the agent replies,
 * Retry on a message that could not be sent, and "Remember this" from your own bubble.
 * Options (space, "Prepare while I type") live in a sheet the screen opens from its top bar.
 */
export function ConversationPanel({ agentId, space, locale = 'en', disabled = false, agent, optionsOpen = false, onOptionsClose, onSpaceChange }: {
  agentId: string; space: 'work' | 'personal'; locale?: 'en' | 'fa'; disabled?: boolean;
  agent?: ChatAgent; optionsOpen?: boolean; onOptionsClose?: () => void; onSpaceChange?: (space: 'work' | 'personal') => void;
}) {
  const session = tg()?.initData ?? '';
  const pause = useProductPause(space, session);
  const historicBlocked = pause.coveredBlocked;
  const paused = pause.status?.productPaused === true;
  const fa = locale === 'fa';
  const t = (en: string, persian: string) => fa ? persian : en;
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState<SharedImage>();
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
  const fileInput = useRef<HTMLInputElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
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
    // A message still in flight was never answered under the new boundary: keep its text, offer Retry.
    setLines(previous => previous.map(line => line.status === 'sending' ? { ...line, status: 'failed' } : line));
    if (!disabled) startPredictionTurn();
  }, [pause.status?.accountId, pause.status?.useEpoch, historicBlocked, disabled, startPredictionTurn]);
  // New lines land at the bottom of the thread.
  useEffect(() => {
    const el = scroller.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [lines.length, busy, reduced]);
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
    } catch { if (!controller.signal.aborted) { haptic.error(); setError(t('Choose a smaller PNG, JPEG or WebP image.', 'یک تصویر کوچک‌تر PNG، JPEG یا WebP انتخاب کنید.')); } }
    finally { if (imageRequest.current === controller) setLoadingImage(false); }
  };
  const removeImage = () => { setImage(undefined); if (prepare && !historicBlocked) consumer.current?.update({ text: draft, stable: draft.trim().length >= 12 }); };
  /** Sends `text` (and its image) as one turn. `retry` re-sends a failed line in place. */
  const deliver = async (text: string, shared: SharedImage | undefined, retry?: string) => {
    if (busy || disabled || loadingImage || !text.trim()) return;
    const current = generation.current, started = performance.now(), currentSession = tg()?.initData ?? '';
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    const logicalTurn = consumer.current?.snapshotTurn();
    const id = retry ?? nextId();
    consumer.current?.suspend(); setPrepared(false); setBusy(true); setError('');
    // Optimistic: your bubble appears at once and the composer clears.
    setLines(previous => retry ? previous.map(line => line.id === id ? { ...line, status: 'sending' } : line) : [...previous, { id, role: 'you' as const, text, status: 'sending' as const, image: shared }].slice(-20));
    if (!retry) { setDraft(''); setImage(undefined); }
    let completed = false;
    try {
      // A prediction is never promoted into authority, tool input or an answer.
      const response = await fetch('/api/studio/conversation', { method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': tg()?.initData ?? '' },
        body: JSON.stringify({ agentId, space, text, ...(logicalTurn ? { turn: logicalTurn } : {}), ...(shared ? { image: shared.dataUrl } : {}) }) });
      if (!response.ok) throw new Error('conversation_unavailable');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('reply' in data) || typeof data.reply !== 'string') throw new Error('invalid_reply');
      if (controller.signal.aborted || generation.current !== current) return;
      const reply = data.reply;
      const turnId = 'turnId' in data && typeof data.turnId === 'string' ? data.turnId : undefined;
      setLastTurnId(turnId);
      setLines(previous => [...previous.map(line => line.id === id ? { ...line, status: undefined } : line),
        { id: nextId(), role: 'agent' as const, text: reply, epoch: current, session: currentSession, started, turnId, presentation: presentation('responsePresentation' in data ? data.responsePresentation : undefined) }].slice(-20));
      completed = true;
    } catch {
      if (!controller.signal.aborted && generation.current === current) {
        haptic.error();
        setLines(previous => previous.map(line => line.id === id ? { ...line, status: 'failed' } : line));
        setError(t('Your message could not be completed. Check your settings and agent access in You before trying again.', 'پیام شما کامل نشد. پیش از تلاش دوباره تنظیمات و دسترسی عامل را در بخش «شما» بررسی کنید.'));
      }
    } finally {
      if (generation.current === current) { setBusy(false); if (completed && !disabled) startPredictionTurn(); }
    }
  };
  const send = () => void deliver(draft, image);
  const lastAgent = lines.reduce((found, line, i) => line.role === 'agent' ? i : found, -1);
  const failedId = [...lines].reverse().find(line => line.status === 'failed')?.id;
  const reviewing = !historicBlocked && reviewText !== null && reviewText.agentId === agentId && reviewText.space === space;
  const spaceName = space === 'work' ? t('Work', 'کاری') : t('Personal', 'شخصی');

  return <section className="vx-chat" dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-label={t('Chat', 'گفتگو')} aria-busy={busy || loadingImage}>
    <div className="vx-chat-scroll" ref={scroller}>
      {paused && <Banner tone="warn"><span role="status">{pauseText(locale, space, 'conversation')}</span></Banner>}
      <p className="vx-footnote vx-chat-intro">{paused ? pauseText(locale, space, 'history') : t(`Uses ${spaceName} memories you allow. Images are sent for one message only and aren’t saved.`, `از حافظه‌های مجاز فضای ${spaceName} استفاده می‌کند. تصویر فقط برای یک پیام فرستاده و ذخیره نمی‌شود.`)}</p>
      <div className="vx-thread" role="log" aria-label={t('Conversation', 'گفتگو')} aria-live="polite">
          {lines.map((line, i) => line.role === 'agent'
            ? <div key={line.id} className="vx-msg agent">
              {/* Only the first bubble of a run carries the face (UI §5.3); a still disc below 56 px (UI §6.1) */}
              {agent && (i === 0 || lines[i - 1].role !== 'agent')
                ? <span className="vx-msg-face"><AgentFace look={agent.look} stage={agent.stage} size={28} variant="disc" still label={agent.name} /></span>
                : <span className="vx-msg-face" aria-hidden="true" />}
              <div className="vx-msg-col">
                <div className="vx-bubble agent" dir="auto"><CommittedReply line={line} agentId={agentId} space={space} current={() => !disabled && line.epoch === generation.current && line.session === (tg()?.initData ?? '')} /></div>
                {i === lastAgent && lastTurnId && line.turnId === lastTurnId && <TaskOutcome key={`${agentId}:${space}:${lastTurnId}`} agentId={agentId} space={space} turnId={lastTurnId} locale={locale} />}
              </div>
            </div>
            : <div key={line.id} className={`vx-msg me${line.status ? ` ${line.status}` : ''}`}>
              {line.status !== 'failed' && line.status !== 'sending' && <button type="button" className="vx-msg-more" aria-label={t('Review this text for memory', 'بررسی این متن برای حافظه')}
                aria-describedby={historicBlocked ? 'vox-historic-review-reason' : undefined} disabled={busy || disabled || historicBlocked}
                onClick={() => { haptic.light(); setMemoryStatus(''); setReviewText({ text: line.text, agentId, space }); }}><Icon name="more" size={18} /></button>}
              <div className="vx-msg-col">
                <div className={`vx-bubble me${line.status === 'failed' ? ' failed' : ''}`} dir="auto">
                  {line.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- an in-memory data URL the user just chose; never fetched
                    <img className="vx-msg-image" src={line.image.dataUrl} alt={t('Image shared with this message', 'تصویر همراه این پیام')} />
                  )}
                  {line.text}
                </div>
                {line.status === 'sending' && <span className="vx-bubble-meta me">{t('Sending…', 'در حال ارسال…')}</span>}
                {line.status === 'failed' && <div className="vx-msg-failed">
                  {line.id === failedId && error ? <span role="alert">{error}</span> : <span>{t('Not sent', 'ارسال نشد')}</span>}
                  <button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy || disabled || loadingImage} onClick={() => { haptic.tap(); void deliver(line.text, line.image, line.id); }}>
                    <Icon name="refresh" size={14} />{t('Retry', 'تلاش دوباره')}</button>
                </div>}
              </div>
            </div>)}
          {busy && <div key="typing" className="vx-msg agent">
            {agent && lines.at(-1)?.role !== 'agent'
              ? <span className="vx-msg-face"><AgentFace look={agent.look} stage={agent.stage} size={28} variant="disc" still expr="thinking" label={t(`${agent.name} is thinking`, `${agent.name} در حال فکر کردن است`)} /></span>
              : <span className="vx-msg-face" aria-hidden="true" />}
            <Typing label={t('Replying…', 'در حال پاسخ…')} />
          </div>}
        {memoryStatus && <p className="vx-chat-system" role="status"><Icon name="check" size={14} width={2} />{memoryStatus}</p>}
      </div>
      {historicBlocked && <p id="vox-historic-review-reason" className="vx-footnote">{paused ? pauseText(locale, space, 'historicDisabled') : pauseText(locale, space, 'unverified')}</p>}
    </div>

    <div className="vx-chat-dock" data-snack-anchor>
      {prepared && <p className="vx-chat-prepared" role="status"><Icon name="spark" size={14} />{t('Context prepared for this draft. You can keep editing.', 'زمینهٔ این پیش‌نویس آماده شد. می‌توانید ویرایش را ادامه دهید.')}</p>}
      {error && !failedId && <Banner tone="danger">{error}</Banner>}
      {image && <div className="vx-chat-attachment">
        {/* Inline, minimized user selection; no third-party fetch. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.dataUrl} alt={t('Image selected for this message', 'تصویر انتخاب‌شده برای این پیام')} />
        <span>{t('Image for this message only', 'تصویر فقط برای این پیام')}</span>
        <button type="button" className="vx-icon-btn" aria-label={t('Remove image', 'حذف تصویر')} disabled={busy || disabled} onClick={removeImage}><Icon name="close" size={18} /></button>
      </div>}
      <input ref={fileInput} className="vx-file" type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} aria-label={t('Image (optional)', 'تصویر (اختیاری)')}
        disabled={busy || disabled || loadingImage} onChange={e => { void chooseImage(e.target.files?.[0]); e.target.value = ''; }} />
      <Composer multiline value={draft} maxLength={4096} label={t('Message', 'پیام')} sendLabel={t('Send', 'ارسال')}
        placeholder={agent ? t(`Message ${agent.name}`, `پیام به ${agent.name}`) : t('Message', 'پیام')} busy={busy || loadingImage} disabled={busy || disabled}
        onChange={value => { setDraft(value); updatePrediction(value); }} onSend={send}
        tool={<button type="button" className="vx-composer-tool" aria-label={t('Attach an image', 'پیوست تصویر')} disabled={busy || disabled || loadingImage}
          onClick={() => fileInput.current?.click()}><Icon name="attach" size={20} /></button>} />
    </div>

    <LiveSheet open={reviewing} scope={`${agentId}:${space}:${session}:${pause.status?.accountId}:${pause.status?.useEpoch}:${historicBlocked}`} onClose={() => setReviewText(null)} label={t('Remember this', 'به خاطر سپردن')}>
      {reviewing && <MessageMemoryReview key={`${agentId}:${space}`} text={reviewText.text} agentId={agentId} space={space} locale={locale} disabled={disabled}
        onClose={() => setReviewText(null)} onSaved={count => { haptic.success(); setReviewText(null); setMemoryStatus(t(`Saved ${count} private user-reviewed claims. Manage them in You.`, `${count} ادعای خصوصیِ بررسی‌شده ذخیره شد. در بخش «شما» مدیریت کنید.`)); }} />}
    </LiveSheet>

    <Sheet open={optionsOpen} onClose={() => onOptionsClose?.()} label={t('Chat options', 'گزینه‌های گفتگو')}>
      <div className="vx-sheet-stack">
        <SheetHead title={t('Chat options', 'گزینه‌های گفتگو')} />
        {onSpaceChange && <>
          <Seg label={t('Conversation space', 'فضای گفتگو')} value={space} disabled={busy} onChange={onSpaceChange}
            options={[{ value: 'work', label: t('Work', 'کاری') }, { value: 'personal', label: t('Personal', 'شخصی') }]} />
          <p className="vx-footnote">{t('Switching space starts a new conversation with that space’s memories.', 'تغییر فضا گفتگوی تازه‌ای با حافظه‌های همان فضا شروع می‌کند.')}</p>
        </>}
        <div className="vx-group">
          <Switch checked={prepare} disabled={busy || disabled || historicBlocked} label={t('Prepare while I type', 'آماده‌سازی هنگام تایپ')} sub={t('Off by default', 'به‌طور پیش‌فرض خاموش')}
            onChange={next => {
              setPrepare(next); if (!next) consumer.current?.suspend();
              else { consumer.current?.update({ text: draft, image, stable: draft.trim().length >= 12 }); }
            }} />
        </div>
        <p className="vx-footnote">{t('When on, your draft and selected image may be sent to OpenAI before you press Send. Preparation stays off when unavailable and never sends a message for you.', 'با روشن بودن، پیش‌نویس و تصویر انتخاب‌شده ممکن است پیش از زدن ارسال به OpenAI فرستاده شوند. اگر آماده‌سازی در دسترس نباشد خاموش می‌ماند و هرگز از طرف شما پیامی ارسال نمی‌کند.')}</p>
      </div>
    </Sheet>
  </section>;
}
