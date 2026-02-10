
"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import Image from 'next/image';
import { PlusCircle, ArrowRight, LogIn, UserPlus, Compass, Chrome, Apple } from 'lucide-react';
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
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/icons';
import { usePathname, useRouter } from 'next/navigation';
import { Member, User } from '@/lib/mock-data';
import { useCurrentUser } from '@/lib/data-hooks';
import { faker } from '@faker-js/faker';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { getDefaultOrgState } from '@/lib/org-state';
import { safeFetchJson } from '@/lib/network';

const clubCategories = ["STEM", "Arts", "Sports", "Service", "Academic", "Cultural", "Other"];

const clubFormSchema = z.object({
  name: z.string().min(4, 'Club name must be at least 4 characters.'),
  logo: z.any().optional(),
  category: z.string().min(1, "Please select a category."),
  description: z.string().min(10, "Description must be at least 10 characters long."),
  meetingTime: z.string().min(3, "Please enter a meeting time."),
});

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


const joinClubFormSchema = z.object({
    code: z.string().length(4, "Join code must be 4 characters long.").regex(/^[A-Z0-9]{4}$/, "Code must be uppercase letters and numbers."),
});

type Club = {
  id: string;
  name: string;
  joinCode: string;
  category: string;
  description: string;
  meetingTime: string;
  logo?: string;
};

