import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../_lib/client';
import { UserInfo } from './UserInfo';

const originalTelegram = Object.getOwnPropertyDescriptor(window, 'Telegram');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalTelegram) Object.defineProperty(window, 'Telegram', originalTelegram);
  else Reflect.deleteProperty(window, 'Telegram');
});

describe('UserInfo identity display', () => {
  it('hydrates server markup before revealing the visitor supplied by the Telegram SDK', async () => {
    const browserWindow = window;
    let serverMarkup: string;
    vi.stubGlobal('window', undefined);
    try {
      serverMarkup = renderToString(<UserInfo />);
    } finally {
      vi.stubGlobal('window', browserWindow);
    }

    const visitor = { id: 7777001, first_name: 'Fixture', last_name: 'Visitor', username: 'fixture_visitor' };
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: { WebApp: { initDataUnsafe: { user: visitor } } },
    });
    const container = document.createElement('div');
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);
    expect(container.textContent).not.toContain(String(visitor.id));
    const hydrationErrors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <UserInfo />, {
          onRecoverableError: error => { hydrationErrors.push(error); },
        });
      });

      const account = within(container);
      expect(account.getByText(String(visitor.id))).toBeVisible();
      expect(account.getByText(`@${visitor.username}`)).toBeVisible();
      expect(account.getByText(/share your user id with an admin/i)).toBeVisible();
      expect(hydrationErrors).toEqual([]);
    } finally {
      if (root) await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('uses the current member when the SDK has no identity and shows no ID without either source', () => {
    Reflect.deleteProperty(window, 'Telegram');
    const member: Member = {
      telegramId: 7777002,
      name: 'Current visitor',
      role: 'pending',
      joinedAt: '2026-10-19T00:00:00.000Z',
    };
    const view = render(<UserInfo member={member} />);
    expect(within(view.container).getByText(String(member.telegramId))).toBeVisible();
    expect(within(view.container).getByText(/share your user id with an admin/i)).toBeVisible();

    view.rerender(<UserInfo />);
    expect(within(view.container).queryByText(String(member.telegramId))).not.toBeInTheDocument();
    expect(within(view.container).queryByRole('button', { name: /copy user id/i })).not.toBeInTheDocument();
    expect(within(view.container).getByText(/open vox studio from telegram/i)).toBeVisible();
  });
});
