
import imageCompression from 'browser-image-compression';

export async function resizeImage(file: File): Promise<string> {
  const options = {
    maxSizeMB: 0.03,
    maxWidthOrHeight: 480,
    initialQuality: 0.65,
    fileType: 'image/webp',
    useWebWorker: true,
  };

  try {
    const compressedFile = await imageCompression(file, options);
    const dataUrl = await imageCompression.getDataUrlFromFile(compressedFile);
    return dataUrl;
  } catch (error) {
    console.error('Image compression failed:', error);
    throw new Error('Image compression failed. Please try a smaller image.');
  }
}
