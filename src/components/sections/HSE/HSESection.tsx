/**
 * src/components/sections/HSE/HSESection.tsx
 *
 * HSE module shell. Two areas behind a top sub-nav:
 *   • Dashboard   — incident KPIs, charts, and recent incidents
 *   • PPE Manager — its own 14-tab ppeSubNav (inventory, assign, matrix, …)
 *
 * UI-only build: all data is static (see types.ts mock*). Structure mirrors the
 * other Preact sections (Console/Employees) so a backend can be wired later.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { HSEDashboard } from './HSEDashboard';
import { PPEManager }   from './PPEManager';
import './HSE.css';

type HseTab = 'dashboard' | 'ppe';

const HSE_TABS: { id: HseTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'HSE Dashboard', icon: 'fa-gauge-high' },
  { id: 'ppe',       label: 'PPE Manager',   icon: 'fa-hard-hat' },
];

export function HSESection(): VNode {
  const [tab, setTab] = useState<HseTab>('dashboard');

  return (
    <div class="hse-module">
      {/* Breadcrumb + title */}
      <nav class="page-breadcrumb" aria-label="Breadcrumb">
        <span class="page-breadcrumb-root">HSE</span>
        <i class="fas fa-chevron-right page-breadcrumb-sep" aria-hidden="true" />
        <span class="page-breadcrumb-current">{HSE_TABS.find(t => t.id === tab)?.label}</span>
      </nav>

      {/* Module sub-nav (Dashboard | PPE Manager) */}
      <div class="hse-subnav" role="tablist" aria-label="HSE sections">
        {HSE_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            class={`hse-subnav-btn${t.id === tab ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <i class={`fas ${t.icon}`} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' ? <HSEDashboard /> : <PPEManager />}
    </div>
  );
}
