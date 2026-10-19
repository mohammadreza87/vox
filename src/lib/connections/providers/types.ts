import { z } from 'zod';
import type { Effect, SpaceKind } from '../contracts';
import type { ProviderCredential, ProviderHttpRequest, ProviderHttpResponse } from '../transport';
export interface ProviderExecutionContext {
  credential: ProviderCredential; operationId: string; signal?: AbortSignal; scopeKind: SpaceKind;
}
export interface ProviderResult {
  data: Record<string, unknown>;
  resourceIds: readonly string[];
  providerReceiptRef: string | null;
  resourceRevision: string | null;
  untrustedContent: true;
  truncated: boolean;
}
export interface ProviderToolDefinition {
  id: string; providerId: string; title: string; description: string; effect: Effect;
  schema: z.ZodType<Record<string, unknown>>;
  requiredScopes: readonly string[];
  resourceFormat: string;
  personalOnly?: boolean;
  mapResources(args: Record<string, unknown>): readonly string[];
  request(args: Record<string, unknown>, context: ProviderExecutionContext): Omit<ProviderHttpRequest, 'profileId'>;
  normalize(response: ProviderHttpResponse, args: Record<string, unknown>): { data: Record<string, unknown>; receipt?: string; revision?: string; truncated?: boolean };
}
export interface ProviderDefinition {
  id: string; label: string; adapterId: string; adapterVersion: string; endpointProfileId: string;
  protocol: 'rest' | 'mcp' | 'browser_worker' | 'ssh_worker'; auth: 'oauth_or_app_token' | 'oauth' | 'project_token' | 'delegated_oauth' | 'worker_lease';
  documentationUrl: string; eligibility: 'requires_account_qualification'; eligibilityReason: string;
  accountEvidence: 'unavailable'; releaseState: 'disabled_pending_qualification';
  setup: readonly string[]; tools: readonly ProviderToolDefinition[];
}
export function defineTool<T extends Record<string, unknown>>(input: Omit<ProviderToolDefinition, 'schema' | 'mapResources' | 'request' | 'normalize'> & {
  schema: z.ZodType<T>;
  mapResources(args: NoInfer<T>): readonly string[];
  request(args: NoInfer<T>, context: ProviderExecutionContext): Omit<ProviderHttpRequest, 'profileId'>;
  normalize(response: ProviderHttpResponse, args: NoInfer<T>): ReturnType<ProviderToolDefinition['normalize']>;
}): ProviderToolDefinition {
  return input as unknown as ProviderToolDefinition;
}
