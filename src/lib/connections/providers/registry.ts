import type { ConnectionsCatalog } from '../contracts';
import { createConnectionsCatalog } from '../catalog';
import { SafeProviderTransport, ProviderError, type ProviderTransport } from '../transport';
import { getProviderToolDefinition } from './index';
import type { RunnerExecutor } from './runners';
import type { ProviderExecutionContext, ProviderResult } from './types';
export type { ProviderExecutionContext, ProviderResult } from './types';
/** Server broker boundary only. A registry does not authenticate users or confer a connection grant. */
export class ProviderRegistry {
  private readonly transport: ProviderTransport;
  private readonly catalog: ConnectionsCatalog;
  private readonly runners?: RunnerExecutor;
  constructor(options: { transport?: ProviderTransport; catalog?: ConnectionsCatalog; runners?: RunnerExecutor } = {}) {
    this.transport = options.transport ?? new SafeProviderTransport();
    this.catalog = options.catalog ?? createConnectionsCatalog();
    this.runners = options.runners;
  }
  async execute(toolId: string, rawArguments: unknown, context: ProviderExecutionContext): Promise<ProviderResult> {
    const definition = getProviderToolDefinition(toolId); const reviewed = this.catalog.get(toolId);
    if (!definition || !reviewed || !/^[\p{L}\p{N}_.:@/-]{1,200}$/u.test(context.operationId)) throw new ProviderError('provider_tool_unavailable', 'not_dispatched');
    const provider = this.catalog.provider(definition.providerId);
    if (!provider || !context.credential.accessToken || context.credential.accessToken.length > 16000 || /[^\x21-\x7e]/.test(context.credential.accessToken) || context.credential.providerId !== definition.providerId || context.credential.endpointProfileId !== provider.endpointProfileId) throw new ProviderError('credential_profile_mismatch', 'not_dispatched');
    if (!['work', 'personal'].includes(context.scopeKind) || (definition.personalOnly && context.scopeKind !== 'personal')) throw new ProviderError('provider_space_denied', 'not_dispatched');
    let args: Record<string, unknown>; let resourceIds: readonly string[];
    try { args = this.catalog.validateArguments(toolId, rawArguments); resourceIds = this.catalog.mapResources(toolId, args); }
    catch { throw new ProviderError('provider_arguments_or_resource_denied', 'not_dispatched'); }
    if (context.signal?.aborted) throw new ProviderError('provider_cancelled', 'not_dispatched');
    let dispatched = false;
    try {
      if (definition.providerId === 'browser' || definition.providerId === 'ssh') {
        if (!this.runners) throw new ProviderError('runner_unavailable', 'not_dispatched');
        const result = await this.runners.execute(toolId, args, context);
        if (JSON.stringify(result.resourceIds) !== JSON.stringify(resourceIds) || Buffer.byteLength(JSON.stringify(result)) > reviewed.maxOutputBytes || JSON.stringify(result).includes(context.credential.accessToken)) throw new ProviderError('runner_result_denied');
        return result;
      }
      const request = definition.request(args, context);
      dispatched = true;
      const response = await this.transport.request({ ...request, profileId: provider.endpointProfileId, timeoutMs: reviewed.timeoutMs, maxResponseBytes: 512_000 }, context.credential, context.signal);
      const result = definition.normalize(response, args);
      const serialized = JSON.stringify(result);
      if (result.revision && !/^[\x20-\x7e]{1,200}$/.test(result.revision)) throw new ProviderError('provider_revision_invalid');
      if (response.headers.etag?.includes(context.credential.accessToken)) throw new ProviderError('provider_result_denied');
      if (Buffer.byteLength(serialized) > reviewed.maxOutputBytes || serialized.includes(context.credential.accessToken)) throw new ProviderError('provider_result_denied');
      if (result.receipt && !/^[A-Za-z0-9_.:@/-]{1,200}$/.test(result.receipt)) throw new ProviderError('provider_receipt_invalid');
      return { data: result.data, resourceIds, providerReceiptRef: result.receipt ?? null, resourceRevision: result.revision ?? response.headers.etag ?? null,
        untrustedContent: true, truncated: result.truncated ?? false };
    } catch (error) {
      const effectful = definition.effect !== 'read';
      if (error instanceof ProviderError) {
        if (effectful && dispatched && error.outcome !== 'not_dispatched') throw new ProviderError(error.code, 'unknown', error.retryAfterSeconds);
        throw error;
      }
      throw new ProviderError('provider_result_invalid', effectful && dispatched ? 'unknown' : 'failed');
    }
  }
}
