
"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Upload, ThumbsUp, Download, X, Trash2, Check, ShieldQuestion, Loader2 } from "lucide-react";

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
import { resizeImage } from "@/lib/image-resizer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MAX_GALLERY_IMAGES = 20;
const isNativeApp = Capacitor.isNativePlatform();

const createGalleryImageId = (offset: number = 0) =>
  Date.now() * 1000 + offset + Math.floor(Math.random() * 1000);

const uploadFormSchema = z.object({
  alt: z.string().optional(),
  images: z.array(z.custom<File>()).min(1, "At least one image is required."),
});

export default function GalleryPage() {
  const {
    data: images,
    updateData: setImages,
    updateDataAsync: setImagesAsync,
    error,
    loading,
    refreshData,
  } = useGalleryImages();
  const { canEditContent } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<z.infer<typeof uploadFormSchema>>({
    resolver: zodResolver(uploadFormSchema),
    defaultValues: { alt: "", images: [] },
  });
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const currentFiles = form.getValues("images") || [];
      const newFiles = Array.from(files);
      form.setValue("images", [...currentFiles, ...newFiles]);
      
      const newPreviews: string[] = [];
      Array.from(files).forEach(file => {
          newPreviews.push(URL.createObjectURL(file));
      });
      setPreviewImages(prev => [...prev, ...newPreviews]);
    }
  };

  const addImages = (newFiles: File[], newPreviews: string[]) => {
    const currentFiles = form.getValues("images") || [];
    form.setValue("images", [...currentFiles, ...newFiles], { shouldValidate: true });
    setPreviewImages(prev => [...prev, ...newPreviews]);
  };

  const handleNativeImagePick = async (source: CameraSource) => {
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source,
      });

      if (!photo.dataUrl) {
        return;
      }

      const fileName = `gallery-${Date.now()}.${photo.format || "jpeg"}`;
      const file = dataUrlToFile(photo.dataUrl, fileName);
      addImages([file], [photo.dataUrl]);
    } catch (error) {
      console.error("Native image picker failed", error);
      toast({
        title: "Couldn't open camera",
        description: "Please try again or choose an image from your library.",
        variant: "destructive",
      });
    }
  };
  
  const removePreviewImage = (index: number) => {
    const updatedFiles = [...(form.getValues("images") || [])];
    updatedFiles.splice(index, 1);
    form.setValue("images", updatedFiles);

    const updatedPreviews = [...previewImages];
    revokePreviewUrl(updatedPreviews[index]);
    updatedPreviews.splice(index, 1);
    setPreviewImages(updatedPreviews);
  };

  const handleUpload = async (values: z.infer<typeof uploadFormSchema>) => {
    if (!user) return;
    setIsUploading(true);
    
    try {
        const compressedImageSrcs = await Promise.all(
            values.images.map(file => resizeImage(file))
        );

        // Validate that all returned sources are valid data URIs
        const validImageSrcs = compressedImageSrcs.filter(src => typeof src === 'string' && src.startsWith('data:image/'));

        if (validImageSrcs.length !== compressedImageSrcs.length) {
            toast({
                title: "Some images failed to process",
                description: "Not all images could be processed correctly. Please try them again.",
                variant: "destructive"
            });
        }
        
        if (validImageSrcs.length === 0) {
            toast({ title: "Upload Failed", description: "No valid images could be processed.", variant: "destructive" });
            setIsUploading(false);
            return;
        }

        const newStatus = canEditContent ? 'approved' : 'pending';

        const newImages: GalleryImage[] = validImageSrcs.map((imgSrc, index) => ({
            id: createGalleryImageId(index),
            src: imgSrc,
            alt: values.alt || "User uploaded image",
            author: user.name,
            date: new Date().toLocaleDateString(),
            likes: 0,
            likedBy: [],
            status: newStatus,
            read: !canEditContent,
        }));
        
        const saved = await setImagesAsync(prevImages => [...newImages, ...prevImages].slice(0, MAX_GALLERY_IMAGES));
        if (!saved) {
            toast({
                title: "Upload Failed",
                description: "The images were processed, but they were not saved to your organization. Please try again.",
                variant: "destructive",
            });
            setIsUploading(false);
            return;
        }

        toast({ 
            title: newStatus === 'approved' ? "Images displayed successfully!" : "Images submitted for approval!",
            description: newStatus === 'pending' ? "An admin will review your submission shortly." : `${validImageSrcs.length} images were uploaded.`,
            duration: 7000
        });

        form.reset();
        previewImages.forEach(revokePreviewUrl);
        setPreviewImages([]);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    } catch (error) {
        console.error("Image processing error:", error);
        toast({ title: "Upload Failed", description: "There was an error processing your images.", variant: "destructive" });
    } finally {
        setIsUploading(false);
    }
  };

  const handleLike = (imageId: number) => {
    if (!user?.email) return;
    void setImagesAsync(prevImages =>
      prevImages.map((image) => {
        if (image.id === imageId) {
          const likedBy = Array.isArray(image.likedBy) ? image.likedBy : [];
          const newLikedState = !likedBy.includes(user.email);
          const nextLikedBy = newLikedState
            ? [...likedBy, user.email]
            : likedBy.filter(email => email !== user.email);
          return {
            ...image,
            likes: nextLikedBy.length,
            likedBy: nextLikedBy,
          };
        }
        return image;
      })
    ).then(saved => {
      if (!saved) {
        toast({
          title: "Like failed",
          description: "Your reaction was not saved. Please try again.",
          variant: "destructive",
        });
      }
    });
  };
  
  const handleDownload = async (imageSrc: string, imageName: string) => {
    if (isNativeApp) {
      try {
        const { base64Data, mimeType } = await imageSourceToBase64(imageSrc);
        const extension = mimeTypeToExtension(mimeType);
        const path = `gallery/${Date.now()}-${imageName.replace(/\.[^.]+$/, "")}.${extension}`;
        const file = await Filesystem.writeFile({
          path,
          data: base64Data,
          directory: Directory.Cache,
          recursive: true,
        });

        await Share.share({
          title: imageName,
          text: "Save or share this gallery image",
          url: file.uri,
          dialogTitle: "Save or share image",
        });
      } catch (error) {
        console.error("Native image download failed", error);
        toast({
          title: "Couldn't open save options",
          description: "Please try again.",
          variant: "destructive",
        });
      }
      return;
    }

    const link = document.createElement("a");
    link.href = imageSrc;
    link.download = imageName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handleDelete = async (imageId: number) => {
    const imageToDelete = images.find(img => img.id === imageId);
    const saved = await setImagesAsync(prevImages => prevImages.filter(img => img.id !== imageId));
    if (!saved) {
      toast({
        title: "Delete failed",
        description: "The image could not be removed from your organization. Please try again.",
        variant: "destructive",
      });
      setDeletingImageId(null);
      return;
    }
    if (imageToDelete?.src.startsWith('blob:')) {
        URL.revokeObjectURL(imageToDelete.src);
    }
    toast({ title: "Image deleted successfully" });
    setDeletingImageId(null);
  };
  
  const handleApproval = async (imageId: number, newStatus: 'approved' | 'rejected') => {
    if (newStatus === 'approved') {
      const saved = await setImagesAsync(prevImages =>
        prevImages.map(img =>
          img.id === imageId
            ? { ...img, status: 'approved' as const, read: false }
            : img
        )
      );
      if (!saved) {
        toast({
          title: "Approval failed",
          description: "The image approval was not saved. Please try again.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Image approved!" });
    } else { // 'rejected'
      await handleDelete(imageId); // Use the same delete logic to ensure blob cleanup
    }
  };
  
  const isValidImage = (image: GalleryImage) => typeof image.src === 'string' && image.src.startsWith('data:image/');

  const approvedImages = images.filter(img => img.status === 'approved' && isValidImage(img));
  const pendingImages = images.filter(img => img.status === 'pending' && isValidImage(img));

  return (
    <div className="app-page-shell">
      <div className="app-page-scroll">
        <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Upload New Images</CardTitle>
          <CardDescription>Add photos to the club's gallery. {canEditContent ? "" : "Your photo will be submitted for approval."}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(handleUpload)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="alt">Image Description (Optional)</label>
              <Input id="alt" {...form.register("alt")} placeholder="e.g., Team photos at the 2024 regional competition." />
              {form.formState.errors.alt && <p className="text-red-500 text-sm">{form.formState.errors.alt.message}</p>}
            </div>
             <div className="space-y-2">
                <label>Image Files</label>
                <div>
                    {isNativeApp ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="outline">
                            <Upload className="mr-2" />
                            Add Images
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => handleNativeImagePick(CameraSource.Photos)}>
                            Photo Library
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleNativeImagePick(CameraSource.Camera)}>
                            Take Photo
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                            Choose Files
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="mr-2" />
                        Choose Images
                      </Button>
                    )}
                    <Input
                    type="file"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    multiple
                    />
                    {form.formState.errors.images && <p className="text-red-500 text-sm mt-2">{form.formState.errors.images.message}</p>}
                </div>
             </div>
              {previewImages.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {previewImages.map((image, index) => (
                           <div key={index} className="relative">
                                <Image src={image} alt={`Preview ${index}`} width={150} height={150} className="rounded-md aspect-square object-cover" />
                                <Button
                                    variant="destructive"
                                    size="icon"
                                    className="absolute top-1 right-1 h-6 w-6"
                                    onClick={() => removePreviewImage(index)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                      ))}
                  </div>
              )}
            <Button type="submit" className="w-full md:w-auto" disabled={isUploading}>
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 animate-spin" /> Uploading...
                </>
              ) : (
                `Upload ${previewImages.length > 0 ? previewImages.length : ''} Image${previewImages.length !== 1 ? 's' : ''}`
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      
      {canEditContent && pendingImages.length > 0 && (
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
        <h2 className="text-2xl font-bold mb-4">Group Gallery</h2>
        {loading ? (
          <p>Loading gallery...</p>
        ) : error && approvedImages.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed rounded-lg space-y-3">
             <p className="text-muted-foreground">{error}</p>
             <Button variant="outline" onClick={() => void refreshData()}>
               Try again
             </Button>
          </div>
        ) : approvedImages.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {approvedImages.map((image) => {
              const likedBy = Array.isArray(image.likedBy) ? image.likedBy : [];
              const likedByCurrentUser = Boolean(user?.email && likedBy.includes(user.email));
              const likeCount = likedBy.length > 0 ? likedBy.length : Math.max(0, image.likes || 0);
              return (
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
                      variant={likedByCurrentUser ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleLike(image.id)}
                      className="flex items-center gap-2"
                    >
                      <ThumbsUp className="h-4 w-4" /> {likeCount}
                    </Button>
                     <div className="flex gap-1">
                        <Button variant="outline" size="icon" onClick={() => handleDownload(image.src, `gallery-image-${image.id}.webp`)}>
                            <Download className="h-4 w-4" />
                        </Button>
                        {canEditContent && (
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
            )})}
          </div>
        ) : (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
             <p className="text-muted-foreground">The gallery is empty.</p>
             <p className="text-muted-foreground">Upload an image to get started!</p>
          </div>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}

function revokePreviewUrl(url?: string) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [meta, content = ""] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], fileName, { type: mimeType });
}

async function imageSourceToBase64(imageSrc: string) {
  if (imageSrc.startsWith("data:")) {
    const [meta, base64Data = ""] = imageSrc.split(",");
    const mimeType = meta.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
    return { base64Data, mimeType };
  }

  const response = await fetch(imageSrc);
  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  const [meta, base64Data = ""] = dataUrl.split(",");
  const mimeType = meta.match(/data:(.*?);base64/)?.[1] || blob.type || "image/jpeg";
  return { base64Data, mimeType };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to data URL."));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read blob."));
    reader.readAsDataURL(blob);
  });
}

function mimeTypeToExtension(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("heic")) return "heic";
  return "jpg";
}
