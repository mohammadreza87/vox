/**
 * Cloud Sync Middleware for Zustand
 * Handles synchronization with Firebase/API
 */

import { auth } from '@/lib/firebase';
import { debounce } from '@/shared/utils/debounce';

export interface SyncConfig {
  endpoint: string;
  debounceMs?: number;
  dataKey: string;
  transformForCloud?: <T>(data: T) => unknown;
  transformFromCloud?: <T>(data: unknown) => T;
}

/**
 * Get auth token for API calls
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const token = await auth.currentUser?.getIdToken();
    return token || null;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
}

/**
 * Create a debounced cloud sync function
 */
export function createCloudSync<T>(config: SyncConfig) {
  const {
    endpoint,
    debounceMs = 2000,
    dataKey,
    transformForCloud = (data) => data,
  } = config;

  const syncToCloud = async (data: T): Promise<boolean> => {
    const token = await getAuthToken();
    if (!token) return false;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [dataKey]: transformForCloud(data) }),
      });

      return response.ok;
    } catch (error) {
      console.error(`Error syncing ${dataKey} to cloud:`, error);
      return false;
    }
  };

  // Return debounced version
  return debounce(syncToCloud, debounceMs);
}

/**
 * Load data from cloud
 */
export async function loadFromCloud<T>(
  endpoint: string,
  dataKey: string,
  transformFromCloud?: (data: unknown) => T
): Promise<T | null> {
  const token = await getAuthToken();
  if (!token) return null;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const rawData = data[dataKey];

    if (rawData === undefined) return null;

    return transformFromCloud ? transformFromCloud(rawData) : rawData;
  } catch (error) {
    console.error(`Error loading ${dataKey} from cloud:`, error);
    return null;
  }
}

/**
 * Sync state with cloud on user change
 */
export interface CloudSyncOptions<T> {
  loadFromCloud: () => Promise<T | null>;
  saveToCloud: (data: T) => void;
  loadFromLocalStorage: () => T | null;
  saveToLocalStorage: (data: T) => void;
  onDataLoaded: (data: T) => void;
  getDefaultData: () => T;
}

export async function syncOnUserChange<T>(
  userId: string | null,
  options: CloudSyncOptions<T>
): Promise<void> {
  const {
    loadFromCloud,
    saveToCloud,
    loadFromLocalStorage,
    saveToLocalStorage,
    onDataLoaded,
    getDefaultData,
  } = options;

  if (userId) {
    // User is logged in - try cloud first
    const cloudData = await loadFromCloud();

    if (cloudData !== null) {
      onDataLoaded(cloudData);
      saveToLocalStorage(cloudData);
    } else {
      // Fall back to localStorage
      const localData = loadFromLocalStorage();

      if (localData !== null) {
        onDataLoaded(localData);
        // Sync local data to cloud
        saveToCloud(localData);
      } else {
        onDataLoaded(getDefaultData());
      }
    }
  } else {
    // Not logged in - use localStorage only
    const localData = loadFromLocalStorage();
    onDataLoaded(localData !== null ? localData : getDefaultData());
  }
}
