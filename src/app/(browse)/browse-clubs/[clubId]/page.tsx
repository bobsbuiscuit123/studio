
"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCurrentUser } from '@/lib/data-hooks';
import type { Member, ClubEvent, GalleryImage } from '@/lib/mock-data';
import { useToast } from '@/hooks/use-toast';
import { CalendarDays, Users, Image as ImageIcon, Info, Clock } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

type ClubDetails = {
  id: string;
  name: string;
  category: string;
  description: string;
  meetingTime: string;
  logo: string;
  members: Member[];
  events: ClubEvent[];
  galleryImages: GalleryImage[];
};

export default function ClubProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { clubId } = params;
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [club, setClub] = useState<ClubDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    if (typeof clubId === 'string') {
      const clubsString = localStorage.getItem('clubs');
      const clubDataString = localStorage.getItem(`club_${clubId}`);
      
      if (clubsString && clubDataString) {
        const clubs = JSON.parse(clubsString);
        const mainClubInfo = clubs.find((c: any) => c.id === clubId);
        const detailedClubInfo = JSON.parse(clubDataString);

        const transformedEvents = (detailedClubInfo.events || []).map((event: any) => ({
            ...event,
            date: new Date(event.date),
        }));

        const fullClubDetails = {
            ...mainClubInfo,
            ...detailedClubInfo,
            events: transformedEvents,
        };
        
        setClub(fullClubDetails);

        if (user && detailedClubInfo.members) {
          setIsMember(detailedClubInfo.members.some((m: Member) => m.email === user.email));
        }

      }
      setLoading(false);
    }
  }, [clubId, user]);

  const handleJoinClub = () => {
    if (!user || !club) {
        toast({ title: "Error", description: "You must be logged in to join a club.", variant: "destructive" });
        return;
    }

    const clubDataKey = `club_${club.id}`;
    const newMember: Member = {
        name: user.name,
        email: user.email,
        role: 'Member',
        avatar: user.avatar || `https://placehold.co/100x100.png?text=${user.name.charAt(0)}`
    };

    const updatedMembers = [...(club.members || []), newMember];
    const updatedClubData = { ...club, members: updatedMembers };
    
    localStorage.setItem(clubDataKey, JSON.stringify(updatedClubData));
    
    setClub(updatedClubData);
    setIsMember(true);

    toast({ title: "Success!", description: `You have joined ${club.name}. Redirecting to dashboard...` });

    setTimeout(() => {
        localStorage.setItem('selectedClubId', club.id);
        localStorage.setItem('clubhub_ai_sync_key', Date.now().toString());
        router.push('/dashboard');
    }, 2000);
  };

  if (loading) {
    return <div>Loading club profile...</div>;
  }

  if (!club) {
    return <div>Club not found.</div>;
  }

  const officers = club.members.filter(m => m.role === 'President' || m.role === 'Admin' || m.role === 'Officer');
  const approvedImages = club.galleryImages?.filter(img => img.status === 'approved') || [];

  return (
    <div className="space-y-8">
        <Card className="overflow-hidden">
            <CardHeader className="p-0">
                 <div className="relative h-48 w-full">
                    <Image src={club.logo} alt={`${club.name} banner`} layout="fill" objectFit="cover" className="opacity-20" />
                    <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
                    <div className="absolute bottom-0 left-0 p-6">
                        <div className="flex items-center gap-4">
                           <Image src={club.logo} alt={`${club.name} logo`} width={80} height={80} className="rounded-lg aspect-square object-cover border-4 border-background" />
                            <div>
                                <h1 className="text-3xl font-bold">{club.name}</h1>
                                <Badge>{club.category}</Badge>
                            </div>
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <div className="space-y-1">
                        <p className="flex items-center gap-2 text-muted-foreground"><Info/> {club.description}</p>
                        <p className="flex items-center gap-2 text-muted-foreground"><Clock/> {club.meetingTime}</p>
                    </div>
                    {isMember ? (
                         <Button disabled>Already a Member</Button>
                    ) : (
                        <Button onClick={handleJoinClub}>Join Club</Button>
                    )}
                </div>
            </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-8">
             <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Users/> Officers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                     {officers.length > 0 ? officers.map(officer => (
                         <div key={officer.email} className="flex items-center gap-4">
                            <Avatar>
                                <AvatarImage src={officer.avatar} />
                                <AvatarFallback>{officer.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                                <p className="font-semibold">{officer.name}</p>
                                <p className="text-sm text-muted-foreground">{officer.role}</p>
                            </div>
                         </div>
                     )) : <p className="text-muted-foreground">No officers listed.</p>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><CalendarDays/> Upcoming Events</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {club.events && club.events.length > 0 ? club.events.slice(0, 3).map((event, index) => (
                        <div key={`${event.id}-${index}`}>
                            <p className="font-semibold">{event.title}</p>
                            <p className="text-sm text-muted-foreground">{event.date.toLocaleDateString()} at {event.location}</p>
                        </div>
                    )) : (
                        <p className="text-muted-foreground">No upcoming events scheduled.</p>
                    )}
                </CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><ImageIcon/> Photo Gallery</CardTitle>
            </CardHeader>
            <CardContent>
                {approvedImages.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {approvedImages.slice(0, 8).map(image => (
                             <Image key={image.id} src={image.src} alt={image.alt} width={200} height={200} className="rounded-lg aspect-square object-cover" />
                        ))}
                    </div>
                ) : (
                    <p className="text-muted-foreground">No photos in the gallery yet.</p>
                )}
            </CardContent>
        </Card>
    </div>
  );
}
