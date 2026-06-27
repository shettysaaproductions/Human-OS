import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface EmptyStateProps {
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ emoji = '🌌', title, subtitle, action }: EmptyStateProps) {
  return (
    <View style={es.container}>
      <Text style={es.emoji}>{emoji}</Text>
      <Text style={es.title}>{title}</Text>
      {subtitle ? <Text style={es.subtitle}>{subtitle}</Text> : null}
      {action ? (
        <TouchableOpacity style={es.btn} onPress={action.onPress}>
          <Text style={es.btnText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

interface OfflineBannerProps {
  visible: boolean;
}

export function OfflineBanner({ visible }: OfflineBannerProps) {
  if (!visible) return null;
  return (
    <View style={es.offlineBanner}>
      <Text style={es.offlineText}>📡 No connection — showing cached data</Text>
    </View>
  );
}

const es = StyleSheet.create({
  container: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 40, paddingTop: 60
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#ccc', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btn: {
    borderWidth: 1, borderColor: '#8B5CF6', borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 10
  },
  btnText: { color: '#8B5CF6', fontWeight: '600', fontSize: 14 },
  offlineBanner: {
    backgroundColor: 'rgba(245,158,11,0.15)', borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,158,11,0.3)', paddingVertical: 8, paddingHorizontal: 16
  },
  offlineText: { color: '#F59E0B', fontSize: 13, textAlign: 'center' },
});
