/**
 * QA hardening r1 (tests-types): c86bb6a names the speaker as DeciderAuthority.subject for image triage too
 * (STUDIO_IMAGES=1). hardening-gateway-decider-wiring.test.ts pins the text-triage subject only; this pins the
 * image arm, so dropping `subject: speaker.id` from the image authority fails here. The subject is the org person
 * id, never the Telegram id or caption text; only a ServiceDecider with DECISIONS_SAFETY_ID_SALT reads it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';

const WAVE_A_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES', 'STUDIO_VOICE_RECOGNITION', 'STUDIO_VOICE_SHADOW'];
beforeEach(() => { for (const flag of WAVE_A_FLAGS) vi.stubEnv(flag, ''); });
afterEach(() => { vi.unstubAllEnvs(); });

function harness() {
  const org = testOrg();
  const epochs = new Map<string, number>();
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const decider = scriptedDecider({ text: textAnswers(), image: imageAnswers({ kind: 'receipt', task: 'explain', people: 0.05, sensitive: 0.05 }) });
  const gateway = new PersonaGateway({
    org, llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM('claude-haiku-5-5'), decider,
    memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs),
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  return { org, gateway, ladder, decider };
}

describe('image triage names the speaker as the decider subject (c86bb6a)', () => {
  it('passes the sender person id to decideParts, never the Telegram id or the caption', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness();
    const caption = 'what does this receipt say?';
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, caption))).toBe('replied');
    expect(h.decider.decideParts).toHaveBeenCalledTimes(1);
    const authority = h.decider.decideParts!.mock.calls[0][3];
    const person = h.org.getPersonByTelegramId(TG.reza)!;
    expect(authority?.subject).toBe(person.id);
    expect(authority?.subject).not.toBe(String(TG.reza));
    expect(authority?.subject).not.toContain(caption);
    // The text triage of the same turn names the same person.
    expect(h.decider.decide.mock.calls[0][3]?.subject).toBe(person.id);
  });

  it('with STUDIO_IMAGES unset no image triage runs, so no image subject is sent', async () => {
    const h = harness();
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what does this receipt say?'));
    expect(h.decider.decideParts).not.toHaveBeenCalled();
  });
});
