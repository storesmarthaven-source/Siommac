# Dialog system — app-wide popups, prompts, toasts

One system for every popup/prompt/confirmation/toast in the app. Use **`dialog`** (`@lib/dialog`)
everywhere — never the browser's `alert` / `confirm` / `prompt`, and prefer it over raw `cpop.fire`.

- **Engine:** `src/lib/popup.ts` (`cpop`, also `window.cpop` / `window.Swal`) — the same popup the
  session-expired notice uses. Renders a single modal + toasts; z-index 99999 (above all app modals).
- **API:** `src/lib/dialog.ts` — a small typed wrapper. Imperative + framework-free, so it works from
  components, hooks, stores, and plain modules.

```ts
import { dialog } from '@lib/dialog';

// notifications
dialog.success('Saved', 'Your changes are live.');
dialog.error('Failed', err.message);
dialog.warning('Heads up', '…'); dialog.info('FYI', '…');

// confirmation → boolean
if (await dialog.confirm({ title: 'Delete item?', text: 'This cannot be undone.', danger: true })) {
  await remove();
}

// prompt → string | null  (type: 'text' | 'password' | 'email' | 'number' | 'textarea')
const name = await dialog.prompt({ title: 'Rename', value: current, placeholder: 'New name' });
if (name !== null) await rename(name);

// non-blocking toast
dialog.toast({ text: 'Copied to clipboard', icon: 'success' });

// blocking spinner
dialog.loading(); try { await work(); } finally { dialog.close(); }
```

**Behaviour:** confirm/prompt return a Promise; `danger: true` gives a red confirm button + warning
icon; errors/warnings can't be dismissed by clicking outside (must be acknowledged); `Enter` confirms
(except inside a `textarea` prompt), `Esc` cancels; toasts auto-dismiss (default 3s).

**Icons:** `success | error | warning | info | question`.

Migrate any remaining `window.confirm` / `alert` / bespoke confirmation modals to `dialog.*`.
