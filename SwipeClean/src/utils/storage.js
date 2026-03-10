import { File, Paths } from 'expo-file-system';

function getFile(name) {
  return new File(Paths.document, name);
}

async function readJSON(name, fallback) {
  try {
    const file = getFile(name);
    if (!file.exists) return fallback;
    const raw = await file.text();
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJSON(name, data) {
  try {
    const file = getFile(name);
    await file.write(JSON.stringify(data));
  } catch (e) {
    console.warn('Storage write failed:', name, e);
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
