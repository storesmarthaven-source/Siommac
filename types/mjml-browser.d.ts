// mjml-browser ships no types; declare the minimal async v5 surface we use.
declare module 'mjml-browser' {
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
  export default function mjml(source: string): Promise<MjmlResult>;
}
