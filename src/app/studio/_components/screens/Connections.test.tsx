import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import type { ConnectionsDashboard } from '@/lib/connections/application';
import { ConnectionsScreen } from './Connections';
import { ConnectionWorkflows } from './ConnectionWorkflows';
import { ConnectionDetailPage } from './settings/ConnectionDetail';
import { ConfirmProvider } from '../ui';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';

const api = vi.hoisted(() => ({ read: vi.fn(), resources: vi.fn(), grant: vi.fn(), enroll: vi.fn(), setup: vi.fn(),
  claim: vi.fn(), cancelSetup: vi.fn(), review: vi.fn(), approve: vi.fn(), cancel: vi.fn(), execute: vi.fn(), revoke: vi.fn(), task: vi.fn(),
  workflows: vi.fn(), workflowChoices: vi.fn(), createWorkflow: vi.fn(), reviewWorkflow: vi.fn(), pauseWorkflow: vi.fn() }));
const telegram = vi.hoisted(() => ({ handlers: new Set<() => void>() }));
vi.mock('../../_lib/connections-client', () => ({ connectionsApi: api, openConnectionSignIn: vi.fn() }));
vi.mock('../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../_lib/client')>(),
  tg: () => ({ initData: 'session', onEvent: (_e: string, cb: () => void) => telegram.handlers.add(cb), offEvent: (_e: string, cb: () => void) => telegram.handlers.delete(cb) }) }));
const nav = vi.hoisted(() => ({ current: null as unknown, push: null as unknown as ReturnType<typeof vi.fn>, back: null as unknown as ReturnType<typeof vi.fn>, snack: null as unknown as ReturnType<typeof vi.fn>, setLocale: null as unknown as (l: 'en' | 'fa') => void }));
vi.mock('../StudioApp', () => ({ useNav: () => nav.current }));

function App({ view }: { view: () => ReactNode }) {
  const [locale, setLocale] = useState<'en' | 'fa'>('en'), [space, setSpace] = useState<'work' | 'personal'>('work');
  nav.setLocale = setLocale;
  nav.current = { locale, dir: locale === 'fa' ? 'rtl' : 'ltr', setLocale, space, setSpace, snack: nav.snack, toast: vi.fn(), push: nav.push, back: nav.back, tier: 'full', cache: new Map() };
  return <ConfirmProvider>{view()}</ConfirmProvider>;
}
const list = (agentId?: string) => <App view={() => <ConnectionsScreen agentId={agentId} />} />;
const detail = () => <App view={() => <ConnectionDetailPage connectionId="qa-connection" />} />;

function dashboard(overrides: Record<string, unknown> = {}): ConnectionsDashboard {
  return { schemaVersion: 1, scope: { tenantId: 'qa-tenant', spaceId: 'qa-work', spaceKind: 'work', containerId: 'qa-private', audiencePersonIds: ['qa-person'], audienceRevision: 'qa-audience' },
    connections: [{ id: 'qa-connection', providerId: 'qa', displayLabel: 'QA_WORK_PRIVATE', revision: 2, lifecycle: 'connected', health: 'healthy', checkedAt: 1, revocationEpoch: 0 }],
    grants: [], operations: [], enabled: true, maxGrantExpiryAt: Date.now() + 30 * 60_000,
    agents: [{ id: 'qa-agent', name: 'QA Agent' }], providers: [{ id: 'qa', name: 'QA Service', description: 'Synthetic fixture', setup: 'operator', availability: 'ready', reason: '', tools: [{ id: 'qa.read', name: 'Read selected page', effect: 'read' }] }],
    ...overrides } as ConnectionsDashboard;
}
const grant = { id: 'qa-grant', revision: 3, connectionId: 'qa-connection', agentId: 'qa-agent', toolIds: ['qa.read'], resourceIds: ['qa-resource'], destinationIds: ['qa-private'], effects: ['read'], expiresAt: Date.now() + 60_000, status: 'active' };
const operation = (state: string, extra: Record<string, unknown> = {}) => ({ schemaVersion: 1, operationId: `qa-${state}`, requestId: 'qa-request', revision: 3,
  state, effect: 'send', toolId: 'qa.read', agentId: 'qa-agent', proposalDigest: 'qa-digest', resourceIds: ['qa-resource'], audiencePersonIds: ['qa-person'], destinationId: 'qa-private',
  expectedTargetRevision: null, deadlineAt: Date.now() + 30_000, safeReason: null, providerReceiptRef: null, ...extra });

