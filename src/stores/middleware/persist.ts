/**
 * Persistence Utilities for Zustand Stores
 * Handles localStorage persistence with user-specific keys
 */

export interface PersistConfig {
  name: string;
  getUserId?: () => string | null;
}

/**
 * Get storage key with optional user ID
 */
export function getStorageKey(name: string, userId?: string | null): string {
  return userId ? `${name}_${userId}` : name;
}

/**
 * Load state from localStorage
 */
export function loadPersistedState<T>(config: PersistConfig): T | null {
  if (typeof window === 'undefined') return null;

  try {
    const userId = config.getUserId?.();
    const key = getStorageKey(config.name, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as T;
    }
  } catch (error) {
    console.error(`Error loading state from ${config.name}:`, error);
  }
  return null;
}

/**
 * Save state to localStorage
 */
export function savePersistedState<T>(config: PersistConfig, state: T): void {
  if (typeof window === 'undefined') return;

  try {
    const userId = config.getUserId?.();
    const key = getStorageKey(config.name, userId);
    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.error(`Error saving state to ${config.name}:`, error);
  }
}

/**
 * Clear persisted state
 */
export function clearPersistedState(name: string, userId?: string | null): void {
  if (typeof window === 'undefined') return;

  const key = getStorageKey(name, userId);
  localStorage.removeItem(key);
}

/**
 * Create persist helpers for a specific store
 */
export function createPersistHelpers<T>(config: PersistConfig) {
  return {
    load: () => loadPersistedState<T>(config),
    save: (state: T) => savePersistedState(config, state),
    clear: () => clearPersistedState(config.name, config.getUserId?.()),
  };
}
