import { describe, expect, it } from 'vitest';
import { PersonaGateway, type RuntimePrivacyState } from '../gateway';
import type { LLM, LLMRequest } from '../llm';
import { InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import { makeGateway } from './fixtures';

const SAVED = 'SYNTHETIC_ADAPTIVE_SAVED_NOTE';
const RAW_HISTORY = 'SYNTHETIC_UNSCOPED_PLATFORM_HISTORY';

function setup() {
  const h = makeGateway();
  let state: RuntimePrivacyState = {
    revision: 'permitted-v1', memoryEnabled: false, historyEnabled: false, context: [SAVED],
  };
  let valid = true;
  const gatewayFor = (llm: LLM = h.llm) => new PersonaGateway({
    ...h, llm, voice: null, botFor: () => h.bot as unknown as TelegramBotClient, deduper: new InMemoryUpdateDeduper(),
    runtimePrivacy: {
      read: async () => state,
      validateAudience: async () => valid,
    },
  });
  return { ...h, gateway: gatewayFor(), gatewayFor,
    revoke: () => { state = { ...state, revision: 'revoked-v2', context: [] }; },
    revokeAudience: () => { valid = false; },
  };
}

describe('independent composed streaming and deletion review', () => {
  it('does not claim adaptive notes were erased by a legacy forget operation', async () => {
    const h = setup();
    const reply = await h.gateway.converse('aria', 'reza', 'forget everything about me');
    expect(reply).not.toContain('I cleared what you told me from memory and future conversation context');
    expect(reply).toMatch(/private|shared|privacy/i);
    // Until a qualified cross-store erase exists, surviving notes require honest
    // guidance. This fixture intentionally keeps the adaptive note permitted.
    await h.gateway.converse('aria', 'reza', 'a fresh current question');
    expect(JSON.stringify(h.llm.replyRequests.at(-1))).toContain(SAVED);
  });

  it('streams only the latest platform utterance and scoped adaptive context', async () => {
    const h = setup();
    let request: LLMRequest | undefined;
    const llm: LLM = { complete: async () => '', stream: async function* (input) {
      request = input; yield 'permitted current reply';
    } };
    const parts: string[] = [];
    for await (const part of h.gatewayFor(llm).liveTurn('aria', 'reza', [
      { role: 'user', content: RAW_HISTORY },
      { role: 'assistant', content: RAW_HISTORY },
      { role: 'user', content: 'current utterance' },
    ], { space: 'personal' })) parts.push(part);
    expect(parts).toEqual(['permitted current reply']);
    expect(JSON.stringify(request)).toContain('current utterance');
    expect(JSON.stringify(request)).toContain(SAVED);
    expect(JSON.stringify(request)).not.toContain(RAW_HISTORY);
    expect(JSON.stringify(request)).not.toContain('GameEnd');
    expect(await h.history.recent('aria', 'private-reza', 10)).toEqual([]);
  });

  it.each(['source', 'audience'] as const)('stops later stream chunks after %s authority changes', async kind => {
    const h = setup();
    const llm: LLM = { complete: async () => '', stream: async function* () {
      yield 'already emitted';
      if (kind === 'source') h.revoke(); else h.revokeAudience();
      yield 'must never emit';
    } };
    const parts: string[] = [];
    for await (const part of h.gatewayFor(llm).liveTurn('aria', 'reza', [
      { role: 'user', content: 'current utterance' },
    ])) parts.push(part);
    expect(parts).toEqual(['already emitted']);
    expect(await h.history.recent('aria', 'private-reza', 10)).toEqual([]);
  });
});
