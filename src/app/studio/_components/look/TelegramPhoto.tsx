'use client';

import { useMemo } from 'react';
import { characterSvg } from '@/lib/studio/character';
import type { Stage } from '@/lib/studio/types';
import { mediaUrl, type AgentView } from '../../_lib/client';
import { Icon } from '../ui';
import { useSyncState, type SyncState } from './syncState';

/** The bot photo never shows a mouthless wisp: the character render starts at stage 2 (PLAN D8). */
export const telegramStage = (agent: AgentView): Stage => Math.max(agent.stage ?? 4, 2) as Stage;

/** What Telegram shows as the bot photo: the chosen picture, or the character on its halo. Circle crop, like Telegram. */
export function telegramPhotoSrc(agent: AgentView, size: number): string {
  if (agent.look.avatar) return mediaUrl(agent.look.avatar);
  const px = Math.max(96, Math.round(size * 2));
  return `data:image/svg+xml;utf8,${encodeURIComponent(characterSvg(agent.look, { stage: telegramStage(agent), size: px, bg: 'halo', fit: 'circle' }))}`;
}

/**
 * The Telegram bot photo. With `ring`, it wears the sync ring (motion §4.11):
 * a volt arc turns while Telegram updates, closes to a full ring with a check
 * when it lands, turns red with a "!" on failure, and a warn dot marks a photo
 * drawn from an older look.
 */
export function TelegramPhoto({ agent, size, ring }: { agent: AgentView; size: number; ring?: boolean }) {
  const look = agent.look;
  const stage = telegramStage(agent);
  // The SVG string is the expensive part; rebuild it only when the picture can change.
  const src = useMemo(() => telegramPhotoSrc(agent, size),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [look.avatar, look.hue, look.family, look.features.cheeks, look.features.lashes, look.features.brows, look.species, look.hair, look.hairTone, look.accessory, look.accent, stage, size]);
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`${agent.persona.name} in Telegram`} width={size} height={size} draggable={false} className="vx-tgphoto-img" />
  );
  if (!ring) return <span className="vx-tgphoto" style={{ width: size, height: size }}>{img}</span>;
  return <RingedPhoto agent={agent} size={size}>{img}</RingedPhoto>;
}

function RingedPhoto({ agent, size, children }: { agent: AgentView; size: number; children: React.ReactNode }) {
  const state = useSyncState(agent);
  return (
    <span className="vx-tgphoto" data-sync={state} style={{ width: size, height: size }}>
      {children}
      <SyncRing state={state} size={size} />
      <SyncBadge state={state} size={size} />
    </span>
  );
}

/** Ring 3 px outside the photo; viewBox units = px so the stroke stays crisp at every size. */
function SyncRing({ state, size }: { state: SyncState; size: number }) {
  // A name-only failure leaves the photo itself fine in Telegram: no red ring for it.
  if (state !== 'syncing' && state !== 'synced' && state !== 'error-photo') return null;
  const box = size + 10;
  const r = size / 2 + 3;
  return (
    <svg className="vx-sync-ring" width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
      <circle cx={box / 2} cy={box / 2} r={r} pathLength={1} className="vx-sync-arc" />
    </svg>
  );
}

function SyncBadge({ state, size }: { state: SyncState; size: number }) {
  const d = Math.max(12, Math.round(size * 0.36));
  if (state === 'synced') return <span key="ok" className="vx-sync-badge ok" style={{ width: d, height: d }}><Icon name="check" size={d * 0.62} width={3} /></span>;
  if (state === 'error-photo') return <span key="err" className="vx-sync-badge err" style={{ width: d, height: d, fontSize: d * 0.7 }}>!</span>;
  if (state === 'outdated') return <span key="old" className="vx-sync-badge old" style={{ width: Math.max(8, d * 0.6), height: Math.max(8, d * 0.6) }} />;
  return null;
}
