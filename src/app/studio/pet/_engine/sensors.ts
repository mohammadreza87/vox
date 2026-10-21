/**
 * Telegram Accelerometer for the shake gesture (brief §1.3, §3.5): started only after the first touch, refresh
 * 50 ms, stopped on deactivate/hide; `accelerometerFailed` turns the feature off for the session. Samples go
 * to the classifier through the engine (|a| > 15 m/s² three times within 1 s, once per 5 s).
 */

import { GESTURE } from '../_ui/contract';

interface TgAccelerometer {
  isStarted?: boolean;
  x?: number; y?: number; z?: number;
  start(params: { refresh_rate: number }, cb?: (ok: boolean) => void): void;
  stop(cb?: (ok: boolean) => void): void;
}
interface TgApp { Accelerometer?: TgAccelerometer; onEvent?(e: string, cb: () => void): void; offEvent?(e: string, cb: () => void): void }

const app = (): TgApp | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Telegram?: { WebApp?: TgApp } }).Telegram?.WebApp;

export interface ShakeSensor {
  /** after the first touch; a no-op without Telegram's Accelerometer or after it failed */
  start(): void;
  stop(): void;
  readonly failed: boolean;
}

export function shakeSensor(onSample: (a: { x: number; y: number; z: number }, now: number) => void, tg: () => TgApp | undefined = app): ShakeSensor {
  let on = false, failed = false, bound = false;
  const changed = () => {
    const a = tg()?.Accelerometer;
    if (a) onSample({ x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0 }, typeof performance !== 'undefined' ? performance.now() : Date.now());
  };
  const fail = () => { failed = true; on = false; };
  return {
    get failed() { return failed; },
    start() {
      const t = tg(), a = t?.Accelerometer;
      if (on || failed || !a) return;
      if (!bound) { t?.onEvent?.('accelerometerChanged', changed); t?.onEvent?.('accelerometerFailed', fail); bound = true; }
      on = true;
      try { a.start({ refresh_rate: GESTURE.accelRefreshMs }, (ok) => { if (!ok) fail(); }); } catch { fail(); }
    },
    stop() {
      const t = tg();
      if (bound) { t?.offEvent?.('accelerometerChanged', changed); t?.offEvent?.('accelerometerFailed', fail); bound = false; }
      if (!on) return;
      on = false;
      try { t?.Accelerometer?.stop(); } catch { /* already stopped */ }
    },
  };
}
