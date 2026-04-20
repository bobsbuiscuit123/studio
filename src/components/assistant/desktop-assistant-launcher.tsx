"use client";

import { Sparkles } from "lucide-react";

import { AIChatModal } from "@/components/assistant/ai-chat-modal";
import { useAssistantChat } from "@/components/assistant/use-assistant-chat";
import { cn } from "@/lib/utils";

export function DesktopAssistantLauncher() {
  const {
    assistantButtonRef,
    assistantInput,
    assistantMessages,
    handleAssistantRetry,
    handleAssistantSend,
    isAssistantOpen,
    isAssistantSending,
    setAssistantInput,
    setIsAssistantOpen,
  } = useAssistantChat({ enableExternalOpen: true });

  return (
    <div className="hidden md:flex md:items-center">
      <AIChatModal
        open={isAssistantOpen}
        onOpenChange={setIsAssistantOpen}
        messages={assistantMessages}
        input={assistantInput}
        onInputChange={setAssistantInput}
        onSend={handleAssistantSend}
        onRetry={handleAssistantRetry}
        isSending={isAssistantSending}
        anchorRef={assistantButtonRef}
        placement="below"
      />

      <button
        ref={assistantButtonRef}
        type="button"
        onClick={() => setIsAssistantOpen(current => !current)}
        className={cn(
          "assistant-desktop-button",
          isAssistantOpen && "ring-4 ring-emerald-200/35 ring-offset-2 ring-offset-background"
        )}
        aria-label="Open assistant"
        aria-expanded={isAssistantOpen}
      >
        <Sparkles className="h-5 w-5" />
        <span className="sr-only">Open assistant</span>
      </button>
    </div>
  );
}
