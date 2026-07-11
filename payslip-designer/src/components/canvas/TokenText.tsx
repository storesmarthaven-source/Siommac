import { resolveTokens, tokenSegments } from '@/model/renderTokens';

/** Renders text with `{{tokens}}` as chips (edit) or resolved values (preview). */
export function TokenText({ text, preview }: { text: string; preview: boolean }) {
  if (preview) return <>{resolveTokens(text, true)}</>;
  return (
    <>
      {tokenSegments(text).map((seg, i) =>
        seg.token ? (
          <span key={i} class="token-chip">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
