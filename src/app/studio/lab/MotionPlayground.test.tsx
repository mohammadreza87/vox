import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MotionPlayground } from './MotionPlayground';

describe('MotionPlayground', () => {
  it('puts every moment on a button and plays it on the stage character', async () => {
    const { container } = render(<MotionPlayground />);
    for (const kind of ['poof', 'evolve', 'born', 'retire', 'hop', 'perk', 'nod', 'wince', 'spin', 'squish', 'shy']) {
      expect(screen.getByRole('button', { name: kind })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'hop' }));
    expect(screen.getByRole('button', { name: 'hop' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: 'hop' })).toHaveAttribute('aria-pressed', 'false'));
    expect(container.querySelector('.vx-char')).toBeTruthy();
  });

  it('switches the motion tier for the whole bench', async () => {
    const { container } = render(<MotionPlayground />);
    fireEvent.click(screen.getByRole('tab', { name: 'Reduced' }));
    expect(container.querySelector('[data-motion="reduced"]')).toBeTruthy();
    expect(container.querySelector('.vx-char')?.hasAttribute('data-loop')).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Lite' }));
    expect(container.querySelector('.vx-char')?.hasAttribute('data-loop')).toBe(true);
    expect(container.querySelector('.vx-char')?.hasAttribute('data-sway')).toBe(false);
  });

  it('runs the drafting materialize through to the poof', async () => {
    render(<MotionPlayground />);
    fireEvent.click(screen.getByRole('button', { name: 'Start drafting' }));
    expect(await screen.findByText('Claude is imagining them…')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Draft arrives' })); });
    await screen.findByText('Draft ready');
  });
});
