type Listener = (message: string) => void;

const listeners = new Set<Listener>();

export function showToast(message: string): void {
  for (const l of listeners) l(message);
}

export function onToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
