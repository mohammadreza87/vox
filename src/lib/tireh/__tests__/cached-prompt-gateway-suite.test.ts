/**
 * S03: the whole existing gateway suite with TIREH_CACHED_PROMPT=1.
 *
 * Three legacy fakes in gateway.test.ts call `request.system.startsWith(...)`
 * to tell extraction from reply requests. With the flag on, reply requests
 * carry SystemBlock[] (extraction stays a string), and existing tests may not
 * be edited. A test-only, configurable, non-enumerable Array.prototype.startsWith
 * that delegates to systemText() keeps those fakes working; it is installed
 * before the suite loads and deleted in afterAll. Production code has no shim.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGateway, privateText, TG } from './fixtures';
import { systemText, type SystemBlock } from '../llm-content';

// The cached arm only: TIREH_PROMPT_SYSTEM_TAIL is pinned off even when set in the process env.
const stub = () => {
  vi.stubEnv('TIREH_CACHED_PROMPT', '1');
  vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
};
stub();
beforeEach(stub);
Object.defineProperty(Array.prototype, 'startsWith', {
  configurable: true, enumerable: false, writable: true,
  value(this: SystemBlock[], search: string, position?: number) { return systemText(this).startsWith(search, position); },
});
afterAll(() => {
  Reflect.deleteProperty(Array.prototype, 'startsWith');
  vi.unstubAllEnvs();
});

await import('./gateway.test');

describe('wrapper: the flag is in effect', () => {
  it('sends system blocks and the per-turn block', async () => {
    const { gateway, llm } = makeGateway();
    await gateway.handleUpdate('aria', privateText(TG.reza, 'hello'));
    const request = llm.replyRequests.at(-1)!;
    expect(Array.isArray(request.system)).toBe(true);
    expect(request.messages.at(-1)?.trailingText?.[0]?.startsWith('## For this turn')).toBe(true);
  });
});
