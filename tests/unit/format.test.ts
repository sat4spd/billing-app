import { describe, expect, it } from 'vitest';
import {
  amountInWordsEn,
  amountInWordsHi,
  formatAmount,
  money,
  moneyDual,
  toEnglishDigits,
  toHindiDigits,
} from '@/lib/format';
import { errorMessage } from '@/lib/errors';

describe('Hindi & English numeral formatting', () => {
  it('converts digits to Hindi and back', () => {
    expect(toHindiDigits('3,800')).toBe('३,८००');
    expect(toEnglishDigits('३,८००')).toBe('3,800');
  });

  it('formats Indian currency grouping', () => {
    expect(formatAmount(3800)).toBe('3,800');
    expect(formatAmount(125000)).toBe('1,25,000');
    expect(money(3800, 'hindi')).toBe('₹३,८००');
    expect(moneyDual(3800)).toBe('₹ ३,८०० (₹ 3,800)');
  });

  it('generates amount in words in Hindi and English', () => {
    expect(amountInWordsEn(3800)).toBe('Three Thousand Eight Hundred Rupees Only');
    expect(amountInWordsHi(3800)).toBe('तीन हज़ार आठ सौ रुपये मात्र');
  });
});

describe('Database error mapping', () => {
  it('maps SQL error codes to Hindi and English messages', () => {
    expect(errorMessage('INSUFFICIENT_STOCK: ऊनी शॉल (उपलब्ध 2)', 'hi')).toContain('स्टॉक पर्याप्त नहीं है');
    expect(errorMessage('PRICE_EDIT_NOT_ALLOWED', 'en')).toBe('Not allowed to change price');
  });
});
