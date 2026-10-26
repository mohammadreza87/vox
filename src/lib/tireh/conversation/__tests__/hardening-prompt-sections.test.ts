/**
 * H7 hardening of the S03 prompt builders (QA F088, F126, F139).
 *
 * buildSystemPrompt (legacy, flags unset) and buildPromptLayout
 * (TIREH_CACHED_PROMPT=1) render every section through one set of pure
 * renderers, so a wording or privacy fix reaches both. These tests pin that
 * each renderer's output appears verbatim in both builders, and that memory
 * clipping in the cached layout never splits a grapheme cluster while leaving
 * every memory of at most MAX_PROMPT_MEMORY_CHARS code points untouched.
 */
import { describe, expect, it } from 'vitest';
import { OrgDirectory } from '../../org/directory';
import type { ChatContext, MemoryRecord, Persona } from '../../types';
import { memory, testOrg, testOrgConfig } from '../../__tests__/fixtures';
import {
  buildPromptLayout, buildSystemPrompt, capabilitiesSection, clipMemory, conflictsSection, contextMemoriesFor, conversationSection,
  conversationView, guestSection, liveInfoSection, MAX_PROMPT_MEMORY_CHARS, memorySection, organizationSection, personalConversationSection,
  relationsSection, replyFormatLine, voiceSection, type PromptInput,
} from '../prompt';

const NOW = new Date('2026-10-19T10:00:00Z');
const org = testOrg();
const guestOrg = () => {
  const config = testOrgConfig();
  config.people.push({ id: 'visitor', name: 'Visitor', role: 'Guest', telegramUserId: 9_999, companyIds: [], projectIds: [], guest: true });
  return new OrgDirectory(config);
};
const persona: Persona = { ...org.getPersona('aria')!, webSearch: true, strangerPolicy: 'Keep it short.' };

const records: MemoryRecord[] = [
  memory({ id: 'p', content: 'PRIVATE_CANARY Reza prefers short standups', scope: { kind: 'private', personId: 'reza' } }),
  memory({ id: 'c1', content: 'GameEnd launch is Feb 20', topic: 'launch', scope: { kind: 'project', projectId: 'gameend' }, source: { personId: 'parastoo', chatKind: 'private', at: new Date('2026-10-12T09:00:00Z') } }),
  memory({ id: 'c2', content: 'GameEnd launch is March 5', topic: 'launch', scope: { kind: 'project', projectId: 'gameend' } }),
  memory({ id: 'g1', content: 'Tutorial goes to 3 steps', topic: 'tutorial', scope: { kind: 'group', groupId: 'gameend-team' }, source: { personId: 'milad', chatKind: 'group', groupId: 'gameend-team', at: new Date('2026-10-11T09:00:00Z') } }),
  memory({ id: 'g2', content: 'Tutorial goes to 5 steps', topic: 'tutorial', scope: { kind: 'group', groupId: 'gameend-team' }, source: { personId: 'outsider', chatKind: 'group', groupId: 'gameend-team', at: new Date('2026-10-12T09:00:00Z') } }),
];

interface Case { name: string; input: PromptInput }
const cases: Case[] = [
  { name: 'private', input: { org, persona, chat: { kind: 'private', chatKey: 'private-reza', personId: 'reza' }, speakerId: 'reza', memories: records, now: NOW, canSpeak: true, replyFormat: 'voice', canFollowUp: true } },
  { name: 'group', input: { org, persona, chat: { kind: 'group', chatKey: 'group-gameend-team', group: org.getGroup('gameend-team')! }, speakerId: 'milad', memories: records, now: NOW, canSpeak: true, replyFormat: 'text' } },
  { name: 'guest', input: (() => {
    const o = guestOrg();
    return { org: o, persona, chat: { kind: 'private', chatKey: 'private-visitor', personId: 'visitor' } as ChatContext, speakerId: 'visitor', memories: records, now: NOW, replyFormat: 'text' as const };
  })() },
];

/** Every section the two builders share for one Work input, in the legacy order. */
function sharedSections({ org: o, persona: p, chat, speakerId, memories, canSpeak = false, replyFormat, canFollowUp = false, followUpChannel = 'chat' }: PromptInput): string[] {
  const view = conversationView(o, chat, speakerId);
  const context = contextMemoriesFor(o, chat, memories);
  const out: string[] = [];
  if (view.guestsPresent) out.push(guestSection(p, o.organizationName));
  else if (chat.kind === 'private') {
    const relations = relationsSection(o, speakerId);
    if (relations) out.push(relations);
    out.push(organizationSection(o, p));
  }
  if (p.webSearch) out.push(liveInfoSection(view.guestsPresent, o.organizationName));
  if (canSpeak) out.push(voiceSection());
  out.push(capabilitiesSection(p, canFollowUp, followUpChannel));
  const format = replyFormatLine(canSpeak, replyFormat);
  if (format) out.push(format);
  out.push(memorySection(o, chat, context));
  const conflicts = conflictsSection(o, chat, context);
  if (conflicts) out.push(conflicts);
  return out;
}

