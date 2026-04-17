import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Pressable,
  FlatList,
  ScrollView,
  Alert,
  Dimensions,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
  Modal,
  Linking,
} from 'react-native';
import { PanGestureHandler, State, NativeViewGestureHandler, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import ZoomableImage from '../components/ZoomableImage';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { usePurchases } from '../context/PurchaseContext';
import { useColors } from '../context/ColorContext';
import { loadDismissedGroups, saveDismissedGroups } from '../utils/storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { sw, sh } from '../utils/scale';
import * as duplicatesStore from '../utils/duplicatesStore';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const THUMB_SIZE = Math.floor((SCREEN_W - 6) / 3);

const DISMISS_ANIM = {
  duration: 300,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

import { formatBytes } from '../utils/formatting';

// Stable group key based on sorted asset IDs
function groupKey(assets) {
  return assets.map((a) => a.id).sort().join('|');
}

const DOT_SIZE = 6;
const DOT_ACTIVE_W = 16;

function ExpandedGallery({ group, initialAssetId, onClose, onToggleTrash, origin }) {
  const { colors } = useColors();
  const insets = useSafeAreaInsets();
  const initialIdx = Math.max(0, group.assets.findIndex((a) => a.id === initialAssetId));
  const [activeIndex, setActiveIndex] = useState(initialIdx);
  const scrollX = useRef(new Animated.Value(initialIdx * SCREEN_W)).current;
  const flatListRef = useRef(null);
  const closingRef = useRef(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const count = group.assets.length;

  // Calculate origin-based start values
  const hasOrigin = !!origin;
  const originScale = hasOrigin ? origin.w / SCREEN_W : 0.92;
  const originTx = hasOrigin ? (origin.x + origin.w / 2) - SCREEN_W / 2 : 0;
  const originTy = hasOrigin ? (origin.y + origin.h / 2) - SCREEN_H / 2 : 0;

  // Dismiss gesture animated values
  const dismissY = useRef(new Animated.Value(0)).current;
  const dismissScale = useRef(new Animated.Value(originScale)).current;
  const dismissBg = useRef(new Animated.Value(0)).current;
  const openTx = useRef(new Animated.Value(originTx)).current;
  const openTy = useRef(new Animated.Value(originTy)).current;

  // Animate from thumbnail to fullscreen
  useEffect(() => {
    Animated.parallel([
      Animated.spring(dismissScale, {
        toValue: 1,
        tension: 50,
        friction: 9,
        useNativeDriver: true,
      }),
      Animated.spring(openTx, {
        toValue: 0,
        tension: 50,
        friction: 9,
        useNativeDriver: true,
      }),
      Animated.spring(openTy, {
        toValue: 0,
        tension: 50,
        friction: 9,
        useNativeDriver: true,
      }),
      Animated.timing(dismissBg, {
        toValue: 1,
        duration: 250,
        useNativeDriver: false,
      }),
    ]).start();
  }, []);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
  }, [onClose]);

  const nativeRef = useRef(null);
  const panRef = useRef(null);
  const dismissActiveRef = useRef(false);
  const onDismissGesture = useCallback(({ nativeEvent }) => {
    const { translationY, translationX } = nativeEvent;
    if (translationY > 0 && translationY > Math.abs(translationX)) {
      dismissActiveRef.current = true;
      dismissY.setValue(translationY);
      const progress = Math.min(translationY / 300, 1);
      dismissScale.setValue(1 - progress * 0.3);
      dismissBg.setValue(1 - progress);
    }
  }, []);

  const onDismissStateChange = useCallback(({ nativeEvent }) => {
    if (nativeEvent.oldState === State.ACTIVE) {
      if (!dismissActiveRef.current) return;
      dismissActiveRef.current = false;
      const { translationY, velocityY } = nativeEvent;
      if (translationY > 120 || velocityY > 500) {
        Animated.timing(dismissY, { toValue: SCREEN_H, duration: 250, useNativeDriver: true }).start();
        Animated.timing(dismissScale, { toValue: 0.5, duration: 250, useNativeDriver: true }).start();
        Animated.timing(dismissBg, { toValue: 0, duration: 250, useNativeDriver: false }).start();
        setTimeout(() => {
          onClose();
        }, 260);
      } else {
        setScrollEnabled(true);
        Animated.spring(dismissY, { toValue: 0, tension: 60, friction: 9, useNativeDriver: true }).start();
        Animated.spring(dismissScale, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }).start();
        Animated.timing(dismissBg, { toValue: 1, duration: 150, useNativeDriver: false }).start();
      }
    }
  }, [onClose]);

  const galPadTop = insets.top + 58;
  const galPadBottom = insets.bottom + 41;

  const handleZoomChange = useCallback((isZoomed) => {
    setZoomed(isZoomed);
    setScrollEnabled(!isZoomed);
  }, []);

  const renderPage = useCallback(({ item: asset }) => {
    const availW = SCREEN_W - 16;
    const availH = SCREEN_H - galPadTop - galPadBottom;
    const aspect = (asset.width && asset.height) ? asset.width / asset.height : 3 / 4;
    let fitW = availW;
    let fitH = fitW / aspect;
    if (fitH > availH) {
      fitH = availH;
      fitW = fitH * aspect;
    }
    return (
      <Pressable style={[styles.galleryPage, { paddingTop: galPadTop, paddingBottom: galPadBottom }]} onPress={handleClose}>
        <Pressable>
          <ZoomableImage uri={asset.uri} width={fitW} height={fitH} onZoomChange={handleZoomChange} />
        </Pressable>
      </Pressable>
    );
  }, [handleZoomChange, handleClose]);

  // Pre-compute dot interpolations once (stable across renders)
  const dotAnims = useRef(
    Array.from({ length: count }, (_, i) => ({
      width: scrollX.interpolate({
        inputRange: [(i - 1) * SCREEN_W, i * SCREEN_W, (i + 1) * SCREEN_W],
        outputRange: [DOT_SIZE, DOT_ACTIVE_W, DOT_SIZE],
        extrapolate: 'clamp',
      }),
      opacity: scrollX.interpolate({
        inputRange: [(i - 1) * SCREEN_W, i * SCREEN_W, (i + 1) * SCREEN_W],
        outputRange: [0.35, 1, 0.35],
        extrapolate: 'clamp',
      }),
    }))
  ).current;

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: dismissBg.interpolate({ inputRange: [0, 1], outputRange: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.95)'] }) }]} />
      <PanGestureHandler
        ref={panRef}
        onGestureEvent={onDismissGesture}
        onHandlerStateChange={onDismissStateChange}
        activeOffsetY={15}
        simultaneousHandlers={nativeRef}
        enabled={!zoomed}
      >
      <Animated.View
        style={[styles.modalOverlay, { backgroundColor: 'transparent', transform: [{ translateX: openTx }, { translateY: Animated.add(openTy, dismissY) }, { scale: dismissScale }] }]}
      >
        <NativeViewGestureHandler ref={nativeRef} simultaneousHandlers={panRef}>
        <Animated.FlatList
          ref={flatListRef}
          data={group.assets}
          keyExtractor={(a) => a.id}
          horizontal
          pagingEnabled
          scrollEnabled={scrollEnabled}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIdx}
          getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false, listener: (e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
              if (idx !== activeIndex) setActiveIndex(idx);
            }}
          )}
          scrollEventThrottle={16}
          renderItem={renderPage}
        />
        </NativeViewGestureHandler>

      </Animated.View>
      </PanGestureHandler>

      <Animated.View style={[styles.dotsContainer, { bottom: insets.bottom + 22, opacity: dismissBg }]}>
        {dotAnims.map((anim, i) => (
          <Animated.View
            key={i}
            style={[styles.dot, { width: anim.width, opacity: anim.opacity }]}
          />
        ))}
      </Animated.View>

      <Animated.View style={[styles.modalClose, { top: insets.top + 20, opacity: dismissBg }]} pointerEvents="auto">
        <TouchableOpacity activeOpacity={0.7} onPress={handleClose}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
      </Animated.View>

      <Animated.Text style={[styles.pageCounter, { top: insets.top + 20, opacity: dismissBg }]}>
        {activeIndex + 1} / {count}
      </Animated.Text>
    </>
  );
}

