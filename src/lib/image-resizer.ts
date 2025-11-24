
import imageCompression from 'browser-image-compression';

export async function resizeImage(file: File): Promise<string> {
  const options = {
    maxSizeMB: 0.1, // Max file size in MB
    maxWidthOrHeight: 800, // Max width or height
    useWebWorker: true,
  };

  try {
    const compressedFile = await imageCompression(file, options);
    const dataUrl = await imageCompression.getDataUrlFromFile(compressedFile);
    return dataUrl;
  } catch (error) {
    console.error('Image compression failed, falling back to original file:', error);
    // Fallback to reading the original file if compression fails
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Failed to read file as data URL.'));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
  }
}
