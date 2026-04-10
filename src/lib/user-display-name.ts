type AuthNameSource =
  | {
      user_metadata?: Record<string, unknown> | null;
    }
  | undefined;

const normalizeDisplayName = (value?: string | null) =>
  typeof value === "string" ? value.trim() : "";

const normalizeComparableEmail = (value?: string | null) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export function getAuthMetadataDisplayName(user?: AuthNameSource) {
  const metadata = user?.user_metadata ?? {};
  const metadataName =
    (metadata["full_name"] as string | undefined) ??
    (metadata["name"] as string | undefined) ??
    (metadata["display_name"] as string | undefined);

  return normalizeDisplayName(metadataName);
}

export function resolveStoredDisplayName({
  preferredName,
  existingProfileName,
  authDisplayName,
  email,
}: {
  preferredName?: string | null;
  existingProfileName?: string | null;
  authDisplayName?: string | null;
  email?: string | null;
}) {
  const resolvedPreferredName = normalizeDisplayName(preferredName);
  if (resolvedPreferredName) {
    return resolvedPreferredName;
  }

  const resolvedExistingName = normalizeDisplayName(existingProfileName);
  const resolvedAuthDisplayName = normalizeDisplayName(authDisplayName);
  const normalizedEmail = normalizeComparableEmail(email);
  const existingNameMatchesEmail =
    resolvedExistingName.length > 0 &&
    normalizedEmail.length > 0 &&
    resolvedExistingName.toLowerCase() === normalizedEmail;

  if (resolvedExistingName && (!existingNameMatchesEmail || !resolvedAuthDisplayName)) {
    return resolvedExistingName;
  }

  if (resolvedAuthDisplayName) {
    return resolvedAuthDisplayName;
  }

  if (resolvedExistingName) {
    return resolvedExistingName;
  }

  return "Member";
}
