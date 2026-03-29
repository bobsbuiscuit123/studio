"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgSubscriptionStatus } from "@/lib/org-subscription-hooks";

export function OrgAiQuotaBadge({
  orgId,
  className,
  compact = false,
}: {
  orgId?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const { loading, status, used, limit, percent } = useOrgSubscriptionStatus(orgId);
  const paused = !status?.aiAvailable;
  const safeLimit = Math.max(0, limit);
  const safeUsed = safeLimit > 0 ? Math.max(0, Math.min(used, safeLimit)) : 0;
  const usedPercent = safeLimit > 0 ? Math.max(0, Math.min(100, percent)) : 0;
  const hue = 145 - ((145 - 18) * usedPercent) / 100;
  const accent = `hsl(${hue} 78% 42%)`;
  const accentSoft = `hsl(${hue} 85% 94%)`;
  const accentBorder = `hsl(${hue} 75% 82%)`;
  const accentTrack = `hsl(${hue} 55% 80% / 0.35)`;

  const radius = compact ? 16 : 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (usedPercent / 100) * circumference;
  const usageLabel = loading
    ? "..."
    : safeLimit <= 0
      ? "AI unavailable"
      : `${safeUsed}/${safeLimit} used`;

  return (
    <div
      style={{
        borderColor: accentBorder,
        backgroundColor: accentSoft,
        color: accent,
      }}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5",
        compact ? "text-xs" : "text-sm",
        className
      )}
    >
      <div className="relative h-9 w-9 shrink-0">
        <svg viewBox="0 0 44 44" className="h-9 w-9 -rotate-90">
          <circle
            cx="22"
            cy="22"
            r={radius}
            fill="none"
            stroke={accentTrack}
            strokeWidth="4"
          />
          <circle
            cx="22"
            cy="22"
            r={radius}
            fill="none"
            stroke={accent}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
      </div>
      <span className="font-semibold tabular-nums">
        {paused && safeLimit <= 0 ? "AI unavailable" : usageLabel}
      </span>
    </div>
  );
}
