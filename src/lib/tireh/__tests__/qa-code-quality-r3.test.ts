/**
 * QA wave A round 3 (code-quality lens): known gaps, written as `it.fails` so
 * the suite stays green and each turns red once the gap is closed (then make it
 * a plain `it`). Pure unit tests: no network, no providers, no filesystem.
 *
 * 1-2. (fixed, fixer r1 on main) Persian opt-out / remember regexes did not
 *      accept ZWNJ or Arabic yeh/kaf; memory/requests.ts now does, for both
 *      the gateway and images/retention.ts.
 * 3.   stripImageMetadata copies everything after the first JPEG SOS verbatim,
 *      so an APPn/COM segment between scans (legal in progressive JPEGs) leaves
 *      the process.
 * 4.   DecisionService maps provider timeouts by error.name, but openai 7.x
 *      error classes never set `name`, so an SDK timeout is reported as
 *      provider_error (decision-log unknownReason is wrong).
 */
import { describe, expect, it } from 'vitest';
import { APIConnectionTimeoutError } from 'openai';
import { explicitRememberRequest, IMAGE_NO_MEMORY } from '../images/retention';
import { stripImageMetadata } from '../images/bytes';
import { DecisionService, type DecisionContext } from '../../adaptive/decisions';

describe('QA r3 code-quality known gaps', () => {
  it('recognises Persian opt-outs written with ZWNJ or an Arabic yeh', () => {
    expect(IMAGE_NO_MEMORY.test('به‌خاطر نسپار')).toBe(true); // ZWNJ, standard orthography
    expect(IMAGE_NO_MEMORY.test('ذخيره نکن')).toBe(true); // Arabic yeh U+064A
  });

  it('recognises a Persian remember request written with ZWNJ', () => {
    expect(explicitRememberRequest('ذخیره‌اش کن')).toBe(true);
  });

  it.fails('removes an APP1 segment that sits between two JPEG scans', () => {
    const canary = [...'Exif\0\0CANARY'].map((c) => c.charCodeAt(0));
    const app1 = [0xff, 0xe1, 0x00, canary.length + 2, ...canary];
    const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
    const bytes = Uint8Array.from([0xff, 0xd8, ...sos, 0x12, 0x34, ...app1, ...sos, 0x56, 0x78, 0xff, 0xd9]);
    const out = Buffer.from(stripImageMetadata(bytes, 'image/jpeg')).toString('latin1');
    expect(out).not.toContain('CANARY');
  });

  it.fails('reports an openai SDK timeout as timeout, not provider_error', async () => {
    const service = new DecisionService({ evaluate: async () => { throw new APIConnectionTimeoutError(); } });
    const context: DecisionContext = {
      enabled: true, revision: 0, currentRevision: () => 0, authorize: async () => 'k',
      loadInput: async () => ({ input: 'text', questions: [{ type: 'predicate', name: 'q0', instructions: 'Q?' }] }),
      deadlineMs: 2000,
    };
    expect(await service.evaluate(context)).toMatchObject({ status: 'unknown', reason: 'timeout' });
  });
});
