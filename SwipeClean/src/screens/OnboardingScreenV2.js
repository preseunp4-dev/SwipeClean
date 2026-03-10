import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import Svg, { Path } from 'react-native-svg';
import { t } from '../i18n';
import { useColors } from '../context/ColorContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sw } from '../utils/scale';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const DOT_SIZE = 8;
const DOT_ACTIVE_W = 24;
const NEON = '#FF6D00';

// WhatsApp-compressed iPhone 13 screenshots: 946x2048
const ASPECT = 2048 / 946;

// Single hero phone: ~55% of screen width
const HERO_W = SCREEN_W * 0.55;
const HERO_H = HERO_W * ASPECT;
const MAX_HERO_H = SCREEN_H * 0.46;
const HERO_SCALE = Math.min(1, MAX_HERO_H / HERO_H);
const PHONE_W = HERO_W * HERO_SCALE;
const PHONE_H = HERO_H * HERO_SCALE;

// Dual phones: ~42% width each, overlapping slightly
const DUAL_W = SCREEN_W * 0.40;
const DUAL_H = DUAL_W * ASPECT;
const MAX_DUAL_H = SCREEN_H * 0.42;
const DUAL_SCALE = Math.min(1, MAX_DUAL_H / DUAL_H);
const SMALL_W = DUAL_W * DUAL_SCALE;
const SMALL_H = DUAL_H * DUAL_SCALE;

const ARROW_SIZE = 50;

const screenshots = {
  swipe: require('../../assets/onboarding/swipe.jpg'),
  duplicates: require('../../assets/onboarding/duplicates.jpg'),
  trash: require('../../assets/onboarding/trash.jpg'),
  stats: require('../../assets/onboarding/stats.jpg'),
  settings: require('../../assets/onboarding/settings.jpg'),
};

