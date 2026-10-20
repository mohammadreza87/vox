import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../conversation/prompt';
import { PersonaGateway } from '../gateway';
import { buildExtractionPrompt, decideScope, type MemoryCandidate } from '../memory/extraction';
import { selectMemories } from '../memory/retrieval';
import {
  InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper,
} from '../memory/store';
import { hasRestrictedAudience, isVisibleInChat } from '../memory/visibility';
import { OrgDirectory } from '../org/directory';
import type { ChatContext, MemoryRecord } from '../types';
import type { TelegramBotClient } from '../telegram/client';
import { FakeLLM, fakeBot, GAMEEND_CHAT, groupText, memory, privateText, testOrgConfig, TG } from './fixtures';

const SECRET_PERSON = 'NON_AUDIENCE_PERSON_CANARY';
const SECRET_ROLE = 'INTERNAL_ROLE_CANARY';
const SECRET_PROJECT = 'INTERNAL_PROJECT_CANARY';
const SECRET_NOTE = 'DIRECTORY_NOTE_CANARY';
const PRIVATE = 'PRIVATE_MEMORY_CANARY';
const ORGANIZATION = 'ORGANIZATION_MEMORY_CANARY';
const GROUP = 'CURRENT_GROUP_MEMORY_CANARY';
const SUBSET = 'SUBSET_DECISION_CANARY';

type AudienceCase = 'silent guest' | 'named guest' | 'unknown person' | 'empty';

function harness(mode?: AudienceCase) {
  const config = testOrgConfig();
  config.people.find((p) => p.id === 'milad')!.name = SECRET_PERSON;
  config.people.find((p) => p.id === 'reza')!.role = SECRET_ROLE;
  config.people.find((p) => p.id === 'reza')!.notes = SECRET_NOTE;
  config.projects[0].name = SECRET_PROJECT;
  const group = config.groups[0];
  // The source group is a proper subset of the project: Milad is not present.
  group.memberIds = ['reza', 'parastoo'];
  if (mode === 'silent guest') group.hasGuests = true;
  if (mode === 'named guest') {
    config.people.push({ id: 'guest', name: 'Guest', role: 'Guest', telegramUserId: TG.stranger, companyIds: [], projectIds: [], guest: true });
    group.memberIds.push('guest');
    // Exercise guest detection independently of the aggregate flag.
    group.hasGuests = false;
  }
  if (mode === 'unknown person') group.memberIds.push('unresolved-person');
  if (mode === 'empty') group.memberIds = [];
  const org = new OrgDirectory(config);
  const persona = config.personas[0];
  const llm = new FakeLLM();
  const memories = new InMemoryMemoryStore();
  const history = new InMemoryChatHistoryStore();
  const bot = fakeBot();
  const gateway = new PersonaGateway({
    org, llm, memories, history,
    offers: new InMemoryShareOfferStore(), deduper: new InMemoryUpdateDeduper(),
    voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info() {}, warn() {}, error() {} },
  });
  const chat: ChatContext = { kind: 'group', chatKey: `group-${group.id}`, group };
  return { org, persona, llm, memories, history, gateway, chat };
}

function records(): MemoryRecord[] {
  return [
    memory({ content: PRIVATE, scope: { kind: 'private', personId: 'reza' } }),
    memory({ content: ORGANIZATION, scope: { kind: 'org' } }),
    memory({ content: GROUP, scope: { kind: 'group', groupId: 'gameend-team' }, source: { personId: 'reza', chatKind: 'group', groupId: 'gameend-team', at: new Date() } }),
  ];
}

const candidate: MemoryCandidate = {
  content: SUBSET, type: 'decision', kind: 'work', confidential: false,
  about: ['reza'], projectId: 'gameend', saidBy: 'reza', confidence: 0.9,
};

