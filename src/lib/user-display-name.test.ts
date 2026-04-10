import { describe, expect, it } from "vitest";

import {
  getAuthMetadataDisplayName,
  resolveStoredDisplayName,
} from "@/lib/user-display-name";

describe("user display name helpers", () => {
  it("reads the auth metadata display name without falling back to email", () => {
    expect(
      getAuthMetadataDisplayName({
        user_metadata: {
          display_name: "  Pratheek Mukkavilli  ",
        },
      })
    ).toBe("Pratheek Mukkavilli");

    expect(
      getAuthMetadataDisplayName({
        user_metadata: {},
      })
    ).toBe("");
  });

  it("prefers the explicitly provided name", () => {
    expect(
      resolveStoredDisplayName({
        preferredName: "  Alex Johnson  ",
        existingProfileName: "alex@example.com",
        authDisplayName: "Alex",
        email: "alex@example.com",
      })
    ).toBe("Alex Johnson");
  });

  it("repairs an email-like stored name when auth metadata has a real name", () => {
    expect(
      resolveStoredDisplayName({
        existingProfileName: "alex@example.com",
        authDisplayName: "Alex Johnson",
        email: "alex@example.com",
      })
    ).toBe("Alex Johnson");
  });

  it("preserves the stored profile name when there is no better name source", () => {
    expect(
      resolveStoredDisplayName({
        existingProfileName: "alex@example.com",
        authDisplayName: "",
        email: "alex@example.com",
      })
    ).toBe("alex@example.com");
  });

  it('falls back to "Member" when no display name exists', () => {
    expect(
      resolveStoredDisplayName({
        existingProfileName: "",
        authDisplayName: "",
        email: "alex@example.com",
      })
    ).toBe("Member");
  });
});
