/**
 * S03: the whole existing gateway suite with TIREH_CACHED_PROMPT=1 and the
 * TIREH_PROMPT_SYSTEM_TAIL=1 A/B arm. See cached-prompt-gateway-suite.test.ts
 * for why a scoped, test-only Array.prototype.startsWith shim is installed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGateway, privateText, TG } from './fixtures';
import { systemText, type SystemBlock } from '../llm-content';

const stub = () => {
  vi.stubEnv('TIREH_CACHED_PROMPT', '1');
  vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '1');
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

describe('wrapper: both flags are in effect', () => {
  it('sends system blocks and the per-turn block as a system tail', async () => {
    const { gateway, llm } = makeGateway();
    await gateway.handleUpdate('aria', privateText(TG.reza, 'hello'));
    const request = llm.replyRequests.at(-1)!;
    expect(Array.isArray(request.system)).toBe(true);
    expect(request.systemTail?.startsWith('## For this turn')).toBe(true);
    expect(request.messages.some((m) => m.trailingText)).toBe(false);
  });
});
