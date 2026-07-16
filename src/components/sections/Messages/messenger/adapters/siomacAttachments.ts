// adapters/siomacAttachments.ts — the AttachmentService port against the SIOMAC
// attachment pipeline: presigned upload-url -> PUT (with progress) -> create row
// -> permission-checked signed download URL. Mirrors MessageCenter.uploadFile,
// with XHR for progress. Replaces the port bundle's storage-provider stub.
import { apiPost } from '@lib/api';
import type { AttachmentService } from '../domain/ports';
import type { Attachment } from '../domain/models';
import { attachmentKind } from '../domain/format';

interface UploadUrlResult { uploadUrl: string; token: string; path: string; bucket: string; ext: string; }

export class SiomacAttachmentService implements AttachmentService {
  async upload(file: File, onProgress: (attachment: Attachment) => void, signal: AbortSignal): Promise<Attachment> {
    const mimeType = file.type || 'application/octet-stream';
    const urlRes = await apiPost<{ success: boolean; data?: UploadUrlResult; message?: string }>(
      'communications/messages/attachments/upload-url', { fileName: file.name, mimeType }, { retryable: false },
    );
    if (!urlRes.success || !urlRes.data) throw new Error(urlRes.message ?? 'Unable to create an upload session.');
    const { uploadUrl, path } = urlRes.data;

    const base: Attachment = {
      id: `pending:${path}`, kind: attachmentKind(file.name), name: file.name,
      mimeType, sizeBytes: file.size, transferState: 'uploading', progress: 0,
    };
    onProgress(base);

    // PUT the raw bytes to the signed Storage URL (the token is embedded in the URL).
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('PUT', uploadUrl);
      request.setRequestHeader('Content-Type', mimeType);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress({ ...base, progress: Math.round((event.loaded / event.total) * 100) });
      };
      request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Upload failed (${request.status})`)));
      request.onerror = () => reject(new Error('Upload connection failed.'));
      signal.addEventListener('abort', () => { request.abort(); reject(new DOMException('Upload cancelled', 'AbortError')); }, { once: true });
      request.send(file);
    });

    // Persist the attachment metadata row (post_id stays NULL until the message is sent).
    const createRes = await apiPost<{ success: boolean; id?: string; message?: string }>(
      'communications/messages/attachments/create',
      { fileName: file.name, filePath: path, contentType: file.type || null, sizeBytes: file.size },
      { retryable: false },
    );
    if (!createRes.success || !createRes.id) throw new Error(createRes.message ?? 'Unable to finalize the upload.');

    const attachment: Attachment = { ...base, id: createRes.id, transferState: 'available', progress: 100 };
    onProgress(attachment);
    return attachment;
  }

  async download(attachment: Attachment): Promise<void> {
    const res = await apiPost<{ success: boolean; data?: { url: string | null }; message?: string }>(
      'communications/messages/attachments/get-url', { attachmentId: attachment.id, purpose: 'download' }, { retryable: false },
    );
    const url = res.success ? res.data?.url : null;
    if (!url) throw new Error(res.message ?? 'Download URL is unavailable.');
    location.assign(url);
  }
}
