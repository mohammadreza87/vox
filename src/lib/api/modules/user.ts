/**
 * User API Module
 * Handles user preferences and profile
 */

import { api } from '../client';
import { UserPreferences } from '@/shared/types/database';

// ============================================
// PREFERENCES
// ============================================

interface PreferencesResponse {
  preferences: UserPreferences;
}

/**
 * Get user preferences
 */
export async function getPreferences(): Promise<UserPreferences> {
  const response = await api.get<PreferencesResponse>('/api/user/data');
  return response.preferences || { theme: 'light' };
}

/**
 * Update user preferences
 */
export async function updatePreferences(preferences: Partial<UserPreferences>): Promise<void> {
  await api.post('/api/user/data', { preferences });
}

/**
 * Set theme preference
 */
export async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  await updatePreferences({ theme });
}
