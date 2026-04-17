import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View, Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppProvider } from './src/context/AppContext';
import { ColorProvider, useColors } from './src/context/ColorContext';
import { PurchaseProvider } from './src/context/PurchaseContext';
import SwipeScreen from './src/screens/SwipeScreen';
import TrashScreen from './src/screens/TrashScreen';
import DuplicatesScreen from './src/screens/DuplicatesScreen';
import StatsScreen from './src/screens/StatsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import OnboardingScreenV2 from './src/screens/OnboardingScreenV2';
import ErrorBoundary from './src/components/ErrorBoundary';
import { showOnboardingRef } from './src/utils/onboardingRef';
import { splashRef } from './src/utils/splashRef';
import * as duplicatesStore from './src/utils/duplicatesStore';

const Tab = createBottomTabNavigator();

const TabIcon = React.memo(function TabIcon({ label, focused, activeTint, inactiveTint }) {
  const icons = {
    Swipe:      focused ? 'swap-horizontal'  : 'swap-horizontal-outline',
    Trash:      focused ? 'trash'            : 'trash-outline',
    Duplicates: focused ? 'copy'             : 'copy-outline',
    Stats:      focused ? 'stats-chart'      : 'stats-chart-outline',
  };
  return (
    <Ionicons
      name={icons[label] || 'ellipse'}
      size={24}
      color={focused ? activeTint : inactiveTint}
    />
  );
});

function MainTabs() {
  const { theme } = useColors();
  const insets = useSafeAreaInsets();

  return (
    <NavigationContainer>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Tab.Navigator
        initialRouteName="Swipe"
        screenOptions={({ route }) => ({
          lazy: true,
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.card,
            borderTopColor: theme.border,
            borderTopWidth: 0.5,
            height: 51 + insets.bottom,
            paddingTop: 8,
          },
          tabBarActiveTintColor: theme.text,
          tabBarInactiveTintColor: theme.textSecondary,
          sceneStyle: { backgroundColor: theme.bg },
          tabBarIcon: ({ focused }) => (
            <TabIcon
              label={route.name}
              focused={focused}
              activeTint={theme.text}
              inactiveTint={theme.textSecondary}
            />
          ),
        })}
      >
        <Tab.Screen name="Trash" component={TrashScreen} />
        <Tab.Screen name="Swipe" component={SwipeScreen} />
        <Tab.Screen name="Duplicates" component={DuplicatesScreen} />
        <Tab.Screen name="Stats" component={StatsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  // showOnboarding: null (loading), false (hidden), 'v1', 'v2'
  const [showOnboarding, setShowOnboarding] = useState(null);
  showOnboardingRef.current = setShowOnboarding;

  // Custom splash overlay — covers the app from first React render until the
  // first photo batch is actually ready inside SwipeScreen. Visually matches
  // the native splash (same bg, same icon) so the transition is seamless.
  const [splashVisible, setSplashVisible] = useState(true);
  const splashHiddenRef = useRef(false);
  const hideSplash = () => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    setSplashVisible(false);
  };
  splashRef.current = hideSplash;

  useEffect(() => {
    SecureStore.getItemAsync('onboarding_done').then((val) => {
      setShowOnboarding(val !== 'true' ? 'v1' : false);
    });
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('overlay-swipe');
    }
    // Fire the duplicate scan at root-mount time — before SwipeScreen even
    // mounts. The scan runs on a native thread, so there's no JS-thread
    // cost, and it can shave ~200ms off time-to-first-duplicate.
    // startScan is idempotent, so it's safe if SwipeScreen later calls it too.
    duplicatesStore.startScan();
    // Safety: never leave the user stuck on the splash if something goes
    // wrong (permission denied, empty library, native module error).
    const fallback = setTimeout(hideSplash, 6000);
    return () => clearTimeout(fallback);
  }, []);

  // If onboarding is showing, hide the splash immediately — onboarding is its
  // own fullscreen experience and doesn't depend on photos being loaded.
  useEffect(() => {
    if (showOnboarding) hideSplash();
  }, [showOnboarding]);

  const OnboardingComponent = showOnboarding === 'v2' ? OnboardingScreenV2 : OnboardingScreen;

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={styles.root}>
    <SafeAreaProvider>
      <ColorProvider>
      <PurchaseProvider>
      <AppProvider>
        <MainTabs />
        {showOnboarding && (
          <View style={StyleSheet.absoluteFill}>
            <StatusBar style="light" />
            <OnboardingComponent onDone={() => setShowOnboarding(false)} />
          </View>
        )}
        {splashVisible && (
          // Solid black overlay during the transition from native splash
          // → first photo. No icon: the native launch image already showed
          // the branding, and drawing the icon again at a different size
          // creates a jarring double-rectangle flash.
          <View style={styles.splash} pointerEvents="auto" />
        )}
      </AppProvider>
      </PurchaseProvider>
      </ColorProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111',
  },
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
});
