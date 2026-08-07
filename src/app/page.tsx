
"use client";

import { useCallback, useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  ClipboardCheck,
  GraduationCap,
  Quote,
  Sparkles,
  Users,
} from 'lucide-react';
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
import { useCurrentUser } from '@/lib/current-user';
import { writeLocalViewCache } from '@/lib/local-view-cache';
import { ORGS_CACHE_KEY } from '@/lib/org-list-cache';
import { safeFetchJson } from '@/lib/network';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { clearSelectedGroupId, clearSelectedOrgId } from '@/lib/selection';
import { LegalDocumentDialog } from '@/components/legal-document-dialog';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { normalizeAuthEmail, SIGNUP_PASSWORD_MIN_LENGTH } from '@/lib/auth-signup';
import {
  getAuthMetadataDisplayName,
  resolveStoredDisplayName,
} from '@/lib/user-display-name';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

const AUTH_PRIME_REQUEST_TIMEOUT_MS = 8_000;
const AUTH_PRIME_REQUEST_RETRY = { retries: 1, baseDelayMs: 500, maxDelayMs: 1_500 };
const groupsCacheKey = (orgId: string) => `view-cache:groups:${orgId}:discoverable-v1`;
const missionHighlights = [
  {
    title: 'Run the whole club in one place',
    description: 'Announcements, events, attendance, points, forms, finances, and member communication live together instead of across scattered tools.',
    icon: ClipboardCheck,
  },
  {
    title: 'Give student leaders their time back',
    description: 'CASPO helps officers move faster on routine work so they can spend more time building community and less time chasing updates.',
    icon: Sparkles,
  },
  {
    title: 'Make participation easier to see',
    description: 'Members get clearer updates, advisors get better visibility, and organizations can understand what is happening across every group.',
    icon: Users,
  },
];
type TeamMember = {
  name: string;
  role: string;
  note: string;
  photoSrc?: string;
};

type Advisor = {
  name: string;
  role: string;
  photoSrc?: string;
};

const teamMembers: TeamMember[] = [
  {
    name: 'Pratheek Mukkavilli',
    role: 'Founder & CEO',
    note: 'Building CASPO to make club leadership simpler, more organized, and more accessible for every student group.',
    photoSrc: '/team/pratheek.jpg',
  },
  {
    name: 'Soham',
    role: 'CFO',
    note: 'Leading the financial direction behind CASPO’s growth, planning, and long-term sustainability.',
    photoSrc: '/team/soham.jpg',
  },
];
const partner = {
  name: 'Xrathus DXP',
  logoSrc: '/partners/xrathus-dxp.jpg',
};

const advisoryBoard: Advisor[] = [
  {
    name: 'Brielle Sutton',
    role: 'Founder and Principal, Ferana Advisory',
    photoSrc: '/advisory/brielle-sutton.jpg',
  },
  {
    name: 'Rheka Patel',
    role: 'Founder and CEO, Xrathus',
    photoSrc: '/advisory/rheka-patel.jpg',
  },
  {
    name: 'Ganesh Harke',
    role: 'Vice President, Citi',
    photoSrc: '/advisory/ganesh-harke.jpg',
  },
  {
    name: 'Tejus Mane',
    role: 'Founder, AtmoSpark',
    photoSrc: '/advisory/tejus-mane.jpg',
  },
];
const homeTabs = [
  { value: 'mission', label: 'Our Mission' },
  { value: 'team', label: 'Our Team' },
  { value: 'advisory', label: 'Advisory Board' },
  { value: 'endorsements', label: 'Endorsements' },
] as const;

