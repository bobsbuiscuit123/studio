export const SIGNUP_PASSWORD_MIN_LENGTH = 8;

const EXISTING_USER_ERROR_PATTERN =
  /(already|exists|duplicate|registered|taken|in use|email.*use|user.*exists)/i;

export const normalizeAuthEmail = (value: string) => value.trim().toLowerCase();

export const isExistingSignupError = (message: string) =>
  EXISTING_USER_ERROR_PATTERN.test(message);

export const getSignupValidationMessage = (issues: Array<{ message?: string }>) =>
  issues[0]?.message || 'Invalid signup payload.';

export const getSignupServerErrorMessage = (message: string) => {
  if (/missing supabase admin env vars/i.test(message)) {
    return 'Signup is temporarily unavailable. Please try again later.';
  }

  return message || 'Signup failed.';
};
