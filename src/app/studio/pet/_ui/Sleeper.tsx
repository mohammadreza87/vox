'use client';

import { useEffect } from 'react';
import { PRESET_LOOKS } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/pet/types';
import { CharacterView } from '../../_components/character/CharacterView';
import { COPY } from './copy';
import { backdrop } from './scene';
import { readyAfterPaint } from './telegram';
import './sleeper.css';

export type SleeperKind = 'private' | 'outside' | 'resting' | 'offline';

const TEXT: Record<SleeperKind, { title: string; body: string }> = {
  private: { title: COPY.privateTitle, body: COPY.privateBody },
  outside: { title: COPY.outsideTitle, body: COPY.outsideBody },
  resting: { title: COPY.restingTitle, body: COPY.restingBody },
  offline: { title: COPY.offlineTitle, body: COPY.offlineBody },
};

/** When the server sent no look (outside Telegram, offline): the reference cloud. */
const FALLBACK_LOOK: CharacterLook = PRESET_LOOKS[0];

/**
 * The quiet screens (§3.6): "This one's private" (403, the character drawn asleep from the 403 body),
 * outside Telegram, an agent that is resting, and offline with a retry. A still character with a CSS
 * sleep breath only: no engine, no rAF. Loaded on demand (with its CSS) by PetApp; it hands Telegram's
 * loading screen over (ready()) once it has painted.
 */
export function Sleeper({ kind, look, stage = 3, name, onRetry }: { kind: SleeperKind; look?: CharacterLook; stage?: Stage; name?: string; onRetry?: () => void }) {
  const l = look ?? FALLBACK_LOOK;
  const bd = backdrop(l);
  const t = TEXT[kind];
  useEffect(() => readyAfterPaint(), []);
  return (
    <main className="pet-root pet-sleeper" data-pet-root="" style={{ backgroundImage: bd.image, backgroundColor: bd.edge }}>
      <div className="pet-sleeper-char">
        <div className="pet-breathe" data-asleep="">
          <CharacterView look={l} stage={stage} expr="sleeping" size={180} lod="hero" label={name ?? 'Agent'} />
        </div>
        <span className="pet-zz" aria-hidden="true">z</span>
      </div>
      <h1 className="pet-sleeper-title">{t.title}</h1>
      <p className="pet-sleeper-body">{t.body}</p>
      {onRetry && <button type="button" className="pet-pill pet-pill-dm pet-retry" onClick={onRetry}>{COPY.retry}</button>}
    </main>
  );
}
