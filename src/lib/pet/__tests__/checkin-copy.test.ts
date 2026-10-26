/** The server's check-in copy (design §5.3-§5.4) is generated from the keys file and matches the page's catalogue. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEYS_DOC, parseKeysDoc, renderCheckinCopy, SERVER_CHECKIN_FILE } from '../../../app/studio/pet/_ui/strings/generate.mjs';
import { EN as PAGE_EN } from '../../../app/studio/pet/_ui/strings/en';
import { FA as PAGE_FA } from '../../../app/studio/pet/_ui/strings/fa';
import { CHECKIN_VOICE, EN, FA, type CheckinCopyKey } from '../checkin-copy';
import { CHECKIN_MOMENTS, CHECKIN_TYPE_COPY } from '../checkins';

describe('checkin-copy.ts', () => {
  it('is exactly what the generator writes today (rerun generate.mjs after editing the keys file)', () => {
    const rows = parseKeysDoc(readFileSync(KEYS_DOC, 'utf8'));
    expect(readFileSync(SERVER_CHECKIN_FILE, 'utf8')).toBe(renderCheckinCopy(rows));
  });

  it('holds every ci.* key and the P1 sheet, as variant arrays, the same text as the page, frozen', () => {
    const keys = Object.keys(EN) as CheckinCopyKey[];
    expect(keys.filter((k) => k.startsWith('ci.'))).toEqual(Object.keys(PAGE_EN).filter((k) => /^(ci|dm|checkin)\./.test(k)));
    expect(keys).toEqual(expect.arrayContaining(['perm.P1.title', 'perm.P1.body', 'perm.P1.yes', 'ci.btn.open', 'ci.btn.why', 'ci.btn.stop', 'ci.btn.stopAll', 'ci.paused.title']));
    for (const key of keys) {
      expect(Array.isArray(EN[key]) && EN[key].length >= 1).toBe(true);
      const page = (PAGE_EN as Record<string, string | string[]>)[key];
      expect([...EN[key]]).toEqual(Array.isArray(page) ? page : [page]);
      const fa = (PAGE_FA as Record<string, string | string[] | undefined>)[key];
      if (fa !== undefined) expect([...FA[key]!]).toEqual(Array.isArray(fa) ? fa : [fa]);
      expect(Object.isFrozen(EN[key])).toBe(true);
    }
    expect(Object.isFrozen(EN) && Object.isFrozen(FA) && Object.isFrozen(CHECKIN_VOICE)).toBe(true);
    expect(CHECKIN_VOICE['ci.C2.stageUp']).toBe('pet');
    expect(CHECKIN_VOICE['ci.why.growing']).toBe('system');
    expect(CHECKIN_VOICE['ci.btn.stop']).toBe('person');
  });

  it('every catalogue moment and type names a template that exists in both languages', () => {
    for (const m of Object.values(CHECKIN_MOMENTS)) { expect(EN[m.template]).toBeDefined(); expect(FA[m.template]).toBeDefined(); }
    for (const t of Object.values(CHECKIN_TYPE_COPY)) { expect(EN[t.why]).toBeDefined(); expect(EN[t.category]).toBeDefined(); }
  });
});
