'use client';
import { useEffect, useRef, useState } from 'react';
import { learningApi } from '../_lib/learning-client';
/** Explicit optional feedback, correlated to a server-accepted turn. It never
 * proves an external task completed and accepts no private reason/free text. */
export function TaskOutcome({ agentId, space, turnId, locale = 'en' }: {
  agentId: string; space: 'work' | 'personal'; turnId: string; locale?: 'en' | 'fa';
}) {
  const fa = locale === 'fa';
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'unavailable'>('idle');
  const generation = useRef(0), revision = useRef(0), busy = useRef(false);
  useEffect(() => { const current = ++generation.current; revision.current = 0; busy.current = false; setState('idle'); return () => { generation.current = current + 1; }; }, [agentId, space, turnId]);
  const send = async (outcome: 'task_succeeded' | 'task_failed' | 'task_unknown') => {
    if (busy.current) return; busy.current = true; setState('busy'); const current = generation.current;
    try {
      const response = await learningApi.event({ agentId, space, turnId, eventId: `task-${turnId}`, revision: ++revision.current, outcome });
      if (current === generation.current) setState(response.recorded || response.duplicate ? 'saved' : 'unavailable');
    } catch { if (current === generation.current) setState('unavailable'); }
    finally { if (current === generation.current) busy.current = false; }
  };
  return <div dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-label={fa ? 'نتیجهٔ گزارش‌شدهٔ کار' : 'Reported task outcome'}>
    <p className="vx-small">{fa ? 'آیا این پاسخ به انجام کارتان کمک کرد؟ (اختیاری)' : 'Did this response help you complete your task? (optional)'}</p>
    <div className="vx-privacy-actions">
      {([['task_succeeded', 'Yes', 'بله'], ['task_failed', 'No', 'خیر'], ['task_unknown', 'Not sure', 'مطمئن نیستم']] as const).map(([outcome, en, persian]) =>
        <button key={outcome} className="vx-btn vx-btn-secondary vx-btn-sm" disabled={state === 'busy'} onClick={() => void send(outcome)}>{fa ? persian : en}</button>)}
    </div>
    {state === 'saved' && <p className="vx-small" role="status">{fa ? 'گزارش شما ذخیره شد؛ این به معنی تأیید مستقل نتیجه نیست.' : 'Your report was saved; the outcome has not been independently verified.'}</p>}
    {state === 'unavailable' && <p className="vx-small" role="status">{fa ? 'اندازه‌گیری اختیاری در دسترس نیست. گفتگو همچنان قابل استفاده است.' : 'Optional measurement is unavailable. You can continue the conversation.'}</p>}
  </div>;
}
