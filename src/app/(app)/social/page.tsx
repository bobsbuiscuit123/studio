"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Network, Loader2, Image as ImageIcon, X, Pencil, Download, Copy, Trash2 } from "lucide-react";
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
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateSocialMediaPost } from "@/ai/flows/generate-social-media-post";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { useSocialPosts } from "@/lib/data-hooks";
import type { SocialPost } from "@/lib/mock-data";


const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
  photos: z.array(z.string()).optional(),
});

const editFormSchema = z.object({
    title: z.string().min(3, "Title is too short."),
    content: z.string().min(10, "Post content is too short.").max(280, "Post content cannot exceed 280 characters."),
});

export default function SocialPage() {
  const { data: socialPosts, updateData: setSocialPosts, loading } = useSocialPosts();
  const [isLoading, setIsLoading] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [deletingPost, setDeletingPost] = useState<SocialPost | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
      photos: [],
    },
  });
  
  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
  });

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newImages: string[] = [];
      const fileReaders: FileReader[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        fileReaders.push(reader);
        reader.onloadend = () => {
          newImages.push(reader.result as string);
          if (newImages.length === files.length) {
            const allImages = [...previewImages, ...newImages];
            setPreviewImages(allImages);
            form.setValue("photos", allImages);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removePreviewImage = (index: number) => {
    const newImages = [...previewImages];
    newImages.splice(index, 1);
    setPreviewImages(newImages);
    form.setValue("photos", newImages);
  }
  
  const handleEditClick = (post: SocialPost) => {
    setEditingPost(post);
    editForm.reset({ title: post.title, content: post.content });
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
  
  const handleDeletePost = () => {
    if (!deletingPost) return;
    const updatedPosts = socialPosts.filter((post) => post.id !== deletingPost.id);
    setSocialPosts(updatedPosts);
    toast({ title: "Post deleted successfully!" });
    setDeletingPost(null);
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
        photoDataUris: form.getValues("photos"),
      });
      const newPost: SocialPost = {
        id: socialPosts.length + 1,
        title: result.title,
        content: result.postText,
        images: previewImages.length > 0 ? previewImages : ["https://placehold.co/400x400.png"],
        dataAiHint: "tech club",
        author: "AI Assistant",
        date: new Date().toLocaleDateString(),
      };
      setSocialPosts([newPost, ...socialPosts]);
      toast({ title: "Social media post generated successfully!" });
      form.reset();
      setPreviewImages([]);
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
                  <FormLabel>Images (Optional)</FormLabel>
                    <div className="flex items-center gap-2">
                       <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                          <ImageIcon className="mr-2" />
                          Upload Images
                        </Button>
                      <FormControl>
                        <Input 
                          type="file" 
                          accept="image/*"
                          ref={fileInputRef} 
                          className="hidden" 
                          onChange={handleImageChange}
                          multiple
                        />
                       </FormControl>
                    </div>
                </FormItem>

                {previewImages.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {previewImages.map((image, index) => (
                      <div key={index} className="relative">
                        <Image src={image} alt={`Preview ${index + 1}`} width={200} height={200} className="rounded-md w-full h-auto aspect-square object-cover" />
                         <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => removePreviewImage(index)}>
                            <X className="h-4 w-4"/>
                          </Button>
                      </div>
                    ))}
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
                            <CardTitle>{post.title}</CardTitle>
                            <CardDescription>{post.date}</CardDescription>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEditClick(post)}>
                                <Pencil className="h-4 w-4" />
                            </Button>
                             <AlertDialog onOpenChange={() => setDeletingPost(null)}>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" onClick={() => setDeletingPost(post)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This action cannot be undone. This will permanently delete this social media post.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDeletePost}>Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 flex-grow">
                  {post.images && post.images.length > 0 && (
                    <Carousel className="w-full max-w-xs mx-auto">
                      <CarouselContent>
                        {post.images.map((image, index) => (
                          <CarouselItem key={index}>
                             <Image src={image} alt={`Social post image ${index+1}`} width={400} height={400} className="rounded-lg aspect-square object-cover" data-ai-hint={post.dataAiHint} />
                          </CarouselItem>
                        ))}
                      </CarouselContent>
                      {post.images.length > 1 && (
                        <>
                          <CarouselPrevious />
                          <CarouselNext />
                        </>
                      )}
                    </Carousel>
                  )}

                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{post.content}</p>
                </CardContent>
                <CardFooter className="flex gap-2">
                    <Button variant="outline" className="w-full" onClick={() => handleCopyText(post.content)}>
                        <Copy className="mr-2"/> Copy Text
                    </Button>
                    {post.images && post.images.length === 1 && (
                      <Button className="w-full" onClick={() => handleDownloadImage(post.images[0], post.title)}>
                         <Download className="mr-2"/> Download Image
                      </Button>
                    )}
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
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
