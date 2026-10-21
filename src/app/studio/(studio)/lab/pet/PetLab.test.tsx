import { fireEvent, render, screen, within } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import type { PetEngine } from '../../../pet/_ui/contract';
import { SAMPLE_EVENTS } from './events';

const engine = {
  rig: {}, body: {}, dim: motionValue(0), glow: motionValue(0),
  setLook: vi.fn(), setSize: vi.fn(), setTier: vi.fn(), setMood: vi.fn(), setScene: vi.fn(), pointer: vi.fn(() => false), accel: vi.fn(),
  toy: vi.fn(), talk: vi.fn(), micLevel: vi.fn(), speakText: vi.fn(), speakAudio: vi.fn(), stopSpeaking: vi.fn(), fire: vi.fn(),
  attach: vi.fn(() => () => {}), start: vi.fn(), stop: vi.fn(), dispose: vi.fn(),
} satisfies PetEngine;
vi.mock('../../../pet/_engine/loop', () => ({ createPetEngine: () => engine }));

const { PetLab } = await import('./PetLab');

describe('PetLab', () => {
  it('fires any reaction, switches tier and look, and maps the hour to quiet-hours sleep', () => {
    render(<PetLab />);
    const reactions = screen.getByRole('group', { name: 'Reactions' });
    expect(within(reactions).getAllByRole('button')).toHaveLength(Object.keys(SAMPLE_EVENTS).length);
    fireEvent.click(within(reactions).getByRole('button', { name: 'tickle' }));
    expect(engine.fire).toHaveBeenLastCalledWith({ type: 'tickle' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Tier' })).getByRole('button', { name: 'lite' }));
    expect(engine.setTier).toHaveBeenLastCalledWith('lite');
    fireEvent.click(within(screen.getByRole('group', { name: 'Look' })).getAllByRole('button')[3]);
    expect(engine.setLook).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByRole('slider', { name: 'Time of day' }), { target: { value: '23' } });
    expect(engine.setMood).toHaveBeenLastCalledWith(expect.objectContaining({ asleep: true }));
    fireEvent.change(screen.getByRole('slider', { name: 'Tummy' }), { target: { value: '30' } });
    expect(engine.setMood).toHaveBeenLastCalledWith(expect.objectContaining({ lowest: 'tummy', level: 'wants' }));
  });
});
