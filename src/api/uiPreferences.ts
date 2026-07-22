import { apiPost } from '@lib/api';

export interface UiPreference<T> {
  key: string;
  version: number;
  value: T;
  updatedAt: string | null;
}

export async function getUiPreference<T>(key: string): Promise<UiPreference<T> | null> {
  const response = await apiPost<{
    success: boolean;
    message?: string;
    data?: { preference: UiPreference<T> | null };
  }>('ui-preferences/get', { key });
  if (!response.success) throw new Error(response.message ?? 'Failed to load UI preference.');
  return response.data?.preference ?? null;
}

export async function saveUiPreference<T>(key: string, value: T): Promise<UiPreference<T>> {
  const response = await apiPost<{
    success: boolean;
    message?: string;
    data?: { preference: UiPreference<T> };
  }>('ui-preferences/save', { key, value });
  if (!response.success || !response.data?.preference) {
    throw new Error(response.message ?? 'Failed to save UI preference.');
  }
  return response.data.preference;
}
