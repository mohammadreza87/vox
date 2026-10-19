import { describe, expect, it, vi } from 'vitest';
import { telegramReminderTransport } from '../reminder-delivery';
import { GENERIC_REMINDER_TEXT } from '../../adaptive/runtime/reminders/service';
const input = () => ({ telegramId: 123, reference: 'opaque-id', text: GENERIC_REMINDER_TEXT, authorize: vi.fn(async () => true), authorizeNow: vi.fn(() => 'allowed' as const), signal: new AbortController().signal });
describe('single-attempt reminder Telegram adapter', () => {
  it.each([
    [{ ok: false, description: 'PRIVATE_ERROR' }, 'failed'],
    [{ ok: true, result: { message_id: 42, chat: { id: 123 } } }, 'accepted'],
    [{ ok: true, result: { message_id: 42, chat: { id: 999 } } }, 'unknown'],
    [{ ok: true, result: { message_id: -1, chat: { id: 123 } } }, 'unknown'],
    [{ malformed: true }, 'unknown'],
  ])('retains only a bounded receipt for %j', async (response, state) => {
    const fetcher = vi.fn(async () => Response.json(response));
    const result = await telegramReminderTransport({ botToken: 'synthetic', fetcher }).send(input());
    expect(result.state).toBe(state); expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ERROR');
  });
  it('does not send on revoked or aborted authority', async () => {
    const fetcher = vi.fn(), transport = telegramReminderTransport({ botToken: 'synthetic', fetcher });
    const revoked = input(); revoked.authorize.mockResolvedValue(false);
    expect(await transport.send(revoked)).toEqual({ state: 'cancelled' });
    const aborted = input(); aborted.signal = AbortSignal.abort();
    expect(await transport.send(aborted)).toEqual({ state: 'cancelled' }); expect(fetcher).not.toHaveBeenCalled();
    expect(aborted.authorize).not.toHaveBeenCalled();
  });
  it('never retries ambiguous network errors or malformed JSON', async () => {
    const fetcher = vi.fn(async () => { throw new Error('PRIVATE_ERROR'); });
    expect(await telegramReminderTransport({ botToken: 'synthetic', fetcher }).send(input())).toEqual({ state: 'unknown' });
    expect(fetcher).toHaveBeenCalledOnce();
    const malformed = vi.fn(async () => new Response('invalid json'));
    expect(await telegramReminderTransport({ botToken: 'synthetic', fetcher: malformed }).send(input())).toEqual({ state: 'unknown' }); expect(malformed).toHaveBeenCalledOnce();
  });
});

it.each([[503, true, 'unknown'], [503, false, 'unknown'], [400, false, 'failed']] as const)('does not invent acceptance from HTTP%s and ok:%s', async (status, ok, state) => {
  const fetcher = vi.fn(async () => Response.json({ ok, result: { message_id: 42, chat: { id: 123 } } }, { status }));
  expect(await telegramReminderTransport({ botToken: 'synthetic', fetcher }).send(input())).toEqual({ state });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(['busy', 'denied'] as const)('never initiates fetch when the synchronous committed snapshot is %s', async state => {
  const fetcher = vi.fn(); const value = { ...input(), authorizeNow: () => state };
  expect(await telegramReminderTransport({ botToken: 'synthetic', fetcher }).send(value)).toEqual({ state: state === 'busy' ? 'deferred' : 'cancelled' });
  expect(fetcher).not.toHaveBeenCalled();
});
