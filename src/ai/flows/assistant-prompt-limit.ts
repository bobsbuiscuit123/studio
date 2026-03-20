export const MAX_ASSISTANT_PROMPT_CHARS = 1856;

export const clampAssistantPrompt = (value?: string | null) => {
  const text = String(value ?? '');
  if (text.length <= MAX_ASSISTANT_PROMPT_CHARS) {
    return text;
  }
  return text.slice(0, MAX_ASSISTANT_PROMPT_CHARS);
};
