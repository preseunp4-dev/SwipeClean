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
import { getAllFileSizesSorted, isAvailable as fileSizeModuleAvailable } from '../../modules/file-size-module';
import { loadFileSizeCache, saveFileSizeCache } from '../utils/storage';
import { sw } from '../utils/scale';

const PAGE_SIZE = 200;

const FILTERS = [
  { key: 'oldest', label: 'swipe.filterOldest' },
  { key: 'newest', label: 'swipe.filterNewest' },
  { key: 'all', label: 'swipe.filterRandom' },
  { key: 'largest', label: 'swipe.filterLargest' },
  { key: 'videos', label: 'swipe.filterVideos' },
  { key: 'screenshots', label: 'swipe.filterScreenshots' },
];

// Fisher-Yates shuffle
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
  const [enterFrom, setEnterFrom] = useState(null);
  const filterCacheRef = useRef({});
  const fileSizeCache = useRef({});
  const fileSizeCacheLoaded = useRef(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const loadIdRef = useRef(0);
  const allAssetIdsRef = useRef(null); // All library asset IDs for background preload
  const bgPreloadRef = useRef(null);   // Background preload cancel token
  const filterLoadingRef = useRef(false); // True while a filter load is fetching file sizes
  const isFocused = useIsFocused();
  const navigation = useNavigation();

  const seenIdsRef = useRef(seenIds);
  useEffect(() => { seenIdsRef.current = seenIds; }, [seenIds]);
  const assetsRef = useRef(assets);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

  const loadAssets = useCallback(
    async (filter = 'all', skipIds = null) => {
      const myLoadId = ++loadIdRef.current;
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') {
          dispatch({ type: 'SET_LOADING', payload: false });
          return;
        }

        // Skip swiped assets + current batch assets (to avoid duplicates on reload)
        const baseIds = skipIds || seenIdsRef.current;
        const idsToSkip = new Set(baseIds);
        // Also skip assets currently in the batch that haven't been swiped yet
        for (const a of assetsRef.current || []) idsToSkip.add(a.id);

        // Screenshots filter: find the Screenshots smart album (name is localized on iOS)
        let screenshotAlbum = null;
        if (filter === 'screenshots') {
          const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
          const keywords = [
            'screenshot', 'screen shot',
            'scherm',          // NL
            'bildschirmfoto',  // DE
            'capture',         // FR
            'captura',         // ES/PT
            'istantan',        // IT
            'skärmbild', 'skjermbild', 'skærmbillede', // SV/NO/DA
            'kuvakaappau',     // FI
            'zrzut',           // PL
            'снимк', 'скриншот', // RU
            'スクリーンショット',  // JA
            '스크린샷',          // KO
            '截屏', '螢幕快照',   // ZH
            'لقطات',           // AR
            'ekran görüntü',   // TR
          ];
          screenshotAlbum = albums.find((a) => {
            const t = a.title.toLowerCase();
            return keywords.some((kw) => t.includes(kw));
          });
          if (!screenshotAlbum) {
            dispatch({ type: 'SET_ASSETS', payload: [] });
            return;
          }
        }

        // Collect ALL asset IDs from the entire library (metadata only, fast)
        let allAssets = [];
        let cursor = undefined;
        let hasNext = true;
        const loadPhotos = filter !== 'videos';
        const loadVideos = filter !== 'screenshots';
        let libraryTotal = 0;
        setLoadProgress({ loaded: 0, total: 0 });
        progressAnim.setValue(0);
        let knownTotal = 0;

        if (loadPhotos) {
          cursor = undefined; hasNext = true;
          while (hasNext) {
            if (myLoadId !== loadIdRef.current) return;
            const opts = {
              first: 1000,
              after: cursor || undefined,
              mediaType: MediaLibrary.MediaType.photo,
            };
            if (screenshotAlbum) opts.album = screenshotAlbum;
            const r = await MediaLibrary.getAssetsAsync(opts);
            if (!cursor) {
              if (filter === 'all') libraryTotal += r.totalCount;
              knownTotal += r.totalCount;
            }
            allAssets.push(...r.assets);
            setLoadProgress({ loaded: allAssets.length, total: knownTotal });
            hasNext = r.hasNextPage;
            if (r.assets.length > 0) cursor = r.assets[r.assets.length - 1].id;
            else break;
          }
        }

        if (loadVideos) {
          cursor = undefined; hasNext = true;
          while (hasNext) {
            if (myLoadId !== loadIdRef.current) return;
            const r = await MediaLibrary.getAssetsAsync({
              first: 1000,
              after: cursor || undefined,
              mediaType: MediaLibrary.MediaType.video,
            });
            if (!cursor) {
              if (filter === 'all') libraryTotal += r.totalCount;
              knownTotal += r.totalCount;
            }
            allAssets.push(...r.assets);
            setLoadProgress({ loaded: allAssets.length, total: knownTotal });
            hasNext = r.hasNextPage;
            if (r.assets.length > 0) cursor = r.assets[r.assets.length - 1].id;
            else break;
          }
        }

        // Store total library size for Stats screen (use MediaLibrary's totalCount for accuracy)
        if (filter === 'all') {
          dispatch({ type: 'SET_LIBRARY_SIZE', payload: libraryTotal });
          // Save all asset IDs for background file size preloading
          allAssetIdsRef.current = allAssets.map((a) => a.id);
        }

        // Filter out already seen/swiped
        const unseen = allAssets.filter((a) => !idsToSkip.has(a.id));

        let batch;
        if (filter === 'oldest') {
          batch = unseen.sort((a, b) => a.creationTime - b.creationTime).slice(0, PAGE_SIZE);
        } else if (filter === 'newest') {
          batch = unseen.sort((a, b) => b.creationTime - a.creationTime).slice(0, PAGE_SIZE);
        } else if (filter === 'largest') {
          if (fileSizeModuleAvailable) {
            // Native module: get ALL assets sorted by real file size via PHAssetResource
            const sorted = await getAllFileSizesSorted([1, 2]); // photos + videos
            // Build a lookup of id -> fileSize
            const sizeMap = {};
            for (const item of sorted) {
              sizeMap[item.id] = item.fileSize;
            }
            // Match with unseen assets and apply real sizes (without mutating originals)
            const unseenMap = {};
            for (const a of unseen) unseenMap[a.id] = a;
            const matched = [];
            for (const item of sorted) {
              const asset = unseenMap[item.id];
              if (asset) {
                matched.push({ ...asset, fileSize: item.fileSize });
              }
              if (matched.length >= PAGE_SIZE) break;
            }
            batch = matched;
          } else {
            // Fallback: use cached sizes if available, fetch only what's missing
            const unseenWithCache = unseen.map((a) => {
              if (!a.fileSize && fileSizeCache.current[a.id]) {
                return { ...a, fileSize: fileSizeCache.current[a.id] };
              }
              return a;
            });

            // Check how many unseen assets have cached sizes
            const withSize = unseenWithCache.filter((a) => a.fileSize > 0);

            if (withSize.length >= PAGE_SIZE) {
              // Enough cached sizes — sort instantly, no fetching needed
              batch = unseenWithCache
                .sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0))
                .slice(0, PAGE_SIZE);
            } else {
              // Not enough cached — fetch for top candidates
              const proxyScore = (a) =>
                a.fileSize || ((a.width || 0) * (a.height || 0) + (a.duration || 0) * 1000000);
              const CANDIDATES = PAGE_SIZE * 2;
              const candidates = unseenWithCache.sort((a, b) => proxyScore(b) - proxyScore(a)).slice(0, CANDIDATES);
              const toFetch = candidates.filter((a) => !a.fileSize);
              if (toFetch.length > 0) {
                filterLoadingRef.current = true;
                const CHUNK = 20;
                for (let i = 0; i < toFetch.length; i += CHUNK) {
                  if (myLoadId !== loadIdRef.current) {
                    filterLoadingRef.current = false;
                    saveFileSizeCache(fileSizeCache.current);
                    return;
                  }
                  await Promise.all(toFetch.slice(i, i + CHUNK).map(async (a) => {
                    try {
                      const info = await MediaLibrary.getAssetInfoAsync(a.id);
                      if (info.fileSize > 0) {
                        fileSizeCache.current[a.id] = info.fileSize;
                      }
                    } catch {}
                  }));
                  setLoadProgress({ loaded: Math.min(Math.round(((i + CHUNK) / toFetch.length) * 100), 100), total: 100 });
                }
                filterLoadingRef.current = false;
                saveFileSizeCache(fileSizeCache.current);
              }
              batch = candidates
                .map((a) => fileSizeCache.current[a.id] ? { ...a, fileSize: fileSizeCache.current[a.id] } : a)
                .sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0))
                .slice(0, PAGE_SIZE);
            }
          }
        } else {
          batch = shuffle(unseen).slice(0, PAGE_SIZE);
        }

        // If a newer load was started, abandon this one
        if (myLoadId !== loadIdRef.current) return;

        dispatch({ type: 'SET_ASSETS', payload: batch });

        // Cache the result for this filter immediately
        filterCacheRef.current[filter] = { assets: batch, currentIndex: 0 };

        // Background: prefetch images + file sizes for the first 5 cards
        (async () => {
          for (const a of batch.slice(0, 5)) {
            if (myLoadId !== loadIdRef.current) return;
            try {
              Image.prefetch(a.uri);
              if (!a.fileSize) {
                const info = await MediaLibrary.getAssetInfoAsync(a.id);
                if (myLoadId !== loadIdRef.current) return;
                if (info.fileSize > 0) {
                  dispatch({ type: 'SET_FILE_SIZE', payload: { assetId: a.id, fileSize: info.fileSize } });
                }
              }
            } catch (e) {
              console.warn('Prefetch failed:', a.id, e.message);
            }
          }
        })();

        if (batch.length === 0) {
          dispatch({ type: 'APPEND_ASSETS', payload: [] });
        }
      } catch (err) {
        console.warn('Error loading assets:', err);
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    },
    [dispatch]
  );

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

  useEffect(() => { if (persistLoaded) loadAssets(activeFilter); }, [persistLoaded]);

  // Daily limit reset removed — was temporary for testing

  useEffect(() => {
    if (assets.length > 0 && currentIndex >= assets.length && hasMore && !loadingMore) {
      setLoadingMore(true);
      loadAssets(activeFilter).then(() => setLoadingMore(false));
    }
  }, [currentIndex, assets.length, hasMore, loadingMore, loadAssets, activeFilter]);

  // Background file size preloader — runs ONCE after initial load, fetches sizes
  // for all library assets so "Largest" filter is instant.
  // Survives tab switches — only cancels on true unmount.
  useEffect(() => {
    return () => {
      if (bgPreloadRef.current) bgPreloadRef.current.cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || !allAssetIdsRef.current || !fileSizeCacheLoaded.current) return;
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
  }, [loading]);

  // Keep cache in sync as user swipes through current filter (use refs to avoid re-render deps)
  useEffect(() => {
    const cur = assetsRef.current;
    if (cur.length > 0 && !loading) {
      filterCacheRef.current[activeFilter] = { assets: cur, currentIndex };
    }
  }, [currentIndex, activeFilter, loading]);

  const handleFilterChange = (key) => {
    if (key === activeFilter) return;

    // Save current filter state before switching — but only if not still loading
    if (assets.length > 0 && !loading) {
      filterCacheRef.current[activeFilter] = { assets, currentIndex };
    }

    setActiveFilter(key);

    // Restore from cache if available
    const cached = filterCacheRef.current[key];
    if (cached && cached.assets.length > 0 && cached.currentIndex < cached.assets.length) {
      dispatch({ type: 'RESTORE_FILTER', payload: cached });
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });
    loadAssets(key, seenIds);
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

  const filterBar = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterBar}
      style={{ flexGrow: 0, zIndex: 1 }}
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
                  { text: t('common.reset'), onPress: () => { resetSeenIds(); loadAssets(); } },
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

  const swipesLeft = Math.max(0, DAILY_FREE_LIMIT - dailySwipes);

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
        />
      </View>
    </View>
  );

  const middleRow = (
    <View style={styles.middleRow}>
      {isPro ? (
        <View style={[styles.proTagA, { backgroundColor: '#FFD60A', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }]}>
          <Ionicons name="star" size={11} color="#000" />
          <Text style={[styles.proTextA, { color: '#000' }]}>Pro</Text>
        </View>
      ) : (
        <TouchableOpacity onPress={() => navigation.navigate('Stats', { scrollToUpgrade: true })} activeOpacity={0.7} style={styles.proTagA}>
          <Ionicons name="star" size={11} color="#5856D6" />
          <Text style={styles.proTextA}>{t('swipe.leftUpgrade', { count: swipesLeft })}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[styles.shareBtn, { borderColor: theme.textQuaternary, backgroundColor: theme.shareBtn }]}
        onPress={handleShare}
        activeOpacity={0.7}
      >
        <Ionicons name="share-outline" size={18} color={theme.text} />
      </TouchableOpacity>
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
      {middleRow}
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
    paddingTop: Math.round(SCREEN_HEIGHT * 0.007),
  },
  cardWrapper: {
    width: CARD_WIDTH,
    flex: 1,
    maxHeight: CARD_HEIGHT,
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
  middleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    width: '100%',
  },
  buttonRowOuter: {
    alignItems: 'center',
    paddingBottom: Math.max(Math.round(SCREEN_HEIGHT * 0.012), 4),
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
    paddingHorizontal: 16,
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
