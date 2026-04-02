import { requireNativeModule } from 'expo-modules-core';

let nativeModule = null;
try {
  nativeModule = requireNativeModule('PhotoQualityModule');
} catch {
  // Not available (Expo Go) — fallback will be used
}

/**
 * Analyze photo quality for a list of asset IDs.
 * Returns array of:
 * {
 *   id: string,
 *   sharpness: number (0-1, higher = sharper),
 *   exposure: number (0-1, 0.5 = ideal, 0/1 = under/over exposed),
 *   facesDetected: number,
 *   eyesOpen: boolean,
 *   smiling: boolean,
 *   faceQuality: number (0-1),
 *   compositeScore: number (0-100, higher = better)
 * }
 */
export async function analyzePhotos(localIdentifiers) {
  if (!nativeModule) return [];
  return nativeModule.analyzePhotos(localIdentifiers);
}

export const isAvailable = nativeModule != null;
