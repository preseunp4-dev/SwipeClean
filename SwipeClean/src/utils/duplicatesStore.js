// Singleton store for the duplicate scan + AI pipeline.
//
// Kicked off by SwipeScreen on startup so results are already streaming in
// by the time the user taps the Duplicates tab. DuplicatesScreen subscribes
// to this store and renders whatever groups are currently analyzed.
//
// Pipeline:
//   1. findDuplicateGroupsNative(...)  — one native call, scans whole library
//   2. Filter out dismissed groups
//   3. AI analyze in batches of AI_BATCH (50) — groups only appear after the
//      AI pass has run on them, per product requirement
//   4. After each batch, emit updated groups list

import * as MediaLibrary from 'expo-media-library';
import {
  findDuplicateGroups as findDuplicateGroupsNative,
  isAvailable as fileSizeModuleAvailable,
} from '../../modules/file-size-module';
import {
  analyzePhotos,
  isAvailable as photoQualityAvailable,
} from '../../modules/photo-quality-module';
import { loadDismissedGroups } from './storage';

const TIME_WINDOW_MS = 5000;
const MIN_SIZE_RATIO = 0.5;
const AI_BATCH = 25;

const initialState = {
  phase: 'idle',           // 'idle' | 'scanning' | 'analyzing' | 'done' | 'error'
  groups: [],              // analyzed groups (only after AI pass)
  progress: { loaded: 0, total: 0 },
  error: null,
};

let state = { ...initialState };
const subscribers = new Set();

function emit() {
  for (const cb of subscribers) {
    try { cb(state); } catch (e) { console.warn('[duplicatesStore] subscriber threw:', e?.message); }
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

export function subscribe(cb) {
  subscribers.add(cb);
  cb(state);
  return () => subscribers.delete(cb);
}

export function getState() {
  return state;
}

function groupKey(assets) {
  return assets.map((a) => a.id).sort().join('|');
}

// Analyze ALL photos in a batch of groups with a single native call.
// Much faster than one call per group:
//   - Only one JS↔native bridge crossing per batch (vs. 25)
//   - The native photo-quality module uses DispatchQueue.concurrentPerform,
//     so giving it 75 photos at once lets it parallelize across cores
// After the batch resolves, distribute each photo's compositeScore back
// to its group and pick the best one.
async function analyzeBatch(batch) {
  if (!photoQualityAvailable || batch.length === 0) return;
  const allIds = [];
  for (const g of batch) for (const a of g.assets) allIds.push(a.id);
  if (allIds.length === 0) return;
  try {
    const scores = await analyzePhotos(allIds);
    const scoreMap = {};
    for (const s of scores) scoreMap[s.id] = s.compositeScore;
    for (const group of batch) {
      let bestId = group.assets[0].id;
      let bestScore = -1;
      for (const asset of group.assets) {
        const score = scoreMap[asset.id] || 0;
        if (score > bestScore) {
          bestScore = score;
          bestId = asset.id;
        }
      }
      group.assets = [
        ...group.assets.filter((a) => a.id === bestId),
        ...group.assets.filter((a) => a.id !== bestId),
      ];
      group.bestId = bestId;
      group.trashIds = new Set(group.assets.filter((a) => a.id !== bestId).map((a) => a.id));
    }
  } catch (e) {
    console.warn('[duplicatesStore] analyzeBatch failed:', e?.message);
  }
}

let scanPromise = null;

async function runScan() {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    setState({ phase: 'error', error: 'permission-denied' });
    return;
  }

  if (!fileSizeModuleAvailable) {
    setState({ phase: 'error', error: 'native-module-unavailable' });
    return;
  }

  setState({ phase: 'scanning', progress: { loaded: 0, total: 0 }, groups: [] });

  const raw = await findDuplicateGroupsNative([1, 2], TIME_WINDOW_MS, MIN_SIZE_RATIO);
  const withTrash = raw.map((g) => ({ ...g, trashIds: new Set() }));

  const dismissed = await loadDismissedGroups();
  const visible = withTrash.filter((g) => !dismissed.has(groupKey(g.assets)));

  if (visible.length === 0) {
    setState({ phase: 'done', groups: [], progress: { loaded: 0, total: 0 } });
    return;
  }

  setState({
    phase: 'analyzing',
    groups: [],
    progress: { loaded: 0, total: visible.length },
  });

  const analyzed = [];
  for (let i = 0; i < visible.length; i += AI_BATCH) {
    const batch = visible.slice(i, i + AI_BATCH);
    await analyzeBatch(batch);
    for (const g of batch) analyzed.push(g);
    setState({
      groups: [...analyzed],
      progress: { loaded: analyzed.length, total: visible.length },
    });
    // Yield to JS thread so UI can render the append
    await new Promise((r) => setTimeout(r, 50));
  }

  setState({ phase: 'done' });
}

export function startScan() {
  if (scanPromise) return scanPromise;
  if (state.phase === 'done') return Promise.resolve();
  scanPromise = runScan().catch((e) => {
    console.warn('[duplicatesStore] scan failed:', e?.message);
    setState({ phase: 'error', error: e?.message || 'scan failed' });
  });
  return scanPromise;
}

export function reset() {
  scanPromise = null;
  state = { ...initialState };
  emit();
}
