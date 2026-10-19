'use client';

import { useState } from 'react';
import { haptic, telegramUser, type Member } from '../_lib/client';
import { Icon } from './ui';

/**
 * Who you are on Telegram: username, first and last name, and the numeric user
 * id (what STUDIO_SUPERADMIN_IDS and access lists need). Reads Telegram's own
 * user data, so it works even before the server is configured.
 */
export function UserInfo({ member }: { member?: Member }) {
  const tgUser = telegramUser();
  const [copied, setCopied] = useState(false);
  const id = tgUser?.id ?? member?.telegramId;
  const username = tgUser?.username ?? member?.username;
  const first = tgUser?.first_name ?? member?.name;
  const last = tgUser ? tgUser.last_name : undefined;

  if (!id) {
    return <p className="vx-small vx-2" style={{ margin: 0 }}>Open Vox Studio from @VoxxBot in Telegram to see your account.</p>;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(id));
      haptic.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the id is still visible */ }
  };

  const rows: Array<[string, string]> = [
    ['Username', username ? `@${username}` : '—'],
    ['First name', first || '—'],
    ['Last name', last || '—'],
  ];

  return (
    <div className="vx-group" style={{ width: '100%', textAlign: 'left' }} aria-label="Your Telegram account">
      {rows.map(([label, value]) => (
        <div key={label} className="vx-row" style={{ minHeight: 48 }}>
          <span className="vx-small vx-2" style={{ width: 92, flexShrink: 0 }}>{label}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        </div>
      ))}
      <div className="vx-row" style={{ minHeight: 48 }}>
        <span className="vx-small vx-2" style={{ width: 92, flexShrink: 0 }}>User ID</span>
        <span className="vx-num" style={{ flex: 1, fontWeight: 600 }}>{id}</span>
        <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={copy} aria-label="Copy user ID" style={{ height: 32, padding: '0 12px' }}>
          {copied ? <><Icon name="check" size={16} width={2.5} />Copied</> : 'Copy'}
        </button>
      </div>
    </div>
  );
}
