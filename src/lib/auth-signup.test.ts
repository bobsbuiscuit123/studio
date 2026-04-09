import { describe, expect, it } from 'vitest';

import {
  getSignupServerErrorMessage,
  getSignupValidationMessage,
  isExistingSignupError,
  normalizeAuthEmail,
  SIGNUP_PASSWORD_MIN_LENGTH,
} from '@/lib/auth-signup';

describe('auth signup helpers', () => {
  it('keeps signup password requirements centralized', () => {
    expect(SIGNUP_PASSWORD_MIN_LENGTH).toBe(8);
  });

  it('normalizes signup emails', () => {
    expect(normalizeAuthEmail('  Test.User@Example.com  ')).toBe('test.user@example.com');
  });

  it('detects existing-user auth errors', () => {
    expect(isExistingSignupError('User already registered')).toBe(true);
    expect(isExistingSignupError('duplicate key value violates unique constraint')).toBe(true);
    expect(isExistingSignupError('something unrelated')).toBe(false);
  });

  it('returns the first validation issue message', () => {
    expect(
      getSignupValidationMessage([{ message: 'Password must be at least 8 characters.' }])
    ).toBe('Password must be at least 8 characters.');
  });

  it('hides server env details from signup users', () => {
    expect(getSignupServerErrorMessage('Missing Supabase admin env vars.')).toBe(
      'Signup is temporarily unavailable. Please try again later.'
    );
  });
});
