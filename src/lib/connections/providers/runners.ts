import { defineTool, type ProviderToolDefinition, type ProviderExecutionContext, type ProviderResult } from './types';
import { browserReadSchema, type BrowserReadRunner, type RunnerAuthorization } from '../runners/browser';
import { sshServiceStatusSchema, type SshReadRunner } from '../runners/ssh';
import { ProviderError } from '../transport';
export interface RunnerExecutor { execute(toolId: string, args: Record<string, unknown>, context: ProviderExecutionContext): Promise<ProviderResult> }
/** Registered only by the separately isolated runner/broker deployment after inventory/identity admission. */
export class ConfiguredRunnerExecutor implements RunnerExecutor {
  constructor(private readonly options: { browser?: Pick<BrowserReadRunner, 'read'>; ssh?: Pick<SshReadRunner, 'serviceStatus'>;
    authorization: (context: ProviderExecutionContext, toolId: string, args: Record<string, unknown>) => Promise<RunnerAuthorization> }) {}
  async execute(toolId: string, args: Record<string, unknown>, context: ProviderExecutionContext): Promise<ProviderResult> {
    const authorization = await this.options.authorization(context, toolId, args);
    if (authorization.operationId !== context.operationId || authorization.scopeKind !== context.scopeKind) throw new ProviderError('runner_scope_mismatch', 'not_dispatched');
    const scoped = { ...authorization, signal: context.signal };
    if (toolId === 'browser.page.read' && this.options.browser) return this.options.browser.read(args, scoped);
    if (toolId === 'ssh.service.status' && this.options.ssh) return this.options.ssh.serviceStatus(args, scoped);
    throw new ProviderError('runner_unavailable', 'not_dispatched');
  }
}
const unavailable = (): never => { throw new ProviderError('runner_unavailable', 'not_dispatched'); };
export const browserTools: readonly ProviderToolDefinition[] = [defineTool({ id: 'browser.page.read', providerId: 'browser', title: 'Read selected public page', description: 'Read a registered public page in an offline isolated Chromium snapshot. No login, cookies, active scripts, clicks, downloads or submissions.', effect: 'read', schema: browserReadSchema, requiredScopes: ['worker:public_page_read'], resourceFormat: 'browser:page:registeredTargetId', mapResources: a => [`browser:page:${a.targetId}`], request: unavailable, normalize: unavailable })];
export const sshTools: readonly ProviderToolDefinition[] = [defineTool({ id: 'ssh.service.status', providerId: 'ssh', title: 'Read selected service status', description: 'Read deterministic status of one registered service on a host with independently verified key, through a fixed unprivileged forced-command runbook.', effect: 'read', schema: sshServiceStatusSchema, requiredScopes: ['worker:service_status'], resourceFormat: 'ssh:host:registeredHostId:service:registeredServiceId', mapResources: a => [`ssh:host:${a.hostId}:service:${a.serviceId}`], request: unavailable, normalize: unavailable })];
