/** C07: new private guidance cannot reopen marked history or attached old quotes. */
import { afterEach, expect, it, vi } from 'vitest';
import { memoryAccountFixture, type MemoryAccountFixture } from './memory-account-fixture';
import { ID } from './helpers';

let fixture: MemoryAccountFixture | undefined;
afterEach(async () => { vi.restoreAllMocks(); await fixture?.closeOwned(); fixture = undefined; });

it('C07 keeps marked original private input current-turn-only with conditional guidance', async () => {
  const f = fixture = await memoryAccountFixture();
  const chatKey = `private-tg-${ID.alice}`;
  await f.h.memory.history.append(f.agentId, chatKey, { role: 'assistant', text: 'MARKED_HISTORY_F3_CANARY question?', at: new Date(f.clock.now()) });
  const update = f.update('What was the earlier question? همان سوال قبلی چه بود؟');
  update.message!.reply_to_message = { message_id: 1, date: update.message!.date - 20, chat: update.message!.chat,
    from: { id: ID.bob, is_bot: false, first_name: 'Synthetic' }, text: 'MARKED_QUOTE_F3_CANARY question?' };
  const before = f.raw(); f.clearCalls();
  await f.throughPoller(update);
  expect(f.h.chatLLM.replyRequests).toHaveLength(1);
  const request = f.h.chatLLM.replyRequests[0], full = JSON.stringify(request);
  expect(full).not.toContain('MARKED_HISTORY_F3_CANARY');
  expect(full).not.toContain('MARKED_QUOTE_F3_CANARY');
  expect(full).toContain('What was the earlier question? همان سوال قبلی چه بود؟');
  expect(full).toContain('In this private conversation, rely on the messages, quoted text and authorized saved context actually supplied for this reply;');
  expect(f.h.chatLLM.extractionRequests).toEqual([]);
  expect(JSON.stringify(f.calls)).not.toMatch(/MARKED_(?:HISTORY|QUOTE)_F3_CANARY/);
  expect((await f.h.memory.history.recent(f.agentId, chatKey, 20)).map(m => m.text)).toEqual(['MARKED_HISTORY_F3_CANARY question?']);
  expect(f.raw()).toBe(before);
  expect(f.calls.filter(c => c.method === 'sendMessage')).toHaveLength(1);
  console.info('F3_PROBE', JSON.stringify({ id: 'C07', arm: 'actual-marked-FILE-ingress', subprobe: 'current-turn-and-quote-exclusion', predicate: 'assembled-input-and-authority' }));
});
