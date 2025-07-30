
"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Upload, ThumbsUp, Download, X, Trash2, Check, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useGalleryImages, useCurrentUserRole, useCurrentUser } from "@/lib/data-hooks";
import type { GalleryImage } from "@/lib/mock-data";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

const uploadFormSchema = z.object({
  alt: z.string().optional(),
  image: z.any().refine(files => files?.length > 0, "Image is required."),
});

export default function GalleryPage() {
  const { data: images, updateData: setImages, loading } = useGalleryImages();
  const { role } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null);

  const form = useForm<z.infer<typeof uploadFormSchema>>({
    resolver: zodResolver(uploadFormSchema),
    defaultValues: { alt: "" },
  });
  
  const isOwner = role && role !== 'Member';

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
        form.setValue("image", reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = (values: z.infer<typeof uploadFormSchema>) => {
    if (!user) return;
    
    const newStatus = isOwner ? 'approved' : 'pending';
    
    const newImage: GalleryImage = {
      id: images.length > 0 ? Math.max(...images.map(i => i.id)) + 1 : 1,
      src: values.image,
      alt: values.alt || "",
      author: user.name,
      date: new Date().toLocaleDateString(),
      likes: 0,
      liked: false,
      status: newStatus,
    };

    setImages([newImage, ...images]);
    toast({ 
      title: newStatus === 'approved' ? "Image uploaded successfully!" : "Image submitted for approval!",
      description: newStatus === 'pending' ? "An admin will review your submission shortly." : undefined,
    });
    form.reset();
    setPreviewImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleLike = (imageId: number) => {
    const updatedImages = images.map((image) => {
      if (image.id === imageId) {
        const newLikedState = !image.liked;
        return {
          ...image,
          likes: newLikedState ? image.likes + 1 : image.likes - 1,
          liked: newLikedState,
        };
      }
      return image;
    });
    setImages(updatedImages);
  };
  
  const handleDownload = (imageSrc: string, imageName: string) => {
    const link = document.createElement("a");
    link.href = imageSrc;
    link.download = imageName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = (imageId: number) => {
    setImages(images.filter(img => img.id !== imageId));
    toast({ title: "Image deleted successfully" });
    setDeletingImageId(null);
  };
  
  const handleApproval = (imageId: number, newStatus: 'approved' | 'rejected') => {
    if (newStatus === 'approved') {
      const updatedImages = images.map(img => 
        img.id === imageId ? { ...img, status: 'approved' } : img
      );
      setImages(updatedImages);
      toast({ title: "Image approved!" });
    } else { // 'rejected'
      setImages(images.filter(img => img.id !== imageId));
      toast({ title: "Image rejected and removed." });
    }
  };
  
  const approvedImages = images.filter(img => img.status === 'approved');
  const pendingImages = images.filter(img => img.status === 'pending');

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Upload a New Image</CardTitle>
          <CardDescription>Add a photo to the club's gallery. {isOwner ? "" : "Your photo will be submitted for approval."}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(handleUpload)} className="grid md:grid-cols-3 gap-4 items-end">
            <div className="md:col-span-1 space-y-2">
              <label htmlFor="alt">Image Description (Optional)</label>
              <Input id="alt" {...form.register("alt")} placeholder="e.g., Team photo at the 2024 regional competition." />
              {form.formState.errors.alt && <p className="text-red-500 text-sm">{form.formState.errors.alt.message}</p>}
            </div>
             <div className="flex items-center gap-4">
               <div className="space-y-2">
                  <label>Image File</label>
                  <div>
                      <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="mr-2" />
                      Choose Image
                      </Button>
                      <Input
                      type="file"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/*"
                      />
                      {form.formState.errors.image && <p className="text-red-500 text-sm">{form.formState.errors.image.message}</p>}
                  </div>
               </div>
              {previewImage && (
                  <div className="relative">
                      <Image src={previewImage} alt="Preview" width={100} height={100} className="rounded-md aspect-square object-cover" />
                      <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => {
                              setPreviewImage(null);
                              form.setValue("image", null);
                              if(fileInputRef.current) fileInputRef.current.value = "";
                          }}
                      >
                          <X className="h-4 w-4" />
                      </Button>
                  </div>
              )}
             </div>
            <Button type="submit" className="w-full md:w-auto">Upload Image</Button>
          </form>
        </CardContent>
      </Card>
      
      {isOwner && pendingImages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldQuestion /> Pending Approvals</CardTitle>
            <CardDescription>These images were submitted by members and are waiting for your review.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {pendingImages.map((image) => (
                <Card key={`pending-${image.id}`} className="overflow-hidden flex flex-col">
                  <CardContent className="p-0 relative">
                    <Image
                      src={image.src}
                      alt={image.alt}
                      width={400}
                      height={400}
                      className="aspect-square object-cover w-full"
                    />
                     <Badge className="absolute top-2 left-2">Pending</Badge>
                  </CardContent>
                  <div className="p-4 flex flex-col flex-grow">
                    <p className="font-semibold text-sm">{image.alt || "No description"}</p>
                    <p className="text-xs text-muted-foreground">
                      Uploaded by {image.author} on {image.date}
                    </p>
                  </div>
                   <CardFooter className="flex gap-2">
                      <Button size="sm" className="w-full" onClick={() => handleApproval(image.id, 'approved')}><Check className="mr-2"/> Approve</Button>
                      <Button size="sm" variant="destructive" className="w-full" onClick={() => handleApproval(image.id, 'rejected')}><X className="mr-2"/> Deny</Button>
                   </CardFooter>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-2xl font-bold mb-4">Club Gallery</h2>
        {loading ? (
          <p>Loading gallery...</p>
        ) : approvedImages.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {approvedImages.map((image) => (
              <Card key={image.id} className="overflow-hidden flex flex-col">
                <CardContent className="p-0">
                  <Image
                    src={image.src}
                    alt={image.alt}
                    width={400}
                    height={400}
                    className="aspect-square object-cover w-full"
                  />
                </CardContent>
                <div className="p-4 flex flex-col flex-grow">
                  <p className="font-semibold text-sm">{image.alt}</p>
                  <p className="text-xs text-muted-foreground">
                    Uploaded by {image.author} on {image.date}
                  </p>
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <Button
                      variant={image.liked ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleLike(image.id)}
                      className="flex items-center gap-2"
                    >
                      <ThumbsUp className="h-4 w-4" /> {image.likes}
                    </Button>
                     <div className="flex gap-1">
                        <Button variant="outline" size="icon" onClick={() => handleDownload(image.src, `gallery-image-${image.id}.png`)}>
                            <Download className="h-4 w-4" />
                        </Button>
                        {isOwner && (
                            <AlertDialog open={deletingImageId === image.id} onOpenChange={(open) => !open && setDeletingImageId(null)}>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="icon" onClick={() => setDeletingImageId(image.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This action cannot be undone. This will permanently delete this image from the gallery.
                                    </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(image.id)}>Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
             <p className="text-muted-foreground">The gallery is empty.</p>
             <p className="text-muted-foreground">Upload an image to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
}
