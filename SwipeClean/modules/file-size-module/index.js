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
 * Iterates the entire library — slow on huge libraries (~1-2min for 80k).
 * Use getAssetsPage for paginated fast fetches.
 * Returns array of { id, mediaType, width, height, creationTime, duration, fileSize, uri }.
 */
export async function getAllAssetsNative(mediaTypes = [1, 2]) {
  if (!nativeModule) return [];
  return nativeModule.getAllAssetsNative(mediaTypes);
}

/**
 * Fast first-N fetch using PHFetchOptions.fetchLimit.
 * Runs in ~50ms regardless of library size because iOS uses its
 * creationDate index to short-circuit the query.
 *
 * @param mediaTypes  [1]=photos, [2]=videos, [1,2]=both
 * @param count       target number of results (will over-fetch internally)
 * @param oldestFirst true = creationDate ASC (oldest first), false = DESC
 * @param afterCreationTime ms since epoch; 0 = start from beginning,
 *                    >0 = only assets strictly past this cursor
 * @returns array of { id, mediaType, width, height, creationTime, duration, uri }
 *          (no fileSize — use getFileSizes for specific IDs).
 */
export async function getAssetsPage(mediaTypes = [1, 2], count = 25, oldestFirst = true, afterCreationTime = 0) {
  if (!nativeModule) return [];
  return nativeModule.getAssetsPage(mediaTypes, count, oldestFirst, afterCreationTime);
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
