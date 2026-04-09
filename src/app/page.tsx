
"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/icons';
import { usePathname, useRouter } from 'next/navigation';
import { User } from '@/lib/mock-data';
import { useCurrentUser } from '@/lib/data-hooks';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeFetchJson } from '@/lib/network';
import { clearSelectedGroupId, clearSelectedOrgId } from '@/lib/selection';
import { LegalDocumentDialog } from '@/components/legal-document-dialog';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { normalizeAuthEmail, SIGNUP_PASSWORD_MIN_LENGTH } from '@/lib/auth-signup';

const userFormSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    email: z.string().email("Please enter a valid email address."),
    password: z.string().min(
      SIGNUP_PASSWORD_MIN_LENGTH,
      `Password must be at least ${SIGNUP_PASSWORD_MIN_LENGTH} characters.`
    ),
    confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

const loginFormSchema = z.object({
    email: z.string().email("Please enter a valid email address."),
    password: z.string().min(1, "Password is required."),
});

function LegalNotice({
  onOpenTerms,
  onOpenPrivacy,
}: {
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}) {
    return (
        <p className="mt-2 text-center text-xs leading-5 text-gray-500">
            By continuing, you agree to our{" "}
            <button type="button" onClick={onOpenTerms} className="font-medium text-foreground underline underline-offset-2">
                Terms &amp; Conditions
            </button>{" "}
            and{" "}
            <button type="button" onClick={onOpenPrivacy} className="font-medium text-foreground underline underline-offset-2">
                Privacy Policy
            </button>
            .
        </p>
    );
}

function getAuthDisplayName(
  user?: { user_metadata?: Record<string, unknown> | null; email?: string | null }
) {
  const meta = user?.user_metadata || {};
  const fromMeta =
    (meta['full_name'] as string | undefined) ||
    (meta['name'] as string | undefined) ||
    (meta['display_name'] as string | undefined);
  return fromMeta || user?.email || 'Member';
}

const normalizeEmailForStorage = (value: string) => value.trim().toLowerCase();

function SignUpForm({
  onUserSaved,
  onSwitchToLogin,
  supabase,
}: {
  onUserSaved: (user: User) => void;
  onSwitchToLogin: () => void;
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
}) {
    const form = useForm<z.infer<typeof userFormSchema>>({
        resolver: zodResolver(userFormSchema),
        defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    });
    const { toast } = useToast();
    const [legalDialog, setLegalDialog] = useState<'terms' | 'privacy' | null>(null);

    const handleSaveUser = async (values: z.infer<typeof userFormSchema>) => {
        const trimmedName = values.name.trim();
        const normalizedEmail = normalizeAuthEmail(values.email);
        const signupResponse = await safeFetchJson<{ ok: boolean; userId?: string; error?: string }>(
          '/api/auth/signup',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: trimmedName,
              email: normalizedEmail,
              password: values.password,
            }),
          }
        );
        if (!signupResponse.ok || !signupResponse.data?.ok) {
          const message =
            !signupResponse.ok
              ? signupResponse.error.message
              : signupResponse.data?.error || 'Signup failed.';
          toast({ title: "Signup failed", description: message, variant: "destructive" });
          return;
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: values.password,
        });
        if (error) {
          toast({ title: "Login failed", description: error.message, variant: "destructive" });
          onSwitchToLogin();
          return;
        }
        if (data.user) {
          await supabase
            .from('profiles')
            .upsert({
              id: data.user.id,
              email: normalizeEmailForStorage(normalizedEmail),
              display_name: trimmedName,
              avatar_url: getPlaceholderImageUrl({ label: trimmedName.charAt(0) || 'M' }),
            });
        }
        const newUser: User = {
            name: trimmedName,
            email: normalizedEmail,
            password: '',
            avatar: getPlaceholderImageUrl({ label: trimmedName.charAt(0) || 'M' })
        };
        clearSelectedOrgId();
        clearSelectedGroupId();
        onUserSaved(newUser);
        toast({ title: `Welcome, ${trimmedName}!` });
    };
    
    return (
        <div className="w-full">
            <CardHeader className="px-0 pt-0 pb-3">
                <CardTitle className="text-[1.65rem]">Sign Up</CardTitle>
                <CardDescription>Get started with CASPO by creating an account.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
                <div className="space-y-3.5">
                <form onSubmit={form.handleSubmit(handleSaveUser)} className="space-y-3.5">
                    <div>
                        <Label htmlFor="name-signup">Full Name</Label>
                        <Input id="name-signup" {...form.register('name')} placeholder="e.g., Alex Johnson" />
                         {form.formState.errors.name && <p className="text-red-500 text-sm mt-1">{form.formState.errors.name.message}</p>}
                    </div>
                    <div>
                       <Label htmlFor="email-signup">Email Address</Label>
                       <Input
                         id="email-signup"
                         {...form.register('email')}
                         placeholder="e.g., alex.j@example.com"
                         autoCapitalize="none"
                         autoCorrect="off"
                         spellCheck={false}
                       />
                        {form.formState.errors.email && <p className="text-red-500 text-sm mt-1">{form.formState.errors.email.message}</p>}
                    </div>
                    <div>
                       <Label htmlFor="password-signup">Password</Label>
                       <Input id="password-signup" type="password" {...form.register('password')} />
                        {form.formState.errors.password && <p className="text-red-500 text-sm mt-1">{form.formState.errors.password.message}</p>}
                    </div>
                     <div>
                       <Label htmlFor="confirmPassword-signup">Confirm Password</Label>
                       <Input id="confirmPassword-signup" type="password" {...form.register('confirmPassword')} />
                        {form.formState.errors.confirmPassword && <p className="text-red-500 text-sm mt-1">{form.formState.errors.confirmPassword.message}</p>}
                    </div>
                    <Button type="submit" className="w-full">Create Account</Button>
                </form>
                <LegalNotice onOpenTerms={() => setLegalDialog('terms')} onOpenPrivacy={() => setLegalDialog('privacy')} />
                </div>
            </CardContent>
             <CardFooter className="justify-center px-0 pt-4 pb-0">
                <p className="text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <Button variant="link" className="p-0 h-auto" onClick={onSwitchToLogin}>Log In</Button>
                </p>
            </CardFooter>
            <LegalDocumentDialog
              open={legalDialog !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setLegalDialog(null);
                }
              }}
              type={legalDialog ?? 'terms'}
            />
        </div>
    );
}

