import { describe, expect, it } from 'vitest';
import { SentenceDetector } from './sentence-detector';

describe('streaming sentence boundaries', () => {
  it.each(['Are you ready today?', 'آیا امروز آماده هستید؟'])('emits a complete question before flush: %s', text => {
    const detector = new SentenceDetector();
    expect(detector.addChunk(`${text} `)).toEqual([{ text, index: 0 }]);
    expect(detector.getBuffer()).toBe('');
    expect(detector.flush()).toBeNull();
  });

  it('retains partial Persian chunks then emits at the question mark', () => {
    const detector = new SentenceDetector();
    expect(detector.addChunk('امروز دربارهٔ جلسه ')).toEqual([]);
    expect(detector.addChunk('چه نظری دارید')).toEqual([]);
    expect(detector.addChunk('؟ ')).toEqual([{ text: 'امروز دربارهٔ جلسه چه نظری دارید؟', index: 0 }]);
    expect(detector.addChunk('Tomorrow sounds good. ')).toEqual([{ text: 'Tomorrow sounds good.', index: 1 }]);
  });

  it('keeps English abbreviations and decimals together', () => {
    const detector = new SentenceDetector();
    expect(detector.addChunk('Dr. ')).toEqual([]);
    expect(detector.addChunk('Morgan measured 3.14 units. ')).toEqual([{ text: 'Dr. Morgan measured 3.14 units.', index: 0 }]);
  });

  it('flushes unfinished text and resets the next sentence index', () => {
    const detector = new SentenceDetector();
    expect(detector.addChunk('A partial thought')).toEqual([]);
    expect(detector.flush()).toEqual({ text: 'A partial thought', index: 0 });
    expect(detector.flush()).toBeNull();
    detector.reset();
    expect(detector.addChunk('حال شما امروز چطور است؟')).toEqual([{ text: 'حال شما امروز چطور است؟', index: 0 }]);
  });
});
