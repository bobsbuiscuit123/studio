
"use client";

import { useState, useEffect, useMemo } from 'react';
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
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeFetchJson } from '@/lib/network';

type ClubDetails = {
  id: string;
  name: string;
  category: string;
  description: string;
  meetingTime: string;
  logo: string;
  joinCode?: string;
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
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [club, setClub] = useState<ClubDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    if (typeof clubId === 'string') {
      const load = async () => {
        const { data: org, error: orgError } = await supabase
          .from('orgs')
          .select('id,name,category,description,meeting_time,logo_url,join_code')
          .eq('id', clubId)
          .maybeSingle();
        const { data: state } = await supabase
          .from('org_state')
          .select('data')
          .eq('org_id', clubId)
          .maybeSingle();
        if (orgError || !org) {
          setClub(null);
          setLoading(false);
          return;
        }
        const data = (state?.data || {}) as Partial<ClubDetails>;
        const transformedEvents = (data.events || []).map((event: any) => ({
          ...event,
          date: new Date(event.date),
        }));
        const fullClubDetails: ClubDetails = {
          id: org.id,
          name: org.name,
          category: org.category || 'Other',
          description: org.description || 'No description provided.',
          meetingTime: org.meeting_time || '',
          logo: org.logo_url || `https://placehold.co/100x100.png?text=${org.name.charAt(0)}`,
          joinCode: org.join_code,
          members: (data.members as Member[]) || [],
          events: transformedEvents,
          galleryImages: (data.galleryImages as GalleryImage[]) || [],
        };
        setClub(fullClubDetails);
        if (user && fullClubDetails.members) {
          setIsMember(fullClubDetails.members.some((m: Member) => m.email === user.email));
        }
        setLoading(false);
      };
      load();
    }
  }, [clubId, supabase, user]);

  const handleJoinClub = () => {
    if (!user || !club) {
        toast({ title: "Error", description: "You must be logged in to join a club.", variant: "destructive" });
        return;
    }
    const join = async () => {
      if (!club.joinCode) {
        toast({ title: "Error", description: "Missing join code.", variant: "destructive" });
        return;
      }
      const { error } = await supabase.rpc('join_org', { join_code: club.joinCode });
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
      const { data: authUser } = await supabase.auth.getUser();
      const newMember: Member = {
          id: authUser.user?.id,
          name: user.name,
          email: user.email,
          role: 'Member',
          avatar: user.avatar || `https://placehold.co/100x100.png?text=${user.name.charAt(0)}`
      };
      const updatedMembers = [...(club.members || []), newMember];
      await supabase
        ;
      await safeFetchJson('/api/org-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: club.id, data: { ...club, members: updatedMembers } }),
      });
      setClub({ ...club, members: updatedMembers });
      setIsMember(true);
      toast({ title: "Success!", description: `You have joined ${club.name}. Redirecting to dashboard...` });
      setTimeout(() => {
          localStorage.setItem('selectedClubId', club.id);
          router.push('/dashboard');
      }, 2000);
    };
    join();
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
