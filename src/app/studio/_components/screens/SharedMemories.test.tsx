import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedMemoriesScreen } from './SharedMemories';
const mocks = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), create: vi.fn(), revoke: vi.fn(), remove: vi.fn(), members: vi.fn(), groups: vi.fn(), agents: vi.fn(), read: vi.fn() }));
vi.mock('../../_lib/shared-client', () => ({ sharedApi: mocks }));
vi.mock('../../_lib/client', () => ({ api: mocks }));
vi.mock('../../_lib/adaptive-client', () => ({ adaptiveApi: mocks }));
const empty = { revision: 1, space: 'work', containers: [] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.list.mockResolvedValue(empty);
  mocks.members.mockResolvedValue({ people: [{ telegramId: 1, name: 'Alice', role: 'member' }, { telegramId: 2, name: 'Bob', role: 'member' }] });
  mocks.groups.mockResolvedValue({ groups: [] }); mocks.agents.mockResolvedValue({ agents: [] });
  mocks.read.mockResolvedValue({ identity: { personId: 'alice' } });
});
afterEach(cleanup);
describe('Explicit sharing controls', () => {
  it('requires a server audience preview and a separate deliberate share action', async () => {
    mocks.preview.mockResolvedValue({ previewToken: 'server-preview', recipients: [{ telegramId: 1 }, { telegramId: 2 }] });
    mocks.create.mockResolvedValue(empty);
    render(<SharedMemoriesScreen selfId={1} onBack={() => undefined} />);
    fireEvent.click(await screen.findByLabelText('Bob'));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Synthetic shared note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview exact audience' }));
    await screen.findByText('These people will be able to read this note');
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share this note' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ previewToken: 'server-preview', space: 'work', agentIds: [], text: 'Synthetic shared note' })));
  });
  it('explains deletion consequences and does not remove a participant on the first click', async () => {
    mocks.list.mockResolvedValue({ ...empty, containers: [{ id: 'c', revision: 2, kind: 'selected', status: 'active', ownerPersonId: 'alice', agents: [], memories: [], recipients: [{ telegramId: 1, personId: 'alice', active: true }, { telegramId: 2, personId: 'bob', active: true }] }] });
    render(<SharedMemoriesScreen selfId={1} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove access: Bob' }));
    expect(screen.getByText('This removes access and deletes this person’s notes from the shared container for everyone.')).toBeInTheDocument();
    expect(mocks.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('clears the previous audience and notes while switching spaces', async () => {
    mocks.list.mockResolvedValueOnce({ ...empty, containers: [{ id: 'c', revision: 2, kind: 'selected', status: 'active', ownerPersonId: 'alice', agents: [], recipients: [], memories: [{ id: 'm', text: 'WORK_SHARED_CANARY' }] }] });
    render(<SharedMemoriesScreen selfId={1} onBack={() => undefined} />);
    await screen.findByText('WORK_SHARED_CANARY');
    mocks.list.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Personal', exact: true }));
    await waitFor(() => expect(screen.queryByText('WORK_SHARED_CANARY')).not.toBeInTheDocument());
  });
});
