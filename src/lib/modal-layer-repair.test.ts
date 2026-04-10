// @vitest-environment jsdom

import {
  hasVisibleOpenModal,
  repairStaleModalLayers,
} from "@/lib/modal-layer-repair";

describe("modal layer repair", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.className = "";
    document.body.removeAttribute("style");
  });

  it("does not repair while a visible modal is still open", () => {
    document.body.style.pointerEvents = "none";

    const content = document.createElement("div");
    content.dataset.caspoModalContent = "";
    content.dataset.state = "open";
    Object.defineProperty(content, "getClientRects", {
      configurable: true,
      value: () => [{ width: 200, height: 120 }],
    });
    document.body.appendChild(content);

    expect(hasVisibleOpenModal(document)).toBe(true);
    expect(repairStaleModalLayers(document)).toBe(false);
    expect(document.body.style.pointerEvents).toBe("none");
    expect(document.body.contains(content)).toBe(true);
  });

  it("clears stale pointer locks and removes orphaned modal nodes", () => {
    document.body.style.pointerEvents = "none";
    document.body.className = "block-interactivity-7 app";

    const shard = document.createElement("div");
    shard.className = "allow-interactivity-7";
    document.body.appendChild(shard);

    const overlay = document.createElement("div");
    overlay.dataset.caspoModalOverlay = "";
    document.body.appendChild(overlay);

    const content = document.createElement("div");
    content.dataset.caspoModalContent = "";
    content.dataset.state = "closed";
    document.body.appendChild(content);

    const portal = document.createElement("div");
    portal.setAttribute("data-radix-portal", "");
    document.body.appendChild(portal);

    expect(repairStaleModalLayers(document)).toBe(true);
    expect(document.body.style.pointerEvents).toBe("");
    expect(document.body.classList.contains("block-interactivity-7")).toBe(false);
    expect(shard.classList.contains("allow-interactivity-7")).toBe(false);
    expect(document.body.contains(overlay)).toBe(false);
    expect(document.body.contains(content)).toBe(false);
    expect(document.body.contains(portal)).toBe(false);
  });
});
