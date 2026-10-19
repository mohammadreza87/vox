'use client';
import { ApiError, request } from './client';
type ProjectionPath = `experience/preferences?${string}` | `experience/preference-learning?${string}`;
const abortError = () => new DOMException('Preference projection cancelled', 'AbortError');
/** Only these read-only projections retry a fresh, fully authorized server view.
 * Three attempts, one1500ms deadline; no mutation, generic503,403 or network retry. */
export async function readPreferenceProjection<T>(path: ProjectionPath, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController(); let pause: ReturnType<typeof setTimeout> | undefined;
  let stop!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => { stop = () => { controller.abort(); reject(abortError()); }; });
  signal?.addEventListener('abort', stop, { once: true });
  const deadline = setTimeout(stop, 1500);
  const code = path.startsWith('experience/preferences?') ? 'preference_authority_changed' : 'preference_learning_changed';
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      if (controller.signal.aborted) throw abortError();
      try {
        const result = await request<T>('GET', path, undefined, 'json', controller.signal);
        if (controller.signal.aborted) throw abortError();
        return result;
      } catch (error) {
        if (controller.signal.aborted) throw abortError();
        if (!(error instanceof ApiError) || error.status !== 409 || error.message !== code || attempt >= 2) throw error;
        await new Promise<void>(resolve => { pause = setTimeout(resolve, attempt === 0 ? 40 : 80); });
      }
    }
  };
  try { return await Promise.race([run(), stopped]); }
  finally { clearTimeout(deadline); if (pause) clearTimeout(pause); signal?.removeEventListener('abort', stop); }
}
