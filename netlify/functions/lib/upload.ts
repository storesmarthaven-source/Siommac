import { sb } from './db';

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

const MAX_BASE64_BYTES = 8 * 1024 * 1024;

// Upload a base64 data-URI to the given Supabase Storage bucket.
// Returns the stored path (private buckets) or a public URL (branding bucket).
async function uploadBase64(bucket: string, base64: string, name: string): Promise<string> {
  if (!base64) return '';
  const str = String(base64);

  if (str.length > MAX_BASE64_BYTES) throw new Error('Image too large (max 6 MB)');

  const m    = str.match(/^data:([^;]+);base64,(.+)$/s);
  const mime = ((m ? m[1] : 'image/jpeg') as string).toLowerCase().trim();
  const raw  = m ? m[2] : str.split('base64,').pop() ?? '';

  const ext = ALLOWED_IMAGE_TYPES[mime];
  if (!ext) throw new Error(`Unsupported image type: ${mime}. Allowed: jpeg, png, webp, gif`);

  const safeName = String(name).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
  const path     = `${safeName}_${Date.now()}.${ext}`;

  const buffer = Buffer.from(raw, 'base64');
  if (buffer.byteLength > 6 * 1024 * 1024) throw new Error('Image too large (max 6 MB)');

  const { error } = await sb.storage
    .from(bucket)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw error;

  if (bucket === 'branding') {
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
  return path;
}

export { uploadBase64 };
