import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type RelationshipView } from '../_lib/client';
import { RelationshipPanel } from './RelationshipPanel';

vi.mock('../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../_lib/client')>();
  return { ...actual, api: { ...actual.api, relationship: vi.fn(), updateRelationship: vi.fn() } };
});
vi.mock('./StudioApp', () => ({ errorMessage: (e: unknown) => e instanceof Error ? e.message : 'Something went wrong' }));

const current: RelationshipView = {
  available: true, mode: 'live', disabled: false, timeZone: 'Europe/Tallinn',
  quietHours: { start: 22, end: 8 }, preferences: [{ key: 'brevity', value: 'Prefers concise replies' }],
  openSituations: 1, pending: 0, unanswered: 0,
};
const response = (relationship: RelationshipView) => ({ relationship });

beforeEach(() => { vi.mocked(api.relationship).mockResolvedValue(response(current)); vi.mocked(api.updateRelationship).mockResolvedValue(response(current)); });
afterEach(() => vi.clearAllMocks());

describe('RelationshipPanel', () => {
  it('saves the selected time zone and quiet hours only when asked', async () => {
    await act(async () => { render(<RelationshipPanel agentId="nova" name="Nova" />); });
    expect(screen.getByText('Prefers concise replies')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Your time zone'), { target: { value: 'America/Toronto' } });
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '21:00' } });
    expect(api.updateRelationship).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save quiet hours' })); });
    expect(api.updateRelationship).toHaveBeenCalledWith('nova', { action: 'configure', timeZone: 'America/Toronto', quietHours: { start: 21, end: 8 } });
  });

  it('pauses for seven days and resumes using explicit relationship actions', async () => {
    await act(async () => { render(<RelationshipPanel agentId="nova" name="Nova" />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause for 7 days' })); });
    expect(api.updateRelationship).toHaveBeenCalledWith('nova', expect.objectContaining({ action: 'pause', until: expect.any(String) }));
    vi.mocked(api.relationship).mockResolvedValueOnce(response({ ...current, disabled: true }));
    await act(async () => { render(<RelationshipPanel agentId="paused" name="Nova" />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume follow-ups' })); });
    expect(api.updateRelationship).toHaveBeenLastCalledWith('paused', { action: 'resume' });
  });

  it('requires an in-page confirmation before clearing working context and shows API errors', async () => {
    await act(async () => { render(<RelationshipPanel agentId="nova" name="Nova" />); });
    fireEvent.click(screen.getByRole('button', { name: 'Reset working context' }));
    expect(api.updateRelationship).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Reset working context confirmation' })).toBeVisible();
    vi.mocked(api.updateRelationship).mockRejectedValueOnce(new Error('Could not clear context'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear context' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not clear context');
  });
});
