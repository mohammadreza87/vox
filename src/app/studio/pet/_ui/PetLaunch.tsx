'use client';

/**
 * Circles S4: the launch page's client. The code is the signed start_param; the server maps it to its agent
 * (GET /api/studio/pet/launch) and the pet opens as usual, every call carrying the same initData. Outside
 * Telegram, or a code that names nothing, gets the quiet screen.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { createHttpApi, isPetError } from './api';
import { PetApp } from './PetApp';
import { PET_GROUND } from './scene';
import type { SleeperKind } from './Sleeper';

/** Lazy, as in PetApp: the quiet screen (and sleeper.css) stays out of the launch page's budget. */
const Sleeper = lazy(() => import('./Sleeper').then((m) => ({ default: m.Sleeper })));

export function PetLaunch() {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [failed, setFailed] = useState<SleeperKind | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    // The pet API's own call (GET /api/studio/pet/launch, initData attached), already in the pet's chunk: the launch page stays within budget.
    createHttpApi().send!<{ agentId?: unknown }>('launch', 'GET', '', undefined, { signal: ac.signal })
      .then((b) => { if (typeof b.agentId !== 'string') throw b; setAgentId(b.agentId); })
      .catch((e) => { if (!ac.signal.aborted) setFailed(isPetError(e) && e.status === 401 ? 'outside' : 'unavailable'); });
    return () => ac.abort();
  }, []);
  const ground = <main className="pet-root" data-pet-root="" style={{ backgroundColor: PET_GROUND }} />;
  if (agentId) return <PetApp agentId={agentId} />;
  if (failed) return <Suspense fallback={ground}><Sleeper kind={failed} /></Suspense>;
  return ground;
}
