import { describe, expect, it, vi } from 'vitest';
import { InventoryError, LIMITS } from '../contracts';
import { parseBoundedJson, readFixtureFrames, type ReaderProgress } from '../codec';

const encode = (text: string) => new TextEncoder().encode(text);
const progress = (): ReaderProgress => ({ bytesConsumed: 0, endOfInputObserved: false });
function instrument(values: Uint8Array[], failure?: Error) {
  let position = 0;
  const next = vi.fn(async () => {
    if (position < values.length) return { done: false as const, value: values[position++] };
    if (failure) throw failure;
    return { done: true as const, value: new Uint8Array() };
  });
  const close = vi.fn(async () => ({ done: true as const, value: undefined }));
  return { chunks: { [Symbol.asyncIterator]: () => ({ next, return: close }) }, next, close };
}
async function collect(chunks: AsyncIterable<Uint8Array>, state = progress(), signal?: AbortSignal) {
  const frames = [];
  for await (const frame of readFixtureFrames(chunks, state, signal)) frames.push(frame);
  return frames;
}
const fail = (text: string, code = 'invalid_transport') => {
  try { parseBoundedJson(text); throw new Error('expected failure'); }
  catch (error) { expect(error).toBeInstanceOf(InventoryError); expect((error as InventoryError).code).toBe(code); }
};

describe('LIP1 iterative lexical preflight', () => {
  it('accepts JSON grammar and escaped strings without treating string punctuation as structure', () => {
    const input = '{"a":[{},[],true,false,null,-0,1.2e-3],"s":"\\\"{}[],:\\\\\\/\\b\\f\\n\\r\\t\\u0061"}';
    expect(parseBoundedJson(input)).toEqual(JSON.parse(input));
    expect(parseBoundedJson(' \t\r\n0 \n')).toBe(0);
    expect(parseBoundedJson('-1E+2')).toBe(-100);
    for (const [json, tokens] of [['[]', 2], ['{"a":[true,null]}', 9]] as const) {
      const budget = { tokens: 0, depth: 0 };
      parseBoundedJson(json, budget);
      expect(budget.tokens).toBe(tokens);
    }
  });
  it.each([
    '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":{"z":0,"\\u007a":1}}',
    '{"__proto__":{}}', '{"constr\\u0075ctor":0}', '{"prototype":null}',
    '[{"\\u005f_proto__":1}]',
  ])('rejects duplicate or pollution keys before JSON.parse: %s', input => {
    const original = JSON.parse;
    const parse = vi.spyOn(JSON, 'parse').mockImplementation((text: string) => original(text));
    fail(input);
    expect(parse.mock.calls.some(([text]) => text === input)).toBe(false);
    parse.mockRestore();
  });
  it('allows the same key in separate objects and dangerous-looking values', () => {
    expect(parseBoundedJson('[{"a":0},{"a":"__proto__"}]')).toEqual([{ a: 0 }, { a: '__proto__' }]);
  });
  it.each(['', ' ', 'NaN', 'Infinity', '1e999', '-1e999', '01', '-01', '1.', '.1', '+1', '-', '1e',
    '1e+', 'true false', 'nul', '{', '[', '[1,]', '{"a":1,}', '{a:1}', '{"a" 1}', '{"a":}',
    '{"a":1 "b":2}', '[1 2]', '"\\x00"', '"\\u12z4"', '"\\u123"', '"bad\nstring"',
    '"unterminated', '"\\', '/*x*/0', '\ufeff{}'])('rejects invalid JSON with a fixed code: %j', input => fail(input));
  it('accepts exactly 32 containers and stops iteratively at container 33', () => {
    expect(parseBoundedJson('['.repeat(32) + '0' + ']'.repeat(32))).toBeInstanceOf(Array);
    fail('['.repeat(33) + '0' + ']'.repeat(33), 'capacity_exceeded');
    fail('['.repeat(100_000), 'capacity_exceeded');
  });
  it('counts punctuation and scalar tokens and enforces the shared 50,000-token ceiling', () => {
    const input = '[' + Array(24_999).fill('0').join(',') + ']'; // 49,999 tokens
    const budget = { tokens: 1, depth: 0 };
    expect((parseBoundedJson(input, budget) as unknown[]).length).toBe(24_999);
    expect(budget).toEqual({ tokens: 50_000, depth: 1 });
    expect(() => parseBoundedJson('null', budget)).toThrowError('capacity_exceeded');
    fail('[' + Array(25_000).fill('0').join(',') + ']', 'capacity_exceeded');
  });
  it('shares cumulative tokens and conservative enclosing depth with nested Studio json', () => {
    const budget = { tokens: 0, depth: 0 };
    const outer = parseBoundedJson(JSON.stringify({ payload: { json: '['.repeat(30) + '0' + ']'.repeat(30) } }), budget) as { payload: { json: string } };
    const outerTokens = budget.tokens;
    expect(budget.depth).toBe(2);
    parseBoundedJson(outer.payload.json, budget);
    expect(budget).toEqual({ tokens: outerTokens + 61, depth: 32 });
    expect(() => parseBoundedJson('[]', budget)).toThrowError('capacity_exceeded');
    const duplicate = parseBoundedJson('{"json":"{\\\"a\\\":0,\\\"\\\\u0061\\\":1}"}') as { json: string };
    fail(duplicate.json);
  });
  it('scrubs unexpected preflight errors to its fixed transport code', () => {
    const budget = { get tokens(): number { throw new Error('PRIVATE_BUDGET_CANARY'); }, depth: 0 };
    expect(() => parseBoundedJson('0', budget)).toThrowError('invalid_transport');
    const parse = vi.spyOn(JSON, 'parse').mockImplementation(() => { throw new Error('PRIVATE_PARSER_CANARY'); });
    try { expect(() => parseBoundedJson('{}')).toThrowError('invalid_transport'); } finally { parse.mockRestore(); }
  });
  it('reconstructs forged InventoryErrors and permits only parser codes', () => {
    for (const sourceCode of ['PRIVATE_ERROR_CODE_CANARY', 'invalid_manifest', 'capacity_exceeded']) {
      const forged = new InventoryError(sourceCode as never);
      forged.message = 'PRIVATE_ERROR_MESSAGE_CANARY';
      const budget = { get tokens(): number { throw forged; }, depth: 0 };
      try { parseBoundedJson('0', budget); throw new Error('expected failure'); }
      catch (error) {
        expect(error).toBeInstanceOf(InventoryError);
        expect(error).not.toBe(forged);
        expect((error as InventoryError).code).toBe(sourceCode === 'capacity_exceeded' ? 'capacity_exceeded' : 'invalid_transport');
        expect(String(error) + JSON.stringify(error)).not.toContain('PRIVATE_');
        expect((error as Error).cause).toBeUndefined();
      }
    }
  });
  it('rejects invalid budget state with only fixed errors', () => {
    for (const budget of [{ tokens: NaN, depth: 0 }, { tokens: 0, depth: -1 }, { tokens: 0, depth: 1.5 }]) {
      expect(() => parseBoundedJson('0', budget)).toThrowError('invalid_transport');
    }
  });
});

