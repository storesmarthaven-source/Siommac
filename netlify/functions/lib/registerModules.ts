/**
 * netlify/functions/lib/registerModules.ts
 *
 * One-time module receiver registration. Called from api.ts at startup.
 * Idempotent — safe to call multiple times (Netlify may warm multiple instances).
 */

import { registerModuleReceiver } from './moduleRegistry';
import { hrReceiver }             from './receivers/hrReceiver';
import { financeReceiver }        from './receivers/financeReceiver';
import { operationsReceiver }     from './receivers/operationsReceiver';
import { registerHseWorkflowAdapters } from './workflow/hseAdapters';

let registered = false;

export function registerModulesOnce(): void {
  if (registered) return;

  // Cross-module handoff receivers.
  registerModuleReceiver(hrReceiver);
  registerModuleReceiver(financeReceiver);
  registerModuleReceiver(operationsReceiver);

  // Central workflow engine → module status-sync adapters.
  registerHseWorkflowAdapters();

  registered = true;
}
