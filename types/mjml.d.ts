// `mjml` (the full, server-side package) ships no types. Declares only the surface the backend
// compiler uses. Kept deliberately narrow: a wider hand-written declaration invites drift from the
// real API without any compiler help to catch it.
//
// v5 returns a Promise; the call site awaits, which is also correct for a synchronous v4 result.
declare module 'mjml' {
  interface MjmlError {
    line?: number;
    message: string;
    tagName?: string;
    formattedMessage?: string;
  }
  interface MjmlResult {
    html: string;
    errors: MjmlError[];
  }
  interface MjmlOptions {
    /** 'strict' makes an invalid template a compile FAILURE rather than a silent partial render. */
    validationLevel?: 'strict' | 'soft' | 'skip';
    [key: string]: unknown;
  }
  export default function mjml2html(source: string, options?: MjmlOptions): Promise<MjmlResult> | MjmlResult;
}
