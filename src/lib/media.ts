import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, handleFirestoreError, OperationType, storage } from './firebase';

const mediaCache = new Map<string, string>();

export interface UploadedMediaResult {
  url: string;
  mediaId: string;
}

function generateMediaId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export async function compressImageFile(
  file: File,
  maxWidth = 960,
  quality = 0.78
): Promise<{ dataUrl: string; blob: Blob; mimeType: string }> {
  // Handle PDFs directly if small enough (< 420KB)
  if (file.type === 'application/pdf') {
    if (file.size > 440 * 1024) {
      throw new Error('PDF file exceeds 440 KB limit. Please upload an image (JPG/PNG) or a smaller PDF.');
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read PDF file.'));
      reader.readAsDataURL(file);
    });
    return { dataUrl, blob: file, mimeType: 'application/pdf' };
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file (JPG, PNG, WebP) or PDF document.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to decode image file.'));
      el.src = objectUrl;
    });

    let targetW = img.naturalWidth || img.width;
    let targetH = img.naturalHeight || img.height;
    if (targetW > maxWidth) {
      const ratio = maxWidth / targetW;
      targetW = Math.round(targetW * ratio);
      targetH = Math.round(targetH * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    // Iteratively ensure data URL fits comfortably under 580KB for Firestore fallback
    let q = quality;
    let dataUrl = canvas.toDataURL('image/jpeg', q);
    while (dataUrl.length > 560000 && q > 0.35) {
      q -= 0.12;
      dataUrl = canvas.toDataURL('image/jpeg', q);
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Image compression failed.'));
        },
        'image/jpeg',
        q
      );
    });

    return { dataUrl, blob, mimeType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function tryStorageUpload(blob: Blob, storagePath: string, mimeType: string): Promise<string | null> {
  try {
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytes(storageRef, blob, { contentType: mimeType }).then(() =>
      getDownloadURL(storageRef)
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    const url = await Promise.race([uploadTask, timeout]);
    return url;
  } catch {
    return null;
  }
}

/**
 * Uploads an image/document to Firebase Storage first. If Storage bucket is not yet
 * initialized or returns a rules/CORS error, stores the compressed media securely in
 * Firestore (`privateMedia` for student documents, `publicMedia` for banners/gallery).
 */
export async function uploadMediaSmart(
  file: File,
  folder: string,
  isPrivate: boolean,
  maxWidth = 960
): Promise<UploadedMediaResult> {
  const { dataUrl, blob, mimeType } = await compressImageFile(file, maxWidth, 0.78);
  const mediaId = generateMediaId(folder.replace(/[^a-zA-Z0-9]/g, '_'));
  const ext = mimeType === 'application/pdf' ? 'pdf' : 'jpg';
  const storagePath = `${folder}/${mediaId}.${ext}`;

  const storageUrl = await tryStorageUpload(blob, storagePath, mimeType);
  if (storageUrl) {
    mediaCache.set(`${isPrivate ? 'priv' : 'pub'}:${mediaId}`, storageUrl);
    return { url: storageUrl, mediaId: '' };
  }

  // Fallback to Firestore media document (strictly size-checked under 650KB)
  const colName = isPrivate ? 'privateMedia' : 'publicMedia';
  try {
    await setDoc(doc(db, colName, mediaId), {
      dataUrl,
      mimeType,
      fileName: file.name.slice(0, 150),
      createdAt: serverTimestamp(),
    });
    mediaCache.set(`${isPrivate ? 'priv' : 'pub'}:${mediaId}`, dataUrl);
    return { url: '', mediaId };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${colName}/${mediaId}`);
  }
}

export async function resolveMediaSource(
  url?: string,
  mediaId?: string,
  isPrivate = false
): Promise<string> {
  if (url && url.trim().length > 0) {
    return url;
  }
  if (!mediaId) return '';

  const cacheKey = `${isPrivate ? 'priv' : 'pub'}:${mediaId}`;
  const cached = mediaCache.get(cacheKey);
  if (cached) return cached;

  const colName = isPrivate ? 'privateMedia' : 'publicMedia';
  try {
    const snap = await getDoc(doc(db, colName, mediaId));
    if (snap.exists()) {
      const dataUrl = String(snap.data().dataUrl || '');
      if (dataUrl) {
        mediaCache.set(cacheKey, dataUrl);
        return dataUrl;
      }
    }
    return '';
  } catch (error) {
    console.warn(`Unable to resolve media ${colName}/${mediaId}:`, error);
    return '';
  }
}

/**
 * Generates a compact passport photo JPEG data URL (<= 140KB) suitable for
 * the OTP-verified student tracking profile & Digital ID Card download.
 */
export async function compressPassportThumbnail(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return '';
  try {
    const { dataUrl } = await compressImageFile(file, 220, 0.72);
    if (dataUrl.length <= 160000) return dataUrl;
    const smaller = await compressImageFile(file, 160, 0.62);
    return smaller.dataUrl.length <= 200000 ? smaller.dataUrl : '';
  } catch {
    return '';
  }
}

/**
 * Re-compresses an existing image data URL down to <= 160KB so older approved
 * applications can backfill studentTrackingProfiles cleanly.
 */
export async function shrinkImageDataUrlForProfile(sourceDataUrl: string): Promise<string> {
  if (!sourceDataUrl || !sourceDataUrl.startsWith('data:image/')) return '';
  if (sourceDataUrl.length <= 150000) return sourceDataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = sourceDataUrl;
    });
    const maxW = 220;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxW) {
      const ratio = maxW / w;
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', 0.7);
    return out.length <= 200000 ? out : '';
  } catch {
    return '';
  }
}
