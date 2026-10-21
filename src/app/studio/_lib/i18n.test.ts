import { describe, expect, it } from 'vitest';
import { breakLocalStorage } from '@/test/browser';
import { dirOf, formatClock, initialLocale, localeFromLanguageCode, persistLocale } from './i18n';

describe('locale', () => {
  it('maps Telegram language codes', () => {
    expect(localeFromLanguageCode('fa')).toBe('fa');
    expect(localeFromLanguageCode('FA-ir')).toBe('fa');
    expect(localeFromLanguageCode('en-US')).toBe('en');
    expect(localeFromLanguageCode('fr')).toBe('en');
    expect(localeFromLanguageCode(undefined)).toBe('en');
  });

  it('prefers the stored choice, and falls back to Telegram when storage throws', () => {
    persistLocale('fa');
    expect(initialLocale('en')).toBe('fa');
    breakLocalStorage();
    expect(initialLocale('fa')).toBe('fa');
    expect(initialLocale('en')).toBe('en');
    expect(() => persistLocale('en')).not.toThrow();
  });

  it('derives direction and locale digits', () => {
    expect(dirOf('fa')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
    expect(formatClock(75, 'en')).toBe('01:15');
    expect(formatClock(75, 'fa')).toBe('۰۱:۱۵');
  });
});