beforeEach(() => {
  vi.resetAllMocks(); telegram.handlers.clear();
  nav.push = vi.fn(); nav.back = vi.fn(); nav.snack = vi.fn();
  api.read.mockResolvedValue(dashboard());
  api.workflows.mockResolvedValue({ workflows: [], occurrences: [], subscriptions: [] }); api.workflowChoices.mockResolvedValue({ choices: [] });
});
afterEach(cleanup);

describe('Connections list', () => {
  it('shows a connected account with zero access, pushes its detail page and never auto-grants', async () => {
    const view = render(list());
    expect(await screen.findByText('No agent access')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /QA_WORK_PRIVATE/ }));
    expect(nav.push).toHaveBeenCalledWith({ name: 'settings', page: 'connection', params: { connectionId: 'qa-connection' } });
    expect(api.grant).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
    expectOneVolt(view.container); expectNoRawControls(view.container);
  });
  it('clears old Work account labels immediately while Personal is loading', async () => {
    api.read.mockImplementation((space: string) => space === 'work' ? Promise.resolve(dashboard()) : new Promise(() => undefined));
    render(list());
    await screen.findByText('QA_WORK_PRIVATE'); fireEvent.click(screen.getByRole('tab', { name: 'Personal', exact: true }));
    await waitFor(() => expect(screen.queryByText('QA_WORK_PRIVATE')).not.toBeInTheDocument());
    expect(screen.getByRole('status', { name: 'Loading connections…' })).toBeInTheDocument();
  });
  it('renders Persian copy in RTL from the app locale and keeps the private audience label', async () => {
    const view = render(list()); await screen.findByText('QA_WORK_PRIVATE');
    act(() => nav.setLocale('fa'));
    await screen.findByText(/پاسخ در وکس: فقط شما/);
    expect(view.container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(view.container.querySelector('section')).toHaveAttribute('lang', 'fa');
    expect(api.grant).not.toHaveBeenCalled();
  });
  it('does not offer connect for an unqualified service', async () => {
    api.read.mockResolvedValue(dashboard({ providers: [{ id: 'unqualified', name: 'Unqualified QA Service', description: 'Fixture', setup: 'oauth', availability: 'unavailable', reason: 'Account qualification unavailable', tools: [] }] }));
    render(list()); await screen.findByText('QA_WORK_PRIVATE');
    fireEvent.click(screen.getByRole('button', { name: 'Add connection', exact: true }));
    expect(await screen.findByRole('button', { name: /Add connection: Unqualified QA Service/ })).toBeDisabled();
    expect(api.enroll).not.toHaveBeenCalled();
  });
  it('shows uncertain effects without exposing a blind execute/retry action', async () => {
    api.read.mockResolvedValue(dashboard({ operations: [operation('outcome_unknown', { safeReason: 'provider_outcome_unconfirmed' })] }));
    render(list());
    expect(await screen.findByText('Outcome not confirmed. Do not repeat the action; check with the provider.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run approved action|Try again|Retry/i })).not.toBeInTheDocument();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it('summarises an action for approval without raw JSON by default, and approves only after a confirmation', async () => {
    api.read.mockResolvedValue(dashboard({ operations: [operation('needs_approval')] }));
    api.review.mockResolvedValue({ receipt: operation('needs_approval'), arguments: { channel: 'qa-private', text: 'PAYLOAD_TEXT', blocks: [{ type: 'section' }] } });
    api.approve.mockResolvedValue(operation('authorized')); api.execute.mockResolvedValue({ receipt: operation('verified') });
    const view = render(list());
    fireEvent.click(await screen.findByRole('button', { name: /Review action: Read selected page/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Review action' });
    expect(within(sheet).getByText('PAYLOAD_TEXT')).toBeVisible();
    expect(within(sheet).getByText('Send or publish')).toBeInTheDocument();
    const details = sheet.querySelector('details.vx-disclosure')!;
    expect(details).not.toHaveAttribute('open');
    expect(details.querySelector('pre.vx-code')).toHaveTextContent('"type": "section"');
    expectOneVolt(view.container); expectNoRawControls(view.container);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve this action' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this action?' });
    expect(api.approve).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Approve this action' })); });
    expect(api.approve).toHaveBeenCalledWith('work', expect.objectContaining({ operationId: 'qa-needs_approval', proposalDigest: 'qa-digest' }));
    expect(api.execute).toHaveBeenCalledWith('work', 'qa-authorized');
  });
  it('checks a pending sign-in by itself when the person comes back from the browser', async () => {
    const created = { id: 'qa-new', providerId: 'qa', displayLabel: 'QA Service', revision: 1, lifecycle: 'pending', health: 'unknown', checkedAt: null, revocationEpoch: 0 };
    api.enroll.mockResolvedValue({ ...dashboard(), connections: [...dashboard().connections, created] });
    api.setup.mockResolvedValue({ flowId: 'qa-flow', status: 'pending', authorizationUrl: 'https://provider.example/auth', expiresAt: Date.now() + 60_000 });
    api.claim.mockResolvedValue({ flowId: 'qa-flow', status: 'connected', expiresAt: Date.now() + 60_000 });
    const view = render(list()); await screen.findByText('QA_WORK_PRIVATE');
    fireEvent.click(screen.getByRole('button', { name: 'Add connection', exact: true }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Add connection: QA Service/ })); });
    expect(await screen.findByRole('button', { name: 'Continue in browser' })).toBeInTheDocument();
    expectOneVolt(view.container);
    expect(api.claim).not.toHaveBeenCalled();
    await act(async () => { for (const handler of telegram.handlers) handler(); });
    expect(api.claim).toHaveBeenCalledWith('work', 'qa-flow');
    await waitFor(() => expect(nav.snack).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account connected. Choose access to let an agent use it.' })));
  });
});

