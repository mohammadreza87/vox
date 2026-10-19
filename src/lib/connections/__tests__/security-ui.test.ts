import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionsDashboard } from '../application';
import { ConnectionsScreen } from '../../../app/studio/_components/screens/Connections';
import { ConnectionWorkflows } from '../../../app/studio/_components/screens/ConnectionWorkflows';

const api = vi.hoisted(() => ({ read: vi.fn(), resources: vi.fn(), grant: vi.fn(), enroll: vi.fn(), setup: vi.fn(),
  claim: vi.fn(), cancelSetup: vi.fn(), review: vi.fn(), approve: vi.fn(), cancel: vi.fn(), execute: vi.fn(), revoke: vi.fn(),
  workflows: vi.fn(), workflowChoices: vi.fn(), createWorkflow: vi.fn(), reviewWorkflow: vi.fn(), pauseWorkflow: vi.fn() }));
vi.mock('../../../app/studio/_lib/connections-client', () => ({ connectionsApi: api, openConnectionSignIn: vi.fn() }));

function dashboard(overrides: Record<string, unknown> = {}): ConnectionsDashboard {
  return { schemaVersion: 1, scope: { tenantId: 'qa-tenant', spaceId: 'qa-work', spaceKind: 'work', containerId: 'qa-private', audiencePersonIds: ['qa-person'], audienceRevision: 'qa-audience' },
    connections: [{ id: 'qa-connection', providerId: 'qa', displayLabel: 'QA_WORK_PRIVATE', revision: 2, lifecycle: 'connected', health: 'healthy', checkedAt: 1, revocationEpoch: 0 }],
    grants: [], operations: [], enabled: true, maxGrantExpiryAt: Date.now() + 30 * 60_000,
    agents: [{ id: 'qa-agent', name: 'QA Agent' }], providers: [{ id: 'qa', name: 'QA Service', description: 'Synthetic fixture', setup: 'operator', availability: 'ready', reason: '', tools: [{ id: 'qa.read', name: 'Read selected page', effect: 'read' }] }],
    ...overrides } as ConnectionsDashboard;
}

