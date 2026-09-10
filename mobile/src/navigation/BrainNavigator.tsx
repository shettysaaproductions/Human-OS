import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MemoryBrainScreen } from '../screens/analytics/MemoryBrainScreen';
import { EmotionalBrainScreen } from '../screens/analytics/EmotionalBrainScreen';
import { GoalBrainScreen } from '../screens/analytics/GoalBrainScreen';
import { LifeTimelineScreen } from '../screens/analytics/LifeTimelineScreen';
import { FounderDashboardScreen } from '../screens/analytics/FounderDashboardScreen';
import { KgExplorerScreen } from '../screens/analytics/KgExplorerScreen';
import { MemoryManagementScreen } from '../screens/analytics/MemoryManagementScreen';
import { MemoryBrowserScreen } from '../screens/analytics/MemoryBrowserScreen';
import { BetaAdminScreen } from '../screens/analytics/BetaAdminScreen';

const Tab = createBottomTabNavigator();

function TabIcon({ emoji, focused, color }: { emoji: string; focused: boolean; color: string }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
      <Text style={[styles.iconEmoji, focused && styles.iconEmojiActive]}>{emoji}</Text>
    </View>
  );
}

export function BrainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#09090B',
          borderTopColor: 'rgba(255, 255, 255, 0.08)',
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: '#A78BFA',
        tabBarInactiveTintColor: '#71717A',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      {/* ── Core 5 User-Facing Brain Pillars ───────────────────────────────── */}
      <Tab.Screen
        name="Memory"
        component={MemoryBrainScreen}
        options={{
          tabBarLabel: 'Tree',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="🌳" focused={focused} color={color} />
        }}
      />
      <Tab.Screen
        name="Graph"
        component={KgExplorerScreen}
        options={{
          tabBarLabel: 'Galaxy',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="🌌" focused={focused} color={color} />
        }}
      />
      <Tab.Screen
        name="Emotions"
        component={EmotionalBrainScreen}
        options={{
          tabBarLabel: 'Emotions',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="💫" focused={focused} color={color} />
        }}
      />
      <Tab.Screen
        name="Goals"
        component={GoalBrainScreen}
        options={{
          tabBarLabel: 'Goals',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="🎯" focused={focused} color={color} />
        }}
      />
      <Tab.Screen
        name="Timeline"
        component={LifeTimelineScreen}
        options={{
          tabBarLabel: 'Timeline',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="⏳" focused={focused} color={color} />
        }}
      />

      {/* ── Registered Hidden Screens (Deep links & Admin access) ─────────── */}
      <Tab.Screen
        name="Memories"
        component={MemoryBrainScreen}
        options={{ tabBarItemStyle: { display: 'none' } }}
      />
      <Tab.Screen
        name="Browser"
        component={MemoryBrowserScreen}
        options={{ tabBarItemStyle: { display: 'none' } }}
      />
      <Tab.Screen
        name="Manage"
        component={MemoryManagementScreen}
        options={{ tabBarItemStyle: { display: 'none' } }}
      />
      <Tab.Screen
        name="Founder"
        component={FounderDashboardScreen}
        options={{ tabBarItemStyle: { display: 'none' } }}
      />
      <Tab.Screen
        name="Beta"
        component={BetaAdminScreen}
        options={{ tabBarItemStyle: { display: 'none' } }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  iconContainerActive: {
    backgroundColor: 'rgba(167, 139, 250, 0.15)',
  },
  iconEmoji: {
    fontSize: 18,
    opacity: 0.7,
  },
  iconEmojiActive: {
    opacity: 1,
    transform: [{ scale: 1.1 }],
  },
});
