
"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
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

const userFormSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    email: z.string().email("Please enter a valid email address."),
    password: z.string().min(6, "Password must be at least 6 characters."),
    confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

const loginFormSchema = z.object({
    email: z.string().email("Please enter a valid email address."),
    password: z.string().min(1, "Password is required."),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
});


function getEmailRedirectTo() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl && /^https?:\/\//i.test(configuredSiteUrl)) {
    try {
      const parsed = new URL(configuredSiteUrl);
      const isLocalhost =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '0.0.0.0';
      if (!isLocalhost) {
        return `${parsed.origin}/auth/callback`;
      }
    } catch {
      // Fall through to runtime origin below.
    }
  }
  if (typeof window !== 'undefined') {
    const runtimeOrigin = window.location.origin;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(runtimeOrigin)) {
      return `${runtimeOrigin}/auth/callback`;
    }
    return `${runtimeOrigin}/auth/callback`;
  }
  return undefined;
}

function GoogleLogoIcon({ className = "mr-2 h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.39 3.63v2.99h3.87c2.26-2.08 3.54-5.14 3.54-8.86Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.87-2.99c-1.07.72-2.44 1.14-4.08 1.14-3.13 0-5.78-2.11-6.72-4.95H1.29v3.08A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29A7.19 7.19 0 0 1 4.91 12c0-.8.14-1.57.37-2.29V6.63H1.29A12 12 0 0 0 0 12c0 1.94.46 3.78 1.29 5.37l3.99-3.08Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.36.61 4.61 1.8l3.45-3.45A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.29 6.63l3.99 3.08C6.22 6.87 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

function OAuthButtons({ supabase }: { supabase: ReturnType<typeof createSupabaseBrowserClient> }) {
    const [providerLoading, setProviderLoading] = useState<'google' | 'apple' | null>(null);
    const { toast } = useToast();

    const handleOAuth = async (provider: 'google' | 'apple') => {
        setProviderLoading(provider);
        const redirectTo = getEmailRedirectTo();
        const { error } = await supabase.auth.signInWithOAuth({
            provider,
            options: redirectTo ? { redirectTo } : {},
        });
        if (error) {
            toast({ title: "OAuth failed", description: error.message, variant: "destructive" });
            setProviderLoading(null);
        }
    };

    return (
        <div className="space-y-3">
            <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => handleOAuth('google')}
                disabled={providerLoading !== null}
            >
                <GoogleLogoIcon /> Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>or continue with email</span>
                <div className="h-px flex-1 bg-border" />
            </div>
        </div>
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

    const handleSaveUser = async (values: z.infer<typeof userFormSchema>) => {
        const signupResponse = await safeFetchJson<{ ok: boolean; userId?: string; error?: string }>(
          '/api/auth/signup',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: values.name,
              email: values.email,
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
          email: values.email,
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
              email: values.email,
              display_name: values.name,
              avatar_url: `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`,
            });
        }
        const newUser: User = {
            name: values.name,
            email: values.email,
            password: '',
            avatar: `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`
        };
        clearSelectedOrgId();
        clearSelectedGroupId();
        onUserSaved(newUser);
        toast({ title: `Welcome, ${values.name}!` });
    };
    
    return (
        <div className="w-full max-w-md">
            <CardHeader>
                <CardTitle className="text-3xl">Create your Account</CardTitle>
                <CardDescription>Get started with CASPO by creating an account.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                <OAuthButtons supabase={supabase} />
                <form onSubmit={form.handleSubmit(handleSaveUser)} className="space-y-4">
                    <div>
                        <Label htmlFor="name-signup">Full Name</Label>
                        <Input id="name-signup" {...form.register('name')} placeholder="e.g., Alex Johnson" />
                         {form.formState.errors.name && <p className="text-red-500 text-sm mt-1">{form.formState.errors.name.message}</p>}
                    </div>
                    <div>
                       <Label htmlFor="email-signup">Email Address</Label>
                       <Input id="email-signup" {...form.register('email')} placeholder="e.g., alex.j@example.com" />
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
                </div>
            </CardContent>
             <CardFooter className="justify-center">
                <p className="text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <Button variant="link" className="p-0 h-auto" onClick={onSwitchToLogin}>Log In</Button>
                </p>
            </CardFooter>
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
    const forgotPasswordForm = useForm<z.infer<typeof forgotPasswordSchema>>({
        resolver: zodResolver(forgotPasswordSchema),
        defaultValues: { email: "" },
    });
    const [isForgotPassDialogOpen, setIsForgotPassDialogOpen] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const { toast } = useToast();

     const handleLogin = async (values: z.infer<typeof loginFormSchema>) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: values.email,
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
              email: values.email,
              display_name: displayName,
              avatar_url: `https://placehold.co/100x100.png?text=${displayName.charAt(0)}`,
            });
        }
        const user: User = {
            name: displayName,
            email: values.email,
            password: '',
            avatar: `https://placehold.co/100x100.png?text=${displayName.charAt(0)}`
        };
        onLogin(user);
        toast({ title: `Welcome back, ${displayName}!`});
    };
    
    const handleForgotPassword = async (values: z.infer<typeof forgotPasswordSchema>) => {
        setIsSending(true);
        const emailRedirectTo = getEmailRedirectTo();
        const { error } = await supabase.auth.resetPasswordForEmail(
          values.email,
          emailRedirectTo ? { redirectTo: emailRedirectTo } : undefined
        );
        if (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            setIsSending(false);
            return;
        }
        toast({
            title: "Password Recovery",
            description: "Check your email for a reset link.",
        });
        setIsForgotPassDialogOpen(false);
        forgotPasswordForm.reset();
        setIsSending(false);
    }

    return (
        <>
         <div className="w-full max-w-md">
             <CardHeader>
                <CardTitle className="text-3xl">Log In to CASPO</CardTitle>
                <CardDescription>Enter your credentials to access your account.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                <OAuthButtons supabase={supabase} />
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                    <div>
                        <Label htmlFor="email-login">Email</Label>
                        <Input id="email-login" {...loginForm.register('email')} />
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
                </div>
            </CardContent>
            <CardFooter className="justify-center">
                <p className="text-sm text-muted-foreground">
                    Don't have an account?{' '}
                    <Button variant="link" className="p-0 h-auto" onClick={onSwitchToSignUp}>Sign Up</Button>
                </p>
            </CardFooter>
        </div>
        
        <Dialog open={isForgotPassDialogOpen} onOpenChange={setIsForgotPassDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reset Your Password</DialogTitle>
                    <DialogDescription>
                        Enter your email address and we'll help you recover your password.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={forgotPasswordForm.handleSubmit(handleForgotPassword)} className="space-y-4 pt-4">
                    <div>
                        <Label htmlFor="email-forgot">Email Address</Label>
                        <Input id="email-forgot" {...forgotPasswordForm.register('email')} placeholder="e.g., alex.j@example.com" />
                        {forgotPasswordForm.formState.errors.email && <p className="text-red-500 text-sm mt-1">{forgotPasswordForm.formState.errors.email.message}</p>}
                    </div>
                     <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSending}>{isSending ? "Recovering..." : "Recover Password"}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
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
          avatar: `https://placehold.co/100x100.png?text=${displayName.charAt(0)}`,
        });
      }
    };
    initAuth();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        clearUser();
        return;
      }
      const sessionUser = session.user;
      const displayName = getAuthDisplayName(sessionUser);
      setLocalUser({
        name: displayName,
        email: sessionUser.email || '',
        avatar: `https://placehold.co/100x100.png?text=${displayName.charAt(0)}`,
      });
    });
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
        router.replace('/demo');
        return;
      }
      if (user) {
        if (!selectedOrgId) {
          router.replace('/orgs');
          return;
        }

        const { data: authUser } = await supabase.auth.getUser();
        const userId = authUser.user?.id;
        if (!active) return;
        if (!userId) {
          router.replace('/login');
          return;
        }

        const { data: membership } = await supabase
          .from('memberships')
          .select('org_id')
          .eq('org_id', selectedOrgId)
          .eq('user_id', userId)
          .maybeSingle();
        if (!active) return;

        if (membership) {
          router.replace('/clubs');
          return;
        }

        clearSelectedOrgId();
        clearSelectedGroupId();
        setSelectedOrgId(null);
        router.replace('/orgs');
        return;
      }
      if (pathname === '/') {
        router.replace('/login');
      }
    };

    void routeUser();
    return () => {
      active = false;
    };
  }, [isClient, isDemoMode, pathname, router, selectedOrgId, supabase, user, userLoading]);

  
  if (!isClient || userLoading) {
    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center">
            <Logo className="h-16 w-16 animate-pulse text-primary" />
        </div>
    );
  }

  if (isDemoMode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Redirecting to demo...</p>
      </div>
    );
  }

  if (!user) {
    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
             <Card className="w-full max-w-md">
                <CardHeader className="items-center">
                    <div className="flex justify-center items-center gap-4 mb-2">
                        <Logo className="h-10 w-10 text-primary" />
                        <CardTitle className="text-4xl">CASPO</CardTitle>
                    </div>
                </CardHeader>

                <div className="p-6 pt-0">
                   {authMode === 'login' ? (
                        <LoginForm onLogin={saveUser} onSwitchToSignUp={() => setAuthMode('signup')} supabase={supabase} />
                   ) : (
                        <SignUpForm onUserSaved={saveUser} onSwitchToLogin={() => setAuthMode('login')} supabase={supabase} />
                   )}
                </div>
            </Card>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to organizations...</p>
    </div>
  );
}

