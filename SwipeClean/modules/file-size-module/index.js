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
  // Defensive: older native binaries may not have this function
  if (!nativeModule || typeof nativeModule.getAssetsPage !== 'function') return [];
  return nativeModule.getAssetsPage(mediaTypes, count, oldestFirst, afterCreationTime);
}

/**
 * Find duplicate groups natively — burst detection + exact duplicates.
 *
 * Streams groups via the "onDuplicateGroup" event as they're found
 * (newest bursts first), AND returns the full array when the scan
 * completes. Callers can subscribe via addDuplicateGroupListener to
 * handle groups progressively, or just await the returned array.
 *
 * Uses LAZY evaluation: only computes pHash / fileSize for burst
 * candidates (dimension + time-window matches), not every asset.
 */
export async function findDuplicateGroups(mediaTypes = [1, 2], timeWindowMs = 5000, minSizeRatio = 0.5) {
  if (!nativeModule) return [];
  return nativeModule.findDuplicateGroups(mediaTypes, timeWindowMs, minSizeRatio);
}

/**
 * Subscribe to duplicate groups as they're discovered during a scan.
 * The callback receives { group: { id, type, assets: [...] } }.
 * Returns a subscription handle — call .remove() to unsubscribe.
 * Must be called BEFORE starting a scan (events fired before subscription
 * are dropped).
 */
export function addDuplicateGroupListener(callback) {
  if (!nativeModule || typeof nativeModule.addListener !== 'function') {
    return { remove: () => {} };
  }
  return nativeModule.addListener('onDuplicateGroup', callback);
}

/**
 * Truly random unseen assets across the whole library.
 * Uses PHFetchResult's lazy O(1) index lookup + weighted random across
 * media types. Returns up to `count` shuffled unseen assets. Safe on
 * any library size — no PHAssetResource calls, no image loads.
 *
 * @param mediaTypes [1]=photos, [2]=videos, [1,2]=both
 * @param count number of items to return
 * @param seenIds asset IDs to exclude (includes currently-loaded buffer
 *   for topup, so we don't re-pick what's already shown)
 */
export async function getAssetsRandom(mediaTypes = [1, 2], count = 25, seenIds = []) {
  if (!nativeModule || typeof nativeModule.getAssetsRandom !== 'function') return [];
  return nativeModule.getAssetsRandom(mediaTypes, count, seenIds);
}

/**
 * Largest unseen assets via proxy scoring.
 * Fast on any library size — scans metadata in one pass, picks top K candidates
 * by proxy (width × height × duration), fetches real fileSize only for those,
 * returns top `limit` by actual size. Safe: bounded PHAssetResource calls.
 *
 * @param mediaTypes [1]=photos, [2]=videos, [1,2]=both
 * @param limit number of items to return (top by real fileSize)
 * @param seenIds asset IDs to exclude
 * @returns array of { id, mediaType, width, height, duration, creationTime, uri, fileSize }
 */
export async function getLargestProxy(mediaTypes = [1, 2], limit = 50, seenIds = []) {
  if (!nativeModule || typeof nativeModule.getLargestProxy !== 'function') return [];
  return nativeModule.getLargestProxy(mediaTypes, limit, seenIds);
}

export const isAvailable = nativeModule != null;
