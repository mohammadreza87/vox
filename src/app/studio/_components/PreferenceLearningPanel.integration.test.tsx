import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PreferenceLearningPanel } from './PreferenceLearningPanel';
import { PreferencePanel } from './PreferencePanel';
import { ConversationPanel } from './ConversationPanel';
import { handleExperienceRequest } from '@/lib/adaptive/runtime/http';
import { handleConversationRequest } from '@/lib/studio/conversation';
import { signInitData } from '@/lib/studio/auth';
import { ID } from '@/lib/studio/__tests__/helpers';
import { learningFixture } from '@/lib/adaptive/personalization/learning/fixtures';
import { NOW } from '@/lib/adaptive/personalization/__tests__/fixtures';
const fixtures: Awaited<ReturnType<typeof learningFixture>>[] = [];
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (window as unknown as { Telegram?: unknown }).Telegram; await Promise.all(fixtures.splice(0).map(f => f.close())); });
it.each(['en', 'fa'] as const)('connects %s current text→review-only candidate→Use→genuine Undo through real authenticated handlers/file storage', async locale => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const x = await learningFixture(); fixtures.push(x); await x.f.grant(); await x.f.agent();
  const token = '123:synthetic-learning-ui', initData = signInitData({ id: ID.alice, first_name: 'Synthetic' }, token);
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData } };
  const methods: string[] = [];
  // Browser transport only: every API response comes from its real signed
  // handler and actual FILE aggregate. Only external text providers are synthetic.
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const target = new URL(url, 'https://vox.synthetic'), headers = new Headers(init.headers); headers.set('origin', target.origin);
    methods.push(`${init.method} ${target.pathname}`); const request = new Request(target, { ...init, headers });
    return target.pathname === '/api/studio/conversation' ? handleConversationRequest(x.h.studio, request, token)
      : handleExperienceRequest(x.h.studio, x.experience, request, target.pathname.replace('/api/studio/experience', '').split('/').filter(Boolean), token);
  });
  const initial = await x.view();
  function Harness() { const [revision, setRevision] = useState(initial.revision); return <>
    <PreferencePanel agentId={x.agent.id} space="work" confirmed revisionHint={revision} locale={locale} onSnapshot={s => setRevision(s.revision)} />
    <PreferenceLearningPanel agentId={x.agent.id} space="work" confirmed revisionHint={revision} locale={locale} onRevision={setRevision} />
    <ConversationPanel agentId={x.agent.id} space="work" locale={locale} />
  </>; }
  render(<Harness />); const fa = locale === 'fa';
  await screen.findByLabelText(fa ? 'زبان پاسخ' : 'Reply language', {}, { timeout: 5000 });
  fireEvent.click(await screen.findByRole('button', { name: fa ? 'بررسی یادگیری پیشنهادها' : 'Review suggestion learning' }));
  fireEvent.click(await screen.findByRole('button', { name: fa ? 'فعال کردن پیشنهادها' : 'Enable suggestions' }, { timeout: 5000 }));
  await screen.findByRole('button', { name: fa ? 'خاموش کردن یادگیری پیشنهادها' : 'Turn suggestion learning off' });
  fireEvent.change(screen.getByLabelText(fa ? 'پیام' : 'Message'), { target: { value: 'Please keep future replies brief.' } });
  fireEvent.click(screen.getByRole('button', { name: fa ? 'ارسال' : 'Send' })); await screen.findByText('Sure.', {}, { timeout: 5000 });
  await x.learning.tasks.settle(); expect((await x.experience.readPreferences(ID.alice, 'work', x.agent.id)).settings).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: fa ? 'تازه‌سازی پیشنهادها' : 'Refresh suggestions' }));
  fireEvent.click(await screen.findByRole('button', { name: fa ? 'استفاده از ترجیح' : 'Use preference' }, { timeout: 5000 }));
  const undo = await screen.findByRole('button', { name: fa ? 'واگرد آخرین تغییر' : 'Undo last change' }, { timeout: 5000 });
  expect((await x.experience.readPreferences(ID.alice, 'work', x.agent.id)).settings).toEqual([{ key: 'response_length', value: 'brief' }]);
  fireEvent.click(undo); await screen.findByText(fa ? 'آخرین تغییر واگرد شد.' : 'Last change undone.');
  await waitFor(async () => expect((await x.experience.readPreferences(ID.alice, 'work', x.agent.id)).settings).toEqual([]));
  expect((await x.view()).candidates).toEqual([]); expect(x.provider.evaluate).toHaveBeenCalledOnce();
  expect(methods).toContain('POST /api/studio/conversation'); expect(methods).toContain('POST /api/studio/experience/preferences/undo');
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.observer.events)).toEqual([]);
});
