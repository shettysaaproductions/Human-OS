import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MemoryBrainScreen } from '../screens/analytics/MemoryBrainScreen';
import { EmotionalBrainScreen } from '../screens/analytics/EmotionalBrainScreen';
import { GoalBrainScreen } from '../screens/analytics/GoalBrainScreen';
import { LifeTimelineScreen } from '../screens/analytics/LifeTimelineScreen';
import { FounderDashboardScreen } from '../screens/analytics/FounderDashboardScreen';
import { KgExplorerScreen } from '../screens/analytics/KgExplorerScreen';
import { MemoryManagementScreen } from '../screens/analytics/MemoryManagementScreen';
import { BetaAdminScreen } from '../screens/analytics/BetaAdminScreen';

const Tab = createBottomTabNavigator();

export function BrainNavigator() {
  return (
    <Tab.Navigator 
      screenOptions={{ 
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#09090B',
          borderTopColor: 'rgba(255, 255, 255, 0.08)'
        },
        tabBarActiveTintColor: '#06B6D4',
        tabBarInactiveTintColor: '#888'
      }}
    >
      <Tab.Screen name="Memory" component={MemoryBrainScreen} />
      <Tab.Screen name="Emotions" component={EmotionalBrainScreen} />
      <Tab.Screen name="Graph" component={KgExplorerScreen} />
      <Tab.Screen name="Goals" component={GoalBrainScreen} />
      <Tab.Screen name="Timeline" component={LifeTimelineScreen} />
      <Tab.Screen name="Memories" component={MemoryManagementScreen} />
      <Tab.Screen name="Founder" component={FounderDashboardScreen} />
      <Tab.Screen name="Beta" component={BetaAdminScreen} />
    </Tab.Navigator>
  );
}
