/**
 * netlify/functions/lib/moduleRegistry.ts
 *
 * Runtime registry of handoff receivers, one per target module.
 * The handoff bus calls getModuleReceiver(targetModule).receiveHandoff(input)
 * instead of containing module-specific logic itself.
 *
 * Register receivers once at startup via registerModules.ts.
 */

import type { ModuleKey } from './moduleServiceAdapter';

export interface HandoffReceiveInput {
  sourceModule:      ModuleKey;
  sourceEntityType:  string;
  sourceEntityId:    string;
  payload:           Record<string, unknown>;
  createdBy:         string;
}

export interface HandoffReceiveResult {
  targetEntityType: string;
  targetEntityId:   string;
  targetEntityRef?: string;
}

export interface ModuleReceiver {
  module:         ModuleKey;
  receiveHandoff: (input: HandoffReceiveInput) => Promise<HandoffReceiveResult>;
}

const receivers = new Map<ModuleKey, ModuleReceiver>();

export function registerModuleReceiver(receiver: ModuleReceiver): void {
  receivers.set(receiver.module, receiver);
}

export function getModuleReceiver(module: string): ModuleReceiver {
  const receiver = receivers.get(module as ModuleKey);
  if (!receiver) throw new Error(`No module receiver registered for: ${module}`);
  return receiver;
}

export function hasModuleReceiver(module: string): boolean {
  return receivers.has(module as ModuleKey);
}
