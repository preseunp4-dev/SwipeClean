import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  clearSeenIds,
  loadTrashed, saveTrashed,
  loadKept, saveKept,
  loadStats, saveStats,
  clearDismissedGroups,
} from '../utils/storage';

const AppContext = createContext();

const DAILY_FREE_LIMIT = 200;
const STORAGE_KEY = 'swipeclean_limits';
const KEYCHAIN_OPTS = { keychainService: 'com.pieterpreseun.swipeclean.limits' };
const MAX_HISTORY = 50;

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

const initialState = {
  assets: [],
  currentIndex: 0,
  keptIds: [],
  trashed: [],
  history: [],
  loading: true,
  hasMore: true,
  seenIds: new Set(),
  totalSpaceSaved: 0,
  totalKept: 0,
  totalTrashed: 0,
  totalKeptSize: 0,
  totalLibrarySize: 0,
  persistLoaded: false,
  // Daily limit
  dailySwipes: 0,
  dailyLimitReached: false,
  isPro: false,
};

async function persistSwipes(count) {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({
      swipesToday: count,
      lastResetDate: getTodayString(),
    }), KEYCHAIN_OPTS);
  } catch (e) { console.warn('Failed to persist swipes:', e.message); }
}

function reducer(state, action) {
  switch (action.type) {
    case 'INIT_PERSISTED': {
      const { trashed, keptIds, stats } = action.payload;
      // Rebuild seenIds from swiped asset IDs
      const rebuiltSeen = new Set(keptIds);
      for (const a of trashed) rebuiltSeen.add(a.id);
      return {
        ...state,
        seenIds: rebuiltSeen,
        trashed,
        keptIds,
        totalSpaceSaved: stats.totalSpaceSaved || 0,
        totalKept: stats.totalKept || 0,
        totalTrashed: stats.totalTrashed || 0,
        totalKeptSize: stats.totalKeptSize || 0,
        persistLoaded: true,
      };
    }

    case 'SET_ASSETS': {
      return {
        ...state,
        assets: action.payload,
        currentIndex: 0,
        loading: false,
      };
    }

    case 'APPEND_ASSETS': {
      return {
        ...state,
        assets: [...state.assets, ...action.payload],
        hasMore: action.payload.length > 0,
      };
    }

    case 'RESTORE_FILTER': {
      return {
        ...state,
        assets: action.payload.assets,
        currentIndex: action.payload.currentIndex,
        loading: false,
      };
    }

    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_LIBRARY_SIZE':
      return { ...state, totalLibrarySize: action.payload };

    case 'SET_FILE_SIZE': {
      // Mutate in place — avoids creating a new assets array and triggering re-renders.
      // SwipeCard manages its own fileSize display; this just ensures the asset
      // has fileSize when it later gets moved to trashed.
      const { assetId, fileSize } = action.payload;
      const asset = state.assets.find((a) => a.id === assetId);
      if (asset) asset.fileSize = fileSize;
      return state;
    }

    case 'SET_FILE_SIZES': {
      // Batch version — mutate all in one dispatch instead of looping individual dispatches
      for (const { assetId, fileSize } of action.payload) {
        const asset = state.assets.find((a) => a.id === assetId);
        if (asset) asset.fileSize = fileSize;
      }
      return state;
    }

    case 'INIT_LIMITS':
      return {
        ...state,
        dailySwipes: action.payload.swipesToday,
        isPro: action.payload.isPro || false,
        dailyLimitReached: !action.payload.isPro && action.payload.swipesToday >= DAILY_FREE_LIMIT,
      };

    case 'SET_PRO':
      return { ...state, isPro: true, dailyLimitReached: false };

    case 'KEEP': {
      if (state.dailyLimitReached) return state;
      const asset = state.assets[state.currentIndex];
      if (!asset) return state;
      const newSwipes = state.dailySwipes + 1;
      const limitReached = !state.isPro && newSwipes >= DAILY_FREE_LIMIT;
      persistSwipes(newSwipes);
      const newSeen = new Set(state.seenIds);
      newSeen.add(asset.id);
      return {
        ...state,
        keptIds: [...state.keptIds, asset.id],
        currentIndex: state.currentIndex + 1,
        history: [...state.history, { action: 'keep', asset, index: state.currentIndex }].slice(-MAX_HISTORY),
        seenIds: newSeen,
        dailySwipes: newSwipes,
        dailyLimitReached: limitReached,
        totalKept: state.totalKept + 1,
        totalKeptSize: state.totalKeptSize + (asset.fileSize || 0),
      };
    }

    case 'TRASH': {
      if (state.dailyLimitReached) return state;
      const asset = state.assets[state.currentIndex];
      if (!asset) return state;
      const newSwipes = state.dailySwipes + 1;
      const limitReached = !state.isPro && newSwipes >= DAILY_FREE_LIMIT;
      persistSwipes(newSwipes);
      const newSeen = new Set(state.seenIds);
      newSeen.add(asset.id);
      return {
        ...state,
        trashed: [...state.trashed, asset],
        currentIndex: state.currentIndex + 1,
        history: [...state.history, { action: 'trash', asset, index: state.currentIndex }].slice(-MAX_HISTORY),
        seenIds: newSeen,
        dailySwipes: newSwipes,
        dailyLimitReached: limitReached,
        totalTrashed: state.totalTrashed + 1,
      };
    }

    case 'UNDO': {
      if (state.history.length === 0) return state;
      const last = state.history[state.history.length - 1];
      const undoSwipes = Math.max(0, state.dailySwipes - 1);
      persistSwipes(undoSwipes);
      const newSeen = new Set(state.seenIds);
      newSeen.delete(last.asset.id);
      return {
        ...state,
        currentIndex: last.index,
        seenIds: newSeen,
        keptIds: last.action === 'keep' ? state.keptIds.slice(0, -1) : state.keptIds,
        trashed: last.action === 'trash' ? state.trashed.slice(0, -1) : state.trashed,
        history: state.history.slice(0, -1),
        totalKept: last.action === 'keep' ? Math.max(0, state.totalKept - 1) : state.totalKept,
        totalKeptSize: last.action === 'keep' ? Math.max(0, state.totalKeptSize - (last.asset.fileSize || 0)) : state.totalKeptSize,
        totalTrashed: last.action === 'trash' ? Math.max(0, state.totalTrashed - 1) : state.totalTrashed,
        dailySwipes: undoSwipes,
        dailyLimitReached: false,
      };
    }

    case 'TRASH_MULTIPLE': {
      const newSeen = new Set(state.seenIds);
      for (const a of action.payload) newSeen.add(a.id);
      return {
        ...state,
        trashed: [...state.trashed, ...action.payload],
        seenIds: newSeen,
        totalTrashed: state.totalTrashed + action.payload.length,
      };
    }

    case 'MARK_SEEN': {
      const newSeen = new Set(state.seenIds);
      for (const id of action.payload) newSeen.add(id);
      return { ...state, seenIds: newSeen };
    }

    case 'RESTORE': {
      const assetId = action.payload;
      const newSeen = new Set(state.seenIds);
      newSeen.delete(assetId);
      return {
        ...state,
        trashed: state.trashed.filter((a) => a.id !== assetId),
        history: state.history.filter((h) => !(h.action === 'trash' && h.asset.id === assetId)),
        seenIds: newSeen,
        totalTrashed: Math.max(0, state.totalTrashed - 1),
      };
    }

    case 'INCREMENT_SWIPES': {
      const add = action.payload || 1;
      const newCount = state.dailySwipes + add;
      const limited = !state.isPro && newCount >= DAILY_FREE_LIMIT;
      persistSwipes(newCount);
      return { ...state, dailySwipes: newCount, dailyLimitReached: limited };
    }

    case 'RESET_LIMITS': {
      persistSwipes(0);
      return { ...state, dailySwipes: 0, dailyLimitReached: false };
    }

    case 'RESET_SEEN_IDS': {
      return { ...state, seenIds: new Set(), keptIds: [], trashed: [], history: [], totalKept: 0, totalTrashed: 0, totalKeptSize: 0 };
    }

    case 'CLEAR_TRASH': {
      if (action.payload) {
        const idsToDelete = new Set(action.payload);
        const deleted = state.trashed.filter((a) => idsToDelete.has(a.id));
        const remaining = state.trashed.filter((a) => !idsToDelete.has(a.id));
        const deletedSize = deleted.reduce((sum, a) => sum + (a.fileSize || 0), 0);
        return { ...state, trashed: remaining, totalSpaceSaved: state.totalSpaceSaved + deletedSize };
      }
      const deletedSize = state.trashed.reduce((sum, a) => sum + (a.fileSize || 0), 0);
      return { ...state, trashed: [], totalSpaceSaved: state.totalSpaceSaved + deletedSize };
    }

    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Load all persisted data on mount
  useEffect(() => {
    (async () => {
      try {
        // Load daily limits from SecureStore
        const raw = await SecureStore.getItemAsync(STORAGE_KEY, KEYCHAIN_OPTS);
        if (raw) {
          const data = JSON.parse(raw);
          const today = getTodayString();
          dispatch({
            type: 'INIT_LIMITS',
            payload: {
              swipesToday: data.lastResetDate === today ? data.swipesToday : 0,
              isPro: false,
            },
          });
        } else {
          dispatch({ type: 'INIT_LIMITS', payload: { swipesToday: 0 } });
        }

        // Load persisted data from file system
        const [trashed, keptIds, stats] = await Promise.all([
          loadTrashed(),
          loadKept(),
          loadStats(),
        ]);
        dispatch({ type: 'INIT_PERSISTED', payload: { trashed, keptIds, stats } });
      } catch (e) {
        console.warn('Failed to load persisted data:', e.message);
        dispatch({ type: 'INIT_PERSISTED', payload: { trashed: [], keptIds: [], stats: { totalSpaceSaved: 0 } } });
      }
    })();
  }, []);

  // Debounced persistence — avoid writing to disk on every single swipe
  const saveTimers = useRef({});
  const debouncedSave = useCallback((key, saveFn, data, delay = 1000) => {
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => saveFn(data), delay);
  }, []);

  // Persist trashed when it changes
  const trashedRef = useRef(state.trashed);
  useEffect(() => {
    if (trashedRef.current === state.trashed) return;
    trashedRef.current = state.trashed;
    debouncedSave('trashed', saveTrashed, state.trashed);
  }, [state.trashed]);

  // Persist kept IDs when they change
  const keptRef = useRef(state.keptIds);
  useEffect(() => {
    if (keptRef.current === state.keptIds) return;
    keptRef.current = state.keptIds;
    debouncedSave('kept', saveKept, state.keptIds);
  }, [state.keptIds]);

  // Persist stats when they change
  const statsRef = useRef({ s: state.totalSpaceSaved, k: state.totalKept, t: state.totalTrashed, ks: state.totalKeptSize });
  useEffect(() => {
    const cur = { s: state.totalSpaceSaved, k: state.totalKept, t: state.totalTrashed, ks: state.totalKeptSize };
    if (statsRef.current.s === cur.s && statsRef.current.k === cur.k && statsRef.current.t === cur.t && statsRef.current.ks === cur.ks) return;
    statsRef.current = cur;
    debouncedSave('stats', saveStats, { totalSpaceSaved: state.totalSpaceSaved, totalKept: state.totalKept, totalTrashed: state.totalTrashed, totalKeptSize: state.totalKeptSize });
  }, [state.totalSpaceSaved, state.totalKept, state.totalTrashed, state.totalKeptSize]);

  // Flush pending debounced saves when the app goes to background. Without
  // this, a swipe done <1s before the user backgrounds/kills the app is lost
  // (debounce timer never fires). On 'inactive' OR 'background' we cancel
  // any pending timers and write current state synchronously.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'background' && next !== 'inactive') return;
      // Cancel pending debounces so they don't re-fire with stale data later
      for (const key of Object.keys(saveTimers.current)) {
        if (saveTimers.current[key]) {
          clearTimeout(saveTimers.current[key]);
          delete saveTimers.current[key];
        }
      }
      // Force immediate writes from the latest values held in refs
      saveTrashed(trashedRef.current);
      saveKept(keptRef.current);
      saveStats({
        totalSpaceSaved: statsRef.current.s,
        totalKept: statsRef.current.k,
        totalTrashed: statsRef.current.t,
        totalKeptSize: statsRef.current.ks,
      });
    });
    return () => sub.remove();
  }, []);

  const keep = useCallback(() => dispatch({ type: 'KEEP' }), []);
  const trash = useCallback(() => dispatch({ type: 'TRASH' }), []);
  const trashMultiple = useCallback((assets) => dispatch({ type: 'TRASH_MULTIPLE', payload: assets }), []);
  const markSeen = useCallback((ids) => dispatch({ type: 'MARK_SEEN', payload: ids }), []);
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const restore = useCallback((id) => dispatch({ type: 'RESTORE', payload: id }), []);
  const clearTrash = useCallback((ids) => dispatch({ type: 'CLEAR_TRASH', payload: ids }), []);
  const resetLimits = useCallback(() => dispatch({ type: 'RESET_LIMITS' }), []);
  const resetSeenIds = useCallback(() => {
    clearSeenIds();
    clearDismissedGroups();
    dispatch({ type: 'RESET_SEEN_IDS' });
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch, keep, trash, trashMultiple, markSeen, undo, restore, clearTrash, resetLimits, resetSeenIds }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}

export { DAILY_FREE_LIMIT };
