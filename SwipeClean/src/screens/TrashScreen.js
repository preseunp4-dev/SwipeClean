import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  Alert,
  Dimensions,
  Modal,
  Animated,
  Easing,
  Pressable,
} from 'react-native';
import { PanGestureHandler, State, NativeViewGestureHandler, LongPressGestureHandler, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import ZoomableImage from '../components/ZoomableImage';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useApp } from '../context/AppContext';
import { useColors } from '../context/ColorContext';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { sw, sh } from '../utils/scale';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
import { formatBytes, formatDuration } from '../utils/formatting';

const THUMB_SIZE = (SCREEN_WIDTH - 6) / 3;

const PreviewVideo = React.memo(function PreviewVideo({ uri, isActive, onScrubStart, onScrubEnd, videoWidth, videoHeight, assetId }) {
  const { theme } = useColors();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
  });
  const [paused, setPaused] = useState(false);
  const [resolvedDims, setResolvedDims] = useState({ w: videoWidth, h: videoHeight });
  const pauseIconOpacity = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const scrubBarHeight = useRef(new Animated.Value(3)).current;
  const scrubbingRef = useRef(false);
  const progressBarWidth = useRef(0);
  const progressRunning = useRef(false);
  const startSmoothRef = useRef(null);
  const onScrubStartRef = useRef(onScrubStart);
  const onScrubEndRef = useRef(onScrubEnd);
  onScrubStartRef.current = onScrubStart;
  onScrubEndRef.current = onScrubEnd;

  // Fetch actual dimensions if not available from asset
  useEffect(() => {
    if (videoWidth && videoHeight) {
      setResolvedDims({ w: videoWidth, h: videoHeight });
      return;
    }
    if (!assetId) return;
    MediaLibrary.getAssetInfoAsync(assetId).then((info) => {
      if (info && info.width && info.height) {
        setResolvedDims({ w: info.width, h: info.height });
      }
    }).catch(() => {});
  }, [assetId, videoWidth, videoHeight]);

  const togglePause = useCallback(() => {
    if (!player) return;
    if (paused) {
      player.play();
      setPaused(false);
      Animated.timing(pauseIconOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      if (startSmoothRef.current) startSmoothRef.current();
    } else {
      player.pause();
      setPaused(true);
      progressAnim.stopAnimation();
      progressRunning.current = false;
      Animated.timing(pauseIconOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [player, paused]);

  const seekToX = (x) => {
    if (!player || player.duration <= 0 || progressBarWidth.current <= 0) return;
    const fraction = Math.max(0, Math.min(1, x / progressBarWidth.current));
    player.currentTime = fraction * player.duration;
    progressAnim.setValue(fraction);
  };

  const scrubResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        scrubbingRef.current = true;
        if (onScrubStartRef.current) onScrubStartRef.current();
        progressAnim.stopAnimation();
        Animated.timing(scrubBarHeight, { toValue: 8, duration: 150, useNativeDriver: false }).start();
        seekToX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => {
        seekToX(e.nativeEvent.locationX);
      },
      onPanResponderRelease: () => {
        scrubbingRef.current = false;
        if (onScrubEndRef.current) onScrubEndRef.current();
        Animated.timing(scrubBarHeight, { toValue: 3, duration: 200, useNativeDriver: false }).start();
        if (startSmoothRef.current) startSmoothRef.current();
      },
      onPanResponderTerminate: () => {
        scrubbingRef.current = false;
        if (onScrubEndRef.current) onScrubEndRef.current();
        Animated.timing(scrubBarHeight, { toValue: 3, duration: 200, useNativeDriver: false }).start();
        if (startSmoothRef.current) startSmoothRef.current();
      },
    })
  ).current;

  // Calculate fitted video dimensions
  const CONTAINER_W = SCREEN_WIDTH - 16;
  const CONTAINER_H = SCREEN_HEIGHT - (insets.top + 23) - (insets.bottom + 6);
  const videoAspect = (resolvedDims.w && resolvedDims.h) ? resolvedDims.w / resolvedDims.h : 16 / 9;
  let fitW = CONTAINER_W;
  let fitH = fitW / videoAspect;
  if (fitH > CONTAINER_H) {
    fitH = CONTAINER_H;
    fitW = fitH * videoAspect;
  }

  useEffect(() => {
    if (!player) return;
    if (!isActive) {
      player.pause();
      player.currentTime = 0;
      progressAnim.setValue(0);
      progressAnim.stopAnimation();
      progressRunning.current = false;
      startSmoothRef.current = null;
      setPaused(false);
      pauseIconOpacity.setValue(0);
      return;
    }
    player.play();
    setPaused(false);
    pauseIconOpacity.setValue(0);
    let stopped = false;

    const startSmooth = () => {
      if (!player || player.duration <= 0 || stopped || scrubbingRef.current || !player.playing) return;
      if (player.currentTime <= 0) return; // wait for actual playback to begin
      const cur = player.currentTime / player.duration;
      const remaining = Math.max(0, (1 - cur) * player.duration * 1000);
      progressAnim.setValue(cur);
      progressRunning.current = true;
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: remaining,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(({ finished }) => {
        progressRunning.current = false;
        if (finished && !stopped) {
          progressAnim.setValue(0);
          setTimeout(() => { if (!stopped) startSmooth(); }, 50);
        }
      });
    };

    startSmoothRef.current = startSmooth;

    const check = setInterval(() => {
      if (stopped) { clearInterval(check); return; }
      if (scrubbingRef.current) return;
      if (!player || player.duration <= 0 || !player.playing) return;
      if (!progressRunning.current) startSmooth();
    }, 50);

    return () => {
      stopped = true;
      startSmoothRef.current = null;
      clearInterval(check);
      progressAnim.stopAnimation();
      progressRunning.current = false;
    };
  }, [isActive, player]);

  return (
    <View style={{ width: fitW, height: fitH, borderRadius: 12, overflow: 'hidden' }}>
      <TouchableOpacity activeOpacity={1} onPress={togglePause} style={StyleSheet.absoluteFill}>
        <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} pointerEvents="none" />
      </TouchableOpacity>
      <Animated.View style={[styles.pauseOverlay, { opacity: pauseIconOpacity }]} pointerEvents="none">
        <Ionicons name="play" size={64} color="rgba(255,255,255,0.8)" />
      </Animated.View>
      <View
        style={[styles.scrubTouchArea, { bottom: 6 }]}
        onLayout={(e) => { progressBarWidth.current = e.nativeEvent.layout.width; }}
        {...scrubResponder.panHandlers}
      >
        <Animated.View style={[styles.scrubBar, { height: scrubBarHeight }]}>
          <Animated.View style={[styles.scrubFill, {
            width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }),
          }]} />
        </Animated.View>
      </View>
    </View>
  );
});

