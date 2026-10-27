/** Node-only half of instrumentation.ts (kept separate so the edge bundle never sees it). */
let runtimeForStartupCleanup: typeof import('./lib/studio/runtime') | undefined;

/** Stop only an already loaded runtime; fatal cleanup must never bootstrap one. */
export function stopStudioBotsAfterStartupFailure(): Promise<{ pending: number }> {
  return runtimeForStartupCleanup?.stopStudioRuntime() ?? Promise.resolve({ pending: 0 });
}

export async function startStudioBots() {
  // Build/prerender is never a live runtime bootstrap. Pure imports/config remain usable.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  // Validate the scheduler opt-in before the disabled-bots return: otherwise
  // maintenance could appear enabled without ever constructing its runner.
  if (process.env.STUDIO_MAINTENANCE === '1' && process.env.STUDIO_BOTS !== '1') {
    throw new Error('STUDIO_MAINTENANCE=1 requires STUDIO_BOTS=1 in a persistent polling process');
  }
  if (process.env.STUDIO_BOTS !== '1') return;
  const g = globalThis as unknown as { __voxBots?: boolean };
  if (g.__voxBots) return;
  g.__voxBots = true;
  try {
    const runtime = await import('./lib/studio/runtime');
    runtimeForStartupCleanup = runtime;
    const { startBots } = await import('./lib/studio/bots');
    runtime.registerStudioBotRuntime(startBots(await runtime.getStudio()));
    console.log('[studio] bots started');
  } catch (error) {
    g.__voxBots = false;
    // Direct callers retain rejection/retry; register owns terminal startup.
    throw error;
  }
}
