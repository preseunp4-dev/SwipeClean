import { requireNativeModule } from 'expo-modules-core';

let nativeModule = null;
try {
  nativeModule = requireNativeModule('FileSizeModule');
} catch {
  // Not available (Expo Go) — fallback will be used
}

export async function getFileSizes(localIdentifiers) {
  if (!nativeModule) return [];
  return nativeModule.getFileSizes(localIdentifiers);
}

export async function getAllFileSizesSorted(mediaTypes = [1, 2]) {
  if (!nativeModule) return [];
  return nativeModule.getAllFileSizesSorted(mediaTypes);
}

/**
 * Get largest unseen assets — filtering and sorting done natively.
 * seenIds: array of asset IDs to exclude
 * Returns array of { id, fileSize } sorted by size descending.
 */
export async function getLargestUnseen(seenIds, mediaTypes = [1, 2], limit = 200) {
  if (!nativeModule) return [];
  return nativeModule.getLargestUnseen(seenIds, mediaTypes, limit);
}

/**
 * Get all assets in one native call — no JS bridge overhead per page.
 * Returns array of { id, mediaType, width, height, creationTime, duration, fileSize, uri }.
 */
export async function getAllAssetsNative(mediaTypes = [1, 2]) {
  if (!nativeModule) return [];
  return nativeModule.getAllAssetsNative(mediaTypes);
}

/**
 * Find duplicate groups natively — burst detection + exact duplicates.
 * Returns array of { id, type, assets: [{ id, mediaType, width, height, creationTime, duration, fileSize, uri }] }.
 */
export async function findDuplicateGroups(mediaTypes = [1, 2], timeWindowMs = 5000, minSizeRatio = 0.5) {
  if (!nativeModule) return [];
  return nativeModule.findDuplicateGroups(mediaTypes, timeWindowMs, minSizeRatio);
}

export const isAvailable = nativeModule != null;
