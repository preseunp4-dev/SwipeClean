import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Alert, Linking, InteractionManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import { useApp, DAILY_FREE_LIMIT } from '../context/AppContext';
import { useColors } from '../context/ColorContext';
import { LinearGradient } from 'expo-linear-gradient';
import { t } from '../i18n';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showOnboardingRef } from '../utils/onboardingRef';
import { sw, sh } from '../utils/scale';
import { formatBytes as _formatBytes } from '../utils/formatting';

const formatBytes = (b) => _formatBytes(b, '0 B');

export default function StatsScreen() {
  const { state, resetSeenIds } = useApp();
  const { colors, colorblind, toggle: toggleColorblind, theme, isDark, toggleTheme } = useColors();
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const scrollRef = useRef(null);
  const upgradeY = useRef(0);
  const { trashed, dailySwipes, isPro, totalSpaceSaved,
          totalKept, totalTrashed, totalKeptSize, totalLibrarySize } = state;

  const reviewed = totalKept + totalTrashed;
  const remaining = Math.max(0, totalLibrarySize - reviewed);
  const trashedSize = useMemo(() => trashed.reduce((sum, a) => sum + (a.fileSize || 0), 0), [trashed]);
  const keptSize = totalKeptSize;

  const trashPercent = reviewed > 0 ? Math.round((totalTrashed / reviewed) * 100) : 0;
  const swipesRemaining = Math.max(0, DAILY_FREE_LIMIT - dailySwipes);
  const swipePercent = Math.min(100, (dailySwipes / DAILY_FREE_LIMIT) * 100);

  useEffect(() => {
    if (route.params?.scrollToUpgrade && scrollRef.current) {
      setTimeout(() => {
        scrollRef.current.scrollTo({ y: upgradeY.current, animated: true });
      }, 300);
    }
  }, [route.params?.scrollToUpgrade]);

  const handleTestOnboarding = async () => {
    await SecureStore.deleteItemAsync('onboarding_done');
    if (showOnboardingRef.current) {
      showOnboardingRef.current('v1');
    }
  };

  const handleTestOnboardingV2 = async () => {
    await SecureStore.deleteItemAsync('onboarding_done');
    if (showOnboardingRef.current) {
      showOnboardingRef.current('v2');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={{ height: insets.top + 83 }} />

        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <View style={styles.row}>
            <StatBox label={t('stats.reviewed')} value={reviewed} color={theme.text} theme={theme} />
            <StatBox label={t('stats.remaining')} value={remaining} color={theme.textSecondary} theme={theme} />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View style={styles.row}>
            <StatBox label={t('stats.trashed')} value={totalTrashed} color={colors.red} theme={theme} />
            <StatBox label={t('stats.kept')} value={totalKept} color={colors.green} theme={theme} />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {/* Progress bar */}
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{t('stats.ratio')}</Text>
          <View style={[styles.progressBarBg, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.progressBarKeep,
                { flex: totalKept || 0.01, backgroundColor: colors.green },
              ]}
            />
            <View
              style={[
                styles.progressBarTrash,
                { flex: totalTrashed || 0.01, backgroundColor: colors.red },
              ]}
            />
          </View>
          <Text style={[styles.percentText, { color: theme.textSecondary }]}>
            {t('stats.ratioText', { percent: trashPercent })}
          </Text>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{t('stats.storage')}</Text>
          <View style={styles.row}>
            <View style={styles.storageBox}>
              <Text style={[styles.storageValue, { color: colors.red }]}>
                {formatBytes(trashedSize)}
              </Text>
              <Text style={[styles.storageLabel, { color: theme.textSecondary }]}>{t('stats.toBeFreed')}</Text>
            </View>
            <View style={styles.storageBox}>
              <Text style={[styles.storageValue, { color: colors.green }]}>
                {formatBytes(keptSize)}
              </Text>
              <Text style={[styles.storageLabel, { color: theme.textSecondary }]}>{t('stats.keeping')}</Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.spaceSavedRow}>
            <Ionicons name="checkmark-circle" size={20} color="#5856D6" />
            <View style={styles.spaceSavedInfo}>
              <Text style={styles.spaceSavedValue}>{formatBytes(totalSpaceSaved)}</Text>
              <Text style={[styles.spaceSavedLabel, { color: theme.textSecondary }]}>{t('stats.spaceSaved')}</Text>
            </View>
          </View>
        </View>

        {/* Daily swipes card */}
        {!isPro && (
          <View style={[styles.dailyCard, { backgroundColor: theme.card }]} onLayout={(e) => { upgradeY.current = e.nativeEvent.layout.y; }}>
            <View style={styles.dailyHeader}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{t('stats.dailySwipes')}</Text>
              <Text style={styles.dailyCount}>
                {dailySwipes} / {DAILY_FREE_LIMIT}
              </Text>
            </View>
            <View style={[styles.dailyBarBg, { backgroundColor: theme.border }]}>
              <View style={[styles.dailyBarFill, { width: `${swipePercent}%` }]} />
            </View>
            <Text style={[styles.dailyRemaining, { color: theme.textSecondary }]}>
              {t('stats.swipesRemaining', { count: swipesRemaining })}
            </Text>

            <View style={styles.upgradeOptions}>
              <TouchableOpacity style={styles.upgradeButton} activeOpacity={0.7}>
                <Ionicons name="infinite" size={20} color="#fff" style={{ marginBottom: 4 }} />
                <Text style={styles.upgradeTitle}>{t('stats.unlimited')}</Text>
                <Text style={styles.upgradePrice}>{t('stats.oneTimePrice')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.upgradeButton, styles.subscribeButton, { backgroundColor: theme.isDark ? theme.card : theme.bg }]} activeOpacity={0.7}>
                <Ionicons name="refresh" size={20} color={theme.isDark ? '#fff' : '#5856D6'} style={{ marginBottom: 4 }} />
                <Text style={[styles.upgradeTitle, !theme.isDark && { color: '#5856D6' }]}>{t('stats.weekly')}</Text>
                <Text style={[styles.upgradePrice, !theme.isDark && { color: 'rgba(88, 86, 214, 0.6)' }]}>{t('stats.weeklyPrice')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.legalText, { color: theme.textQuaternary }]}>
              {t('stats.legalText')}
            </Text>
            <TouchableOpacity onPress={() => {}} activeOpacity={0.7} style={styles.restoreButton}>
              <Text style={styles.restoreText}>{t('stats.restorePurchases')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Reset seen photos */}
        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              t('stats.startFreshTitle'),
              t('stats.startFreshMessage'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.reset'), onPress: resetSeenIds },
              ]
            );
          }}
          style={[styles.resetSeenButton, { borderColor: theme.border }]}
          activeOpacity={0.7}
        >
          <Ionicons name="refresh" size={18} color="#5856D6" style={{ marginRight: 8 }} />
          <Text style={styles.resetSeenText}>{t('stats.showAllPhotos')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleTestOnboarding}
          style={[styles.testOnboardingButton, { borderColor: theme.border }]}
          activeOpacity={0.7}
        >
          <Ionicons name="play-outline" size={18} color={theme.textSecondary} style={{ marginRight: 8 }} />
          <Text style={[styles.testOnboardingText, { color: theme.textSecondary }]}>{t('stats.howItWorks')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleTestOnboardingV2}
          style={[styles.testOnboardingButton, { borderColor: theme.border }]}
          activeOpacity={0.7}
        >
          <Ionicons name="phone-portrait-outline" size={18} color={theme.textSecondary} style={{ marginRight: 8 }} />
          <Text style={[styles.testOnboardingText, { color: theme.textSecondary }]}>{t('stats.howItWorks')} V2</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.colorblindToggle, { borderColor: theme.border }, colorblind && styles.colorblindToggleActive]}
          onPress={toggleColorblind}
          activeOpacity={0.7}
        >
          <Ionicons name={colorblind ? 'eye' : 'eye-outline'} size={18} color={colorblind ? '#5856D6' : theme.textSecondary} style={{ marginRight: 8 }} />
          <Text style={[styles.colorblindText, { color: theme.textSecondary }, colorblind && styles.colorblindTextActive]}>
            {t('stats.colorblindMode')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={toggleTheme}
          style={[styles.testOnboardingButton, { borderColor: theme.border }, !isDark && { borderColor: '#5856D6' }]}
          activeOpacity={0.7}
        >
          <Ionicons name={isDark ? 'moon-outline' : 'sunny'} size={18} color={isDark ? theme.textSecondary : '#5856D6'} style={{ marginRight: 8 }} />
          <Text style={[styles.testOnboardingText, { color: isDark ? theme.textSecondary : '#5856D6' }]}>{isDark ? 'Dark Mode' : 'Light Mode'}</Text>
        </TouchableOpacity>

        <View style={styles.legalFooter}>
          <TouchableOpacity onPress={() => Linking.openURL('https://digi4269.github.io/Swipeclean-Legal/privacy.html')} activeOpacity={0.7}>
            <Text style={[styles.legalLink, { color: theme.textQuaternary }]}>{t('stats.privacyPolicy')}</Text>
          </TouchableOpacity>
          <Text style={[styles.legalDot, { color: theme.textQuaternary }]}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://digi4269.github.io/Swipeclean-Legal/terms.html')} activeOpacity={0.7}>
            <Text style={[styles.legalLink, { color: theme.textQuaternary }]}>{t('stats.termsOfUse')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <LinearGradient
        colors={theme.headerGradient}
        locations={[0, 0.35, 0.5, 0.6, 0.7, 0.8, 0.88, 0.95, 1]}
        style={[styles.header, { paddingTop: insets.top + 13 }]}
        pointerEvents="box-none"
      >
        <Text style={[styles.title, { color: theme.text }]}>{t('stats.title')}</Text>
      </LinearGradient>
    </View>
  );
}

