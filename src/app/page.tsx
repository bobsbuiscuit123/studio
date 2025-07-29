
"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlusCircle, ArrowRight, Trash2, LogIn } from 'lucide-react';
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
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { Member, User } from '@/lib/mock-data';
import { useCurrentUser } from '@/lib/data-hooks';

const clubFormSchema = z.object({
  name: z.string().min(2, 'Club name must be at least 2 characters.'),
  logo: z.any().optional(),
});

const userFormSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    email: z.string().email("Please enter a valid email address."),
});

type Club = {
  id: string;
  name: string;
  logo: string;
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
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsClient(true);
    const savedClubs = localStorage.getItem('clubs');
    if (savedClubs) {
      setClubs(JSON.parse(savedClubs));
    }
  }, []);

  useEffect(() => {
    if (isClient && user) {
      const joinClubId = searchParams.get('joinClubId');
      if (joinClubId) {
        const allClubsString = localStorage.getItem('clubs');
        if (allClubsString) {
          const allClubs: Club[] = JSON.parse(allClubsString);
          const clubToJoin = allClubs.find(c => c.id === joinClubId);

          if (clubToJoin) {
            const myClubsString = localStorage.getItem('my_clubs') || '[]';
            const myClubs: Club[] = JSON.parse(myClubsString);
            
            if (!myClubs.some(c => c.id === joinClubId)) {
                // This logic is simplified; in a real app, joining a club would be more complex.
                // We're adding to a separate 'my_clubs' list to avoid showing all clubs on every user's dash.
                const updatedMyClubs = [...myClubs, clubToJoin];
                localStorage.setItem('my_clubs', JSON.stringify(updatedMyClubs));
                
                // Add member to club's member list
                const clubDataKey = `club_${clubToJoin.id}`;
                const clubDataString = localStorage.getItem(clubDataKey);
                let clubData = clubDataString ? JSON.parse(clubDataString) : { members: [], announcements: [], etc: []};

                const newMember: Member = {
                    name: user.name,
                    email: user.email,
                    role: 'Member',
                    avatar: user.avatar || `https://placehold.co/100x100.png?text=${user.name.charAt(0)}`
                };
                
                if (!clubData.members.some((m: Member) => m.email === newMember.email)) {
                  clubData.members = [...(clubData.members || []), newMember];
                  localStorage.setItem(clubDataKey, JSON.stringify(clubData));
                }

                toast({ title: `Joined ${clubToJoin.name}!` });
                 // Refresh clubs to show the newly joined one
                const savedClubs = localStorage.getItem('clubs');
                if (savedClubs) {
                  setClubs(JSON.parse(savedClubs));
                }
            } else {
                toast({ title: `You are already a member of ${clubToJoin.name}.`});
            }
          }
        }
        router.replace('/');
      }
    }
  }, [isClient, searchParams, router, toast, user]);

  const form = useForm<z.infer<typeof clubFormSchema>>({
    resolver: zodResolver(clubFormSchema),
    defaultValues: { name: '' },
  });

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
        form.setValue('logo', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddClub = (values: z.infer<typeof clubFormSchema>) => {
    if (!user) {
        toast({ title: "Error", description: "Cannot create a club without user information.", variant: "destructive" });
        return;
    }
    const newClub = {
      id: Date.now().toString(),
      name: values.name,
      logo: values.logo || `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`,
    };
    const updatedClubs = [...clubs, newClub];
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
    toast({ title: 'Club created successfully!' });
    form.reset();
    setPreviewImage(null);
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
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
          <Dialog>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2" /> Add New Club
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a New Club</DialogTitle>
                <DialogDescription>
                  Enter the details for your new club.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={form.handleSubmit(handleAddClub)} className="space-y-4">
                <Input {...form.register('name')} placeholder="Club Name" />
                {form.formState.errors.name && (
                  <p className="text-red-500 text-sm">{form.formState.errors.name.message}</p>
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
                  <DialogClose asChild>
                    <Button type="submit">Create Club</Button>
                  </DialogClose>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {clubs.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clubs.map((club) => (
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
            <p className="text-muted-foreground">You haven't added any clubs yet.</p>
            <p className="text-muted-foreground">Click "Add New Club" to get started!</p>
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
