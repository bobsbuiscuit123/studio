"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlusCircle, ArrowRight } from 'lucide-react';
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
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/icons';
import { useRouter, useSearchParams } from 'next/navigation';


const formSchema = z.object({
  name: z.string().min(2, 'Club name must be at least 2 characters.'),
  logo: z.any().optional(),
});

type Club = {
  id: string;
  name: string;
  logo: string;
};

export default function HomePage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isClient, setIsClient] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    setIsClient(true);
    const savedClubs = localStorage.getItem('clubs');
    if (savedClubs) {
      setClubs(JSON.parse(savedClubs));
    }
  }, []);

  useEffect(() => {
    if (isClient) {
      const joinClubId = searchParams.get('joinClubId');
      if (joinClubId) {
        // This is a simplified example. In a real app, you'd fetch club details from a backend.
        // For now, we'll assume the person sharing the link is on the same browser or we can mock it.
        const allClubsString = localStorage.getItem('clubs');
        if (allClubsString) {
          const allClubs: Club[] = JSON.parse(allClubsString);
          const clubToJoin = allClubs.find(c => c.id === joinClubId);

          if (clubToJoin) {
            const myClubsString = localStorage.getItem('clubs') || '[]';
            const myClubs: Club[] = JSON.parse(myClubsString);
            
            if (!myClubs.some(c => c.id === joinClubId)) {
                const updatedClubs = [...myClubs, clubToJoin];
                setClubs(updatedClubs);
                localStorage.setItem('clubs', JSON.stringify(updatedClubs));
                toast({ title: `Joined ${clubToJoin.name}!` });
            } else {
                toast({ title: `You are already a member of ${clubToJoin.name}.`});
            }
          }
        }
        // Clean the URL
        router.replace('/');
      }
    }
  }, [isClient, searchParams, router, toast]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
    },
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

  const handleAddClub = (values: z.infer<typeof formSchema>) => {
    const newClub = {
      id: Date.now().toString(),
      name: values.name,
      logo: values.logo || `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`,
    };
    const updatedClubs = [...clubs, newClub];
    setClubs(updatedClubs);
    localStorage.setItem('clubs', JSON.stringify(updatedClubs));
    localStorage.setItem(`club_${newClub.id}`, JSON.stringify({
      members: [],
      events: [],
      announcements: [],
      socialPosts: [],
      transactions: [],
    }));
    toast({ title: 'Club created successfully!' });
    form.reset();
    setPreviewImage(null);
  };

  const handleSelectClub = (clubId: string) => {
    localStorage.setItem('selectedClubId', clubId);
  };
  
  if (!isClient) {
    return null; // or a loading spinner
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <div className="flex justify-center items-center gap-4 mb-4">
            <Logo className="h-12 w-12 text-primary" />
            <h1 className="text-5xl font-bold">ClubHub</h1>
        </div>
        <p className="text-muted-foreground text-lg">Your all-in-one club management platform.</p>
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
                <Input type="file" accept="image/*" onChange={handleImageChange} />
                {previewImage && <Image src={previewImage} alt="logo preview" width={100} height={100} className="rounded-md" />}
                <DialogFooter>
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
                  <Image src={club.logo} alt={`${club.name} logo`} width={64} height={64} className="rounded-lg" />
                  <CardTitle>{club.name}</CardTitle>
                </CardHeader>
                <CardContent>
                    <CardDescription>Click to manage this club's dashboard and activities.</CardDescription>
                </CardContent>
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
    </div>
  );
}
