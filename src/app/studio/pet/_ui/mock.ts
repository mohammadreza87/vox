/**
 * The ?mock=1 fake: an in-memory PetApi that applies care.ts locally and answers talk with canned
 * lines, so demos, the lab and a plain browser get the whole page with no server and no Telegram.
 * Same shapes and the same guards as the real API; small latencies so "thinking" is visible.
 */

import { PRESET_LOOKS } from '@/lib/studio/character';
import { PetError } from './errors';
import { applyLocal, openLocal, talkLocal } from './care-local';
import type { PetApi } from './contract';
import type { PetCare, PetPrivateView, PetView, Stage, TalkResponse } from '@/lib/pet/types';

export interface MockOptions {
  /** PRESET_LOOKS index (default 0, the lagoon cloud) */
  look?: number;
  stage?: number;
  /** guest: full page, talk goes to the DM · private: the 403 sleeper · outside: no Telegram (401) */
  role?: 'guest' | 'private' | 'outside';
  /** play welcome-back with a souvenir on open */
  welcome?: boolean;
  /** play the stage-up celebration on open */
  stageUp?: boolean;
  /** starting needs and Bond (default: Tummy in "wants" so the rings, wiggle and thought bubble show) */
  care?: Partial<Pick<PetCare, 'tummy' | 'joy' | 'energy' | 'bond'>>;
  /** latency per call in ms (default 260 for care, 1400 for talk) */
  latency?: { care?: number; talk?: number };
  now?: () => number;
}

const DAY = 24 * 60 * 60 * 1000;
const NAME = 'Mochi';

const REPLIES = [
  'That sounds lovely. Tell me more?',
  'Ooh, I like that idea!',
  'Hmm, let me think… yes, I think you’re right.',
  'You always make the clouds feel lighter.',
  'Ha! That made my day.',
];
const BYE = /\b(bye|goodbye|good night|goodnight|see you|later)\b/i;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new PetError(0, 'network', 'Aborted')); }, { once: true });
});

const clampStage = (n: number | undefined): Stage => (n === 1 || n === 2 || n === 3 || n === 4 ? n : 3);

export function createMockApi(o: MockOptions = {}): PetApi {
  const now = o.now ?? (() => Date.now());
  const look = PRESET_LOOKS[Math.abs(o.look ?? 0) % PRESET_LOOKS.length];
  const stage = clampStage(o.stage);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const t0 = now();
  // a few needs in "wants" so the rings, the wiggle and the thought bubble show on a demo
  let care: PetCare = {
    v: 1, agentId: 'mock', userId: 1,
    tummy: 48, joy: 72, energy: 84, bond: 12, ...o.care,
    asleep: false, lastUpdatedAt: t0, lastSeenAt: t0 - (o.welcome ? 2 * DAY : 60_000), firstMetAt: t0 - 3 * DAY,
    tz, quietStart: 22, quietEnd: 8, lastSeenStage: o.stageUp && stage > 1 ? ((stage - 1) as Stage) : stage,
    caps: { hourStart: t0, petJoy: 0, talkJoy: 0, careBond: 0, dayStart: t0 },
  };
  let turn = 0;

  const refuse = () => {
    if (o.role === 'outside') throw new PetError(401, 'authentication_required', 'Open in Telegram');
    if (o.role === 'private') {
      const body: PetPrivateView = { error: 'pet_private', name: NAME, look, stage };
      throw new PetError(403, 'pet_private', 'Private', body);
    }
  };

  // every GET is an "open" on the server: decay, welcome floors, quiet-hours sleep, stage-up, once each
  const view = (): PetView => {
    const t = now();
    const opened = openLocal(care, t, stage);
    care = opened.care;
    return {
      agentId: 'mock', name: NAME, look, stage, formingDay: 5, botUsername: 'vox_mochi_bot', voice: false, listen: o.role !== 'guest',
      role: o.role === 'guest' ? 'guest' : 'owner', care, now: t,
      ...(opened.welcome ? { welcome: { souvenir: 'I kept thinking about your trip to Shiraz.', awayMs: opened.welcome.awayMs } } : {}),
      ...(opened.stageUp ? { stageUp: opened.stageUp } : {}),
      ...(opened.bondMilestone === undefined ? {} : { bondMilestone: opened.bondMilestone }),
    };
  };

  const talkReply = (text: string): TalkResponse => {
    const goodbye = BYE.test(text);
    care = talkLocal(care, now());
    return goodbye
      ? { reply: 'Bye for now! Come say hi whenever you like.', goodbye: true, care, turnId: `mock-${++turn}` }
      : { reply: REPLIES[turn++ % REPLIES.length], care, turnId: `mock-${turn}` };
  };

  return {
    async get(_agentId, opts) {
      await sleep(120, opts?.signal);
      refuse();
      return view();
    },
    async care(_agentId, req, opts) {
      await sleep(o.latency?.care ?? 260, opts?.signal);
      refuse();
      const t = now();
      const r = applyLocal(care, req.action, t, req.n);
      care = r.care;
      return { care, now: t, ...(r.guard ? { guard: r.guard } : {}) };
    },
    async talk(_agentId, req, opts) {
      await sleep(o.latency?.talk ?? 1400, opts?.signal);
      refuse();
      if (o.role === 'guest') throw new PetError(403, 'guest_talk', 'Guests talk in the DM');
      return talkReply(req.text);
    },
    async talkVoice(_agentId, _audio, opts) {
      await sleep(o.latency?.talk ?? 1400, opts?.signal);
      refuse();
      if (o.role === 'guest') throw new PetError(403, 'guest_talk', 'Guests talk in the DM');
      return { transcript: '(voice note)', ...talkReply('') };
    },
    async forget(_agentId, opts) {
      await sleep(o.latency?.care ?? 260, opts?.signal);
      refuse();
      const t = now();
      care = { ...care, tummy: 75, joy: 80, energy: 85, bond: 0, seenBond: 0, asleep: false, lastUpdatedAt: t, lastSeenAt: t, firstMetAt: t };
      return { erased: 1 };
    },
  };
}
