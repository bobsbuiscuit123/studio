"use client";

import { useState, useRef } from "react";
import { PlusCircle, Loader2, Sparkles, Image as ImageIcon, X } from "lucide-react";
import Image from "next/image";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { socialPosts as initialSocialPosts } from "@/lib/mock-data";
import { generateSocialMediaPost, type GenerateSocialMediaPostOutput } from "@/ai/flows/generate-social-media-post";
import { cn } from "@/lib/utils";

const socialPostSchema = z.object({
  clubName: z.string().min(1, "Club name is required"),
  activityDescription: z.string().min(1, "Activity description is required"),
  targetAudience: z.string().min(1, "Target audience is required"),
  callToAction: z.string().min(1, "Call to action is required"),
  imageCaptionPreferences: z.string().optional(),
  photoDataUri: z.string().optional(),
  postText: z.string().optional(),
});

type SocialPost = (typeof initialSocialPosts)[0];

export default function SocialPage() {
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>(initialSocialPosts);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof socialPostSchema>>({
    resolver: zodResolver(socialPostSchema),
    defaultValues: {
      clubName: "Art Club",
      activityDescription: "",
      targetAudience: "All students interested in art",
      callToAction: "Join our next meeting!",
      imageCaptionPreferences: "",
      photoDataUri: "",
      postText: "",
    },
  });
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        form.setValue("photoDataUri", result);
        setPreviewImage(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAiGenerate = async () => {
    const values = form.getValues();
    if (!values.clubName || !values.activityDescription || !values.targetAudience || !values.callToAction) {
      toast({ title: "Missing Information", description: "Please fill in all required fields to generate a post.", variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    try {
      const result: GenerateSocialMediaPostOutput = await generateSocialMediaPost(values);
      form.setValue("postText", `${result.postText}${result.imageCaption ? `\n\nImage Caption: ${result.imageCaption}` : ''}`);
    } catch (error) {
      toast({ title: "AI Generation Failed", description: "Could not generate post. Please try again.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const onSubmit = (values: z.infer<typeof socialPostSchema>) => {
    const newPost: SocialPost = {
      id: socialPosts.length + 1,
      platform: "Instagram",
      content: values.postText || values.activityDescription,
      image: values.photoDataUri || "https://placehold.co/400x400.png",
      dataAiHint: 'student event',
      author: "AI Assistant",
      date: "Just now",
    };
    setSocialPosts([newPost, ...socialPosts]);
    toast({ title: "Social Post Created!", description: "Your new post is ready." });
    form.reset();
    setPreviewImage(null);
    setIsDialogOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Social Media Manager</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button><PlusCircle className="mr-2 h-4 w-4" /> New Post</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Social Media Post</DialogTitle>
              <DialogDescription>Use AI to craft the perfect post to engage your audience.</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <FormField control={form.control} name="clubName" render={({ field }) => (
                    <FormItem><FormLabel>Club Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="targetAudience" render={({ field }) => (
                    <FormItem><FormLabel>Target Audience</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="callToAction" render={({ field }) => (
                    <FormItem><FormLabel>Call To Action</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="activityDescription" render={({ field }) => (
                    <FormItem><FormLabel>Activity Description</FormLabel><FormControl><Textarea placeholder="Describe the event or activity" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="imageCaptionPreferences" render={({ field }) => (
                    <FormItem><FormLabel>Caption Preferences (Optional)</FormLabel><FormControl><Input placeholder="e.g., Make it funny, use emojis" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <div className="space-y-4">
                  <FormItem>
                    <FormLabel>Photo</FormLabel>
                    <FormControl>
                      <div className="w-full aspect-square bg-muted rounded-lg flex items-center justify-center relative">
                        {previewImage ? (
                          <>
                            <Image src={previewImage} layout="fill" objectFit="cover" alt="Preview" className="rounded-lg"/>
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="absolute top-2 right-2 z-10 h-6 w-6"
                              onClick={() => {
                                setPreviewImage(null);
                                form.setValue("photoDataUri", "");
                                if(fileInputRef.current) fileInputRef.current.value = "";
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button type="button" variant="ghost" className="flex-col h-auto" onClick={() => fileInputRef.current?.click()}>
                            <ImageIcon className="h-12 w-12 text-muted-foreground" />
                            <span className="mt-2 text-sm text-muted-foreground">Click to upload</span>
                          </Button>
                        )}
                        <Input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                      </div>
                    </FormControl>
                  </FormItem>
                   <FormField control={form.control} name="postText" render={({ field }) => (
                      <FormItem>
                          <FormLabel>Generated Post Text</FormLabel>
                          <FormControl><Textarea placeholder="AI generated post will appear here..." className="min-h-[160px]" {...field} /></FormControl>
                          <FormMessage />
                      </FormItem>
                   )} />
                  <Button type="button" variant="outline" size="sm" onClick={handleAiGenerate} disabled={isGenerating}>
                    {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Generate with AI
                  </Button>
                </div>
                <DialogFooter className="md:col-span-2">
                  <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                  <Button type="submit">Create Post</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {socialPosts.map((post) => (
          <Card key={post.id}>
            <CardHeader>
              <Image src={post.image} alt="Social post image" width={400} height={400} className="rounded-lg aspect-square object-cover" data-ai-hint={post.dataAiHint} />
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{post.content}</p>
            </CardContent>
            <CardFooter className="flex justify-between text-xs text-muted-foreground">
              <span>{post.platform}</span>
              <span>{post.date}</span>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
