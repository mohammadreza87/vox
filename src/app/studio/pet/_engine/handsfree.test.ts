import { describe, expect, it } from 'vitest';
import { listening, SPEECH } from './extras';
import { CONTENT, harness } from './harness.fixture';

describe('hands-free listening hold (§8A.2)', () => {
  it('leans in with the ears up and slow attentive blinks, and it is not the focus perk', () => {
    const h = harness();
    h.run(500);
    const before = { ...h.engine.debug.pose }, blinks = h.engine.debug.idle;
    h.engine.setListening(true);
    expect(listening(h.engine as never)).toBe(true);
    const kinds = new Set<string>();
    h.run(1500, () => { for (const p of h.engine.debug.playing) kinds.add(p.kind); });
    const p = h.engine.debug.pose;
    // the bunny's ears perk (they draw in the ear groups), the body leans in (a touch bigger), the head tilts
    expect(p.earL - before.earL).toBeGreaterThan(6);
    expect(p.earR - before.earR).toBeLessThan(-6);
    expect(p.sy).toBeGreaterThan(1.02);
    expect(Math.abs(p.headTilt)).toBeGreaterThan(3);
    expect(p.pupil).toBeGreaterThan(1.05);
    expect(h.engine.debug.idle.slowBlinks).toBeGreaterThanOrEqual(0.4);
    expect(h.engine.debug.idle.blinkMedian).toBeGreaterThan(blinks.blinkMedian);
    expect(h.inner.currentMouth()).toBe('smile');
    // it comes on slowly (attend), never the snap perk that talk('listening') plays
    expect(kinds.has('attend')).toBe(true);
    expect(kinds.has('listen')).toBe(false);
    h.engine.setListening(false);
    h.run(2500);
    expect(Math.abs(h.engine.debug.pose.earL - before.earL)).toBeLessThan(0.5);
    expect(h.engine.debug.pose.sy).toBeCloseTo(before.sy, 2);
  });

  it('sits under the talk states: speech plays the perk, thinking and speaking take over, then the hold comes back', () => {
    const h = harness();
    h.engine.setListening(true);
    h.run(1200);
    h.engine.talk('listening', 'mic');
    expect(h.engine.debug.playing.some((p) => p.kind === 'listen')).toBe(true);
    h.run(600);
    h.engine.talk('thinking');
    h.run(1200);
    // thinking: the hold's tilt and lean-in give way to the thinking pose
    expect(h.engine.debug.pose.sy).toBeLessThan(1.02);
    h.engine.talk('idle');
    h.run(1500);
    expect(h.engine.debug.pose.sy).toBeGreaterThan(1.02);
  });

  it('wakes a dozing or sleeping pet, and on reduced motion holds with the face only', () => {
    const h = harness({ mood: { ...CONTENT, asleep: true } });
    h.run(300);
    h.engine.setListening(true);
    h.run(800);
    expect(h.cues.some((c) => c.type === 'care' && c.action === 'wake')).toBe(true);
    const r = harness({ tier: 'reduced' });
    r.engine.setListening(true);
    r.run(1500, () => {
      const f = r.engine.debug.frame!;
      expect(Math.abs(f.body.x) + Math.abs(f.body.y) + Math.abs(f.body.rot) + Math.abs(f.face.x) + Math.abs(f.face.y)).toBeLessThan(1e-6);
    });
    expect(r.engine.debug.pose.pupil).toBeGreaterThan(1.05);
    expect(r.engine.debug.pose.earL).toBe(0);
  });
});

describe('sentence-by-sentence speech (§8A.3)', () => {
  const S = [{ text: 'Hi Sara!', ms: 700 }, { text: 'I watered the seed today.', ms: 1400 }, { text: 'Want to see?', ms: 900 }];

  it('one continuous lip-sync: each sentence opens the mouth, it rests in each short pause, one start and one end', () => {
    const h = harness({ exact: true });
    h.run(300);
    const t0 = h.t;
    h.engine.speakQueue(S);
    const opens: number[] = [0, 0, 0], pauses: number[] = [0, 0];
    let starts = 0, was = false;
    h.run(3600, () => {
      const u = h.t - t0, o = h.inner.lipOut.open;
      const now = h.engine.debug.playing.some((p) => p.kind === 'speakStart');
      if (now && !was) starts++;
      was = now;
      if (u < 560) opens[0] = Math.max(opens[0], o);
      else if (u > 720 && u < 1950) opens[1] = Math.max(opens[1], o);
      else if (u > 2120 && u < 2850) opens[2] = Math.max(opens[2], o);
      // the last ~60 ms of each sentence's pause
      if (u > 640 && u < 700) pauses[0] = Math.max(pauses[0], o);
      if (u > 2040 && u < 2100) pauses[1] = Math.max(pauses[1], o);
    });
    for (const o of opens) expect(o).toBeGreaterThan(0.3);
    for (const o of pauses) expect(o).toBeLessThan(0.15);
    expect(starts).toBe(1);
    const spoken = h.cues.filter((c) => c.type === 'spoken');
    expect(spoken).toHaveLength(1);
    expect(spoken[0].at - t0).toBeGreaterThanOrEqual(2950);
    expect(spoken[0].at - t0).toBeLessThan(3200);
    // a small breath between sentences (talk class), never on reduced motion
    expect(SPEECH.maxPauseMs).toBeLessThanOrEqual(180);
  });

  it('`more` keeps the queue open: a later call appends and goes on; stopSpeaking ends it; durations alone work too', () => {
    const h = harness({ exact: true });
    h.engine.speakQueue([S[0]], { more: true });
    h.run(1500);
    expect(h.cues.some((c) => c.type === 'spoken')).toBe(false);
    expect(h.inner.lipOut.open).toBeLessThan(0.05);
    h.engine.speakQueue([600, 500]);
    let opened = 0;
    h.run(1400, () => { opened = Math.max(opened, h.inner.lipOut.open); });
    expect(opened).toBeGreaterThan(0.3);
    expect(h.cues.filter((c) => c.type === 'spoken')).toHaveLength(1);
    const k = harness({ exact: true });
    k.engine.speakQueue([S[1]], { more: true });
    k.run(400);
    k.engine.stopSpeaking();
    k.run(300);
    expect(k.inner.lipOut.open).toBeLessThan(0.05);
  });

  it('deterministic, keeps speakText working, and takes no body breath on reduced motion', () => {
    const run = () => {
      const h = harness({ seed: 9 });
      h.engine.speakQueue(S);
      const trace: number[] = [];
      h.run(3200, () => trace.push(Math.round(h.inner.lipOut.open * 1000)));
      return trace;
    };
    expect(run()).toEqual(run());
    const r = harness({ tier: 'reduced' });
    r.engine.speakQueue(S);
    let breath = false;
    r.run(3200, () => { breath = breath || r.engine.debug.playing.some((p) => p.kind === 'breath'); });
    expect(breath).toBe(false);
    const f = harness();
    f.engine.speakQueue(S);
    let fb = false;
    f.run(3200, () => { fb = fb || f.engine.debug.playing.some((p) => p.kind === 'breath'); });
    expect(fb).toBe(true);
    const t = harness();
    t.engine.speakText('Hello there.');
    t.run(1500);
    expect(t.cues.filter((c) => c.type === 'spoken')).toHaveLength(1);
  });
});
