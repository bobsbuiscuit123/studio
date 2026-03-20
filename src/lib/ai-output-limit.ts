export const MAX_TAB_AI_OUTPUT_CHARS = 1080;

const isDataUri = (value: string) => /^data:/i.test(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const countAiOutputChars = (value: unknown): number => {
  if (typeof value === 'string') {
    if (isDataUri(value)) {
      return 0;
    }
    return value.length;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countAiOutputChars(item), 0);
  }

  if (isPlainObject(value)) {
    return Object.values(value).reduce<number>(
      (total, item) => total + countAiOutputChars(item),
      0
    );
  }

  return 0;
};

export const clampAiOutputChars = <T>(
  value: T,
  maxChars = MAX_TAB_AI_OUTPUT_CHARS
): T => {
  let remaining = Math.max(0, Math.floor(maxChars));

  const visit = (input: unknown): unknown => {
    if (typeof input === 'string') {
      if (isDataUri(input)) {
        return input;
      }

      if (remaining <= 0) {
        return '';
      }

      const next = input.slice(0, remaining);
      remaining -= next.length;
      return next;
    }

    if (Array.isArray(input)) {
      return input.map(item => visit(item));
    }

    if (isPlainObject(input)) {
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [key, visit(item)])
      );
    }

    return input;
  };

  return visit(value) as T;
};
