// Company & Branding — settings manifest (Spec §28/§29; replaces the legacy
// Settings → Company & Branding panel). Keys mirror the legacy flat `settings`
// rows (companyName, companyAddress, companyPhone, companyEmail, companyNIS,
// companyBIR) so wiring is behaviour-preserving.
import type { ModuleSettingsManifest } from '../types';
import { systemPolicy, modulePolicy, auditPolicy } from '../catalogHelpers';

const M = 'company';

export const companyManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Company & Branding',
  hasSettings: true,
  moduleCategory: 'standard',
  reviewedBy: ['product_owner', 'engineering', 'super_admin'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'audit_retention', applies: true },
  ],
  settings: [
    systemPolicy(M, 'company.display_name', {
      label: 'Company Display Name', description: 'Primary organization name shown in headers and reports.',
      dataType: 'string', defaultValue: 'SIOMAC', scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    systemPolicy(M, 'company.legal_entity_name', {
      label: 'Legal Entity Name', description: 'Registered legal name used on controlled documents.',
      dataType: 'string', defaultValue: 'SIOMAC Ltd.', scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    systemPolicy(M, 'company.address', {
      label: 'Address', description: 'Company address shown on documents and applications.',
      dataType: 'string', defaultValue: '', scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    systemPolicy(M, 'company.phone', {
      label: 'Phone', description: 'Company phone number.',
      dataType: 'string', defaultValue: '', scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    systemPolicy(M, 'company.email', {
      label: 'Email', description: 'Company contact email.',
      dataType: 'string', defaultValue: '', scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    systemPolicy(M, 'company.nis_registration', {
      label: 'NIS Registration No.', description: 'Trinidad & Tobago NIS registration number.',
      dataType: 'string', defaultValue: '', scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    systemPolicy(M, 'company.bir_file_number', {
      label: 'BIR File No.', description: 'BIR file number used on payroll documents.',
      dataType: 'string', defaultValue: '', scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    modulePolicy(M, 'company.logo_required', {
      label: 'Logo Required', description: 'Require an approved logo before publishing branded reports.',
      dataType: 'boolean', defaultValue: false, scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    auditPolicy(M, 'company.brand_changes_audited', {
      label: 'Brand Changes Audited', description: 'Write audit events for company branding changes.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
  ],
};
