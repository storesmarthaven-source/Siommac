// Settings — typed error carrying an HTTP status (Spec §15/§16). Routes catch
// SettingsError and translate it to c.json({ success:false, message }, statusCode).

export class SettingsError extends Error {
  statusCode: number;
  fieldErrors?: Record<string, string>;
  constructor(statusCode: number, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'SettingsError';
    this.statusCode = statusCode;
    this.fieldErrors = fieldErrors;
  }
}

export const badRequest = (message: string, field?: string) =>
  new SettingsError(400, message, field ? { [field]: message } : undefined);
export const forbidden = (message: string) => new SettingsError(403, message);
export const notFound = (message: string) => new SettingsError(404, message);
