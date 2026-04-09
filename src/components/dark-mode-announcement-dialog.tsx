"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { MoonStar } from "lucide-react";

import { useAppTheme } from "@/hooks/use-app-theme";
import { useCurrentUser } from "@/lib/data-hooks";
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MoonStar className="h-5 w-5 text-primary" />
            Dark mode is here
          </DialogTitle>
          <DialogDescription>
            CASPO now supports dark mode. You can turn it on now or keep the current theme.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button variant="ghost" onClick={handleClose}>
            Close
          </Button>
          <Button onClick={handleEnableDarkMode}>
            Enable dark mode
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
