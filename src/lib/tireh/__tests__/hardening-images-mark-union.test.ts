/**
 * F216: on an image turn, the assistant row's content-free mark is the union of the current image's verdict
 * and the mark inherited from image rows in the reply's context. It only fails closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';

beforeEach(() => { vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); });

function harness(verdicts: Array<ReturnType<typeof imageAnswers>>) {
  const epochs = new Map<string, number>();
  const history = new InMemoryChatHistoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  let turn = 0;
  const decider = scriptedDecider({ text: textAnswers(), image: async () => verdicts[Math.min(turn++, verdicts.length - 1)] });
  const gateway = new PersonaGateway({
    org: testOrg(), llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM('claude-haiku-5-5'), decider,
    memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history,
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const rows = () => [...history.chats.values()].flat();
  return { gateway, ladder, rows };
}

const PEOPLE = imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95, sensitive: 0.05 });
const RECEIPT = imageAnswers({ kind: 'receipt', task: 'remember', people: 0.05, sensitive: 0.05 });

describe('F216: image marks join the inherited mark', () => {
  it('turn 2 (a receipt to remember) after a people photo keeps people:true on its reply row', async () => {
    const h = harness([PEOPLE, RECEIPT]);
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'my friends at dinner'))).toBe('replied');
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this'))).toBe('replied');
    const rows = h.rows();
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    // Turn 1: the people photo is suppressed (no remember request) with the people rule on.
    expect(rows[0].imageDerived).toEqual({ suppressed: true, people: true });
    // Turn 2's own verdict: a receipt the person asked to keep.
    expect(rows[2].imageDerived).toEqual({ suppressed: false, people: false });
    // Its reply was composed with turn 1's rows in context: the union keeps both marks.
    expect(rows[3].imageDerived).toEqual({ suppressed: true, people: true });
  });

  it('positive control: a receipt to remember with no earlier image keeps its own verdict on the reply row', async () => {
    const h = harness([RECEIPT]);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this'));
    expect(h.rows().map((r) => r.imageDerived)).toEqual([{ suppressed: false, people: false }, { suppressed: false, people: false }]);
  });
});
