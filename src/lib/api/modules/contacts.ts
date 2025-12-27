/**
 * Contacts API Module
 * Handles custom contacts CRUD
 */

import { api } from '../client';
import {
  GetCustomContactsResponse,
  CreateCustomContactRequest,
  CreateCustomContactResponse,
} from '../types';
import { CustomContactDocument } from '@/shared/types/database';
import { PreMadeContactConfig } from '@/shared/types';

// ============================================
// HELPERS
// ============================================

function parseContact(contact: CustomContactDocument): CustomContactDocument {
  return {
    ...contact,
    createdAt: new Date(contact.createdAt),
    updatedAt: new Date(contact.updatedAt),
  };
}

// ============================================
// CUSTOM CONTACTS (V2 API)
// ============================================

/**
 * Get all custom contacts
 */
export async function getCustomContacts(): Promise<CustomContactDocument[]> {
  const response = await api.get<GetCustomContactsResponse>('/api/v2/contacts');
  return response.contacts.map(parseContact);
}

/**
 * Create a custom contact
 */
export async function createCustomContact(
  data: CreateCustomContactRequest
): Promise<CustomContactDocument> {
  const response = await api.post<CreateCustomContactResponse>('/api/v2/contacts', data);
  return parseContact(response.contact);
}

/**
 * Update a custom contact
 */
export async function updateCustomContact(
  contactId: string,
  updates: Partial<CreateCustomContactRequest>
): Promise<void> {
  await api.patch(`/api/v2/contacts/${contactId}`, updates);
}

/**
 * Delete a custom contact
 */
export async function deleteCustomContact(contactId: string): Promise<void> {
  await api.delete(`/api/v2/contacts/${contactId}`);
}

// ============================================
// LEGACY API (for backward compatibility)
// ============================================

interface LegacyUserData {
  customContacts: PreMadeContactConfig[];
}

/**
 * Get custom contacts (legacy v1 API)
 */
export async function getLegacyCustomContacts(): Promise<PreMadeContactConfig[]> {
  const response = await api.get<LegacyUserData>('/api/user/data');
  return response.customContacts || [];
}

/**
 * Save custom contacts (legacy v1 API)
 */
export async function saveLegacyCustomContacts(
  contacts: PreMadeContactConfig[]
): Promise<void> {
  await api.post('/api/user/data', { customContacts: contacts });
}
