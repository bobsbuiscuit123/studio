import imageCompression from 'browser-image-compression';

export type CompressImageOptions = {
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  initialQuality?: number;
  fileType?: string;
};

const replaceFileExtension = (fileName: string, extension: string) => {
  const normalizedExtension = extension.replace(/^\./, '');
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'image';
  return `${baseName}.${normalizedExtension}`;
};

const extensionFromMimeType = (mimeType: string) => {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('heic')) return 'heic';
  if (mimeType.includes('heif')) return 'heif';
  return 'jpg';
};

export async function compressImageFile(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  const mergedOptions = {
    maxSizeMB: options.maxSizeMB ?? 0.03,
    maxWidthOrHeight: options.maxWidthOrHeight ?? 480,
    initialQuality: options.initialQuality ?? 0.65,
    fileType: options.fileType ?? 'image/webp',
    useWebWorker: true,
  };

  try {
    const compressedFile = await imageCompression(file, mergedOptions);
    if (compressedFile instanceof File) {
      return compressedFile;
    }

    return new File(
      [compressedFile],
      replaceFileExtension(file.name, extensionFromMimeType(mergedOptions.fileType)),
      { type: mergedOptions.fileType }
    );
  } catch (error) {
    console.error('Image compression failed:', error);
    throw new Error('Image compression failed. Please try a smaller image.');
  }
}

export async function resizeImage(file: File): Promise<string> {
  try {
    const compressedFile = await compressImageFile(file);
    const dataUrl = await imageCompression.getDataUrlFromFile(compressedFile);
    return dataUrl;
  } catch (error) {
    console.error('Image compression failed:', error);
    throw new Error('Image compression failed. Please try a smaller image.');
  }
}
