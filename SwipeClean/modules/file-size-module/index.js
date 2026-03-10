import { requireNativeModule } from 'expo-modules-core';

let nativeModule = null;
try {
  nativeModule = requireNativeModule('FileSizeModule');
} catch {
  // Not available (Expo Go) — fallback will be used
}

/**
 * Get file sizes for specific asset IDs.
 * Returns array of { id, fileSize }.
 * iOS: PHAssetResource metadata. Android: MediaStore SIZE column. Both instant.
 */
export async function getFileSizes(localIdentifiers) {
  if (!nativeModule) return [];
  return nativeModule.getFileSizes(localIdentifiers);
}

/**
 * Get ALL assets sorted by file size (largest first).
 * Returns top 500 as array of { id, fileSize }.
 * mediaTypes: [1] = photos, [2] = videos, [1, 2] = both
 */
export async function getAllFileSizesSorted(mediaTypes = [1, 2]) {
  if (!nativeModule) return [];
  return nativeModule.getAllFileSizesSorted(mediaTypes);
}

/**
 * Check if native module is available.
 */
export const isAvailable = nativeModule != null;
