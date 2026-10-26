/**
 * F183: relationship observation reads the shared negation rule (memory/requests.ts negatedMemoryRequest),
 * so a refusal only that rule recognises never reaches relationships.observeTurn. Group memory is pinned in
 * qa-tests-types-r2-main.test.ts; this pins the second reader. Flags unset (the rule is decision (i)).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdaptiveRelationshipService } from '../../adaptive/relationships/service';
import { PersonaGateway, type RuntimePrivacy } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { OrgDirectory } from '../org/directory';
import type { RelationshipLoop } from '../../relationships';
import type { TelegramBotClient } from '../telegram/client';
import { FakeLLM, fakeBot, privateText, testOrgConfig } from './fixtures';

const TARA = 5001;
const TARA_ID = `tg-${TARA}`;

const WAVE_A_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES', 'STUDIO_VOICE_RECOGNITION', 'STUDIO_VOICE_SHADOW'];
beforeEach(() => { for (const flag of WAVE_A_FLAGS) vi.stubEnv(flag, ''); });
afterEach(() => { vi.unstubAllEnvs(); });

function harness() {
  const config = testOrgConfig();
  config.people.push({ id: TARA_ID, name: 'Tara', role: 'Team member', managerId: 'reza', telegramUserId: TARA, companyIds: ['ludaxis'], projectIds: [] });
  const org = new OrgDirectory(config);
  const key = { personaId: 'aria', chatKey: `private-${TARA_ID}`, audience: { kind: 'private' as const, personId: TARA_ID } };
  const observeTurn = vi.fn(async () => undefined);
  const relationships = {
    mode: 'live', observeTurn, context: vi.fn(async () => ''), control: vi.fn(async () => undefined), configure: vi.fn(async () => undefined),
    deps: { store: { keysForPersona: vi.fn(async () => []), read: vi.fn(async () => ({})) } },
  } as unknown as RelationshipLoop;
  const resolve = vi.fn(async () => ({ key, fingerprint: 'fp-1', notification: {} }));
  const relationshipAuthority = {
    resolve, acceptSource: vi.fn(async () => ({ receipt: 'r-1' })), control: vi.fn(async () => undefined), invalidate: vi.fn(async () => undefined),
  } as unknown as AdaptiveRelationshipService;
  const runtimePrivacy: RuntimePrivacy = {
    validateAudience: async () => true,
    read: async () => ({ revision: 'r1', memoryEnabled: true, historyEnabled: true }),
  };
  const epochs = new Map<string, number>();
  const bot = fakeBot();
  const gateway = new PersonaGateway({
    org, llm: new FakeLLM(), memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs),
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
    runtimePrivacy, relationships, relationshipAuthority,
  });
  const observed = () => (observeTurn.mock.calls as unknown as Array<[{ text: string }]>).map(([turn]) => turn.text);
  return { gateway, observed, resolve };
}

const REFUSALS = [
  'never save this: I moved to Berlin',
  "please don't ever save this: I moved to Berlin",
  'dont save this, I moved to Berlin',
  "I don't want you to remember this: I moved to Berlin",
  'ذخیره‌ش نکن، من به برلین رفتم',
];

describe('F183: relationship observation reads the shared negation rule', () => {
  it('positive control: "I moved to Berlin" reaches relationships.observeTurn (Telegram and Mini App call)', async () => {
    const h = harness();
    await h.gateway.handleUpdate('aria', privateText(TARA, 'I moved to Berlin'));
    await h.gateway.converse('aria', TARA_ID, 'I moved to Berlin');
    expect(h.observed()).toEqual(['I moved to Berlin', 'I moved to Berlin']);
  });

  for (const text of REFUSALS) {
    it(`"${text}" never reaches relationships.observeTurn`, async () => {
      const h = harness();
      await h.gateway.handleUpdate('aria', privateText(TARA, text));
      await h.gateway.converse('aria', TARA_ID, text);
      expect(h.observed()).toEqual([]);
      expect(h.resolve).not.toHaveBeenCalled();
    });
  }
});
