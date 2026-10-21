import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { SharedMemoriesScreen as Screen } from './SharedMemories';
import { ConfirmProvider } from '../ui';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
const mocks = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), create: vi.fn(), revoke: vi.fn(), remove: vi.fn(), members: vi.fn(), groups: vi.fn(), agents: vi.fn(), read: vi.fn(), snack: vi.fn() }));
vi.mock('../../_lib/shared-client', () => ({ sharedApi: mocks }));
vi.mock('../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../_lib/client')>(), tg: () => null, api: mocks }));
vi.mock('../../_lib/adaptive-client', () => ({ adaptiveApi: mocks }));
vi.mock('../Cloud', () => ({ AgentFace: () => null, Cloud: () => null }));
const nav = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../StudioApp', () => ({ useNav: () => nav.current }));
/** App-level locale and space, as StudioApp provides them. */
function SharedMemoriesScreen(props: Parameters<typeof Screen>[0]) {
  const [space, setSpace] = useState<'work' | 'personal'>('work');
  nav.current = { locale: 'en', dir: 'ltr', setLocale: vi.fn(), space, setSpace, snack: mocks.snack, toast: vi.fn(), push: vi.fn(), back: vi.fn(), tier: 'full', cache: new Map() };
  return <ConfirmProvider><Screen {...props} /></ConfirmProvider>;
}
const empty = { revision: 1, space: 'work', containers: [] };
const container = (memories: unknown[] = []) => ({ id: 'c', revision: 2, kind: 'selected', status: 'active', ownerPersonId: 'alice', agents: [], memories,
  recipients: [{ telegramId: 1, personId: 'alice', active: true }, { telegramId: 2, personId: 'bob', active: true }] });
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset(); mocks.list.mockResolvedValue(empty);
  mocks.members.mockResolvedValue({ people: [{ telegramId: 1, name: 'Alice', role: 'member' }, { telegramId: 2, name: 'Bob', role: 'member' }] });
  mocks.groups.mockResolvedValue({ groups: [] }); mocks.agents.mockResolvedValue({ agents: [] });
  mocks.read.mockResolvedValue({ identity: { personId: 'alice' } });
});
afterEach(cleanup);
describe('Explicit sharing controls', () => {
  it('requires a server audience preview and a separate deliberate share action, in three steps', async () => {
    mocks.preview.mockResolvedValue({ previewToken: 'server-preview', recipients: [{ telegramId: 1 }, { telegramId: 2 }] });
    mocks.create.mockResolvedValue(empty);
    const view = render(<SharedMemoriesScreen selfId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New shared note' }));
    const sheet = await screen.findByRole('dialog', { name: 'A new shared note' });
    expect(within(sheet).getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Bob' }));
    expectOneVolt(view.container); expectNoRawControls(view.container);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Next' }));
    expect(await within(sheet).findByText('Which agents may use it')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Next' }));
    fireEvent.change(within(sheet).getByLabelText('Note'), { target: { value: 'Synthetic shared note' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Preview exact audience' })); });
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ space: 'work', kind: 'selected', recipientTelegramIds: [1, 2] }));
    expect(within(sheet).getByRole('group', { name: 'These people will be able to read this note' })).toHaveTextContent('Bob');
    expect(mocks.create).not.toHaveBeenCalled();
    expectOneVolt(view.container);
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Share with 2 people' })); });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ previewToken: 'server-preview', space: 'work', agentIds: [], text: 'Synthetic shared note' })));
  });
  it('drops a preview the moment its note changes', async () => {
    mocks.preview.mockResolvedValue({ previewToken: 'server-preview', recipients: [{ telegramId: 1 }, { telegramId: 2 }] });
    render(<SharedMemoriesScreen selfId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New shared note' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'First' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview exact audience' })); });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'First, edited' } });
    expect(screen.queryByRole('button', { name: /Share with/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview exact audience' })).toBeEnabled();
  });
  it('explains removal consequences and does not remove a participant without confirmation', async () => {
    mocks.list.mockResolvedValue({ ...empty, containers: [container()] });
    mocks.revoke.mockResolvedValue(empty);
    render(<SharedMemoriesScreen selfId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sharing options' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove access: Bob' }));
    expect(await screen.findByText('This removes access and deletes this person’s notes from the shared container for everyone.')).toBeInTheDocument();
    expect(mocks.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.revoke).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove access: Bob' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Bob?' });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove access' })); });
    expect(mocks.revoke).toHaveBeenCalledWith('c', 2, expect.objectContaining({ space: 'work', expectedRevision: 2 }));
  });
  it('deletes a note only after confirmation, from the note’s sheet', async () => {
    mocks.list.mockResolvedValue({ ...empty, containers: [container([{ id: 'm', revision: 1, text: 'NOTE_CANARY', authorPersonId: 'alice', createdAt: 1, expiresAt: 2 }])] });
    mocks.remove.mockResolvedValue(empty);
    render(<SharedMemoriesScreen selfId={1} />);
    fireEvent.click(await screen.findByText('NOTE_CANARY'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this shared note?' });
    expect(mocks.remove).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete note' })); });
    expect(mocks.remove).toHaveBeenCalledWith('c', 'm', expect.objectContaining({ space: 'work', expectedRevision: 2 }));
  });
  it('clears the previous audience and notes while switching spaces', async () => {
    mocks.list.mockResolvedValueOnce({ ...empty, containers: [{ ...container([{ id: 'm', text: 'WORK_SHARED_CANARY', authorPersonId: 'bob', createdAt: 1, expiresAt: 2 }]), recipients: [] }] });
    render(<SharedMemoriesScreen selfId={1} />);
    await screen.findByText('WORK_SHARED_CANARY');
    mocks.list.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('tab', { name: 'Personal', exact: true }));
    await waitFor(() => expect(screen.queryByText('WORK_SHARED_CANARY')).not.toBeInTheDocument());
    expect(mocks.list).toHaveBeenLastCalledWith('personal');
  });
});
