

"use client";

import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { BarChart, Loader2, PlusCircle, MinusCircle, Award } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMembers, useEvents, usePointEntries, useCurrentUser, useCurrentUserRole } from "@/lib/data-hooks";
import type { PointEntry, Member } from "@/lib/mock-data";

const pointEntrySchema = z.object({
  memberEmail: z.string().email("Please select a member."),
  points: z.coerce.number().refine(val => val !== 0, { message: "Points cannot be zero." }),
  reason: z.string().min(5, "Please provide a reason (at least 5 characters)."),
});

export default function PointsPage() {
  const { data: members, loading: membersLoading } = useMembers();
  const { data: events, loading: eventsLoading } = useEvents();
  const { data: manualEntries, updateData: setManualEntries, loading: entriesLoading } = usePointEntries();
  const { user } = useCurrentUser();
  const { canEditContent } = useCurrentUserRole();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const form = useForm<z.infer<typeof pointEntrySchema>>({
    resolver: zodResolver(pointEntrySchema),
    defaultValues: {
      points: 0,
      reason: "",
    },
  });

  const memberPoints = useMemo(() => {
    if (membersLoading || eventsLoading) return [];

    return members.map(member => {
      const eventPoints = events.reduce((acc, event) => {
        if (event.attendees?.includes(member.email) && event.points) {
          return [...acc, {
            points: event.points,
            reason: `Attended: ${event.title}`,
            date: event.date.toLocaleDateString(),
          }];
        }
        return acc;
      }, [] as { points: number; reason: string; date: string }[]);

      const manualPoints = manualEntries
        .filter(entry => entry.memberEmail === member.email)
        .map(entry => ({
            points: entry.points,
            reason: entry.reason,
            date: entry.date,
        }));
      
      const allPoints = [...eventPoints, ...manualPoints];
      const totalPoints = allPoints.reduce((sum, entry) => sum + entry.points, 0);

      return {
        ...member,
        totalPoints,
        pointDetails: allPoints.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      };
    }).sort((a,b) => b.totalPoints - a.totalPoints);

  }, [members, events, manualEntries, membersLoading, eventsLoading]);

  const onSubmit = (values: z.infer<typeof pointEntrySchema>) => {
    if (!user) return;
    const newEntry: PointEntry = {
      id: `manual-${Date.now()}`,
      memberEmail: values.memberEmail,
      points: values.points,
      reason: values.reason,
      date: new Date().toLocaleDateString(),
      awardedBy: user.email,
    };
    setManualEntries(prev => [...prev, newEntry]);
    toast({ title: "Points adjusted successfully!" });
    form.reset();
    setIsDialogOpen(false);
  };
  
  if (membersLoading || eventsLoading || entriesLoading) {
    return (
      <div className="app-page-shell">
        <div className="app-page-scroll">
          <div className="flex flex-col gap-4">
            <Loader2 className="animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page-shell">
      <div className="app-page-scroll">
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h1 className="text-3xl font-bold flex items-center gap-2"><BarChart/> Member Points</h1>
                <p className="text-muted-foreground">View and manage points awarded to club members.</p>
            </div>
            {canEditContent && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button><PlusCircle className="mr-2"/> Adjust Points</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Manually Adjust Points</DialogTitle>
                            <DialogDescription>
                                Add or remove points for a member. Use a negative number to subtract points.
                            </DialogDescription>
                        </DialogHeader>
                        <form id="points-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                             <div className="space-y-2">
                               <Label>Member</Label>
                                <Select onValueChange={(value) => form.setValue('memberEmail', value)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a member" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {members.map(member => (
                                            <SelectItem key={member.email} value={member.email}>{member.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {form.formState.errors.memberEmail && <p className="text-destructive text-sm">{form.formState.errors.memberEmail.message}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="points">Points</Label>
                                <Input id="points" type="number" {...form.register('points')} placeholder="e.g., 10 or -5"/>
                                {form.formState.errors.points && <p className="text-destructive text-sm">{form.formState.errors.points.message}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="reason">Reason</Label>
                                <Textarea id="reason" {...form.register('reason')} placeholder="e.g., 'Volunteering at bake sale' or 'Correction for event attendance'"/>
                                 {form.formState.errors.reason && <p className="text-destructive text-sm">{form.formState.errors.reason.message}</p>}
                            </div>
                        </form>
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                            <Button type="submit" form="points-form">Save Adjustment</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Points Leaderboard</CardTitle>
            <CardDescription>
              Total points accumulated by each member.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Rank</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Total Points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberPoints.length > 0 ? (
                    memberPoints.map((member, index) => (
                        <TableRow key={member.email}>
                            <TableCell className="font-bold">{index + 1}</TableCell>
                            <TableCell>{member.name}</TableCell>
                            <TableCell className="text-right font-semibold">{member.totalPoints}</TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={3} className="text-center h-24">No members found.</TableCell>
                    </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle>Detailed Point History</CardTitle>
                <CardDescription>An itemized history of all points awarded.</CardDescription>
            </CardHeader>
            <CardContent>
                 {memberPoints.length > 0 ? (
                    <Accordion type="single" collapsible className="w-full">
                        {memberPoints.map(member => (
                            <AccordionItem value={member.email} key={member.email}>
                                <AccordionTrigger>
                                    <div className="flex justify-between items-center w-full">
                                        <p className="font-semibold">{member.name}</p>
                                        <p className="text-sm text-muted-foreground font-normal pr-4">{member.totalPoints} points</p>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    {member.pointDetails.length > 0 ? (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Date</TableHead>
                                                    <TableHead>Reason</TableHead>
                                                    <TableHead className="text-right">Points</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {member.pointDetails.map((detail, index) => (
                                                    <TableRow key={index}>
                                                        <TableCell>{detail.date}</TableCell>
                                                        <TableCell>{detail.reason}</TableCell>
                                                        <TableCell className={`text-right font-medium ${detail.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                            {detail.points > 0 ? '+' : ''}{detail.points}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    ) : (
                                        <p className="text-muted-foreground text-center py-4">This member has not earned any points yet.</p>
                                    )}
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                 ) : (
                    <p className="text-muted-foreground text-center py-8">No member data to display.</p>
                 )}
            </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
