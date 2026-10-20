import { InventoryError, LIMITS, safeStop } from './contracts';

/** Tokens include keys, scalar values, brackets, braces, colons and commas. */
export interface JsonBudget { tokens: number; depth: number }
type Frame =
  | { kind: 'object'; state: 'keyOrEnd' | 'key' | 'colon' | 'value' | 'commaOrEnd'; keys: Set<string> }
  | { kind: 'array'; state: 'valueOrEnd' | 'value' | 'commaOrEnd' };
const invalid = (): never => { throw new InventoryError('invalid_transport'); };
const capacity = (): never => { throw new InventoryError('capacity_exceeded'); };

/**
 * Preflight JSON iteratively before parsing can erase duplicate-key evidence.
 * Tokens accumulate across parses. Incoming depth is a conservative enclosing-depth
 * offset; the returned depth is the maximum combined container depth observed.
 */
export function parseBoundedJson(text: string, budget: JsonBudget = { tokens: 0, depth: 0 }): unknown {
  try { return preflightJson(text, budget); }
  catch (error) {
    const code = safeStop(error, 'invalid_transport');
    throw new InventoryError(code === 'capacity_exceeded' ? code : 'invalid_transport');
  }
}

function preflightJson(text: string, budget: JsonBudget): unknown {
  if (typeof text !== 'string' || !Number.isSafeInteger(budget.tokens) || budget.tokens < 0 ||
      !Number.isSafeInteger(budget.depth) || budget.depth < 0) invalid();
  if (budget.tokens > LIMITS.tokens || budget.depth > LIMITS.depth) capacity();
  const baseDepth = budget.depth;
  const stack: Frame[] = [];
  let cursor = 0;
  let rootSeen = false;
  const token = () => { if (++budget.tokens > LIMITS.tokens) capacity(); };
  const whitespace = () => {
    while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t' ||
      text[cursor] === '\n' || text[cursor] === '\r')) cursor++;
  };
  const digit = (position: number) => text[position] >= '0' && text[position] <= '9';
  const string = (key: boolean): string | undefined => {
    const start = cursor++;
    while (cursor < text.length) {
      const char = text.charCodeAt(cursor++);
      if (char === 34) {
        if (!key) return;
        try { return JSON.parse(text.slice(start, cursor)) as string; } catch { invalid(); }
      }
      if (char < 32) invalid();
      if (char === 92) {
        const escape = text[cursor++];
        if (escape === 'u') {
          for (let count = 0; count < 4; count++) {
            const hex = text[cursor++];
            if (hex === undefined || !/[0-9a-fA-F]/.test(hex)) invalid();
          }
        } else if (escape === undefined || !'"\\/bfnrt'.includes(escape)) invalid();
      }
    }
    invalid();
  };
  const value = () => {
    token();
    const char = text[cursor];
    if (char === '{' || char === '[') {
      const depth = baseDepth + stack.length + 1;
      if (depth > LIMITS.depth) capacity();
      budget.depth = Math.max(budget.depth, depth);
      stack.push(char === '{' ? { kind: 'object', state: 'keyOrEnd', keys: new Set() }
        : { kind: 'array', state: 'valueOrEnd' });
      cursor++;
    } else if (char === '"') {
      string(false);
    } else if (char === 't' && text.startsWith('true', cursor)) cursor += 4;
    else if (char === 'f' && text.startsWith('false', cursor)) cursor += 5;
    else if (char === 'n' && text.startsWith('null', cursor)) cursor += 4;
    else {
      const start = cursor;
      if (char === '-') cursor++;
      if (text[cursor] === '0') cursor++;
      else {
        if (!digit(cursor) || text[cursor] === '0') invalid();
        while (digit(cursor)) cursor++;
      }
      if (text[cursor] === '.') {
        cursor++;
        if (!digit(cursor)) invalid();
        while (digit(cursor)) cursor++;
      }
      if (text[cursor] === 'e' || text[cursor] === 'E') {
        cursor++;
        if (text[cursor] === '+' || text[cursor] === '-') cursor++;
        if (!digit(cursor)) invalid();
        while (digit(cursor)) cursor++;
      }
      if (!Number.isFinite(Number(text.slice(start, cursor)))) invalid();
    }
  };
  while (true) {
    whitespace();
    const frame = stack[stack.length - 1];
    if (!frame) {
      if (rootSeen) {
        if (cursor !== text.length) invalid();
        break;
      }
      if (cursor === text.length) invalid();
      rootSeen = true;
      value();
      continue;
    }
    const char = text[cursor];
    if (frame.kind === 'object' && (frame.state === 'keyOrEnd' || frame.state === 'key')) {
      if (char === '}' && frame.state === 'keyOrEnd') { token(); cursor++; stack.pop(); }
      else {
        if (char !== '"') invalid();
        token();
        const key = string(true)!;
        if (key === '__proto__' || key === 'constructor' || key === 'prototype' || frame.keys.has(key)) invalid();
        frame.keys.add(key);
        frame.state = 'colon';
      }
    } else if (frame.kind === 'object' && frame.state === 'colon') {
      if (char !== ':') invalid();
      token(); cursor++; frame.state = 'value';
    } else if (frame.state === 'value' || (frame.kind === 'array' && frame.state === 'valueOrEnd')) {
      if (frame.kind === 'array' && frame.state === 'valueOrEnd' && char === ']') {
        token(); cursor++; stack.pop();
      } else { frame.state = 'commaOrEnd'; value(); }
    } else {
      const close = frame.kind === 'array' ? ']' : '}';
      if (char === close) { token(); cursor++; stack.pop(); }
      else if (char === ',') {
        token(); cursor++;
        frame.state = frame.kind === 'array' ? 'value' : 'key';
      } else invalid();
    }
  }
  try { return JSON.parse(text) as unknown; } catch { return invalid(); }
}

