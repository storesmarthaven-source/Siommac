// ============================================================================
// Finance - payroll export artifacts
// ============================================================================
// Only released runs may produce durable export artifacts. Each export is
// pinned to one immutable calculation version and stores the exact bytes that
// downloads return. Re-export creates a new version and retires the previous
// current row without changing the run lifecycle or disbursing funds.
// ============================================================================

import { sb } from '../db';
import {
  type PayrollExportFormat,
} from './payroll/exportContent';
import { payrollRpcHttpError } from './payroll/rpcError';

const EXPORT_SERIALIZER_VERSION = 'payroll-export-v1';

export interface PayrollExportDto {
  id: string;
  exportNo: string;
  runId: string;
  calculationVersionId: string | null;
  versionNo: number | null;
  format: string;
  filePath: string;
  checksum: string | null;
  contentSizeBytes: number | null;
  serializerVersion: string | null;
  generatedBy: string | null;
  generatedAt: string;
  isCurrent: boolean;
  metadata: Record<string, unknown>;
}

interface DbExportRow {
  id: string;
  export_no: string;
  run_id: string;
  calculation_version_id: string | null;
  version_no: number | null;
  format: string;
  file_path: string;
  checksum: string | null;
  content_size_bytes: number | null;
  serializer_version: string | null;
  generated_by: string | null;
  generated_at: string;
  is_current: boolean;
  metadata: Record<string, unknown>;
}

function toExportDto(row: DbExportRow): PayrollExportDto {
  return {
    id: row.id,
    exportNo: row.export_no,
    runId: row.run_id,
    calculationVersionId: row.calculation_version_id,
    versionNo: row.version_no === null ? null : Number(row.version_no),
    format: row.format,
    filePath: row.file_path,
    checksum: row.checksum,
    contentSizeBytes: row.content_size_bytes === null
      ? null
      : Number(row.content_size_bytes),
    serializerVersion: row.serializer_version,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
    isCurrent: row.is_current,
    metadata: row.metadata,
  };
}

export type ExportFormat = PayrollExportFormat;

/** Create a versioned immutable export for a released run. */
export async function exportRun(
  runId: string,
  actorId: string,
  idempotencyKey: string,
  format: ExportFormat = 'csv',
): Promise<PayrollExportDto> {
  if (format !== 'csv' && format !== 'json') {
    throw Object.assign(
      new Error(`Invalid export format '${format}'. Valid: csv, json.`),
      { status: 422 },
    );
  }

  const { data: run, error: runError } = await sb
    .from('finance_payroll_runs')
    .select('id, status, current_calculation_version_id')
    .eq('id', runId)
    .maybeSingle<{
      id: string;
      status: string;
      current_calculation_version_id: string | null;
    }>();
  if (runError) {
    throw Object.assign(new Error(`exportRun/run: ${runError.message}`), {
      status: 500,
    });
  }
  if (!run) {
    throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  }
  if (run.status !== 'released') {
    throw Object.assign(
      new Error(
        `Cannot export: run is in status '${run.status}'. Only released runs can be exported.`,
      ),
      { status: 422 },
    );
  }
  if (!run.current_calculation_version_id) {
    throw Object.assign(
      new Error('Cannot export: the released run has no current calculation version.'),
      { status: 409 },
    );
  }

  const { data, error } = await sb.rpc('finance_payroll_record_export_tx', {
    p_run_id: runId,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
    p_format: format,
    p_serializer_version: EXPORT_SERIALIZER_VERSION,
    p_metadata: {
      mimeType: format === 'json' ? 'application/json' : 'text/csv',
    },
  });
  if (error) throw payrollRpcHttpError(error);

  const result = (data ?? {}) as { export?: DbExportRow };
  if (!result.export) {
    throw Object.assign(
      new Error('Payroll export committed but returned an invalid result.'),
      { status: 500 },
    );
  }
  return toExportDto(result.export);
}

export async function listRunExports(runId: string): Promise<PayrollExportDto[]> {
  const { data, error } = await sb
    .from('finance_payroll_exports')
    .select(
      'id, export_no, run_id, calculation_version_id, version_no, format, file_path, checksum, content_size_bytes, serializer_version, generated_by, generated_at, is_current, metadata',
    )
    .eq('run_id', runId)
    .order('version_no', { ascending: false, nullsFirst: false })
    .order('generated_at', { ascending: false });
  if (error) {
    throw Object.assign(new Error(`listRunExports: ${error.message}`), {
      status: 500,
    });
  }
  return ((data ?? []) as DbExportRow[]).map(toExportDto);
}
