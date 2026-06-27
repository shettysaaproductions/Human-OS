import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

function MetricCard({ title, value, subtitle, color, emoji }: {
  title: string; value: string | number; subtitle?: string; color: string; emoji: string;
}) {
  return (
    <View style={[fd.metricCard, { borderColor: `${color}30` }]}>
      <Text style={fd.metricEmoji}>{emoji}</Text>
      <Text style={[fd.metricValue, { color }]}>{value}</Text>
      <Text style={fd.metricTitle}>{title}</Text>
      {subtitle ? <Text style={fd.metricSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const color = status === 'online' ? '#10B981' : status === 'degraded' ? '#F59E0B' : '#EF4444';
  return (
    <View style={fd.statusRow}>
      <View style={[fd.statusDot, { backgroundColor: color }]} />
      <Text style={[fd.statusText, { color }]}>{status}</Text>
    </View>
  );
}

export const FounderDashboardScreen = React.memo(function FounderDashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [system, setSystem] = useState<any>(null);
  const [costs, setCosts] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      setRefreshing(true);
      const [overviewRes, systemRes, costsRes, telRes] = await Promise.allSettled([
        api.get('/founder/overview'),
        api.get('/founder/system'),
        api.get('/founder/costs'),
        api.get('/founder/telemetry'),
      ]);

      if (overviewRes.status === 'fulfilled') setOverview(overviewRes.value.data.data);
      if (systemRes.status === 'fulfilled') setSystem(systemRes.value.data.data);
      if (costsRes.status === 'fulfilled') setCosts(costsRes.value.data.data);
      if (telRes.status === 'fulfilled') setTelemetry(telRes.value.data.data);
    } catch (err) {
      console.error('Failed to fetch founder data', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, []);

  if (loading) {
    return <View style={fd.center}><ActivityIndicator size="large" color="#3B82F6" /></View>;
  }

  return (
    <SafeAreaView style={fd.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchAll} tintColor="#3B82F6" />}
      >
        <View style={fd.header}>
          <Text style={fd.title}>Founder Dashboard</Text>
          <StatusIndicator status={system?.systemHealth || 'unknown'} />
        </View>

        {/* Product Section */}
        <Text style={fd.sectionLabel}>📊 Product Health</Text>
        <View style={fd.gridRow}>
          <MetricCard title="Total Users" value={overview?.totalUsers || 0} color="#3B82F6" emoji="👥" subtitle={`${overview?.dau || 0} active today`} />
          <MetricCard title="Memories" value={overview?.totalMemories || 0} color="#8B5CF6" emoji="🧠" />
        </View>
        <View style={fd.gridRow}>
          <MetricCard title="Moments" value={overview?.momentsGenerated || 0} color="#F59E0B" emoji="⚡" subtitle={`${telemetry?.moments?.openRate || '0%'} open rate`} />
          <MetricCard title="Reflections" value={overview?.reflectionsGenerated || 0} color="#06B6D4" emoji="📖" />
        </View>

        {/* Companion Section */}
        <Text style={fd.sectionLabel}>🤖 Companion Health</Text>
        <View style={fd.gridRow}>
          <MetricCard title="Episodic Mem" value={overview?.episodicMemories || 0} color="#A78BFA" emoji="💭" />
          <MetricCard title="Sessions" value={overview?.totalSessions || 0} color="#34D399" emoji="💬" subtitle={`${overview?.dau || 0} today`} />
        </View>

        {/* AI Cost Section */}
        <Text style={fd.sectionLabel}>💰 AI Health</Text>
        <View style={fd.gridRow}>
          <MetricCard title="Total Tokens" value={(costs?.totalTokens || 0).toLocaleString()} color="#F97316" emoji="🔤" />
          <MetricCard title="Est. Cost" value={`$${costs?.estimatedTotalCostUsd || '0.00'}`} color="#EF4444" emoji="💵" subtitle={`$${costs?.estimatedWeeklyCostUsd || '0.00'} this week`} />
        </View>
        <View style={fd.gridRow}>
          <MetricCard title="API Success" value={costs?.successRate || '0%'} color="#10B981" emoji="✅" subtitle={`${costs?.failedRequests || 0} failures`} />
          <MetricCard title="Week Tokens" value={(costs?.weeklyTokens || 0).toLocaleString()} color="#F59E0B" emoji="📈" />
        </View>

        {/* Moment Engine */}
        <Text style={fd.sectionLabel}>⚡ Moment Engine</Text>
        <View style={fd.momentGrid}>
          <View style={fd.momentStat}>
            <Text style={fd.momentNum}>{telemetry?.moments?.total || 0}</Text>
            <Text style={fd.momentLabel}>Generated</Text>
          </View>
          <View style={fd.momentStat}>
            <Text style={[fd.momentNum, { color: '#10B981' }]}>{telemetry?.moments?.opened || 0}</Text>
            <Text style={fd.momentLabel}>Opened</Text>
          </View>
          <View style={fd.momentStat}>
            <Text style={[fd.momentNum, { color: '#EF4444' }]}>{telemetry?.moments?.dismissed || 0}</Text>
            <Text style={fd.momentLabel}>Dismissed</Text>
          </View>
          <View style={fd.momentStat}>
            <Text style={[fd.momentNum, { color: '#F59E0B' }]}>{telemetry?.moments?.openRate || '0%'}</Text>
            <Text style={fd.momentLabel}>Open Rate</Text>
          </View>
        </View>

        {/* System Section */}
        <Text style={fd.sectionLabel}>⚙️ System Health</Text>
        <View style={fd.systemCard}>
          <View style={fd.systemRow}>
            <Text style={fd.systemLabel}>Pending Jobs</Text>
            <Text style={fd.systemValue}>{system?.pendingJobs || 0}</Text>
          </View>
          <View style={fd.systemRow}>
            <Text style={fd.systemLabel}>Failed Jobs (24h)</Text>
            <Text style={[fd.systemValue, { color: (system?.failedJobsLast24h || 0) > 0 ? '#EF4444' : '#10B981' }]}>
              {system?.failedJobsLast24h || 0}
            </Text>
          </View>
          <View style={fd.systemRow}>
            <Text style={fd.systemLabel}>Total Failed</Text>
            <Text style={fd.systemValue}>{system?.totalFailedJobs || 0}</Text>
          </View>
        </View>

        <Text style={fd.timestamp}>
          Last refreshed: {new Date().toLocaleTimeString()}
        </Text>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
});

const fd = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 8, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#555', marginHorizontal: 16, marginBottom: 10, marginTop: 4 },
  gridRow: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 10, gap: 10 },
  metricCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
    borderRadius: 14, padding: 14, alignItems: 'center'
  },
  metricEmoji: { fontSize: 20, marginBottom: 6 },
  metricValue: { fontSize: 22, fontWeight: 'bold', marginBottom: 2 },
  metricTitle: { fontSize: 11, color: '#888', textAlign: 'center' },
  metricSubtitle: { fontSize: 10, color: '#555', marginTop: 2, textAlign: 'center' },
  momentGrid: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)', borderRadius: 14
  },
  momentStat: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.06)' },
  momentNum: { fontSize: 20, fontWeight: 'bold', color: '#F59E0B', marginBottom: 2 },
  momentLabel: { fontSize: 10, color: '#666' },
  systemCard: {
    marginHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, paddingVertical: 4
  },
  systemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  systemLabel: { fontSize: 13, color: '#888' },
  systemValue: { fontSize: 16, fontWeight: '700', color: '#fff' },
  timestamp: { textAlign: 'center', color: '#444', fontSize: 11, marginTop: 16 },
});
