/**
 * Contacts Store
 * Manages custom contacts with localStorage and cloud sync
 */

import { create } from 'zustand';
import { PreMadeContactConfig } from '@/shared/types';
import { getCustomContactsKey } from '@/shared/utils/storage';
import { getCurrentUserId } from './authStore';
import { createCloudSync, loadFromCloud } from './middleware/sync';
import type { ContactsStore } from './types';

// Cloud sync configuration
const contactsCloudSync = createCloudSync<PreMadeContactConfig[]>({
  endpoint: '/api/user/data',
  debounceMs: 1000,
  dataKey: 'customContacts',
});

export const useContactsStore = create<ContactsStore>((set, get) => ({
  // State
  customContacts: [],
  isLoading: false,

  // Actions
  setContacts: (contacts) => set({ customContacts: contacts }),
  setLoading: (isLoading) => set({ isLoading }),

  addContact: (contact: PreMadeContactConfig) => {
    set((state) => {
      const newContacts = [...state.customContacts, contact];

      // Sync
      saveToLocalStorage(newContacts);
      contactsCloudSync(newContacts);

      return { customContacts: newContacts };
    });
  },

  updateContact: (contactId: string, updates: Partial<PreMadeContactConfig>) => {
    set((state) => {
      const newContacts = state.customContacts.map((contact) =>
        contact.id === contactId ? { ...contact, ...updates } : contact
      );

      // Sync
      saveToLocalStorage(newContacts);
      contactsCloudSync(newContacts);

      return { customContacts: newContacts };
    });
  },

  deleteContact: (contactId: string) => {
    set((state) => {
      const newContacts = state.customContacts.filter((contact) => contact.id !== contactId);

      // Sync
      saveToLocalStorage(newContacts);
      contactsCloudSync(newContacts);

      return { customContacts: newContacts };
    });
  },

  getContact: (contactId: string) => {
    return get().customContacts.find((c) => c.id === contactId);
  },

  loadContacts: async () => {
    const userId = getCurrentUserId();
    set({ isLoading: true });

    try {
      if (userId) {
        // Try cloud first
        const cloudContacts = await loadFromCloud<PreMadeContactConfig[]>(
          '/api/user/data',
          'customContacts'
        );

        if (cloudContacts && cloudContacts.length > 0) {
          set({ customContacts: cloudContacts });
          saveToLocalStorage(cloudContacts);
        } else {
          // Fall back to localStorage
          const localContacts = loadFromLocalStorage();
          if (localContacts.length > 0) {
            set({ customContacts: localContacts });
            // Sync to cloud
            contactsCloudSync(localContacts);
          }
        }
      } else {
        // Not logged in - use localStorage only
        const localContacts = loadFromLocalStorage();
        set({ customContacts: localContacts });
      }
    } catch (error) {
      console.error('Error loading contacts:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  syncToCloud: async () => {
    const { customContacts } = get();
    contactsCloudSync(customContacts);
  },

  refreshContacts: async () => {
    const userId = getCurrentUserId();
    if (!userId) return;

    set({ isLoading: true });

    try {
      const cloudContacts = await loadFromCloud<PreMadeContactConfig[]>(
        '/api/user/data',
        'customContacts'
      );

      if (cloudContacts !== null) {
        set({ customContacts: cloudContacts });
        saveToLocalStorage(cloudContacts);
      }
    } catch (error) {
      console.error('Error refreshing contacts:', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));

// Local storage helpers
function getStorageKey(): string {
  const userId = getCurrentUserId();
  return getCustomContactsKey(userId);
}

function saveToLocalStorage(contacts: PreMadeContactConfig[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getStorageKey(), JSON.stringify(contacts));
}

function loadFromLocalStorage(): PreMadeContactConfig[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(getStorageKey());
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error loading contacts from localStorage:', error);
    return [];
  }
}

/**
 * Initialize contacts - call this when user state changes
 */
export async function initContacts(): Promise<void> {
  const store = useContactsStore.getState();
  await store.loadContacts();
}
