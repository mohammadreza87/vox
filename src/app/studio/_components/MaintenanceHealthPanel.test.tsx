import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MaintenanceHealth } from '@/lib/adaptive/lifecycle/maintenance-health-contracts';
import { MaintenanceHealthPanel } from './MaintenanceHealthPanel';

const observedAt = 10000;
function health(state: MaintenanceHealth['state']): MaintenanceHealth {
  if (state === 'not_configured') return { version: 1, state, observedAt: null, checkpoint: null, leaseExpiresAt: null, reason: 'health_not_configured' };
  if (state === 'not_started' || state === 'busy' || state === 'unavailable') return {
    version: 1, state, observedAt, checkpoint: null, leaseExpiresAt: null,
    reason: state === 'busy' ? 'checkpoint_locked' : state === 'unavailable' ? 'unsupported_store' : null,
  };
  const recordedStatus = state === 'leased' || state === 'stale' ? 'failed' : state;
  return { version: 1, state, observedAt, leaseExpiresAt: state === 'leased' ? 11000 : state === 'stale' ? 9000 : null, reason: state === 'stale' ? 'lease_expired' : null,
    checkpoint: { updatedAt: 8000, recordedStatus, checkpointedPages: 3, checkpointedAccounts: 5, failure: recordedStatus === 'failed' ? 'sweep_failed' : null } };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([
  ['not_started', 'No run recorded'], ['leased', 'Worker lease recorded'], ['continued', 'More pages remain'],
  ['completed', 'Pass recorded complete'], ['failed', 'Failure recorded'], ['busy', 'Status temporarily busy'],
  ['stale', 'Recorded lease expired'], ['unavailable', 'Unavailable'], ['not_configured', 'Unavailable'],
] as const)('renders the %s snapshot without inferring a different worker state', (state, copy) => {
  const { container } = render(<MaintenanceHealthPanel health={health(state)} locale="en" />);
  expect(screen.getByRole('status')).toHaveTextContent(copy);
  expect(screen.getByText('Recorded progress is not proof of deletion or a running worker.')).toBeInTheDocument();
  expect(screen.getByText('Checkpoint counts do not measure unique people or deletions.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/unsupported_store|checkpoint_locked|lease_expired|sweep_failed|\bhealthy\b|\bETA\b|%/);
});

it('keeps a prior recorded failure and checkpoint progress visible with a held or expired lease', () => {
  const { rerender } = render(<MaintenanceHealthPanel health={health('leased')} locale="en" />);
  expect(screen.getByRole('status')).toHaveTextContent('Worker lease recorded');
  expect(screen.getByText('Last recorded result').nextElementSibling).toHaveTextContent('Failure recorded');
  expect(screen.getByText('A maintenance failure was recorded.')).toBeInTheDocument();
  expect(screen.getByText('Pages in recorded progress').nextElementSibling).toHaveTextContent('3');
  expect(screen.getByText('Accounts in recorded progress').nextElementSibling).toHaveTextContent('5');
  expect(screen.getByText('Status as of').nextElementSibling?.querySelector('time')).toHaveAttribute('dateTime', new Date(observedAt).toISOString());
  expect(screen.getByText('Last recorded activity').nextElementSibling?.querySelector('time')).toHaveAttribute('dateTime', new Date(8000).toISOString());
  rerender(<MaintenanceHealthPanel health={health('stale')} locale="en" />);
  expect(screen.getByRole('status')).toHaveTextContent('Recorded lease expired');
  expect(screen.getByText('A maintenance failure was recorded.')).toBeInTheDocument();
});

it('uses the server snapshot as of its recorded time even when the browser clock passes lease expiry', () => {
  vi.useFakeTimers(); vi.setSystemTime(12000);
  const { rerender } = render(<MaintenanceHealthPanel health={health('leased')} locale="en" />);
  vi.advanceTimersByTime(60000);
  rerender(<MaintenanceHealthPanel health={health('leased')} locale="fa" />);
  expect(screen.getByRole('status')).toHaveTextContent('مجوز موقت کار ثبت شده است');
  expect(screen.queryByText('انقضای مجوز موقت ثبت شده است')).not.toBeInTheDocument();
});

it('distinguishes confirmed missing activity from unobserved history and never supplies zero checkpoint counts', () => {
  const { rerender } = render(<MaintenanceHealthPanel health={health('not_configured')} locale="en" />);
  expect(screen.getByText('Status observation is not configured.')).toBeInTheDocument();
  expect(screen.queryByText('No run recorded')).not.toBeInTheDocument();
  for (const state of ['not_configured', 'not_started', 'busy', 'unavailable'] as const) {
    rerender(<MaintenanceHealthPanel health={health(state)} locale="en" />);
    expect(screen.getByText('Pages in recorded progress').nextElementSibling).toHaveTextContent('Unavailable');
    expect(screen.getByText('Accounts in recorded progress').nextElementSibling).toHaveTextContent('Unavailable');
  }
});

it.each([undefined, { ...health('completed'), state: 'healthy' }, { ...health('leased'), reason: 'PRIVATE_REASON_ACCOUNT_CURSOR' }, { ...health('completed'), checkpoint: { ...health('completed').checkpoint, accountId: 'PRIVATE_ACCOUNT' } }])('renders malformed or legacy health as unavailable without raw diagnostics', value => {
  const { container } = render(<MaintenanceHealthPanel health={value} locale="en" />);
  expect(screen.getByRole('status')).toHaveTextContent('Unavailable');
  expect(screen.getByText('Pages in recorded progress').nextElementSibling).toHaveTextContent('Unavailable');
  expect(container.textContent).not.toMatch(/PRIVATE_|healthy|Pass recorded complete|Worker lease recorded/);
});

it('renders Persian semantics, RTL and localized checkpoint numbers without exposing fixed diagnostic codes', () => {
  const { container } = render(<MaintenanceHealthPanel health={health('leased')} locale="fa" />);
  const panel = screen.getByRole('region', { name: 'وضعیت نگهداری' });
  expect(panel).toHaveAttribute('dir', 'rtl'); expect(panel).toHaveAttribute('lang', 'fa');
  expect(within(panel).getByText('وضعیت در زمان')).toBeInTheDocument();
  expect(within(panel).getByText('صفحه‌ها در پیشرفت ثبت‌شده').nextElementSibling).toHaveTextContent('۳');
  expect(within(panel).getByText('حساب‌ها در پیشرفت ثبت‌شده').nextElementSibling).toHaveTextContent('۵');
  expect(within(panel).getByText('یک خطای نگهداری ثبت شده است.')).toBeInTheDocument();
  expect(within(panel).getByText('این شمارنده‌های پیشرفت، تعداد افراد یکتا یا حذف داده‌ها را نشان نمی‌دهند.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/sweep_failed|checkpointed|accountId|cursor|workerId/);
});
