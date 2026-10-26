import { describe, expect, it } from 'vitest';
import { isGoodbye } from '../goodbye';
import { PET_SURFACE_FRAME, PET_SURFACE_FRAME_VOICE } from '../../tireh/gateway';

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
  it.each([['typed', PET_SURFACE_FRAME], ['spoken', PET_SURFACE_FRAME_VOICE]])('%s: keeps replies short and bans all six exit-manipulation tactics', (_, frame) => {
    expect(frame).toMatch(/1-2 short sentences/);
    expect(frame).toMatch(/exactly one warm line/);
    for (const tactic of [
      /leaving too early/, // premature exit
      /miss something/, // fear of missing out
      /lonely or sad without them/, // emotional neglect
      /pressure them to reply/, // pressure to respond
      /ignore the goodbye/, // ignoring the goodbye
      /cannot or should not leave/, // coercive restraint
    ]) expect(frame).toMatch(tactic);
  });

  it('the spoken frame is the typed frame plus one sentence: the person spoke and is listening', () => {
    expect(PET_SURFACE_FRAME_VOICE.startsWith(`${PET_SURFACE_FRAME} `)).toBe(true);
    expect(PET_SURFACE_FRAME_VOICE.slice(PET_SURFACE_FRAME.length + 1)).toBe('The person said this out loud and is listening for your reply; answer as speech.');
  });
});
