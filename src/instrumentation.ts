/**
 * Next.js server startup hook. With STUDIO_BOTS=1 the server also runs every
 * Vox Studio Telegram bot (VoxxBot + agent bots) by long polling, in the same
 * process as the Mini App API so they share one state store.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const fatalPollingStartup = process.env.NODE_ENV === 'production' && process.env.STUDIO_BOTS === '1';
    let stopAfterFailure: (() => Promise<{ pending: number }>) | undefined;
    try {
      const node = await import('./instrumentation-node');
      stopAfterFailure = node.stopStudioBotsAfterStartupFailure;
      await node.startStudioBots();
    } catch (error) {
      if (!fatalPollingStartup) throw error;
      // Next can swallow instrumentation rejections and retain its listener.
      // Arm a referenced deadline before any cleanup that could fail or hang.
      const deadline = setTimeout(() => process.exit(1), 5_000);
      try {
        try { console.error('[studio] fatal production polling startup failure'); } catch { /* Logging cannot skip cleanup. */ }
        await stopAfterFailure?.();
      } catch { /* Cleanup failure remains terminal. */ }
      finally {
        clearTimeout(deadline);
        process.exit(1);
      }
    }
  }
}
