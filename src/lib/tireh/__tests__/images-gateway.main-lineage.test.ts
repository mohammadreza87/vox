// Main's earlier S12 lineage (d99e3a5) cases that pass against the chosen wave A image module; the rest are recorded in WAVE_A_MAIN_INTEGRATION.md (S12).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMRequest } from '../llm';
import { systemText } from '../llm-content';
import { buildExtractionPrompt, IMAGE_PEOPLE_RULE } from '../memory/extraction';
import { IMAGE_PLACEHOLDER_TEXT } from '../images';
import type { TelegramUpdate } from '../telegram/client';
import type { ChatContext, ChatMessage } from '../types';
import { GAMEEND_CHAT, privateText, TG } from './fixtures';
import {
  base64Of,
  defaultImageFiles,
  GeminiFakeLLM,
  historyRows,
  imageAnswers,
  jpegBytes,
  makeImageGateway,
  privateImageDocument,
  privatePhoto,
  scriptedImageDecider,
  textAnswers,
  VisionFakeLLM,
} from './images-main-lineage-fixtures';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const lastUser = (request: LLMRequest) => [...request.messages].reverse().find((m) => m.role === 'user')!;
const rowView = (rows: ChatMessage[]) => rows.map(({ role, personId, text, telegramMessageId }) => ({ role, personId, text, telegramMessageId }));
const TRIAGE_LABELS = ['image_kind', 'image_task', 'contains_people', 'contains_sensitive_document', 'photo_of_people'];

/** The same message as plain text: same ids, same words, no photo. */
function textTwin(update: TelegramUpdate): TelegramUpdate {
  const message = { ...update.message!, text: update.message!.caption ?? '' };
  delete message.photo;
  delete message.document;
  delete message.caption;
  return { update_id: update.update_id, message };
}

describe.each([undefined, '0'])('STUDIO_IMAGES=%s leaves behaviour exactly as the base', (flag) => {
  it('ignores a captionless photo with no download, provider or history', async () => {
    vi.stubEnv('STUDIO_IMAGES', flag);
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }), textAnswers());
    const ctx = makeImageGateway({ fastLlm: new VisionFakeLLM(), decider });
    expect(await ctx.gateway.handleUpdate('aria', privatePhoto(TG.reza))).toBe('ignored');
    expect(ctx.bot.downloadImage).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).not.toHaveBeenCalled();
    expect(ctx.bot.sendChatAction).not.toHaveBeenCalled();
    expect(decider.decide).not.toHaveBeenCalled();
    expect(decider.decideParts).not.toHaveBeenCalled();
    expect(ctx.llm.replyRequests).toHaveLength(0);
    expect(ctx.llm.extractionCalls).toBe(0);
    expect(historyRows(ctx.history)).toHaveLength(0);
  });

  it('treats a captioned photo exactly like the same text message', async () => {
    vi.stubEnv('STUDIO_IMAGES', flag);
    const photo = privatePhoto(TG.reza, { caption: 'what time is the launch?' });
    const withPhoto = makeImageGateway();
    const withText = makeImageGateway();
    withPhoto.llm.nextExtraction = withText.llm.nextExtraction = { memories: [{ content: 'Reza asked about the launch time', type: 'event', kind: 'work', saidBy: 'reza' }] };
    expect(await withPhoto.gateway.handleUpdate('aria', photo)).toBe('replied');
    expect(await withText.gateway.handleUpdate('aria', textTwin(photo))).toBe('replied');
    expect(withPhoto.llm.replyRequests).toEqual(withText.llm.replyRequests);
    expect(withPhoto.llm.replyPrompts).toEqual(withText.llm.replyPrompts);
    expect(withPhoto.llm.extractionRequests).toEqual(withText.llm.extractionRequests);
    expect(withPhoto.llm.extractionRequests).toHaveLength(1);
    expect(rowView(historyRows(withPhoto.history))).toEqual(rowView(historyRows(withText.history)));
    expect(withPhoto.bot.sent).toEqual(withText.bot.sent);
    expect(withPhoto.bot.downloadImage).not.toHaveBeenCalled();
    expect(withPhoto.llm.replyRequests.some((r) => r.messages.some((m) => m.images))).toBe(false);
  });
});