describe('Connection detail', () => {
  it('submits the reviewed grant within the current server-issued identity expiry ceiling', async () => {
    const data = dashboard(); api.read.mockResolvedValue(data); api.grant.mockResolvedValue(data);
    api.resources.mockResolvedValue({ resources: [{ id: 'qa-resource', label: 'Selected QA page', toolIds: ['qa.read'], destinationIds: ['qa-private'] }] });
    const view = render(detail());
    fireEvent.click(await screen.findByRole('button', { name: 'Choose access', exact: true }));
    const sheet = await screen.findByRole('dialog', { name: 'Review access' });
    await within(sheet).findByText('Selected QA page');
    expect(within(sheet).getByRole('button', { name: 'Allow access' })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('button', { name: /^Agent:/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'QA Agent' }));
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /Selected QA page/ }));
    fireEvent.click(await within(sheet).findByRole('checkbox', { name: /Read selected page/ }));
    expect(sheet.querySelector('details.vx-disclosure')).toHaveTextContent('qa-private');
    expectOneVolt(view.container); expectNoRawControls(view.container);
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Allow access' })); });
    expect(api.grant).toHaveBeenCalledTimes(1);
    const input = api.grant.mock.calls[0][0];
    expect(input.expiresAt).toBeLessThanOrEqual(data.maxGrantExpiryAt);
    expect(input.expiresAt).toBeGreaterThan(Date.now());
    expect(input).toMatchObject({ resourceIds: ['qa-resource'], agentId: 'qa-agent', toolIds: ['qa.read'], destinationIds: ['qa-private'], effects: ['read'], expectedRevision: 2 });
  });
  it('stops one agent’s access and disconnects only after confirmation', async () => {
    api.read.mockResolvedValue(dashboard({ grants: [grant] })); api.revoke.mockResolvedValue(dashboard());
    render(detail());
    fireEvent.click(await screen.findByRole('button', { name: 'Stop access' }));
    const stop = await screen.findByRole('dialog', { name: 'Stop QA Agent’s access?' });
    expect(api.revoke).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(stop).getByRole('button', { name: 'Stop access' })); });
    expect(api.revoke).toHaveBeenLastCalledWith('work', 'qa-connection', 2, 'qa-grant', 3);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const disconnect = await screen.findByRole('dialog', { name: 'Disconnect QA_WORK_PRIVATE?' });
    fireEvent.click(within(disconnect).getByRole('button', { name: 'Keep' }));
    expect(api.revoke).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await act(async () => { fireEvent.click(within(await screen.findByRole('dialog', { name: 'Disconnect QA_WORK_PRIVATE?' })).getByRole('button', { name: 'Disconnect' })); });
    expect(api.revoke).toHaveBeenLastCalledWith('work', 'qa-connection', 2);
    expect(nav.back).toHaveBeenCalled();
  });
  it('says so when the connection is not in the current space', async () => {
    api.read.mockResolvedValue(dashboard({ connections: [] }));
    render(detail());
    expect(await screen.findByText('This connection isn’t in this space')).toBeInTheDocument();
  });
});

