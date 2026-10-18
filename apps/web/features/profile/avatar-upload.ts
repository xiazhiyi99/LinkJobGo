export const AVATAR_FILE_LIMIT = 5 * 1024 * 1024;
export const AVATAR_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateAvatarFile(file: Pick<File, 'size' | 'type'>) {
  if (!AVATAR_FILE_TYPES.includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (!file.size) throw new Error('图片为空，请重新选择。');
  if (file.size > AVATAR_FILE_LIMIT) throw new Error('图片不能超过 5 MB。');
}

/** Resize and center-crop locally; only the small raster preview is saved. */
export async function prepareAvatarImage(file: File): Promise<string> {
  validateAvatarFile(file);
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    try { await image.decode(); }
    catch { throw new Error('无法读取这张图片，请选择其他图片。'); }
    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    if (!cropSize || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片尺寸过大或无效，请选择较小的图片。');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(512, cropSize);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('暂时无法处理图片，请刷新后重试。');
    context.drawImage(image, (image.naturalWidth - cropSize) / 2, (image.naturalHeight - cropSize) / 2, cropSize, cropSize, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.88);
    if (result.length > 384 * 1024) throw new Error('图片压缩后仍然过大，请选择其他图片。');
    return result;
  } finally { URL.revokeObjectURL(objectUrl); }
}