export default function DuplicatesScreen() {
  const { state, trashMultiple, markSeen, dispatch } = useApp();
  const { isPro: isProPurchased } = usePurchases();
  const { colors, theme } = useColors();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [groups, setGroups] = useState([]);
  const [dismissedKeys, setDismissedKeys] = useState(new Set());
  const [expanded, setExpanded] = useState(null); // { groupId, assetId, origin }
  const expandedGroupRef = useRef(null);
  const thumbRefs = useRef({});

  // Load dismissed groups on mount
  useEffect(() => {
    loadDismissedGroups().then(setDismissedKeys);
  }, []);

  // Keep a ref to dismissedKeys so the store subscriber sees the latest value.
  const dismissedKeysRef = useRef(dismissedKeys);
  useEffect(() => { dismissedKeysRef.current = dismissedKeys; }, [dismissedKeys]);

  // Assets we've already warmed up (iCloud download triggered + prefetched).
  const warmedUpIdsRef = useRef(new Set());

  // warmupGroupAssets — fire Image.prefetch for the assets in the passed
  // groups. Called ONLY from onViewableItemsChanged, so memory is bounded
  // by what's on screen (usually 5-15 assets at a time).
  //
  // We dropped the getAssetInfoAsync({shouldDownloadFromNetwork:true}) call
  // that was here previously — it was triggering iCloud downloads of the
  // FULL file per thumbnail, and across many batch emissions accumulated
  // hundreds of in-flight downloads → OOM crash. iOS will serve the
  // thumbnail from its local thumbnail cache regardless (no full download
  // needed just to display a 130px thumbnail).
  const warmupGroupAssets = useCallback((groupsToWarm) => {
    for (const group of groupsToWarm) {
      for (const asset of group.assets) {
        if (warmedUpIdsRef.current.has(asset.id)) continue;
        warmedUpIdsRef.current.add(asset.id);
        try { Image.prefetch(asset.uri); } catch {}
      }
    }
  }, []);

  // FlatList requires viewabilityConfigCallbackPairs to be a stable ref.
  // Warms up groups as they scroll into view.
  const viewabilityPairsRef = useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 1, minimumViewTime: 100 },
      onViewableItemsChanged: ({ viewableItems }) => {
        if (!viewableItems || viewableItems.length === 0) return;
        const groups = viewableItems.map((v) => v.item).filter(Boolean);
        if (groups.length > 0) warmupGroupAssetsRef.current(groups);
      },
    },
  ]);
  // ref-wrapper so the stable viewability callback always calls the latest
  // warmupGroupAssets (without re-creating the FlatList prop).
  const warmupGroupAssetsRef = useRef(warmupGroupAssets);
  useEffect(() => { warmupGroupAssetsRef.current = warmupGroupAssets; }, [warmupGroupAssets]);

  // Subscribe to the duplicates store. SwipeScreen kicks off the scan at
  // startup, so by the time this tab is opened, results are usually already
  // streaming in. We also call startScan() here as a safety fallback —
  // it's a no-op if the scan is already running.
  //
  // NOTE: we do NOT warm up groups here. Doing that on every batch emit
  // caused crashes — each batch queued dozens of iCloud downloads
  // (getAssetInfoAsync shouldDownloadFromNetwork:true), and by the time
  // 5-10 batches had streamed in, hundreds were in flight → OOM.
  // Warmup now happens ONLY for groups that scroll into view, via
  // onViewableItemsChanged below. Memory stays bounded by viewport.
  useEffect(() => {
    const unsub = duplicatesStore.subscribe((s) => {
      setPhase(s.phase);
      setProgress(s.progress);
      setGroups((prev) => {
        const prevMap = new Map(prev.map((g) => [g.id, g]));
        const dismissed = dismissedKeysRef.current;
        return s.groups
          .filter((g) => !dismissed.has(groupKey(g.assets)))
          .map((g) => prevMap.get(g.id) || g);
      });
    });
    duplicatesStore.startScan();
    return () => unsub();
  }, []);

  // Manual rescan — used by the refresh button in the header.
  const rescan = useCallback(() => {
    setGroups([]);
    setDismissedKeys(new Set());
    saveDismissedGroups(new Set());
    duplicatesStore.reset();
    duplicatesStore.startScan();
  }, []);

  const toggleTrash = (groupId, assetId) => {
    LayoutAnimation.configureNext(DISMISS_ANIM);
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const next = new Set(g.trashIds || new Set());
        if (next.has(assetId)) {
          next.delete(assetId);
        } else {
          next.add(assetId);
        }
        return { ...g, trashIds: next };
      })
    );
  };

  const dismissGroup = (groupId) => {
    LayoutAnimation.configureNext(DISMISS_ANIM);
    setGroups((prev) => {
      const group = prev.find((g) => g.id === groupId);
      if (group) {
        const key = groupKey(group.assets);
        setDismissedKeys((prevKeys) => {
          const next = new Set(prevKeys);
          next.add(key);
          saveDismissedGroups(next);
          return next;
        });
      }
      return prev.filter((g) => g.id !== groupId);
    });
  };

  const handleTrashGroup = (group) => {
    if (state.dailyLimitReached && !state.isPro && !isProPurchased) {
      Alert.alert(t('swipe.dailyLimitTitle'), t('swipe.dailyLimitSubtitle', { limit: 200 }));
      return;
    }
    const trashIds = group.trashIds || new Set();
    const toTrash = group.assets.filter((a) => trashIds.has(a.id));
    if (toTrash.length === 0) return;
    trashMultiple(toTrash);
    const keptIds = group.assets.filter((a) => !trashIds.has(a.id)).map((a) => a.id);
    if (keptIds.length > 0) markSeen(keptIds);
    dispatch({ type: 'INCREMENT_SWIPES', payload: 1 });
    dismissGroup(group.id);
  };

  const handleKeepAll = (group) => {
    if (state.dailyLimitReached && !state.isPro && !isProPurchased) {
      Alert.alert(t('swipe.dailyLimitTitle'), t('swipe.dailyLimitSubtitle', { limit: 200 }));
      return;
    }
    markSeen(group.assets.map((a) => a.id));
    dispatch({ type: 'INCREMENT_SWIPES', payload: 1 });
    dismissGroup(group.id);
  };

  const totalPhotos = groups.reduce((sum, g) => sum + g.assets.length, 0);

  // --- IDLE ---
  if (phase === 'idle') {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.bg }]}>
        <Ionicons name="copy-outline" size={56} color="#5856D6" style={{ marginBottom: 16 }} />
        <Text style={[styles.title, { color: theme.text }]}>{t('duplicates.title')}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {t('duplicates.subtitle')}
        </Text>
        <TouchableOpacity style={styles.scanButton} onPress={rescan} activeOpacity={0.7}>
          <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.scanButtonText}>{t('duplicates.scanLibrary')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- SCANNING / ANALYZING (no groups yet) ---
  // 'analyzing' with empty groups means the processor loop has started but
  // the first batch hasn't come through AI yet. Show the loading spinner,
  // NOT the "no duplicates found" empty state.
  if (phase === 'scanning' || (phase === 'analyzing' && groups.length === 0)) {
    const analyzing = phase === 'analyzing' || progress.total > 0;
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color="#5856D6" />
        <Text style={[styles.scanningText, { color: theme.text }]}>
          {analyzing ? t('duplicates.analyzing') : t('duplicates.scanning')}
        </Text>
        <Text style={[styles.scanningCount, { color: theme.textSecondary }]}>
          {analyzing ? t('duplicates.itemsScanned', { count: progress.loaded.toLocaleString() }) : t('duplicates.itemsLoaded', { count: progress.loaded.toLocaleString() })}
        </Text>
      </View>
    );
  }

  // --- NO RESULTS (only after scan is truly done) ---
  // Previously this also rendered during the 'analyzing' gap before the
  // first group came through, which made users think there were no
  // duplicates when the scan was actually still running.
  if (phase === 'done' && groups.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.bg }]}>
        <Ionicons name="checkmark-circle" size={56} color={colors.green} style={{ marginBottom: 16 }} />
        <Text style={[styles.title, { color: theme.text }]}>{t('duplicates.noResultsTitle')}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {t('duplicates.noResultsSubtitle')}
        </Text>
        <TouchableOpacity style={[styles.rescanButton, { borderColor: theme.border }]} onPress={() => setPhase('idle')} activeOpacity={0.7}>
          <Ionicons name="refresh" size={18} color="#5856D6" style={{ marginRight: 6 }} />
          <Text style={styles.rescanText}>{t('duplicates.scanAgain')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- RESULTS ---
  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={styles.listContent}
        // Mount the first 10 groups up front — enough to fill the screen on
        // first paint, but low enough that we don't flood PHImageManager
        // with ~30+ simultaneous thumbnail loads the moment the tab opens.
        // Groups past that get warmed up via onViewableItemsChanged as the
        // user scrolls (see viewabilityConfigCallbackPairs below).
        initialNumToRender={10}
        maxToRenderPerBatch={4}
        windowSize={5}
        removeClippedSubviews
        // Warm up groups as they scroll into view. warmupGroupAssets is
        // idempotent per-asset-id, so re-firing is cheap.
        viewabilityConfigCallbackPairs={viewabilityPairsRef.current}
        ListHeaderComponent={<View style={{ height: insets.top + 83 }} />}
        ListFooterComponent={progress.loaded < progress.total && progress.total > 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 20 }}>
            <ActivityIndicator size="small" color="#5856D6" />
            <Text style={{ color: theme.textSecondary, fontSize: sw(13), marginTop: 8 }}>
              {t('duplicates.analyzing')} {progress.loaded}/{progress.total}
            </Text>
          </View>
        ) : null}
        renderItem={({ item: group }) => {
          const trashIds = group.trashIds || new Set();
          const trashCount = trashIds.size;
          return (
            <View style={[styles.groupCard, { backgroundColor: theme.card }]}>
              {/* group hint removed */}

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                {group.assets.map((asset) => {
                  const isTrashed = trashIds.has(asset.id);
                  const isBest = group.bestId === asset.id;
                  return (
                    <TouchableOpacity
                      key={asset.id}
                      ref={(ref) => { if (ref) thumbRefs.current[asset.id] = ref; }}
                      onPress={() => {
                        expandedGroupRef.current = group;
                        const ref = thumbRefs.current[asset.id];
                        if (ref) {
                          ref.measureInWindow((x, y, w, h) => {
                            setExpanded({ groupId: group.id, assetId: asset.id, origin: { x, y, w, h } });
                          });
                        } else {
                          setExpanded({ groupId: group.id, assetId: asset.id });
                        }
                      }}
                      activeOpacity={0.7}
                      style={[styles.thumbWrapper, isTrashed && { opacity: 0.35 }]}
                    >
                      <Image
                        source={{ uri: asset.uri }}
                        style={styles.thumb}
                        contentFit="cover"
                      />
                      {isBest && (
                        <View style={styles.bestBadge}>
                          <Text style={styles.bestBadgeText}>BEST</Text>
                        </View>
                      )}
                      <Pressable
                        style={styles.selectCircle}
                        onPress={() => toggleTrash(group.id, asset.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      />
                      {asset.fileSize > 0 && (
                        <Text style={[styles.thumbSize, { color: theme.textSecondary }]}>{formatBytes(asset.fileSize)}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {trashCount > 0 ? (
                <TouchableOpacity
                  style={[styles.groupTrashButton, { backgroundColor: colors.redBgSubtle, borderWidth: 1, borderColor: colors.red }]}
                  onPress={() => handleTrashGroup(group)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash" size={14} color={colors.red} style={{ marginRight: 6 }} />
                  <Text style={[styles.groupTrashText, { color: colors.red }]}>
                    {t('duplicates.trashDuplicates', { count: trashCount })}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.groupKeepButton, { backgroundColor: colors.greenBgLight, borderWidth: 1, borderColor: colors.green }]}
                  onPress={() => handleKeepAll(group)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="checkmark" size={14} color={colors.green} style={{ marginRight: 6 }} />
                  <Text style={[styles.groupTrashText, { color: colors.green }]}>
                    {t('duplicates.keepAll')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      <Modal visible={!!expanded} transparent animationType="none" statusBarTranslucent onRequestClose={() => setExpanded(null)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
        {expanded && (() => {
          const group = expandedGroupRef.current;
          if (!group) { setExpanded(null); return null; }
          return (
            <ExpandedGallery
              group={group}
              initialAssetId={expanded.assetId}
              onClose={() => setExpanded(null)}
              onToggleTrash={toggleTrash}
              origin={expanded.origin}
            />
          );
        })()}
        </GestureHandlerRootView>
      </Modal>

      <LinearGradient
        colors={theme.headerGradient}
        locations={[0, 0.35, 0.5, 0.6, 0.7, 0.8, 0.88, 0.95, 1]}
        style={[styles.header, { paddingTop: insets.top + 13 }]}
        pointerEvents="box-none"
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>{t('duplicates.headerTitle')}</Text>
            <Text style={[styles.headerSubtitle, { color: theme.text }]}>
              {totalPhotos} {t('duplicates.photosFound')}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                t('duplicates.rescanTitle'),
                t('duplicates.rescanMessage'),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('duplicates.scanAgain'), onPress: rescan },
                ]
              );
            }}
            activeOpacity={0.7}
            style={styles.rescanHeaderButton}
          >
            <Ionicons name="refresh" size={22} color="#5856D6" />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  title: {
    color: '#fff',
    fontSize: sw(26),
    fontWeight: '800',
    marginBottom: 10,
  },
  subtitle: {
    color: '#888',
    fontSize: sw(15),
    textAlign: 'center',
    lineHeight: sw(22),
    marginBottom: 30,
  },
  scanButton: {
    flexDirection: 'row',
    backgroundColor: '#5856D6',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: sw(17),
    fontWeight: '700',
  },
  scanningText: {
    color: '#fff',
    fontSize: sw(18),
    fontWeight: '600',
    marginTop: 20,
  },
  scanningCount: {
    color: '#888',
    fontSize: sw(14),
    marginTop: 8,
  },
  rescanHeaderButton: {
    padding: 6,
  },
  rescanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#5856D6',
  },
  rescanText: {
    color: '#5856D6',
    fontSize: sw(16),
    fontWeight: '700',
  },

  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: sw(20),
    paddingBottom: sh(40),
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: sw(28),
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#fff',
    fontSize: sw(14),
    marginTop: 4,
  },
  rescanButtonSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(88, 86, 214, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  groupCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  groupLabel: {
    color: '#fff',
    fontSize: sw(15),
    fontWeight: '700',
    flex: 1,
  },
  groupCount: {
    color: '#888',
    fontSize: sw(13),
    marginRight: 6,
  },
  hideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  hideText: {
    color: '#666',
    fontSize: sw(12),
    fontWeight: '600',
  },
  groupHint: {
    color: '#fff',
    fontSize: sw(11),
    marginBottom: 10,
  },
  thumbRow: {
    flexDirection: 'row',
  },
  thumbWrapper: {
    marginRight: 12,
    alignItems: 'center',
    width: THUMB_SIZE,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
  },
  bestBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#4CD964',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  bestBadgeText: {
    color: '#4CD964',
    fontSize: 9,
    fontWeight: '800',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keepLabel: {
    fontSize: sw(10),
    fontWeight: '800',
    marginTop: 3,
  },
  trashLabel: {
    fontSize: sw(10),
    fontWeight: '800',
    marginTop: 3,
  },
  thumbSize: {
    color: '#888',
    fontSize: sw(10),
    marginTop: 1,
  },
  selectCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandButton: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    right: sw(20),
    zIndex: 20,
  },
  closeButton: {
    position: 'absolute',
    right: sw(20),
    zIndex: 10,
    width: sw(40),
    height: sw(40),
    borderRadius: sw(20),
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageCounter: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 10,
    color: '#fff',
    fontSize: sw(16),
    fontWeight: '700',
  },
  galleryPage: {
    width: SCREEN_W,
    flex: 1,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImageWrap: {
    width: SCREEN_W - 40,
    height: (SCREEN_W - 40) * 1.3,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1c1c1e',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  galleryToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 16,
  },
  galleryToggleText: {
    color: '#fff',
    fontSize: sw(15),
    fontWeight: '700',
  },
  galleryFileSize: {
    color: '#888',
    fontSize: sw(13),
    marginTop: 8,
  },
  dotsContainer: {
    position: 'absolute',
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: '#fff',
  },
  groupTrashButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  groupTrashText: {
    fontSize: sw(14),
    fontWeight: '700',
  },
  groupKeepButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
});
