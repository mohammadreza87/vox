import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { isPublicAddress, sendPinnedHttps, ProviderError, type AddressResolver, type PinnedSender } from '../transport';
import { componentId, cleanText } from '../providers/normalization';
import type { ProviderResult } from '../providers/types';
import type { RunnerSandbox } from './sandbox';
export const browserReadSchema = z.object({ targetId: componentId }).strict();
export interface BrowserPageTarget { id: string; url: string }
export interface RunnerAuthorization {
  operationId: string; credentialId: string; scopeKind: 'work' | 'personal'; signal?: AbortSignal;
}
/** Must query the current durable claim/grant/epoch; instructions or provider DOM cannot authorize. */
export interface RunnerPolicy { assertCurrent(context: RunnerAuthorization, toolId: string, resources: readonly string[]): Promise<void> }
export interface BrowserPageReader { read(target: BrowserPageTarget, signal?: AbortSignal): Promise<string> }
export class PinnedBrowserPageReader implements BrowserPageReader {
  constructor(private readonly resolve: AddressResolver = hostname => lookup(hostname, { all: true }), private readonly send: PinnedSender = sendPinnedHttps) {}
  async read(target: BrowserPageTarget, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new ProviderError('browser_fetch_cancelled', 'not_dispatched');
    const url = new URL(target.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new ProviderError('browser_target_invalid', 'not_dispatched');
    const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 10000);
    try {
      const addresses = await Promise.race([this.resolve(url.hostname), new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new ProviderError('browser_fetch_cancelled')), { once: true }))]);
      if (controller.signal.aborted || signal?.aborted || !addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new ProviderError('browser_address_denied', 'not_dispatched');
      const first = addresses[0];
      const response = await this.send({ url, address: first.address, family: first.family as 4 | 6, method: 'GET', headers: { accept: 'text/html', 'accept-encoding': 'identity', 'user-agent': 'Vox-ReadRunner/1' }, timeoutMs: 10000, maxResponseBytes: 128000, signal: controller.signal });
      if (response.status !== 200 || !/^text\/html\b/i.test(response.headers['content-type'] ?? '') || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') || response.bytes.byteLength > 128000) throw new ProviderError('browser_page_unavailable');
      return new TextDecoder('utf-8', { fatal: true }).decode(response.bytes);
    } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('browser_page_unavailable'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}
export class BrowserReadRunner {
  private readonly targets: ReadonlyMap<string, BrowserPageTarget>;
  constructor(private readonly options: { targets: readonly BrowserPageTarget[]; sandbox: RunnerSandbox; policy: RunnerPolicy; reader?: BrowserPageReader }) {
    this.targets = new Map(options.targets.map(target => {
      componentId.parse(target.id); const url = new URL(target.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new ProviderError('browser_target_invalid', 'not_dispatched');
      return [target.id, Object.freeze({ ...target })];
    }));
    if (this.targets.size !== options.targets.length) throw new ProviderError('browser_target_invalid', 'not_dispatched');
  }
  async read(raw: unknown, context: RunnerAuthorization): Promise<ProviderResult> {
    const args = browserReadSchema.parse(raw); const target = this.targets.get(args.targetId); const resources = [`browser:page:${args.targetId}`];
    if (!target) throw new ProviderError('browser_target_unregistered', 'not_dispatched');
    await this.options.policy.assertCurrent(context, 'browser.page.read', resources);
    const html = await (this.options.reader ?? new PinnedBrowserPageReader()).read(target, context.signal);
    await this.options.policy.assertCurrent(context, 'browser.page.read', resources);
    const result = await this.options.sandbox.run({ mode: 'browser', html }, context.signal);
    await this.options.policy.assertCurrent(context, 'browser.page.read', resources);
    const parsed = z.object({ title: z.string().max(500), text: z.string().max(32000), offline: z.literal(true), javascript: z.literal(false), interactive: z.literal(false) }).strict().safeParse(result.data);
    if (!parsed.success || context.signal?.aborted) throw new ProviderError('browser_result_denied');
    return { data: { ...parsed.data, title: cleanText(parsed.data.title, 500), text: cleanText(parsed.data.text, 32000), targetId: args.targetId }, resourceIds: resources,
      providerReceiptRef: null, resourceRevision: createHash('sha256').update(html).digest('hex'), untrustedContent: true, truncated: result.truncated };
  }
}
