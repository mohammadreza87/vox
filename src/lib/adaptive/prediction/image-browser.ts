import { MAX_IMAGE_BYTES, MAX_IMAGE_EDGE } from './image';
/** Explicitly user-selected file only. Resize + re-encode via canvas strips source
 * metadata; dimensions and bytes are checked again at the server/provider seams. */
export async function prepareSharedImage(file: Blob, signal?: AbortSignal): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('unsupported_image');
  if (signal?.aborted) throw new Error('cancelled');
  const bitmap = await createImageBitmap(file);
  try {
    if (signal?.aborted) throw new Error('cancelled');
    let edge = MAX_IMAGE_EDGE;
    while (edge >= 128) {
      const ratio = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('image_unavailable');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      if (signal?.aborted) throw new Error('cancelled');
      if (dataUrl.startsWith('data:image/jpeg;base64,') && atob(dataUrl.split(',')[1]).length <= MAX_IMAGE_BYTES) return dataUrl;
      edge = Math.floor(edge / 2);
    }
    throw new Error('image_too_large');
  } finally { bitmap.close(); }
}
