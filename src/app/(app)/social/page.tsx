"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Network, Loader2, Image as ImageIcon, X, Pencil, Download, Copy } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateSocialMediaPost } from "@/ai/flows/generate-social-media-post";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { useSocialPosts } from "@/lib/data-hooks";
import type { SocialPost } from "@/lib/mock-data";


const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
  photo: z.any().optional(),
});

const editFormSchema = z.object({
    content: z.string().min(10, "Post content is too short.").max(280, "Post content cannot exceed 280 characters."),
});

export default function SocialPage() {
  const { data: socialPosts, updateData: setSocialPosts, loading } = useSocialPosts();
  const [isLoading, setIsLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
    },
  });
  
  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
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
  
  const handleEditClick = (post: SocialPost) => {
    setEditingPost(post);
    editForm.reset({ content: post.content });
  };
  
  const handleUpdatePost = (values: z.infer<typeof editFormSchema>) => {
    if (!editingPost) return;
    const updatedPosts = socialPosts.map((post) =>
      post.id === editingPost.id ? { ...post, ...values } : post
    );
    setSocialPosts(updatedPosts);
    toast({ title: "Post updated!" });
    setEditingPost(null);
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Post text copied!" });
  };

  const handleDownloadImage = (imageUrl: string, title: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `${title.replace(/\s+/g, '_').toLowerCase()}_post_image.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Image download started!" });
  };


  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const result = await generateSocialMediaPost({
        prompt: values.prompt,
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
    <>
    <div className="grid gap-8 md:grid-cols-3">
      <div className="md:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Network /> Create Social Post</CardTitle>
            <CardDescription>Describe the social media post you want to create.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                 <FormField
                  control={form.control}
                  name="prompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prompt</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="e.g., Create a post for the Innovators Club about our next meeting on web development. Target students interested in tech and ask them to join our Discord." 
                          className="min-h-[150px]"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormItem>
                  <FormLabel>Image (Optional)</FormLabel>
                    <div className="flex items-center gap-2">
                       <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                          <ImageIcon className="mr-2" />
                          Upload Image
                        </Button>
                      <FormControl>
                        <Input 
                          type="file" 
                          accept="image/*"
                          ref={fileInputRef} 
                          className="hidden" 
                          onChange={handleImageChange}
                        />
                       </FormControl>
                    </div>
                </FormItem>

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
        {loading ? <p>Loading...</p> : 
          socialPosts.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {socialPosts.map((post) => (
              <Card key={post.id} className="flex flex-col">
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle>{post.platform}</CardTitle>
                            <CardDescription>{post.date}</CardDescription>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => handleEditClick(post)}>
                            <Pencil className="h-4 w-4" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 flex-grow">
                  <Image src={post.image} alt="Social post image" width={400} height={400} className="rounded-lg aspect-square object-cover" data-ai-hint={post.dataAiHint} />
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{post.content}</p>
                </CardContent>
                <CardFooter className="flex gap-2">
                    <Button variant="outline" className="w-full" onClick={() => handleCopyText(post.content)}>
                        <Copy className="mr-2"/> Copy Text
                    </Button>
                    <Button className="w-full" onClick={() => handleDownloadImage(post.image, post.platform)}>
                       <Download className="mr-2"/> Download Image
                    </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
             <Card className="flex items-center justify-center py-12 md:col-span-2">
              <CardContent>
                <p className="text-muted-foreground">No social posts yet. Create one to get started!</p>
              </CardContent>
            </Card>
        )}
      </div>
    </div>
    {editingPost && (
        <Dialog open={!!editingPost} onOpenChange={() => setEditingPost(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Social Media Post</DialogTitle>
            </DialogHeader>
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(handleUpdatePost)} className="space-y-4">
                 <FormField
                  control={editForm.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Post Text</FormLabel>
                      <FormControl>
                        <Textarea className="min-h-[150px]" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => setEditingPost(null)}>Cancel</Button>
                    <Button type="submit">Save Changes</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
    )}
    </>
  );
}
