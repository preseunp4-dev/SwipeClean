import { File, Paths } from 'expo-file-system';

function getFile(name) {
  return new File(Paths.document, name);
}

// Atomic write strategy:
//   1. Serialize JSON to a `.tmp` sibling file (original stays intact).
//   2. Delete the original.
//   3. Move .tmp → original.
// The window between step 2 and step 3 is microseconds. If the app is killed
// in that window, readJSON's recovery branch promotes the .tmp on next read.
async function readJSON(name, fallback) {
  try {
    const file = getFile(name);
    if (file.exists) {
      const raw = await file.text();
      return JSON.parse(raw);
    }
    // Recovery: main file missing. If a .tmp exists, a previous write was
    // interrupted between delete and move — promote the .tmp to main.
    const tmpFile = getFile(name + '.tmp');
    if (tmpFile.exists) {
      const raw = await tmpFile.text();
      const parsed = JSON.parse(raw);
      try { tmpFile.move(file); } catch {}
      return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function writeJSON(name, data) {
  const finalFile = getFile(name);
  const tmpFile = getFile(name + '.tmp');
  try {
    // Clean any leftover tmp from a previous failed attempt.
    if (tmpFile.exists) tmpFile.delete();
    tmpFile.write(JSON.stringify(data));
    if (finalFile.exists) finalFile.delete();
    tmpFile.move(finalFile);
  } catch (e) {
    console.warn('Storage write failed:', name, e);
    try { if (tmpFile.exists) tmpFile.delete(); } catch {}
  }
}

// --- SeenIds ---
export async function loadSeenIds() {
  const arr = await readJSON('seenIds.json', []);
  return new Set(arr);
}
const MAX_SEEN_IDS = 50000;
export async function saveSeenIds(seenSet) {
  let arr = [...seenSet];
  if (arr.length > MAX_SEEN_IDS) arr = arr.slice(arr.length - MAX_SEEN_IDS);
  await writeJSON('seenIds.json', arr);
}
export async function clearSeenIds() {
  try {
    const file = getFile('seenIds.json');
    if (file.exists) file.delete();
  } catch {}
}

// Only persist the fields we actually need for display and deletion
function slimAsset(a) {
  return { id: a.id, uri: a.uri, fileSize: a.fileSize || 0, mediaType: a.mediaType, duration: a.duration, width: a.width, height: a.height, creationTime: a.creationTime };
}

// --- Trashed ---
export async function loadTrashed() {
  return readJSON('trashed.json', []);
}
export async function saveTrashed(arr) {
  await writeJSON('trashed.json', arr.map(slimAsset));
}

// --- Kept (IDs only — used to rebuild seenIds on init) ---
export async function loadKept() {
  const data = await readJSON('kept.json', []);
  // Migration: if old format (objects with .id), extract just the IDs
  if (data.length > 0 && typeof data[0] === 'object') {
    return data.map((a) => a.id);
  }
  return data;
}
export async function saveKept(arr) {
  // Save as plain ID strings
  await writeJSON('kept.json', arr.map((a) => typeof a === 'object' ? a.id : a));
}

// --- Stats ---
export async function loadStats() {
  return readJSON('stats.json', { totalSpaceSaved: 0 });
}
export async function saveStats(stats) {
  await writeJSON('stats.json', stats);
}

// --- File Size Cache ---
export async function loadFileSizeCache() {
  return readJSON('fileSizeCache.json', {});
}
export async function saveFileSizeCache(cache) {
  await writeJSON('fileSizeCache.json', cache);
}

// --- Dismissed Groups ---
export async function loadDismissedGroups() {
  const arr = await readJSON('dismissedGroups.json', []);
  return new Set(arr);
}
export async function saveDismissedGroups(dismissedSet) {
  await writeJSON('dismissedGroups.json', [...dismissedSet]);
}
export async function clearDismissedGroups() {
  await writeJSON('dismissedGroups.json', []);
}
