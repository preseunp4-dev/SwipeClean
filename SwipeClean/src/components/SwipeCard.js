import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { ActivityIndicator, Animated, Dimensions, Easing, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as MediaLibrary from 'expo-media-library';
import { File } from 'expo-file-system';
import { t } from '../i18n';
import { useColors } from '../context/ColorContext';
import { formatBytes as _formatBytes, formatDate, formatDuration as _formatDuration } from '../utils/formatting';
import { sw } from '../utils/scale';

const formatBytes = (b) => _formatBytes(b, '—');
const formatDuration = (s) => _formatDuration(s, '0:00');

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCALE_WIDTH = Math.min(SCREEN_WIDTH, 430);
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;
export const CARD_WIDTH = Math.min(SCREEN_WIDTH - sw(40), 500);
// Cap card height so there's always room for filter bar, buttons, tab bar & safe areas.
// Middle row removed — card can be taller now.
export const CARD_HEIGHT = Math.min(SCALE_WIDTH * 1.3, SCREEN_HEIGHT - 140);
// Minimum gap between card bottom and button row
export const MIN_CARD_BUTTON_GAP = 16;
const EXIT_DURATION = 200;

function VideoCardContent({ uri, muted, paused, onPlayerReady }) {
  const [visible, setVisible] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });

  useEffect(() => {
    if (onPlayerReady) onPlayerReady(player);
  }, [player]);

  useEffect(() => {
    if (player) player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (!player) return;
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);

  // Only show video view once the player is actually playing,
  // so the Image thumbnail stays visible underneath until then
  useEffect(() => {
    if (!player) return;
    if (player.playing) { setVisible(true); return; }
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) setVisible(true);
    });
    return () => sub.remove();
  }, [player]);

  return (
    <>
      <VideoView
        player={player}
        style={[styles.image, !visible && { opacity: 0 }]}
        contentFit="cover"
        nativeControls={false}
      />
      {!visible && (
        <View style={styles.videoLoading}>
          <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
        </View>
      )}
    </>
  );
}

