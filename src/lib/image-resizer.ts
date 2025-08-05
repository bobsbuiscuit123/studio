import imageCompression from 'browser-image-compression';

export async function resizeImage(file: File): Promise<string> {
  const options = {
    maxSizeMB: 0.5, // Max file size in MB
    maxWidthOrHeight: 1024, // Max width or height
    useWebWorker: true,
    fileType: 'image/webp',
  };

  try {
    const compressedFile = await imageCompression(file, options);
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
