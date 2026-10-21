import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareRequest } from '@/lib/pet/types';
import { PetApp } from './PetApp';
import { createMockApi } from './mock';

/**
 * The whole loop with the real engine (no mocks below PetApp): the ?mock=1 API answers with care.ts, so
 * open → hello, touch, feed, Bop, sleep and talk all run end to end in jsdom.
 */

function liveApi() {
  const api = createMockApi({ latency: { care: 5, talk: 40 } });
  const posted: CareRequest[] = [];
  const care = api.care;
  api.care = (id, req, o) => { posted.push(req); return care(id, req, o); };
  return { api, posted };
}

const bubbleText = (c: HTMLElement) => c.querySelector('.pet-bubble')?.textContent ?? '';

describe('PetApp live (real engine, mock API)', () => {
  beforeEach(() => {
    // These interaction cases require a waking pet, independently of the machine's wall clock.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    window.history.replaceState({}, '', '/studio/pet/mock');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it('opens with hello, eats a tapped cookie, and posts the feed once the bite lands', async () => {
    const { api, posted } = liveApi();
    const { container } = render(<PetApp agentId="mock" api={api} />);
    await waitFor(() => expect(bubbleText(container)).toContain('Hi'), { timeout: 3000 });
    const body = container.querySelector<HTMLElement>('.pet-body')!;
    expect(body.style.getPropertyValue('--pet-by')).not.toBe('');
    const cookie = container.querySelector<HTMLElement>('[data-toy="cookie"]')!;
    act(() => {
      fireEvent.pointerDown(cookie, { pointerId: 1, clientX: 60, clientY: 700 });
      fireEvent.pointerUp(cookie, { pointerId: 1, clientX: 60, clientY: 700 });
    });
    await waitFor(() => expect(posted.map((p) => p.action)).toContain('feed'), { timeout: 3000 });
  });

  it('pokes in the pointerdown frame, starts a Bop round, and talks back with a reply bubble', async () => {
    const { api, posted } = liveApi();
    const { container, findByRole } = render(<PetApp agentId="mock" api={api} />);
    await waitFor(() => expect(container.querySelector('.pet-body svg')).toBeTruthy(), { timeout: 3000 });
    const stage = container.querySelector<HTMLElement>('.pet-stage')!;
    const char = container.querySelector<HTMLElement>('.pet-char')!;
    const box = { x: parseFloat(char.style.left), y: parseFloat(char.style.top), size: parseFloat(char.style.width) };
    const body = container.querySelector<HTMLElement>('.pet-body')!;
    const before = body.style.transform;
    act(() => { fireEvent.pointerDown(stage, { pointerId: 2, clientX: box.x + box.size / 2, clientY: box.y + box.size * 0.7 }); });
    // the engine wrote the squash in the handler; framer paints it on its next render step
    await waitFor(() => expect(body.style.transform).not.toBe(before));
    act(() => { fireEvent.pointerUp(stage, { pointerId: 2, clientX: box.x + box.size / 2, clientY: box.y + box.size * 0.7 }); });

    const ball = container.querySelector<HTMLElement>('[data-toy="ball"]')!;
    act(() => { fireEvent.click(ball); });
    await waitFor(() => expect(posted.map((p) => p.action)).toContain('play'), { timeout: 3000 });
    expect(container.querySelector('.pet-score')).toBeTruthy();

    const input = await findByRole('textbox');
    act(() => { fireEvent.focus(input); });
    expect(container.querySelector('[data-talk="listening"]')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'tell me something' } });
    act(() => { fireEvent.submit(input.closest('form')!); });
    expect(container.querySelector('[data-talk="thinking"]')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('[data-talk="speaking"]')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(bubbleText(container).length).toBeGreaterThan(10), { timeout: 3000 });
  });

  it('the moon puts it to sleep (lights down, care posted), and two taps anywhere wake it', async () => {
    const { api, posted } = liveApi();
    const { container } = render(<PetApp agentId="mock" api={api} />);
    // after the hello (a hello mid-yawn would interrupt the bedtime sequence)
    await waitFor(() => expect(bubbleText(container)).toContain('Hi'), { timeout: 3000 });
    const moon = container.querySelector<HTMLElement>('[data-toy="moon"]')!;
    act(() => { fireEvent.click(moon); });
    await waitFor(() => expect(posted.map((p) => p.action)).toContain('sleep'), { timeout: 8000 });
    await waitFor(() => expect(container.querySelector('[data-asleep]')).toBeTruthy(), { timeout: 3000 });
    const stage = container.querySelector<HTMLElement>('.pet-stage')!;
    // far off the character: asleep, a tap anywhere counts
    for (const id of [5, 6]) act(() => {
      fireEvent.pointerDown(stage, { pointerId: id, clientX: 20, clientY: 120 });
      fireEvent.pointerUp(stage, { pointerId: id, clientX: 20, clientY: 120 });
    });
    await waitFor(() => expect(posted.map((p) => p.action)).toContain('wake'), { timeout: 3000 });
    await waitFor(() => expect(container.querySelector('[data-asleep]')).toBeNull(), { timeout: 3000 });
  }, 20000);
});
