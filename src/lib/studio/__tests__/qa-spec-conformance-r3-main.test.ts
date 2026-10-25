/**
 * QA wave A on main, round 3 (spec-conformance lens).
 *
 * Port of main's dropped `voiceprint-no-audio.test.ts` ("enroll and verify leave no canary in files, Firestore
 * docs, logs or audit rows") onto wave A's voiceprint API. WAVE_A_MAIN_INTEGRATION.md (S11L) records it as
 * replaced by `voiceprint-storage` "no audio, transcript or score is persisted or logged", but that case scans
 * only the voiceprints file and the service logger. Main's case also went through `Studio.enrollVoice` and
 * scanned every file under the Studio data directory and the Studio audit rows. This keeps that coverage.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ID, makeStudio, memberOf, seedOrg } from './helpers';
import { AUDIO_CANARY, AUDIO_CANARY_TEXT, audioBuffer, setupVoiceprints, TEMPLATE_CANARY } from './voiceprint-fixtures';

const forms = (text: string) => {
  const bytes = Buffer.from(text, 'utf8');
  return [text, bytes.toString('base64'), bytes.toString('base64url'), bytes.toString('hex')];
};
const FORBIDDEN = [...forms(AUDIO_CANARY_TEXT), ...forms(TEMPLATE_CANARY), Buffer.from(AUDIO_CANARY).toString('base64'), Buffer.from(AUDIO_CANARY).toString('hex')];
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
function expectClean(label: string, text: string) {
  for (const needle of FORBIDDEN) expect(text.includes(needle), `${label} contains ${needle}`).toBe(false);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('S11L through Studio: no audio bytes or plaintext templates are persisted or logged (main voiceprint-no-audio, ported)', () => {
  it('Studio.enrollVoice and a voice-note verification leave no canary in Studio files, voiceprint files, logs or audit rows', async () => {
    const consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => undefined));
    const h = makeStudio();
    await seedOrg(h);
    const s = await setupVoiceprints({ telegramId: ID.alice, store: 'file' });
    h.studio.deps.voiceprints = s.service;
    const alice = await memberOf(h, ID.alice);
    expect((await h.studio.enrollVoice(alice, audioBuffer(), 'audio/webm', 'work')).enrolled).toBe(true);
    expect((await s.service.verifyVoiceNote(s.voiceNote())).band).toBe('MATCH');

    const scanned = [...files(h.dir), ...files(s.directory)];
    expect(scanned.some(f => f.endsWith('voiceprints-v1.json'))).toBe(true);
    for (const file of scanned) expectClean(file, readFileSync(file).toString('latin1'));
    const logs = JSON.stringify([...consoleCalls.map(c => c.mock.calls), h.logger.info.mock.calls, h.logger.warn.mock.calls,
      h.logger.error.mock.calls, s.logger.info.mock.calls, s.logger.warn.mock.calls, s.logger.error.mock.calls]);
    expectClean('logs', logs);
    expectClean('audit', JSON.stringify((await h.store.read()).audit));
  });
});
