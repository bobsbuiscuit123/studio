
"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlusCircle, ArrowRight, Trash2, LogIn, UserPlus } from 'lucide-react';
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

const clubFormSchema = z.object({
  name: z.string().min(4, 'Club name must be at least 4 characters.'),
  logo: z.any().optional(),
});

const userFormSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    email: z.string().email("Please enter a valid email address."),
});

const joinClubFormSchema = z.object({
    code: z.string().length(4, "Join code must be 4 characters long.").regex(/^[A-Z0-9]{4}$/, "Code must be uppercase letters and numbers."),
});

type Club = {
  id: string;
  name: string;
  logo: string;
  joinCode: string;
};

function UserSetup({ onUserSaved }: { onUserSaved: (user: User) => void }) {
    const { saveUser, clearUser } = useCurrentUser();
    const form = useForm<z.infer<typeof userFormSchema>>({
        resolver: zodResolver(userFormSchema),
        defaultValues: { name: "", email: "" },
    });
    const { toast } = useToast();

    const handleSaveUser = (values: z.infer<typeof userFormSchema>) => {
        const newUser: User = {
            ...values,
            avatar: `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`
        };
        saveUser(newUser);
        onUserSaved(newUser);
        toast({ title: `Welcome, ${values.name}!` });
    };

    const handleDeleteAndResign = () => {
        clearUser();
        localStorage.clear(); // This is destructive, clears all clubs, etc.
        toast({ title: "All your data has been deleted."});
        window.location.reload();
    }

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
           <Card className="w-full max-w-md">
                <CardHeader>
                    <div className="flex justify-center items-center gap-4 mb-2">
                        <Logo className="h-10 w-10 text-primary" />
                        <CardTitle className="text-4xl">Welcome to ClubHub</CardTitle>
                    </div>
                    <CardDescription className="text-center">Let's get you set up. Please enter your details.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={form.handleSubmit(handleSaveUser)} className="space-y-4">
                        <div>
                            <Label htmlFor="name">Full Name</Label>
                            <Input id="name" {...form.register('name')} placeholder="e.g., Alex Johnson" />
                             {form.formState.errors.name && <p className="text-red-500 text-sm mt-1">{form.formState.errors.name.message}</p>}
                        </div>
                        <div>
                           <Label htmlFor="email">Email Address</Label>
                           <Input id="email" {...form.register('email')} placeholder="e.g., alex.j@example.com" />
                            {form.formState.errors.email && <p className="text-red-500 text-sm mt-1">{form.formState.errors.email.message}</p>}
                        </div>
                        <Button type="submit" className="w-full">Save & Continue</Button>
                    </form>
                </CardContent>
                <CardFooter className="flex-col gap-4">
                     <p className="text-xs text-muted-foreground">This information is saved on your device.</p>
                     <Button variant="destructive" size="sm" onClick={handleDeleteAndResign}><Trash2 className="mr-2"/>Clear My Info & Reset App</Button>
                </CardFooter>
           </Card>
        </div>
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
    
    const newJoinCode = values.name.substring(0, 4).toUpperCase();
    if (allClubs.some(club => club.joinCode === newJoinCode)) {
        toast({ title: "Club Name Unavailable", description: "A club with a similar name already exists. Please choose a different name.", variant: "destructive"});
        return;
    }

    const newClub: Club = {
      id: Date.now().toString(),
      name: values.name,
      logo: values.logo || `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`,
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

    localStorage.setItem(`club_${newClub.id}`, JSON.stringify({
      members: [firstMember],
      events: [],
      announcements: [],
      socialPosts: [],
      transactions: [],
    }));
    toast({ title: 'Club created successfully!', description: `Your join code is ${newClub.joinCode}` });
    clubForm.reset();
    setPreviewImage(null);
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
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

    if (clubData.members.some((m: Member) => m.email === user.email)) {
        toast({ title: "Already a Member", description: `You are already a member of ${clubToJoin.name}.`, variant: "default" });
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
    
    const updatedClubs = [...clubs, clubToJoin].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
    setClubs(updatedClubs);
    
    toast({ title: "Success!", description: `You have successfully joined ${clubToJoin.name}.` });
    joinForm.reset();
  };

  const handleSelectClub = (clubId: string) => {
    localStorage.setItem('selectedClubId', clubId);
  };

  const handleSwitchAccount = () => {
    clearUser();
    window.location.reload();
  }
  
  if (!isClient || userLoading) {
    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center">
            <Logo className="h-16 w-16 animate-pulse text-primary" />
        </div>
    );
  }

  if (!user) {
    return <UserSetup onUserSaved={(newUser) => saveUser(newUser)} />;
  }
  
  const userClubIds = new Set();
  if (isClient) {
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('club_')) {
            const clubData = JSON.parse(localStorage.getItem(key) || '{}');
            if (clubData.members && clubData.members.some((m: Member) => m.email === user.email)) {
                userClubIds.add(key.replace('club_', ''));
            }
        }
    });
  }

  const displayedClubs = clubs.filter(club => userClubIds.has(club.id));

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <div className="flex justify-center items-center gap-4 mb-4">
            <Logo className="h-12 w-12 text-primary" />
            <h1 className="text-5xl font-bold">ClubHub</h1>
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

        {displayedClubs.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayedClubs.map((club) => (
              <Card key={club.id}>
                <CardHeader className="flex-row items-center gap-4">
                  <Image src={club.logo} alt={`${club.name} logo`} width={64} height={64} className="rounded-lg aspect-square object-cover" />
                  <div>
                    <CardTitle>{club.name}</CardTitle>
                    <CardDescription>Manage this club</CardDescription>
                  </div>
                </CardHeader>
                <CardFooter>
                  <Link href="/dashboard" className="w-full" onClick={() => handleSelectClub(club.id)}>
                    <Button className="w-full">
                      Open Dashboard <ArrowRight className="ml-2" />
                    </Button>
                  </Link>
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
            <Button variant="outline" onClick={handleSwitchAccount}>
                <LogIn className="mr-2"/> Switch Account
            </Button>
       </div>
    </div>
  );
}
