import {
  DEFAULT_TOAST_PREFERENCE,
  type ToastPreference,
} from '../../../types/uiPreferences';

type ToastPreferenceListener = (preference: ToastPreference) => void;

let currentPreference: ToastPreference = { ...DEFAULT_TOAST_PREFERENCE };
const listeners = new Set<ToastPreferenceListener>();

export function getToastRuntimePreferences(): ToastPreference {
  return currentPreference;
}

export function setToastRuntimePreferences(preference: ToastPreference): void {
  currentPreference = { ...preference };
  listeners.forEach(listener => listener(currentPreference));
}

export function resetToastRuntimePreferences(): void {
  setToastRuntimePreferences(DEFAULT_TOAST_PREFERENCE);
}

export function subscribeToastRuntimePreferences(listener: ToastPreferenceListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