const layoutText = (input: PromptInput) => {
  const layout = buildPromptLayout(input);
  return { system: layout.system.map((block) => block.text).join('\n\n'), turn: layout.turn, layout };
};

describe('shared section renderers (F088, F126)', () => {
  it.each(cases)('renders each shared section verbatim in both builders for a $name chat', ({ input }) => {
    const legacy = buildSystemPrompt(input);
    const { system, turn } = layoutText(input);
    const both = `${system}\n\n${turn}`;
    const sections = sharedSections(input);
    expect(sections.length).toBeGreaterThanOrEqual(5);
    for (const section of sections) {
      expect(legacy).toContain(section);
      expect(both).toContain(section);
    }
    // The conversation section: the legacy prompt names the latest speaker in it, the layout moves that line to the per-turn block.
    const view = conversationView(input.org, input.chat, input.speakerId);
    expect(legacy).toContain(conversationSection(input.chat, input.speakerId, view, input.org, true, input.persona));
    expect(system).toContain(conversationSection(input.chat, input.speakerId, view, input.org, false, input.persona));
  });

  it('puts the cacheable sections in the system blocks and the volatile ones in the per-turn block', () => {
    const input = cases[0].input;
    const { system, turn, layout } = layoutText(input);
    const view = conversationView(input.org, input.chat, input.speakerId);
    for (const section of [relationsSection(org, 'reza')!, liveInfoSection(false, 'HOOR'), voiceSection(), capabilitiesSection(persona, true, 'chat')]) {
      expect(system).toContain(section);
      expect(turn).not.toContain(section);
    }
    // Block B is exactly the legacy organization section.
    expect(layout.system[1].text).toBe(organizationSection(org, persona));
    const context = contextMemoriesFor(org, input.chat, records);
    for (const section of [replyFormatLine(true, 'voice')!, memorySection(org, input.chat, context, true), conflictsSection(org, input.chat, context)!]) {
      expect(turn).toContain(section);
      expect(system).not.toContain(section);
    }
    expect(view.guestsPresent).toBe(false);
  });

  it('keeps the privacy-bearing rules in one place: guests, group-only memories and the source-name redaction', () => {
    const guest = cases[2].input;
    expect(conversationView(guest.org, guest.chat, guest.speakerId).guestsPresent).toBe(true);
    for (const text of [buildSystemPrompt(guest), layoutText(guest).system]) {
      expect(text).toContain(guestSection(persona, 'HOOR'));
      expect(text).not.toContain('## Organization');
      expect(text).not.toContain('## How people relate');
    }

    const group = cases[1].input;
    const context = contextMemoriesFor(org, group.chat, records);
    expect(context.map((m) => m.id)).toEqual(['g1', 'g2']);
    const groupMemories = memorySection(org, group.chat, context);
    expect(groupMemories).toContain('(a group participant, in ');
    expect(groupMemories).not.toContain('PRIVATE_CANARY');
    expect(conflictsSection(org, group.chat, context)).toContain('(a group participant, ');
    for (const text of [buildSystemPrompt(group), layoutText(group).turn]) {
      expect(text).toContain(groupMemories);
      expect(text).not.toContain('PRIVATE_CANARY');
      expect(text).not.toContain('outsider');
    }
  });

  it('renders the Personal conversation section in both builders and nothing from Work', () => {
    const input: PromptInput = { ...cases[0].input, space: 'personal' };
    const section = personalConversationSection(true);
    expect(buildSystemPrompt(input)).toContain(section);
    expect(layoutText(input).system).toContain(section);
    for (const text of [buildSystemPrompt(input), JSON.stringify(buildPromptLayout(input))]) {
      expect(text).not.toContain('PRIVATE_CANARY');
      expect(text).not.toContain('## Organization');
    }
  });
});