function LoginForm({
  onLogin,
  onSwitchToSignUp,
  supabase,
}: {
  onLogin: (user: User) => void;
  onSwitchToSignUp: () => void;
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
}) {
    const loginForm = useForm<z.infer<typeof loginFormSchema>>({
        resolver: zodResolver(loginFormSchema),
        defaultValues: { email: '', password: '' },
    });
    const [isForgotPassDialogOpen, setIsForgotPassDialogOpen] = useState(false);
    const [legalDialog, setLegalDialog] = useState<'terms' | 'privacy' | null>(null);
    const { toast } = useToast();

     const handleLogin = async (values: z.infer<typeof loginFormSchema>) => {
        const normalizedEmail = normalizeAuthEmail(values.email);
        const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password: values.password,
        });
        if (error) {
            toast({ title: "Login failed", description: error.message, variant: "destructive" });
            return;
        }
        const displayName = getAuthDisplayName(data.user);
        if (data.user) {
          await supabase
            .from('profiles')
            .upsert({
              id: data.user.id,
              email: normalizeEmailForStorage(normalizedEmail),
              display_name: displayName,
              avatar_url: getPlaceholderImageUrl({ label: displayName.charAt(0) }),
            });
        }
        const user: User = {
            name: displayName,
            email: normalizedEmail,
            password: '',
            avatar: getPlaceholderImageUrl({ label: displayName.charAt(0) })
        };
        onLogin(user);
        toast({ title: `Welcome back, ${displayName}!`});
    };
    
    return (
        <>
         <div className="w-full">
             <CardHeader className="px-0 pt-0 pb-3">
                <CardTitle className="text-[1.65rem]">Log In</CardTitle>
                <CardDescription>Enter your credentials to access your account.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
                <div className="space-y-3.5">
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-3.5">
                    <div>
                        <Label htmlFor="email-login">Email</Label>
                        <Input
                          id="email-login"
                          {...loginForm.register('email')}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        {loginForm.formState.errors.email && <p className="text-red-500 text-sm mt-1">{loginForm.formState.errors.email.message}</p>}
                    </div>
                    <div>
                        <div className="flex justify-between items-center">
                            <Label htmlFor="password-login">Password</Label>
                            <Button type="button" variant="link" className="p-0 h-auto text-xs" onClick={() => setIsForgotPassDialogOpen(true)}>
                                Forgot Password?
                            </Button>
                        </div>
                        <Input id="password-login" type="password" {...loginForm.register('password')} />
                        {loginForm.formState.errors.password && <p className="text-red-500 text-sm mt-1">{loginForm.formState.errors.password.message}</p>}
                    </div>
                    <Button type="submit" className="w-full">Log In</Button>
                </form>
                <LegalNotice onOpenTerms={() => setLegalDialog('terms')} onOpenPrivacy={() => setLegalDialog('privacy')} />
                </div>
            </CardContent>
            <CardFooter className="justify-center px-0 pt-4 pb-0">
                <p className="text-sm text-muted-foreground">
                    Don't have an account?{' '}
                    <Button variant="link" className="p-0 h-auto" onClick={onSwitchToSignUp}>Sign Up</Button>
                </p>
            </CardFooter>
        </div>
        
        <Dialog open={isForgotPassDialogOpen} onOpenChange={setIsForgotPassDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Password Recovery</DialogTitle>
                    <DialogDescription>
                        Password recovery is not available yet. Contact support at clubhubai@gmail.com.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="pt-4">
                    <DialogClose asChild><Button type="button">Close</Button></DialogClose>
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
          type={legalDialog ?? 'terms'}
        />
        </>
    );
}

