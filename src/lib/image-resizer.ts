
import imageCompression from 'browser-image-compression';

export async function resizeImage(file: File): Promise<string> {
  // This function is no longer used to generate data URLs for storage,
  // but it can be kept for other potential uses, like creating thumbnails.
  // For now, it's unused in the main image upload flow to prevent storage issues.
  console.log(`Original file size: ${file.size / 1024 / 1024} MB`);
  const options = {
    maxSizeMB: 0.1, // Max file size in MB
    maxWidthOrHeight: 800, // Max width or height
    useWebWorker: true,
  };

  try {
    const compressedFile = await imageCompression(file, options);
    console.log(`Compressed file size: ${compressedFile.size / 1024 / 1024} MB`);
    const dataUrl = await imageCompression.getDataUrlFromFile(compressedFile);
    return dataUrl;
  } catch (error) {
    console.error('Image compression failed:', error);
    // Fallback to reading the original file if compression fails
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            resolve(reader.result as string);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
  }
}

    