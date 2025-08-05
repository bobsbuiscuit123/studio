
import imageCompression from 'browser-image-compression';

export async function resizeImage(file: File): Promise<string> {
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