export default function HomePage() {
  const { user, loading: userLoading, saveUser, clearUser, setLocalUser } = useCurrentUser();
  const [isClient, setIsClient] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const didLogNavigationRef = useRef(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  const navigateWithFallback = (targetPath: string) => {
    router.replace(targetPath);
    if (typeof window === 'undefined') return;
    window.setTimeout(() => {
      if (window.location.pathname !== targetPath) {
        window.location.replace(targetPath);
      }
    }, 1200);
  };

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    setSelectedOrgId(localStorage.getItem('selectedOrgId'));
  }, [isClient]);

  useEffect(() => {
    const initAuth = async () => {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user;
      if (sessionUser) {
        const displayName = getAuthDisplayName(sessionUser);
        setLocalUser({
          name: displayName,
          email: sessionUser.email || '',
          avatar: getPlaceholderImageUrl({ label: displayName.charAt(0) }),
        });
      }
    };
    initAuth();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
      if (!session) {
        clearUser();
        return;
      }
      const sessionUser = session.user;
      const displayName = getAuthDisplayName(sessionUser);
      setLocalUser({
        name: displayName,
        email: sessionUser.email || '',
        avatar: getPlaceholderImageUrl({ label: displayName.charAt(0) }),
      });
      }
    );
    return () => {
      listener.subscription.unsubscribe();
    };
  }, [clearUser, setLocalUser, supabase]);

  useEffect(() => {
    if (!isClient || userLoading || didLogNavigationRef.current) return;
    didLogNavigationRef.current = true;
  }, [isClient, pathname, selectedOrgId, user, userLoading]);

  useEffect(() => {
    if (!isClient || userLoading) return;
    let active = true;

    const routeUser = async () => {
      if (isDemoMode) {
        navigateWithFallback('/demo');
        return;
      }
      if (user) {
        if (!selectedOrgId) {
          navigateWithFallback('/orgs');
          return;
        }

        const statusResult = await safeFetchJson<{ ok: true; data: { orgId: string } }>(
          `/api/orgs/${selectedOrgId}/status`,
          { method: 'GET' }
        );
        if (!active) return;

        if (statusResult.ok) {
          navigateWithFallback('/clubs');
          return;
        }

        clearSelectedOrgId();
        clearSelectedGroupId();
        setSelectedOrgId(null);
        navigateWithFallback('/orgs');
        return;
      }
      if (pathname === '/') {
        navigateWithFallback('/login');
      }
    };

    void routeUser();
    return () => {
      active = false;
    };
  }, [isClient, isDemoMode, pathname, router, selectedOrgId, supabase, user, userLoading]);

  
  if (!isClient || userLoading) {
    return (
        <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center">
            <Logo className="h-16 w-16 animate-pulse text-primary" />
        </div>
    );
  }

  if (isDemoMode) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Redirecting to demo...</p>
      </div>
    );
  }

  if (!user) {
    return (
        <div className="viewport-page bg-background">
             <div className="viewport-scroll flex h-full flex-col items-center justify-center px-4 pb-4 pt-4 sm:pt-8">
             <Card className="auth-card-shell w-full max-w-md">
                <CardHeader className="items-center px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
                    <div className="mb-0 flex items-center justify-center gap-4">
                        <Logo className="h-10 w-10 text-primary" />
                        <CardTitle className="text-[2.25rem]">CASPO</CardTitle>
                    </div>
                </CardHeader>

                <div className="px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
                   {authMode === 'login' ? (
                        <LoginForm onLogin={saveUser} onSwitchToSignUp={() => setAuthMode('signup')} supabase={supabase} />
                   ) : (
                        <SignUpForm onUserSaved={saveUser} onSwitchToLogin={() => setAuthMode('login')} supabase={supabase} />
                   )}
                </div>
            </Card>
            </div>
        </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to organizations...</p>
    </div>
  );
}