describe('Scheduled checks', () => {
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
    const view = render(<App view={() => <ConnectionWorkflows data={data} space="work" locale="en" />} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New check', exact: true })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'New check', exact: true }));
    const form = await screen.findByRole('dialog', { name: 'New check' });
    expect(within(form).getByRole('button', { name: 'Save draft' })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Synthetic status check' } });
    fireEvent.click(within(form).getByRole('button', { name: /^Resource and agent:/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Selected QA resource/ }));
    fireEvent.click(within(form).getByRole('button', { name: /^Task guidance:/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /QA guidance/ }));
    expectNoRawControls(view.container);
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save draft' })); });
    expect(api.createWorkflow).toHaveBeenCalledTimes(1); expect(api.reviewWorkflow).not.toHaveBeenCalled();
    expect(api.createWorkflow.mock.calls[0][0]).toMatchObject({ space: 'work', agentId: 'qa-agent', grantId: 'qa-grant', skillId: 'qa-guidance',
      steps: [{ toolId: 'qa.read', arguments: { resourceId: 'qa-resource' } }], schedule: { kind: 'interval', minutes: 15 }, quietHours: null, expiresAt, maxRuns: 20 });
    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic status check' }));
    const sheet = await screen.findByRole('dialog', { name: 'Synthetic status check' });
    expect(sheet.querySelector('details.vx-disclosure')).not.toHaveAttribute('open');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Activate reviewed check', exact: true })); });
    expect(api.reviewWorkflow).toHaveBeenCalledWith('work', expect.objectContaining({ id: 'qa-workflow', revision: 1, reviewDigest: 'qa-exact-review-digest' }));
    await within(sheet).findByText(/^Active ·/);
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Pause', exact: true })); });
    expect(api.pauseWorkflow).toHaveBeenCalledWith('work', expect.objectContaining({ id: 'qa-workflow', revision: 2, status: 'active' }));
    expect(api.execute).not.toHaveBeenCalled();
  });
});


