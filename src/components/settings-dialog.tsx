
"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useCurrentUser } from "@/lib/data-hooks";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

const profileFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  email: z.string().email("Please enter a valid email address."),
});

const themeColors = [
    { name: 'Default', value: '275 60% 75%'},
    { name: 'Red', value: '0 72% 51%'},
    { name: 'Orange', value: '25 95% 53%'},
    { name: 'Green', value: '142 76% 36%'},
    { name: 'Blue', value: '217 91% 60%'},
    { name: 'Purple', value: '262 84% 59%'},
];

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { user, saveUser } = useCurrentUser();
  const { toast } = useToast();
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof profileFormSchema>>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: user?.name || "",
      email: user?.email || "",
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        name: user.name,
        email: user.email,
      });
      setPreviewAvatar(user.avatar || null);
    }
  }, [user, form]);

  const handleProfileUpdate = (values: z.infer<typeof profileFormSchema>) => {
    saveUser(values);
    toast({ title: "Profile updated successfully!" });
    onOpenChange(false);
  };
  
  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setPreviewAvatar(result);
        saveUser({ avatar: result });
        toast({ title: "Avatar updated!" });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleThemeChange = (color: string) => {
    saveUser({ themeColor: color });
    toast({ title: "Theme updated!" });
  };
  
  const getAvatarFallback = (name?: string | null) => name ? name.charAt(0).toUpperCase() : 'U';

  const avatarBgColor = (user?.themeColor && !user?.avatar) ? `hsl(${user.themeColor.split(' ')[0]}, 60%, 80%)` : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your account and application settings.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="profile">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="py-4">
            <form onSubmit={form.handleSubmit(handleProfileUpdate)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...form.register("name")} />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" {...form.register("email")} />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <DialogFooter>
                <Button type="submit">Save Changes</Button>
              </DialogFooter>
            </form>
          </TabsContent>
          <TabsContent value="appearance" className="py-4">
            <div className="space-y-6">
                <div className="space-y-2">
                    <Label>Profile Picture</Label>
                    <div className="flex items-center gap-4">
                        <Avatar className="h-20 w-20">
                            <AvatarImage src={previewAvatar || user?.avatar} alt="User Avatar" />
                            <AvatarFallback className="text-3xl" style={{ backgroundColor: avatarBgColor }}>
                                {getAvatarFallback(user?.name)}
                            </AvatarFallback>
                        </Avatar>
                        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                            Upload Image
                        </Button>
                        <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label>Theme Color</Label>
                     <p className="text-sm text-muted-foreground">This also sets your default avatar color if no image is uploaded.</p>
                    <div className="flex flex-wrap gap-2">
                        {themeColors.map(color => (
                            <button
                                key={color.name}
                                onClick={() => handleThemeChange(color.value)}
                                className={cn(
                                    "h-10 w-10 rounded-full border-2 transition-all",
                                    user?.themeColor === color.value ? 'border-ring' : 'border-transparent'
                                )}
                                style={{ backgroundColor: `hsl(${color.value})`}}
                                aria-label={`Select ${color.name} theme`}
                            />
                        ))}
                    </div>
                </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