function OAuthButtons({ supabase }: { supabase: ReturnType<typeof createSupabaseBrowserClient> }) {
    const [providerLoading, setProviderLoading] = useState<'google' | 'apple' | null>(null);
    const { toast } = useToast();

    const handleOAuth = async (provider: 'google' | 'apple') => {
        setProviderLoading(provider);
        const { error } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
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
                <Chrome className="mr-2 h-4 w-4" /> Continue with Google
            </Button>
            <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => handleOAuth('apple')}
                disabled={providerLoading !== null}
            >
                <Apple className="mr-2 h-4 w-4" /> Continue with Apple
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>or continue with email</span>
                <div className="h-px flex-1 bg-border" />
            </div>
        </div>
    );
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
        const { data, error } = await supabase.auth.signUp({
            email: values.email,
            password: values.password,
            options: {
              data: { display_name: values.name },
              emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        if (error) {
            toast({ title: "Signup failed", description: error.message, variant: "destructive" });
            return;
        }
        if (!data.session) {
            toast({
              title: "Check your email",
              description: "Use the confirmation link to verify your account and sign in.",
            });
            onSwitchToLogin();
            return;
        }
        if (data.user) {
          await supabase
            .from('profiles')
            .upsert({ id: data.user.id, email: values.email, display_name: values.name });
        }
        const newUser: User = {
            name: values.name,
            email: values.email,
            password: '',
            avatar: `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`
        };
        onUserSaved(newUser);
        toast({ title: `Welcome, ${values.name}!` });
    };
    
    return (
        <div className="w-full max-w-md">
            <CardHeader>
                <CardTitle className="text-3xl">Create your Account</CardTitle>
                <CardDescription>Get started with ClubHub AI by creating an account.</CardDescription>
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
            const message = error.message.toLowerCase();
            if (message.includes('email not confirmed')) {
                toast({
                  title: "Confirm your email first",
                  description: "Open your email confirmation link, then sign in again.",
                  variant: "destructive",
                });
                return;
            }
            toast({ title: "Login failed", description: error.message, variant: "destructive" });
            return;
        }
        if (data.user) {
          await supabase
            .from('profiles')
            .upsert({
              id: data.user.id,
              email: values.email,
              display_name:
                (data.user.user_metadata?.display_name as string | undefined) ||
                values.email,
            });
        }
        const displayName =
          (data.user?.user_metadata?.display_name as string | undefined) || values.email;
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
        const { error } = await supabase.auth.resetPasswordForEmail(values.email);
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
                <CardTitle className="text-3xl">Log In to ClubHub AI</CardTitle>
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
  const { user, loading: userLoading, saveUser, clearUser } = useCurrentUser();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isClient, setIsClient] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const didLogNavigationRef = useRef(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [isCreateClubOpen, setIsCreateClubOpen] = useState(false);
  const [isJoinClubOpen, setIsJoinClubOpen] = useState(false);
  const [memberOrgIds, setMemberOrgIds] = useState<Set<string>>(new Set());
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const loadClubsFromStorage = async () => {
    const { data, error } = await supabase
      .from('orgs')
      .select('id,name,join_code,category,description,meeting_time,logo_url');
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    const mapped = (data || []).map(org => ({
      id: org.id,
      name: org.name,
      joinCode: org.join_code,
      category: org.category || '',
      description: org.description || '',
      meetingTime: org.meeting_time || '',
      logo: org.logo_url || '',
    }));
    setClubs(mapped);

    const { data: memberships } = await supabase
      .from('memberships')
      .select('org_id');
    const ids = new Set<string>((memberships || []).map(m => m.org_id));
    setMemberOrgIds(ids);
  };

  useEffect(() => {
    setIsClient(true);
    loadClubsFromStorage();
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user;
      if (sessionUser) {
        const displayName =
          (sessionUser.user_metadata?.display_name as string | undefined) ||
          sessionUser.email ||
          'Member';
        saveUser({
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
      const displayName =
        (sessionUser.user_metadata?.display_name as string | undefined) ||
        sessionUser.email ||
        'Member';
      saveUser({
        name: displayName,
        email: sessionUser.email || '',
        avatar: `https://placehold.co/100x100.png?text=${displayName.charAt(0)}`,
      });
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, [clearUser, saveUser, supabase]);

  useEffect(() => {
    if (!isClient || userLoading || didLogNavigationRef.current) return;
    console.info('[home] navigation settled', {
      pathname,
      isAuthenticated: Boolean(user),
      selectedClubId: localStorage.getItem('selectedClubId'),
    });
    didLogNavigationRef.current = true;
  }, [isClient, pathname, user, userLoading]);

  useEffect(() => {
    if (!isClient) return;
    loadClubsFromStorage();
  }, [isClient, user]);

  const clubForm = useForm<z.infer<typeof clubFormSchema>>({
    resolver: zodResolver(clubFormSchema),
    defaultValues: { name: '', category: '', description: '', meetingTime: '' },
  });
  
  const joinForm = useForm<z.infer<typeof joinClubFormSchema>>({
    resolver: zodResolver(joinClubFormSchema),
    defaultValues: { code: '' },
  });

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
        clubForm.setValue('logo', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleCreateClub = async (values: z.infer<typeof clubFormSchema>) => {
    if (!user) {
        toast({ title: "Error", description: "Cannot create a club without user information.", variant: "destructive" });
        return;
    }
    const newJoinCode = faker.string.alphanumeric(4).toUpperCase();
    const logo = values.logo || `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`;
    const createResponse = await safeFetchJson<{ ok: boolean; orgId: string; error?: { message?: string } }>(
      '/api/orgs/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          joinCode: newJoinCode,
          category: values.category,
          description: values.description,
          meetingTime: values.meetingTime,
          logoUrl: logo,
        }),
      }
    );
    if (!createResponse.ok || !createResponse.data?.ok) {
      const message =
        !createResponse.ok
          ? createResponse.error.message
          : createResponse.data.error?.message || 'Failed to create club.';
      toast({ title: "Error", description: message, variant: "destructive" });
      return;
    }
    const orgId = createResponse.data.orgId;
    const { data: authUser } = await supabase.auth.getUser();
    const initialMember: Member = {
      id: authUser.user?.id,
      name: user.name,
      email: user.email,
      role: 'President',
      avatar: user.avatar || `https://placehold.co/100x100.png?text=${user.name.charAt(0)}`,
    };
    const initialState = getDefaultOrgState();
    initialState.logo = logo;
    initialState.members = [initialMember];
    initialState.mindmap = {
      nodes: [{ id: '1', type: 'input', data: { label: `${values.name} Mind Map` }, position: { x: 250, y: 5 } }],
      edges: [],
    };
    await safeFetchJson('/api/org-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, data: initialState }),
    });
    await loadClubsFromStorage();
    localStorage.setItem('selectedClubId', orgId);
    toast({ title: 'Club created successfully!', description: `Your join code is ${newJoinCode}` });
    clubForm.reset();
    setPreviewImage(null);
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
    setIsCreateClubOpen(false);
  };

  const handleJoinClub = async (values: z.infer<typeof joinClubFormSchema>) => {
    if (!user) {
         toast({ title: "Error", description: "Cannot join a club without user information.", variant: "destructive" });
        return;
    }
    const joinResponse = await safeFetchJson<{ ok: boolean; orgId: string; error?: { message?: string } }>(
      '/api/orgs/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinCode: values.code.toUpperCase() }),
      }
    );
    if (!joinResponse.ok || !joinResponse.data?.ok) {
      const message =
        !joinResponse.ok
          ? joinResponse.error.message
          : joinResponse.data.error?.message || 'Failed to join club.';
      toast({ title: "Invalid Code", description: message, variant: "destructive" });
      return;
    }
    const orgId = joinResponse.data.orgId;
    const { data: stateRow } = await supabase
      .from('org_state')
      .select('data')
      .eq('org_id', orgId)
      .maybeSingle();
    const { data: authUser } = await supabase.auth.getUser();
    const currentState = (stateRow?.data || getDefaultOrgState()) as ReturnType<typeof getDefaultOrgState>;
    const newMember: Member = {
      id: authUser.user?.id,
      name: user.name,
      email: user.email,
      role: 'Member',
      avatar: user.avatar || `https://placehold.co/100x100.png?text=${user.name.charAt(0)}`,
    };
    const existingMembers = Array.isArray(currentState.members) ? currentState.members : [];
    const updatedMembers = existingMembers.some(m => m.email === user.email)
      ? existingMembers
      : [...existingMembers, newMember];
    await safeFetchJson('/api/org-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        data: { ...currentState, members: updatedMembers },
      }),
    });
    await loadClubsFromStorage();
    localStorage.setItem('selectedClubId', orgId);
    toast({ title: "Success!", description: `You have successfully joined the club.` });
    joinForm.reset();
    setIsJoinClubOpen(false);
    handleSelectClub(orgId);
  };

  const handleSelectClub = (clubId: string) => {
    localStorage.setItem('selectedClubId', clubId);
    router.push('/dashboard');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearUser();
    localStorage.removeItem('selectedClubId');
  }
  
  if (!isClient || userLoading) {
    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center">
            <Logo className="h-16 w-16 animate-pulse text-primary" />
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
                        <CardTitle className="text-4xl">ClubHub AI</CardTitle>
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
  
  const displayedClubs = clubs.filter(club => memberOrgIds.has(club.id));
  
  const clubsWithLogos = displayedClubs.map(club => ({
    ...club,
    logo: club.logo || `https://placehold.co/100x100.png?text=${club.name.charAt(0)}`,
  }));

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <div className="flex justify-center items-center gap-4 mb-4">
            <Logo className="h-12 w-12 text-primary" />
            <h1 className="text-5xl font-bold">ClubHub AI</h1>
        </div>
        <p className="text-muted-foreground text-lg">Your all-in-one club management platform.</p>
         <p className="text-muted-foreground text-md mt-2">Welcome back, {user.name}!</p>
      </div>

      <div className="w-full max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold">Your Clubs</h2>
           <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/browse-clubs')}><Compass className="mr-2"/> Browse All Clubs</Button>
            <Dialog open={isJoinClubOpen} onOpenChange={setIsJoinClubOpen}>
                <DialogTrigger asChild>
                  <Button variant="secondary"><UserPlus className="mr-2" /> Join Club</Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                    <DialogTitle>Join a Club</DialogTitle>
                    <DialogDescription>
                    Enter the 4-character join code provided by the club president.
                    </DialogDescription>
                </DialogHeader>
                 <form onSubmit={joinForm.handleSubmit(handleJoinClub)} className="space-y-4 pt-4">
                    <Input 
                        {...joinForm.register('code')} 
                        placeholder="ABCD" 
                        maxLength={4}
                        className="uppercase text-center text-2xl tracking-[0.5em]"
                    />
                     {joinForm.formState.errors.code && (
                        <p className="text-red-500 text-sm">{joinForm.formState.errors.code.message}</p>
                    )}
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                        <Button type="submit">Join Club</Button>
                    </DialogFooter>
                 </form>
                </DialogContent>
            </Dialog>
            <Dialog open={isCreateClubOpen} onOpenChange={setIsCreateClubOpen}>
                <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2" /> Create Club
                </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create a New Club</DialogTitle>
                    <DialogDescription>
                    Enter the details for your new club. You will automatically be assigned the 'President' role.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={clubForm.handleSubmit(handleCreateClub)} className="space-y-4 pt-4">
                    <div>
                      <Label>Club Name</Label>
                      <Input {...clubForm.register('name')} placeholder="e.g., Innovators Club" />
                      {clubForm.formState.errors.name && <p className="text-destructive text-sm">{clubForm.formState.errors.name.message}</p>}
                    </div>
                    <div>
                      <Label>Club Category</Label>
                       <Select onValueChange={(value) => clubForm.setValue('category', value)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                          <SelectContent>
                            {clubCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      {clubForm.formState.errors.category && <p className="text-destructive text-sm">{clubForm.formState.errors.category.message}</p>}
                    </div>
                     <div>
                      <Label>Club Description</Label>
                      <Input {...clubForm.register('description')} placeholder="What is your club about?" />
                      {clubForm.formState.errors.description && <p className="text-destructive text-sm">{clubForm.formState.errors.description.message}</p>}
                    </div>
                     <div>
                      <Label>Meeting Time / Location</Label>
                      <Input {...clubForm.register('meetingTime')} placeholder="e.g., Tuesdays at 4 PM in Room 101" />
                      {clubForm.formState.errors.meetingTime && <p className="text-destructive text-sm">{clubForm.formState.errors.meetingTime.message}</p>}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>Club Logo (Optional)</Label>
                      <Input type="file" ref={fileInputRef} accept="image/*" onChange={handleImageChange} />
                    </div>
                    {previewImage && <Image src={previewImage} alt="logo preview" width={100} height={100} className="rounded-md" />}
                    <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="ghost">Cancel</Button>
                    </DialogClose>
                    <Button type="submit">Create Club</Button>
                    </DialogFooter>
                </form>
                </DialogContent>
            </Dialog>
          </div>
        </div>

        {clubsWithLogos.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clubsWithLogos.map((club) => (
              <Card key={club.id}>
                <CardHeader className="flex-row items-center gap-4">
                  <Image src={club.logo || ''} alt={`${club.name} logo`} width={64} height={64} className="rounded-lg aspect-square object-cover" />
                  <div>
                    <CardTitle>{club.name}</CardTitle>
                    <CardDescription>Manage this club</CardDescription>
                  </div>
                </CardHeader>
                <CardFooter>
                  <Button className="w-full" onClick={() => handleSelectClub(club.id)}>
                      Open Dashboard <ArrowRight className="ml-2" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">You haven't created or joined any clubs yet.</p>
            <p className="text-muted-foreground">Click "Create Club" or "Join Club" to get started!</p>
          </div>
        )}
      </div>
       <div className="mt-8">
            <Button variant="outline" onClick={handleLogout}>
                <LogIn className="mr-2"/> Log Out
            </Button>
       </div>
    </div>
  );
}
