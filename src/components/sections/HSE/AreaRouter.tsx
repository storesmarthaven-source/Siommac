/**
 * src/components/sections/HSE/AreaRouter.tsx
 *
 * Routes an HSE area key + active tab to the area's body component. Each area
 * (built in its own file) registers here. Until an area's real body lands, a
 * placeholder renders its hero so nav/routing is verifiable end-to-end.
 */

import { type VNode } from 'preact';
import { AreaHero } from './_shared';
import { HSE_AREAS } from './nav';
import { IncidentsArea }   from './Incidents';
import { RiskJsaArea }     from './RiskJsa';
import { PermitsArea }     from './Permits';
import { InspectionsArea } from './Inspections';
import { TrainingArea }    from './Training';
import { ToolboxArea }     from './Toolbox';
import { DocumentsArea }   from './Documents';
import { WorkflowsArea }  from './Workflows';
import '@components/workflow';   // registers workflow.css for area workflow UI

/** Placeholder body — replaced per area as each is implemented. */
function AreaPlaceholder({ areaKey, tab }: { areaKey: string; tab: string }): VNode {
  const area = HSE_AREAS.find(a => a.key === areaKey);
  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon={area?.icon ?? 'fa-helmet-safety'}
        title={area?.label ?? 'HSE'}
        crumb={area?.label ?? 'HSE'}
        stats={[
          { icon: 'fa-list-check', label: 'Open Items', value: 0, color: 'blue' },
          { icon: 'fa-clock', label: 'Due Soon', value: 0, color: 'gold' },
          { icon: 'fa-triangle-exclamation', label: 'Critical', value: 0, color: 'red' },
        ]}
      />
      <div class="vt-table-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <i class={`fas ${area?.icon ?? 'fa-helmet-safety'}`} style={{ fontSize: '2rem', color: 'var(--siomac-navy)', marginBottom: '12px', display: 'block' }} />
        <strong style={{ color: 'var(--siomac-navy)' }}>{area?.label} — {tab}</strong>
        <p style={{ marginTop: '6px' }}>This area is being built.</p>
      </div>
    </div>
  );
}

export function AreaRouter({ area, tab }: { area: string; tab: string }): VNode {
  // Area bodies register here as they are implemented (Steps 4–10).
  switch (area) {
    case 'incidents':    return <IncidentsArea tab={tab} />;
    case 'risk':         return <RiskJsaArea tab={tab} />;
    case 'permits':      return <PermitsArea tab={tab} />;
    case 'inspections':  return <InspectionsArea tab={tab} />;
    case 'training':     return <TrainingArea tab={tab} />;
    case 'toolbox':      return <ToolboxArea tab={tab} />;
    case 'documents':    return <DocumentsArea tab={tab} />;
    case 'workflows':    return <WorkflowsArea tab={tab} />;
    default:             return <AreaPlaceholder areaKey={area} tab={tab} />;
  }
}
