import { describe, expect, it } from 'vitest';
import {
  TRINIDAD_PHONE_PREFIX,
  formatTrinidadLocalNumber,
  isCompleteTrinidadPhone,
  normalizeTrinidadPhone,
  trinidadLocalDigits,
} from '../../types/trinidadPhone';

describe('Trinidad employee phone contract', () => {
  it('normalizes local, area-code and international forms to one stored value', () => {
    for (const value of ['5550147', '555-0147', '8685550147', '+1 (868) 555-0147']) {
      expect(normalizeTrinidadPhone(value)).toBe('+1 (868) 555-0147');
    }
  });

  it('keeps the prefix separate and formats only the editable seven digits', () => {
    expect(TRINIDAD_PHONE_PREFIX).toBe('+1 (868) ');
    expect(trinidadLocalDigits('+1 (868) 335-7821')).toBe('3357821');
    expect(formatTrinidadLocalNumber('3357821')).toBe('335-7821');
  });

  it('accepts blank optional values but rejects incomplete numbers', () => {
    expect(isCompleteTrinidadPhone('')).toBe(true);
    expect(isCompleteTrinidadPhone('555-014')).toBe(false);
    expect(normalizeTrinidadPhone('555-014')).toBeNull();
  });
});