describe('STUDIO_IMAGES=1 in groups', () => {
  it('handles a group photo exactly as with the flag off, with no download', async () => {
    const run = async (flag: string | undefined) => {
      vi.stubEnv('STUDIO_IMAGES', flag);
      const ctx = makeImageGateway();
      const update = privatePhoto(TG.reza, { chatId: GAMEEND_CHAT, chatType: 'supergroup', caption: '@hoor_aria_bot what is this?' });
      update.update_id = 1; update.message!.message_id = 1;
      const result = await ctx.gateway.handleUpdate('aria', update);
      return { result, ctx };
    };
    const on = await run('1');
    const off = await run(undefined);
    expect(on.result).toBe(off.result);
    expect(on.result).toBe('replied');
    expect(on.ctx.llm.replyRequests).toEqual(off.ctx.llm.replyRequests);
    expect(on.ctx.bot.sent).toEqual(off.ctx.bot.sent);
    expect(rowView(historyRows(on.ctx.history))).toEqual(rowView(historyRows(off.ctx.history)));
    expect(on.ctx.bot.downloadImage).not.toHaveBeenCalled();
  });
});

describe('STUDIO_IMAGES=1 in a private chat', () => {

  it('routes an explain image to the fast vision model without web search', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }), textAnswers({ effort: 'thoughtful', live: 1 }));
    const llm = Object.assign(new VisionFakeLLM(), { completeWithWeb: vi.fn(async () => ({ text: 'web', sources: [] })) });
    const fastLlm = Object.assign(new VisionFakeLLM(), { completeWithWeb: vi.fn(async () => ({ text: 'web', sources: [] })) });
    const ctx = makeImageGateway({ llm, fastLlm, decider });
    ctx.org.getPersona('aria')!.webSearch = true;
    expect(await ctx.gateway.handleUpdate('aria', privatePhoto(TG.reza, { caption: 'what is this?' }))).toBe('replied');
    expect(fastLlm.replyRequests).toHaveLength(1);
    expect(fastLlm.replyRequests[0].maxTokens).toBe(1200);
    expect(lastUser(fastLlm.replyRequests[0]).images).toHaveLength(1);
    expect(llm.replyRequests).toHaveLength(0);
    expect(llm.completeWithWeb).not.toHaveBeenCalled();
    expect(fastLlm.completeWithWeb).not.toHaveBeenCalled();
  });

  it('routes a remember image to the main model', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'remember', people: 0, sensitive: 0 }), textAnswers({ effort: 'thoughtful' }));
    const fastLlm = new VisionFakeLLM();
    const ctx = makeImageGateway({ fastLlm, decider });
    expect(await ctx.gateway.handleUpdate('aria', privatePhoto(TG.reza, { caption: 'keep this for later' }))).toBe('replied');
    expect(ctx.llm.replyRequests).toHaveLength(1);
    expect(lastUser(ctx.llm.replyRequests[0]).images).toHaveLength(1);
    expect(fastLlm.replyRequests).toHaveLength(0);
  });

});

