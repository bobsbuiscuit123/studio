import { secureRandomInt } from '@/lib/secure-random';

const DEFAULT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateRandomCode(length: number, alphabet: string = DEFAULT_ALPHABET) {
  if (!Number.isInteger(length) || length <= 0 || alphabet.length === 0) {
    return '';
  }

  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += alphabet[secureRandomInt(alphabet.length)];
  }

  return code;
}
