import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskOutcome } from './TaskOutcome';
const api = vi.hoisted(() => ({ event: vi.fn() }));
vi.mock('../_lib/learning-client', () => ({ learningApi: api }));
afterEach(() => vi.clearAllMocks());
describe('explicit optional task outcome', () => {
  it('records no text, uses stable scoped correlation and distinguishes a user report from verification', async () => {
    api.event.mockResolvedValue({ recorded: true });
    render(<TaskOutcome agentId="agent" space="work" turnId="turn" />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' })); await screen.findByText(/not been independently verified/);
    expect(api.event).toHaveBeenCalledWith({ agentId: 'agent', space: 'work', turnId: 'turn', eventId: 'task-turn', revision: 1, outcome: 'task_succeeded' });
    fireEvent.click(screen.getByRole('button', { name: 'Not sure' })); await screen.findByText(/not been independently verified/);
    expect(api.event).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2, outcome: 'task_unknown' }));
  });
  it('discards late old-space feedback and renders Persian unavailable state', async () => {
    let resolve!: (value: unknown) => void; api.event.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue({ recorded: false });
    const view = render(<TaskOutcome agentId="agent" space="work" turnId="turn" />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    view.rerender(<TaskOutcome agentId="agent" space="personal" turnId="personal-turn" locale="fa" />);
    await act(async () => { resolve({ recorded: true }); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'خیر' })); await screen.findByRole('status');
    expect(screen.getByRole('status')).toHaveTextContent('در دسترس نیست');
  });
});
