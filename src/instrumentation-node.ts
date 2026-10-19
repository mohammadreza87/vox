/** Node-only half of instrumentation.ts (kept separate so the edge bundle never sees it). */
export async function startStudioBots() {
  if (process.env.STUDIO_BOTS !== '1') return;
  const g = globalThis as unknown as { __voxBots?: boolean };
  if (g.__voxBots) return;
  g.__voxBots = true;
  const { getStudio } = await import('./lib/studio/runtime');
  const { startBots } = await import('./lib/studio/bots');
  try {
    startBots(await getStudio());
    console.log('[studio] bots started');
  } catch (error) {
    g.__voxBots = false;
    console.error('[studio] bots not started:', (error as Error).message);
  }
}
