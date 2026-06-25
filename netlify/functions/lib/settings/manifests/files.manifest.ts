// Files / Evidence — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { filePolicy, systemSecurity, auditPolicy } from '../catalogHelpers';

const M = 'files';

export const filesManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Files / Evidence',
  hasSettings: true,
  moduleCategory: 'system',
  requiresSecurityReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'security'],
  sections: [
    { sectionKey: 'files', applies: true },
    { sectionKey: 'audit_retention', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    systemSecurity(M, 'files.private_bucket_required', {
      label: 'Private Buckets Required', description: 'Require private storage with signed access for controlled evidence.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    filePolicy(M, 'files.default_signed_url_expiry_minutes', {
      label: 'Signed URL Expiry (minutes)', description: 'Minutes before a signed file URL expires.',
      dataType: 'number', defaultValue: 15, minValue: 1, maxValue: 1440, scope: ['global'],
    }),
    systemSecurity(M, 'files.scan_required', {
      label: 'File Scan Required', description: 'Require malware scanning before a file is usable.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    filePolicy(M, 'files.max_upload_size_mb', {
      label: 'Max Upload Size (MB)', description: 'Maximum upload size in MB.',
      dataType: 'number', defaultValue: 50, minValue: 1, maxValue: 1024, scope: ['global'],
    }),
    filePolicy(M, 'files.allowed_global_file_types', {
      label: 'Allowed File Types', description: 'Comma-separated list of allowed upload types.',
      dataType: 'string', defaultValue: 'PDF, JPG, PNG, DOCX, XLSX', scope: ['global'],
    }),
    auditPolicy(M, 'files.audit_download', {
      label: 'Audit Downloads', description: 'Record controlled-evidence downloads.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    filePolicy(M, 'files.require_evidence_on_critical_actions', {
      label: 'Evidence on Critical Actions', description: 'Require evidence on critical workflow actions.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    auditPolicy(M, 'files.retention_days', {
      label: 'File Retention (days)', description: 'Days to retain controlled files.',
      dataType: 'number', defaultValue: 2555, minValue: 30, maxValue: 3650, scope: ['global'],
    }),
  ],
};
