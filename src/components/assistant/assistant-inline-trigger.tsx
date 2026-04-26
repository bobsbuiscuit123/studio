"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type AssistantInlineTriggerProps = {
  onClick: () => void;
  label?: string;
  className?: string;
};

export function AssistantInlineTrigger({
  onClick,
  label = "AI Assistant",
  className,
}: AssistantInlineTriggerProps) {
  return (
    <TooltipProvider delayDuration={140}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClick}
            aria-label={label}
            className={cn(
              "group h-9 w-9 min-h-0 rounded-full border border-emerald-300/20 bg-[radial-gradient(circle_at_30%_30%,rgba(167,243,208,0.38),rgba(17,24,20,0.96)_72%)] text-emerald-50 shadow-[0_6px_18px_rgba(16,185,129,0.16)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200/45 hover:bg-[radial-gradient(circle_at_30%_30%,rgba(209,250,229,0.5),rgba(17,24,20,0.96)_72%)] hover:text-white hover:shadow-[0_10px_28px_rgba(16,185,129,0.24)] focus-visible:ring-2 focus-visible:ring-emerald-300/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:size-[1.05rem]",
              className
            )}
          >
            <Sparkles className="transition-transform duration-200 group-hover:scale-110 group-hover:rotate-6" />
            <span className="sr-only">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="border-emerald-300/20 bg-[#18231b] text-emerald-50 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
