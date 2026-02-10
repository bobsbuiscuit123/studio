"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/data-hooks";

type LegacyClub = {
  id: string;
  name: string;
  joinCode: string;
  category: string;
  description: string;
  meetingTime: string;
  logo?: string;
};

export function ImportLocalData() {
  const { user } = useCurrentUser();
  const [legacyClubs, setLegacyClubs] = useState<LegacyClub[]>([]);
  const [open, setOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const promptOpenRef = useRef(false);
  const promptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (promptOpenRef.current) return;
    const identity = user.email || user.name || "unknown";
    const promptKey = `clubhub_import_prompt_shown:${identity}`;
    promptKeyRef.current = promptKey;
    if (localStorage.getItem("clubhub_import_done")) {
      localStorage.setItem(promptKey, "1");
      return;
    }
    const alreadyPrompted = localStorage.getItem(promptKey);
    if (alreadyPrompted) return;

    const clubsString = localStorage.getItem("clubs");
    if (!clubsString) return;
    try {
      const clubs = JSON.parse(clubsString) as LegacyClub[];
      const foundCount = Array.isArray(clubs) ? clubs.length : 0;
      if (foundCount <= 0) return;

      // Mark as shown before opening to prevent re-triggers from auth refresh/remount.
      localStorage.setItem(promptKey, "1");
      promptOpenRef.current = true;
      setLegacyClubs(clubs);
      setOpen(true);
    } catch {
      // ignore
    }
  }, [user]);

  const handleImport = async () => {
    setIsImporting(true);
    for (const club of legacyClubs) {
      const clubDataString = localStorage.getItem(`club_${club.id}`);
      const clubData = clubDataString ? JSON.parse(clubDataString) : {};
      const response = await fetch("/api/orgs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: club.name,
          joinCode: club.joinCode,
          category: club.category,
          description: club.description,
          meetingTime: club.meetingTime,
          logoUrl: clubData.logo || club.logo || "",
        }),
      }).then(res => res.json());
      if (!response?.ok) {
        console.error("Import org failed", response?.error);
        continue;
      }
      await fetch("/api/org-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: response.orgId, data: clubData }),
      });
    }
    if (promptKeyRef.current) {
      localStorage.setItem(promptKeyRef.current, "1");
    }
    setIsImporting(false);
    setOpen(false);
  };

  const handleSkip = () => {
    if (promptKeyRef.current) {
      localStorage.setItem(promptKeyRef.current, "1");
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen);
        if (!nextOpen) {
          promptOpenRef.current = false;
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import your local data?</DialogTitle>
          <DialogDescription>
            We found {legacyClubs.length} local club{legacyClubs.length === 1 ? "" : "s"}. Import them into your new account.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={handleSkip} disabled={isImporting}>
            Skip
          </Button>
          <Button onClick={handleImport} disabled={isImporting}>
            {isImporting ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
