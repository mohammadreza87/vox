/** Node-only half of instrumentation.ts (kept separate so the edge bundle never sees it). */
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
    const { getStudio, registerStudioBotRuntime } = await import('./lib/studio/runtime');
    const { startBots } = await import('./lib/studio/bots');
    registerStudioBotRuntime(startBots(await getStudio()));
    console.log('[studio] bots started');
  } catch (error) {
    g.__voxBots = false;
    // Next must fail startup so a supervisor can restart an unavailable service.
    throw error;
  }
}
