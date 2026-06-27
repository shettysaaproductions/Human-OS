import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const opacity = React.useRef(new Animated.Value(0.3)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <Animated.View
      style={[
        sk.bone,
        { width: width as any, height, borderRadius, opacity },
        style
      ]}
    />
  );
}

export function CardSkeleton() {
  return (
    <View style={sk.card}>
      <View style={sk.row}>
        <Skeleton width={80} height={20} borderRadius={10} />
        <Skeleton width={40} height={16} borderRadius={8} />
      </View>
      <Skeleton height={16} style={{ marginTop: 10 }} />
      <Skeleton height={14} width="70%" style={{ marginTop: 8 }} />
    </View>
  );
}

export function StatSkeleton() {
  return (
    <View style={sk.statRow}>
      {[1, 2, 3].map(i => (
        <View key={i} style={sk.statCard}>
          <Skeleton width={40} height={28} borderRadius={6} />
          <Skeleton width={50} height={12} borderRadius={4} style={{ marginTop: 8 }} />
        </View>
      ))}
    </View>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      <StatSkeleton />
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} />)}
    </>
  );
}

const sk = StyleSheet.create({
  bone: { backgroundColor: 'rgba(255,255,255,0.08)' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12,
    padding: 14, marginHorizontal: 16, marginBottom: 10
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  statRow: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 16, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12,
    padding: 12, alignItems: 'center'
  },
});