describe('separate per-agent setup and access', () => {
  const scoped = () => dashboard({
    connections: [
      { ...dashboard().connections[0], agentId: 'qa-agent' },
      { ...dashboard().connections[0], id: 'other', displayLabel: 'OTHER_AGENT_PRIVATE_ACCOUNT', agentId: 'other-agent' },
      { ...dashboard().connections[0], id: 'legacy', displayLabel: 'LEGACY_GLOBAL_ACCOUNT' },
    ], agents: [{ id: 'qa-agent', name: 'QA Agent' }, { id: 'other-agent', name: 'Other Agent' }],
  });
  it('lists only this agent’s bound accounts and preserves its identity in detail navigation', async () => {
    api.read.mockResolvedValue(scoped()); render(list('qa-agent'));
    await screen.findByText('QA_WORK_PRIVATE');
    expect(api.read).toHaveBeenCalledWith('work', 'qa-agent');
    expect(screen.queryByText('OTHER_AGENT_PRIVATE_ACCOUNT')).not.toBeInTheDocument();
    expect(screen.queryByText('LEGACY_GLOBAL_ACCOUNT')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /QA_WORK_PRIVATE/ }));
    expect(nav.push).toHaveBeenCalledWith({ name: 'settings', page: 'connection', params: { connectionId: 'qa-connection', agentId: 'qa-agent' } });
    expect(api.grant).not.toHaveBeenCalled();
  });
  it('an agent\'s Activity view shows only that agent\'s recent activity, not the connections list again', async () => {
    api.read.mockResolvedValue(dashboard({ operations: [operation('verified')] }));
    render(<App view={() => <ConnectionsScreen agentId="qa-agent" view="activity" />} />);
    expect(await screen.findByRole('heading', { name: 'Recent activity', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Read selected page')).toBeInTheDocument();
    expect(screen.queryByText('QA_WORK_PRIVATE')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
  });
  it('passes the current agent explicitly when creating a separate provider connection', async () => {
    api.read.mockResolvedValue(dashboard({ connections: [] }));
    const created = { ...dashboard().connections[0], id: 'new-bound', agentId: 'qa-agent', lifecycle: 'pending' };
    api.enroll.mockResolvedValue(dashboard({ connections: [created] }));
    api.setup.mockResolvedValue({ flowId: 'bound-flow', status: 'pending', expiresAt: Date.now() + 60_000 });
    render(list('qa-agent')); await screen.findByRole('button', { name: 'Add connection', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add connection', exact: true }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Add connection: QA Service/ })); });
    expect(api.enroll).toHaveBeenCalledExactlyOnceWith('work', 'qa', 'QA Service', 'qa-agent');
    expect(api.setup).toHaveBeenCalledWith('work', 'new-bound');
    expect(api.grant).not.toHaveBeenCalled();
  });
  it('locks the access review to the selected agent, even when the dashboard includes another agent', async () => {
    api.read.mockResolvedValue(scoped()); api.grant.mockResolvedValue(scoped());
    api.resources.mockResolvedValue({ resources: [{ id: 'qa-resource', label: 'Selected QA page', toolIds: ['qa.read'], destinationIds: ['qa-private'] }] });
    render(<App view={() => <ConnectionDetailPage connectionId="qa-connection" agentId="qa-agent" />} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose access', exact: true }));
    const sheet = await screen.findByRole('dialog', { name: 'Review access' }); await within(sheet).findByText('Selected QA page');
    const fixed = within(sheet).getByRole('button', { name: 'Agent: QA Agent' }); expect(fixed).toBeDisabled(); fireEvent.click(fixed);
    expect(screen.queryByRole('radio', { name: 'Other Agent' })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /Selected QA page/ }));
    fireEvent.click(await within(sheet).findByRole('checkbox', { name: /Read selected page/ }));
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Allow access' })); });
    expect(api.grant).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: 'qa-agent', connectionId: 'qa-connection' }));
  });
  it('does not expose an unbound global connection through an agent detail URL', async () => {
    api.read.mockResolvedValue(dashboard());
    render(<App view={() => <ConnectionDetailPage connectionId="qa-connection" agentId="qa-agent" />} />);
    expect(await screen.findByText('This connection isn’t in this space')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });
});
