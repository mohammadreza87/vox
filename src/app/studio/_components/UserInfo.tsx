'use client';

import { useEffect, useState } from 'react';
import { haptic, telegramUser, type Member, type TelegramUserInfo } from '../_lib/client';
import type { Locale } from '../_lib/i18n';
import { Icon, Row } from './ui';

const COPY = {
  en: {
    account: 'Your Telegram account', username: 'Username', first: 'First name', last: 'Last name', id: 'User ID',
    copy: 'Copy', copied: 'Copied', copyId: 'Copy user ID', share: 'Share your User ID with an admin.',
    openFromTelegram: 'Open Vox Studio from Telegram to see your User ID, then share it with an admin.',
  },
  fa: {
    account: 'حساب تلگرام شما', username: 'نام کاربری', first: 'نام', last: 'نام خانوادگی', id: 'شناسهٔ کاربری',
    copy: 'کپی', copied: 'کپی شد', copyId: 'کپی شناسهٔ کاربری', share: 'شناسهٔ کاربری خود را با یک مدیر به اشتراک بگذارید.',
    openFromTelegram: 'Vox Studio را از تلگرام باز کنید تا شناسهٔ کاربری خود را ببینید، سپس آن را با یک مدیر به اشتراک بگذارید.',
  },
} as const;

/**
 * Who you are on Telegram: username, first and last name, and the numeric user
 * id (what STUDIO_SUPERADMIN_IDS and access lists need). Reads Telegram's own
 * user data, so it works even before the server is configured. Handles and the
 * id stay left-to-right inside a Persian row (they are copied verbatim).
 */
export function UserInfo({ member, locale = 'en' }: { member?: Member; locale?: Locale }) {
  const c = COPY[locale];
  const [tgUser, setTgUser] = useState<TelegramUserInfo | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setTgUser(telegramUser()); }, []);
  const id = tgUser?.id ?? member?.telegramId;
  const username = tgUser?.username ?? member?.username;
  const first = tgUser?.first_name ?? member?.name;
  const last = tgUser ? tgUser.last_name : undefined;

  if (!id) return <p className="vx-section-foot vx-userinfo-empty">{c.openFromTelegram}</p>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(id));
      haptic.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the id is still visible */ }
  };

  return (
    <div className="vx-userinfo">
      <div className="vx-group" role="group" aria-label={c.account}>
        <Row title={c.username} plain value={username ? <bdi dir="ltr">@{username}</bdi> : '—'} />
        <Row title={c.first} plain value={first || '—'} />
        <Row title={c.last} plain value={last || '—'} />
        <Row title={c.id} plain value={<bdi dir="ltr" className="vx-num vx-userinfo-id">{id}</bdi>}
          end={(
            <button type="button" className="vx-btn vx-btn-xs" onClick={copy} aria-label={c.copyId}>
              {copied ? <><Icon name="check" size={14} width={2.5} />{c.copied}</> : c.copy}
            </button>
          )} />
      </div>
      <p className="vx-section-foot">{c.share}</p>
    </div>
  );
}
