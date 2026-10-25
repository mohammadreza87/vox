/**
 * Privacy red team, wave A on main, round 3: where S12 images meet main's lineage choices, main's guarded
 * transport principle (8a7dc55) and Circles notes, after fixer r2.
 *
 * Passing guards pin behaviour that holds on agent-intelligence-wave-a-main. The gaps found in this round
 * are pinned as it.fails: they pass while the gap exists and turn red when a fix lands (flip them to `it` then).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { IMAGE_WITHHELD_REPLY_TEXT, suppressImageMemory } from '../images';
import { readImageTriage } from '../images/questions';
import { systemText } from '../llm-content';
import type { LLMRequest } from '../llm';
import type { TelegramBotClient, TelegramMessage, TelegramUpdate } from '../telegram/client';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';
import { hire, ID, makeStudio, seedOrg } from '../../studio/__tests__/helpers';
import { handleAgentUpdate } from '../../studio/updates';
import { usableCopies } from '../../circles/notes';

const PLAN = 'PLANCANARY whiteboard: launch moves to May 3';
const DOC = 'Passport DOCCANARY-9921, born 1990-04-02';
const requestText = (r: Pick<LLMRequest, 'system' | 'messages'>) => `${systemText(r.system)}\n${r.messages.map((m) => m.content).join('\n')}`;

/** An extractor that, like a real one, can only propose what it was shown. */
class EchoingExtractor extends VisionFakeLLM {
  override async complete(request: LLMRequest): Promise<string> {
    if (systemText(request.system).startsWith('You extract long-term memories')) {
      this.nextExtraction = requestText(request).includes('PLANCANARY')
        ? { memories: [{ content: 'Reza said the launch moves to May 3 (PLANCANARY)', type: 'decision', kind: 'work', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
        : { memories: [] };
    }
    return super.complete(request);
  }
}

const WAVE_A_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES', 'STUDIO_VOICE_RECOGNITION', 'STUDIO_VOICE_SHADOW'];
beforeEach(() => { for (const flag of WAVE_A_FLAGS) vi.stubEnv(flag, ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function harness(image: ReturnType<typeof imageAnswers>) {
  const llm = new EchoingExtractor('claude-fable-5-1');
  const fast = new EchoingExtractor('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast, decider: scriptedDecider({ text: textAnswers({ effort: 'thoughtful', memorable: 0.9 }), image }), memories,
    offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs), deduper: new InMemoryUpdateDeduper(), voice: null,
    botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const setReply = (text: string) => { llm.nextReply = text; fast.nextReply = text; };
  const extractions = () => [...llm.extractionRequests, ...fast.extractionRequests];
  return { gateway, llm, fast, memories, ladder, setReply, extractions };
}

// Gap 1 (medium). The merge chose wave A's image triage reader (images/questions.ts), which treats an image task
// 'remember' as a request to keep the image from a choice confidence of 0.5 (IMAGE_TASK_MIN_CONFIDENCE). Main's
// dropped lineage read a 'remember' below IMAGE_REMEMBER_CONFIDENCE = 0.6 as 'unclear' (main's images/policy.ts and
// questions.ts at 7224f40), so the memory stayed suppressed. With STUDIO_IMAGES=1 an image the person never asked
// to keep ("what is this?") forms a memory of what it showed whenever the decider is only 0.5 to 0.6 sure the
// sender wanted it kept: a model output widens memory formation past the check main had. Same class as PR2-2
// (the people rule), which fixer r2 ported. Fixed in fixer r3: 'remember' below IMAGE_REMEMBER_CONFIDENCE (0.6)
// reads as 'unclear' (main's rule); the two pins are plain tests now.
describe('red team wave A on main r3: an uncertain image remember task forms a memory main would not', () => {
  it('readImageTriage: a remember task at confidence 0.55 reads as unclear (main: IMAGE_REMEMBER_CONFIDENCE 0.6)', () => {
    const triage = readImageTriage(imageAnswers({ kind: 'other', task: 'remember', taskConfidence: 0.55, people: 0.1, sensitive: 0.05 }));
    expect(triage?.task).toBe('unclear');
  });

  it('end to end: "what is this?" on a photo the decider is 0.55 sure is to be kept forms no memory of it', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness(imageAnswers({ kind: 'other', task: 'remember', taskConfidence: 0.55, people: 0.1, sensitive: 0.05 }));
    h.setReply(`The ${PLAN}.`);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what is this?'));
    expect(h.llm.replyRequests.length + h.fast.replyRequests.length).toBeGreaterThan(0);
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('PLANCANARY');
  });

  it('guard: the same photo with a confident remember task (0.9) is extracted (positive control)', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness(imageAnswers({ kind: 'other', task: 'remember', taskConfidence: 0.9, people: 0.1, sensitive: 0.05 }));
    h.setReply(`The ${PLAN}.`);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what is this?'));
    expect(h.extractions().length).toBeGreaterThan(0);
  });

  it('guard: below 0.5 the task is unclear and the turn is suppressed', () => {
    const triage = readImageTriage(imageAnswers({ kind: 'other', task: 'remember', taskConfidence: 0.45, people: 0.1, sensitive: 0.05 }));
    expect(triage?.task).toBe('unclear');
    expect(suppressImageMemory(triage, 'what is this?')).toBe(true);
  });
});

/** A Studio with one member agent (Cookie), a vision chat model, a scripted image decider and a photo ladder. */
async function studioHarness(image = imageAnswers({ task: 'explain' })) {
  const h = makeStudio();
  const org = await seedOrg(h);
  const hired = await hire(h, org.alice, { name: 'Cookie' });
  const vision = new VisionFakeLLM('claude-test');
  h.studio.deps.chatLLM = vision;
  const decideParts = vi.fn(async () => image);
  const decide = vi.fn(async () => textAnswers({ effort: 'thoughtful', memorable: 0.1 }));
  h.studio.deps.decider = { decide, decideParts } as unknown as NonNullable<typeof h.studio.deps.decider>;
  const ladder = photoLadder();
  const downloadImage = vi.fn(async (fileId: string) => ladder.files[fileId]?.slice() ?? new Uint8Array());
  Object.assign(hired.bot(), { downloadImage });
  let id = 993_000;
  const photo = (from: number, caption = 'what is this?'): TelegramUpdate => ({ update_id: ++id, message: { message_id: id, date: 0, caption, photo: ladder.sizes,
    from: { id: from, is_bot: false, first_name: 'Alice' }, chat: { id: from, type: 'private' } } });
  const dm = (from: number, text: string, extra: Partial<TelegramMessage> = {}): TelegramUpdate => ({ update_id: ++id, message: { message_id: id, date: 0, text,
    from: { id: from, is_bot: false, first_name: 'Alice' }, chat: { id: from, type: 'private' }, ...extra } });
  const send = (u: TelegramUpdate) => handleAgentUpdate(h.studio, hired.agent.id, u);
  /** single_party_image is eligible while `granted()` holds; every other capability is evaluated as before. */
  const grantImage = (granted: () => boolean, onCheck?: () => void) => {
    const adaptive = h.adaptive!;
    const original = adaptive.capabilityStatus.bind(adaptive);
    vi.spyOn(adaptive, 'capabilityStatus').mockImplementation((d, capability, now) => {
      if (capability !== 'single_party_image') return original(d, capability, now);
      const eligible = granted();
      onCheck?.();
      return eligible ? { eligible: true } : original(d, capability, now);
    });
  };
  const imageExported = () => vision.replyRequests.some((r) => r.messages.some((m) => m.images?.length));
  return { h, hired, vision, decide, decideParts, downloadImage, photo, dm, send, grantImage, imageExported };
}

// Gap 2 (medium). Fixer r2 (ed05751) makes a Telegram image need the person's single_party_image capability and
// re-checks it "before the reply export" (gateway: `replyImages = imageTurn && await this.imageCapable(...)`). That
// check runs before composeReply; the reply request's own transport authority (`authorize`: unchanged() and the
// caller's authorize; `authorizeNow`: exportAuthorizedNow) never re-reads the capability. composeReply then awaits
// history, retrieval, follow-up and relationship reads before the provider call, so a capability withdrawn in that
// window still exports the image bytes to the reply model. Triage gets the capability inside its guarded transport
// authority (8a7dc55's principle); the reply does not. Event order observed in this harness for one photo:
// capability > download > capability > decideParts > download (reply tier) > decide > capability > reply(image).
// Fix: when composeReply carries images, add imageCapable() to request.authorize and imageCapableNow() to
// request.authorizeNow (and drop the images, or fail closed, when it is denied at the transport).
describe('red team wave A on main r3: the reply export of a Telegram image is not fenced at the transport', () => {
  it('guard: a capability withdrawn during text triage (after image triage) keeps the image out of the reply', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const x = await studioHarness();
    let granted = true;
    x.grantImage(() => granted);
    const decide = x.decide.getMockImplementation()!;
    x.decide.mockImplementation(async (...args: Parameters<typeof decide>) => { granted = false; return decide(...args); });
    await x.send(x.photo(ID.alice));
    expect(x.decideParts).toHaveBeenCalledTimes(1);
    expect(x.imageExported()).toBe(false);
  });

  it.fails('a capability withdrawn right after the last check (while the reply is composed) never reaches the reply model', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const x = await studioHarness();
    let granted = true, checks = 0;
    // The third single_party_image check is the gateway's "before the reply export" one: it passes, and the
    // person withdraws the capability immediately afterwards, before composeReply reaches the provider.
    x.grantImage(() => granted, () => { if (++checks === 3) granted = false; });
    await x.send(x.photo(ID.alice));
    expect(checks).toBeGreaterThanOrEqual(3);
    expect(x.vision.replyRequests.length).toBeGreaterThan(0); // positive control: the text turn is still answered
    expect(x.imageExported()).toBe(false);
  });
});

// Gap 3 (medium). Circles notes (main) meet S12 (wave A): with STUDIO_CIRCLES=circles a member's "remember this"
// sent as a reply saves the replied-to message's text (circles/note-selector.ts parseRememberIntent: "a reply saves
// that message"), and StudioCircleNotes.intercept runs on the raw text before anything else, reading
// message.reply_to_message.text. When the replied-to message is the agent's own Telegram reply about an image, that
// text is image-derived: here a sensitive document (contains_sensitive_document 0.9) whose reply S12 delivers but
// never keeps (history holds IMAGE_WITHHELD_REPLY_TEXT, extraction is suppressed even on an explicit request). One
// reply plus one tap stores the document's text in the notes ledger, a durable store, and every later DM turn puts
// it into the reply model's context as "Your notes: ...". The same path stores a reply that described the people in
// a photo (the S12 people rule protects third parties whatever the requester asks). Nothing in the notes path knows
// a message was image-derived. Fix: refuse to save a replied-to message sent by this agent's own bot while
// STUDIO_IMAGES is on unless it matches a stored, unmarked assistant row (or record content-free marks for
// image-derived bot replies by Telegram message id and refuse those), and ask the person to type what to keep.
describe('red team wave A on main r3: a Circles note saves the agent\'s reply about a sensitive document image', () => {
  async function documentTurn() {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const x = await studioHarness(imageAnswers({ kind: 'document', task: 'extract_text', people: 0.02, sensitive: 0.9 }));
    x.grantImage(() => true);
    x.h.studio.deps.circles = () => 'circles';
    x.vision.nextReply = DOC;
    await x.send(x.photo(ID.alice, 'read this for me'));
    const bot = x.hired.bot();
    const sent = bot.sendMessage.mock.calls.find(([, text]) => typeof text === 'string' && text.includes('DOCCANARY'));
    return { ...x, bot, sent };
  }

  it('guard: S12 delivers the document reply but never keeps its text in history or memory', async () => {
    const x = await documentTurn();
    expect(x.sent).toBeDefined(); // the person received the read-out document text on Telegram
    const history = JSON.stringify(await x.h.memory.history.recent(x.hired.agent.id, `private-tg-${ID.alice}`, 20));
    expect(history).not.toContain('DOCCANARY');
    if (history !== '[]') expect(history).toContain(IMAGE_WITHHELD_REPLY_TEXT);
    expect(JSON.stringify(await x.h.memory.memories.listActive(x.hired.agent.id))).not.toContain('DOCCANARY');
  });

  it.fails('"remember this" as a reply to that bot message never stores the document text as a note or brings it back into a prompt', async () => {
    const x = await documentTurn();
    const botMessage: TelegramMessage = { message_id: 777_001, date: 0, text: x.sent![1] as string, chat: { id: ID.alice, type: 'private' },
      from: { id: x.hired.botId, is_bot: true, first_name: 'Cookie' } };
    x.bot.sendMessage.mockClear();
    await x.send(x.dm(ID.alice, 'remember this', { reply_to_message: botMessage }));
    const proposal = x.bot.sendMessage.mock.calls.find(([, , o]) =>
      ((o as { keyboard?: { inline_keyboard: Array<Array<{ callback_data?: string }>> } } | undefined)?.keyboard?.inline_keyboard ?? []).flat().some((b) => b.callback_data?.startsWith('cs:')));
    const data = proposal ? ((proposal[2] as { keyboard: { inline_keyboard: Array<Array<{ callback_data?: string }>> } }).keyboard.inline_keyboard.flat().find((b) => b.callback_data?.startsWith('cs:'))!.callback_data!) : undefined;
    if (data) await x.send({ update_id: 993_900, callback_query: { id: 'cb-r3', from: { id: ID.alice, is_bot: false, first_name: 'Alice' }, data,
      message: { message_id: 4242, date: 0, chat: { id: ID.alice, type: 'private' } } } });
    const notes = usableCopies(await x.h.studio.deps.notesLedger!.read(ID.alice), x.hired.agent.id, x.h.clock.now);
    x.vision.nextReply = 'Sure.';
    await x.send(x.dm(ID.alice, 'what do you know about me?'));
    const lastPrompt = JSON.stringify(x.vision.replyRequests.at(-1) ?? null);
    expect(JSON.stringify(notes)).not.toContain('DOCCANARY');
    expect(lastPrompt).not.toContain('DOCCANARY');
  });
});
