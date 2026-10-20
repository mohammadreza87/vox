import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { ProductPausePanel } from './ProductPausePanel';
import { parsePauseStatus, useProductPause } from '../_lib/product-pause-client';
import type { ProductPauseControlView } from '@/lib/studio/product-pause-http';
import type { ProductPauseCommandV1 } from '@/lib/adaptive/product-pause/contracts';
const control = (space: 'work' | 'personal' = 'work', extra: Partial<ProductPauseControlView> = {}): ProductPauseControlView => ({ version: 1, accountId: 'account-a', space, available: true, productPaused: false, useEpoch: 0, commandSeq: 0, canPause: true, canResume: true, ...extra });
function result(command: ProductPauseCommandV1, status = control(command.space)) {
  const receipt = { eventId: command.eventId, fingerprint: createHash('sha256').update(JSON.stringify(['product-pause-command-v1', status.accountId, command.space, command.expectedCommandSeq, command.action])).digest('hex'), seq: command.expectedCommandSeq + 1, result: 'changed' as const, resultingUseEpoch: (status.useEpoch ?? 0) + 1, recordedAt: 1 };
  return { status: { ...status, productPaused: command.action === 'pause', commandSeq: receipt.seq, useEpoch: receipt.resultingUseEpoch, latest: receipt }, receipt, replayed: false };
}
let session = 0;
const mount = (locale: 'en' | 'fa' = 'en') => render(<ProductPausePanel sessionKey={`signed-session-${++session}`} locale={locale} />);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
it('strictly validates scoped current status without treating unavailable or malformed state as unpaused', () => {
  expect(() => parsePauseStatus({ ...control(), productPaused: null }, 'work')).toThrow();
  expect(() => parsePauseStatus(control('personal'), 'work')).toThrow();
  expect(() => parsePauseStatus(control(), 'work', 'other-account')).toThrow();
  expect(parsePauseStatus(control('work', { available: false, productPaused: null, useEpoch: null, commandSeq: undefined, canPause: false, canResume: false }), 'work').productPaused).toBeNull();
});
it.each(['en', 'fa'] as const)('keeps %s pending truthful and captures exactly one immutable command with strong opaque identity', async locale => {
  let finish!: (response: Response) => void;
  const commands: ProductPauseCommandV1[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(control());
    commands.push(JSON.parse(String(init.body))); return new Promise<Response>(resolve => { finish = resolve; });
  }));
  const view = mount(locale), fa = locale === 'fa';
  const pause = await screen.findByRole('button', { name: fa ? 'مکث در فضای کاری' : 'Pause in Work' });
  fireEvent.click(pause); fireEvent.click(pause);
  expect(commands).toHaveLength(1); expect(Object.keys(commands[0]).sort()).toEqual(['action', 'eventId', 'expectedCommandSeq', 'space', 'version']);
  expect(commands[0]).toMatchObject({ version: 1, expectedCommandSeq: 0, space: 'work', action: 'pause' }); expect(commands[0].eventId).toMatch(/^[a-f0-9]{48}$/);
  expect(screen.getByText(fa ? 'در حال درخواست مکث در فضای کاری… هنوز تأیید نشده است.' : 'Requesting pause in Work… Not yet confirmed.')).toBeVisible();
  expect(screen.getByText(fa ? /آخرین وضعیت تأییدشده/ : /Last confirmed:/)).toHaveTextContent(fa ? 'در فضای کاری مکث نشده است' : 'Not paused in Work');
  expect(screen.queryByText(fa ? 'مکث در فضای کاری تأیید شد.' : 'Pause confirmed in Work.')).toBeNull();
  await act(async () => { finish(Response.json(result(commands[0]))); });
  await screen.findByText(fa ? 'مکث در فضای کاری تأیید شد.' : 'Pause confirmed in Work.');
  expect(view.container.querySelector('section')).toHaveAttribute('dir', fa ? 'rtl' : 'ltr');
});
it('requires inline deliberate resume, Keep paused restores focus and opening never submits', async () => {
  const pausedResult = result({ version: 1, action: 'pause', eventId: 'a'.repeat(32), expectedCommandSeq: 0, space: 'work' });
  const commands: ProductPauseCommandV1[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { if (init.method === 'GET') return Response.json(pausedResult.status); const command = JSON.parse(String(init.body)); commands.push(command); return Response.json(result(command, pausedResult.status)); }));
  mount(); const review = await screen.findByRole('button', { name: 'Review resume in Work' });
  fireEvent.click(review); expect(screen.getByRole('heading', { name: 'Resume stored personalization in Work?' })).toHaveFocus(); expect(commands).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Keep paused' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Review resume in Work' })).toHaveFocus()); expect(commands).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Review resume in Work' })); fireEvent.click(screen.getByRole('button', { name: 'Resume in Work', exact: true })); await screen.findByText('Pause removed in Work. Existing permissions still apply.'); expect(commands).toHaveLength(1);
});
it('uses GET only after a lost A reply when opposite B is current, and creates C only on a fresh click', async () => {
  const opposite = result({ version: 1, action: 'resume', eventId: 'b'.repeat(32), expectedCommandSeq: 1, space: 'work' }, control('work', { productPaused: true, commandSeq: 1, useEpoch: 1 }));
  let reads = 0; const commands: ProductPauseCommandV1[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(++reads === 1 ? control() : opposite.status);
    const command = JSON.parse(String(init.body)); commands.push(command); if (commands.length === 1) throw new TypeError('lost reply'); return Response.json(result(command, opposite.status));
  }));
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Pause in Work' }));
  await screen.findByText('Current status in Work is shown. The earlier change could not be confirmed.');
  expect(commands).toHaveLength(1); expect(screen.queryByText('Pause confirmed in Work.')).toBeNull(); expect(screen.getByText('Not paused in Work')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Pause in Work' })); await screen.findByText('Pause confirmed in Work.');
  expect(commands[1].expectedCommandSeq).toBe(2); expect(commands[1].eventId).not.toBe(commands[0].eventId);
});
it('reports stale CAS, reads current state and never automatically rebases the old action', async () => {
  const changed = result({ version: 1, action: 'pause', eventId: 'c'.repeat(32), expectedCommandSeq: 0, space: 'work' });
  let reads = 0; const commands: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(++reads === 1 ? control() : changed.status);
    commands.push(JSON.parse(String(init.body))); return Response.json({ error: 'product_pause_stale' }, { status: 409 });
  }));
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Pause in Work' })); await screen.findByText('Settings in Work changed. Review the current status, then choose again if needed.');
  await screen.findByRole('button', { name: 'Review resume in Work' }); expect(commands).toHaveLength(1); expect(screen.queryByText('Pause confirmed in Work.')).toBeNull();
});
it('isolates delayed Work commands from Personal and a new authenticated account', async () => {
  let finish!: (value: Response) => void; let command!: ProductPauseCommandV1;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(control(url.includes('personal') ? 'personal' : 'work', { accountId: new Headers(init.headers).get('x-telegram-init-data') === 'session-b' ? 'account-b' : 'account-a' }));
    command = JSON.parse(String(init.body)); return new Promise<Response>(resolve => { finish = resolve; });
  }));
  const view = render(<ProductPausePanel sessionKey="session-a" />); fireEvent.click(await screen.findByRole('button', { name: 'Pause in Work' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Pause control space' })).getByRole('button', { name: 'Personal' }));
  await screen.findByText('Not paused in Personal'); expect(screen.queryByText(/Requesting pause in Work/)).toBeNull();
  view.rerender(<ProductPausePanel sessionKey="session-b" />); await screen.findByText('Not paused in Personal');
  await act(async () => { finish(Response.json(result(command))); }); expect(screen.queryByText('Pause confirmed in Work.')).toBeNull(); expect(screen.getByText('Not paused in Personal')).toBeVisible();
});
it('never infers unpaused on failed/malformed reads and keeps unsupported legacy availability distinct', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(Response.json(control('work', { available: false, productPaused: null, useEpoch: null, commandSeq: undefined, canPause: false, canResume: false, reason: 'store_not_prepared' })));
  vi.stubGlobal('fetch', fetcher); mount(); await screen.findByText('The current pause status in Work is unknown.'); expect(screen.queryByRole('button', { name: 'Pause in Work' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check current status' })); await screen.findByText('Personalization pause is not available for this account yet. No pause has been confirmed here.'); expect(screen.queryByText('Not paused in Work')).toBeNull();
});
it.each(['busy', 'denied', 'unavailable', 'missing', 'unknown_future', 'unsupported_transport', undefined])('blocks covered use for an unverified HTTP 200 status (%s)', async reason => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(control('work', { available: false, productPaused: null, useEpoch: null,
    commandSeq: undefined, canPause: false, canResume: false, reason }))));
  const sessionKey = `status-probe-${++session}`;
  function Probe() { const pause = useProductPause('work', sessionKey); return <output>{pause.phase}:{String(pause.coveredBlocked)}</output>; }
  render(<Probe />);
  await screen.findByText('ready:true');
});
it('preserves legacy controls only for an explicitly unprepared store', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(control('work', { available: false, productPaused: null, useEpoch: null,
    commandSeq: undefined, canPause: false, canResume: false, reason: 'store_not_prepared' }))));
  const sessionKey = `legacy-status-probe-${++session}`;
  function Probe() { const pause = useProductPause('work', sessionKey); return <output>{pause.phase}:{String(pause.coveredBlocked)}</output>; }
  render(<Probe />);
  await screen.findByText('ready:false');
});

