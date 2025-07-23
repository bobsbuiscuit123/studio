"use client";

import { MessageSquare, Mail } from "lucide-react";
import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { members } from "@/lib/mock-data";
import { useToast } from "@/hooks/use-toast";

export default function MembersPage() {
  const { toast } = useToast();

  const handleMessage = (name: string) => {
    toast({
      title: "Feature not available",
      description: `Messaging for ${name} is not implemented yet.`,
    });
  };
  
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Member Directory</h1>
      <div className="grid gap-4 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {members.map((member) => (
          <Card key={member.email}>
            <CardHeader className="items-center text-center">
              <Image
                className="aspect-square w-24 h-24 rounded-full object-cover mb-2"
                src={member.avatar}
                alt={`${member.name}'s avatar`}
                width={96}
                height={96}
                data-ai-hint={member.dataAiHint}
              />
              <CardTitle>{member.name}</CardTitle>
              <CardDescription>{member.role}</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <a href={`mailto:${member.email}`} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-2">
                <Mail className="h-4 w-4" />
                {member.email}
              </a>
            </CardContent>
            <CardFooter>
              <Button className="w-full" onClick={() => handleMessage(member.name)}>
                <MessageSquare className="mr-2 h-4 w-4" />
                Message
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
