const DEFAULT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateRandomCode(length: number, alphabet: string = DEFAULT_ALPHABET) {
  if (!Number.isInteger(length) || length <= 0 || alphabet.length === 0) {
    return '';
  }

  const values = new Uint32Array(length);
  const cryptoObject = globalThis.crypto;

  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * alphabet.length);
    }
  }

  let code = '';
  for (let index = 0; index < values.length; index += 1) {
    code += alphabet[values[index] % alphabet.length];
  }

  return code;
}