export default function TrashScreen() {
  const { state, restore, clearTrash } = useApp();
  const { colors, theme } = useColors();
  const insets = useSafeAreaInsets();
  const { trashed } = state;
  const [deleting, setDeleting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [previewIndex, setPreviewIndex] = useState(null);
  const [previewScrollEnabled, setPreviewScrollEnabled] = useState(true);
  const [previewZoomed, setPreviewZoomed] = useState(false);
  const previewListRef = useRef(null);
  const nativeRef = useRef(null);
  const panRef = useRef(null);
  const thumbRefs = useRef({});
  const previewOriginRef = useRef(null);
  const dismissY = useRef(new Animated.Value(0)).current;
  const dismissScale = useRef(new Animated.Value(1)).current;
  const dismissBg = useRef(new Animated.Value(1)).current;
  const openTx = useRef(new Animated.Value(0)).current;
  const openTy = useRef(new Animated.Value(0)).current;
  const dismissActiveRef = useRef(false);
  const onDismissGesture = useCallback(({ nativeEvent }) => {
    const { translationY, translationX } = nativeEvent;
    // Only process dismiss if clearly vertical (not horizontal swipe)
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
        Animated.timing(dismissY, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start();
        Animated.timing(dismissScale, { toValue: 0.5, duration: 250, useNativeDriver: true }).start();
        Animated.timing(dismissBg, { toValue: 0, duration: 250, useNativeDriver: false }).start();
        setTimeout(() => {
          setPreviewIndex(null);
          setPreviewScrollEnabled(true);
          requestAnimationFrame(() => {
            dismissY.setValue(0);
            dismissScale.setValue(1);
            dismissBg.setValue(1);
            openTx.setValue(0);
            openTy.setValue(0);
          });
        }, 260);
      } else {
        setPreviewScrollEnabled(true);
        Animated.spring(dismissY, { toValue: 0, tension: 60, friction: 9, useNativeDriver: true }).start();
        Animated.spring(dismissScale, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }).start();
        Animated.timing(dismissBg, { toValue: 1, duration: 150, useNativeDriver: false }).start();
      }
    }
  }, []);

  const openPreview = useCallback((index, origin) => {
    if (origin) {
      const originScale = origin.w / SCREEN_WIDTH;
      const tx = (origin.x + origin.w / 2) - SCREEN_WIDTH / 2;
      const ty = (origin.y + origin.h / 2) - SCREEN_HEIGHT / 2;
      dismissScale.setValue(originScale);
      dismissBg.setValue(0);
      openTx.setValue(tx);
      openTy.setValue(ty);
      previewOriginRef.current = origin;
    } else {
      dismissScale.setValue(1);
      dismissBg.setValue(1);
      openTx.setValue(0);
      openTy.setValue(0);
      previewOriginRef.current = null;
    }
    dismissY.setValue(0);
    setPreviewIndex(index);
    if (origin) {
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(dismissScale, { toValue: 1, tension: 50, friction: 9, useNativeDriver: true }),
          Animated.spring(openTx, { toValue: 0, tension: 50, friction: 9, useNativeDriver: true }),
          Animated.spring(openTy, { toValue: 0, tension: 50, friction: 9, useNativeDriver: true }),
          Animated.timing(dismissBg, { toValue: 1, duration: 250, useNativeDriver: false }),
        ]).start();
      });
    }
  }, []);

  const totalSize = useMemo(() => trashed.reduce((sum, a) => sum + (a.fileSize || 0), 0), [trashed]);

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  // Drag-to-select
  const flatListRef2 = useRef(null);
  const scrollOffsetRef = useRef(0);
  const gridOriginYRef = useRef(0);
  const dragStartIndexRef = useRef(-1);
  const dragSelectingRef = useRef(false);
  const dragBaseSelected = useRef(new Set());
  const longPressRef = useRef(null);
  const dragPanRef = useRef(null);
  const CELL_SIZE = THUMB_SIZE + 2;
  const HEADER_H = insets.top + 93;

  const getIndexFromPosition = useCallback((absX, absY) => {
    const y = absY - gridOriginYRef.current + scrollOffsetRef.current - HEADER_H;
    const x = absX;
    if (y < 0 || x < 0) return -1;
    const row = Math.floor(y / CELL_SIZE);
    const col = Math.min(2, Math.floor(x / CELL_SIZE));
    const idx = row * 3 + col;
    return idx >= 0 && idx < trashed.length ? idx : -1;
  }, [trashed.length, CELL_SIZE, HEADER_H]);

  const updateDragSelection = useCallback((currentIndex) => {
    if (dragStartIndexRef.current < 0 || currentIndex < 0) return;
    const start = Math.min(dragStartIndexRef.current, currentIndex);
    const end = Math.max(dragStartIndexRef.current, currentIndex);
    const next = new Set(dragBaseSelected.current);
    for (let i = start; i <= end; i++) {
      next.add(trashed[i].id);
    }
    setSelected(next);
  }, [trashed]);

  const onDragLongPress = useCallback(({ nativeEvent }) => {
    if (nativeEvent.state === State.ACTIVE) {
      const idx = getIndexFromPosition(nativeEvent.absoluteX, nativeEvent.absoluteY);
      if (idx >= 0) {
        dragSelectingRef.current = true;
        dragStartIndexRef.current = idx;
        if (!selecting) {
          setSelecting(true);
          dragBaseSelected.current = new Set();
        } else {
          dragBaseSelected.current = new Set(selected);
        }
        const next = new Set(dragBaseSelected.current);
        next.add(trashed[idx].id);
        setSelected(next);
      }
    }
  }, [getIndexFromPosition, selecting, selected, trashed]);

  const onDragPan = useCallback(({ nativeEvent }) => {
    if (!dragSelectingRef.current) {
      // Start drag selection on first pan movement
      const idx = getIndexFromPosition(nativeEvent.absoluteX, nativeEvent.absoluteY);
      if (idx >= 0) {
        dragSelectingRef.current = true;
        dragStartIndexRef.current = idx;
        dragBaseSelected.current = new Set(selected);
        const next = new Set(dragBaseSelected.current);
        next.add(trashed[idx].id);
        setSelected(next);
      }
      return;
    }
    const idx = getIndexFromPosition(nativeEvent.absoluteX, nativeEvent.absoluteY);
    if (idx >= 0) {
      updateDragSelection(idx);
    }
  }, [getIndexFromPosition, updateDragSelection, selected, trashed]);

  const onDragPanStateChange = useCallback(({ nativeEvent }) => {
    if (nativeEvent.oldState === State.ACTIVE) {
      dragSelectingRef.current = false;
      dragStartIndexRef.current = -1;
    }
  }, []);

  const handleDeleteAll = () => {
    if (trashed.length === 0) return;
    Alert.alert(
      t('trash.deleteConfirmTitle'),
      t('trash.deleteConfirmMessage', { count: trashed.length, size: formatBytes(totalSize) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('trash.deleteAll'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const ids = trashed.map((a) => a.id);
              const success = await MediaLibrary.deleteAssetsAsync(ids);
              if (success) {
                clearTrash();
                exitSelecting();
                Alert.alert(t('trash.deleteDoneTitle'), t('trash.deleteDoneMessage'));
              } else {
                Alert.alert(t('trash.deleteCancelledTitle'), t('trash.deleteCancelledMessage'));
              }
            } catch (err) {
              Alert.alert(t('trash.deleteErrorTitle'), t('trash.deleteErrorMessage'));
              console.warn('Delete error:', err);
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteSelected = () => {
    if (selected.size === 0) return;
    const selectedItems = trashed.filter((a) => selected.has(a.id));
    const selectedSize = selectedItems.reduce((sum, a) => sum + (a.fileSize || 0), 0);
    Alert.alert(
      t('trash.deleteConfirmTitle'),
      t('trash.deleteConfirmMessage', { count: selected.size, size: formatBytes(selectedSize) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('trash.deleteAll'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const ids = [...selected];
              const success = await MediaLibrary.deleteAssetsAsync(ids);
              if (success) {
                clearTrash(ids);
                exitSelecting();
                Alert.alert(t('trash.deleteDoneTitle'), t('trash.deleteDoneMessage'));
              } else {
                Alert.alert(t('trash.deleteCancelledTitle'), t('trash.deleteCancelledMessage'));
              }
            } catch (err) {
              Alert.alert(t('trash.deleteErrorTitle'), t('trash.deleteErrorMessage'));
              console.warn('Delete error:', err);
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleRestoreSelected = () => {
    if (selected.size === 0) return;
    for (const id of selected) {
      restore(id);
    }
    exitSelecting();
  };

  if (trashed.length === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: theme.bg }]}>
        <Ionicons name="trash-outline" size={48} color={theme.textTertiary} style={{ marginBottom: 16 }} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('trash.emptyTitle')}</Text>
        <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
          {t('trash.emptySubtitle')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Grid */}
      <PanGestureHandler
        ref={dragPanRef}
        onGestureEvent={onDragPan}
        onHandlerStateChange={onDragPanStateChange}
        activeOffsetX={[-5, 5]}
        activeOffsetY={[-5, 5]}
        enabled={selecting}
      >
      <View style={{ flex: 1 }} onLayout={(e) => { gridOriginYRef.current = e.nativeEvent.layout.y; }}>
      <FlatList
        data={trashed}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={styles.grid}
        getItemLayout={(_, index) => ({
          length: THUMB_SIZE + 2,
          offset: (THUMB_SIZE + 2) * Math.floor(index / 3) + (insets.top + 93),
          index,
        })}
        windowSize={7}
        maxToRenderPerBatch={15}
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        ListHeaderComponent={<View style={{ height: insets.top + 93 }} />}
        renderItem={({ item, index }) => {
          const isSelected = selected.has(item.id);
          return (
            <TouchableOpacity
              ref={(ref) => { if (ref) thumbRefs.current[index] = ref; }}
              style={[styles.thumbContainer, { backgroundColor: theme.card }]}
              activeOpacity={0.7}
              onPress={selecting ? () => toggleSelect(item.id) : () => {
                const ref = thumbRefs.current[index];
                if (ref) {
                  ref.measureInWindow((x, y, w, h) => {
                    openPreview(index, { x, y, w, h });
                  });
                } else {
                  openPreview(index, null);
                }
              }}
            >
              <Image source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" />
              {item.mediaType === 'video' && (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
                </View>
              )}
              {selecting && (
                <View style={[styles.selectCircle, { borderColor: theme.thumbBorder }, isSelected && { backgroundColor: colors.green, borderColor: colors.green }]}>
                  {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
              )}
              {selecting && isSelected && <View style={[styles.selectedOverlay, { borderColor: colors.green }]} />}
            </TouchableOpacity>
          );
        }}
      />
      </View>
      </PanGestureHandler>

      {/* Bottom buttons */}
      {selecting && selected.size > 0 ? (
        <View style={[styles.selectionBar, { backgroundColor: theme.bg }]}>
          <TouchableOpacity
            style={[styles.selectionButton, { backgroundColor: colors.red }]}
            onPress={handleDeleteSelected}
            disabled={deleting}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={18} color="#fff" />
            <Text style={[styles.selectionButtonText, { color: '#fff' }]}>{t('trash.deleteSelected', { count: selected.size })}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectionButton, { backgroundColor: colors.green }]}
            onPress={handleRestoreSelected}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-undo" size={18} color="#fff" />
            <Text style={[styles.selectionButtonText, { color: '#fff' }]}>{t('trash.restoreSelected', { count: selected.size })}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.deleteAllButton, { backgroundColor: colors.red }, deleting && styles.deleteAllDisabled]}
          onPress={handleDeleteAll}
          disabled={deleting}
          activeOpacity={0.7}
        >
          <Text style={[styles.deleteAllText, { color: '#fff' }]}>
            {deleting ? t('trash.deleting') : t('trash.deleteAllButton', { count: trashed.length })}
          </Text>
        </TouchableOpacity>
      )}
      {/* Header overlay */}
      <LinearGradient
        colors={theme.headerGradient}
        locations={[0, 0.35, 0.5, 0.6, 0.7, 0.8, 0.88, 0.95, 1]}
        style={[styles.header, { paddingTop: insets.top + 13 }]}
        pointerEvents="box-none"
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>{t('trash.headerTitle')}</Text>
            <Text style={[styles.headerSubtitle, { marginTop: 4, color: theme.text }]}>
              {t('trash.items', { count: trashed.length })} · {formatBytes(totalSize)}
            </Text>
            {selecting && selected.size > 0 && (
              <Text style={[styles.headerSubtitle, { marginTop: 4, color: theme.text }]}>{t('trash.selected', { count: selected.size })} · {formatBytes(trashed.filter((a) => selected.has(a.id)).reduce((sum, a) => sum + (a.fileSize || 0), 0))}</Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {selecting && (
              <TouchableOpacity onPress={() => {
                if (selected.size === trashed.length) setSelected(new Set());
                else setSelected(new Set(trashed.map((a) => a.id)));
              }} activeOpacity={0.7}>
                <Text style={styles.selectButton}>{selected.size === trashed.length ? t('trash.deselectAll') : t('trash.selectAll')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={selecting ? exitSelecting : () => setSelecting(true)} activeOpacity={0.7}>
              <Text style={styles.selectButton}>{selecting ? t('common.cancel') : t('trash.select')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>
      {/* Fullscreen preview modal */}
      {previewIndex !== null && (
        <Modal visible transparent statusBarTranslucent onRequestClose={() => setPreviewIndex(null)}>
          <GestureHandlerRootView style={{ flex: 1 }}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: dismissBg.interpolate({ inputRange: [0, 1], outputRange: ['rgba(0,0,0,0)', 'rgba(0,0,0,1)'] }) }]} />
          <PanGestureHandler
            ref={panRef}
            onGestureEvent={onDismissGesture}
            onHandlerStateChange={onDismissStateChange}
            activeOffsetY={15}
            simultaneousHandlers={nativeRef}
            enabled={!previewZoomed}
          >
          <Animated.View style={[styles.modalContainer, { backgroundColor: 'transparent', transform: [{ translateX: openTx }, { translateY: Animated.add(openTy, dismissY) }, { scale: dismissScale }], borderRadius: dismissScale.interpolate({ inputRange: [0.7, 1], outputRange: [16, 0], extrapolate: 'clamp' }) }]}>
            <NativeViewGestureHandler ref={nativeRef} simultaneousHandlers={panRef}>
            <FlatList
              ref={previewListRef}
              data={trashed}
              horizontal
              pagingEnabled
              scrollEnabled={previewScrollEnabled}
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={previewIndex}
              getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                setPreviewIndex(idx);
              }}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => {
                const padTop = insets.top + 23;
                const padBottom = insets.bottom + 6;
                const availW = SCREEN_WIDTH - 16;
                const availH = SCREEN_HEIGHT - padTop - padBottom;
                const aspect = (item.width && item.height) ? item.width / item.height : 3 / 4;
                let fitW = availW;
                let fitH = fitW / aspect;
                if (fitH > availH) {
                  fitH = availH;
                  fitW = fitH * aspect;
                }
                return (
                  <Pressable style={[styles.modalPage, { paddingTop: padTop, paddingBottom: padBottom }]} onPress={() => setPreviewIndex(null)}>
                    <Pressable>
                    {item.mediaType === 'video' ? (
                      <PreviewVideo uri={item.uri} isActive={index === previewIndex} onScrubStart={() => setPreviewScrollEnabled(false)} onScrubEnd={() => setPreviewScrollEnabled(true)} videoWidth={item.width} videoHeight={item.height} assetId={item.id} />
                    ) : (
                      <ZoomableImage uri={item.uri} width={fitW} height={fitH} onZoomChange={(z) => { setPreviewZoomed(z); setPreviewScrollEnabled(!z); }} />
                    )}
                    </Pressable>
                  </Pressable>
                );
              }}
            />
            </NativeViewGestureHandler>
          </Animated.View>
          </PanGestureHandler>
          <Animated.View style={[styles.modalClose, { top: insets.top + 20, opacity: dismissBg }]} pointerEvents="auto">
            <TouchableOpacity activeOpacity={0.7} onPress={() => setPreviewIndex(null)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
          </GestureHandlerRootView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: sw(24),
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#888',
    fontSize: sw(15),
    textAlign: 'center',
    lineHeight: 22,
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
    alignItems: 'flex-start',
  },
  headerTitle: {
    color: '#fff',
    fontSize: sw(28),
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#fff',
    fontSize: sw(14),
  },
  selectAllLink: {
    color: '#5856D6',
    fontSize: sw(14),
    fontWeight: '600',
  },
  selectButton: {
    color: '#5856D6',
    fontSize: sw(16),
    fontWeight: '600',
    marginTop: 6,
    borderWidth: 1.5,
    borderColor: '#5856D6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  selectedCount: {
    color: '#888',
    fontSize: sw(13),
    marginTop: 6,
  },
  grid: {
    paddingHorizontal: 0,
    paddingBottom: 100,
  },
  thumbContainer: {
    margin: 1,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#1c1c1e',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
  durationBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    color: '#fff',
    fontSize: sw(11),
    fontWeight: '600',
  },
  selectCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 3,
    borderRadius: 4,
  },
  selectionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 10,
  },
  selectionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 6,
  },
  selectionButtonText: {
    color: '#fff',
    fontSize: sw(15),
    fontWeight: '700',
  },
  deleteAllButton: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    marginHorizontal: 20,
    marginBottom: 30,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  deleteAllDisabled: {
    opacity: 0.5,
  },
  deleteAllText: {
    color: '#fff',
    fontSize: sw(15),
    fontWeight: '700',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  modalPage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    right: sw(20),
    zIndex: 20,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrubTouchArea: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 80,
    justifyContent: 'flex-end',
    zIndex: 10,
  },
  scrubBar: {
    marginHorizontal: 0,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  scrubFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    minWidth: 6,
    backgroundColor: '#fff',
    borderRadius: 4,
  },
});
