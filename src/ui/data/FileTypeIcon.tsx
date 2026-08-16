import { FileIcon as UntitledFileIcon } from '@untitledui/file-icons';

/** Kept explicit because the package's public entry point currently types only FileIcon. */
export const FILE_TYPE_ICON_TYPES = [
  'audio', 'code', 'document', 'empty', 'folder', 'image', 'img', 'spreadsheets',
  'video', 'video-01', 'video-02', 'aep', 'ai', 'avi', 'css', 'csv', 'dmg',
  'doc', 'docx', 'eps', 'exe', 'fig', 'gif', 'html', 'indd', 'java', 'jpeg',
  'jpg', 'js', 'json', 'mkv', 'mp3', 'mp4', 'mpeg', 'pdf', 'pdf-simple', 'png',
  'ppt', 'pptx', 'psd', 'rar', 'rss', 'sql', 'svg', 'tiff', 'txt', 'wav', 'webp',
  'xls', 'xlsx', 'xml', 'zip',
] as const;

export type FileTypeIconType = (typeof FILE_TYPE_ICON_TYPES)[number];
export type FileTypeIconVariant = 'default' | 'gray' | 'solid';
export type FileTypeIconTheme = 'light' | 'dark';

export interface FileTypeIconProps {
  /** File extension, generic family, or MIME type supported by Untitled UI. */
  type: FileTypeIconType | (string & {});
  /** The official Untitled UI artwork treatment. */
  variant?: FileTypeIconVariant;
  theme?: FileTypeIconTheme;
  size?: number;
  /** Omit for decorative icons. */
  label?: string;
  class?: string;
}

/**
 * Canonical SIOMAC wrapper around the official Untitled UI file-icon package.
 *
 * The SVG geometry and file-type colours remain owned by the upstream package;
 * this wrapper gives SIOMAC one typed import surface and a consistent
 * accessibility contract.
 */
export function FileTypeIcon({
  type,
  variant = 'default',
  theme = 'light',
  size = 48,
  label,
  class: className,
}: FileTypeIconProps) {
  return (
    <UntitledFileIcon
      type={type}
      variant={variant}
      theme={theme}
      size={size}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    />
  );
}

/** Resolve a filename to the official extension artwork, falling back safely. */
export function fileTypeIconTypeFromName(filename: string): FileTypeIconType {
  const extension = filename.trim().toLowerCase().split('.').pop() ?? '';
  return (FILE_TYPE_ICON_TYPES as readonly string[]).includes(extension)
    ? extension as FileTypeIconType
    : 'empty';
}
