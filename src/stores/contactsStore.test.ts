import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useContactsStore, initContacts } from './contactsStore';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock authStore
vi.mock('./authStore', () => ({
  getCurrentUserId: vi.fn(() => null),
}));

// Mock sync middleware
vi.mock('./middleware/sync', () => ({
  createCloudSync: vi.fn(() => vi.fn()),
  loadFromCloud: vi.fn(() => Promise.resolve(null)),
  getAuthToken: vi.fn(() => Promise.resolve(null)),
}));

const { getCurrentUserId } = await import('./authStore');
const { loadFromCloud } = await import('./middleware/sync');

describe('contactsStore', () => {
  const mockContact = {
    id: 'contact-1',
    name: 'Test Contact',
    purpose: 'Testing purposes',
    systemPrompt: 'You are a test assistant',
    avatarEmoji: '🧪',
    category: 'custom' as const,
  };

  const mockContact2 = {
    id: 'contact-2',
    name: 'Another Contact',
    purpose: 'Another purpose',
    systemPrompt: 'You are another assistant',
    avatarEmoji: '🔬',
    category: 'custom' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    vi.mocked(localStorage.setItem).mockClear();
    mockFetch.mockReset();
    useContactsStore.setState({
      customContacts: [],
      isLoading: false,
    });
  });

  describe('Initial State', () => {
    it('has correct initial state', () => {
      const state = useContactsStore.getState();
      expect(state.customContacts).toEqual([]);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('setContacts', () => {
    it('sets contacts array', () => {
      useContactsStore.getState().setContacts([mockContact]);
      expect(useContactsStore.getState().customContacts).toEqual([mockContact]);
    });
  });

  describe('setLoading', () => {
    it('updates loading state', () => {
      useContactsStore.getState().setLoading(true);
      expect(useContactsStore.getState().isLoading).toBe(true);
    });
  });

  describe('addContact', () => {
    it('adds a new contact', () => {
      useContactsStore.getState().addContact(mockContact);

      const contacts = useContactsStore.getState().customContacts;
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toEqual(mockContact);
    });

    it('saves to localStorage', () => {
      useContactsStore.getState().addContact(mockContact);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'vox-customContacts-anonymous',
        expect.any(String)
      );
    });

    it('preserves existing contacts', () => {
      useContactsStore.setState({ customContacts: [mockContact] });

      useContactsStore.getState().addContact(mockContact2);

      expect(useContactsStore.getState().customContacts).toHaveLength(2);
    });
  });

  describe('updateContact', () => {
    it('updates contact properties', () => {
      useContactsStore.setState({ customContacts: [mockContact] });

      useContactsStore.getState().updateContact('contact-1', { name: 'Updated Name' });

      const contact = useContactsStore.getState().customContacts[0];
      expect(contact.name).toBe('Updated Name');
      expect(contact.purpose).toBe('Testing purposes'); // Unchanged
    });

    it('does nothing for non-existent contact', () => {
      useContactsStore.setState({ customContacts: [mockContact] });

      useContactsStore.getState().updateContact('non-existent', { name: 'New Name' });

      expect(useContactsStore.getState().customContacts[0].name).toBe('Test Contact');
    });
  });

  describe('deleteContact', () => {
    it('removes contact from list', () => {
      useContactsStore.setState({ customContacts: [mockContact, mockContact2] });

      useContactsStore.getState().deleteContact('contact-1');

      const contacts = useContactsStore.getState().customContacts;
      expect(contacts).toHaveLength(1);
      expect(contacts[0].id).toBe('contact-2');
    });

    it('saves to localStorage after delete', () => {
      useContactsStore.setState({ customContacts: [mockContact] });

      useContactsStore.getState().deleteContact('contact-1');

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'vox-customContacts-anonymous',
        '[]'
      );
    });
  });

  describe('getContact', () => {
    it('returns contact by id', () => {
      useContactsStore.setState({ customContacts: [mockContact, mockContact2] });

      const contact = useContactsStore.getState().getContact('contact-2');

      expect(contact).toEqual(mockContact2);
    });

    it('returns undefined for non-existent contact', () => {
      useContactsStore.setState({ customContacts: [mockContact] });

      const contact = useContactsStore.getState().getContact('non-existent');

      expect(contact).toBeUndefined();
    });
  });

  describe('loadContacts', () => {
    it('loads from localStorage when not logged in', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([mockContact]));

      await useContactsStore.getState().loadContacts();

      expect(useContactsStore.getState().customContacts).toHaveLength(1);
      expect(useContactsStore.getState().isLoading).toBe(false);
    });

    it('loads from cloud when logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(loadFromCloud).mockResolvedValueOnce([mockContact, mockContact2]);

      await useContactsStore.getState().loadContacts();

      expect(useContactsStore.getState().customContacts).toHaveLength(2);
    });

    it('falls back to localStorage if cloud returns empty', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(loadFromCloud).mockResolvedValueOnce(null);
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([mockContact]));

      await useContactsStore.getState().loadContacts();

      expect(useContactsStore.getState().customContacts).toHaveLength(1);
    });

    it('handles errors gracefully', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(loadFromCloud).mockRejectedValueOnce(new Error('Network error'));

      await useContactsStore.getState().loadContacts();

      expect(useContactsStore.getState().isLoading).toBe(false);
    });
  });

  describe('refreshContacts', () => {
    it('does nothing when not logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null);

      await useContactsStore.getState().refreshContacts();

      expect(loadFromCloud).not.toHaveBeenCalled();
    });

    it('fetches from cloud when logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(loadFromCloud).mockResolvedValueOnce([mockContact]);

      await useContactsStore.getState().refreshContacts();

      expect(loadFromCloud).toHaveBeenCalled();
      expect(useContactsStore.getState().customContacts).toHaveLength(1);
    });
  });

  describe('initContacts', () => {
    it('loads contacts on init', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([mockContact]));

      await initContacts();

      expect(useContactsStore.getState().customContacts).toHaveLength(1);
    });
  });
});
