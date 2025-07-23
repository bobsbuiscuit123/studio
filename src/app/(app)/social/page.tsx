"use client";

import { useState } from "react";
import { Network } from "lucide-react";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { socialPosts as initialSocialPosts } from "@/lib/mock-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";

type SocialPost = (typeof initialSocialPosts)[0];

export default function SocialPage() {
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>(initialSocialPosts);

  return (
    <div className="flex flex-col gap-4">
       <Alert>
        <Network className="h-4 w-4" />
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>
          To create a new social media post, please use the <Link href="/assistant" className="font-semibold underline">AI Assistant</Link>.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {socialPosts.map((post) => (
          <Card key={post.id}>
            <CardHeader>
                <CardTitle>{post.platform}</CardTitle>
                 <CardDescription>{post.date}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Image src={post.image} alt="Social post image" width={400} height={400} className="rounded-lg aspect-square object-cover" data-ai-hint={post.dataAiHint} />
              <p className="text-sm text-muted-foreground">{post.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
