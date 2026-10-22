/**
 * Privacy red team, Wave A round 1: image-derived text after the image turn.
 *
 * S12 promises a sensitive document is never stored and people in a photo
 * never become identity or appearance memories. The retention verdict now
 * rides on the stored rows (ChatMessage.imageDerived), so it also governs
 * every later extraction over retained history, and the reply to a sensitive
 * document is kept in history only as a fixed placeholder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { IMAGE_WITHHELD_REPLY_TEXT } from '../images';
import { IMAGE_PEOPLE_RULE } from '../memory/extraction';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { systemText } from '../llm-content';
import type { LLMRequest } from '../llm';
import type { TelegramBotClient } from '../telegram/client';
import { privateText, TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';

const DOC = 'DOCCANARY-4111-1111-1111-1111';
const FACE = 'FACECANARY red jacket beard';

const requestText = (r: Pick<LLMRequest, 'system' | 'messages'>) => `${systemText(r.system)}\n${r.messages.map((m) => m.content).join('\n')}`;

/** An extractor that, like a real one, can only propose what it was shown. */
class EchoingExtractor extends VisionFakeLLM {
  override async complete(request: LLMRequest): Promise<string> {
    if (systemText(request.system).startsWith('You extract long-term memories')) {
      const shown = requestText(request);
      this.nextExtraction = shown.includes(DOC)
        ? { memories: [{ content: `Reza's card number is ${DOC}`, type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
        : shown.includes('FACECANARY')
          ? { memories: [{ content: 'Ali wears a FACECANARY red jacket and has a beard', type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
          : { memories: [] };
    }
    return super.complete(request);
  }
}

function harness(image: ReturnType<typeof imageAnswers>, flag = true) {
  // Pin the flag both ways so an exported STUDIO_IMAGES=1 (the flag matrix) cannot flip the flag-off case.
  vi.stubEnv('STUDIO_IMAGES', flag ? '1' : '');
  const llm = new EchoingExtractor('claude-fable-5-1');
  const fast = new EchoingExtractor('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast, decider: scriptedDecider({ text: textAnswers({ effort: 'thoughtful', memorable: 0.9 }), image }),
    memories, offers: new InMemoryShareOfferStore(), history, deduper: new InMemoryUpdateDeduper(), voice: null,
    botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const setReply = (text: string) => { llm.nextReply = text; fast.nextReply = text; };
  return { gateway, llm, fast, memories, history, ladder, setReply };
}

type H = ReturnType<typeof harness>;
const extractionText = (h: H) => [...h.llm.extractionRequests, ...h.fast.extractionRequests].map(requestText).join('\n');
const replyText = (h: H) => [...h.llm.replyRequests, ...h.fast.replyRequests].map(requestText).join('\n');
const stored = (h: H) => [...h.history.chats.values()].flat();

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('red team: image-derived text never outlives the image turn', () => {
  it('a sensitive document read out on the image turn never reaches history, extraction or memory on the next turn', async () => {
    const h = harness(imageAnswers({ kind: 'document', task: 'extract_text', sensitive: 0.95 }));
    h.setReply(`The card number reads ${DOC}.`);
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what is the number on this card?'))).toBe('replied');
    expect(h.llm.extractionCalls + h.fast.extractionCalls).toBe(0); // the image turn itself is suppressed

    // The reply was delivered, but history keeps only the fixed placeholder and the content-free verdict.
    const rows = stored(h);
    expect(JSON.stringify(rows)).not.toContain(DOC);
    expect(rows.map((m) => [m.role, m.imageDerived])).toEqual([['user', { suppressed: true, people: false }], ['assistant', { suppressed: true, people: false }]]);
    expect(rows[1].text).toBe(IMAGE_WITHHELD_REPLY_TEXT);

    h.setReply('You are welcome.');
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'thanks, that is my card'))).toBe('replied');

    expect(replyText(h)).not.toContain(DOC); // the next reply prompt never sees it
    expect(h.llm.extractionCalls + h.fast.extractionCalls).toBe(1);
    expect(extractionText(h)).not.toContain(DOC);
    expect(extractionText(h)).not.toContain('what is the number on this card?');
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain(DOC);
    expect(JSON.stringify(stored(h))).not.toContain(DOC);
  });

  it('a suppressed people photo described on the image turn stays out of the next extraction, echo included, which keeps the people rule', async () => {
    const h = harness(imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95 }));
    h.setReply(`Lovely photo, the man in the ${FACE} looks happy.`);
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'my brother Ali'))).toBe('replied');
    expect(stored(h).map((m) => m.imageDerived)).toEqual([{ suppressed: true, people: true }, { suppressed: true, people: true }]);

    // The next reply still echoes the description (it is in history). That echo inherits the
    // image turn's whole mark, so it stays out of extraction too; the people rule still applies.
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'yes he just got back from Tabriz'))).toBe('replied');
    const requests = [...h.llm.extractionRequests, ...h.fast.extractionRequests];
    expect(requests).toHaveLength(1);
    const text = requestText(requests[0]);
    expect(text).toContain('he just got back from Tabriz'); // positive control: the member's own words are extracted
    expect(text).not.toContain('my brother Ali');
    expect(text).not.toContain(FACE);
    expect(systemText(requests[0].system)).toContain(IMAGE_PEOPLE_RULE);
    expect(stored(h).map((m) => m.imageDerived)).toEqual([{ suppressed: true, people: true }, { suppressed: true, people: true }, undefined, { suppressed: true, people: true }]);
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('FACECANARY');
  });

  it('a text turn with no image row in its window carries no image marks and no people rule', async () => {
    const h = harness(imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95 }));
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'my flight to Berlin is on Friday'))).toBe('replied');
    expect(stored(h).every((m) => m.imageDerived === undefined)).toBe(true);
    expect(systemText([...h.llm.extractionRequests, ...h.fast.extractionRequests][0].system)).not.toContain(IMAGE_PEOPLE_RULE);
  });

  it('with STUDIO_IMAGES unset a photo turn stores no image marks and keeps the reply as before', async () => {
    const h = harness(imageAnswers({ kind: 'document', task: 'extract_text', sensitive: 0.95 }), false);
    h.setReply('Sure.');
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what is the number on this card?'));
    expect(stored(h).every((m) => m.imageDerived === undefined)).toBe(true);
    expect(stored(h).some((m) => m.text === IMAGE_WITHHELD_REPLY_TEXT)).toBe(false);
  });
});
