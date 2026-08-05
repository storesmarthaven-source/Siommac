/**
 * src/api/uiPreferences.ts — client for the typed per-user UI preference store.
 *
 * The key set is the SHARED contract in `types/uiPreferences.ts`, which the
 * backend validates against. Typing `key` as that union rather than `string` is
 * the point: the saved-view outage happened because the frontend was free to
 * post any key it liked, and `hr.employee-register.views` was not one the
 * endpoint knew. A key that is not in the contract is now a compile error here,
 * not a 400 discovered in the console.
 */
import { apiPost } from '@lib/api';
import {
  EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY,
  EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY,
  type EmployeeRegisterColumnKey,
  type EmployeeRegisterView,
  ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_KEY,
  type OnboardingWorkQueueView,
} from '../../types/uiPreferences';

/** Every key the endpoint accepts, and the value type stored under it. */
export interface UiPreferenceValues {
  [EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY]: EmployeeRegisterColumnKey[];
  [EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY]: EmployeeRegisterView[];
  [ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_KEY]: OnboardingWorkQueueView[];
}

export type UiPreferenceKey = keyof UiPreferenceValues;

export interface UiPreference<K extends UiPreferenceKey> {
  key: K;
  version: number;
  value: UiPreferenceValues[K];
  updatedAt: string | null;
}

export async function getUiPreference<K extends UiPreferenceKey>(key: K): Promise<UiPreference<K> | null> {
  const response = await apiPost<{
    success: boolean;
    message?: string;
    data?: { preference: UiPreference<K> | null };
  }>('ui-preferences/get', { key });
  if (!response.success) throw new Error(response.message ?? 'Failed to load UI preference.');
  return response.data?.preference ?? null;
}

export async function saveUiPreference<K extends UiPreferenceKey>(
  key: K, value: UiPreferenceValues[K],
): Promise<UiPreference<K>> {
  const response = await apiPost<{
    success: boolean;
    message?: string;
    data?: { preference: UiPreference<K> };
  }>('ui-preferences/save', { key, value });
  if (!response.success || !response.data?.preference) {
    throw new Error(response.message ?? 'Failed to save UI preference.');
  }
  return response.data.preference;
}
