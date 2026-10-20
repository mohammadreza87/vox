/**
 * Identity confidence library (step S10L). NOT wired: nothing outside
 * src/lib/tireh/identity imports this barrel yet (hint-isolation.test.ts
 * enforces it). Wiring is Step 10 proper.
 */
export * from './types';
export * from './voice-band';
export * from './style-features';
export * from './profile';
export * from './test';
export * from './fusion';
export * from './store';
export * from './service';