const SwipeCard = React.memo(forwardRef(({ asset, onSwipeLeft, onSwipeRight, isPreview, muted, onToggleMute, screenFocused = true, onFileSizeLoaded, enterFrom, onEnterComplete, totalKept, totalTrashed, onShare }, ref) => {
  const { colors, theme } = useColors();
  const pan = useRef(new Animated.ValueXY(
    enterFrom ? { x: (enterFrom === 'left' ? -1 : 1) * SCREEN_WIDTH * 1.5, y: 0 } : { x: 0, y: 0 }
  )).current;
  const videoPlayerRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const pauseIconOpacity = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const animatingRef = useRef(!!enterFrom);
  const scrubbingRef = useRef(false);
  const progressBarWidth = useRef(0);
  const scrubBarHeight = useRef(new Animated.Value(3)).current;

  // Fly-in animation on undo
  useEffect(() => {
    if (!enterFrom) return;
    Animated.timing(pan, {
      toValue: { x: 0, y: 0 },
      duration: EXIT_DURATION,
      useNativeDriver: true,
    }).start(() => {
      animatingRef.current = false;
      if (onEnterComplete) onEnterComplete();
    });
  }, []);

  const isVideo = asset.mediaType === 'video';
  const [fileSize, setFileSize] = useState(asset.fileSize || null);
  const [imageUri, setImageUri] = useState(asset.uri);
  const [imageError, setImageError] = useState(false);
  const fallbackAttempted = useRef(false);

  // Fetch file size — try asset info, then new File class
  useEffect(() => {
    if (asset.fileSize) {
      setFileSize(asset.fileSize);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset.id);
        if (cancelled) return;
        let size = null;
        if (info.fileSize != null && info.fileSize > 0) {
          size = info.fileSize;
        } else if (info.localUri) {
          const file = new File(info.localUri);
          if (file.size > 0) size = file.size;
        }
        if (!cancelled && size) {
          setFileSize(size);
          if (onFileSizeLoaded) onFileSizeLoaded(asset.id, size);
        }
      } catch (e) {
        console.warn('File size fetch failed:', asset.filename, e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [asset.id, asset.fileSize, isPreview]);

  // Handle image load failure — try localUri from getAssetInfoAsync
  const handleImageError = useCallback(async () => {
    if (fallbackAttempted.current) {
      setImageError(true);
      return;
    }
    fallbackAttempted.current = true;
    try {
      const info = await MediaLibrary.getAssetInfoAsync(asset.id);
      if (info.localUri) {
        setImageUri(info.localUri);
      } else {
        setImageError(true);
      }
    } catch {
      setImageError(true);
    }
  }, [asset.id]);

  // Keep callbacks in refs so PanResponder always uses the latest
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  useEffect(() => { onSwipeLeftRef.current = onSwipeLeft; }, [onSwipeLeft]);
  useEffect(() => { onSwipeRightRef.current = onSwipeRight; }, [onSwipeRight]);

  // Expose swipe methods for button-triggered animations
  useImperativeHandle(ref, () => ({
    swipeLeft: () => {
      if (animatingRef.current) return;
      animatingRef.current = true;
      Animated.timing(pan, {
        toValue: { x: -SCREEN_WIDTH * 1.5, y: 0 },
        duration: EXIT_DURATION,
        useNativeDriver: true,
      }).start(() => {
        if (onSwipeLeftRef.current) onSwipeLeftRef.current();
      });
    },
    swipeRight: () => {
      if (animatingRef.current) return;
      animatingRef.current = true;
      Animated.timing(pan, {
        toValue: { x: SCREEN_WIDTH * 1.5, y: 0 },
        duration: EXIT_DURATION,
        useNativeDriver: true,
      }).start(() => {
        if (onSwipeRightRef.current) onSwipeRightRef.current();
      });
    },
  }));

  // Tap = toggle play/pause — call player directly for instant response
  const handleTapRef = useRef(() => {});
  handleTapRef.current = () => {
    if (!isVideo || isPreview) return;
    const newPaused = !paused;
    const player = videoPlayerRef.current;
    if (player) {
      if (newPaused) {
        player.pause();
        progressAnim.stopAnimation();
        progressRunning.current = false;
        Animated.timing(pauseIconOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      } else {
        player.play();
        if (startSmoothRef.current) startSmoothRef.current();
        Animated.timing(pauseIconOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      }
    }
    setPaused(newPaused);
  };

  // Scrub handler: seek video to position based on touch x
  const seekToX = (x) => {
    const player = videoPlayerRef.current;
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
      onPanResponderGrant: (e) => {
        scrubbingRef.current = true;
        progressAnim.stopAnimation();
        Animated.timing(scrubBarHeight, { toValue: 8, duration: 150, useNativeDriver: false }).start();
        seekToX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => {
        seekToX(e.nativeEvent.locationX);
      },
      onPanResponderRelease: () => {
        scrubbingRef.current = false;
        Animated.timing(scrubBarHeight, { toValue: 3, duration: 200, useNativeDriver: false }).start();
        if (startSmoothRef.current) startSmoothRef.current();
      },
      onPanResponderTerminate: () => {
        scrubbingRef.current = false;
        Animated.timing(scrubBarHeight, { toValue: 3, duration: 200, useNativeDriver: false }).start();
        if (startSmoothRef.current) startSmoothRef.current();
      },
    })
  ).current;

  // Smooth continuous progress bar — single animation from current to end
  const progressRunning = useRef(false);
  const startSmoothRef = useRef(null);
  useEffect(() => {
    if (!isVideo || isPreview) return;
    let stopped = false;

    const startSmooth = () => {
      const player = videoPlayerRef.current;
      if (!player || player.duration <= 0 || stopped || scrubbingRef.current || draggingRef.current) return;
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
          // Video looped — restart
          progressAnim.setValue(0);
          setTimeout(() => { if (!stopped) startSmooth(); }, 50);
        }
      });
    };

    startSmoothRef.current = startSmooth;

    // Listen for player playing state to start progress bar — no polling needed
    const tryStart = () => {
      if (stopped || scrubbingRef.current || draggingRef.current || progressRunning.current) return;
      const player = videoPlayerRef.current;
      if (player && player.duration > 0 && !paused) startSmooth();
    };

    // Check immediately in case player is already ready
    tryStart();

    // Listen for playing changes to catch when player becomes ready
    const player = videoPlayerRef.current;
    const sub = player && player.addListener ? player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) tryStart();
    }) : null;

    return () => {
      stopped = true;
      startSmoothRef.current = null;
      if (sub) sub.remove();
      progressAnim.stopAnimation();
      progressRunning.current = false;
    };
  }, [isVideo, isPreview, paused]);

  const draggingRef = useRef(false);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !scrubbingRef.current,
      onMoveShouldSetPanResponder: (_, g) => !scrubbingRef.current && (Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5),
      onPanResponderGrant: () => {
        draggingRef.current = true;
        // Pause progress bar animation to free JS thread during drag
        progressAnim.stopAnimation();
        progressRunning.current = false;
      },
      onPanResponderMove: (_, gesture) => {
        if (animatingRef.current || scrubbingRef.current) return;
        pan.setValue({ x: gesture.dx, y: gesture.dy * 0.3 });
      },
      onPanResponderRelease: (_, gesture) => {
        draggingRef.current = false;
        if (animatingRef.current) return;

        if (Math.abs(gesture.dx) < 5 && Math.abs(gesture.dy) < 5) {
          // Tap — handleTap controls player + progress bar directly
          handleTapRef.current();
          pan.setValue({ x: 0, y: 0 });
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          // Swipe left — fast exit
          animatingRef.current = true;
          Animated.timing(pan, {
            toValue: { x: -SCREEN_WIDTH * 1.5, y: gesture.dy },
            duration: EXIT_DURATION,
            useNativeDriver: true,
          }).start(() => {
                if (onSwipeLeftRef.current) onSwipeLeftRef.current();
          });
        } else if (gesture.dx > SWIPE_THRESHOLD) {
          // Swipe right — fast exit
          animatingRef.current = true;
          Animated.timing(pan, {
            toValue: { x: SCREEN_WIDTH * 1.5, y: gesture.dy },
            duration: EXIT_DURATION,
            useNativeDriver: true,
          }).start(() => {
                if (onSwipeRightRef.current) onSwipeRightRef.current();
          });
        } else {
          // Snap back
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            friction: 5,
            useNativeDriver: true,
          }).start();
          // Resume progress bar
          if (startSmoothRef.current) startSmoothRef.current();
        }
      },
    })
  ).current;

  const rotate = pan.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-15deg', '0deg', '15deg'],
    extrapolate: 'clamp',
  });

  const trashOpacity = pan.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const keepOpacity = pan.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: theme.card },
        isPreview
          ? styles.previewCard
          : {
              transform: [
                { translateX: pan.x },
                { translateY: pan.y },
                { rotateZ: rotate },
              ],
            },
      ]}
      {...(isPreview ? {} : panResponder.panHandlers)}
    >
      <View style={styles.cardInner}>
      {/* Image thumbnail — always rendered as base layer (prevents black flash for videos) */}
      {imageError ? (
        <View style={[styles.image, styles.errorPlaceholder, { backgroundColor: theme.card }]}>
          <Ionicons name="cloud-offline-outline" size={40} color={theme.textQuaternary} />
          <Text style={[styles.errorText, { color: theme.textQuaternary }]}>{t('card.unavailable')}</Text>
        </View>
      ) : (
        <Image
          source={{ uri: imageUri }}
          style={styles.image}
          contentFit="cover"
          onError={handleImageError}
        />
      )}

      {/* Video player on top — loads over the thumbnail */}
      {isVideo && !isPreview && (
        <View style={StyleSheet.absoluteFill}>
          <VideoCardContent
            uri={asset.uri}
            muted={muted}
            paused={paused || !screenFocused}
            onPlayerReady={(p) => { videoPlayerRef.current = p; }}
          />
        </View>
      )}

      {/* Pause overlay — smooth fade like trash expanded view */}
      {isVideo && !isPreview && (
        <Animated.View style={[styles.pauseOverlay, { opacity: pauseIconOpacity }]} pointerEvents="none">
          <Ionicons name="play" size={60} color="rgba(255,255,255,0.8)" />
        </Animated.View>
      )}

      {/* KEEP overlay */}
      {!isPreview && (
        <Animated.View style={[styles.overlay, { backgroundColor: colors.greenBg }, { opacity: keepOpacity }]}>
          <View style={[styles.overlayBadge, { borderColor: colors.green, transform: [{ rotateZ: '15deg' }] }]}>
            <Text style={[styles.overlayText, { color: colors.green }]}>{t('card.keep')}</Text>
            {totalKept != null && <Text style={[styles.overlayCount, { color: colors.green }]}>{totalKept + 1}</Text>}
          </View>
        </Animated.View>
      )}

      {/* TRASH overlay */}
      {!isPreview && (
        <Animated.View style={[styles.overlay, { backgroundColor: colors.redBg }, { opacity: trashOpacity }]}>
          <View style={[styles.overlayBadge, { borderColor: colors.red, transform: [{ rotateZ: '-15deg' }] }]}>
            <Text style={[styles.overlayText, { color: colors.red }]}>{t('card.trash')}</Text>
            {totalTrashed != null && <Text style={[styles.overlayCount, { color: colors.red }]}>{totalTrashed + 1}</Text>}
          </View>
        </Animated.View>
      )}

      {/* Mute toggle — inside card, above info pill */}
      {isVideo && !isPreview && onToggleMute && (
        <TouchableOpacity onPress={onToggleMute} activeOpacity={0.6} style={styles.muteBtn}>
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={17} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      )}

      {/* Info text + share */}
      <View style={styles.infoRow}>
        <View style={styles.infoPill}>
          <Text style={styles.infoText} numberOfLines={1}>
            {formatBytes(fileSize)}  ·  {formatDate(asset.creationTime)}
            {asset.duration ? `  ·  ${formatDuration(asset.duration)}` : ''}
          </Text>
        </View>
        {onShare && (
          <TouchableOpacity onPress={isPreview ? undefined : onShare} activeOpacity={0.6} style={styles.shareBtn}>
            <Ionicons name="share-outline" size={14} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        )}
      </View>

      {/* Video progress bar — scrubbable */}
      {isVideo && !isPreview && (
        <View
          style={styles.progressTouchArea}
          onLayout={(e) => { progressBarWidth.current = e.nativeEvent.layout.width; }}
          {...scrubResponder.panHandlers}
        >
          <Animated.View style={[styles.progressBar, { height: scrubBarHeight, backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <Animated.View style={[styles.progressFill, { backgroundColor: '#fff' },  {
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
                extrapolate: 'clamp',
              }),
            }]} />
          </Animated.View>
        </View>
      )}
      </View>
    </Animated.View>
  );
}));

export default SwipeCard;

const styles = StyleSheet.create({
  card: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    backgroundColor: '#1c1c1e',
  },
  cardInner: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  previewCard: {
    opacity: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  errorPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
  },
  errorText: {
    color: '#555',
    fontSize: sw(13),
    marginTop: 8,
  },
  videoLoading: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  flashIndicator: {
    position: 'absolute',
    top: '42%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  flashText: {
    color: '#fff',
    fontSize: sw(16),
    fontWeight: '700',
    letterSpacing: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayBadge: {
    borderWidth: 4,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignItems: 'center',
  },
  overlayText: {
    fontSize: sw(48),
    fontWeight: '900',
    letterSpacing: 4,
  },
  overlayCount: {
    fontSize: sw(22),
    fontWeight: '700',
    marginTop: 4,
  },
  progressTouchArea: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    height: 30,
    justifyContent: 'flex-end',
  },
  progressBar: {
    marginHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#fff',
  },
  muteBtn: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  infoRow: {
    position: 'absolute',
    bottom: 12,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  infoPill: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
  },
  shareBtn: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  infoText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: sw(11),
    fontWeight: '500',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
