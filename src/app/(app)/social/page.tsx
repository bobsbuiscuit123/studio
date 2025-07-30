
"use client";

import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Network, Loader2, Image as ImageIcon, X, Pencil, ThumbsUp, MessageCircle, Trash2 } from "lucide-react";
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
import { useSocialPosts, useCurrentUserRole, useCurrentUser } from "@/lib/data-hooks";
import type { SocialPost, Comment } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";


const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
  photos: z.array(z.string()).optional(),
});

const editFormSchema = z.object({
    title: z.string().min(3, "Title is too short."),
    content: z.string().min(10, "Post content is too short.").max(280, "Post content cannot exceed 280 characters."),
});

const commentFormSchema = z.object({
    comment: z.string().min(1, "Comment cannot be empty."),
});

export default function SocialPage() {
  const { data: socialPosts, updateData: setSocialPosts, loading } = useSocialPosts();
  const [isLoading, setIsLoading] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [activeCommentPostId, setActiveCommentPostId] = useState<number | null>(null);
  const { isOwner } = useCurrentUserRole();
  const { user } = useCurrentUser();

  useEffect(() => {
    // Mark all posts as read when the page is viewed
    if (socialPosts && socialPosts.some(p => !p.read)) {
        const updatedPosts = socialPosts.map(p => ({ ...p, read: true }));
        setSocialPosts(updatedPosts);
    }
  }, [socialPosts, setSocialPosts]);

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

  const commentForm = useForm<z.infer<typeof commentFormSchema>>({
    resolver: zodResolver(commentFormSchema),
    defaultValues: {
        comment: "",
    },
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
  
  const handleDeletePost = (postId: number) => {
    const updatedPosts = socialPosts.filter((post) => post.id !== postId);
    setSocialPosts(updatedPosts);
    toast({ title: "Post deleted successfully!" });
    setDeletingPostId(null);
  };

  const handleLike = (postId: number) => {
    const updatedPosts = socialPosts.map((post) => {
        if (post.id === postId) {
            const newLikedState = !post.liked;
            return {
                ...post,
                likes: newLikedState ? (post.likes || 0) + 1 : (post.likes || 1) - 1,
                liked: newLikedState,
            };
        }
        return post;
    });
    setSocialPosts(updatedPosts);
  };

  const handleAddComment = (postId: number, values: z.infer<typeof commentFormSchema>) => {
    const newComment: Comment = {
      author: user?.name || "Club Member",
      text: values.comment,
    };
    const updatedPosts = socialPosts.map((post) =>
      post.id === postId ? { ...post, comments: [...(post.comments || []), newComment] } : post
    );
    setSocialPosts(updatedPosts);
    commentForm.reset();
  };

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const result = await generateSocialMediaPost({
        prompt: values.prompt,
        photoDataUris: form.getValues("photos"),
      });
      const newPost: SocialPost = {
        id: socialPosts.length > 0 ? Math.max(...socialPosts.map(p => p.id)) + 1 : 1,
        title: result.title,
        content: result.postText,
        images: previewImages.length > 0 ? previewImages : [],
        dataAiHint: "tech club",
        author: user?.name || "AI Assistant",
        date: new Date().toLocaleDateString(),
        likes: 0,
        liked: false,
        comments: [],
        read: false,
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
      {isOwner && (
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
      )}
       <div className={isOwner ? "md:col-span-2" : "md:col-span-3"}>
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
                            <CardDescription>{post.author} - {post.date}</CardDescription>
                        </div>
                        {isOwner && (
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => handleEditClick(post)}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <AlertDialog open={deletingPostId === post.id} onOpenChange={(open) => !open && setDeletingPostId(null)}>
                                    <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => setDeletingPostId(post.id)}>
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
                                        <AlertDialogAction onClick={() => handleDeletePost(post.id)}>Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
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
                <CardFooter className="flex flex-col items-start gap-2 p-4">
                     <Separator className="my-2" />
                     <div className="flex justify-start items-center w-full gap-4">
                         <Button variant={post.liked ? "default" : "outline"} size="sm" onClick={() => handleLike(post.id)} className="flex items-center gap-2">
                            <ThumbsUp className="h-4 w-4"/> {post.likes || 0}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setActiveCommentPostId(activeCommentPostId === post.id ? null : post.id)} className="flex items-center gap-2">
                            <MessageCircle className="h-4 w-4"/> {post.comments?.length || 0}
                        </Button>
                     </div>
                    {activeCommentPostId === post.id && (
                        <div className="w-full pt-4">
                            <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                                {(post.comments || []).map((comment, index) => (
                                    <div key={index} className="text-sm p-3 bg-muted rounded-lg">
                                        <p className="font-semibold">{comment.author}</p>
                                        <p className="text-muted-foreground">{comment.text}</p>
                                    </div>
                                ))}
                                 {(post.comments || []).length === 0 && (
                                    <p className="text-sm text-muted-foreground text-center py-4">No comments yet.</p>
                                )}
                            </div>
                            <Form {...commentForm}>
                                <form onSubmit={commentForm.handleSubmit((data) => handleAddComment(post.id, data))} className="flex gap-2">
                                    <FormField
                                    control={commentForm.control}
                                    name="comment"
                                    render={({ field }) => (
                                        <FormItem className="flex-grow">
                                            <FormControl>
                                                <Input placeholder="Add a comment..." {...field} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                    />
                                    <Button type="submit" size="sm">Post</Button>
                                </form>
                            </Form>
                        </div>
                    )}
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
             <Card className="flex items-center justify-center py-12 md:col-span-2">
              <CardContent>
                <p className="text-muted-foreground">No social posts yet. {isOwner && "Create one to get started!"}</p>
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
