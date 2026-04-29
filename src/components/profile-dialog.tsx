"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Moon, RefreshCw } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { User as UserType } from "@/lib/mock-data";
import { safeFetchJson } from "@/lib/network";
import { useToast } from "@/hooks/use-toast";
import { useAppTheme } from "@/hooks/use-app-theme";
import { LegalDocumentDialog } from "@/components/legal-document-dialog";
import { notifyOrgSubscriptionChanged, useOrgSubscriptionStatus } from "@/lib/org-subscription-hooks";
import { getSelectedOrgId } from "@/lib/selection";
import {
  getSubscriptionPurchaseAvailability,
  restoreRevenueCatPurchases,
} from "@/lib/revenuecat-subscriptions";
import { DeleteAccountAction } from "@/components/delete-account-action";
import { compressImageFile } from "@/lib/image-resizer";
import { tryDeleteStoredImage, uploadImageToStorage } from "@/lib/storage-images";

type ProfileDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  user: UserType | null;
  onSave: (updatedUser: Partial<UserType>) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onLogout?: () => Promise<void> | void;
  mode?: 'live' | 'demo';
};

const AVATAR_MAX_DIMENSION = 512;
const AVATAR_JPEG_QUALITY = 0.82;

const readBlobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read avatar data."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read avatar file."));
    reader.readAsDataURL(blob);
  });

const loadImageFromFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load avatar image."));
    };
    image.src = objectUrl;
  });

const convertAvatarFileToDataUrl = async (file: File) => {
  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return readBlobAsDataUrl(file);
  }
  context.drawImage(image, 0, 0, width, height);
  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => {
    if (outputType === "image/png") {
      canvas.toBlob(resolve, outputType);
      return;
    }
    canvas.toBlob(resolve, outputType, AVATAR_JPEG_QUALITY);
  });
  if (!blob) {
    return readBlobAsDataUrl(file);
  }
  return readBlobAsDataUrl(blob);
};

