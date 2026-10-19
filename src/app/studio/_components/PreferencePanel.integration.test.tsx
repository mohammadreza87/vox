import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PreferencePanel } from './PreferencePanel';
import { handleExperienceRequest } from '@/lib/adaptive/runtime/http';
import { signInitData } from '@/lib/studio/auth';
import { hire, ID, makeStudio, seedOrg } from '@/lib/studio/__tests__/helpers';
import { NOW, preferenceFixture } from '@/lib/adaptive/personalization/__tests__/fixtures';

const fixtures: Awaited<ReturnType<typeof preferenceFixture>>[] = [];
afterEach(async () => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
  await Promise.all(fixtures.splice(0).map(f => f.close()));
});
it.each([{ locale: 'en', file: true }, { locale: 'fa', file: true }, { locale: 'en', file: false }, { locale: 'fa', file: false }] as const)(
  'connects $locale controls through the typed client and signed HTTP handler (file=$file)', async ({ locale, file }) => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const h = makeStudio(), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  const f = await preferenceFixture({ file, telegramId: ID.alice, agentId: agent.id }); fixtures.push(f);
  h.studio.deps.adaptive = f.adaptive; h.studio.deps.experience = f.experience;
  await f.grant(); await f.agent();
  const token = '123:synthetic-ui-preferences', initData = signInitData({ id: ID.alice, first_name: 'Synthetic' }, token);
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData } };
  const methods: string[] = [];
  // Transport only: model the browser's same-origin URL/header behavior. Every
  // response comes from the real authenticated handler; no API reply is mocked.
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const target = new URL(url, 'https://vox.synthetic'), headers = new Headers(init.headers);
    headers.set('origin', target.origin); methods.push(`${init.method} ${target.pathname}`);
    return handleExperienceRequest(h.studio, f.experience, new Request(target, { ...init, headers }),
      target.pathname.replace('/api/studio/experience', '').split('/').filter(Boolean), token);
  });
  const first = await f.state();
  function Harness() {
    const [revision, setRevision] = useState(first.revision);
    return <PreferencePanel agentId={agent.id} space="work" confirmed revisionHint={revision} locale={locale} onSnapshot={s => setRevision(s.revision)} />;
  }
  render(<Harness />);
  const fa = locale === 'fa';
  const flowText = (text: string) => screen.findByText(text, {}, { timeout: 5000 });
  const select = await screen.findByLabelText(fa ? 'زبان پاسخ' : 'Reply language', {}, { timeout: 5000 });
  fireEvent.change(select, { target: { value: 'fa' } });
  const row = screen.getByRole('article', { name: fa ? 'ترجیح: زبان پاسخ' : 'Reply language preference' });
  fireEvent.click(within(row).getByRole('button', { name: fa ? 'ذخیرهٔ ترجیح' : 'Save preference' }));
  expect(await flowText(fa ? 'ذخیره شد.' : 'Saved.')).toBeInTheDocument();
  expect((await f.factory().experience.readPreferences(ID.alice, 'work', agent.id)).settings).toEqual([{ key: 'language', value: 'fa' }]);
  fireEvent.click(within(screen.getByRole('article', { name: fa ? 'ترجیح: زبان پاسخ' : 'Reply language preference' })).getByRole('button', { name: fa ? 'بازنشانی' : 'Reset' }));
  if (!file) {
    await waitFor(() => expect(screen.getByLabelText(fa ? 'زبان پاسخ' : 'Reply language')).toHaveValue('auto'), { timeout: 5000 });
    expect(screen.getAllByText(fa ? 'دلیل دقیق و واگرد اینجا در دسترس نیست. ذخیره و بازنشانی ترجیح همچنان ممکن است.'
      : 'Detailed explanations and undo are unavailable here. You can still save or reset a preference.')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: fa ? 'واگرد آخرین تغییر' : 'Undo last change' })).not.toBeInTheDocument();
    expect((await f.state()).entries.find(e => e.setting.key === 'language')?.saved?.status).toBe('reset');
    expect((await f.experience.readPreferences(ID.alice, 'work', agent.id)).settings).toEqual([]);
    return;
  }
  expect(await flowText(fa ? 'به دلیل بازنشانی صریح شما، شیوهٔ پیش‌فرض استفاده می‌شود.' : 'Default style is used because you explicitly reset this choice.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: fa ? 'واگرد آخرین تغییر' : 'Undo last change' }));
  expect(await flowText(fa ? 'آخرین تغییر واگرد شد.' : 'Last change undone.')).toBeInTheDocument();
  const persisted = await f.factory().experience.readPreferenceState(ID.alice, 'work', agent.id);
  expect(persisted.entries.find(e => e.setting.key === 'language')).toMatchObject({ explanation: 'explicit_choice', saved: { status: 'active', setting: { value: 'fa' } } });
  expect(persisted.entries.every(e => !e.undo)).toBe(true);
  expect((await f.state('personal')).entries.every(e => !e.saved)).toBe(true);
  // A stale tab still displays a pre-expiry token while server time advances.
  // Its genuine post-expiry HTTP attempt must fail without claiming undo.
  fireEvent.change(screen.getByLabelText(fa ? 'اندازهٔ پاسخ' : 'Reply length'), { target: { value: 'brief' } });
  fireEvent.click(within(screen.getByRole('article', { name: fa ? 'ترجیح: اندازهٔ پاسخ' : 'Reply length preference' })).getByRole('button', { name: fa ? 'ذخیرهٔ ترجیح' : 'Save preference' }));
  await flowText(fa ? 'ذخیره شد.' : 'Saved.');
  f.setNow(NOW + 10 * 60_000 + 1);
  fireEvent.click(screen.getByRole('button', { name: fa ? 'واگرد آخرین تغییر' : 'Undo last change' }));
  expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(fa ? 'تغییر تأیید نشد' : 'The change was not confirmed');
  expect(screen.queryByText(fa ? 'آخرین تغییر واگرد شد.' : 'Last change undone.')).not.toBeInTheDocument();
  const expired = await f.state();
  expect(expired.entries.find(e => e.setting.key === 'response_length')?.saved?.setting.value).toBe('brief');
  expect(expired.entries.every(e => !e.undo)).toBe(true);
  expect(methods.filter(m => m.startsWith('PUT '))).toHaveLength(3);
  expect(methods.filter(m => m === 'POST /api/studio/experience/preferences/undo')).toHaveLength(2);
  expect(await f.adaptive.withAccountDocument(ID.alice, d => d.observer.events)).toEqual([]);
});