export interface ReaderProgress { bytesConsumed: number; endOfInputObserved: boolean }
export interface FixtureFrame { value: unknown; budget: JsonBudget }

/** Strict UTF-8 JSONL. Cleanup still requires a cooperative producer. */
export async function* readFixtureFrames(
  chunks: AsyncIterable<Uint8Array>, progress: ReaderProgress, signal?: AbortSignal,
): AsyncGenerator<FixtureFrame> {
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let observedEof = false;
  let frame: Uint8Array | undefined;
  let length = 0;
  const cancelled = () => { if (signal?.aborted) throw new InventoryError('cancelled'); };
  try {
    cancelled();
    try { iterator = chunks[Symbol.asyncIterator](); } catch { throw new InventoryError('reader_failed'); }
    frame = new Uint8Array(LIMITS.frameBytes);
    while (true) {
      cancelled();
      let result: IteratorResult<Uint8Array>;
      try { result = await iterator.next(); } catch { throw new InventoryError('reader_failed'); }
      cancelled();
      let done: boolean | undefined;
      let chunk: Uint8Array;
      try { done = result.done; chunk = result.value; } catch { throw new InventoryError('reader_failed'); }
      if (done === true) {
        observedEof = true;
        progress.endOfInputObserved = true;
        if (length !== 0) throw new InventoryError('input_truncated');
        return;
      }
      // ArrayBuffer.isView also recognizes genuine typed arrays from another realm.
      if (!ArrayBuffer.isView(chunk) || Object.prototype.toString.call(chunk) !== '[object Uint8Array]' || chunk.byteLength === 0) invalid();
      if (chunk.byteLength > LIMITS.chunkBytes || progress.bytesConsumed + chunk.byteLength > LIMITS.bytes) capacity();
      progress.bytesConsumed += chunk.byteLength;
      for (let position = 0; position < chunk.byteLength; position++) {
        const byte = chunk[position];
        if (byte === 13) invalid();
        if (byte !== 10) {
          if (length === LIMITS.frameBytes) capacity();
          frame[length++] = byte;
          continue;
        }
        cancelled();
        if (length === 0) invalid();
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(frame.subarray(0, length)); }
        catch { invalid(); }
        const budget = { tokens: 0, depth: 0 };
        const value = parseBoundedJson(text!, budget);
        length = 0;
        yield { value, budget };
        cancelled();
      }
    }
  } catch (error) {
    const code = safeStop(error, 'reader_failed');
    throw new InventoryError(code === 'invalid_transport' || code === 'capacity_exceeded' ||
      code === 'cancelled' || code === 'input_truncated' ? code : 'reader_failed');
  } finally {
    frame = undefined;
    length = 0;
    if (iterator && !observedEof) {
      try { await iterator.return?.(); } catch { /* Cleanup errors never expose producer text or replace the primary stop. */ }
    }
  }
}