const revokeObjectPreview = (url?: string | null) => {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

export function ProfileDialog({
  isOpen,
  onOpenChange,
  user,
  onSave,
  onDeleted,
  onLogout,
  mode = 'live',
}: ProfileDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [avatar, setAvatar] = useState(user?.avatar || "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    user?.avatar || null
  );
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [legalDialog, setLegalDialog] = useState<"terms" | "privacy" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { isDarkMode, setTheme } = useAppTheme();
  const selectedOrgId = getSelectedOrgId();
  const purchaseAvailability = useMemo(() => getSubscriptionPurchaseAvailability(), []);
  const { status: orgStatus, refresh: refreshOrgStatus } = useOrgSubscriptionStatus(selectedOrgId);

  useEffect(() => {
    if (isOpen) {
      setName(user?.name || "");
      setEmail(user?.email || "");
      setAvatar(user?.avatar || "");
      setAvatarPreview(user?.avatar || null);
      setAvatarFile(null);
    }
  }, [user, isOpen]);

  useEffect(() => {
    return () => {
      revokeObjectPreview(avatarPreview);
    };
  }, [avatarPreview]);

  const handleManageBilling = () => {
    if (!selectedOrgId) return;
    onOpenChange(false);
    router.push(`/orgs/${selectedOrgId}/credits`);
  };

  const syncSelectedOrgSubscription = async () => {
    if (!selectedOrgId) {
      throw new Error("Select an organization first.");
    }

    const response = await safeFetchJson<{ ok: true; data: { subscribedOrgId: string | null } }>(
      "/api/orgs/subscription/transfer",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetOrgId: selectedOrgId }),
      }
    );

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    notifyOrgSubscriptionChanged();
    await refreshOrgStatus({ force: true });
    return response.data.data?.subscribedOrgId ?? null;
  };

  const handleRestorePurchases = async () => {
    if (!selectedOrgId) {
      return;
    }

    if (!purchaseAvailability.supported) {
      toast({
        title: "Restore unavailable",
        description: purchaseAvailability.reason || "Purchases are unavailable on this device.",
        variant: "destructive",
      });
      return;
    }

    setIsRestoringPurchases(true);
    try {
      await restoreRevenueCatPurchases();
      await syncSelectedOrgSubscription();
      toast({
        title: "Purchases restored",
        description: "RevenueCat restored your App Store subscription and synced this organization.",
      });
    } catch (error) {
      toast({
        title: "Restore failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRestoringPurchases(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      if (mode === "demo") {
        const nextAvatar = await convertAvatarFileToDataUrl(file);
        setAvatarFile(null);
        setAvatarPreview(nextAvatar);
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      setAvatarFile(file);
      setAvatarPreview(previous => {
        revokeObjectPreview(previous);
        return objectUrl;
      });
    } catch (error) {
      console.error("Failed to process avatar image", error);
      toast({
        title: "Couldn't update picture",
        description: "Try a different image and save again.",
        variant: "destructive",
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSave = async () => {
    if (!user) {
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    let uploadedAvatarUrl: string | null = null;
    try {
      let nextAvatar = avatarPreview || avatar;

      if (avatarFile) {
        if (!selectedOrgId) {
          throw new Error("Select an organization before updating your picture.");
        }

        const compressedFile = await compressImageFile(avatarFile, {
          maxSizeMB: 0.2,
          maxWidthOrHeight: AVATAR_MAX_DIMENSION,
          initialQuality: AVATAR_JPEG_QUALITY,
          fileType: "image/webp",
        });
        const uploaded = await uploadImageToStorage({
          file: compressedFile,
          orgId: selectedOrgId,
          scope: "avatar",
          fileName: avatarFile.name,
        });
        uploadedAvatarUrl = uploaded.url;
        nextAvatar = uploaded.url;
      }

      await onSave({
        name,
        avatar: nextAvatar,
      });

      if (uploadedAvatarUrl && avatar && avatar !== uploadedAvatarUrl && selectedOrgId) {
        await tryDeleteStoredImage({
          url: avatar,
          orgId: selectedOrgId,
          scope: "avatar",
        });
      }

      setAvatar(nextAvatar);
      setAvatarFile(null);
      setAvatarPreview(nextAvatar);
      onOpenChange(false);
    } catch (error) {
      if (uploadedAvatarUrl && selectedOrgId) {
        await tryDeleteStoredImage({
          url: uploadedAvatarUrl,
          orgId: selectedOrgId,
          scope: "avatar",
        });
      }
      console.error("Failed to save profile", error);
      toast({
        title: "Couldn't save profile",
        description: error instanceof Error ? error.message : "Your picture was not saved. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      revokeObjectPreview(avatarPreview);
      setAvatarFile(null);
      setAvatar(user?.avatar || "");
      setAvatarPreview(user?.avatar || null);
    }
    onOpenChange(nextOpen);
  };

  const handleLogoutConfirm = async () => {
    setConfirmLogoutOpen(false);
    onOpenChange(false);
    await onLogout?.();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Update your account details and review legal documents here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2 flex flex-col items-center">
              <Avatar className="h-24 w-24">
                <AvatarImage src={avatarPreview || ""} />
                <AvatarFallback className="text-3xl">
                  {name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Change Picture
              </Button>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} readOnly disabled />
            </div>
            <div className="flex items-center justify-between rounded-xl border bg-muted/40 px-4 py-3">
              <div className="pr-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Moon className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="dark-mode-toggle" className="cursor-pointer">
                    Dark mode
                  </Label>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use the darker app theme on this device.
                </p>
              </div>
              <Switch
                id="dark-mode-toggle"
                checked={isDarkMode}
                onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                aria-label="Toggle dark mode"
              />
            </div>
            {orgStatus?.role === "owner" && selectedOrgId ? (
              <div className="rounded-xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Current plan</span>
                  <span className="font-semibold text-foreground">
                    {orgStatus.planName}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Monthly allowance</span>
                  <span className="font-semibold text-foreground">
                    {orgStatus.monthlyTokenLimit.toLocaleString()} tokens
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full rounded-2xl"
                  onClick={handleManageBilling}
                >
                  Manage organization billing
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full rounded-2xl"
                  onClick={() => void handleRestorePurchases()}
                  disabled={isRestoringPurchases}
                >
                  {isRestoringPurchases ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Restore purchases
                </Button>
              </div>
            ) : null}
            <div className="overflow-hidden rounded-xl border">
              <button
                type="button"
                className="flex cursor-pointer items-center justify-between border-b px-4 py-3 text-sm transition-colors active:bg-muted/70"
                onClick={() => setLegalDialog("terms")}
              >
                <span>Terms &amp; Conditions</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                type="button"
                className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm transition-colors active:bg-muted/70"
                onClick={() => setLegalDialog("privacy")}
              >
                <span>Privacy Policy</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <div className="flex w-full flex-col gap-2 sm:w-auto">
              {onLogout ? (
                <Button variant="destructive" onClick={() => setConfirmLogoutOpen(true)}>
                  Log Out
                </Button>
              ) : null}
              <DeleteAccountAction
                mode={mode}
                userEmail={email || user?.email || null}
                onDeleted={async () => {
                  onOpenChange(false);
                  await onDeleted();
                }}
                className="sm:mt-2"
              />
            </div>
            <div className="flex gap-2 sm:justify-end">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
               <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Changes'}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLogoutOpen} onOpenChange={setConfirmLogoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
            <DialogDescription>
              You will be signed out of your account and returned to the login screen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmLogoutOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLogoutConfirm}>
              Log Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LegalDocumentDialog
        open={legalDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLegalDialog(null);
          }
        }}
        type={legalDialog ?? "terms"}
      />
    </>
  );
}
