import React, { useRef, useCallback, useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const AnimatedImage = Animated.createAnimatedComponent(Image);

export default function ZoomableImage({ uri, width, height, onZoomChange }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const isZoomedShared = useSharedValue(false);
  const isZoomedRef = useRef(false);

  // Reset zoom when page changes (FlatList reuses components)
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    if (isZoomedRef.current) {
      isZoomedRef.current = false;
      onZoomChange?.(false);
    }
  }, [uri]);

  const notifyZoom = useCallback((zoomed) => {
    if (zoomed !== isZoomedRef.current) {
      isZoomedRef.current = zoomed;
      isZoomedShared.value = zoomed;
      onZoomChange?.(zoomed);
    }
  }, [onZoomChange]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(notifyZoom)(false);
      } else if (scale.value > 5) {
        scale.value = withTiming(5);
        savedScale.value = 5;
        runOnJS(notifyZoom)(true);
      } else {
        savedScale.value = scale.value;
        runOnJS(notifyZoom)(scale.value > 1.05);
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .manualActivation(true)
    .onTouchesMove((_, state) => {
      if (savedScale.value > 1.05) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onUpdate((e) => {
      if (savedScale.value > 1.05) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;

      // If zoomed out, snap back
      if (savedScale.value <= 1.05) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        // Clamp translation so image doesn't go too far off screen
        const maxX = (width * savedScale.value - width) / 2;
        const maxY = (height * savedScale.value - height) / 2;
        if (translateX.value > maxX) {
          translateX.value = withTiming(maxX);
          savedTranslateX.value = maxX;
        } else if (translateX.value < -maxX) {
          translateX.value = withTiming(-maxX);
          savedTranslateX.value = -maxX;
        }
        if (translateY.value > maxY) {
          translateY.value = withTiming(maxY);
          savedTranslateY.value = maxY;
        } else if (translateY.value < -maxY) {
          translateY.value = withTiming(-maxY);
          savedTranslateY.value = -maxY;
        }
      }
    });

  // Double tap to toggle zoom
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (savedScale.value > 1.05) {
        // Zoom out
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(notifyZoom)(false);
      } else {
        // Zoom in to 2.5x centered on tap point
        const targetScale = 2.5;
        const tapX = e.x - width / 2;
        const tapY = e.y - height / 2;
        const tx = -tapX * (targetScale - 1);
        const ty = -tapY * (targetScale - 1);
        scale.value = withTiming(targetScale);
        translateX.value = withTiming(tx);
        translateY.value = withTiming(ty);
        savedScale.value = targetScale;
        savedTranslateX.value = tx;
        savedTranslateY.value = ty;
        runOnJS(notifyZoom)(true);
      }
    });

  const composed = Gesture.Simultaneous(
    pinch,
    Gesture.Race(doubleTap, pan)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={[styles.container, { width, height }]}>
      <GestureDetector gesture={composed}>
        <AnimatedImage
          source={{ uri }}
          style={[{ width, height }, animatedStyle]}
          contentFit="cover"
        />
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'visible',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
