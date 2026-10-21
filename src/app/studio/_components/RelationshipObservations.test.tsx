import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RelationshipObservations } from './RelationshipObservations';

const mocks = vi.hoisted(() => ({ relationshipObservations: vi.fn() }));
vi.mock('../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../_lib/client')>(), api: mocks }));
vi.mock('./StudioApp', () => ({ errorMessage: (e: unknown) => e instanceof Error ? e.message : 'error' }));
beforeEach(() => { mocks.relationshipObservations.mockReset(); });
afterEach(cleanup);

it('shows content-free counts as stats with the pilot mode, and refreshes on demand', async () => {
  mocks.relationshipObservations.mockResolvedValue({ mode: 'live', sampledEvents: 12, counts: { turn: 9, sent: 3 }, feedbackOutcomes: { helpful: 2 }, windowStart: null, windowEnd: null, scope: 'org' });
  render(<RelationshipObservations />);
  expect((await screen.findByText('Interactions observed')).nextElementSibling).toHaveTextContent('9');
  expect(screen.getByText('Check-ins delivered').nextElementSibling).toHaveTextContent('3');
  expect(screen.getByText('Helpful check-ins').nextElementSibling).toHaveTextContent('2');
  expect(screen.getByText('Pilot active')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh conversation activity' })); });
  expect(mocks.relationshipObservations).toHaveBeenCalledTimes(2);
});

it('says when nothing is recorded yet and surfaces a load failure', async () => {
  mocks.relationshipObservations.mockResolvedValueOnce({ mode: 'off', sampledEvents: 0, counts: {}, windowStart: null, windowEnd: null, scope: 'org' }).mockRejectedValueOnce(new Error('Activity unavailable'));
  render(<RelationshipObservations />);
  expect(await screen.findByText('No activity recorded yet.')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh conversation activity' })); });
  expect(screen.getByRole('alert')).toHaveTextContent('Activity unavailable');
});
