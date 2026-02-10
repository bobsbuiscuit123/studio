const stripScriptTags = (value: string) =>
  value.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '');

const stripJavascriptLinks = (value: string) =>
  value.replace(/javascript:/gi, '');

export const sanitizeAiText = (value: string) =>
  stripJavascriptLinks(stripScriptTags(value)).trim();

export const sanitizeInternalHref = (href?: string) => {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed.startsWith('/')) return undefined;
  if (trimmed.startsWith('//')) return undefined;
  return trimmed;
};

