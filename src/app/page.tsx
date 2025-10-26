

"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlusCircle, ArrowRight, LogIn, UserPlus } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/icons';
import { useRouter } from 'next/navigation';
import { Member, User } from '@/lib/mock-data';
import { useCurrentUser } from '@/lib/data-hooks';
import { sendResetPasswordEmail } from '@/ai/flows/send-reset-password-email';
import { faker } from '@faker-js/faker';

const clubFormSchema = z.object({
  name: z.string().min(4, 'Club name must be at least 4 characters.'),
  logo: z.any().optional(),
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
};

function SignUpForm({ onUserSaved, onSwitchToLogin }: { onUserSaved: (user: User) => void; onSwitchToLogin: () => void; }) {
    const form = useForm<z.infer<typeof userFormSchema>>({
        resolver: zodResolver(userFormSchema),
        defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    });
    const { toast } = useToast();

    const handleSaveUser = (values: z.infer<typeof userFormSchema>) => {
        const allUsersString = localStorage.getItem('users') || '[]';
        const allUsers: User[] = JSON.parse(allUsersString);

        if (allUsers.some(u => u.email === values.email)) {
            toast({ title: "User exists", description: "An account with this email already exists. Please log in.", variant: "destructive" });
            return;
        }

        const newUser: User = {
            name: values.name,
            email: values.email,
            password: values.password,
            avatar: `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`
        };

        const updatedUsers = [...allUsers, newUser];
        localStorage.setItem('users', JSON.stringify(updatedUsers));

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

function LoginForm({ onLogin, onSwitchToSignUp }: { onLogin: (user: User) => void; onSwitchToSignUp: () => void; }) {
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

     const handleLogin = (values: z.infer<typeof loginFormSchema>) => {
        const allUsersString = localStorage.getItem('users') || '[]';
        const allUsers: User[] = JSON.parse(allUsersString);
        const foundUser = allUsers.find(u => u.email === values.email);

        if (!foundUser) {
            toast({ title: "User not found", description: "No account found with that email.", variant: "destructive" });
            return;
        }
        if (foundUser.password !== values.password) {
            toast({ title: "Invalid Password", description: "The password you entered is incorrect.", variant: "destructive" });
            return;
        }
        
        onLogin(foundUser);
        toast({ title: `Welcome back, ${foundUser.name}!`});
    };
    
    const handleForgotPassword = async (values: z.infer<typeof forgotPasswordSchema>) => {
        setIsSending(true);
        try {
            const allUsersString = localStorage.getItem('users') || '[]';
            const allUsers: User[] = JSON.parse(allUsersString);

            const result = await sendResetPasswordEmail({ email: values.email, allUsers });
            toast({
                title: result.success ? "Password Recovery" : "Error",
                description: result.message,
                variant: result.success ? "default" : "destructive",
            });
            setIsForgotPassDialogOpen(false);
            forgotPasswordForm.reset();
        } catch (error) {
             toast({ title: "Error", description: "Failed to send reset email. Please try again.", variant: "destructive" });
        } finally {
            setIsSending(false);
        }
    }

    return (
        <>
         <div className="w-full max-w-md">
             <CardHeader>
                <CardTitle className="text-3xl">Log In to ClubHub AI</CardTitle>
                <CardDescription>Enter your credentials to access your account.</CardDescription>
            </CardHeader>
            <CardContent>
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
                        {forgotPasswordForm.formState.errors.email && <p className="text-red-500 text-sm mt-1">{forgotPasswordForm.state.errors.email.message}</p>}
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  useEffect(() => {
    setIsClient(true);
    const savedClubs = localStorage.getItem('clubs');
    if (savedClubs) {
      setClubs(JSON.parse(savedClubs));
    }
  }, []);

  const clubForm = useForm<z.infer<typeof clubFormSchema>>({
    resolver: zodResolver(clubFormSchema),
    defaultValues: { name: '' },
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
  
  const handleCreateClub = (values: z.infer<typeof clubFormSchema>) => {
    if (!user) {
        toast({ title: "Error", description: "Cannot create a club without user information.", variant: "destructive" });
        return;
    }
    
    const allClubsString = localStorage.getItem('clubs') || '[]';
    const allClubs: Club[] = JSON.parse(allClubsString);
    
    let newJoinCode = '';
    let isCodeUnique = false;
    while (!isCodeUnique) {
        newJoinCode = faker.string.alphanumeric(4).toUpperCase();
        if (!allClubs.some(club => club.joinCode === newJoinCode)) {
            isCodeUnique = true;
        }
    }

    const newClub: Club = {
      id: Date.now().toString(),
      name: values.name,
      joinCode: newJoinCode,
    };
    
    const updatedClubs = [...allClubs, newClub];
    setClubs(updatedClubs);
    localStorage.setItem('clubs', JSON.stringify(updatedClubs));
    
    const firstMember: Member = {
        name: user.name,
        email: user.email,
        role: "President",
        avatar: user.avatar || `https://placehold.co/100x100.png?text=${user.name.charAt(0)}`
    }

    const newClubData = {
        logo: values.logo || `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`,
        members: [firstMember],
        events: [],
        announcements: [],
        socialPosts: [],
        transactions: [],
        messages: {},
        groupChats: [],
        galleryImages: [],
    };

    localStorage.setItem(`club_${newClub.id}`, JSON.stringify(newClubData));

    toast({ title: 'Club created successfully!', description: `Your join code is ${newClub.joinCode}` });
    clubForm.reset();
    setPreviewImage(null);
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
    // Manually trigger a storage event to update club list for the current user
    window.dispatchEvent(new StorageEvent('storage'));
  };

  const handleJoinClub = (values: z.infer<typeof joinClubFormSchema>) => {
    if (!user) {
         toast({ title: "Error", description: "Cannot join a club without user information.", variant: "destructive" });
        return;
    }
    const allClubsString = localStorage.getItem('clubs');
    if (!allClubsString) {
        toast({ title: "Error", description: "No clubs found.", variant: "destructive" });
        return;
    }
    const allClubs: Club[] = JSON.parse(allClubsString);
    const clubToJoin = allClubs.find(c => c.joinCode && c.joinCode.toUpperCase() === values.code.toUpperCase());

    if (!clubToJoin) {
        toast({ title: "Invalid Code", description: "No club found with that join code.", variant: "destructive" });
        return;
    }

    const clubDataKey = `club_${clubToJoin.id}`;
    const clubDataString = localStorage.getItem(clubDataKey);
    let clubData = clubDataString ? JSON.parse(clubDataString) : { members: [] };

    if (clubData.members && clubData.members.some((m: Member) => m.email === user.email)) {
        toast({ title: "Already a Member", description: `You are already a member of ${clubToJoin.name}.`, variant: "default" });
        handleSelectClub(clubToJoin.id);
        return;
    }

    const newMember: Member = {
        name: user.name,
        email: user.email,
        role: 'Member',
        avatar: user.avatar || `https://placehold.co/100x100.png?text=${user.name.charAt(0)}`
    };

    clubData.members = [...(clubData.members || []), newMember];
    localStorage.setItem(clubDataKey, JSON.stringify(clubData));
    
    toast({ title: "Success!", description: `You have successfully joined ${clubToJoin.name}.` });
    joinForm.reset();
    handleSelectClub(clubToJoin.id);
  };

  const handleSelectClub = (clubId: string) => {
    const clubDataString = localStorage.getItem(`club_${clubId}`);
    if (clubDataString) {
      localStorage.setItem('selectedClubId', clubId);
      const clubData = JSON.parse(clubDataString);
      localStorage.setItem('selectedClubLogo', clubData.logo || '');
    }
    router.push('/dashboard');
  };

  const handleLogout = () => {
    clearUser();
    localStorage.removeItem('selectedClubId');
    localStorage.removeItem('selectedClubLogo');
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
                        <LoginForm onLogin={saveUser} onSwitchToSignUp={() => setAuthMode('signup')} />
                   ) : (
                        <SignUpForm onUserSaved={saveUser} onSwitchToLogin={() => setAuthMode('login')} />
                   )}
                </div>
            </Card>
        </div>
    );
  }
  
  const userClubIds = new Set<string>();
  if (isClient) {
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('club_')) {
            try {
                const clubData = JSON.parse(localStorage.getItem(key) || '{}');
                if (clubData.members && clubData.members.some((m: Member) => m.email === user.email)) {
                    userClubIds.add(key.replace('club_', ''));
                }
            } catch (e) {
                console.error("Failed to parse club data from local storage", e);
            }
        }
    });
  }

  const displayedClubs = clubs.filter(club => userClubIds.has(club.id));
  
  const clubsWithLogos = displayedClubs.map(club => {
      if (!isClient) return { ...club, logo: '' };
      const clubDataString = localStorage.getItem(`club_${club.id}`);
      if (clubDataString) {
          const clubData = JSON.parse(clubDataString);
          return { ...club, logo: clubData.logo || `https://placehold.co/100x100.png?text=${club.name.charAt(0)}` };
      }
      return { ...club, logo: `https://placehold.co/100x100.png?text=${club.name.charAt(0)}` };
  });

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
            <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline"><UserPlus className="mr-2" /> Join Club</Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                    <DialogTitle>Join a Club</DialogTitle>
                    <DialogDescription>
                    Enter the 4-letter join code provided by the club owner.
                    </DialogDescription>
                </DialogHeader>
                 <form onSubmit={joinForm.handleSubmit(handleJoinClub)} className="space-y-4">
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
            <Dialog>
                <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2" /> Create Club
                </Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create a New Club</DialogTitle>
                    <DialogDescription>
                    Enter the details for your new club. You will be the owner.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={clubForm.handleSubmit(handleCreateClub)} className="space-y-4">
                    <Input {...clubForm.register('name')} placeholder="Club Name (e.g., Innovators Club)" />
                    {clubForm.formState.errors.name && (
                    <p className="text-red-500 text-sm">{clubForm.formState.errors.name.message}</p>
                    )}
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
