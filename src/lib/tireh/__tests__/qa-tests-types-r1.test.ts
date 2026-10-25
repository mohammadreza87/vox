/**
 * QA round 1 on main, lens tests-types: pins the half of 19f3b37 (S12) that no
 * other test isolates. extractMemories applies the image people rule while a
 * people-marked row is anywhere in the retained extraction window, not only
 * when the current turn carries the mark. In the other suites the current
 * turn's reply always inherits the mark (6c90443), so replacing
 * `[...currentTurn, ...retained].some(...)` with `currentTurn.some(...)` left
 * every test green. Here the reply context is served without marks, so the
 * current turn carries none and only the retained image row can carry the rule
 * into the next extraction.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { IMAGE_PEOPLE_RULE } from '../memory/extraction';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { systemText } from '../llm-content';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatMessage } from '../types';
import { privateText, TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';

/**
 * Serves the reply context (HISTORY_LIMIT reads) without image marks, so the composed
 * reply inherits nothing (as a reply written before 6c90443, or by an entry point that
 * does not inherit, would look). The extraction window (EXTRACTION_WINDOW = 6 reads)
 * still sees the stored image row with its mark.
 */
class UnmarkedReplyContextHistory extends InMemoryChatHistoryStore {
  override async recent(personaId: string, chatKey: string, limit: number): Promise<ChatMessage[]> {
    const rows = await super.recent(personaId, chatKey, limit);
    return limit > 6 ? rows.map(({ imageDerived: _dropped, ...rest }) => { void _dropped; return rest; }) : rows;
  }
}

function harness() {
  vi.stubEnv('STUDIO_IMAGES', '1');
  const llm = new VisionFakeLLM('claude-fable-5-1');
  const fast = new VisionFakeLLM('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const history = new UnmarkedReplyContextHistory(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast,
    decider: scriptedDecider({ text: textAnswers({ effort: 'thoughtful', memorable: 0.9 }), image: imageAnswers({ kind: 'photo_of_people', task: 'remember', people: 0.95, sensitive: 0 }) }),
    memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history, deduper: new InMemoryUpdateDeduper(), voice: null,
    botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const extractions = () => [...llm.extractionRequests, ...fast.extractionRequests];
  return { gateway, history, ladder, extractions };
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('QA tests-types r1: the people rule follows the retained window (19f3b37)', () => {
  it('a later text turn whose own rows are unmarked still extracts under the people rule while the image row is retained', async () => {
    const h = harness();
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this, team offsite'))).toBe('replied');
    expect(h.extractions()).toHaveLength(1);
    expect(systemText(h.extractions()[0].system)).toContain(IMAGE_PEOPLE_RULE);

    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'The offsite is on Friday'))).toBe('replied');
    const rows = [...h.history.chats.values()].flat();
    // The image turn's rows carry the mark; the text turn's rows carry none (its reply inherited nothing).
    expect(rows.map((m) => [m.role, m.imageDerived?.people ?? null])).toEqual([['user', true], ['assistant', true], ['user', null], ['assistant', null]]);
    expect(h.extractions()).toHaveLength(2);
    expect(systemText(h.extractions()[1].system)).toContain(IMAGE_PEOPLE_RULE);
  });

  it('positive control: with no image row in the window the rule is absent', async () => {
    const h = harness();
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'The offsite is on Friday'))).toBe('replied');
    expect(h.extractions()).toHaveLength(1);
    expect(systemText(h.extractions()[0].system)).not.toContain(IMAGE_PEOPLE_RULE);
  });
});