describe('LIP1 bounded strict UTF-8 JSONL reader', () => {
  it('preserves values and budgets at every byte split, including multibyte code points', async () => {
    const bytes = encode('{"value":"🌻 فارسی\\ntext"}\n[true,null]\n');
    const expected = await collect(instrument([bytes]).chunks);
    for (let split = 1; split < bytes.length; split++) {
      const source = instrument([bytes.slice(0, split), bytes.slice(split)]);
      const state = progress();
      expect(await collect(source.chunks, state)).toEqual(expected);
      expect(state).toEqual({ bytesConsumed: bytes.length, endOfInputObserved: true });
      expect(source.close).not.toHaveBeenCalled();
    }
    const singleBytes = instrument([...bytes].map(byte => new Uint8Array([byte])));
    expect(await collect(singleBytes.chunks)).toEqual(expected);
  });
  it('accepts an empty stream and ignores the value accompanying done=true EOF', async () => {
    const state = progress();
    const source = instrument([]);
    expect(await collect(source.chunks, state)).toEqual([]);
    expect(state).toEqual({ bytesConsumed: 0, endOfInputObserved: true });
    expect(source.next).toHaveBeenCalledTimes(1);
    const oddEof = { async *[Symbol.asyncIterator]() { return encode('not a delivered chunk'); } };
    expect(await collect(oddEof)).toEqual([]);
  });
  it.each(['\n', ' \n', '{}\r\n', '{\r}\n', '\ufeff{}\n', '{}\n\ufeff{}\n', '{"a":0,"\\u0061":1}\n'])('rejects strict framing or unsafe JSON: %j', async text => {
    const source = instrument([encode(text)]);
    await expect(collect(source.chunks)).rejects.toMatchObject({ code: 'invalid_transport', message: 'invalid_transport' });
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(source.next).toHaveBeenCalledTimes(1);
  });
  it.each([[0xff, 10], [0xc0, 0xaf, 10], [34, 0xed, 0xa0, 0x80, 34, 10], [34, 0xe2, 34, 10]].map(bytes => [bytes]))('rejects malformed UTF-8: %j', async bytes => {
    await expect(collect(instrument([new Uint8Array(bytes)]).chunks)).rejects.toMatchObject({ code: 'invalid_transport' });
  });
  it('requires final LF and reports observed EOF on truncated final input', async () => {
    const source = instrument([encode('{}\n{')]);
    const state = progress();
    const iterator = readFixtureFrames(source.chunks, state);
    expect((await iterator.next()).value?.value).toEqual({});
    await expect(iterator.next()).rejects.toMatchObject({ code: 'input_truncated' });
    expect(state).toEqual({ bytesConsumed: 4, endOfInputObserved: true });
  });
  it('stops at the first delivered empty chunk even from an endless empty producer', async () => {
    const source = instrument([new Uint8Array(), encode('{}\n')]);
    await expect(collect(source.chunks)).rejects.toMatchObject({ code: 'invalid_transport' });
    expect(source.next).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalledTimes(1);
    const next = vi.fn(async () => ({ done: false as const, value: new Uint8Array() }));
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    await expect(collect({ [Symbol.asyncIterator]: () => ({ next, return: close }) })).rejects.toMatchObject({ code: 'invalid_transport' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('accepts 64KiB chunks and rejects one byte above without accepting any bytes', async () => {
    const valid = encode('"' + 'x'.repeat(LIMITS.chunkBytes - 3) + '"\n');
    expect((await collect(instrument([valid]).chunks)).length).toBe(1);
    const source = instrument([new Uint8Array(LIMITS.chunkBytes + 1)]);
    const state = progress();
    await expect(collect(source.chunks, state)).rejects.toMatchObject({ code: 'capacity_exceeded' });
    expect(state.bytesConsumed).toBe(0);
    expect(source.next).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalledTimes(1);
  });
  it('accepts exactly 1MiB before LF and stops at the next byte before decoding', async () => {
    const text = '"' + 'x'.repeat(LIMITS.frameBytes - 2) + '"';
    const chunks = Array.from({ length: 16 }, (_, index) => encode(text.slice(index * LIMITS.chunkBytes, (index + 1) * LIMITS.chunkBytes)));
    expect((await collect(instrument([...chunks, encode('\n')]).chunks))[0].value).toBe('x'.repeat(LIMITS.frameBytes - 2));
    const source = instrument([...chunks, encode('x'), encode('\n')]);
    const state = progress();
    await expect(collect(source.chunks, state)).rejects.toMatchObject({ code: 'capacity_exceeded' });
    expect(source.next).toHaveBeenCalledTimes(17);
    expect(state.bytesConsumed).toBe(LIMITS.frameBytes + 1);
    expect(source.close).toHaveBeenCalledTimes(1);
  });
  it('caps a productive endless stream at the frame ceiling', async () => {
    const next = vi.fn(async () => ({ done: false as const, value: encode(' '.repeat(LIMITS.chunkBytes)) }));
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    await expect(collect({ [Symbol.asyncIterator]: () => ({ next, return: close }) })).rejects.toMatchObject({ code: 'capacity_exceeded' });
    expect(next).toHaveBeenCalledTimes(17);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('enforces exactly 64MiB total accepted bytes and stops before the surplus chunk', async () => {
    const bytes = encode('"' + 'x'.repeat(LIMITS.chunkBytes - 3) + '"\n');
    const source = instrument(Array(1025).fill(bytes));
    const state = progress();
    let count = 0;
    try {
      for await (const frame of readFixtureFrames(source.chunks, state)) { expect(typeof frame.value).toBe('string'); count++; }
      throw new Error('expected capacity failure');
    } catch (error) { expect(error).toMatchObject({ code: 'capacity_exceeded' }); }
    expect(count).toBe(1024);
    expect(state.bytesConsumed).toBe(LIMITS.bytes);
    expect(source.next).toHaveBeenCalledTimes(1025);
    expect(source.close).toHaveBeenCalledTimes(1);
  }, 20_000);
  it('counts the whole accepted delivery on a later failure and commits only yielded frames', async () => {
    const bytes = encode('{}\n{"bad":}\n[]\n');
    const state = progress();
    const source = instrument([bytes]);
    const iterator = readFixtureFrames(source.chunks, state);
    expect((await iterator.next()).value?.value).toEqual({});
    await expect(iterator.next()).rejects.toMatchObject({ code: 'invalid_transport' });
    expect(state).toEqual({ bytesConsumed: bytes.length, endOfInputObserved: false });
    expect(source.next).toHaveBeenCalledTimes(1);
  });
  it('closes the iterator when the consumer stops after one frame', async () => {
    const source = instrument([encode('{}\n[]\n'), encode('0\n')]);
    for await (const frame of readFixtureFrames(source.chunks, progress())) { expect(frame.value).toEqual({}); break; }
    expect(source.next).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalledTimes(1);
  });
  it('checks cancellation before iteration, immediately after reads and between frames', async () => {
    const abort = new AbortController();
    abort.abort();
    const source = instrument([encode('{}\n')]);
    await expect(collect(source.chunks, progress(), abort.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(source.next).not.toHaveBeenCalled();
    const pendingAbort = new AbortController();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const pending = { [Symbol.asyncIterator]: () => ({ next: async () => { pendingAbort.abort(); return { done: false as const, value: encode('{}\n') }; }, return: close }) };
    const state = progress();
    await expect(collect(pending, state, pendingAbort.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(state.bytesConsumed).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    const betweenAbort = new AbortController();
    const between = instrument([encode('{}\n[]\n')]);
    const iterator = readFixtureFrames(between.chunks, progress(), betweenAbort.signal);
    await iterator.next(); betweenAbort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' });
    expect(between.next).toHaveBeenCalledTimes(1);
    expect(between.close).toHaveBeenCalledTimes(1);
  });
  it('reconstructs forged reader InventoryErrors and permits only reader codes', async () => {
    for (const sourceCode of ['PRIVATE_READER_CODE_CANARY', 'invalid_manifest', 'cancelled']) {
      const forged = new InventoryError(sourceCode as never);
      forged.message = 'PRIVATE_READER_MESSAGE_CANARY';
      const bytes = new Uint8Array([10]);
      Object.defineProperty(bytes, Symbol.toStringTag, { get() { throw forged; } });
      const source = instrument([bytes]);
      try { await collect(source.chunks); throw new Error('expected failure'); }
      catch (error) {
        expect(error).toBeInstanceOf(InventoryError);
        expect(error).not.toBe(forged);
        expect((error as InventoryError).code).toBe(sourceCode === 'cancelled' ? 'cancelled' : 'reader_failed');
        expect(String(error) + JSON.stringify(error)).not.toContain('PRIVATE_');
        expect((error as Error).cause).toBeUndefined();
      }
      expect(source.next).toHaveBeenCalledTimes(1);
      expect(source.close).toHaveBeenCalledTimes(1);
    }
  });
  it('scrubs reader and cleanup errors without logs and preserves fixture bytes', async () => {
    const canary = 'PRIVATE_READER_CANARY';
    const bytes = encode('{"secret":"PRIVATE_PAYLOAD_CANARY"}\n');
    const before = bytes.slice();
    const source = instrument([bytes], new Error(canary));
    source.close.mockRejectedValue(new Error(canary));
    const log = vi.spyOn(console, 'log');
    const errorLog = vi.spyOn(console, 'error');
    try { await collect(source.chunks); throw new Error('expected reader failure'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'reader_failed', message: 'reader_failed' });
      expect(String(error)).not.toContain(canary);
      expect(JSON.stringify(error)).not.toContain(canary);
      expect((error as Error).cause).toBeUndefined();
    }
    expect(bytes).toEqual(before);
    expect(log).not.toHaveBeenCalled(); expect(errorLog).not.toHaveBeenCalled();
    log.mockRestore(); errorLog.mockRestore();
    const toxicChunk = new Uint8Array([10]);
    Object.defineProperty(toxicChunk, Symbol.toStringTag, { get() { throw new Error(canary); } });
    await expect(collect(instrument([toxicChunk]).chunks)).rejects.toMatchObject({ code: 'reader_failed', message: 'reader_failed' });
    const broken = { [Symbol.asyncIterator](): AsyncIterator<Uint8Array> { throw new Error(canary); } };
    await expect(collect(broken)).rejects.toMatchObject({ code: 'reader_failed', message: 'reader_failed' });
  });
});
