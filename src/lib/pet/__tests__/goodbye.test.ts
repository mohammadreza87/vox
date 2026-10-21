import { describe, expect, it } from 'vitest';
import { isGoodbye } from '../goodbye';
import { PET_SURFACE_FRAME } from '../../tireh/gateway';

describe('goodbye intent', () => {
  it.each(['bye', 'ok bye!', 'Bye bye Mochi', 'good night', 'Goodnight :)', 'gn', 'see ya', 'gotta go', 'ttyl', 'sweet dreams',
    'خداحافظ', 'شب بخیر', 'شب‌بخیر', 'باشه بای'])('"%s" is a goodbye', (text) => {
    expect(isGoodbye(text)).toBe(true);
  });

  it.each(['', 'byte me', 'nightly build', 'I will do it later', 'goodbyeee', 'بایت',
    `see you at the meeting, then we can go over the long plan for the launch and the next release together`])('"%s" is not', (text) => {
    expect(isGoodbye(text)).toBe(false);
  });
});

describe('pet surface persona hint', () => {
  it('keeps replies short and bans all six exit-manipulation tactics', () => {
    expect(PET_SURFACE_FRAME).toMatch(/1-2 short sentences/);
    expect(PET_SURFACE_FRAME).toMatch(/exactly one warm line/);
    for (const tactic of [
      /leaving too early/, // premature exit
      /miss something/, // fear of missing out
      /lonely or sad without them/, // emotional neglect
      /pressure them to reply/, // pressure to respond
      /ignore the goodbye/, // ignoring the goodbye
      /cannot or should not leave/, // coercive restraint
    ]) expect(PET_SURFACE_FRAME).toMatch(tactic);
  });
});
