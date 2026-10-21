/**
 * A representative event for every reaction kind (tests): zones, phases, tones and levels spread across calls
 * so a loop over i reaches every branch.
 */

import type { ReactionEvent, ReactionKind } from './types';

export function sample(kind: ReactionKind, i: number): ReactionEvent {
  const zones = ['belly', 'eye', 'head', 'cheek'] as const;
  const phases = ['notice', 'approach', 'bite', 'chomp', 'swallow', 'satisfied'] as const;
  const tones = ['content', 'hungry', 'tired', 'bored', 'happy'] as const;
  const e: Record<ReactionKind, ReactionEvent> = {
    hello: { type: 'hello' }, welcomeBack: { type: 'welcomeBack', souvenir: 'Shiraz!' }, stageUp: { type: 'stageUp', from: 3, to: 4 },
    fidgetSmall: { type: 'fidgetSmall' }, fidgetLong: { type: 'fidgetLong' }, ambient: { type: 'ambient', tone: tones[i % 5] }, signature: { type: 'signature', index: i },
    bored: { type: 'bored' }, wants: { type: 'wants', need: (['tummy', 'joy', 'energy'] as const)[i % 3] }, droopy: { type: 'droopy' }, sad: { type: 'sad' }, doze: { type: 'doze' },
    poke: { type: 'poke', zone: zones[i % 4], side: ([-1, 0, 1] as const)[i % 3], at: { x: 100, y: 120 }, hits: 1 + (i % 6), coolOff: i % 9 === 8 },
    pet: { type: 'pet', speed: 100 + (i % 5) * 120, dir: i % 2 ? 1 : -1, passes: 1 + (i % 5) }, tickle: { type: 'tickle' },
    overpoke: { type: 'overpoke', hits: i % 2 ? 7 : 4, level: i % 2 ? 'max' : 'mid' }, longPress: { type: 'longPress', at: { x: 100, y: 120 } },
    dragStart: { type: 'dragStart', at: { x: 100, y: 120 } }, drag: { type: 'drag', vx: 1500, vy: -200 }, fling: { type: 'fling', vx: 1200, vy: -900, thrown: i % 2 === 0 },
    wallHit: { type: 'wallHit', nx: i % 2 ? 1 : -1, v: 1400 }, land: { type: 'land', v: 800 + (i % 4) * 800 }, shake: { type: 'shake' },
    feed: { type: 'feed', phase: phases[i % 6], dist: 50, chomp: 3 + (i % 2) }, tooFull: { type: 'tooFull' },
    playStart: { type: 'playStart', tired: i % 3 === 2 }, ballNear: { type: 'ballNear' }, bop: { type: 'bop', nx: 0.2, ny: -1 }, miss: { type: 'miss', misses: 1 + (i % 2) },
    playEnd: { type: 'playEnd', bops: i % 8, won: i % 8 >= 5, misses: i % 4 },
    yawn: { type: 'yawn' }, sleep: { type: 'sleep' }, dream: { type: 'dream' }, sleepPoke: { type: 'sleepPoke' }, wake: { type: 'wake', from: i % 2 ? 'doze' : 'sleep', grumpy: i % 3 === 0 },
    listen: { type: 'listen', source: i % 2 ? 'mic' : 'text' }, typingPause: { type: 'typingPause' }, ack: { type: 'ack' }, think: { type: 'think', cycle: i % 5 },
    speakStart: { type: 'speakStart', mode: 'text' }, viseme: { type: 'viseme', v: 'D', open: 0.8 }, onset: { type: 'onset' }, speakEnd: { type: 'speakEnd' },
    nod: { type: 'nod' }, wave: { type: 'wave' }, celebrate: { type: 'celebrate', why: (['stage', 'bond', 'win'] as const)[i % 3] }, refuse: { type: 'refuse', why: i % 2 ? 'full' : 'tired' },
  };
  return e[kind];
}

