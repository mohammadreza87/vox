/**
 * Browser stubs shared by the test setup. Tests import the helpers to flip a
 * media query or make storage throw the way Safari private mode does.
 */
import { vi } from 'vitest';

let queries: Record<string, boolean> = {};
let storageThrows = false;
const memory = new Map<string, string>();

const guard = () => { if (storageThrows) throw new DOMException('The operation is insecure.', 'SecurityError'); };

export const memoryStorage = {
  getItem: vi.fn((k: string) => { guard(); return memory.has(k) ? memory.get(k)! : null; }),
  setItem: vi.fn((k: string, v: string) => { guard(); memory.set(k, String(v)); }),
  removeItem: vi.fn((k: string) => { guard(); memory.delete(k); }),
  clear: vi.fn(() => { guard(); memory.clear(); }),
  key: vi.fn((i: number) => [...memory.keys()][i] ?? null),
  get length() { return memory.size; },
};

/** Every localStorage call throws until the next test (or breakLocalStorage(false)). */
export function breakLocalStorage(on = true) { storageThrows = on; }

/** matchMedia answers: e.g. setMediaQueries({ '(prefers-reduced-motion: reduce)': true }). */
export function setMediaQueries(map: Record<string, boolean>) { queries = { ...map }; }

// Plain functions, not vi.fn: a test file's vi.resetAllMocks() must not wipe the stubs framer-motion
// (useReducedMotion, useInView) reads, or every motion component in that file throws.
export function stubMatchMedia() {
  const noop = () => undefined;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: !!queries[query],
      media: query,
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    }),
  });
}

export function stubIntersectionObserver() {
  global.IntersectionObserver = class implements IntersectionObserver {
    readonly root = null; readonly rootMargin = '0px'; readonly thresholds = [0];
    private watched = new Set<Element>();
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.watched.add(target);
      queueMicrotask(() => {
        if (!this.watched.has(target)) return;
        const rect = target.getBoundingClientRect();
        this.callback([{ target, isIntersecting: true, intersectionRatio: 1, time: 0, boundingClientRect: rect, intersectionRect: rect, rootBounds: null }], this);
      });
    }
    unobserve(target: Element) { this.watched.delete(target); }
    disconnect() { this.watched.clear(); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
  };
}

/** Runs before each test: empty storage, storage working, no media query matching. */
export function resetBrowserStubs() {
  storageThrows = false;
  memory.clear();
  queries = {};
}
