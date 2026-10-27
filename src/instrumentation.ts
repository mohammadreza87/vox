/**
 * Next.js server startup hook. With STUDIO_BOTS=1 the server also runs every
 * Vox Studio Telegram bot (VoxxBot + agent bots) by long polling, in the same
 * process as the Mini App API so they share one state store.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { startStudioBots } = await import('./instrumentation-node');
    await startStudioBots();
  }
}
