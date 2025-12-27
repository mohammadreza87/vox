/**
 * Debounce Utility
 * Delays function execution until after a specified wait period
 * Used for cloud sync, search, and other rate-limited operations
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

/**
 * Debounce with immediate option
 * Executes immediately on first call, then debounces subsequent calls
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounceImmediate<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>) => {
    lastArgs = args;

    if (!timeout) {
      // Execute immediately on first call
      func(...args);
      timeout = setTimeout(() => {
        timeout = null;
        // Execute again if there were calls during the wait period
        if (lastArgs && lastArgs !== args) {
          func(...lastArgs);
        }
      }, wait);
    }
  };
}

/**
 * Throttle Utility
 * Ensures function executes at most once per specified interval
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      func(...args);
    }
  };
}

/**
 * Async debounce that returns a promise
 * Useful for debouncing async operations like API calls
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  let timeout: NodeJS.Timeout | null = null;
  let pendingPromise: Promise<Awaited<ReturnType<T>>> | null = null;
  let resolve: ((value: Awaited<ReturnType<T>>) => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;

  return (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (!pendingPromise) {
      pendingPromise = new Promise<Awaited<ReturnType<T>>>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    }

    timeout = setTimeout(async () => {
      try {
        const result = await func(...args);
        resolve?.(result);
      } catch (error) {
        reject?.(error);
      } finally {
        pendingPromise = null;
        resolve = null;
        reject = null;
      }
    }, wait);

    return pendingPromise;
  };
}
