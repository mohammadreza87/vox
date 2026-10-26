/**
 * F246: image-v1 triage writes one content-free S09 decision-log row while TIREH_DECISION_LOG is on (read at
 * call time). The row holds catalogue names, values and probabilities only: never the caption, the image or a
 * person id. With the flag unset the gateway hands the image seam no sink, so no row is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDecisionLogSink, InMemoryDecisionLogStore, type NewDecisionLogRow } from '../decisions/log';
import { PersonaGateway } from '../gateway';
import { IMAGE_TRIAGE_QUESTIONS, IMAGE_TRIAGE_TIMEOUT_MS, ingestTelegramImage, type ImageIngestDeps } from '../images';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatContext } from '../types';
import { TG, testOrg } from './fixtures';
import { IMAGE_CANARIES, imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';

const IMAGE_NAMES = IMAGE_TRIAGE_QUESTIONS.map((q) => q.name);
const CAPTION = `what does this receipt say? ${IMAGE_CANARIES.caption}`;
const NOW = new Date('2026-10-19T10:00:00Z');

const WAVE_A_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES', 'STUDIO_VOICE_RECOGNITION', 'STUDIO_VOICE_SHADOW'];
beforeEach(() => { for (const flag of WAVE_A_FLAGS) vi.stubEnv(flag, ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function gatewayRun() {
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const decider = scriptedDecider({ text: textAnswers(), image: imageAnswers({ kind: 'receipt', task: 'extract_text', people: 0.05, sensitive: 0.2 }) });
  const store = new InMemoryDecisionLogStore();
  // The sink itself always records: only the gateway's flag read can keep the image row out.
  const sink = createDecisionLogSink(store, { enabled: () => true, now: () => NOW });
  const epochs = new Map<string, number>();
  const gateway = new PersonaGateway({
    org: testOrg(), llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM('claude-haiku-5-5'), decider, decisionLog: sink,
    memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs),
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => NOW,
  });
  const result = await gateway.handleUpdate('aria', privatePhoto(TG.reza, ladder.sizes, CAPTION));
  await sink.flush();
  const imageBase64 = Object.values(ladder.files).map((file) => Buffer.from(file).toString('base64'));
  return { result, rows: store.rows, decider, imageBase64 };
}

/** Every 16-character window of each image's base64: none may appear in a row. */
const base64Fragments = (encoded: string[]) => encoded.flatMap((b64) => Array.from({ length: Math.max(1, b64.length - 15) }, (_, i) => b64.slice(i, i + 16)));

describe('F246: image-v1 decision-log rows from the gateway', () => {
  it('writes exactly one image-v1 row, after the text-triage row, with no caption, image bytes or person id', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    vi.stubEnv('TIREH_DECISION_LOG', '1');
    const { result, rows, decider, imageBase64 } = await gatewayRun();
    expect(result).toBe('replied');
    expect(decider.decideParts).toHaveBeenCalledTimes(1);
    const image = rows.filter((r) => r.questionSetVersion === 'image-v1');
    expect(image).toHaveLength(1);
    expect(rows.map((r) => r.questionSetVersion)).toEqual(['v1', 'image-v1']);
    expect(image[0]).toMatchObject({
      names: IMAGE_NAMES, outcome: 'answered', routeTaken: 'untriaged', personaId: 'aria', chatKind: 'private', language: 'en',
      // Timed on the gateway's clock (fixed here), so paired runs log identical rows.
      elapsedMs: 0, at: NOW,
      answers: expect.arrayContaining([
        { name: 'image_kind', type: 'choice', choice: 'receipt', confidence: 0.9 },
        { name: 'contains_sensitive_document', type: 'predicate', probability: 0.2 },
      ]),
    });
    const json = JSON.stringify(rows);
    expect(json).not.toContain(IMAGE_CANARIES.caption);
    expect(json).not.toContain('receipt say');
    expect(json).not.toContain('reza');
    expect(json).not.toContain(String(TG.reza));
    for (const fragment of base64Fragments(imageBase64)) expect(json.includes(fragment), 'image bytes in a row').toBe(false);
  });

  it('writes no image-v1 row with TIREH_DECISION_LOG unset (the image is still triaged)', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const { rows, decider } = await gatewayRun();
    expect(decider.decideParts).toHaveBeenCalledTimes(1); // positive control: image triage ran
    expect(rows.filter((r) => r.questionSetVersion === 'image-v1')).toEqual([]);
  });

  it('writes no image-v1 row with STUDIO_IMAGES unset (no image path at all)', async () => {
    vi.stubEnv('TIREH_DECISION_LOG', '1');
    const { rows, decider } = await gatewayRun();
    expect(decider.decideParts).not.toHaveBeenCalled();
    expect(rows.filter((r) => r.questionSetVersion === 'image-v1')).toEqual([]);
  });
});

describe('F246: failed and timed-out image triage rows', () => {
  function ingest(image: () => Promise<Record<string, never>>) {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const ladder = photoLadder();
    const recorded: NewDecisionLogRow[] = [];
    const org = testOrg();
    const deps: ImageIngestDeps = {
      org, decider: scriptedDecider({ image }), llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM(),
      bot: imageBot(ladder.files) as unknown as TelegramBotClient, log: { warn: vi.fn() }, decisionLog: { record: (row) => { recorded.push(row); } },
    };
    const chat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
    const message = privatePhoto(TG.reza, ladder.sizes, CAPTION).message!;
    return { recorded, run: () => ingestTelegramImage(deps, org.getPersona('aria')!, chat, 'reza', message, CAPTION) };
  }

  it('a failed decider writes an unknown decider_error row with no answers', async () => {
    const h = ingest(async () => { throw new Error(`provider said ${IMAGE_CANARIES.caption}`); });
    expect((await h.run())?.triage).toBeNull();
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatchObject({ questionSetVersion: 'image-v1', names: IMAGE_NAMES, outcome: 'unknown', unknownReason: 'decider_error', answers: [], routeTaken: 'untriaged' });
    expect(JSON.stringify(h.recorded)).not.toContain(IMAGE_CANARIES.caption);
  });

  it('a timed-out decider writes an unknown timeout row', async () => {
    vi.useFakeTimers();
    const h = ingest(() => new Promise(() => undefined));
    const pending = h.run();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(IMAGE_TRIAGE_TIMEOUT_MS + 1);
    expect((await pending)?.triage).toBeNull();
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatchObject({ questionSetVersion: 'image-v1', outcome: 'unknown', unknownReason: 'timeout', answers: [] });
  });

  it('a sink that throws never affects the turn', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const ladder = photoLadder();
    const org = testOrg();
    const deps: ImageIngestDeps = {
      org, decider: scriptedDecider({ image: imageAnswers({ task: 'explain' }) }), llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM(),
      bot: imageBot(ladder.files) as unknown as TelegramBotClient, log: { warn: vi.fn() }, decisionLog: { record: () => { throw new Error('store down'); } },
    };
    const chat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
    const turn = await ingestTelegramImage(deps, org.getPersona('aria')!, chat, 'reza', privatePhoto(TG.reza, ladder.sizes, 'hi').message!, 'hi');
    expect(turn?.triage?.task).toBe('explain');
  });
});
