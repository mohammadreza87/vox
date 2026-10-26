'use client';

import { useEffect } from 'react';
import { PRESET_LOOKS } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/pet/types';
import { CharacterView } from '../../_components/character/CharacterView';
import { backdrop } from './scene';
import { dir, petLang, t, useStrings, type PetStringKey } from './strings';
import { readyAfterPaint } from './telegram';
import './sleeper.css';

export type SleeperKind = 'private' | 'outside' | 'resting' | 'offline' | 'unavailable' | 'chat-access';

const TEXT: Record<SleeperKind, { title: PetStringKey; body: PetStringKey }> = {
  private: { title: 'quiet.private.title', body: 'quiet.private.body' },
  outside: { title: 'quiet.outside.title', body: 'quiet.outside.body' },
  resting: { title: 'quiet.resting.title', body: 'quiet.resting.body' },
  offline: { title: 'quiet.offline.title', body: 'quiet.offline.body' },
  unavailable: { title: 'quiet.unavailable.title', body: 'quiet.unavailable.body' },
  'chat-access': { title: 'quiet.chatAccess.title', body: 'quiet.chatAccess.body' },
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
  const k = TEXT[kind];
  const lang = petLang();
  // the words paint in the person's language: Telegram's loading screen hands over once they are in
  const ready = useStrings(lang);
  useEffect(() => (ready ? readyAfterPaint() : undefined), [ready]);
  if (!ready) return <main className="pet-root" data-pet-root="" style={{ backgroundColor: bd.edge }} />;
  return (
    <main className="pet-root pet-sleeper" data-pet-root="" lang={lang} dir={dir(lang)} style={{ backgroundImage: bd.image, backgroundColor: bd.edge }}>
      <div className="pet-sleeper-char">
        <div className="pet-breathe" data-asleep="">
          <CharacterView look={l} stage={stage} expr="sleeping" size={180} lod="hero" label={name ?? 'Agent'} />
        </div>
        <span className="pet-zz" aria-hidden="true">z</span>
      </div>
      <h1 className="pet-sleeper-title">{t(k.title)}</h1>
      <p className="pet-sleeper-body">{t(k.body)}</p>
      {onRetry && <button type="button" className="pet-pill pet-pill-dm pet-retry" onClick={onRetry}>{t('ui.retry')}</button>}
    </main>
  );
}
