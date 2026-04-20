"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "assistant-entry-spotlight-v1";
const VIEWPORT_PADDING = 16;
const CARD_MAX_WIDTH = 320;

type SpotlightLayout = {
  desktop: boolean;
  left: number;
  top: number;
  arrowHeadLeft: number;
  arrowHeadTop: number;
  arrowHeight: number;
  ringLeft: number;
  ringTop: number;
  ringSize: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const resolveTarget = (desktop: boolean) =>
  document.querySelector<HTMLButtonElement>(
    desktop
      ? '[data-assistant-entry="desktop"]'
      : '[data-assistant-entry="mobile"]'
  );

export function AssistantEntrySpotlight() {
  const [mounted, setMounted] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);
  const [layout, setLayout] = useState<SpotlightLayout | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const dismiss = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "true");
    }
    setShouldShow(false);
  }, []);

  const updateLayout = useCallback(() => {
    if (typeof window === "undefined") {
      setLayout(null);
      return;
    }

    const desktop = window.matchMedia("(min-width: 768px)").matches;
    const target = resolveTarget(desktop);
    if (!target) {
      setLayout(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const cardWidth = Math.min(
      CARD_MAX_WIDTH,
      Math.max(280, viewportWidth - VIEWPORT_PADDING * 2)
    );
    const cardHeight = cardRef.current?.offsetHeight ?? 164;

    if (desktop) {
      const left = clamp(
        rect.right - cardWidth,
        VIEWPORT_PADDING,
        viewportWidth - VIEWPORT_PADDING - cardWidth
      );
      const top = clamp(
        rect.bottom + 44,
        VIEWPORT_PADDING,
        viewportHeight - VIEWPORT_PADDING - cardHeight
      );
      const anchorCenterX = rect.left + rect.width / 2;
      const arrowHeadLeft = anchorCenterX - 7;
      const arrowHeadTop = rect.bottom + 6;
      const arrowHeight = Math.max(18, top - rect.bottom - 16);
      setLayout({
        desktop: true,
        left,
        top,
        arrowHeadLeft,
        arrowHeadTop,
        arrowHeight,
        ringLeft: rect.left - 8,
        ringTop: rect.top - 8,
        ringSize: Math.max(rect.width, rect.height) + 16,
      });
      return;
    }

    const anchorCenterX = rect.left + rect.width / 2;
    const left = clamp(
      anchorCenterX - cardWidth / 2,
      VIEWPORT_PADDING,
      viewportWidth - VIEWPORT_PADDING - cardWidth
    );
    const top = clamp(
      rect.top - cardHeight - 84,
      VIEWPORT_PADDING,
      viewportHeight - VIEWPORT_PADDING - cardHeight
    );
    const arrowHeadLeft = anchorCenterX - 7;
    const arrowHeadTop = rect.top - 14;
    const arrowHeight = Math.max(18, rect.top - (top + cardHeight) - 22);

    setLayout({
      desktop: false,
      left,
      top,
      arrowHeadLeft,
      arrowHeadTop,
      arrowHeight,
      ringLeft: rect.left - 8,
      ringTop: rect.top - 8,
      ringSize: Math.max(rect.width, rect.height) + 16,
    });
  }, []);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") {
      return;
    }
    setShouldShow(window.localStorage.getItem(STORAGE_KEY) !== "true");
  }, []);

  useEffect(() => {
    if (!mounted || !shouldShow) {
      return;
    }

    updateLayout();
    const frameId = window.requestAnimationFrame(updateLayout);
    const intervalId = window.setInterval(updateLayout, 350);
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);
    window.addEventListener("scroll", updateLayout, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearInterval(intervalId);
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [mounted, shouldShow, updateLayout]);

  useEffect(() => {
    if (!shouldShow || !mounted) {
      return;
    }
    const target = resolveTarget(window.matchMedia("(min-width: 768px)").matches);
    if (!target) {
      return;
    }
    const handleTargetClick = () => dismiss();
    target.addEventListener("click", handleTargetClick);
    return () => target.removeEventListener("click", handleTargetClick);
  }, [dismiss, layout, mounted, shouldShow]);

  const overlay = useMemo(() => {
    if (!mounted || !shouldShow || !layout) {
      return null;
    }

    return (
      <div className="assistant-spotlight-layer" aria-live="polite">
        <div
          className="assistant-spotlight-scrim"
          aria-hidden="true"
        />
        <div
          className="assistant-spotlight-ring"
          style={{
            left: layout.ringLeft,
            top: layout.ringTop,
            width: layout.ringSize,
            height: layout.ringSize,
          }}
          aria-hidden="true"
        />
        <div
          className="assistant-spotlight-arrow-shaft"
          style={{
            left: layout.arrowHeadLeft + 6,
            top: layout.desktop ? layout.arrowHeadTop + 12 : layout.top + (cardRef.current?.offsetHeight ?? 164) + 10,
            height: layout.arrowHeight,
          }}
          aria-hidden="true"
        />
        <div
          className={cn(
            "assistant-spotlight-arrow-head",
            layout.desktop
              ? "assistant-spotlight-arrow-head-up"
              : "assistant-spotlight-arrow-head-down"
          )}
          style={{
            left: layout.arrowHeadLeft,
            top: layout.arrowHeadTop,
          }}
          aria-hidden="true"
        />
        <div
          ref={cardRef}
          className={cn(
            "assistant-spotlight-card",
            layout.desktop
              ? "assistant-spotlight-card-desktop"
              : "assistant-spotlight-card-mobile"
          )}
          style={{
            left: layout.left,
            top: layout.top,
          }}
          role="dialog"
          aria-modal="false"
          aria-label="AI assistant available"
        >
          <button
            type="button"
            onClick={dismiss}
            className="assistant-spotlight-close"
            aria-label="Dismiss assistant announcement"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="assistant-spotlight-badge">
            <Sparkles className="h-3.5 w-3.5" />
            New
          </div>
          <h2 className="assistant-spotlight-title">AI Assistant is here</h2>
          <p className="assistant-spotlight-copy">
            Tap the green button anytime to ask questions, draft content, and get help with your group.
          </p>
          <div className="assistant-spotlight-actions">
            <Button size="sm" onClick={dismiss}>
              Got it
            </Button>
          </div>
        </div>
      </div>
    );
  }, [dismiss, layout, mounted, shouldShow]);

  if (!overlay) {
    return null;
  }

  return createPortal(overlay, document.body);
}
