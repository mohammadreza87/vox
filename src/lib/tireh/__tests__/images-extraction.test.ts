import { describe, expect, it } from 'vitest';
import { buildExtractionPrompt, extractCandidates, IMAGE_PEOPLE_RULE } from '../memory/extraction';
import type { ChatContext, ChatMessage } from '../types';
import { FakeLLM, GAMEEND_CHAT, testOrg } from './fixtures';

const org = testOrg();
const persona = org.getPersona('aria')!;
const privateChat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
const groupChat: ChatContext = { kind: 'group', chatKey: 'group-gameend-team', group: org.getGroupByChatId(GAMEEND_CHAT)! };
const transcript: ChatMessage[] = [{ role: 'user', personId: 'reza', text: 'remember this', at: new Date('2026-10-19T10:00:00Z'), telegramMessageId: 7 }];

const candidates = [
  { content: 'Reza is wearing a red jacket in the photo', type: 'fact', kind: 'work', saidBy: 'reza' },
  { content: 'Reza and Milad are friends', type: 'relationship', kind: 'work', saidBy: 'reza' },
  { content: 'رضا در عکس لبخند می‌زند', type: 'fact', kind: 'work', saidBy: 'reza' },
  { content: "Reza's flight to Berlin is on Friday", type: 'event', kind: 'work', saidBy: 'reza' },
  { content: 'The GameEnd launch moved to November', type: 'decision', kind: 'work', saidBy: 'reza' },
];

describe('buildExtractionPrompt image options', () => {
  it.each([[privateChat], [groupChat]])('is byte-identical without the rule (%#)', (chat) => {
    const base = buildExtractionPrompt(org, persona, chat, 'reza', []);
    expect(buildExtractionPrompt(org, persona, chat, 'reza', [], undefined)).toBe(base);
    expect(buildExtractionPrompt(org, persona, chat, 'reza', [], {})).toBe(base);
    expect(buildExtractionPrompt(org, persona, chat, 'reza', [], { imagePeopleRule: false })).toBe(base);
  });

  it('adds the people rule exactly once', () => {
    const prompt = buildExtractionPrompt(org, persona, privateChat, 'reza', [], { imagePeopleRule: true });
    expect(prompt.split(IMAGE_PEOPLE_RULE)).toHaveLength(2);
    expect(prompt.startsWith('You extract long-term memories')).toBe(true);
    expect(prompt.replace(`\n${IMAGE_PEOPLE_RULE}`, '')).toBe(buildExtractionPrompt(org, persona, privateChat, 'reza'));
  });
});

describe('extractCandidates image people filter', () => {
  it('drops relationship and description candidates under the rule', async () => {
    const llm = new FakeLLM();
    llm.nextExtraction = { memories: candidates };
    const kept = await extractCandidates(llm, org, persona, privateChat, 'reza', transcript, [], { imagePeopleRule: true });
    expect(kept.map((c) => c.content)).toEqual(["Reza's flight to Berlin is on Friday", 'The GameEnd launch moved to November']);
    expect(llm.extractionRequests[0].system).toContain(IMAGE_PEOPLE_RULE);
  });

  it('returns every parsed candidate without the rule', async () => {
    const llm = new FakeLLM();
    llm.nextExtraction = { memories: candidates };
    const kept = await extractCandidates(llm, org, persona, privateChat, 'reza', transcript, []);
    expect(kept.map((c) => c.content)).toEqual(candidates.map((c) => c.content));
    expect(llm.extractionRequests[0].system).not.toContain(IMAGE_PEOPLE_RULE);
  });
});
