/**
 * src/components/sections/HR/widgets/hrWidgets.tsx
 *
 * HR widget registry for the Employee Master board. Real-data widgets render now;
 * widgets whose source module doesn't exist yet are registered with a `dataGate`
 * so they appear in the picker as LOCKED ("coming soon") — never as fake data.
 *
 * @see docs/WIDGET_BOARD_SPEC.md
 */

import { type WidgetRegistry } from '@ui';
import type { HrEmployeeRow } from '@api/hr/employees';
import { DeptDistributionPanel, DemographicsPanel } from './panels';

const locked = (reason: string) => () => reason;
const TODO = () => <div class="hrw-todo" />;

export function buildHrWidgets(rows: HrEmployeeRow[]): WidgetRegistry {
  return {
    'hr.deptDist': {
      id: 'hr.deptDist', title: 'Department Distribution', icon: 'fa-chart-pie', category: 'Workforce',
      defaultW: 4, defaultH: 4, minW: 3, minH: 3,
      render: () => <DeptDistributionPanel rows={rows} />,
    },
    'hr.demographics': {
      id: 'hr.demographics', title: 'Demographics', icon: 'fa-users', category: 'Workforce',
      defaultW: 4, defaultH: 3, minW: 3, minH: 2,
      render: () => <DemographicsPanel rows={rows} />,
    },
    // ── Locked until their source module exists (no fake data) ──
    'hr.compliance': {
      id: 'hr.compliance', title: 'Overall Compliance', icon: 'fa-shield-halved', category: 'Compliance',
      defaultW: 3, defaultH: 4, dataGate: locked('Needs the HR compliance summary endpoint'), render: TODO,
    },
    'hr.expiringCerts': {
      id: 'hr.expiringCerts', title: 'Expiring Certifications', icon: 'fa-triangle-exclamation', category: 'Compliance',
      defaultW: 4, defaultH: 4, dataGate: locked('Needs the HR compliance summary endpoint'), render: TODO,
    },
    'hr.attendanceTrend': {
      id: 'hr.attendanceTrend', title: 'Attendance Trend', icon: 'fa-chart-line', category: 'Attendance',
      defaultW: 6, defaultH: 4, dataGate: locked('Needs the Attendance module'), render: TODO,
    },
    'hr.lifecycleFunnel': {
      id: 'hr.lifecycleFunnel', title: 'Lifecycle Funnel', icon: 'fa-filter', category: 'Lifecycle',
      defaultW: 6, defaultH: 5, dataGate: locked('Needs a recruiting / ATS module'), render: TODO,
    },
    'hr.skillsHeatmap': {
      id: 'hr.skillsHeatmap', title: 'Competency Heatmap', icon: 'fa-grip', category: 'Skills',
      defaultW: 8, defaultH: 5, dataGate: locked('Needs the competency module'), render: TODO,
    },
  };
}