describe('clipMemory (F139)', () => {
  // The test runtime (Node) has Intl.Segmenter; the project's TypeScript lib (ES2017) does not declare it.
  type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
  const segmenter = new (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: 'grapheme' }) => Segmenter }).Segmenter('fa', { granularity: 'grapheme' });
  const graphemes = (text: string) => [...segmenter.segment(text)].map((s) => s.segment);
  const codePoints = (text: string) => Array.from(text).length;
  const own = (content: string) => memory({ id: 'm', content, scope: { kind: 'private', personId: 'reza' }, source: { personId: 'reza', chatKind: 'private', at: NOW } });
  const rezaInput = (content: string): PromptInput => ({ org, persona, chat: { kind: 'private', chatKey: 'private-reza', personId: 'reza' }, speakerId: 'reza', memories: [own(content)], now: NOW });

  it('clips a 300-grapheme Persian memory with ZWNJ and a combining mark without splitting a grapheme cluster', () => {
    // 208 single-point letters, then clusters of two code points: a base with a combining fatha
    // (U+064E) and a yeh followed by ZWNJ (U+200C). A cut at 209 code points falls inside the first one.
    const units = ['بَ', 'ی‌', 'هٔ'];
    const text = 'ب'.repeat(208) + Array.from({ length: 92 }, (_, i) => units[i % units.length]).join('');
    expect(graphemes(text)).toHaveLength(300);
    expect(Array.from(text)[208]).toBe('ب');
    expect(Array.from(text)[209]).toBe('َ');

    const clipped = clipMemory(text);
    expect(clipped.endsWith('…')).toBe(true);
    const kept = clipped.slice(0, -1);
    // Whole clusters only: the kept text is a prefix of the original, segment for segment.
    expect(graphemes(kept)).toEqual(graphemes(text).slice(0, graphemes(kept).length));
    expect(codePoints(kept)).toBeLessThanOrEqual(MAX_PROMPT_MEMORY_CHARS - 1);
    expect(kept).toBe('ب'.repeat(208));
    // The code-point cut would have left the base letter without its mark.
    expect(Array.from(text).slice(0, 209).join('')).not.toBe(kept);

    // The same text further along: a ZWNJ cluster across the boundary stays whole.
    const zwnj = 'م'.repeat(208) + 'ی‌' + 'ن'.repeat(100);
    expect(clipMemory(zwnj)).toBe(`${'م'.repeat(208)}…`);

    // In the layout the line keeps its provenance and the legacy prompt keeps the whole memory.
    const { turn } = buildPromptLayout(rezaInput(text));
    expect(turn).toContain(`- ${'ب'.repeat(208)}… (Reza, privately, 2026-10-19; shared with: `);
    expect(buildSystemPrompt(rezaInput(text))).toContain(`- ${text} (Reza, privately,`);
  });

  it('never splits a ZWJ emoji sequence', () => {
    const family = '👩‍👩‍👧';
    const text = 'a'.repeat(207) + family + 'b'.repeat(50);
    expect(clipMemory(text)).toBe(`${'a'.repeat(207)}…`);
  });

  it('leaves any memory of at most 210 code points byte-identical to before', () => {
    // A deterministic spread of lengths and scripts, including marks, ZWNJ, ZWJ and astral characters.
    const alphabet = ['a', 'ب', 'ی', '‌', 'َ', 'ـ', '😀', '👩', '‍', '\n', '"', '<', 'ۀ'];
    let seed = 7;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed; };
    const samples: string[] = ['', 'x', 'b'.repeat(MAX_PROMPT_MEMORY_CHARS), '😀'.repeat(MAX_PROMPT_MEMORY_CHARS), 'بَ'.repeat(MAX_PROMPT_MEMORY_CHARS / 2)];
    for (let i = 0; i < 200; i++) {
      const length = next() % (MAX_PROMPT_MEMORY_CHARS + 1);
      samples.push(Array.from({ length }, () => alphabet[next() % alphabet.length]).join(''));
    }
    for (const content of samples) {
      expect(codePoints(content)).toBeLessThanOrEqual(MAX_PROMPT_MEMORY_CHARS);
      expect(clipMemory(content)).toBe(content);
      // The layout's memory section is then exactly the legacy one.
      const input = rezaInput(content);
      const context = contextMemoriesFor(org, input.chat, input.memories);
      expect(memorySection(org, input.chat, context, true)).toBe(memorySection(org, input.chat, context));
      expect(buildPromptLayout(input).turn).toContain(memorySection(org, input.chat, context));
    }
  });

  it('cuts where the code-point rule cut when the boundary falls between clusters', () => {
    const text = 'a'.repeat(500);
    expect(clipMemory(text)).toBe(`${'a'.repeat(MAX_PROMPT_MEMORY_CHARS - 1)}…`);
    const mixed = 'م'.repeat(150) + '😀'.repeat(150);
    expect(clipMemory(mixed)).toBe(`${'م'.repeat(150)}${'😀'.repeat(59)}…`);
    expect(clipMemory('c'.repeat(MAX_PROMPT_MEMORY_CHARS + 1))).toBe(`${'c'.repeat(MAX_PROMPT_MEMORY_CHARS - 1)}…`);
  });
});
