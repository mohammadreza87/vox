import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { FirestoreVoiceprintStore } from '../identity/store';
import { VoiceprintService } from '../identity/voice';
import { ID, makeStudio, memberOf, seedOrg } from './helpers';
import { fakeFirestore, setupVoiceprints } from './voiceprint-fixtures';

const CANARY = 'VOX_AUDIO_CANARY_7f3e';
const AUDIO_TEXT = `SPEAKER:reza|${CANARY}`;
const audio = () => { const bytes = new TextEncoder().encode(AUDIO_TEXT); const out = new ArrayBuffer(bytes.byteLength); new Uint8Array(out).set(bytes); return out; };
const FORBIDDEN = [
  CANARY, Buffer.from(CANARY).toString('base64'), Buffer.from(CANARY).toString('base64url'), Buffer.from(CANARY).toString('hex'),
  Buffer.from(AUDIO_TEXT).toString('base64'), Buffer.from(AUDIO_TEXT).toString('hex'),
  'TPL:', Buffer.from('TPL:reza').toString('base64').slice(0, 8), Buffer.from('TPL:').toString('hex'),
];
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
function expectClean(label: string, text: string) {
  for (const needle of FORBIDDEN) expect(text.includes(needle), `${label} contains ${needle}`).toBe(false);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('no audio bytes or plaintext templates are persisted or logged', () => {
  it('enroll and verify leave no canary in files, Firestore docs, logs or audit rows', async () => {
    const consoleCalls = ['log', 'info', 'warn', 'error', 'debug'].map(m => vi.spyOn(console, m as 'log').mockImplementation(() => undefined));
    const h = makeStudio();
    await seedOrg(h);
    const s = await setupVoiceprints({ telegramId: ID.alice, store: 'file' });
    h.studio.deps.voiceprints = s.service;
    const alice = await memberOf(h, ID.alice);
    expect((await h.studio.enrollVoice(alice, audio(), 'audio/webm')).enrolled).toBe(true);
    await s.grantAgent('aria');
    const note = { personaId: 'aria', personId: s.personId, space: 'work' as const, chatKind: 'private' as const, guestAudience: false,
      audio: audio(), mimeType: 'audio/ogg', durationSec: 6, channel: 'telegram_voice_note' as const };
    expect((await s.service.verifyVoiceNote(note)).band).toBe('MATCH');

    const firestore = fakeFirestore();
    const remote = new VoiceprintService({ ...s.service.deps, store: new FirestoreVoiceprintStore(firestore.db) });
    await remote.enroll({ telegramId: s.telegramId, personId: s.personId, space: 'work', audio: audio(), mimeType: 'audio/webm', channel: 'mini_app' });
    expect((await remote.verifyVoiceNote(note)).band).toBe('MATCH');

    const scanned = [...files(h.dir), ...files(s.directory)];
    expect(scanned.some(f => f.endsWith('voiceprints-v1.json'))).toBe(true);
    for (const file of scanned) expectClean(file, readFileSync(file).toString('latin1'));
    const stored = JSON.parse(readFileSync(join(s.directory, 'voiceprints-v1.json'), 'utf8')) as { rows: Array<{ template: string }>; echo: Array<{ template: string }> };
    expect([...stored.rows, ...stored.echo].every(r => r.template.startsWith('vpk1.'))).toBe(true);
    expect(firestore.docs.size).toBeGreaterThan(0);
    for (const [id, doc] of firestore.docs) {
      expectClean(`firestore ${id}`, JSON.stringify(doc));
      expect(String(doc.template).startsWith('vpk1.')).toBe(true);
    }
    const logs = JSON.stringify([...consoleCalls.map(c => c.mock.calls), h.logger.info.mock.calls, h.logger.warn.mock.calls, h.logger.error.mock.calls]);
    expectClean('logs', logs);
    expectClean('audit', JSON.stringify((await h.store.read()).audit));
  });
});