// Gray block covering photo content
function PhotoBlock({ top, left, width, height }) {
  return (
    <View style={{
      position: 'absolute',
      top: `${top}%`, left: `${left}%`,
      width: `${width}%`, height: `${height}%`,
      backgroundColor: '#2c2c2e',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <Ionicons name="image-outline" size={Math.max(12, SMALL_W * 0.08)} color="rgba(255,255,255,0.18)" />
    </View>
  );
}

// Phone frame
function Phone({ source, w, h, style, children }) {
  return (
    <View style={[{ width: w, height: h, borderRadius: w * 0.08, borderWidth: 2, borderColor: '#444', overflow: 'hidden' }, style]}>
      <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      {children}
    </View>
  );
}

// Curved arrow (SVG)
function Arrow({ style, direction }) {
  const paths = {
    'down-right': { c: 'M 5 5 Q 5 38, 40 42', h: 'M 33 35 L 42 44 L 33 48' },
    'down-left': { c: 'M 45 5 Q 45 38, 10 42', h: 'M 17 35 L 8 44 L 17 48' },
    'down': { c: 'M 25 5 Q 25 28, 25 42', h: 'M 18 36 L 25 45 L 32 36' },
  };
  const p = paths[direction] || paths['down-right'];
  return (
    <View style={[{ width: ARROW_SIZE, height: ARROW_SIZE }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 50 50">
        <Path d={p.c} stroke={NEON} strokeWidth={3.5} strokeLinecap="round" fill="none" />
        <Path d={p.h} stroke={NEON} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

function Badge({ text, style }) {
  return (
    <View style={[{ backgroundColor: NEON, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 }, style]}>
      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{text}</Text>
    </View>
  );
}

// ─── PAGE 1: Swipe (hero) ───
function Page1() {
  return (
    <View style={pg.wrap}>
      <View style={pg.heroRow}>
        <View style={pg.leftAnnotation}>
          <Badge text="TRASH" />
          <Arrow direction="down-right" style={{ marginTop: -4 }} />
        </View>
        <Phone source={screenshots.swipe} w={PHONE_W} h={PHONE_H}>
          <PhotoBlock top={8.5} left={2.5} width={95} height={61} />
        </Phone>
        <View style={pg.rightAnnotation}>
          <Badge text="KEEP" />
          <Arrow direction="down-left" style={{ marginTop: -4 }} />
        </View>
      </View>
    </View>
  );
}

// ─── PAGE 2: Duplicates + Trash (dual) ───
function Page2() {
  return (
    <View style={pg.wrap}>
      <View style={pg.dualRow}>
        <View style={pg.dualPhoneWrap}>
          <Phone source={screenshots.duplicates} w={SMALL_W} h={SMALL_H} style={{ transform: [{ rotate: '-3deg' }] }}>
            {/* Group 1 photos */}
            <PhotoBlock top={8} left={3} width={42} height={9} />
            {/* Group 2 photos */}
            <PhotoBlock top={22.5} left={3} width={62} height={8.5} />
            {/* Group 3 photos */}
            <PhotoBlock top={36} left={3} width={62} height={9} />
          </Phone>
          <Badge text="FIND" style={{ marginTop: 8 }} />
        </View>
        <View style={pg.dualPhoneWrap}>
          <Phone source={screenshots.trash} w={SMALL_W} h={SMALL_H} style={{ transform: [{ rotate: '3deg' }] }}>
            <PhotoBlock top={9} left={0} width={100} height={54} />
          </Phone>
          <Badge text="REVIEW" style={{ marginTop: 8 }} />
        </View>
      </View>
    </View>
  );
}

// ─── PAGE 3: Stats + Settings (dual) ───
function Page3() {
  return (
    <View style={pg.wrap}>
      <View style={pg.dualRow}>
        <View style={pg.dualPhoneWrap}>
          <Phone source={screenshots.stats} w={SMALL_W} h={SMALL_H} style={{ transform: [{ rotate: '-3deg' }] }} />
          <Badge text="TRACK" style={{ marginTop: 8 }} />
        </View>
        <View style={pg.dualPhoneWrap}>
          <Phone source={screenshots.settings} w={SMALL_W} h={SMALL_H} style={{ transform: [{ rotate: '3deg' }] }} />
          <Badge text="CUSTOMIZE" style={{ marginTop: 8 }} />
        </View>
      </View>
    </View>
  );
}

const pg = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leftAnnotation: {
    alignItems: 'center',
    marginBottom: PHONE_H * 0.15,
  },
  rightAnnotation: {
    alignItems: 'center',
    marginBottom: PHONE_H * 0.15,
  },
  dualRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  dualPhoneWrap: {
    alignItems: 'center',
  },
});

// ─── PAGES CONFIG ───

const PAGES = [
  { Mockup: Page1, titleKey: 'onboarding.page1Title', subtitleKey: 'onboarding.page1Subtitle' },
  { Mockup: Page2, titleKey: 'onboarding.page2Title', subtitleKey: 'onboarding.page2Subtitle' },
  { Mockup: Page3, titleKey: 'onboarding.page5Title', subtitleKey: 'onboarding.page5Subtitle' },
];

// ─── MAIN COMPONENT ───

export default function OnboardingScreenV2({ onDone }) {
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
        renderItem={({ item }) => {
          const { Mockup } = item;
          return (
            <View style={styles.page}>
              <Mockup />
              <Text style={[styles.title, { color: theme.text }]}>{t(item.titleKey)}</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{t(item.subtitleKey)}</Text>
            </View>
          );
        }}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {dotAnims.map((anim, i) => (
            <Animated.View
              key={i}
              style={[styles.dot, { width: anim.width, opacity: anim.opacity, backgroundColor: anim.backgroundColor }]}
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
  container: { flex: 1 },
  skipButton: { position: 'absolute', right: sw(24), zIndex: 10 },
  skipText: { fontSize: sw(16), fontWeight: '600' },
  page: {
    width: SCREEN_W,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: { fontSize: sw(26), fontWeight: '800', marginBottom: 10, textAlign: 'center', marginTop: 18 },
  subtitle: { fontSize: sw(15), lineHeight: sw(22), textAlign: 'center' },
  footer: { paddingBottom: 50, paddingHorizontal: 30, alignItems: 'center', gap: 24 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  nextButton: {
    backgroundColor: '#5856D6',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonContentOverlay: { position: 'absolute' },
  nextText: { color: '#fff', fontSize: sw(17), fontWeight: '700' },
});
