import { describe, expect, it } from 'vitest';
import { JOIN_CODE, parsePetLaunch, petLaunchCode } from '../codec';

describe('pet launch component boundaries', () => {
  it('rejects a short component whose boundary could be swallowed by join-code underscores', () => {
    // With combined-only validation, the supplied boundary is lost: this wire
    // string parses as short="short_ab" and joinCode="xxxxxxxxxxxxxxxxxxx".
    const join = `ab_${'x'.repeat(19)}`;
    expect(JOIN_CODE.test(join)).toBe(true);
    expect(parsePetLaunch(`p_short_${join}`)).toEqual({ short: 'short_ab', joinCode: 'x'.repeat(19) });
    expect(() => petLaunchCode('short', join)).toThrow('invalid_launch_code');
  });

  it('rejects every undersized short even when a later underscore creates a valid-looking wire split', () => {
    for (let length = 0; length < 8; length++) {
      const short = 'a'.repeat(length), join = `${'b'.repeat(7 - length)}_${'c'.repeat(16)}`;
      expect(JOIN_CODE.test(join)).toBe(true);
      expect(parsePetLaunch(`p_${short}_${join}`)).not.toBeNull();
      expect(() => petLaunchCode(short, join)).toThrow('invalid_launch_code');
    }
  });

  it('rejects oversized shorts instead of moving their suffix into the join code', () => {
    for (const short of ['ABCDEFGH_', 'ABCDEFGH_extra']) {
      const join = 'j'.repeat(16);
      expect(parsePetLaunch(`p_${short}_${join}`)).not.toBeNull();
      expect(() => petLaunchCode(short, join)).toThrow('invalid_launch_code');
    }
  });

  it('round-trips exact components including underscores and both join-length limits', () => {
    for (const short of ['ABCDEFGH', 'ab_cd_ef', '________', '-_-_-_-_']) {
      for (const join of ['j'.repeat(16), '_'.repeat(16), `_${'a'.repeat(51)}_`, '-'.repeat(53)]) {
        const wire = petLaunchCode(short, join);
        expect(wire.length).toBe(11 + join.length); expect(wire.length).toBeLessThanOrEqual(64);
        expect(parsePetLaunch(wire)).toEqual({ short, joinCode: join });
      }
    }
  });

  it('keeps the character restrictions and 16-to-53-character join bounds', () => {
    for (const join of ['', 'j'.repeat(15), 'j'.repeat(54), `${'j'.repeat(15)}!`, 'é'.repeat(16), 'a b'.repeat(6)]) {
      expect(() => petLaunchCode('ABCDEFGH', join)).toThrow('invalid_launch_code');
    }
    for (const short of ['abc defg', 'abc.defg', 'éééééééé']) {
      expect(() => petLaunchCode(short, 'j'.repeat(16))).toThrow('invalid_launch_code');
    }
  });
});
