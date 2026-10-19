import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperienceScreen } from './Experience';
import { emptyExperience } from '@/lib/adaptive/runtime/contracts';
const mocks = vi.hoisted(() => ({ read: vi.fn(), preference: vi.fn(), settings: vi.fn(), reminder: vi.fn(), feedback: vi.fn(), agents: vi.fn() }));
vi.mock('../../_lib/experience-client', () => ({ experienceApi: mocks }));
vi.mock('../../_lib/client', () => ({ api: mocks }));
const snapshot = () => ({ schemaVersion: 1, revision: 2, space: 'work', confirmed: true, settings: emptyExperience().settings,
  preferences: [], inbox: [], observations: { available: false, total: 0 },
  capabilities: { personalization: false, productAnalytics: false, proactiveInbox: false, reminders: false, decisions: false } });
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(snapshot()); mocks.agents.mockResolvedValue({ agents: [{ id: 'agent', status: 'active', persona: { name: 'Synthetic agent' } }] }); });
afterEach(cleanup);
describe('Experience controls', () => {
  it('keeps category switches disabled without effective permissions and does not implicitly opt in', async () => {
    render(<ExperienceScreen onBack={() => undefined} />);
    expect(await screen.findByLabelText('Helpful suggestions')).toBeDisabled();
    expect(screen.getByLabelText('Requested reminders')).toBeDisabled();
    expect(screen.getByLabelText('Enable inbox')).not.toBeChecked();
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.preference).not.toHaveBeenCalled();
  });
  it('sends an explicit reset in the current space only and reports server failure honestly', async () => {
    mocks.preference.mockRejectedValue(new Error('conflict'));
    render(<ExperienceScreen onBack={() => undefined} />);
    fireEvent.change(await screen.findByLabelText('Agent'), { target: { value: 'agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true }));
    await screen.findByRole('alert');
    expect(mocks.preference).toHaveBeenCalledWith(expect.objectContaining({ action: 'reset', agentId: 'agent', space: 'work', expectedRevision: 2 }));
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });
  it('shows the default reply length after the server confirms an explicit reset', async () => {
    mocks.read.mockResolvedValue({ ...snapshot(), preferences: [{ agentId: 'agent', setting: { key: 'response_length', value: 'brief' }, status: 'active' }] });
    mocks.preference.mockResolvedValue(snapshot());
    render(<ExperienceScreen onBack={() => undefined} />);
    fireEvent.change(await screen.findByLabelText('Agent'), { target: { value: 'agent' } });
    expect(screen.getByLabelText('Reply length')).toHaveValue('brief');
    fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true }));
    await screen.findByText('Saved.');
    expect(screen.getByLabelText('Reply length')).toHaveValue('balanced');
  });
  it('clears private reminder text during a space change and renders Persian RTL', async () => {
    mocks.read.mockResolvedValueOnce({ ...snapshot(), inbox: [{ id: 'i', kind: 'requested_reminder', label: 'WORK_REMINDER_CANARY' }] });
    const { container } = render(<ExperienceScreen onBack={() => undefined} />);
    await screen.findByText('WORK_REMINDER_CANARY');
    fireEvent.click(screen.getByRole('button', { name: 'فارسی' }));
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    mocks.read.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'شخصی', exact: true }));
    await waitFor(() => expect(screen.queryByText('WORK_REMINDER_CANARY')).not.toBeInTheDocument());
  });
});
