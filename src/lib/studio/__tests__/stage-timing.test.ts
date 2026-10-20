import { describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { handleAgentUpdate } from '../updates';
import { expectContentFreeStageTimings } from '@/test/telegram-diagnostics';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const TEXT_CANARY = 'STUDIO_STAGE_TIMING_TEXT_CANARY_031';
const NAME_CANARY = 'STUDIO_STAGE_TIMING_PERSONA_CANARY_031';

async function setup() {
  // Production default: the adaptive service is wired; timings are switched on.
  const h = makeStudio();
  const org = await seedOrg(h);
  const hired = await hire(h, org.alice, { name: NAME_CANARY });
  h.studio.deps.stageTimings = true;
  h.chatLLM.nextReply = `${TEXT_CANARY} reply`;
  return { h, org, ...hired, forbidden: [TEXT_CANARY, NAME_CANARY, hired.agent.id, String(ID.alice), `tg-${ID.alice}`] };
}
const stages = (events: Record<string, unknown>[]) => events.map((event) => event.stage);
const routes = (events: Record<string, unknown>[]) => [...new Set(events.map((event) => event.route))];

describe('Studio per-stage timings (production configuration)', () => {
  it('times a Telegram text turn without content; no extraction while adaptive memory is off', async () => {
    const { h, agent, forbidden } = await setup();
    const update: TelegramUpdate = { update_id: 930_001, message: { message_id: 930_001, date: 0, text: TEXT_CANARY,
      from: { id: ID.alice, is_bot: false, first_name: 'Alice' }, chat: { id: ID.alice, type: 'private' } } };
    await handleAgentUpdate(h.studio, agent.id, update);
    const events = expectContentFreeStageTimings(h.logger, forbidden);
    expect(routes(events)).toEqual(['private_text']);
    expect(stages(events)).toEqual(['ingress', 'boundary', 'retrieval', 'prompt', 'llm_done', 'send', 'total']);
  });

  it('times a Mini App call turn, including speech in and out', async () => {
    const { h, org, agent, forbidden } = await setup();
    h.openai.transcribe.mockResolvedValueOnce(TEXT_CANARY);
    expect((await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(8), 'audio/webm')).reply).toBe(`${TEXT_CANARY} reply`);
    const events = expectContentFreeStageTimings(h.logger, forbidden);
    expect(routes(events)).toEqual(['call_turn']);
    expect(stages(events)).toEqual(['ingress', 'stt', 'boundary', 'retrieval', 'prompt', 'llm_done', 'tts', 'total']);
  });

  it('times a streamed live-call turn, including time to first token, after the stream ends', async () => {
    const { h, agent, forbidden } = await setup();
    h.studio.deps.fastLLM = { complete: vi.fn(), stream: vi.fn(async function* () { yield `${TEXT_CANARY} part one, `; yield 'part two.'; }) };
    let text = '';
    for await (const part of await h.studio.liveTurn(agent.id, ID.alice, [{ role: 'user', content: TEXT_CANARY }])) {
      text += part;
      // Nothing is emitted while the reply is still streaming.
      expect(h.logger.info.mock.calls.filter(([event]) => (event as { reason?: string }).reason === 'timing')).toEqual([]);
    }
    expect(text).toBe(`${TEXT_CANARY} part one, part two.`);
    const events = expectContentFreeStageTimings(h.logger, forbidden);
    expect(routes(events)).toEqual(['live_call']);
    expect(stages(events)).toEqual(['ingress', 'boundary', 'retrieval', 'prompt', 'llm_ttft', 'llm_done', 'total']);
  });

  it('emits nothing with timings off (the default)', async () => {
    const { h, org, agent } = await setup();
    h.studio.deps.stageTimings = undefined;
    await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(8), 'audio/webm');
    expect(h.logger.info.mock.calls.filter(([event]) => (event as { reason?: string }).reason === 'timing')).toEqual([]);
  });
});
