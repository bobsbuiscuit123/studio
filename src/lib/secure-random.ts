const UINT32_RANGE = 2 ** 32;

const getCrypto = () => {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject || typeof cryptoObject.getRandomValues !== 'function') {
    throw new Error('Secure random values are not available in this runtime.');
  }
  return cryptoObject;
};

const createUuidFromRandomValues = () => {
  const values = new Uint8Array(16);
  getCrypto().getRandomValues(values);
  values[6] = (values[6] & 0x0f) | 0x40;
  values[8] = (values[8] & 0x3f) | 0x80;

  const hex = Array.from(values, value => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
};

export const createSecureId = (prefix?: string) => {
  const cryptoObject = getCrypto();
  const id =
    typeof cryptoObject.randomUUID === 'function'
      ? cryptoObject.randomUUID()
      : createUuidFromRandomValues();
  return prefix ? `${prefix}-${id}` : id;
};

export const secureRandomInt = (maxExclusive: number) => {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new RangeError('maxExclusive must be a positive safe integer no larger than 2^32.');
  }

  const cryptoObject = getCrypto();
  const values = new Uint32Array(1);
  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;

  do {
    cryptoObject.getRandomValues(values);
  } while (values[0] >= limit);

  return values[0] % maxExclusive;
};

export const secureRandomFloat = () => {
  const values = new Uint32Array(1);
  getCrypto().getRandomValues(values);
  return values[0] / UINT32_RANGE;
};
