import { describe, expect, it } from "vitest";

import { stableSerialize } from "@/lib/stable-serialize";

describe("stableSerialize", () => {
  it("serializes Date objects using their actual timestamp", () => {
    const early = {
      id: "event-1",
      date: new Date(2026, 3, 10, 5, 0, 0, 0),
    };
    const late = {
      id: "event-1",
      date: new Date(2026, 3, 10, 18, 30, 0, 0),
    };

    expect(stableSerialize(early)).not.toBe(stableSerialize(late));
  });

  it("keeps object-key ordering stable", () => {
    expect(
      stableSerialize({
        b: 2,
        a: 1,
      })
    ).toBe(
      stableSerialize({
        a: 1,
        b: 2,
      })
    );
  });
});
