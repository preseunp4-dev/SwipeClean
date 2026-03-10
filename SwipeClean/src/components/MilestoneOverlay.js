import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { sw } from '../utils/scale';

const { width: SCREEN_W } = Dimensions.get('window');

// Generate milestones: 100, 200, 300, 400, 500, 1000, 1500, 2000, ..., 50000
const MILESTONES = (() => {
  const m = [100, 200, 300, 400, 500, 1000];
  for (let i = 1500; i <= 50000; i += 500) m.push(i);
  return m;
})();

function getMilestoneMessage(count) {
  const title = t('milestones.photos', { count: count.toLocaleString() });
  if (count === 100) return { title, subtitle: t('milestones.onARoll'), icon: 'flame' };
  if (count === 200) return { title, subtitle: t('milestones.keepItUp'), icon: 'rocket' };
  if (count === 300) return { title, subtitle: t('milestones.cleaningMachine'), icon: 'flash' };
  if (count === 400) return { title, subtitle: t('milestones.unstoppable'), icon: 'star' };
  if (count === 500) return { title, subtitle: t('milestones.halfAThousand'), icon: 'trophy' };
  if (count === 1000) return { title, subtitle: t('milestones.legendary'), icon: 'medal' };
  const kTitle = t('milestones.photos', { count: `${(count / 1000).toFixed(count % 1000 === 0 ? 0 : 1)}K` });
  if (count >= 10000) return { title: kTitle, subtitle: t('milestones.absoluteLegend'), icon: 'diamond' };
  if (count >= 5000) return { title: kTitle, subtitle: t('milestones.incredibleDedication'), icon: 'diamond' };
  if (count >= 2000) return { title: kTitle, subtitle: t('milestones.storageHero'), icon: 'ribbon' };
  return { title, subtitle: t('milestones.keepGoing'), icon: 'star' };
}

export default function MilestoneOverlay({ totalReviewed }) {
  const [milestone, setMilestone] = useState(null);
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const lastShownRef = useRef(0);

  useEffect(() => {
    if (totalReviewed <= lastShownRef.current) return;
    if (!MILESTONES.includes(totalReviewed)) return;

    lastShownRef.current = totalReviewed;
    const msg = getMilestoneMessage(totalReviewed);
    if (!msg) return;

    // Small delay so the swipe animation finishes first
    const timer = setTimeout(() => {
      setMilestone(msg);
      scale.setValue(0);
      opacity.setValue(1);

      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.delay(1000),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => setMilestone(null));
    }, 350);

    return () => clearTimeout(timer);
  }, [totalReviewed]);

  if (!milestone) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity }]} pointerEvents="none">
      <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
        <Ionicons name={milestone.icon} size={48} color="#FFD60A" />
        <Text style={styles.title}>{milestone.title}</Text>
        <Text style={styles.subtitle}>{milestone.subtitle}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  card: {
    backgroundColor: 'rgba(28, 28, 30, 0.95)',
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 40,
    alignItems: 'center',
    width: SCREEN_W * 0.7,
    borderWidth: 1,
    borderColor: '#FFD60A40',
  },
  title: {
    color: '#fff',
    fontSize: sw(24),
    fontWeight: '800',
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    color: '#888',
    fontSize: sw(15),
    marginTop: 6,
    textAlign: 'center',
  },
});