describe('a sensitive document is never stored', () => {
  const sensitiveAnswers = (sensitive: number) => imageAnswers({ kind: 'document', task: 'remember', taskConfidence: 0.9, people: 0, sensitive });
  const candidate = { memories: [{ content: 'Reza passport number is X123', type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'] }] };

  it.each([
    ['photo', () => privatePhoto(TG.reza, { caption: 'remember this' })],
    ['image document', () => privateImageDocument(TG.reza, { mime: 'image/jpeg', caption: 'remember this' })],
  ])('replies to a sensitive %s but extracts nothing', async (_label, update) => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const files = defaultImageFiles();
    files.set('doc-1', jpegBytes());
    const sensitive = makeImageGateway({ decider: scriptedImageDecider(sensitiveAnswers(0.9)), files });
    sensitive.llm.nextExtraction = candidate;
    expect(await sensitive.gateway.handleUpdate('aria', update())).toBe('replied');
    expect(sensitive.bot.sent.some((s) => s.method === 'sendMessage' && s.text === 'Sure.')).toBe(true);
    expect(sensitive.llm.extractionCalls).toBe(0);
    expect(await sensitive.memories.listActive('aria')).toEqual([]);

    const control = makeImageGateway({ decider: scriptedImageDecider(sensitiveAnswers(0.1)), files });
    control.llm.nextExtraction = candidate;
    expect(await control.gateway.handleUpdate('aria', update())).toBe('replied');
    expect(control.llm.extractionCalls).toBe(1);
  });
});

/** Models a compliant extractor: with the people rule it returns nothing about the photo. */
class PromptAwareFakeLLM extends VisionFakeLLM {
  async complete(request: LLMRequest): Promise<string> {
    if (systemText(request.system).startsWith('You extract long-term memories')) {
      this.nextExtraction = systemText(request.system).includes(IMAGE_PEOPLE_RULE)
        ? { memories: [] }
        : { memories: [{ content: 'Parastoo has a red beard', type: 'fact', kind: 'work', saidBy: 'reza', about: ['parastoo'], confidence: 0.9 }] };
    }
    return super.complete(request);
  }
}

describe('a people image yields no identity text', () => {
  it('adds the people rule to extraction and keeps triage and bytes out of every prompt', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const llm = new PromptAwareFakeLLM();
    const decider = scriptedImageDecider(imageAnswers({ kind: 'photo_of_people', task: 'remember', taskConfidence: 0.9, people: 0.95, sensitive: 0 }));
    const ctx = makeImageGateway({ llm, decider });
    llm.nextReply = 'A person with a red beard is smiling';
    expect(await ctx.gateway.handleUpdate('aria', privatePhoto(TG.reza, { caption: 'remember this, team offsite' }))).toBe('replied');

    expect(llm.extractionRequests).toHaveLength(1);
    const extraction = llm.extractionRequests[0];
    expect(extraction.system).toContain(IMAGE_PEOPLE_RULE);
    const extractionMessages = JSON.stringify(extraction.messages);
    const imageData = lastUser(llm.replyRequests[0]).images![0].data;
    expect(extractionMessages).not.toContain(imageData);
    for (const label of TRIAGE_LABELS) expect(extractionMessages).not.toContain(label);
    expect(extractionMessages).not.toContain('0.95');
    const newLines = extraction.messages[0].content.split('\n').filter((line) => line.startsWith('[new]'));
    expect(newLines).toHaveLength(1);
    expect(newLines[0]).toContain('remember this, team offsite');
    for (const label of TRIAGE_LABELS) expect(llm.lastPrompt).not.toContain(label);
    expect(llm.lastPrompt).not.toContain(imageData);
    expect(await ctx.memories.listActive('aria')).toEqual([]);

    expect(await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'The offsite is on Friday'))).toBe('replied');
    expect(llm.extractionRequests).toHaveLength(2);
    const followUp = llm.extractionRequests[1].system;
    expect(followUp).not.toContain(IMAGE_PEOPLE_RULE);
    const chat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
    expect(followUp).toBe(buildExtractionPrompt(ctx.org, ctx.org.getPersona('aria')!, chat, 'reza'));
  });
});

const SCAN_CANARY = 'S12_SCAN_ASCII_CANARY';
const TOKEN_CANARY = '123456:S12_FAKE_BOT_TOKEN_IN_ERROR';

function slices(b64: string): string[] {
  const mid = Math.floor(b64.length / 2);
  return [b64, b64.slice(0, 24), b64.slice(mid, mid + 24), b64.slice(-24)];
}