it.each(['en', 'fa'] as const)('preserves a verified saved pause when %s controls are unavailable without claiming it was never confirmed', async locale => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(control('work', { available: false, productPaused: true, useEpoch: 1, commandSeq: undefined, canPause: false, canResume: false, reason: 'unsupported_transport' }))));
  mount(locale); const fa = locale === 'fa';
  expect(await screen.findByText(fa ? 'مکث ذخیره‌شدهٔ شما برقرار است؛ این کنترل‌ها در دسترس نیستند. وضعیت فعلی را بررسی کنید.' : 'Your saved pause remains in place; these controls are unavailable. Check current status.')).toBeVisible();
  expect(screen.getByText(fa ? 'در فضای کاری مکث شده است' : 'Paused in Work')).toBeVisible(); expect(screen.queryByText(/No pause has been confirmed here|اینجا هیچ مکثی تأیید نشده است/)).toBeNull();
  expect(screen.queryByRole('button', { name: fa ? 'بررسی ازسرگیری در فضای کاری' : 'Review resume in Work' })).toBeNull(); expect(screen.getByRole('button', { name: fa ? 'بررسی وضعیت فعلی' : 'Check current status' })).toBeEnabled();
});

it.each(['missing', 'product_pause_unavailable', 'unsupported_transport', 'unsupported_store'])('treats unavailable reason %s as unverified authority rather than proof of legacy storage', async reason => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(control('work', { available: false, productPaused: null, useEpoch: null, commandSeq: undefined, canPause: false, canResume: false, reason }))));
  mount(); expect(await screen.findByText('Pause status could not be verified. Check current status.')).toBeVisible(); expect(screen.queryByText(/No pause has been confirmed here/)).toBeNull(); expect(screen.queryByText('Not paused in Work')).toBeNull();
});
