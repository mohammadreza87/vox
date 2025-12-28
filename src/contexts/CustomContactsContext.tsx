'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import { PreMadeContactConfig } from '@/shared/types';
import { useAuth } from './AuthContext';
import { getCustomContactsKey } from '@/shared/utils/storage';
import { auth } from '@/lib/firebase';

interface CustomContactsContextType {
  customContacts: PreMadeContactConfig[];
  addContact: (contact: PreMadeContactConfig) => Promise<void>;
  updateContact: (contactId: string, updates: Partial<PreMadeContactConfig>) => Promise<void>;
  deleteContact: (contactId: string) => Promise<void>;
  getContact: (contactId: string) => PreMadeContactConfig | undefined;
  isLoading: boolean;
  refreshContacts: () => Promise<void>;
}

const CustomContactsContext = createContext<CustomContactsContextType | undefined>(undefined);

// Debounce function for cloud sync
function debounce<T extends (...args: Parameters<T>) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function CustomContactsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [customContacts, setCustomContacts] = useState<PreMadeContactConfig[]>([]);
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const previousUserIdRef = useRef<string | null>(null);

  // Save contacts to cloud
  const saveToCloud = useCallback(async (contactsToSave: PreMadeContactConfig[]) => {
    if (!user) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      await fetch('/api/user/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ customContacts: contactsToSave }),
      });
    } catch (error) {
      console.error('Error saving contacts to cloud:', error);
    }
  }, [user]);

  // Debounced cloud sync
  const debouncedSaveToCloud = useCallback(
    debounce((contactsToSave: PreMadeContactConfig[]) => {
      saveToCloud(contactsToSave);
    }, 1000),
    [saveToCloud]
  );

  // Load contacts from cloud
  const loadFromCloud = useCallback(async (): Promise<PreMadeContactConfig[] | null> => {
    if (!user) return null;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;

      const response = await fetch('/api/user/data', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data.customContacts || [];
    } catch (error) {
      console.error('Error loading contacts from cloud:', error);
      return null;
    }
  }, [user]);

  // Refresh contacts from cloud
  const refreshContacts = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    const cloudContacts = await loadFromCloud();
    if (cloudContacts !== null) {
      setCustomContacts(cloudContacts);
      const storageKey = getCustomContactsKey(user.uid);
      localStorage.setItem(storageKey, JSON.stringify(cloudContacts));
    }
    setIsLoading(false);
  }, [user, loadFromCloud]);

  // Load contacts when user changes
  useEffect(() => {
    setMounted(true);
    const currentUserId = user?.uid || null;

    if (previousUserIdRef.current !== currentUserId) {
      previousUserIdRef.current = currentUserId;

      const loadContacts = async () => {
        if (currentUserId) {
          setIsLoading(true);

          // Try to load from cloud first
          const cloudContacts = await loadFromCloud();

          if (cloudContacts !== null && cloudContacts.length > 0) {
            setCustomContacts(cloudContacts);
            const storageKey = getCustomContactsKey(currentUserId);
            localStorage.setItem(storageKey, JSON.stringify(cloudContacts));
          } else {
            // Fall back to localStorage
            const storageKey = getCustomContactsKey(currentUserId);
            const savedContacts = localStorage.getItem(storageKey);

            if (savedContacts) {
              try {
                const parsed = JSON.parse(savedContacts);
                setCustomContacts(parsed);

                // Sync localStorage data to cloud if it exists
                if (parsed.length > 0) {
                  saveToCloud(parsed);
                }
              } catch (e) {
                console.error('Error loading contacts:', e);
                setCustomContacts([]);
              }
            } else {
              setCustomContacts([]);
            }
          }

          setIsLoading(false);
        } else {
          // Not logged in - use localStorage
          const storageKey = getCustomContactsKey(null);
          const savedContacts = localStorage.getItem(storageKey);

          if (savedContacts) {
            try {
              setCustomContacts(JSON.parse(savedContacts));
            } catch (e) {
              console.error('Error loading contacts:', e);
              setCustomContacts([]);
            }
          } else {
            setCustomContacts([]);
          }
        }
      };

      loadContacts();
    }
  }, [user, loadFromCloud, saveToCloud]);

  // Save contacts to localStorage and cloud when they change
  useEffect(() => {
    if (mounted) {
      const storageKey = getCustomContactsKey(user?.uid || null);
      localStorage.setItem(storageKey, JSON.stringify(customContacts));

      // Also sync to cloud (debounced)
      if (user) {
        debouncedSaveToCloud(customContacts);
      }
    }
  }, [customContacts, mounted, user, debouncedSaveToCloud]);

  // Add contact with immediate cloud sync (not debounced) to prevent race conditions
  const addContact = useCallback(async (contact: PreMadeContactConfig) => {
    const newContacts = [...customContacts, contact];
    setCustomContacts(newContacts);

    // Save to localStorage immediately
    const storageKey = getCustomContactsKey(user?.uid || null);
    localStorage.setItem(storageKey, JSON.stringify(newContacts));

    // Save to cloud immediately (not debounced) for new contacts
    if (user) {
      await saveToCloud(newContacts);
    }
  }, [customContacts, user, saveToCloud]);

  // Update contact with immediate cloud sync
  const updateContact = useCallback(async (contactId: string, updates: Partial<PreMadeContactConfig>) => {
    const newContacts = customContacts.map(contact =>
      contact.id === contactId ? { ...contact, ...updates } : contact
    );
    setCustomContacts(newContacts);

    // Save to localStorage immediately
    const storageKey = getCustomContactsKey(user?.uid || null);
    localStorage.setItem(storageKey, JSON.stringify(newContacts));

    // Save to cloud immediately for updates
    if (user) {
      await saveToCloud(newContacts);
    }
  }, [customContacts, user, saveToCloud]);

  // Delete contact with immediate cloud sync
  const deleteContact = useCallback(async (contactId: string) => {
    const newContacts = customContacts.filter(contact => contact.id !== contactId);
    setCustomContacts(newContacts);

    // Save to localStorage immediately
    const storageKey = getCustomContactsKey(user?.uid || null);
    localStorage.setItem(storageKey, JSON.stringify(newContacts));

    // Save to cloud immediately for deletes
    if (user) {
      await saveToCloud(newContacts);
    }
  }, [customContacts, user, saveToCloud]);

  const getContact = useCallback((contactId: string) => {
    return customContacts.find(c => c.id === contactId);
  }, [customContacts]);

  return (
    <CustomContactsContext.Provider value={{
      customContacts,
      addContact,
      updateContact,
      deleteContact,
      getContact,
      isLoading,
      refreshContacts,
    }}>
      {children}
    </CustomContactsContext.Provider>
  );
}

export function useCustomContacts() {
  const context = useContext(CustomContactsContext);
  if (context === undefined) {
    throw new Error('useCustomContacts must be used within a CustomContactsProvider');
  }
  return context;
}