function StatBox({ label, value, color, theme }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
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
  title: {
    color: '#fff',
    fontSize: sw(28),
    fontWeight: '800',
  },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    padding: 24,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 18,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: sw(36),
    fontWeight: '800',
  },
  statLabel: {
    color: '#888',
    fontSize: sw(13),
    marginTop: 4,
  },
  sectionLabel: {
    color: '#888',
    fontSize: sw(13),
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressBarBg: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#333',
  },
  progressBarKeep: {
    borderRadius: 6,
  },
  progressBarTrash: {
    borderRadius: 6,
  },
  percentText: {
    color: '#666',
    fontSize: sw(12),
    marginTop: 8,
  },
  storageBox: {
    alignItems: 'center',
    flex: 1,
  },
  storageValue: {
    fontSize: sw(22),
    fontWeight: '700',
  },
  storageLabel: {
    color: '#888',
    fontSize: sw(12),
    marginTop: 4,
  },
  // Daily swipes card
  dailyCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    padding: 24,
    marginTop: 16,
  },
  dailyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dailyCount: {
    color: '#5856D6',
    fontSize: sw(15),
    fontWeight: '700',
  },
  dailyBarBg: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#333',
    overflow: 'hidden',
  },
  dailyBarFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#5856D6',
  },
  dailyRemaining: {
    color: '#666',
    fontSize: sw(12),
    marginTop: 8,
  },
  upgradeOptions: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 10,
  },
  upgradeButton: {
    flex: 1,
    backgroundColor: '#5856D6',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  subscribeButton: {
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#5856D6',
  },
  upgradeTitle: {
    color: '#fff',
    fontSize: sw(15),
    fontWeight: '800',
  },
  upgradePrice: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: sw(12),
    marginTop: 2,
  },
  spaceSavedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  spaceSavedInfo: {
    flex: 1,
  },
  spaceSavedValue: {
    color: '#5856D6',
    fontSize: sw(22),
    fontWeight: '700',
  },
  spaceSavedLabel: {
    color: '#888',
    fontSize: sw(12),
    marginTop: 2,
  },
  resetSeenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  resetSeenText: {
    color: '#5856D6',
    fontSize: sw(15),
    fontWeight: '700',
  },
  legalText: {
    color: '#555',
    fontSize: sw(11),
    textAlign: 'center',
    marginTop: 12,
    lineHeight: sw(16),
  },
  restoreButton: {
    alignSelf: 'center',
    marginTop: 10,
  },
  restoreText: {
    color: '#5856D6',
    fontSize: sw(13),
    fontWeight: '600',
  },
  legalFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    gap: 8,
  },
  legalLink: {
    color: '#555',
    fontSize: sw(12),
  },
  legalDot: {
    color: '#555',
    fontSize: sw(12),
  },
  colorblindToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  colorblindToggleActive: {
    borderColor: '#FFD60A',
  },
  colorblindText: {
    color: '#888',
    fontSize: sw(15),
    fontWeight: '700',
  },
  colorblindTextActive: {
    color: '#5856D6',
  },
  testOnboardingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  testOnboardingText: {
    color: '#666',
    fontSize: sw(15),
    fontWeight: '700',
  },
});
