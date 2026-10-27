import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CharacterGallery } from './CharacterGallery';

describe('CharacterGallery (lab)', () => {
  it('greys out incompatible options with the reason and switches sheets', () => {
    render(<CharacterGallery />);
    const hair = within(screen.getByRole('group', { name: 'Hair' }));
    const species = within(screen.getByRole('group', { name: 'Species' }));
    const sheets = within(screen.getByRole('group', { name: 'Sheets' }));
    // with curls on, a chick (whose sprout is its hair) is greyed until the hair goes
    fireEvent.click(hair.getByRole('button', { name: 'curls' }));
    expect(species.getByRole('button', { name: 'chick' })).toBeDisabled();
    fireEvent.click(hair.getByRole('button', { name: 'none' }));
    fireEvent.click(species.getByRole('button', { name: 'chick' }));
    const tuft = hair.getByRole('button', { name: 'tuft' });
    expect(tuft).toBeDisabled();
    expect(tuft).toHaveAttribute('title', expect.stringContaining('sprout'));
    fireEvent.click(sheets.getByRole('button', { name: 'stages' }));
    expect(screen.getAllByRole('img', { name: /stage|·/ }).length).toBeGreaterThan(0);
    fireEvent.click(sheets.getByRole('button', { name: 'small' }));
    expect(screen.getAllByRole('img', { name: /Preset 1, idle/ }).length).toBe(4);
  });
});
