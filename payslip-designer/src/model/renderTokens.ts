import { SAMPLE_DATA } from '@/constants/tokens';

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Resolve `{{token}}` placeholders.
 * In preview mode they become sample values; in edit mode they stay literal
 * (the UI renders them as chips via CSS).
 */
export function resolveTokens(text: string, preview: boolean): string {
  if (!preview) return text;
  return text.replace(TOKEN_RE, (match, key: string) => SAMPLE_DATA[key] ?? match);
}

/** Split text into literal and token segments for chip rendering in edit mode. */
export interface TextSegment {
  text: string;
  token: boolean;
}

export function tokenSegments(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx), token: false });
    out.push({ text: m[0], token: true });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), token: false });
  return out;
}

export function sampleValue(key: string): string {
  return SAMPLE_DATA[key] ?? `{{${key}}}`;
}
