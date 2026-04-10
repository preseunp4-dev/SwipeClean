import React, { useRef, useCallback, useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

let Animated, useSharedValue, useAnimatedStyle, withTiming, runOnJS;
let Gesture, GestureDetector;
let reanimatedAvailable = false;

try {
  const reanimated = require('react-native-reanimated');
  Animated = reanimated.default;
  useSharedValue = reanimated.useSharedValue;
  useAnimatedStyle = reanimated.useAnimatedStyle;
  withTiming = reanimated.withTiming;
  runOnJS = reanimated.runOnJS;
  const rngh = require('react-native-gesture-handler');
  Gesture = rngh.Gesture;
  GestureDetector = rngh.GestureDetector;
  reanimatedAvailable = true;
} catch {
  // Expo Go — reanimated not available
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Simple fallback for Expo Go (no zoom, just shows the image)
function SimpleImage({ uri, width, height }) {
  return (
    <View style={[styles.container, { width, height }]}>
      <Image source={{ uri }} style={{ width, height }} contentFit="cover" />
    </View>
  );
}

// Full zoomable version for production builds
function ZoomableImageFull({ uri, width, height, onZoomChange }) {
  const AnimatedImage = Animated.createAnimatedComponent(Image);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const isZoomedRef = useRef(false);

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
      onZoomChange?.(zoomed);
    }
  }, [onZoomChange]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = savedScale.value * e.scale; })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withTiming(1); translateX.value = withTiming(0); translateY.value = withTiming(0);
        savedScale.value = 1; savedTranslateX.value = 0; savedTranslateY.value = 0;
        runOnJS(notifyZoom)(false);
      } else if (scale.value > 5) {
        scale.value = withTiming(5); savedScale.value = 5; runOnJS(notifyZoom)(true);
      } else {
        savedScale.value = scale.value; runOnJS(notifyZoom)(scale.value > 1.05);
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1).maxPointers(2)
    .manualActivation(true)
    .onTouchesMove((_, state) => { if (savedScale.value > 1.05) state.activate(); else state.fail(); })
    .onUpdate((e) => {
      if (savedScale.value > 1.05) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value;
      if (savedScale.value <= 1.05) {
        translateX.value = withTiming(0); translateY.value = withTiming(0);
        savedTranslateX.value = 0; savedTranslateY.value = 0;
      } else {
        const maxX = (width * savedScale.value - width) / 2;
        const maxY = (height * savedScale.value - height) / 2;
        if (translateX.value > maxX) { translateX.value = withTiming(maxX); savedTranslateX.value = maxX; }
        else if (translateX.value < -maxX) { translateX.value = withTiming(-maxX); savedTranslateX.value = -maxX; }
        if (translateY.value > maxY) { translateY.value = withTiming(maxY); savedTranslateY.value = maxY; }
        else if (translateY.value < -maxY) { translateY.value = withTiming(-maxY); savedTranslateY.value = -maxY; }
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (savedScale.value > 1.05) {
        scale.value = withTiming(1); translateX.value = withTiming(0); translateY.value = withTiming(0);
        savedScale.value = 1; savedTranslateX.value = 0; savedTranslateY.value = 0;
        runOnJS(notifyZoom)(false);
      } else {
        const targetScale = 2.5;
        const tapX = e.x - width / 2, tapY = e.y - height / 2;
        const tx = -tapX * (targetScale - 1), ty = -tapY * (targetScale - 1);
        scale.value = withTiming(targetScale); translateX.value = withTiming(tx); translateY.value = withTiming(ty);
        savedScale.value = targetScale; savedTranslateX.value = tx; savedTranslateY.value = ty;
        runOnJS(notifyZoom)(true);
      }
    });

  const composed = Gesture.Simultaneous(pinch, Gesture.Race(doubleTap, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <View style={[styles.container, { width, height }]}>
      <GestureDetector gesture={composed}>
        <AnimatedImage source={{ uri }} style={[{ width, height }, animatedStyle]} contentFit="cover" />
      </GestureDetector>
    </View>
  );
}

export default function ZoomableImage(props) {
  if (reanimatedAvailable) return <ZoomableImageFull {...props} />;
  return <SimpleImage {...props} />;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'visible',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
