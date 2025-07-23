"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Network, Loader2, Image as ImageIcon, X } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { socialPosts as initialSocialPosts } from "@/lib/mock-data";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateSocialMediaPost } from "@/ai/flows/generate-social-media-post";
import { useToast } from "@/hooks/use-toast";

type SocialPost = (typeof initialSocialPosts)[0];

const formSchema = z.object({
  clubName: z.string().min(1, "Club name is required."),
  activityDescription: z.string().min(1, "Activity description is required."),
  targetAudience: z.string().min(1, "Target audience is required."),
  callToAction: z.string().min(1, "Call to action is required."),
  imageCaptionPreferences: z.string().optional(),
  photo: z.any().optional(),
});

export default function SocialPage() {
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>(initialSocialPosts);
  const [isLoading, setIsLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      clubName: "The Innovators Club",
      activityDescription: "",
      targetAudience: "Students interested in tech",
      callToAction: "Join our Discord!",
      imageCaptionPreferences: "",
    },
  });

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
        form.setValue("photo", reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const result = await generateSocialMediaPost({
        ...values,
        photoDataUri: form.getValues("photo"),
      });
      const newPost: SocialPost = {
        id: socialPosts.length + 1,
        platform: "AI Generated",
        content: result.postText,
        image: previewImage || "https://placehold.co/400x400.png",
        dataAiHint: "tech club",
        author: "AI Assistant",
        date: new Date().toLocaleDateString(),
      };
      setSocialPosts([newPost, ...socialPosts]);
      toast({ title: "Social media post generated successfully!" });
      form.reset();
      setPreviewImage(null);
      if(fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate social media post.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-8 md:grid-cols-3">
      <div className="md:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Network /> Create Social Post</CardTitle>
            <CardDescription>Generate a social media post with AI.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                 <FormField
                  control={form.control}
                  name="activityDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Activity / Event</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Describe the activity or event." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="callToAction"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Call to Action</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Sign up now!" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="photo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Image</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                           <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                              <ImageIcon className="mr-2" />
                              Upload Image
                            </Button>
                          <Input 
                            type="file" 
                            accept="image/*"
                            ref={fileInputRef} 
                            className="hidden" 
                            onChange={handleImageChange}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {previewImage && (
                  <div className="relative">
                    <Image src={previewImage} alt="Image preview" width={200} height={200} className="rounded-md" />
                     <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => {
                       setPreviewImage(null);
                       form.setValue("photo", null)
                       if(fileInputRef.current) fileInputRef.current.value = "";
                     }}>
                        <X className="h-4 w-4"/>
                      </Button>
                  </div>
                )}
               
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? <Loader2 className="animate-spin" /> : "Generate Post"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
       <div className="md:col-span-2">
        <h2 className="text-2xl font-bold mb-4">Recent Posts</h2>
        <div className="grid gap-4 md:grid-cols-2">
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
    </div>
  );
}