describe('independent Connections UI policy assertions (synthetic component render)', () => {
  beforeEach(() => { vi.resetAllMocks(); api.read.mockResolvedValue(dashboard());
    api.workflows.mockResolvedValue({ workflows: [], occurrences: [], subscriptions: [] }); api.workflowChoices.mockResolvedValue({ choices: [] }); });
  afterEach(cleanup);

  it('connecting an account shows zero access and does not auto-grant an agent', async () => {
    render(createElement(ConnectionsScreen, { onBack: vi.fn() }));
    expect(await screen.findByText('No agent access')).toBeInTheDocument();
    expect(api.grant).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
  });

  it('clears old Work account labels immediately while Personal is loading', async () => {
    api.read.mockImplementation((space: string) => space === 'work' ? Promise.resolve(dashboard()) : new Promise(() => undefined));
    render(createElement(ConnectionsScreen, { onBack: vi.fn() }));
    await screen.findByText('QA_WORK_PRIVATE'); fireEvent.click(screen.getByRole('button', { name: 'Personal', exact: true }));
    await waitFor(() => expect(screen.queryByText('QA_WORK_PRIVATE')).not.toBeInTheDocument());
    expect(screen.getByText('Loading connections…')).toBeInTheDocument();
  });

  it('renders Persian copy in RTL and preserves the private audience label', async () => {
    const view = render(createElement(ConnectionsScreen, { onBack: vi.fn() })); await screen.findByText('QA_WORK_PRIVATE');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fa' } });
    await screen.findByText('پاسخ در وکس: فقط شما');
    expect(view.container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(view.container.querySelector('section')).toHaveAttribute('lang', 'fa');
    expect(api.grant).not.toHaveBeenCalled();
  });

  it('does not offer connect for an unqualified service', async () => {
    api.read.mockResolvedValue(dashboard({ providers: [{ id: 'unqualified', name: 'Unqualified QA Service', description: 'Fixture', setup: 'oauth', availability: 'unavailable', reason: 'Account qualification unavailable', tools: [] }] }));
    render(createElement(ConnectionsScreen, { onBack: vi.fn() })); await screen.findByText('QA_WORK_PRIVATE');
    fireEvent.click(screen.getByRole('button', { name: 'Add connection', exact: true }));
    expect(await screen.findByRole('button', { name: 'Add connection', exact: true })).toBeDisabled();
    expect(api.enroll).not.toHaveBeenCalled();
  });

  it('shows uncertain effects without exposing a blind execute/retry action', async () => {
    api.read.mockResolvedValue(dashboard({ operations: [{ schemaVersion: 1, operationId: 'qa-unknown', requestId: 'qa-request', revision: 3,
      state: 'outcome_unknown', effect: 'send', toolId: 'qa.read', agentId: 'qa-agent', proposalDigest: 'qa-digest',
      resourceIds: ['qa-resource'], audiencePersonIds: ['qa-person'], destinationId: 'qa-private', expectedTargetRevision: null,
      deadlineAt: Date.now() + 30_000, safeReason: 'provider_outcome_unconfirmed', providerReceiptRef: null }] }));
    render(createElement(ConnectionsScreen, { onBack: vi.fn() }));
    expect(await screen.findByText('Outcome not confirmed. Do not repeat the action; check with the provider.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run approved action|Try again|Retry/i })).not.toBeInTheDocument();
    expect(api.execute).not.toHaveBeenCalled();
  });

  it('submits the reviewed grant within the current server-issued identity expiry ceiling', async () => {
    const data = dashboard(); api.read.mockResolvedValue(data); api.grant.mockResolvedValue(data);
    api.resources.mockResolvedValue({ resources: [{ id: 'qa-resource', label: 'Selected QA page', toolIds: ['qa.read'], destinationIds: ['qa-private'] }] });
    render(createElement(ConnectionsScreen, { onBack: vi.fn() })); await screen.findByText('QA_WORK_PRIVATE');
    fireEvent.click(screen.getByRole('button', { name: 'Choose access', exact: true })); await screen.findByText('Selected QA page');
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'qa-agent' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Selected QA page/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Read selected page/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow access', exact: true }));
    await waitFor(() => expect(api.grant).toHaveBeenCalledTimes(1));
    const input = api.grant.mock.calls[0][0];
    expect(input.expiresAt).toBeLessThanOrEqual(data.maxGrantExpiryAt);
    expect(input.expiresAt).toBeGreaterThan(Date.now());
    expect(input.resourceIds).toEqual(['qa-resource']); expect(input.agentId).toBe('qa-agent');
  });

  it('workflow draft → exact review → pause requires each deliberate transition and never auto-activates', async () => {
    const expiresAt = Date.now() + 8 * 3_600_000;
    const data = dashboard({ maxGrantExpiryAt: expiresAt, skills: [{ id: 'qa-guidance', title: 'QA guidance', providerIds: ['qa'], version: 1 }] });
    let workflows: Record<string, unknown>[] = [];
    api.workflows.mockImplementation(async () => ({ workflows, occurrences: [], subscriptions: [] }));
    api.workflowChoices.mockResolvedValue({ choices: [{ id: 'qa-choice', grantId: 'qa-grant', agentId: 'qa-agent', connectionId: 'qa-connection',
      providerId: 'qa', label: 'Selected QA resource', resourceId: 'qa-resource', expiresAt, toolId: 'qa.read', arguments: { resourceId: 'qa-resource' }, fields: [] }] });
    api.createWorkflow.mockImplementation(async input => {
      const workflow = { ...input, id: 'qa-workflow', revision: 1, status: 'draft', reviewDigest: 'qa-exact-review-digest', runsReserved: 0,
        steps: input.steps.map((step: Record<string, unknown>) => ({ ...step, resourceIds: ['qa-resource'] })) };
      workflows = [workflow]; return workflow;
    });
    api.reviewWorkflow.mockImplementation(async (_space, workflow) => { workflows = [{ ...workflow, status: 'active', revision: 2 }]; return workflows[0]; });
    api.pauseWorkflow.mockImplementation(async (_space, workflow) => { workflows = [{ ...workflow, status: 'paused', revision: 3 }]; return workflows[0]; });
    render(createElement(ConnectionWorkflows, { data, space: 'work', locale: 'en' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'New check', exact: true })).toBeEnabled());
    expect(api.createWorkflow).not.toHaveBeenCalled(); expect(api.reviewWorkflow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New check', exact: true }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic status check' } });
    fireEvent.change(screen.getByLabelText('Resource and agent'), { target: { value: 'qa-choice' } });
    fireEvent.change(screen.getByLabelText('Task guidance'), { target: { value: 'qa-guidance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
    expect(await screen.findByRole('button', { name: 'Activate reviewed check', exact: true })).toBeEnabled();
    expect(api.createWorkflow).toHaveBeenCalledTimes(1); expect(api.reviewWorkflow).not.toHaveBeenCalled();
    expect(api.createWorkflow.mock.calls[0][0]).toMatchObject({ space: 'work', agentId: 'qa-agent', grantId: 'qa-grant',
      steps: [{ toolId: 'qa.read', arguments: { resourceId: 'qa-resource' } }], expiresAt });
    fireEvent.click(screen.getByRole('button', { name: 'Activate reviewed check', exact: true }));
    await screen.findByText(/^Active ·/);
    expect(api.reviewWorkflow).toHaveBeenCalledWith('work', expect.objectContaining({ id: 'qa-workflow', revision: 1, reviewDigest: 'qa-exact-review-digest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause', exact: true }));
    await screen.findByText(/^Paused ·/);
    expect(api.pauseWorkflow).toHaveBeenCalledWith('work', expect.objectContaining({ id: 'qa-workflow', revision: 2, status: 'active' }));
    expect(api.execute).not.toHaveBeenCalled();
  });
});
