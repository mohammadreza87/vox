import '@testing-library/jest-dom';
import { MotionGlobalConfig } from 'framer-motion';
import { beforeEach, vi } from 'vitest';
import { memoryStorage, resetBrowserStubs, stubIntersectionObserver, stubMatchMedia } from './browser';

// Animations complete instantly: tests assert end states, not timing.
MotionGlobalConfig.skipAnimations = true;

// Mock Firebase
vi.mock('@/lib/firebase', () => ({
  auth: {
    currentUser: null,
    onAuthStateChanged: vi.fn((callback) => {
      callback(null);
      return vi.fn(); // unsubscribe function
    }),
  },
  db: {},
  storage: {},
}));

// Mock Firebase Admin
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn().mockResolvedValue(null),
  extractBearerToken: vi.fn().mockReturnValue(null),
  adminDb: {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ exists: false }),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useParams: () => ({}),
}));

// Mock window.matchMedia (no query matches unless a test calls setMediaQueries)
stubMatchMedia();

// In-memory localStorage behind vi.fn spies; a test can make it throw (private mode) with breakLocalStorage()
Object.defineProperty(window, 'localStorage', {
  value: memoryStorage,
});
beforeEach(resetBrowserStubs);

// Mock document.documentElement.classList
Object.defineProperty(document.documentElement, 'classList', {
  value: {
    add: vi.fn(),
    remove: vi.fn(),
    contains: vi.fn(() => false),
  },
});

// Mock document.querySelector for theme-color meta tag
vi.spyOn(document, 'querySelector').mockImplementation(() => ({
  setAttribute: vi.fn(),
} as unknown as Element));

// Inert ResizeObserver: a plain class, so it constructs with `new` and survives vi.resetAllMocks()
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

// IntersectionObserver that reports every observed element as in view
stubIntersectionObserver();
