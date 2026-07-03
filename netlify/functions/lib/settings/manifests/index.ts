// Module settings manifest registry. Add a module's manifest here once authored;
// the catalog sync + build gate read this list. (Spec §8 build order, §28.)
import type { ModuleSettingsManifest } from '../types';
import { systemManifest } from './system.manifest';
import { trainingManifest } from './training.manifest';
import { ptwManifest } from './ptw.manifest';
import { sdsManifest } from './sds.manifest';
import { incidentsManifest } from './incidents.manifest';
import { capaJsaInspectionsManifest } from './capaJsaInspections.manifest';
import { documentsPpeManifest } from './documentsPpe.manifest';
import { employeesManifest } from './employees.manifest';
import { onboardingManifest } from './onboarding.manifest';
import { hrDocumentsManifest } from './hrDocuments.manifest';
import { notificationsManifest } from './notifications.manifest';
import { messagesManifest } from './messages.manifest';
import { filesManifest } from './files.manifest';
import { workflowManifest } from './workflow.manifest';
import { adminManifest } from './admin.manifest';
import { commandCenterManifest } from './commandCenter.manifest';
import { attendanceManifest } from './attendance.manifest';
import { companyManifest } from './company.manifest';
import { hrLeaveManifest } from './hrLeave.manifest';
import { hrAttendanceManifest } from './hrAttendance.manifest';
import { financePayrollManifest } from './financePayroll.manifest';

export const moduleSettingsManifests: ModuleSettingsManifest[] = [
  // My Settings / General
  systemManifest,
  companyManifest,
  attendanceManifest,
  // Module Policy
  employeesManifest,
  onboardingManifest,
  hrLeaveManifest,
  hrAttendanceManifest,
  hrDocumentsManifest,
  trainingManifest,
  ptwManifest,
  sdsManifest,
  incidentsManifest,
  capaJsaInspectionsManifest,
  documentsPpeManifest,
  // Platform Policy
  notificationsManifest,
  messagesManifest,
  filesManifest,
  workflowManifest,
  adminManifest,
  commandCenterManifest,
  financePayrollManifest,
];
