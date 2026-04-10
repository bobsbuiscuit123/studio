const MODAL_CONTENT_SELECTOR = "[data-caspo-modal-content]";
const OPEN_MODAL_CONTENT_SELECTOR = `${MODAL_CONTENT_SELECTOR}[data-state='open']`;
const MODAL_LAYER_SELECTOR = "[data-caspo-modal-overlay], [data-caspo-modal-content]";
const RADIX_PORTAL_SELECTOR = "[data-radix-portal]";

const INTERACTIVITY_CLASS_PREFIXES = [
  "block-interactivity-",
  "allow-interactivity-",
] as const;

export const DEFAULT_MODAL_LAYER_REPAIR_DELAYS = [0, 120, 420, 900];

function isVisibleElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
    return false;
  }

  return element.getClientRects().length > 0;
}

function stripInteractivityClasses(root: ParentNode) {
  const elements = [
    ...(root instanceof HTMLElement ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>("[class]")),
  ];

  let changed = false;

  elements.forEach((element) => {
    const classesToRemove = Array.from(element.classList).filter((className) =>
      INTERACTIVITY_CLASS_PREFIXES.some((prefix) => className.startsWith(prefix))
    );

    if (classesToRemove.length > 0) {
      element.classList.remove(...classesToRemove);
      changed = true;
    }
  });

  return changed;
}

export function hasVisibleOpenModal(documentRef: Document = document) {
  return Array.from(documentRef.querySelectorAll<HTMLElement>(OPEN_MODAL_CONTENT_SELECTOR)).some(isVisibleElement);
}

export function repairStaleModalLayers(documentRef: Document = document) {
  if (typeof window === "undefined" || typeof documentRef === "undefined") {
    return false;
  }

  if (hasVisibleOpenModal(documentRef)) {
    return false;
  }

  let repaired = false;
  const { body } = documentRef;

  if (body.style.pointerEvents === "none") {
    body.style.removeProperty("pointer-events");
    repaired = true;
  }

  if (stripInteractivityClasses(body)) {
    repaired = true;
  }

  Array.from(documentRef.querySelectorAll<HTMLElement>(MODAL_LAYER_SELECTOR)).forEach((element) => {
    element.remove();
    repaired = true;
  });

  Array.from(documentRef.querySelectorAll<HTMLElement>(RADIX_PORTAL_SELECTOR)).forEach((portal) => {
    if (portal.childElementCount === 0) {
      portal.remove();
      repaired = true;
    }
  });

  return repaired;
}

export function scheduleModalLayerRepair(
  delays: number[] = DEFAULT_MODAL_LAYER_REPAIR_DELAYS
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const timeoutIds = delays.map((delay) =>
    window.setTimeout(() => {
      repairStaleModalLayers();
    }, delay)
  );

  return () => {
    timeoutIds.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
  };
}
