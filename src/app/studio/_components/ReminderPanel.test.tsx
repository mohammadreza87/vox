import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderPanel } from './ReminderPanel';
import { emptyExperience, type ExperienceSnapshot } from '@/lib/adaptive/runtime/contracts';
const mocks = vi.hoisted(() => ({ reminder: vi.fn(), reminderChannelPresent: vi.fn(), reminderChannel: vi.fn(), reminderAction: vi.fn() }));
vi.mock('../_lib/experience-client', () => ({ experienceApi: mocks }));
const data = () => ({ schemaVersion: 1, revision: 2, space: 'work', confirmed: true, settings: emptyExperience().settings, preferences: [], inbox: [], reminders: [], observations: { available: false, total: 0 }, reminderTelegram: { available: true, connected: true, enabled: false }, capabilities: { personalization: false, productAnalytics: false, proactiveInbox: false, reminders: true, decisions: false } } as unknown as ExperienceSnapshot);
const mutate = async (action: () => Promise<ExperienceSnapshot>) => { await action(); };
beforeEach(() => { vi.resetAllMocks(); for (const fn of Object.values(mocks)) fn.mockResolvedValue(data()); });
afterEach(cleanup);
describe('ordinary reminder controls', () => {
  it('requires a separate explicit Telegram choice and defaults exact-time override off', async () => {
    const view = render(<ReminderPanel data={data()} agentId="agent" fa={false} busy={false} mutate={mutate} />);
    expect(mocks.reminderChannel).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Review Telegram reminder choice' }));
    expect(mocks.reminderChannelPresent).toHaveBeenCalledWith(expect.objectContaining({ space: 'work', expectedRevision: 2 }));
    expect(mocks.reminderChannel).not.toHaveBeenCalled();
    const presented = data(); presented.reminderTelegram!.disclosure = { version: 'generic-reminders-30d-v1', receipt: 'server-receipt', expiresAt: Date.now() + 600000 };
    view.rerender(<ReminderPanel data={presented} agentId="agent" fa={false} busy={false} mutate={mutate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow generic alerts for up to 30 days' }));
    expect(mocks.reminderChannel).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, receipt: 'server-receipt', disclosureVersion: 'generic-reminders-30d-v1', space: 'work' }));
    fireEvent.change(screen.getByLabelText('Reminder'), { target: { value: 'PRIVATE_LABEL' } });
    fireEvent.change(screen.getByLabelText('Due time (your device local time)'), { target: { value: '2026-10-20T12:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create reminder' }));
    await waitFor(() => expect(mocks.reminder).toHaveBeenCalledWith(expect.objectContaining({ label: 'PRIVATE_LABEL', agentId: 'agent', quietHours: 'respect' })));
  });
  it('keeps unknown distinct from delivered and makes snooze and review explicit in Persian', () => {
    const snapshot = data(); snapshot.reminders = [{ id: 'opaque', label: 'یادآور خصوصی', dueAt: Date.now(), delivery: { state: 'unknown', generation: 1, channelRevision: 1, endpointId: 'endpoint', quietHours: 'respect' } } as unknown as NonNullable<ExperienceSnapshot['reminders']>[number]];
    render(<ReminderPanel data={snapshot} agentId="agent" fa busy={false} mutate={mutate} notificationId="opaque" />);
    expect(screen.getByRole('status')).toHaveTextContent('تحویل نامشخص است');
    expect(screen.getByText('یادآور خصوصی').closest('article')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'این یادآور را بررسی کردم' }));
    expect(mocks.reminderAction).toHaveBeenLastCalledWith(expect.objectContaining({ itemId: 'opaque', action: 'acknowledge_unknown', space: 'work' }));
    fireEvent.click(screen.getByRole('button', { name: 'تعویق ۱۵ دقیقه' }));
    expect(mocks.reminderAction).toHaveBeenLastCalledWith(expect.objectContaining({ itemId: 'opaque', action: 'snooze', dueAt: expect.any(Number) }));
  });
  it('blocks channel enable without a verified private endpoint and server capability', () => {
    const snapshot = data(); snapshot.reminderTelegram = { available: false, connected: false, enabled: false };
    render(<ReminderPanel data={snapshot} agentId="agent" fa={false} busy={false} mutate={mutate} />);
    expect(screen.getByRole('button', { name: 'Review Telegram reminder choice' })).toBeDisabled();
    expect(screen.getByText(/First send a private message/)).toBeInTheDocument();
  });
});
