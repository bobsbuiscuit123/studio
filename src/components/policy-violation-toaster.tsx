"use client";

import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { policyErrorMessage } from "@/lib/content-policy";

export function PolicyViolationToaster() {
  const { toast } = useToast();

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>;
      const message = custom.detail?.message || policyErrorMessage;
      toast({
        title: "Content blocked",
        description: message,
        variant: "destructive",
      });
    };
    window.addEventListener("policy-violation", handler);
    return () => window.removeEventListener("policy-violation", handler);
  }, [toast]);

  return null;
}
