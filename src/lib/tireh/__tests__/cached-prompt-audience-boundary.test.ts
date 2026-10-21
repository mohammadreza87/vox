/** S03: the whole existing audience-boundary suite with TIREH_CACHED_PROMPT=1. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGateway, privateText, TG } from './fixtures';

// The cached arm only: TIREH_PROMPT_SYSTEM_TAIL is pinned off even when set in the process env.
const stub = () => {
  vi.stubEnv('TIREH_CACHED_PROMPT', '1');
  vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
};
stub();
beforeEach(stub);
afterAll(() => { vi.unstubAllEnvs(); });

await import('./audience-boundary.test');

describe('wrapper: the flag is in effect', () => {
  it('sends system blocks and the per-turn block', async () => {
    const { gateway, llm } = makeGateway();
    await gateway.handleUpdate('aria', privateText(TG.reza, 'hello'));
    const request = llm.replyRequests.at(-1)!;
    expect(Array.isArray(request.system)).toBe(true);
    expect(request.messages.at(-1)?.trailingText?.[0]?.startsWith('## For this turn')).toBe(true);
  });
});
