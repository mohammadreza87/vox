import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterLook } from '@/lib/studio/types';
import { Drafting } from './Drafting.design';

type FaceProps = { look: CharacterLook; moment?: { kind: string } | null };
const faces = vi.hoisted(() => ({ renders: [] as FaceProps[] }));
vi.mock('../../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../Cloud')>();
  return { ...actual, Cloud: (p: FaceProps) => { faces.renders.push(p); return null; } };
});

const drafted: CharacterLook = { hue: 'mint', family: 'drift', features: { cheeks: true, lashes: true, brows: false }, species: 'fox' } as CharacterLook;
const last = () => faces.renders[faces.renders.length - 1];

beforeEach(() => { vi.useFakeTimers(); faces.renders = []; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Drafting reveal (motion §4.9)', () => {
  it('keeps forming sample looks through the last gather beat, then swaps to the draft with the poof', async () => {
    const view = render(<Drafting look={null} />);
    expect(last().look).not.toBe(drafted);
    view.rerender(<Drafting look={drafted} />);
    expect(last().look).not.toBe(drafted); // the gather beat: no early reveal
    expect(last().moment ?? null).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    // the look and the poof land in the same render, so the swap happens under the poof's hidden frame
    const firstDrafted = faces.renders.find((p) => p.look === drafted);
    expect(firstDrafted?.moment?.kind).toBe('poof');
  });
});
