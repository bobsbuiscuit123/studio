export type PolicyViolation = {
  path: string;
  match: string;
};

const BLOCKED_PATTERNS: RegExp[] = [
  /\b(fuck|shit|bitch|asshole|bastard|dick|pussy|cunt)\b/i,
  /\b(nigger|faggot|slut|whore)\b/i,
  /\b(porn|nude|nudity|sex|rape|molest|incest)\b/i,
  /\b(kill\s+yourself)\b/i,
];

export const policyErrorMessage =
  'That content violates app policies. Please remove inappropriate language.';

const scanString = (value: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();

  // Skip machine-generated URL payloads like gallery image data URIs and remote image links.
  // Those can contain arbitrary base64/text fragments that look like blocked words even when
  // the user-entered content is harmless.
  if (
    /^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed) ||
    /^https?:\/\//i.test(trimmed)
  ) {
    return null;
  }

  for (const pattern of BLOCKED_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[0]) {
      return match[0];
    }
  }
  return null;
};

export const findPolicyViolation = (value: unknown): PolicyViolation | null => {
  const seen = new WeakSet<object>();

  const walk = (current: unknown, path: string): PolicyViolation | null => {
    if (typeof current === 'string') {
      const hit = scanString(current);
      return hit ? { path, match: hit } : null;
    }
    if (!current || typeof current !== 'object') return null;
    if (seen.has(current as object)) return null;
    seen.add(current as object);

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i += 1) {
        const found = walk(current[i], `${path}[${i}]`);
        if (found) return found;
      }
      return null;
    }

    for (const [key, val] of Object.entries(current as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${key}` : key;
      const found = walk(val, nextPath);
      if (found) return found;
    }
    return null;
  };

  return walk(value, '');
};

export const validatePolicyOrThrow = (value: unknown) => {
  const violation = findPolicyViolation(value);
  if (violation) {
    const error = new Error(policyErrorMessage);
    (error as Error & { violation?: PolicyViolation }).violation = violation;
    throw error;
  }
};
