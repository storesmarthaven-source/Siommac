import { apiPost } from '@lib/api';

export interface EmailTemplateAsset {
  id: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  publicUrl: string;
  altText: string;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function validateImage(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('Use a JPEG, PNG, WebP or GIF image.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Images must be 5 MB or smaller.');
}

function dimensionsFromUrl(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The selected image could not be read.'));
    image.src = url;
  });
}

async function dimensions(file: File, dataUrl: string): Promise<{ width: number; height: number }> {
  if (typeof globalThis.createImageBitmap === 'function') {
    const bitmap = await globalThis.createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    if (size.width > 0 && size.height > 0) return size;
  }
  return dimensionsFromUrl(dataUrl);
}

async function developmentUpload(file: File): Promise<EmailTemplateAsset> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The selected image could not be read.'));
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(file);
  });
  const size = await dimensions(file, dataUrl);
  return {
    id: globalThis.crypto.randomUUID(),
    fileName: file.name,
    mimeType: file.type,
    width: size.width,
    height: size.height,
    size: file.size,
    publicUrl: dataUrl,
    altText: '',
  };
}

/**
 * Uploads an editor asset through the authenticated, record-scoped asset API.
 * The development adapter uses an in-memory data URL only because no message is
 * delivered from development data. Production never falls back to that path.
 */
export async function uploadEmailTemplateAsset(templateId: string, file: File): Promise<EmailTemplateAsset> {
  validateImage(file);
  if (import.meta.env.DEV) return developmentUpload(file);

  const signed = await apiPost<{
    success: boolean;
    uploadUrl?: string;
    storagePath?: string;
    message?: string;
  }>('hr/email-templates/assets/upload-url', {
    templateId,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  }, { retryable: false });
  if (!signed.success || !signed.uploadUrl || !signed.storagePath) {
    throw new Error(signed.message ?? 'The image upload could not be started.');
  }
  const uploaded = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!uploaded.ok) throw new Error('The image could not be uploaded.');

  const completed = await apiPost<{ success: boolean; data?: EmailTemplateAsset; message?: string }>(
    'hr/email-templates/assets/complete',
    { templateId, storagePath: signed.storagePath, fileName: file.name, mimeType: file.type, size: file.size },
    { retryable: false },
  );
  if (!completed.success || !completed.data) throw new Error(completed.message ?? 'The uploaded image could not be registered.');
  return completed.data;
}
