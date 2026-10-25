/**
 * Main-lineage sequential-test cases (S10L, earlier run 83848b7,
 * sequential-test.test.ts) ported onto the chosen wave A implementation
 * (aiq/identity-lib b34b7c0). API rename: giniCoefficient -> gini. Main's
 * CUSUM test, calibration and autoDisable APIs do not exist in wave A; those
 * cases are listed in docs/implementation/agent-intelligence/WAVE_A_MAIN_INTEGRATION.md.
 */
import { describe, expect, it } from 'vitest';
import { gini } from '../test';

describe('main-lineage: Gini auto-disable', () => {
  it('computes the Gini coefficient', () => {
    expect(gini([])).toBe(0);
    expect(gini([2, 2, 2, 2])).toBe(0);
    expect(gini([0, 0, 0, 1])).toBe(0.75);
    expect(gini([0, 0])).toBe(0);
  });
});
