import React, { useEffect, useCallback, useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, Linking, ScrollView, Dimensions, Animated, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useApp, DAILY_FREE_LIMIT } from '../context/AppContext';
import { usePurchases } from '../context/PurchaseContext';
import { Image } from 'expo-image';
import SwipeCard, { CARD_WIDTH, CARD_HEIGHT, MIN_CARD_BUTTON_GAP } from '../components/SwipeCard';
import MilestoneOverlay from '../components/MilestoneOverlay';
import { t } from '../i18n';
import { useColors } from '../context/ColorContext';
import * as Sharing from 'expo-sharing';
import { getAllAssetsNative, isAvailable as fileSizeModuleAvailable } from '../../modules/file-size-module';
import { loadFileSizeCache, saveFileSizeCache } from '../utils/storage';
import { sw } from '../utils/scale';
import { splashRef } from '../utils/splashRef';
import * as duplicatesStore from '../utils/duplicatesStore';

// Loading pipeline constants.
// Step 1: fast first-batch of INITIAL_BATCH oldest photos/videos shown instantly.
// Step 3+6: once the native cache is ready, each category's filterCache is
//           filled to BUFFER_TARGET so every filter tap is instant.
// Step 7:   when the user swipes past (current length − TOPUP_THRESHOLD) of
//           the active filter, TOPUP_SIZE more assets get sliced in.
const INITIAL_BATCH = 25;
const BUFFER_TARGET = 50;
const TOPUP_THRESHOLD = 25;
const TOPUP_SIZE = 25;

// Localized keywords to find the Screenshots smart album on iOS across languages.
const SCREENSHOT_KEYWORDS = [
  'screenshot', 'screen shot',
  'scherm', 'bildschirmfoto', 'capture', 'captura', 'istantan',
  'skärmbild', 'skjermbild', 'skærmbillede', 'kuvakaappau', 'zrzut',
  'снимк', 'скриншот', 'スクリーンショット', '스크린샷', '截屏', '螢幕快照',
  'لقطات', 'ekran görüntü',
];

// Filter-specific sort + subset. Returns a new array.
function applyFilter(filter, source) {
  if (filter === 'photos') {
    return source.filter((a) => a.mediaType === 'photo').sort((a, b) => a.creationTime - b.creationTime);
  }
  if (filter === 'videos') {
    return source.filter((a) => a.mediaType === 'video').sort((a, b) => a.creationTime - b.creationTime);
  }
  if (filter === 'newest') return [...source].sort((a, b) => b.creationTime - a.creationTime);
  if (filter === 'largest') return [...source].sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0));
  if (filter === 'oldest') return [...source].sort((a, b) => a.creationTime - b.creationTime);
  // 'all' = random shuffle
  const arr = [...source];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const FILTERS = [
  { key: 'oldest', label: 'swipe.filterOldest' },
  { key: 'newest', label: 'swipe.filterNewest' },
  { key: 'all', label: 'swipe.filterRandom' },
  { key: 'largest', label: 'swipe.filterLargest' },
  { key: 'photos', label: 'swipe.filterPhotos' },
  { key: 'videos', label: 'swipe.filterVideos' },
  { key: 'screenshots', label: 'swipe.filterScreenshots' },
];

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const SCALE_WIDTH = Math.min(SCREEN_WIDTH, 430);
const BTN_SIZE = Math.round(Math.min(72, SCREEN_WIDTH * 0.184));
const UNDO_SIZE = Math.round(Math.min(56, SCREEN_WIDTH * 0.143));

