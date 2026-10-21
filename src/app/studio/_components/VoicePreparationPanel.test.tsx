import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VoicePreparationPanel } from './VoicePreparationPanel';
afterEach(cleanup);
it('shows unavailable and never offers opt-in without verified server capability', () => {
  const change = vi.fn(); render(<VoicePreparationPanel enabled={false} onChange={change} />);
  expect(screen.getByRole('switch')).toBeDisabled(); expect(screen.getByRole('switch')).not.toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('unverified'); expect(change).not.toHaveBeenCalled();
});
it.each(['en', 'fa'] as const)('shows explicit off-default disclosure and a reversible control in %s', locale => {
  const change = vi.fn(); render(<VoicePreparationPanel capability={{ available: true, configurationVersion: 'synthetic-v1' }} enabled={false} onChange={change} locale={locale} />);
  const checkbox = screen.getByRole('switch'); expect(checkbox).not.toBeChecked(); expect(checkbox).toBeEnabled();
  expect(checkbox.closest('section')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
  fireEvent.click(checkbox); expect(change).toHaveBeenCalledWith(true);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