function HomeTabsList({ className }: Readonly<{ className: string }>) {
  return (
    <TabsList className={className}>
      {homeTabs.map(tab => (
        <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 rounded-lg px-4 py-2">
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

function ProfileImage({
  name,
  src,
  className,
}: Readonly<{
  name: string;
  src?: string;
  className: string;
}>) {
  const [imageFailed, setImageFailed] = useState(false);

  if (src && !imageFailed) {
    return (
      <Image
        src={src}
        alt={`${name} headshot`}
        width={640}
        height={800}
        className={className}
        loading="eager"
        sizes="(min-width: 1024px) 25vw, (min-width: 768px) 50vw, 100vw"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className={`${className} flex items-center justify-center bg-emerald-100 text-4xl font-bold text-emerald-800`}>
      {name.charAt(0)}
    </div>
  );
}

function TeamMemberAvatar({ member }: Readonly<{ member: TeamMember }>) {
  return (
    <ProfileImage
      name={member.name}
      src={member.photoSrc}
      className="mx-auto mb-4 aspect-[4/5] w-full max-w-xs rounded-2xl object-cover object-center"
    />
  );
}

function AdvisorPhoto({ advisor }: Readonly<{ advisor: Advisor }>) {
  return (
    <ProfileImage
      name={advisor.name}
      src={advisor.photoSrc}
      className="mb-5 aspect-square w-full rounded-2xl object-cover object-center"
    />
  );
}

function PartnerLogo() {
  const [imageFailed, setImageFailed] = useState(false);

  if (!imageFailed) {
    return (
      <div className="flex min-h-24 w-full max-w-sm items-center justify-center rounded-2xl border border-slate-200 bg-white p-5">
        <Image
          src={partner.logoSrc}
          alt={`${partner.name} logo`}
          width={520}
          height={160}
          className="max-h-20 w-full object-contain"
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-24 w-full max-w-sm items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 text-3xl font-bold text-purple-800">
      {partner.name}
    </div>
  );
}

function LegalNotice({
  onOpenTerms,
  onOpenPrivacy,
}: Readonly<{
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}>) {
    return (
        <p className="mt-2 text-center text-xs leading-5 text-gray-500">
            By continuing, you agree to our{" "}
	            <button type="button" onClick={onOpenTerms} className="font-medium text-foreground underline underline-offset-2">
	                Terms &amp; Conditions
	            </button>
	            <span> and </span>
	            <button type="button" onClick={onOpenPrivacy} className="font-medium text-foreground underline underline-offset-2">
	                Privacy Policy
	            </button>
	            <span>.</span>
	        </p>
    );
}
function buildBrowserProfileUser(
  authUser?: { id?: string; email?: string | null; user_metadata?: Record<string, unknown> | null },
  preferredName?: string | null,
) {
  if (!authUser?.email) {
    return null;
  }

  const normalizedEmail = normalizeAuthEmail(authUser.email);
  const displayName = resolveStoredDisplayName({
    preferredName,
    authDisplayName: getAuthMetadataDisplayName(authUser),
    email: normalizedEmail,
  });
  return {
    name: displayName,
    email: normalizedEmail,
    avatar: getPlaceholderImageUrl({ label: displayName.charAt(0) || 'M' }),
  };
}

function SignUpForm({
  onUserSaved,
  onSwitchToLogin,
}: Readonly<{
  onUserSaved: (user: User) => void | Promise<void>;
  onSwitchToLogin: () => void;
}>) {
    const form = useForm<z.infer<typeof userFormSchema>>({
        resolver: zodResolver(userFormSchema),
        defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    });
    const { toast } = useToast();
    const [legalDialog, setLegalDialog] = useState<'terms' | 'privacy' | null>(null);

    const handleSaveUser = async (values: z.infer<typeof userFormSchema>) => {
        let supabase: ReturnType<typeof createSupabaseBrowserClient>;
        try {
          supabase = createSupabaseBrowserClient();
        } catch (error) {
          toast({
            title: "Signup unavailable",
            description: error instanceof Error ? error.message : "Supabase is not configured.",
            variant: "destructive",
          });
          return;
        }
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
        const newUser =
          buildBrowserProfileUser(data.user, trimmedName) ?? {
            name: trimmedName,
            email: normalizedEmail,
            password: '',
            avatar: getPlaceholderImageUrl({ label: trimmedName.charAt(0) || 'M' }),
          };
        clearSelectedOrgId();
        clearSelectedGroupId();
        await onUserSaved(newUser);
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
}: Readonly<{
  onLogin: (user: User) => void | Promise<void>;
  onSwitchToSignUp: () => void;
}>) {
    const loginForm = useForm<z.infer<typeof loginFormSchema>>({
        resolver: zodResolver(loginFormSchema),
        defaultValues: { email: '', password: '' },
    });
    const [isForgotPassDialogOpen, setIsForgotPassDialogOpen] = useState(false);
    const [legalDialog, setLegalDialog] = useState<'terms' | 'privacy' | null>(null);
    const { toast } = useToast();

     const handleLogin = async (values: z.infer<typeof loginFormSchema>) => {
        let supabase: ReturnType<typeof createSupabaseBrowserClient>;
        try {
          supabase = createSupabaseBrowserClient();
        } catch (error) {
          toast({
            title: "Login unavailable",
            description: error instanceof Error ? error.message : "Supabase is not configured.",
            variant: "destructive",
          });
          return;
        }
        const normalizedEmail = normalizeAuthEmail(values.email);
        const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password: values.password,
        });
        if (error) {
            toast({ title: "Login failed", description: error.message, variant: "destructive" });
            return;
        }
        const user =
          buildBrowserProfileUser(data.user) ?? {
            name: getAuthMetadataDisplayName(data.user) || 'Member',
            email: normalizedEmail,
            password: '',
            avatar: getPlaceholderImageUrl({ label: (getAuthMetadataDisplayName(data.user) || 'M').charAt(0) }),
          };
        await onLogin(user);
        toast({ title: `Welcome back, ${user.name}!`});
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

function AuthEntry({
  onAuthenticatedUser,
}: Readonly<{
  onAuthenticatedUser: (user: User) => void | Promise<void>;
}>) {
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  return (
    <div className="viewport-page bg-background">
      <div className="viewport-scroll flex h-full flex-col items-center justify-center px-4 pb-4 pt-4 sm:pt-8">
        <Card className="auth-card-shell w-full max-w-md">
          <CardHeader className="items-center px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
            <div className="mb-0 flex items-center justify-center gap-4">
              <Logo className="h-10 w-10 text-primary" />
              <div className="flex items-baseline gap-2">
                <CardTitle className="text-[2.25rem]">CASPO</CardTitle>
                <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">beta</span>
              </div>
            </div>
          </CardHeader>

          <div className="px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
            {authMode === 'login' ? (
              <LoginForm
                onLogin={onAuthenticatedUser}
                onSwitchToSignUp={() => setAuthMode('signup')}
              />
            ) : (
              <SignUpForm
                onUserSaved={onAuthenticatedUser}
                onSwitchToLogin={() => setAuthMode('login')}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function PublicHomePage() {
  return (
    <Tabs defaultValue="mission" className="viewport-page bg-[#f7faf8] text-slate-950">
      <div className="viewport-scroll">
        <header className="sticky top-0 z-20 border-b border-emerald-900/10 bg-[#f7faf8]/92 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-4">
              <Link href="/" className="flex items-center gap-3" aria-label="CASPO homepage">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                  <Logo className="h-6 w-6" />
                </span>
                <span className="text-xl font-bold">CASPO</span>
              </Link>
              <HomeTabsList className="hidden h-auto justify-start overflow-x-auto rounded-xl bg-white p-1 shadow-sm lg:flex" />
              <Button asChild className="rounded-xl bg-slate-950 text-white hover:bg-slate-800">
                <Link href="/login">
                  Log in
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <HomeTabsList className="flex h-auto w-full justify-start overflow-x-auto rounded-xl bg-white p-1 shadow-sm lg:hidden" />
          </div>
        </header>

        <main>
          <TabsContent value="mission" className="m-0">
            <section className="border-b border-emerald-900/10 bg-white">
              <div className="mx-auto grid min-h-[calc(88dvh-104px)] w-full max-w-7xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1.02fr_0.98fr] lg:px-8 lg:py-16">
                <div className="flex flex-col justify-center">
                  <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                    <GraduationCap className="h-4 w-4" />
                    Built for clubs, chapters, teams, and student organizations
                  </p>
                  <h1 className="max-w-3xl text-5xl font-bold leading-[1.02] sm:text-6xl lg:text-7xl">
                    CASPO helps student organizations run with less chaos.
                  </h1>
                  <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                    CASPO brings the everyday work of club leadership into one place: communication,
                    events, attendance, points, forms, finances, and AI-assisted workflows that help
                    officers move faster without losing the human part of community.
                  </p>
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <Button asChild size="lg" className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">
                      <Link href="/login">
                        Log in to CASPO
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="lg" className="rounded-xl border-slate-300 bg-white">
                      <a href="#mission-details">Explore the mission</a>
                    </Button>
                  </div>
                </div>

                <div className="flex items-center">
                  <div className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-2xl">
                    <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
                      <span className="h-3 w-3 rounded-full bg-red-400" />
                      <span className="h-3 w-3 rounded-full bg-amber-300" />
                      <span className="h-3 w-3 rounded-full bg-emerald-400" />
                      <span className="ml-3 text-sm text-slate-400">caspo.club</span>
                    </div>
                    <div className="grid gap-4 p-5 sm:p-6">
                      <div className="rounded-2xl bg-white p-5 text-slate-950">
                        <div className="mb-4 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-emerald-700">Command center</p>
                            <p className="text-2xl font-bold">Robotics Club</p>
                          </div>
                          <div className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
                            Active
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          {['3 events', '128 members', '94% read'].map(metric => (
                            <div key={metric} className="rounded-xl bg-slate-100 px-3 py-4 text-center font-semibold">
                              {metric}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-2xl bg-emerald-400 p-5 text-emerald-950">
                          <p className="text-sm font-semibold">Next meeting</p>
                          <p className="mt-2 text-2xl font-bold">Friday, 3:30 PM</p>
                        </div>
                        <div className="rounded-2xl bg-white/10 p-5 text-white">
                          <p className="text-sm font-semibold text-emerald-200">AI draft ready</p>
                          <p className="mt-2 text-lg font-bold">Announcement + RSVP reminder</p>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-white">
                        <div className="mb-3 h-2 w-24 rounded-full bg-emerald-300" />
                        <div className="space-y-2">
                          <div className="h-3 rounded-full bg-white/25" />
                          <div className="h-3 w-10/12 rounded-full bg-white/20" />
                          <div className="h-3 w-7/12 rounded-full bg-white/15" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section id="mission-details" className="bg-[#f7faf8] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
              <div className="mx-auto w-full max-w-7xl">
                <div className="mb-8">
                  <div>
                    <p className="text-sm font-semibold uppercase text-emerald-700">About CASPO</p>
                    <h2 className="mt-2 text-3xl font-bold sm:text-4xl">Our Mission</h2>
                  </div>
                </div>

                <div className="grid items-start gap-6 lg:grid-cols-[1fr_0.82fr]">
                  <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
                    <h3 className="text-2xl font-bold">A better operating system for student organizations</h3>
                    <p className="mt-4 text-lg leading-8 text-slate-600">
                      CASPO exists to help student leaders spend less time managing scattered
                      logistics and more time creating belonging. We are building a modern operating
                      system for organizations: clear communication, smarter planning, cleaner records,
                      and AI assistance that helps every officer lead with confidence.
                    </p>
                    <div className="mt-8 grid gap-4">
                      {missionHighlights.map(highlight => {
                        const Icon = highlight.icon;
                        return (
                          <div key={highlight.title} className="flex gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <h4 className="font-bold">{highlight.title}</h4>
                              <p className="mt-1 leading-7 text-slate-600">{highlight.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="self-start rounded-3xl bg-slate-950 p-6 text-white shadow-sm sm:p-8">
                    <p className="text-sm font-semibold uppercase text-emerald-300">Promo video</p>
                    <div className="mt-5 overflow-hidden rounded-2xl border border-white/15 bg-black">
                      <iframe
                        className="aspect-video w-full"
                        src="https://www.youtube-nocookie.com/embed/QVFi8ZTWqvE?rel=0&modestbranding=1"
                        title="Caspo AI"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                      />
                    </div>
                    <a
                      href="https://youtu.be/QVFi8ZTWqvE"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex text-sm font-semibold text-emerald-300 underline underline-offset-4"
                    >
                      Watch Caspo AI on YouTube
                    </a>
                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm leading-6 text-slate-300">
                        CASPO is for the people who keep organizations alive: the officers sending
                        reminders, advisors keeping an eye on progress, and members trying to stay in
                        the loop.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="team" className="m-0">
            <section className="bg-[#f7faf8] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
              <div className="mx-auto w-full max-w-7xl">
                <p className="text-sm font-semibold uppercase text-emerald-700">Our Team</p>
                <h1 className="mt-2 max-w-3xl text-4xl font-bold sm:text-5xl">The people building CASPO</h1>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
                  CASPO is being built by student leaders who know how much work it takes to keep
                  organizations moving.
                </p>
                <div className="mt-8 grid gap-5 md:grid-cols-2">
                  {teamMembers.map(member => (
                    <Card key={member.name} className="rounded-2xl border-slate-200 bg-white shadow-sm">
                      <CardHeader>
                        <TeamMemberAvatar member={member} />
                        <CardTitle>{member.name}</CardTitle>
                        <CardDescription className="text-base font-semibold text-emerald-700">
                          {member.role}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="leading-7 text-slate-600">{member.note}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="mt-8 rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm sm:p-8">
                  <p className="text-sm font-semibold uppercase text-emerald-700">Official Partner</p>
                  <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-2xl">
                      <h2 className="text-2xl font-bold sm:text-3xl">
                        Officially partnered with {partner.name}
                      </h2>
                      <p className="mt-3 leading-7 text-slate-600">
                        CASPO is officially partnered with Xrathus DXP as we build a stronger,
                        smarter operating system for student organizations.
                      </p>
                    </div>
                    <PartnerLogo />
                  </div>
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="advisory" className="m-0">
            <section className="bg-[#f7faf8] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
              <div className="mx-auto w-full max-w-7xl">
                <div className="max-w-3xl">
                  <p className="text-sm font-semibold uppercase text-emerald-700">Advisory Board</p>
                  <h1 className="mt-2 text-4xl font-bold sm:text-5xl">
                    Advisors helping shape CASPO
                  </h1>
                  <p className="mt-4 text-lg leading-8 text-slate-600">
                    CASPO is supported by experienced operators, founders, and leaders who help guide
                    the product, partnerships, and long-term direction.
                  </p>
                </div>
                <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {advisoryBoard.map(advisor => (
                    <Card
                      key={advisor.name}
                      className={`rounded-2xl border-slate-200 bg-white shadow-sm ${advisor.name === 'Tejus Mane' ? 'lg:col-start-2' : ''}`}
                    >
                      <CardHeader>
                        <AdvisorPhoto advisor={advisor} />
                        <CardTitle className="text-xl">{advisor.name}</CardTitle>
                        <CardDescription className="text-base font-semibold text-emerald-700">
                          {advisor.role}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="endorsements" className="m-0">
            <section className="bg-[#f7faf8] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
              <div className="mx-auto w-full max-w-7xl">
                <div className="rounded-3xl bg-white p-8 shadow-sm">
                  <Quote className="h-10 w-10 text-emerald-600" />
                  <h1 className="mt-5 text-3xl font-bold sm:text-4xl">Endorsements</h1>
                  <p className="mt-3 max-w-2xl leading-7 text-slate-600">
                    We will add endorsements, quotes, and partner notes here once you provide them.
                  </p>
                </div>
              </div>
            </section>
          </TabsContent>
        </main>
      </div>
    </Tabs>
  );
}

export default function HomePage() {
  const { user, loading: userLoading, setLocalUser } = useCurrentUser();
  const [isClient, setIsClient] = useState(false);
  const [nativePlatformChecked, setNativePlatformChecked] = useState(false);
  const [isNativeApp, setIsNativeApp] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const didLogNavigationRef = useRef(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const isLoginRoute = pathname === '/login';

  const getSafeNextPath = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const next = new URLSearchParams(window.location.search).get('next');
    if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
    if (next === '/login' || next.startsWith('/login?')) return null;
    return next;
  }, []);

  const navigateWithFallback = useCallback((targetPath: string) => {
    router.replace(targetPath);
    if (typeof window === 'undefined') return;
    window.setTimeout(() => {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      if (currentPath !== targetPath) {
        window.location.replace(targetPath);
      }
    }, 1200);
  }, [router]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    setIsNativeApp(Capacitor.isNativePlatform());
    setNativePlatformChecked(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    setSelectedOrgId(localStorage.getItem('selectedOrgId'));
  }, [isClient]);

  useEffect(() => {
    if (!isClient || userLoading || didLogNavigationRef.current) return;
    didLogNavigationRef.current = true;
  }, [isClient, pathname, selectedOrgId, user, userLoading]);

  useEffect(() => {
    if (!isClient || userLoading) return;

    const routeUser = async () => {
      if (isDemoMode) {
        navigateWithFallback('/demo');
        return;
      }
      if (user) {
        navigateWithFallback(getSafeNextPath() ?? (selectedOrgId ? '/clubs' : '/orgs'));
      }
    };

    void routeUser();
  }, [getSafeNextPath, isClient, isDemoMode, navigateWithFallback, pathname, selectedOrgId, user, userLoading]);

  const handleAuthenticatedUser = async (nextUser: User) => {
    setLocalUser(nextUser);
    const nextSelectedOrgId = typeof window === 'undefined' ? null : localStorage.getItem('selectedOrgId');
    const targetPath = getSafeNextPath() ?? (nextSelectedOrgId ? '/clubs' : '/orgs');
    setSelectedOrgId(nextSelectedOrgId);
    router.prefetch(targetPath);

    if (nextSelectedOrgId) {
      void safeFetchJson<{ ok: boolean; data?: { groups: Array<Record<string, unknown>> } }>(
        `/api/groups?orgId=${encodeURIComponent(nextSelectedOrgId)}`,
        {
          method: 'GET',
          timeoutMs: AUTH_PRIME_REQUEST_TIMEOUT_MS,
          retry: AUTH_PRIME_REQUEST_RETRY,
        }
      ).then(result => {
        if (result.ok) {
          writeLocalViewCache(groupsCacheKey(nextSelectedOrgId), result.data?.data?.groups ?? []);
        }
      });
    } else {
      void safeFetchJson<{ ok: boolean; data?: Array<Record<string, unknown>> }>('/api/orgs', {
        method: 'GET',
        timeoutMs: AUTH_PRIME_REQUEST_TIMEOUT_MS,
        retry: AUTH_PRIME_REQUEST_RETRY,
      }).then(result => {
        if (result.ok) {
          writeLocalViewCache(ORGS_CACHE_KEY, result.data?.data ?? []);
        }
      });
    }

    navigateWithFallback(targetPath);
  };

  
  if (isDemoMode) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Redirecting to demo...</p>
      </div>
    );
  }

  if (!isClient || !nativePlatformChecked || userLoading) {
    return (
        <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center">
            <Logo className="h-16 w-16 animate-pulse text-primary" />
        </div>
    );
  }

  if (!isLoginRoute && !user && !isNativeApp) {
    return <PublicHomePage />;
  }

  if (!user) {
    return <AuthEntry onAuthenticatedUser={handleAuthenticatedUser} />;
  }

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to organizations...</p>
    </div>
  );
}
