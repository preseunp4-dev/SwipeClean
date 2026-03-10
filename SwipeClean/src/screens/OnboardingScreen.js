import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { t } from '../i18n';
import { useColors } from '../context/ColorContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sw } from '../utils/scale';

const { width: SCREEN_W } = Dimensions.get('window');
const DOT_SIZE = 8;
const DOT_ACTIVE_W = 24;

const PAGES = [
  {
    icon: 'swap-horizontal',
    color: '#5856D6',
    titleKey: 'onboarding.page1Title',
    subtitleKey: 'onboarding.page1Subtitle',
  },
  {
    icon: 'copy',
    color: '#FF9500',
    titleKey: 'onboarding.page2Title',
    subtitleKey: 'onboarding.page2Subtitle',
  },
  {
    icon: 'trash',
    color: '#FF3B30',
    titleKey: 'onboarding.page3Title',
    subtitleKey: 'onboarding.page3Subtitle',
  },
];

export default function OnboardingScreen({ onDone }) {
  const { theme } = useColors();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const handleNext = async () => {
    if (activeIndex < PAGES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
    } else {
      await SecureStore.setItemAsync('onboarding_done', 'true');
      onDone();
    }
  };

  const handleSkip = async () => {
    await SecureStore.setItemAsync('onboarding_done', 'true');
    onDone();
  };

  // Track scroll position and update button at halfway point
  const lastIndex = useRef(0);
  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    {
      useNativeDriver: false,
      listener: (e) => {
        const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
        if (idx !== lastIndex.current) {
          lastIndex.current = idx;
          setActiveIndex(idx);
        }
      },
    }
  );

  // Pre-compute dot interpolations
  const dotAnims = PAGES.map((_, i) => ({
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
    backgroundColor: scrollX.interpolate({
      inputRange: [(i - 1) * SCREEN_W, i * SCREEN_W, (i + 1) * SCREEN_W],
      outputRange: [theme.dotInactive, '#5856D6', theme.dotInactive],
      extrapolate: 'clamp',
    }),
  }));

  // Crossfade between "Next" and "Get Started" on last page transition
  const lastPageStart = (PAGES.length - 2) * SCREEN_W;
  const lastPageEnd = (PAGES.length - 1) * SCREEN_W;
  const nextOpacity = scrollX.interpolate({
    inputRange: [lastPageStart, lastPageStart + SCREEN_W * 0.4, lastPageEnd],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });
  const getStartedOpacity = scrollX.interpolate({
    inputRange: [lastPageStart, lastPageStart + SCREEN_W * 0.6, lastPageEnd],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <TouchableOpacity style={[styles.skipButton, { top: insets.top + 13 }]} onPress={handleSkip} activeOpacity={0.7}>
        <Text style={[styles.skipText, { color: theme.textSecondary }]}>{t('onboarding.skip')}</Text>
      </TouchableOpacity>

      <Animated.FlatList
        ref={flatListRef}
        data={PAGES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <View style={styles.page}>
            <View style={[styles.iconCircle, { backgroundColor: item.color + '20' }]}>
              <Ionicons name={item.icon} size={64} color={item.color} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>{t(item.titleKey)}</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{t(item.subtitleKey)}</Text>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {dotAnims.map((anim, i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  width: anim.width,
                  opacity: anim.opacity,
                  backgroundColor: anim.backgroundColor,
                },
              ]}
            />
          ))}
        </View>

        <TouchableOpacity activeOpacity={0.7} onPress={handleNext}>
          <View style={styles.nextButton}>
            <Animated.View style={[styles.buttonContent, { opacity: nextOpacity }]}>
              <Text style={styles.nextText}>{t('onboarding.next')}</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Animated.View>
            <Animated.View style={[styles.buttonContent, styles.buttonContentOverlay, { opacity: getStartedOpacity }]}>
              <Text style={styles.nextText}>{t('onboarding.getStarted')}</Text>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </Animated.View>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skipButton: {
    position: 'absolute',
    right: sw(24),
    zIndex: 10,
  },
  skipText: {
    fontSize: sw(16),
    fontWeight: '600',
  },
  page: {
    width: SCREEN_W,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: sw(40),
  },
  iconCircle: {
    width: sw(130),
    height: sw(130),
    borderRadius: sw(65),
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: sw(28),
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: sw(16),
    lineHeight: sw(24),
    textAlign: 'center',
  },
  footer: {
    paddingBottom: 50,
    paddingHorizontal: 30,
    alignItems: 'center',
    gap: 24,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  nextButton: {
    backgroundColor: '#5856D6',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonContentOverlay: {
    position: 'absolute',
  },
  nextText: {
    color: '#fff',
    fontSize: sw(17),
    fontWeight: '700',
  },
});
