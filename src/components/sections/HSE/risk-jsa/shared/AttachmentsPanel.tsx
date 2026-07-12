/**
 * src/components/sections/HSE/risk-jsa/shared/AttachmentsPanel.tsx
 *
 * Reusable attachments panel for the Risk/JSA drawers. Lists files (with signed
 * download links), uploads via the presigned-URL flow, and deletes. Shared by
 * the Hazard / Risk Assessment / JSA drawers.
 */

import { type VNode } from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  useAttachments, useUploadAttachment, useDeleteAttachment,
  type AttachEntityType,
} from '@api/hse/riskJsa';

const ICON: [RegExp, string][] = [
  [/pdf/, 'fa-file-pdf'],
  [/word|document/, 'fa-file-word'],
  [/sheet|excel|csv/, 'fa-file-excel'],
  [/image/, 'fa-file-image'],
];
function fileIcon(mime: string): string {
  return ICON.find(([re]) => re.test(mime))?.[1] ?? 'fa-file';
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
}

export function AttachmentsPanel({ entityType, entityId }: { entityType: AttachEntityType; entityId: string }): VNode {
  const { data, isLoading } = useAttachments(entityType, entityId);
  const files = data?.data ?? [];
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  async function onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    setError('');
    try {
      await upload.mutateAsync({ entityType, entityId, file: f });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{files.length} file{files.length === 1 ? '' : 's'}</span>
        <button class="inc-action-btn primary" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
          <i class={`fas ${upload.isPending ? 'fa-spinner fa-spin' : 'fa-upload'}`} /> {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={inputRef} type="file" style={{ display: 'none' }}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*" onChange={onPick} />
      </div>

      {error && <div style={{ color: 'var(--siomac-red)', fontSize: '0.76rem' }}>{error}</div>}
      {isLoading && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '8px 0' }}>Loading…</div>}
      {!isLoading && files.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '16px 0' }}>
          No attachments yet.
        </div>
      )}

      {files.map(f => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-card)' }}>
          <i class={`fas ${fileIcon(f.mime_type)}`} style={{ color: 'var(--siomac-navy)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <a href={f.url || '#'} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--siomac-navy)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
              {f.file_name}
            </a>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{fmtDate(f.created_at)}</div>
          </div>
          <button class="hse-btn-icon-remove" disabled={del.isPending} onClick={() => del.mutate(f.id)} aria-label="Delete">
            <i class="fas fa-trash" />
          </button>
        </div>
      ))}
    </div>
  );
}