export default function SwipeScreen() {
  const { colors, theme } = useColors();
  const insets = useSafeAreaInsets();
  const { state, dispatch, keep, trash, undo, resetSeenIds, resetLimits } = useApp();
  const { proProduct, weeklyProduct, purchaseProduct, restorePurchases, isPro: isProPurchased } = usePurchases();
  const { assets, currentIndex, loading, hasMore, seenIds,
          dailySwipes, dailyLimitReached, isPro: isProState, persistLoaded,
          totalKept, totalTrashed } = state;
  const isPro = isProState || isProPurchased;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [muted, setMuted] = useState(false);
  const [activeFilter, setActiveFilter] = useState('oldest');
  const activeFilterRef = useRef('oldest');
  const [enterFrom, setEnterFrom] = useState(null);
  const filterCacheRef = useRef({});
  const fileSizeCache = useRef({});
  const fileSizeCacheLoaded = useRef(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const loadIdRef = useRef(0);
  const allAssetIdsRef = useRef(null); // All library asset IDs for background preload
  const allAssetsCache = useRef(null); // Cached native assets — avoids re-fetching 100K items
  const bgPreloadRef = useRef(null);   // Background preload cancel token
  const filterLoadingRef = useRef(false); // True while a filter load is fetching file sizes
  // Flipped once the native asset cache is built. Kicks the file-size
  // preloader effect below once the IDs are actually available.
  const [nativeCacheReady, setNativeCacheReady] = useState(false);
  const isFocused = useIsFocused();
  const navigation = useNavigation();

  const seenIdsRef = useRef(seenIds);
  useEffect(() => { seenIdsRef.current = seenIds; }, [seenIds]);
  const assetsRef = useRef(assets);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

  // Promise that resolves when AppProvider has finished reading trashed/kept
  // from disk. loadAssets kicks off its MediaLibrary scan immediately and
  // only awaits this right before it needs to build the skip-set.
  const persistLoadedRef = useRef(persistLoaded);
  const persistPromiseRef = useRef(null);
  const persistResolveRef = useRef(null);
  if (!persistPromiseRef.current) {
    persistPromiseRef.current = new Promise((resolve) => {
      persistResolveRef.current = resolve;
    });
  }
  useEffect(() => {
    persistLoadedRef.current = persistLoaded;
    if (persistLoaded && persistResolveRef.current) {
      persistResolveRef.current();
      persistResolveRef.current = null;
    }
  }, [persistLoaded]);

  // Refs for the load pipeline
  const screenshotAlbumRef = useRef(undefined); // undefined = not looked up, null = none, obj = found
  const backgroundStartedRef = useRef(false);
  const phase2DoneRef = useRef(false);
  const phase3DoneRef = useRef(false);
  const topUpInFlightRef = useRef({});

  // -----------------------------------------------------------------------
  // warmupCards — for the first N cards of any newly-dispatched batch:
  //   1. Image.prefetch — warms expo-image's memory cache
  //   2. MediaLibrary.getAssetInfoAsync — forces iOS to download the file
  //      from iCloud if it's offloaded. This is the fix for the "white
  //      photo" bug: for photos that live in iCloud, the URI alone is not
  //      enough — iOS needs an explicit info request to materialize the file.
  // Fire-and-forget; never blocks.
  // -----------------------------------------------------------------------
  const warmupCards = useCallback((batch, n = 5) => {
    for (const a of (batch || []).slice(0, n)) {
      try { Image.prefetch(a.uri); } catch {}
      MediaLibrary.getAssetInfoAsync(a.id, { shouldDownloadFromNetwork: true })
        .then((info) => {
          if (info?.fileSize > 0) {
            dispatch({ type: 'SET_FILE_SIZE', payload: { assetId: a.id, fileSize: info.fileSize } });
          }
        })
        .catch(() => {});
    }
  }, [dispatch]);

  // -----------------------------------------------------------------------
  // Look up the Screenshots smart album, cached for the session.
  // Strategy:
  //   1. Prefer EXACT title match in any localization (most reliable)
  //   2. Fall back to keyword `includes` match
  // -----------------------------------------------------------------------
  const lookupScreenshotAlbum = useCallback(async () => {
    if (screenshotAlbumRef.current !== undefined) return screenshotAlbumRef.current;
    try {
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      // Exact-title pass: covers the common locales without the risk of a
      // partial match grabbing the wrong smart album (e.g. Screen Recordings).
      const EXACT = new Set([
        'Screenshots', 'Screen Shots',
        'Schermafbeeldingen',           // NL
        'Bildschirmfotos',              // DE
        'Captures d\u2019\u00e9cran', 'Captures d\'\u00e9cran', // FR
        'Capturas de pantalla',         // ES/PT
        'Schermate',                    // IT
        'Sk\u00e4rmavbilder',           // SV
        'Skjermbilder',                 // NO
        'Sk\u00e6rmbilleder',           // DA
        'N\u00e4ytt\u00f6kuvat',        // FI
        'Zrzuty ekranu',                // PL
        '\u0421\u043d\u0438\u043c\u043a\u0438 \u044d\u043a\u0440\u0430\u043d\u0430', // RU
        '\u30b9\u30af\u30ea\u30fc\u30f3\u30b7\u30e7\u30c3\u30c8', // JA
        '\u00bd\u00ba\u00ed\u0081\u00ac\u00eb\u00a6\u00b0\u00ec\u0083\u0083',       // KO
        '\u622a\u5c4f', '\u87a2\u5e55\u5feb\u7167',                                 // ZH
      ]);
      let album = albums.find((a) => EXACT.has(a.title));
      if (!album) {
        // Keyword fallback — but only after the exact pass has failed
        album = albums.find((a) => {
          const title = (a.title || '').toLowerCase();
          return SCREENSHOT_KEYWORDS.some((kw) => title.includes(kw));
        });
      }
      screenshotAlbumRef.current = album || null;
    } catch {
      screenshotAlbumRef.current = null;
    }
    return screenshotAlbumRef.current;
  }, []);

  // -----------------------------------------------------------------------
  // Fetch screenshots from the album. Stores result in filterCacheRef.
  // Returns the array of assets (possibly empty).
  // -----------------------------------------------------------------------
  const fetchScreenshots = useCallback(async (count) => {
    const album = await lookupScreenshotAlbum();
    if (!album) {
      filterCacheRef.current.screenshots = { assets: [], currentIndex: 0 };
      return [];
    }
    try {
      // IMPORTANT: pass `album.id` (string) — passing the album object can be
      // silently ignored by some platforms, returning the entire library.
      // Also: do NOT pass sortBy when filtering by album — it interferes with
      // some smart-album behavior. The screenshots album is already chronological.
      const r = await MediaLibrary.getAssetsAsync({
        album: album.id,
        first: count * 2,
        mediaType: MediaLibrary.MediaType.photo,
      });
      const seen = seenIdsRef.current;
      const unseen = r.assets.filter((a) => !seen.has(a.id));
      const batch = unseen.slice(0, count);
      filterCacheRef.current.screenshots = { assets: batch, currentIndex: 0 };
      return batch;
    } catch (e) {
      console.warn('fetchScreenshots failed:', e?.message);
      filterCacheRef.current.screenshots = { assets: [], currentIndex: 0 };
      return [];
    }
  }, [lookupScreenshotAlbum]);

  // -----------------------------------------------------------------------
  // Step 7: top up a filter's cache with TOPUP_SIZE more unseen assets.
  // Fires when the user swipes within TOPUP_THRESHOLD of the active batch's
  // end. No-op if a top-up for this filter is already in flight.
  // -----------------------------------------------------------------------
  const topUpCategory = useCallback(async (filter) => {
    if (topUpInFlightRef.current[filter]) return;
    topUpInFlightRef.current[filter] = true;
    try {
      if (filter === 'screenshots') {
        const album = screenshotAlbumRef.current;
        if (!album) return;
        const existing = filterCacheRef.current.screenshots?.assets || [];
        const existingIds = new Set(existing.map((a) => a.id));
        const seen = seenIdsRef.current;
        const r = await MediaLibrary.getAssetsAsync({
          album: album.id,
          first: existing.length + TOPUP_SIZE * 4,
          mediaType: MediaLibrary.MediaType.photo,
        });
        const fresh = r.assets.filter((a) => !seen.has(a.id) && !existingIds.has(a.id)).slice(0, TOPUP_SIZE);
        if (fresh.length === 0) return;
        const prev = filterCacheRef.current.screenshots || { assets: [], currentIndex: 0 };
        filterCacheRef.current.screenshots = {
          assets: [...prev.assets, ...fresh],
          currentIndex: prev.currentIndex,
        };
        if (activeFilterRef.current === 'screenshots') {
          dispatch({ type: 'APPEND_ASSETS', payload: fresh });
        }
        return;
      }

      const cache = allAssetsCache.current;
      if (!cache) return;
      const existing = filterCacheRef.current[filter]?.assets || [];
      const existingIds = new Set(existing.map((a) => a.id));
      const seen = seenIdsRef.current;
      const unseen = cache.filter((a) => !seen.has(a.id) && !existingIds.has(a.id));
      const sorted = applyFilter(filter, unseen);
      const newBatch = sorted.slice(0, TOPUP_SIZE);
      if (newBatch.length === 0) return;
      const prev = filterCacheRef.current[filter] || { assets: [], currentIndex: 0 };
      filterCacheRef.current[filter] = {
        assets: [...prev.assets, ...newBatch],
        currentIndex: prev.currentIndex,
      };
      if (activeFilterRef.current === filter) {
        dispatch({ type: 'APPEND_ASSETS', payload: newBatch });
      }
    } catch (e) {
      console.warn(`topUpCategory(${filter}) failed:`, e?.message);
    } finally {
      topUpInFlightRef.current[filter] = false;
    }
  }, [dispatch]);

  // -----------------------------------------------------------------------
  // Phase 1 helper: fetch INITIAL_BATCH unseen for a single category via
  // direct MediaLibrary (no native cache needed). Stores in filterCacheRef.
  // If this filter is the active one, also dispatches SET_ASSETS so the UI
  // updates the moment this category resolves.
  // Returns the loaded batch (or [] on failure).
  // -----------------------------------------------------------------------
  const loadCategoryDirect = useCallback(async (filter) => {
    try {
      let batch = [];
      if (filter === 'screenshots') {
        batch = await fetchScreenshots(INITIAL_BATCH);
      } else {
        const opts = { first: 100 };
        if (filter === 'newest') {
          opts.sortBy = [[MediaLibrary.SortBy.creationTime, false]];
          opts.mediaType = [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video];
        } else if (filter === 'photos') {
          opts.sortBy = [[MediaLibrary.SortBy.creationTime, true]];
          opts.mediaType = MediaLibrary.MediaType.photo;
        } else {
          // 'oldest' (and anything else routed here)
          opts.sortBy = [[MediaLibrary.SortBy.creationTime, true]];
          opts.mediaType = [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video];
        }
        const r = await MediaLibrary.getAssetsAsync(opts);
        const seen = seenIdsRef.current;
        const unseen = r.assets.filter((a) => !seen.has(a.id));
        batch = unseen.slice(0, INITIAL_BATCH);
        filterCacheRef.current[filter] = { assets: batch, currentIndex: 0 };
      }

      if (activeFilterRef.current === filter) {
        dispatch({ type: 'SET_ASSETS', payload: batch });
        warmupCards(batch);
      }
      return batch;
    } catch (e) {
      console.warn(`loadCategoryDirect(${filter}) failed:`, e?.message);
      return [];
    }
  }, [dispatch, fetchScreenshots, warmupCards]);

  // -----------------------------------------------------------------------
  // Phase 2: once the native asset cache is ready, fill the categories that
  // need fileSize / random-from-full-library: videos, largest, all.
  // -----------------------------------------------------------------------
  const phase2FillFromNativeCache = useCallback(() => {
    if (phase2DoneRef.current) return;
    phase2DoneRef.current = true;
    const cache = allAssetsCache.current;
    if (!cache) return;
    const seen = seenIdsRef.current;
    const filters = ['videos', 'largest', 'all'];
    for (const f of filters) {
      const unseen = cache.filter((a) => !seen.has(a.id));
      const sorted = applyFilter(f, unseen);
      const batch = sorted.slice(0, INITIAL_BATCH);
      filterCacheRef.current[f] = { assets: batch, currentIndex: 0 };
      if (activeFilterRef.current === f) {
        dispatch({ type: 'SET_ASSETS', payload: batch });
        warmupCards(batch);
      }
    }
  }, [dispatch, warmupCards]);

  // -----------------------------------------------------------------------
  // Phase 3: top up every category from INITIAL_BATCH (25) → BUFFER_TARGET (50).
  // Runs after Phase 2. Each topUpCategory call is idempotent and dispatches
  // APPEND_ASSETS for the active filter only.
  // -----------------------------------------------------------------------
  const phase3TopUpAll = useCallback(async () => {
    if (phase3DoneRef.current) return;
    phase3DoneRef.current = true;
    const all = ['oldest', 'newest', 'all', 'photos', 'videos', 'largest', 'screenshots'];
    for (const f of all) {
      // Fire sequentially with a microtask gap so we don't pin the JS thread.
      await topUpCategory(f);
    }
  }, [topUpCategory]);

  // -----------------------------------------------------------------------
  // Background asset cache + duplicate scan. Both run on native threads,
  // do not compete with JS, and are safe to fire as early as possible.
  // -----------------------------------------------------------------------
  const kickoffBackgroundPipeline = useCallback(() => {
    if (backgroundStartedRef.current) return;
    backgroundStartedRef.current = true;

    // Step 2: duplicate scan + AI (singleton — safe to call from here)
    duplicatesStore.startScan();

    // Build the native library cache. When ready, run phase 2 then phase 3.
    if (fileSizeModuleAvailable && !allAssetsCache.current) {
      getAllAssetsNative([1, 2])
        .then((nativeAssets) => {
          const cache = nativeAssets.map((a) => ({
            ...a,
            mediaType: a.mediaType === 'photo' ? 'photo' : 'video',
          }));
          allAssetsCache.current = cache;
          allAssetIdsRef.current = cache.map((a) => a.id);
          dispatch({ type: 'SET_LIBRARY_SIZE', payload: cache.length });
          setNativeCacheReady(true);
          // Phase 2: videos / largest / all
          phase2FillFromNativeCache();
          // Phase 3: top up everything to 50
          phase3TopUpAll();
        })
        .catch((e) => console.warn('getAllAssetsNative failed:', e?.message));
    }
  }, [dispatch, phase2FillFromNativeCache, phase3TopUpAll]);

  // -----------------------------------------------------------------------
  // Initial load orchestrator (Phase 1).
  //   1. Permission check
  //   2. Wait for persistLoaded (so seenIds is populated)
  //   3. Start dup scan + native cache build IN PARALLEL
  //   4. Parallel-load 25 of each: oldest, newest, photos, screenshots
  //      (videos + largest + all are filled in Phase 2 from the native cache)
  //   5. Whichever filter is active dispatches SET_ASSETS as soon as it
  //      resolves — usually 'oldest' first (~120ms).
  // -----------------------------------------------------------------------
  const initialLoad = useCallback(async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }
      if (!persistLoadedRef.current) await persistPromiseRef.current;

      // Load the ACTIVE filter first (oldest). Serial, so it's not contending
      // with 3 other native-bridge calls — this is what hides the splash.
      // Everything else happens after.
      await loadCategoryDirect('oldest');

      // Now fire the heavy background work + the other 3 Phase-1 categories
      // in parallel. The user is already swiping 'oldest' by this point.
      kickoffBackgroundPipeline();
      Promise.all([
        loadCategoryDirect('newest'),
        loadCategoryDirect('photos'),
        loadCategoryDirect('screenshots'),
      ]);
    } catch (err) {
      console.warn('initialLoad error:', err?.message);
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch, kickoffBackgroundPipeline, loadCategoryDirect]);

  // -----------------------------------------------------------------------
  // Filter-tap fallback: user taps a filter whose cache isn't populated yet.
  // Used by handleFilterChange when filterCacheRef.current[key] is empty.
  // -----------------------------------------------------------------------
  const loadFilterBatch = useCallback(async (filter) => {
    const myLoadId = ++loadIdRef.current;
    try {
      // Hot path: native cache is ready, slice from memory
      if (allAssetsCache.current && filter !== 'screenshots') {
        if (!persistLoadedRef.current) await persistPromiseRef.current;
        if (myLoadId !== loadIdRef.current) return;
        const seen = seenIdsRef.current;
        const unseen = allAssetsCache.current.filter((a) => !seen.has(a.id));
        const sorted = applyFilter(filter, unseen);
        const batch = sorted.slice(0, BUFFER_TARGET);
        filterCacheRef.current[filter] = { assets: batch, currentIndex: 0 };
        dispatch({ type: 'SET_ASSETS', payload: batch });
        warmupCards(batch);
        return;
      }
      // Cold path (or screenshots): direct MediaLibrary fetch
      await loadCategoryDirect(filter);
    } catch (err) {
      console.warn(`loadFilterBatch(${filter}) error:`, err?.message);
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch, loadCategoryDirect, warmupCards]);

  // Animate progress bar smoothly for largest filter
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: loadProgress.loaded,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [loadProgress.loaded]);

  // Pulse animation for indeterminate loading bar
  useEffect(() => {
    if (!loading && !loadingMore) return;
    pulseAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: false })
    );
    loop.start();
    return () => loop.stop();
  }, [loading, loadingMore]);

  // Load file size cache from disk on mount
  useEffect(() => {
    loadFileSizeCache().then((cache) => {
      fileSizeCache.current = cache || {};
      fileSizeCacheLoaded.current = true;
    });
  }, []);

  // Kick off the orchestrated initial load on mount. This:
  //   - parallel-loads 25 of oldest/newest/photos/screenshots via MediaLibrary
  //   - fires the duplicate scan + native asset cache build in parallel
  //   - dispatches SET_ASSETS for the active filter as soon as it resolves
  const didInitLoadRef = useRef(false);
  useEffect(() => {
    if (didInitLoadRef.current) return;
    didInitLoadRef.current = true;
    initialLoad();
  }, []);

  // Hide the custom splash overlay the moment the first batch is ready.
  const splashHiddenRef = useRef(false);
  useEffect(() => {
    if (splashHiddenRef.current) return;
    if (assets.length > 0 && !loading) {
      splashHiddenRef.current = true;
      if (splashRef.current) splashRef.current();
    }
  }, [assets.length, loading]);

  // Daily limit reset removed — was temporary for testing

  // Step 7: when the user gets within TOPUP_THRESHOLD of the end of the
  // active filter's buffer, top it up with TOPUP_SIZE more unseen assets.
  // Fires exactly once per crossing; topUpCategory has its own in-flight guard.
  useEffect(() => {
    if (assets.length === 0) return;
    const remaining = assets.length - currentIndex;
    if (remaining <= TOPUP_THRESHOLD) {
      topUpCategory(activeFilter);
    }
  }, [currentIndex, assets.length, activeFilter, topUpCategory]);

  // Background file size preloader — runs ONCE after initial load, fetches sizes
  // for all library assets so "Largest" filter is instant.
  // Survives tab switches — only cancels on true unmount.
  useEffect(() => {
    return () => {
      if (bgPreloadRef.current) bgPreloadRef.current.cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!nativeCacheReady || !allAssetIdsRef.current || !fileSizeCacheLoaded.current) return;
    // Already running or completed — don't restart
    if (bgPreloadRef.current) return;

    const token = { cancelled: false };
    bgPreloadRef.current = token;

    const ids = allAssetIdsRef.current;
    const CHUNK = 20;
    const DELAY = 200; // ms between fetch chunks

    let i = 0;

    const processChunk = async () => {
      if (token.cancelled) return;

      // Yield to filter loads — retry after a delay instead of competing for the bridge
      if (filterLoadingRef.current) {
        setTimeout(processChunk, 500);
        return;
      }

      // Scan forward, skipping cached IDs (instant — no delay for cached)
      const toFetch = [];
      while (toFetch.length < CHUNK && i < ids.length) {
        const id = ids[i++];
        if (!fileSizeCache.current[id]) toFetch.push(id);
      }

      // Nothing to fetch — either all cached or we've processed everything
      if (toFetch.length === 0) {
        saveFileSizeCache(fileSizeCache.current);
        return;
      }

      // Fetch uncached sizes
      await Promise.all(toFetch.map(async (id) => {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(id);
          if (info.fileSize > 0) fileSizeCache.current[id] = info.fileSize;
        } catch {}
      }));

      // Periodic save every ~500 fetched
      if (i % 500 < CHUNK) saveFileSizeCache(fileSizeCache.current);

      // Continue with delay (only after actual fetches — cached chunks are instant)
      if (!token.cancelled) setTimeout(processChunk, DELAY);
    };

    // Start after 2s to let the UI settle after initial load
    setTimeout(processChunk, 2000);
    // No cleanup here — the unmount effect above handles cancellation
  }, [nativeCacheReady]);

  // Keep cache in sync as user swipes — only on index change, NOT on filter change
  useEffect(() => {
    const cur = assetsRef.current;
    if (cur.length > 0 && !loading && currentIndex > 0) {
      filterCacheRef.current[activeFilterRef.current] = { assets: cur, currentIndex };
    }
  }, [currentIndex]);

  const handleFilterChange = (key) => {
    if (key === activeFilter) return;

    // Save current filter state before switching — but only if not still loading
    if (assets.length > 0 && !loading) {
      filterCacheRef.current[activeFilter] = { assets, currentIndex };
    }

    setActiveFilter(key);
    activeFilterRef.current = key;

    // Restore from cache if available (the common case after prefill)
    const cached = filterCacheRef.current[key];
    if (cached && cached.assets.length > 0 && cached.currentIndex < cached.assets.length) {
      dispatch({ type: 'RESTORE_FILTER', payload: cached });
      return;
    }

    // Race-condition fallback: user tapped a filter before the native cache
    // prefilled it. Do a direct fast-path load for that filter.
    dispatch({ type: 'SET_LOADING', payload: true });
    loadFilterBatch(key);
  };

  const cardRef = useRef(null);

  const currentAsset = assets[currentIndex];
  const nextAsset = assets[currentIndex + 1];

  // Two-card alternating keys: the preview card becomes the active card
  // WITHOUT remounting (same React key). This eliminates the 1-frame flash
  // that happens when a new Image component mounts and hasn't loaded yet.
  // Even indices: slot A = active, slot B = preview
  // Odd indices:  slot B = active, slot A = preview
  const isEven = currentIndex % 2 === 0;
  const activeKey = (isEven ? 'A-' : 'B-') + currentAsset?.id;
  const previewKey = nextAsset ? (isEven ? 'B-' : 'A-') + nextAsset.id : null;

  // Prefetch images for upcoming cards (deferred until after animations complete)
  const prefetchIdRef = useRef(0);
  useEffect(() => {
    const myPrefetchId = ++prefetchIdRef.current;
    const task = InteractionManager.runAfterInteractions(() => {
      const LOOKAHEAD = 5;
      const curAssets = assetsRef.current;
      for (let i = 2; i <= LOOKAHEAD; i++) {
        if (myPrefetchId !== prefetchIdRef.current) return;
        const a = curAssets[currentIndex + i];
        if (a) Image.prefetch(a.uri);
      }
    });
    return () => task.cancel();
  }, [currentIndex]);

  const handleTrash = useCallback(() => {
    if (cardRef.current) cardRef.current.swipeLeft();
    else trash();
  }, [trash]);
  const handleKeep = useCallback(() => {
    if (cardRef.current) cardRef.current.swipeRight();
    else keep();
  }, [keep]);

  const handleShare = async () => {
    if (!currentAsset) return;
    try {
      const info = await MediaLibrary.getAssetInfoAsync(currentAsset.id);
      if (info.localUri) {
        await Sharing.shareAsync(info.localUri);
      }
    } catch (e) {
      console.warn('Share failed:', e);
    }
  };

  const containerStyle = [styles.container, { paddingTop: insets.top, backgroundColor: theme.bg }];
  const [permStatus, setPermStatus] = useState(null);
  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.getPermissionsAsync();
      setPermStatus(status);
    })();
  }, []);

  const fileSizeTimerRef = useRef(null);
  const pendingFileSizes = useRef([]);
  const handleFileSizeLoaded = useCallback((id, size) => {
    // Batch file size updates into a single dispatch
    pendingFileSizes.current.push({ assetId: id, fileSize: size });
    if (fileSizeTimerRef.current) clearTimeout(fileSizeTimerRef.current);
    fileSizeTimerRef.current = setTimeout(() => {
      const batch = pendingFileSizes.current;
      pendingFileSizes.current = [];
      dispatch({ type: 'SET_FILE_SIZES', payload: batch });
    }, 500);
  }, [dispatch]);
  const handleToggleMute = useCallback(() => setMuted((m) => !m), []);
  const handleEnterComplete = useCallback(() => setEnterFrom(null), []);

  const swipesLeft = Math.max(0, DAILY_FREE_LIMIT - dailySwipes);

  const filterBar = (
    <View style={styles.filterRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
        style={{ flexGrow: 0, marginRight: 80 }}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, { backgroundColor: theme.card, borderColor: theme.border }, activeFilter === f.key && styles.filterChipActive]}
            onPress={() => handleFilterChange(f.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterText, { color: theme.textSecondary }, activeFilter === f.key && styles.filterTextActive]}>
              {t(f.label)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {isPro ? (
        <View style={styles.proTagAbsolute}>
          <View style={[styles.proTagA, { backgroundColor: theme.isDark ? '#2a2548' : '#e8e5f5' }]}>
            <Ionicons name="bag-check-outline" size={13} color="#5856D6" />
            <Text style={styles.proTextA}>Pro</Text>
          </View>
        </View>
      ) : (
        <View style={styles.proTagAbsolute}>
          <TouchableOpacity onPress={() => navigation.navigate('Stats', { scrollToUpgrade: true })} activeOpacity={0.7} style={[styles.proTagA, { backgroundColor: theme.isDark ? '#2a2548' : '#e8e5f5' }]}>
            <Ionicons name="bag-outline" size={13} color="#5856D6" />
            <Text style={styles.proTextA}>{swipesLeft}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (permStatus === 'denied') {
    return (
      <View style={containerStyle}>
        <Ionicons name="lock-closed-outline" size={48} color={theme.textSecondary} style={{ marginBottom: 16 }} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('swipe.permissionTitle')}</Text>
        <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
          {t('swipe.permissionSubtitle')}
        </Text>
        <TouchableOpacity onPress={() => Linking.openSettings()} style={styles.resetSeenButton} activeOpacity={0.7}>
          <Ionicons name="settings-outline" size={18} color={theme.accent} style={{ marginRight: 6 }} />
          <Text style={styles.resetSeenText}>{t('swipe.openSettings')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading || loadingMore) {
    const { loaded, total } = loadProgress;
    const isLargestLoading = activeFilter === 'largest' && loaded > 0 && loaded <= 100;
    const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    return (
      <View style={containerStyle}>
        {filterBar}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {isLargestLoading ? (
            <>
              <Text style={[styles.loadingText, { color: theme.textSecondary }]}>{t('swipe.analyzingSize')}</Text>
              <View style={[styles.progressBarBg, { backgroundColor: theme.progressBg }]}>
                <Animated.View style={[styles.progressBarFill, { backgroundColor: theme.progressFill, width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
              </View>
              <Text style={[styles.loadingCount, { color: theme.textTertiary }]}>{loaded}%</Text>
            </>
          ) : (
            <>
              <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                {loadingMore ? t('swipe.loadingMore') : t('swipe.scanning')}
              </Text>
              {total > 0 ? (
                <>
                  <View style={[styles.progressBarBg, { backgroundColor: theme.progressBg }]}>
                    <View style={[styles.progressBarFill, { position: 'absolute', width: `${pct}%`, backgroundColor: theme.progressFill }]} />
                  </View>
                  <Text style={[styles.loadingCount, { color: theme.textTertiary }]}>{loaded.toLocaleString()} / {total.toLocaleString()} ({pct}%)</Text>
                </>
              ) : (
                <View style={[styles.progressBarBg, { backgroundColor: theme.progressBg }]}>
                  <Animated.View style={[styles.progressBarFill, { backgroundColor: theme.progressFill, width: '40%', left: pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-40%', '30%', '100%'] }) }]} />
                </View>
              )}
            </>
          )}
        </View>
      </View>
    );
  }

  // Daily limit reached — paywall (skip if pro)
  if (dailyLimitReached && !isPro) {
    return (
      <View style={containerStyle}>
        {filterBar}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="lock-closed" size={48} color={theme.text} style={{ marginBottom: 16 }} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('swipe.dailyLimitTitle')}</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            {t('swipe.dailyLimitSubtitle', { limit: DAILY_FREE_LIMIT })}
          </Text>
          <View style={styles.statsSummary}>
            <Text style={[styles.statKept, { color: colors.green }]}>{t('swipe.kept', { count: totalKept })}</Text>
            <Text style={[styles.statTrashed, { color: colors.red }]}>{t('swipe.trashed', { count: totalTrashed })}</Text>
          </View>
          <View style={styles.upgradeOptions}>
            <TouchableOpacity style={styles.upgradeButton} activeOpacity={0.7} onPress={() => purchaseProduct('com.pieterpreseun.swipeclean.pro')}>
              <Ionicons name="infinite" size={20} color="#fff" style={{ marginBottom: 4 }} />
              <Text style={[styles.upgradeTitle, { color: '#fff' }]}>{t('swipe.unlimited')}</Text>
              <Text style={styles.upgradePrice}>{proProduct?.price ? `${proProduct.price} ${t('swipe.oneTimeLabel')}` : t('swipe.oneTimePrice')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.upgradeButton, styles.subscribeButton, { backgroundColor: theme.card, borderColor: theme.accent }]} activeOpacity={0.7} onPress={() => purchaseProduct('com.pieterpreseun.swipeclean.weekly')}>
              <Ionicons name="refresh" size={20} color={theme.text} style={{ marginBottom: 4 }} />
              <Text style={[styles.upgradeTitle, { color: theme.text }]}>{t('swipe.weekly')}</Text>
              <Text style={styles.upgradePrice}>{weeklyProduct?.price ? `${weeklyProduct.price}/${t('swipe.weekLabel')}` : t('swipe.weeklyPrice')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.legalText, { color: theme.textQuaternary }]}>
            {t('swipe.legalText')}
          </Text>
          <TouchableOpacity onPress={restorePurchases} activeOpacity={0.7}>
            <Text style={styles.restoreText}>{t('swipe.restorePurchases')}</Text>
          </TouchableOpacity>
          <Text style={[styles.resetHint, { color: theme.textQuaternary }]}>{t('swipe.freeSwipesReset')}</Text>
        </View>
      </View>
    );
  }

  if (!currentAsset) {
    return (
      <View style={containerStyle}>
        {filterBar}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('swipe.allDoneTitle')}</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            {t('swipe.allDoneSubtitle')}
          </Text>
          <View style={styles.statsSummary}>
            <Text style={[styles.statKept, { color: colors.green }]}>{t('swipe.kept', { count: totalKept })}</Text>
            <Text style={[styles.statTrashed, { color: colors.red }]}>{t('swipe.trashed', { count: totalTrashed })}</Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                t('swipe.startFreshTitle'),
                t('swipe.startFreshMessage'),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('common.reset'), onPress: () => {
                    resetSeenIds();
                    // Clear in-memory caches so everything reloads fresh
                    filterCacheRef.current = {};
                    phase2DoneRef.current = false;
                    phase3DoneRef.current = false;
                    backgroundStartedRef.current = false;
                    allAssetsCache.current = null;
                    allAssetIdsRef.current = null;
                    setNativeCacheReady(false);
                    initialLoad();
                  } },
                ]
              );
            }}
            style={styles.resetSeenButton}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={18} color={theme.accent} style={{ marginRight: 6 }} />
            <Text style={styles.resetSeenText}>{t('swipe.showAllPhotos')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const cardStack = (
    <View style={styles.cardContainer}>
      <View style={styles.cardWrapper}>
        <View style={[styles.cardShadow, { backgroundColor: theme.card }]} />
        {nextAsset && (
          <SwipeCard
            key={previewKey}
            asset={nextAsset}
            isPreview
            onFileSizeLoaded={handleFileSizeLoaded}
            onShare={handleShare}
          />
        )}
        <SwipeCard
          key={activeKey}
          ref={cardRef}
          asset={currentAsset}
          onSwipeLeft={trash}
          onSwipeRight={keep}
          muted={muted}
          onToggleMute={handleToggleMute}
          screenFocused={isFocused}
          enterFrom={enterFrom}
          onEnterComplete={handleEnterComplete}
          onFileSizeLoaded={handleFileSizeLoaded}
          totalKept={totalKept}
          totalTrashed={totalTrashed}
          onShare={handleShare}
        />
      </View>
    </View>
  );


  const actionButtons = (
    <View style={styles.buttonRowOuter}>
      <View style={styles.buttonRow}>
        <View style={styles.buttonWrap}>
          <TouchableOpacity
            style={[styles.actionButton, styles.trashBtn, { borderColor: colors.red, backgroundColor: colors.redBgLight }]}
            onPress={handleTrash}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={Math.round(BTN_SIZE * 0.39)} color={colors.red} />
          </TouchableOpacity>
          <Text style={[styles.buttonLabel, { color: colors.red }]} numberOfLines={1} adjustsFontSizeToFit>{t('card.trash')}</Text>
        </View>

        <View style={styles.buttonWrap}>
          <TouchableOpacity
            style={[styles.actionButton, styles.undoBtn, { borderColor: colors.undo, backgroundColor: colors.undoBg }]}
            onPress={() => {
              const last = state.history[state.history.length - 1];
              if (last) {
                setEnterFrom(last.action === 'trash' ? 'left' : 'right');
                undo();
              }
            }}
            activeOpacity={0.7}
            disabled={state.history.length === 0}
          >
            <Ionicons name="arrow-undo" size={Math.round(UNDO_SIZE * 0.39)} color={colors.undo} />
          </TouchableOpacity>
          <Text style={[styles.buttonLabelUndo, { color: colors.undo }]} numberOfLines={1} adjustsFontSizeToFit>{t('card.undo')}</Text>
        </View>

        <View style={styles.buttonWrap}>
          <TouchableOpacity
            style={[styles.actionButton, styles.keepBtn, { borderColor: colors.green, backgroundColor: colors.greenBgLight }]}
            onPress={handleKeep}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark" size={Math.round(BTN_SIZE * 0.39)} color={colors.green} />
          </TouchableOpacity>
          <Text style={[styles.buttonLabel, { color: colors.green }]} numberOfLines={1} adjustsFontSizeToFit>{t('card.keep')}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={containerStyle}>
      {filterBar}
      {cardStack}
      <MilestoneOverlay totalReviewed={totalKept + totalTrashed} />
      {actionButtons}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#888',
    marginTop: 16,
    fontSize: sw(16),
  },
  loadingCount: {
    color: '#666',
    fontSize: sw(13),
    marginTop: 6,
  },
  progressBarBg: {
    width: 200,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#333',
    marginTop: 16,
    overflow: 'hidden',
  },
  progressBarFill: {
    position: 'absolute',
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#5856D6',
  },
  emptyTitle: {
    color: '#fff',
    fontSize: sw(28),
    fontWeight: '700',
    marginBottom: 12,
  },
  emptySubtitle: {
    color: '#888',
    fontSize: sw(16),
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: sw(24),
  },
  statsSummary: {
    flexDirection: 'row',
    marginTop: 30,
    gap: 30,
  },
  statKept: {
    fontSize: sw(20),
    fontWeight: '700',
  },
  statTrashed: {
    fontSize: sw(20),
    fontWeight: '700',
  },
  upgradeOptions: {
    flexDirection: 'row',
    marginTop: 30,
    gap: 12,
    paddingHorizontal: 30,
  },
  upgradeButton: {
    flex: 1,
    backgroundColor: '#5856D6',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  subscribeButton: {
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#5856D6',
  },
  upgradeTitle: {
    color: '#fff',
    fontSize: sw(16),
    fontWeight: '800',
  },
  upgradePrice: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: sw(13),
    marginTop: 2,
  },
  resetHint: {
    color: '#555',
    fontSize: sw(13),
    marginTop: 16,
  },
  legalText: {
    color: '#555',
    fontSize: sw(11),
    textAlign: 'center',
    paddingHorizontal: 30,
    marginTop: 14,
    lineHeight: sw(16),
  },
  restoreText: {
    color: '#5856D6',
    fontSize: sw(13),
    fontWeight: '600',
    marginTop: 12,
  },
  cardContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 8,
  },
  cardWrapper: {
    width: CARD_WIDTH,
    flex: 1,
    marginBottom: 10,
  },
  cardShadow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  cardShareBtn: {
    position: 'absolute',
    bottom: 12,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    zIndex: 10,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
    overflow: 'visible',
  },
  buttonRowOuter: {
    alignItems: 'center',
    paddingBottom: Math.round(SCREEN_HEIGHT * 0.012),
    paddingTop: 4,
    width: '100%',
  },
  buttonSide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  actionButton: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  keepBtn: {
  },
  trashBtn: {
  },
  undoBtn: {
    width: UNDO_SIZE,
    height: UNDO_SIZE,
    borderRadius: UNDO_SIZE / 2,
  },
  shareBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#555',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonWrap: {
    alignItems: 'center',
    maxWidth: BTN_SIZE,
  },
  buttonLabel: {
    fontSize: sw(10),
    fontWeight: '700',
    marginTop: 5,
    letterSpacing: 0.5,
  },
  buttonLabelUndo: {
    fontSize: sw(10),
    fontWeight: '700',
    marginTop: 5,
    letterSpacing: 0.5,
  },
  resetSeenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#5856D6',
  },
  resetSeenText: {
    color: '#5856D6',
    fontSize: sw(16),
    fontWeight: '700',
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: sw(20),
    paddingRight: 8,
    paddingVertical: Math.round(SCREEN_HEIGHT * 0.009),
    gap: 10,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Math.round(SCALE_WIDTH * 0.032),
    paddingVertical: Math.round(SCREEN_HEIGHT * 0.007),
    borderRadius: 20,
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#333',
  },
  filterChipActive: {
    backgroundColor: '#5856D6',
    borderColor: '#5856D6',
  },
  filterText: {
    color: '#888',
    fontSize: Math.max(11, Math.round(SCALE_WIDTH * 0.033)),
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#fff',
  },

  /* ─── Design A: Minimal ─── */
  statsBarA: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 24,
    paddingVertical: Math.round(SCREEN_HEIGHT * 0.009),
    zIndex: 1,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statA: {
    fontSize: Math.max(11, Math.round(SCALE_WIDTH * 0.033)),
    fontWeight: '600',
  },
  proTagAbsolute: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingRight: sw(20),
    zIndex: 5,
  },
  proTagA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#5856D620',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#5856D630',
  },
  proTextA: {
    color: '#5856D6',
    fontSize: Math.max(11, Math.round(SCALE_WIDTH * 0.033)),
    fontWeight: '700',
  },

});
