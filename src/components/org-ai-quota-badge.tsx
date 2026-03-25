"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgAiQuotaStatus } from "@/lib/data-hooks";

export function OrgAiQuotaBadge({
  orgId,
  className,
  compact = false,
}: {
  orgId?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const { loading, status, limit, remaining, percent } = useOrgAiQuotaStatus(orgId);
  const paused = status?.aiAvailability === 'paused';
  const safeLimit = Math.max(0, limit);
  const safeRemaining = paused ? 0 : Math.max(0, Math.min(remaining, safeLimit));
  const remainingPercent = safeLimit > 0 ? (safeRemaining / safeLimit) * 100 : 0;
  const clampedPercent = Math.max(0, Math.min(100, remainingPercent));
  const hue = clampedPercent <= 25 ? 18 : 145 - (145 * clampedPercent) / 100;
  const accent = `hsl(${hue} 78% 42%)`;
  const accentSoft = `hsl(${hue} 85% 94%)`;
  const accentBorder = `hsl(${hue} 75% 82%)`;
  const accentTrack = `hsl(${hue} 55% 80% / 0.35)`;

  const radius = compact ? 16 : 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedPercent / 100) * circumference;

  return (
    <div
      style={{
        borderColor: accentBorder,
        backgroundColor: accentSoft,
        color: accent,
      }}
      className={cn(
        "inline-flex items-center gap-3 rounded-full border px-3 py-2",
        compact ? "text-xs" : "text-sm",
        className
      )}
    >
      <div className="relative h-10 w-10 shrink-0">
        <svg viewBox="0 0 44 44" className="h-10 w-10 -rotate-90">
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
      <div className="leading-tight">
        <div className="font-semibold">Daily AI left</div>
        <div className="opacity-80">
          {loading
            ? "Loading..."
            : safeLimit <= 0
              ? "0 requests left today"
              : `${safeRemaining}/${safeLimit} requests left today`}
        </div>
      </div>
    </div>
  );
}
