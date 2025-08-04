
"use client";

import { Mail, Share2, ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMembers, useCurrentUserRole, useCurrentUser } from "@/lib/data-hooks";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function MembersPage() {
  const { data: members, updateData: setMembers, loading, clubId } = useMembers();
  const { toast } = useToast();
  const [joinCode, setJoinCode] = useState('');
  const { canEditContent, canManageRoles, role } = useCurrentUserRole();
  const { user } = useCurrentUser();

  useEffect(() => {
    if (clubId) {
      const clubsString = localStorage.getItem('clubs');
      if (clubsString) {
        const clubs = JSON.parse(clubsString);
        const currentClub = clubs.find((c: any) => c.id === clubId);
        if (currentClub && currentClub.joinCode) {
          setJoinCode(currentClub.joinCode);
        }
      }
    }
  }, [clubId]);

  const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 80%)`;
  };

  const handleCopyToClipboard = () => {
    if (joinCode) {
      navigator.clipboard.writeText(joinCode);
      toast({ title: "Copied to clipboard!" });
    }
  };

  const handleRoleChange = (memberEmail: string, newRole: 'President' | 'Admin' | 'Officer' | 'Member') => {
    const updatedMembers = members.map(m =>
      m.email === memberEmail ? { ...m, role: newRole } : m
    );
    setMembers(updatedMembers);
    toast({ title: "Member role updated successfully!" });
  };
  
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">Member Directory</h1>
        {canEditContent && (
            <div className="flex gap-2">
            <Dialog>
                <DialogTrigger asChild>
                <Button variant="outline">
                    <Share2 className="mr-2" /> Invite Members
                </Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                    <DialogTitle>Invite Members with Join Code</DialogTitle>
                    <DialogDescription>
                    Share this code with people you want to invite to your club. This code is unique to your club and will not change.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    {joinCode ? (
                        <p className="text-center text-4xl font-bold tracking-[0.5em] bg-muted p-4 rounded-lg">{joinCode}</p>
                    ) : (
                        <p className="text-center text-muted-foreground">Loading join code...</p>
                    )}
                </div>
                <DialogFooter>
                    <Button onClick={handleCopyToClipboard} disabled={!joinCode}>Copy Code</Button>
                </DialogFooter>
                </DialogContent>
            </Dialog>
            </div>
        )}
      </div>

       {loading ? <p>Loading...</p> : 
          members.length > 0 ? (
          <div className="grid gap-4 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {members.map((member) => (
              <Card key={member.email}>
                <CardHeader className="items-center text-center">
                    <Avatar className="w-24 h-24 mb-2 text-4xl">
                        <AvatarImage src={member.avatar} alt={`${member.name}'s avatar`} data-ai-hint={member.dataAiHint || 'person'} />
                        <AvatarFallback style={{ backgroundColor: member.avatar ? undefined : stringToColor(member.name)}}>
                            {member.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                  <CardTitle>{member.name}</CardTitle>
                  <CardDescription>{member.role} {member.email === user?.email && "(You)"}</CardDescription>
                </CardHeader>
                <CardContent className="text-center">
                  <a href={`mailto:${member.email}`} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-2">
                    <Mail className="h-4 w-4" />
                    {member.email}
                  </a>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                   {canManageRoles && member.email !== user?.email && !(role === 'Admin' && member.role === 'President') && (
                     <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="secondary" className="w-full">
                          Manage Role <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {role === 'President' && (
                            <DropdownMenuItem onClick={() => handleRoleChange(member.email, 'Admin')}>
                              Set as Admin
                            </DropdownMenuItem>
                        )}
                         <DropdownMenuItem onClick={() => handleRoleChange(member.email, 'Officer')}>
                          Set as Officer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRoleChange(member.email, 'Member')}>
                          Set as Member
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
           <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">No members have been added yet.</p>
            {canEditContent && <p className="text-muted-foreground">Share the join code to get started!</p>}
          </div>
        )}
    </div>
  );
}