describe('independent audience boundary regressions', () => {
  it.each<AudienceCase>(['silent guest', 'named guest', 'unknown person', 'empty'])(
    'restricts both prompt entry points for %s even when callers supply unsafe memories', (mode) => {
      const { org, persona, chat } = harness(mode);
      expect(hasRestrictedAudience(org, chat)).toBe(true);
      const inputs = records();
      const prompts = [
        buildSystemPrompt({ org, persona, chat, speakerId: 'reza', memories: inputs }),
        buildExtractionPrompt(org, persona, chat, 'reza', inputs),
      ];
      for (const prompt of prompts) {
        for (const hidden of [SECRET_PERSON, SECRET_ROLE, SECRET_PROJECT, SECRET_NOTE, PRIVATE, ORGANIZATION]) {
          expect(prompt, `${mode}: ${hidden}`).not.toContain(hidden);
        }
        expect(prompt).not.toContain('You report to');
      }
      // Integration adopts the stricter historical-audience contract: an
      // incomplete/guest roster cannot authorize retained group context.
      const canUseGroup = false;
      for (const prompt of prompts) expect(prompt.includes(GROUP)).toBe(canUseGroup);
      expect(selectMemories(org, inputs, chat, { query: 'CANARY' }).map((m) => m.content))
        .toEqual(canUseGroup ? [GROUP] : []);
    },
  );

  it('uses the captured group context for a complete verified audience', () => {
    const { org, persona, chat } = harness();
    const ownGroup = records().find(record => record.content === GROUP)!;
    const inputs = [ownGroup];
    expect(hasRestrictedAudience(org, chat)).toBe(false);
    expect(buildSystemPrompt({ org, persona, chat, speakerId: 'reza', memories: inputs })).toContain(GROUP);
    expect(buildExtractionPrompt(org, persona, chat, 'reza', inputs)).toContain(GROUP);
    expect(selectMemories(org, inputs, chat, { query: 'CANARY' }).map(m => m.content)).toEqual([GROUP]);
  });

  it.each<Exclude<AudienceCase, 'empty'>>(['silent guest', 'named guest', 'unknown person'])(
    'keeps internal canaries out of every model request field for %s on a fresh group turn', async (mode) => {
      const { memories, gateway, llm } = harness(mode);
      for (const record of records()) await memories.add(record);
      await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, hello'));
      expect(llm.replyRequests).toHaveLength(1);
      // Only an audience of known people reaches the extractor; a named guest is a known person.
      expect(llm.extractionRequests).toHaveLength(mode === 'named guest' ? 1 : 0);
      for (const request of [...llm.replyRequests, ...llm.extractionRequests]) {
        const everyField = JSON.stringify(request);
        for (const hidden of [SECRET_PERSON, SECRET_ROLE, SECRET_PROJECT, SECRET_NOTE, PRIVATE, ORGANIZATION]) {
          expect(everyField, `${mode}: ${hidden}`).not.toContain(hidden);
        }
        expect(everyField).not.toContain(GROUP);
      }
    },
  );

  it.each<'silent guest' | 'unknown person'>(['silent guest', 'unknown person'])(
    'never extracts or stores a memory from a %s group turn without a runtime privacy adapter', async (mode) => {
      const { gateway, llm, memories } = harness(mode);
      llm.nextExtraction = { memories: [candidate] };
      expect(await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, a decision for this group'))).toBe('replied');
      expect(llm.extractionCalls).toBe(0);
      expect(await memories.listActive('aria')).toEqual([]);
    },
  );

  it('forms the group memory once every reader is a known member (control)', async () => {
    const { gateway, llm, memories } = harness();
    llm.nextExtraction = { memories: [candidate] };
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, a decision for this group'));
    expect(llm.extractionCalls).toBe(1);
    expect((await memories.listActive('aria')).map((m) => m.content)).toEqual([SUBSET]);
  });

  it('restricts a guest DM extractor and reply while retaining the guest’s own private memory', async () => {
    const { org, chat, memories, gateway, llm } = harness('named guest');
    // This guest has no grant to the seeded group's memories. A guest who
    // belongs to that group legitimately retains its group memory in a DM.
    if (chat.kind !== 'group') throw new Error('Expected group');
    chat.group.memberIds = chat.group.memberIds.filter((id) => id !== 'guest');
    const own = memory({ content: 'GUEST_OWN_MEMORY', scope: { kind: 'private', personId: 'guest' }, source: { personId: 'guest', chatKind: 'private', at: new Date() } });
    for (const record of [...records(), own]) await memories.add(record);
    expect(hasRestrictedAudience(org, { kind: 'private', personId: 'guest', chatKey: 'private-guest' })).toBe(true);
    await gateway.handleUpdate('aria', privateText(TG.stranger, 'hello'));
    expect(llm.replyRequests).toHaveLength(1);
    expect(llm.extractionRequests).toHaveLength(1);
    for (const request of [...llm.replyRequests, ...llm.extractionRequests]) {
      const everyField = JSON.stringify(request);
      expect(everyField).toContain('GUEST_OWN_MEMORY');
      for (const hidden of [SECRET_PERSON, SECRET_ROLE, SECRET_PROJECT, SECRET_NOTE, PRIVATE, ORGANIZATION, GROUP]) {
        expect(everyField).not.toContain(hidden);
      }
    }
  });

  it('does not advertise a project to the extractor unless the complete audience belongs to it', () => {
    const { org, persona, chat } = harness();
    if (chat.kind !== 'group') throw new Error('Expected group');
    chat.group.memberIds.push('sina');
    expect(hasRestrictedAudience(org, chat)).toBe(false);
    expect(buildExtractionPrompt(org, persona, chat, 'reza')).not.toContain(SECRET_PROJECT);
  });

  it('changing only unauthorized private facts cannot change either outgoing model request', async () => {
    const runs = [harness('silent guest'), harness('silent guest')];
    // Both runs must process the same source event: extraction now carries
    // source message receipts, which are intentionally part of model input.
    const update = groupText(GAMEEND_CHAT, TG.reza, 'Aria, hello');
    for (const [i, run] of runs.entries()) {
      for (const record of records()) {
        await run.memories.add({ ...record, content: record.content === GROUP ? GROUP : `PRIVATE_VARIANT_${i}_${record.content}` });
      }
      run.org.getPerson('milad')!.name = `HIDDEN_PERSON_VARIANT_${i}`;
      run.org.getPerson('reza')!.role = `HIDDEN_ROLE_VARIANT_${i}`;
      run.org.config.projects[0].name = `HIDDEN_PROJECT_VARIANT_${i}`;
      await run.gateway.handleUpdate('aria', structuredClone(update));
    }
    expect(runs[0].llm.replyRequests).toEqual(runs[1].llm.replyRequests);
    expect(runs[0].llm.extractionRequests).toEqual(runs[1].llm.extractionRequests);
  });

  it('a group decision remains inaccessible to project members outside that group', async () => {
    const { org, chat, gateway, llm, memories } = harness();
    expect(org.isProjectMember('milad', 'gameend')).toBe(true);
    expect(org.isGroupMember('milad', 'gameend-team')).toBe(false);
    llm.nextExtraction = { memories: [candidate] };
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, a decision for this group'));
    const [stored] = await memories.listActive('aria');
    expect(stored.content).toBe(SUBSET);
    expect(stored.scope).toEqual({ kind: 'group', groupId: 'gameend-team' });
    expect(isVisibleInChat(org, stored, chat)).toBe(true);
    await gateway.handleUpdate('aria', privateText(TG.milad, 'Tell me the group decision'));
    for (const request of [llm.replyRequests.at(-1), llm.extractionRequests.at(-1)]) {
      expect(JSON.stringify(request)).not.toContain(SUBSET);
    }
    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'Remind me of our group decision'));
    expect(JSON.stringify(llm.replyRequests.at(-1))).toContain(SUBSET);
  });

  it.each(['personal', 'confidential'] as const)('preserves private treatment of %s group candidates', (kind) => {
    const { org, chat } = harness();
    const decision = decideScope(org, chat, 'reza', {
      ...candidate, type: 'fact', kind: kind === 'personal' ? 'personal' : 'work',
      confidential: kind === 'confidential',
    });
    expect(decision.scope).toEqual({ kind: 'private', personId: 'reza' });
    expect(decision.sensitivity).toBe(kind);
    expect(decision.offerScope).toBeUndefined();
    const record = memory({ content: 'SENSITIVE_CANARY', scope: decision.scope, sensitivity: decision.sensitivity });
    expect(isVisibleInChat(org, record, chat)).toBe(false);
    expect(isVisibleInChat(org, record, { kind: 'private', chatKey: 'private-parastoo', personId: 'parastoo' })).toBe(false);
    expect(isVisibleInChat(org, record, { kind: 'private', chatKey: 'private-reza', personId: 'reza' })).toBe(true);
  });

  it('filters superseded and unknown-owner personal records at both prompt entry points', () => {
    const { org, persona } = harness();
    const privateChat: ChatContext = { kind: 'private', personId: 'reza', chatKey: 'private-reza' };
    const obsolete = memory({ content: 'SUPERSEDED_CANARY', scope: { kind: 'private', personId: 'reza' }, supersededBy: 'replacement' });
    expect(buildSystemPrompt({ org, persona, chat: privateChat, speakerId: 'reza', memories: [obsolete] })).not.toContain(obsolete.content);
    expect(buildExtractionPrompt(org, persona, privateChat, 'reza', [obsolete])).not.toContain(obsolete.content);
    const unknownChat: ChatContext = { kind: 'private', personId: 'unknown', chatKey: 'private-unknown' };
    const unknown = memory({ content: 'UNKNOWN_OWNER_CANARY', scope: { kind: 'private', personId: 'unknown' }, sensitivity: 'personal' });
    expect(isVisibleInChat(org, unknown, unknownChat)).toBe(false);
    expect(buildSystemPrompt({ org, persona, chat: unknownChat, speakerId: 'unknown', memories: [unknown] })).not.toContain(unknown.content);
    expect(buildExtractionPrompt(org, persona, unknownChat, 'unknown', [unknown])).not.toContain(unknown.content);
  });
});
