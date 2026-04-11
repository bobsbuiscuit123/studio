"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { MoonStar, Sparkles } from "lucide-react";

import { useAppTheme } from "@/hooks/use-app-theme";
import { useCurrentUser } from "@/lib/current-user";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DARK_MODE_ANNOUNCEMENT_VERSION = "v1";

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const getDarkModeAnnouncementKey = (email: string) =>
  `dark-mode-announcement:${DARK_MODE_ANNOUNCEMENT_VERSION}:${normalizeEmail(email)}`;

const isEligibleAppPath = (pathname: string) => {
  if (!pathname) {
    return false;
  }

  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/browse-clubs") ||
    pathname.startsWith("/demo")
  ) {
    return false;
  }

  return true;
};

export function DarkModeAnnouncementDialog() {
  const pathname = usePathname();
  const { user, loading } = useCurrentUser();
  const { setTheme } = useAppTheme();
  const [isOpen, setIsOpen] = useState(false);

  const announcementKey = useMemo(
    () => (user?.email ? getDarkModeAnnouncementKey(user.email) : ""),
    [user?.email]
  );

  const markSeen = () => {
    if (!announcementKey || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(announcementKey, "1");
    } catch {
      // Ignore storage failures and still close the dialog for this session.
    }
  };

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user?.email || !isEligibleAppPath(pathname)) {
      setIsOpen(false);
      return;
    }

    if (!announcementKey || typeof window === "undefined") {
      setIsOpen(false);
      return;
    }

    try {
      if (window.localStorage.getItem(announcementKey) === "1") {
        setIsOpen(false);
        return;
      }
    } catch {
      // Fall through and show the dialog if storage cannot be read.
    }

    setIsOpen(true);
  }, [announcementKey, loading, pathname, user?.email]);

  const handleClose = () => {
    markSeen();
    setIsOpen(false);
  };

  const handleEnableDarkMode = () => {
    setTheme("dark");
    handleClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
    >
      <DialogContent className="top-[50%] max-h-[calc(100dvh-2.5rem)] w-[calc(100%-2rem)] max-w-[28rem] translate-y-[-50%] overflow-hidden rounded-[2rem] border-border/70 bg-background p-0 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:top-[50%] sm:translate-y-[-50%]">
        <div className="relative overflow-hidden rounded-[2rem]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.22),transparent_45%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))]" />
          <div className="absolute left-[-3.5rem] top-[-3.5rem] h-32 w-32 rounded-full bg-emerald-400/18 blur-3xl" />
          <div className="absolute right-[-2rem] top-16 h-24 w-24 rounded-full bg-lime-300/12 blur-3xl" />
          <div className="relative flex flex-col gap-6 px-6 pb-6 pt-8 sm:px-7 sm:pb-7 sm:pt-9">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-emerald-300/30 bg-gradient-to-br from-emerald-300/25 via-emerald-400/10 to-transparent shadow-[0_18px_40px_rgba(74,222,128,0.18)]">
              <div className="flex h-14 w-14 items-center justify-center rounded-[1.2rem] bg-emerald-400/15 text-emerald-300">
                <MoonStar className="h-8 w-8" />
              </div>
            </div>

            <DialogHeader className="space-y-3 text-center sm:text-center">
              <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" />
                New theme option
              </div>
              <DialogTitle className="text-3xl font-semibold tracking-tight text-foreground sm:text-[2.15rem]">
                Dark mode is now here!
              </DialogTitle>
              <DialogDescription className="mx-auto max-w-sm text-base leading-7 text-muted-foreground">
                Give CASPO a sleeker nighttime look. Turn it on now, or keep your current theme and change it later in Settings.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="flex-col gap-3 sm:flex-col sm:space-x-0">
              <Button
                onClick={handleEnableDarkMode}
                className="h-12 w-full rounded-2xl bg-emerald-500 text-slate-950 shadow-[0_16px_32px_rgba(74,222,128,0.28)] hover:bg-emerald-400"
              >
                Enable dark mode
              </Button>
              <Button
                variant="ghost"
                onClick={handleClose}
                className="h-11 w-full rounded-2xl text-muted-foreground hover:text-foreground"
              >
                Maybe later
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
