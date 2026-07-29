/**
 * Canonical Trinidad and Tobago telephone formatting used at every employee
 * contact boundary. The country and area code are fixed product policy; users
 * enter only the seven-digit local number.
 */
export const TRINIDAD_PHONE_PREFIX = '+1 (868) ';

export function trinidadLocalDigits(value: string | null | undefined): string {
  let digits = (value ?? '').replace(/\D/g, '');
  if (digits.startsWith('1868')) digits = digits.slice(4);
  else if (digits.startsWith('868')) digits = digits.slice(3);
  return digits.slice(0, 7);
}

export function formatTrinidadLocalNumber(value: string | null | undefined): string {
  const digits = trinidadLocalDigits(value);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function isCompleteTrinidadPhone(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' || trinidadLocalDigits(trimmed).length === 7;
}

export function normalizeTrinidadPhone(value: string | null | undefined): string | null {
  const digits = trinidadLocalDigits(value);
  if (!digits.length) return null;
  if (digits.length !== 7) return null;
  return `${TRINIDAD_PHONE_PREFIX}${digits.slice(0, 3)}-${digits.slice(3)}`;
}
