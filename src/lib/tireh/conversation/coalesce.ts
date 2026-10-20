/** Default hold window for streamed text after the first delta. */
export const COALESCE_WINDOW_MS = 100;
const SENTENCE_END = /[.!?…؟。！？]["')\]»”’]*\s*$/u;

/**
 * Merges streamed text deltas. The first delta passes through at once (time to
 * first audio); later ones are held until the held text ends a sentence or its
 * oldest part is `windowMs` old, then emitted together. Content is unchanged:
 * concatenating the output equals concatenating the input. Closing the result
 * closes the source.
 */
export async function* coalesceDeltas(source: AsyncIterable<string>, windowMs = COALESCE_WINDOW_MS): AsyncGenerator<string> {
  const iterator = source[Symbol.asyncIterator]();
  let pending = '', heldSince = 0, first = true, finished = false;
  let next: Promise<IteratorResult<string>> | undefined;
  try {
    while (true) {
      next ??= iterator.next();
      let result: IteratorResult<string> | 'flush';
      if (pending) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const due = new Promise<'flush'>(resolve => { timer = setTimeout(() => resolve('flush'), Math.max(0, windowMs - (performance.now() - heldSince))); });
        try { result = await Promise.race([next, due]); } finally { clearTimeout(timer); }
      } else result = await next;
      if (result === 'flush') { const out = pending; pending = ''; yield out; continue; }
      next = undefined;
      if (result.done) { finished = true; break; }
      if (!result.value) continue;
      if (!pending) heldSince = performance.now();
      pending += result.value;
      if (first || SENTENCE_END.test(pending)) { const out = pending; pending = ''; first = false; yield out; }
    }
    if (pending) yield pending;
  } finally {
    if (!finished) {
      // Stopped while a read was in flight: close the source once that read
      // settles, without making the consumer wait on a stalled upstream.
      if (next) void next.then(() => iterator.return?.(), () => undefined).catch(() => undefined);
      else await iterator.return?.();
    }
  }
}
