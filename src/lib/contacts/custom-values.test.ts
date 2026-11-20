import { describe, it, expect } from 'vitest';
import { selectedValues, validateCustomValue } from './custom-values';
describe('custom field values', () => {
  it('recovers safely from legacy non-array values', () => {
    expect(selectedValues('old text')).toEqual([]);
    expect(selectedValues('null')).toEqual([]);
    expect(selectedValues('["a",2]')).toEqual(['a']);
  });
  it('distinguishes integers from decimals', () => {
    expect(() => validateCustomValue('number', '1.5')).toThrow();
    expect(validateCustomValue('decimal', '1.5')).toBe('1.5');
    expect(() => validateCustomValue('decimal', 'Infinity')).toThrow();
  });
  it('rejects values outside configured options', () => {
    expect(() => validateCustomValue('select', 'B', ['A'])).toThrow();
    expect(() => validateCustomValue('multiselect', '["B"]', ['A'])).toThrow();
    expect(validateCustomValue('multiselect', '["A"]', ['A'])).toBe('["A"]');
  });
  it('allows clearing optional values', () =>
    expect(validateCustomValue('date', '')).toBe(''));
});
