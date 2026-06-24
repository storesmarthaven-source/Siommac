/**
 * netlify/functions/lib/attachmentClassifier.ts
 *
 * Pure, dependency-free attachment classification + policy for message
 * attachments (spec §8.4). No imports → safe to use from both the lib and routes
 * without creating an import cycle with communications.ts.
 */

import type { MessageAttachmentType } from '../../../types/messaging';

/** Extensions we refuse outright — executables / scripts. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'js', 'msi', 'dll', 'scr', 'com', 'ps1', 'vbs', 'jar',
]);

/** Size ceilings by class (bytes). */
export const ATTACHMENT_LIMITS = {
  image:    10 * 1024 * 1024, // 10 MB
  document: 25 * 1024 * 1024, // 25 MB
  archive:  25 * 1024 * 1024, // 25 MB
  default:  25 * 1024 * 1024,
} as const;

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** Lower-cased file extension without the dot ('' if none). */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** Classify by mime first, then extension — drives icon/preview rendering. */
export function classifyAttachment(fileName: string, contentType?: string | null): MessageAttachmentType {
  const ext = fileExtension(fileName);
  const ct  = (contentType ?? '').toLowerCase();

  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';

  if (ext === 'pdf' || ct === 'application/pdf')           return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext))  return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext))          return 'audio';
  if (['doc', 'docx'].includes(ext))                       return 'word';
  if (['xls', 'xlsx', 'csv'].includes(ext))                return 'excel';
  if (['ppt', 'pptx'].includes(ext))                       return 'powerpoint';
  if (['txt', 'md', 'rtf'].includes(ext))                  return 'text';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext))     return 'archive';

  return 'document';
}

/** Throwable policy gate used at upload-record creation. */
export function assertAttachmentAllowed(fileName: string, sizeBytes: number | null): void {
  const ext = fileExtension(fileName);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`File type .${ext} is not permitted`);
  }
  const type  = classifyAttachment(fileName, null);
  const limit = type === 'image' ? ATTACHMENT_LIMITS.image
              : type === 'archive' ? ATTACHMENT_LIMITS.archive
              : ATTACHMENT_LIMITS.default;
  if (sizeBytes != null && sizeBytes > limit) {
    throw new Error(`File exceeds the ${Math.round(limit / (1024 * 1024))} MB limit`);
  }
}
