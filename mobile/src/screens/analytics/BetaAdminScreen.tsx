import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  RefreshControl, TouchableOpacity
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

// ── Mini components ───────────────────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return <Text style={bd.sectionTitle}>{title}</Text>;
}

function MetricRow({ label, value, color = '#fff', sub }: {
  label: string; value: string | number; color?: string; sub?: string
}) {
  return (
    <View style={bd.metricRow}>
      <Text style={bd.metricLabel}>{label}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[bd.metricValue, { color }]}>{value}</Text>
        {sub ? <Text style={bd.metricSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <View style={[bd.card, accent ? { borderColor: `${accent}30` } : {}]}>
      {children}
    </View>
  );
}

function RetentionBar({ label, rate, color }: { label: string; rate: string; color: string }) {
  const pct = parseInt(rate) || 0;
  return (
    <View style={bd.retentionRow}>
      <Text style={bd.retentionLabel}>{label}</Text>
      <View style={bd.retentionTrack}>
        <View style={[bd.retentionFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[bd.retentionRate, { color }]}>{rate}</Text>
    </View>
  );
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <View style={bd.miniBarRow}>
      <Text style={bd.miniBarLabel}>{label}</Text>
      <View style={bd.miniBarTrack}>
        <View style={[bd.miniBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[bd.miniBarValue, { color }]}>{value}</Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export const BetaAdminScreen = React.memo(function BetaAdminScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [retention, setRetention] = useState<any>(null);
  const [crashes, setCrashes] = useState<any>(null);
  const [feedbackData, setFeedbackData] = useState<any>(null);
  const [moments, setMoments] = useState<any>(null);
  const [tab, setTab] = useState<'overview' | 'retention' | 'crashes' | 'feedback' | 'moments'>('overview');

  const fetchAll = useCallback(async () => {
    try {
      setRefreshing(true);
      const [ovRes, retRes, crRes, fbRes, moRes] = await Promise.allSettled([
        api.get('/admin/beta/overview'),
        api.get('/admin/beta/retention'),
        api.get('/admin/beta/crashes'),
        api.get('/admin/beta/feedback-analytics'),
        api.get('/admin/beta/moment-analytics'),
      ]);
      if (ovRes.status === 'fulfilled') setOverview(ovRes.value.data.data);
      if (retRes.status === 'fulfilled') setRetention(retRes.value.data.data);
      if (crRes.status === 'fulfilled') setCrashes(crRes.value.data.data);
      if (fbRes.status === 'fulfilled') setFeedbackData(fbRes.value.data.data);
      if (moRes.status === 'fulfilled') setMoments(moRes.value.data.data);
    } catch (err) {
      console.error('BetaAdmin fetch failed', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, []);

  if (loading) {
    return <View style={bd.center}><ActivityIndicator size="large" color="#F59E0B" /></View>;
  }

  const TABS = [
    { key: 'overview', label: 'Overview', emoji: '📊' },
    { key: 'retention', label: 'Retention', emoji: '🔄' },
    { key: 'crashes', label: 'Crashes', emoji: '💥' },
    { key: 'feedback', label: 'Feedback', emoji: '💬' },
    { key: 'moments', label: 'Moments', emoji: '⚡' },
  ] as const;

  return (
    <SafeAreaView style={bd.container} edges={['top']}>
      <Text style={bd.title}>Beta Observatory</Text>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bd.tabScroll} contentContainerStyle={bd.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[bd.tabBtn, tab === t.key && bd.tabBtnActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={bd.tabEmoji}>{t.emoji}</Text>
            <Text style={[bd.tabLabel, tab === t.key && bd.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchAll} tintColor="#F59E0B" />}
        contentContainerStyle={bd.scrollContent}
      >
        {/* ── OVERVIEW ── */}
        {tab === 'overview' && overview && (
          <>
            <SectionTitle title="👥 Users" />
            <Card accent="#3B82F6">
              <MetricRow label="Total Beta Users" value={overview.users.total} color="#3B82F6" />
              <View style={bd.divider} />
              <MetricRow label="Daily Active (DAU)" value={overview.users.dau} color="#10B981" />
              <View style={bd.divider} />
              <MetricRow label="Weekly Active (WAU)" value={overview.users.wau} color="#06B6D4" />
            </Card>

            <SectionTitle title="💬 Engagement" />
            <Card accent="#8B5CF6">
              <MetricRow label="Total Messages Sent" value={overview.engagement.totalMessages} color="#8B5CF6" />
              <View style={bd.divider} />
              <MetricRow label="Avg Messages / User" value={overview.engagement.avgMessagesPerUser} color="#A78BFA" />
            </Card>

            <SectionTitle title="⚡ Moments" />
            <Card accent="#F59E0B">
              <MetricRow label="Generated" value={overview.moments.total} color="#F59E0B" />
              <View style={bd.divider} />
              <MetricRow label="Opened" value={overview.moments.opened} color="#10B981" />
              <View style={bd.divider} />
              <MetricRow label="Dismissed" value={overview.moments.dismissed} color="#EF4444" />
              <View style={bd.divider} />
              <MetricRow label="Open Rate" value={overview.moments.openRate} color="#F59E0B" />
            </Card>

            <SectionTitle title="🛡 Health (24h)" />
            <Card>
              <MetricRow
                label="Crashes"
                value={overview.health.crashes24h}
                color={overview.health.crashes24h > 0 ? '#EF4444' : '#10B981'}
              />
              <View style={bd.divider} />
              <MetricRow
                label="API Failures"
                value={overview.health.apiFailures24h}
                color={overview.health.apiFailures24h > 5 ? '#EF4444' : '#10B981'}
              />
              <View style={bd.divider} />
              <MetricRow label="Feedback Received" value={overview.feedback.total} color="#06B6D4" />
            </Card>
          </>
        )}

        {/* ── RETENTION ── */}
        {tab === 'retention' && retention && (
          <>
            <SectionTitle title="📈 Retention Rates" />
            <Card accent="#10B981">
              <RetentionBar label="Day 1 Retention" rate={retention.d1.rate} color="#10B981" />
              <View style={{ height: 12 }} />
              <RetentionBar label="Day 7 Retention" rate={retention.d7.rate} color="#06B6D4" />
              <View style={bd.divider} />
              <MetricRow label="D1 Eligible Users" value={retention.d1.eligible} color="#888" />
              <View style={bd.divider} />
              <MetricRow label="D1 Retained" value={retention.d1.retained} color="#10B981" />
              <View style={bd.divider} />
              <MetricRow label="D7 Eligible Users" value={retention.d7.eligible} color="#888" />
              <View style={bd.divider} />
              <MetricRow label="D7 Retained" value={retention.d7.retained} color="#06B6D4" />
            </Card>

            <SectionTitle title="📅 DAU — Last 14 Days" />
            <Card>
              {(retention.dauTrend || []).slice(-7).map((d: any) => (
                <MiniBar
                  key={d.date}
                  label={new Date(d.date).toLocaleDateString('en', { weekday: 'short', month: 'numeric', day: 'numeric' })}
                  value={d.users}
                  max={Math.max(...retention.dauTrend.map((x: any) => x.users), 1)}
                  color="#3B82F6"
                />
              ))}
            </Card>
          </>
        )}

        {/* ── CRASHES ── */}
        {tab === 'crashes' && crashes && (
          <>
            <SectionTitle title="💥 Error Summary (7d)" />
            <Card accent="#EF4444">
              <MetricRow label="Total Errors" value={crashes.total7d} color={crashes.total7d > 10 ? '#EF4444' : '#10B981'} />
              <View style={bd.divider} />
              <MetricRow label="Errors (24h)" value={crashes.errors24h} color={crashes.errors24h > 3 ? '#EF4444' : '#10B981'} />
            </Card>

            <SectionTitle title="By Type" />
            <Card>
              {Object.entries(crashes.byType || {}).map(([type, count]: any) => (
                <View key={type}>
                  <MetricRow label={type} value={count} color="#F87171" />
                  <View style={bd.divider} />
                </View>
              ))}
            </Card>

            <SectionTitle title="By Platform" />
            <Card>
              {Object.entries(crashes.byPlatform || {}).map(([platform, count]: any) => (
                <View key={platform}>
                  <MetricRow label={platform} value={count} color="#94A3B8" />
                  <View style={bd.divider} />
                </View>
              ))}
            </Card>

            <SectionTitle title="Recent Errors" />
            {(crashes.recent || []).map((e: any, i: number) => (
              <View key={i} style={bd.errorCard}>
                <Text style={bd.errorType}>{e.type}</Text>
                <Text style={bd.errorMeta}>{e.platform} · {e.version} · {new Date(e.time).toLocaleString()}</Text>
              </View>
            ))}
          </>
        )}

        {/* ── FEEDBACK ── */}
        {tab === 'feedback' && feedbackData && (
          <>
            <SectionTitle title="📊 Feedback Summary" />
            <Card accent="#EC4899">
              <MetricRow label="Total Submissions" value={feedbackData.total} color="#EC4899" />
              {feedbackData.avgRating && (
                <>
                  <View style={bd.divider} />
                  <MetricRow label="Average Rating" value={`${feedbackData.avgRating} ⭐`} color="#F59E0B" sub={`from ${feedbackData.ratingCount} ratings`} />
                </>
              )}
            </Card>

            <SectionTitle title="By Type" />
            <Card>
              {Object.entries(feedbackData.byType || {}).map(([type, count]: any) => {
                const emoji = type === 'bug' ? '🐛' : type === 'idea' ? '💡' : type === 'emotional_reaction' ? '💭' : '💬';
                return (
                  <View key={type}>
                    <MetricRow label={`${emoji} ${type}`} value={count} color="#A78BFA" />
                    <View style={bd.divider} />
                  </View>
                );
              })}
            </Card>

            {feedbackData.recentQuotes?.length > 0 && (
              <>
                <SectionTitle title="💭 User Quotes" />
                {feedbackData.recentQuotes.map((q: any, i: number) => (
                  <View key={i} style={bd.quoteCard}>
                    <Text style={bd.quoteText}>"{q.message}"</Text>
                    {q.rating && <Text style={bd.quoteRating}>{'⭐'.repeat(q.rating)}</Text>}
                  </View>
                ))}
              </>
            )}

            {feedbackData.recentBugs?.length > 0 && (
              <>
                <SectionTitle title="🐛 Recent Bug Reports" />
                {feedbackData.recentBugs.map((b: any, i: number) => (
                  <View key={i} style={bd.bugCard}>
                    <Text style={bd.bugText}>{b.message}</Text>
                    <Text style={bd.bugDate}>{new Date(b.date).toLocaleDateString()}</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {/* ── MOMENTS ── */}
        {tab === 'moments' && moments && (
          <>
            <SectionTitle title="⚡ Moment Overview" />
            <Card accent="#F59E0B">
              <MetricRow label="Total Generated" value={moments.total} color="#F59E0B" />
              <View style={bd.divider} />
              <MetricRow label="Global Open Rate" value={moments.openRate} color="#10B981" />
            </Card>

            <SectionTitle title="Status Breakdown" />
            <Card>
              {Object.entries(moments.byStatus || {}).map(([status, count]: any) => {
                const color = status === 'opened' ? '#10B981' : status === 'dismissed' ? '#EF4444' : '#888';
                return (
                  <View key={status}>
                    <MetricRow label={status} value={count} color={color} />
                    <View style={bd.divider} />
                  </View>
                );
              })}
            </Card>

            <SectionTitle title="Open Rate by Type" />
            <Card>
              {Object.entries(moments.openRateByType || {}).map(([type, data]: any) => (
                <View key={type}>
                  <MetricRow
                    label={type}
                    value={data.rate}
                    color="#F59E0B"
                    sub={`${data.opened}/${data.total} opened`}
                  />
                  <View style={bd.divider} />
                </View>
              ))}
            </Card>

            <SectionTitle title="Daily Trend (7d)" />
            <Card>
              {(moments.dailyTrend || []).map((d: any) => (
                <View key={d.date} style={bd.trendRow}>
                  <Text style={bd.trendDate}>
                    {new Date(d.date).toLocaleDateString('en', { weekday: 'short', month: 'numeric', day: 'numeric' })}
                  </Text>
                  <Text style={bd.trendGenerated}>{d.generated} gen</Text>
                  <Text style={bd.trendOpened}>{d.opened} ✓</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
});

const bd = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  tabScroll: { maxHeight: 56 },
  tabRow: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  tabBtnActive: { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#F59E0B' },
  tabEmoji: { fontSize: 14 },
  tabLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  tabLabelActive: { color: '#F59E0B' },
  scrollContent: { padding: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#555', marginTop: 16, marginBottom: 8, letterSpacing: 0.6 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden', marginBottom: 4
  },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: 16 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  metricLabel: { fontSize: 14, color: '#888' },
  metricValue: { fontSize: 17, fontWeight: '700' },
  metricSub: { fontSize: 11, color: '#555', marginTop: 1 },
  retentionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14 },
  retentionLabel: { fontSize: 13, color: '#888', width: 110 },
  retentionTrack: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginHorizontal: 10 },
  retentionFill: { height: '100%', borderRadius: 3 },
  retentionRate: { fontSize: 14, fontWeight: '700', width: 44, textAlign: 'right' },
  miniBarRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  miniBarLabel: { fontSize: 12, color: '#888', width: 80 },
  miniBarTrack: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginHorizontal: 8 },
  miniBarFill: { height: '100%', borderRadius: 2 },
  miniBarValue: { fontSize: 12, fontWeight: '700', width: 24, textAlign: 'right' },
  errorCard: {
    backgroundColor: 'rgba(239,68,68,0.06)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.15)',
    borderRadius: 10, padding: 12, marginBottom: 8
  },
  errorType: { fontSize: 13, fontWeight: '700', color: '#F87171', marginBottom: 4 },
  errorMeta: { fontSize: 11, color: '#666' },
  quoteCard: {
    backgroundColor: 'rgba(236,72,153,0.06)', borderWidth: 1, borderColor: 'rgba(236,72,153,0.15)',
    borderRadius: 10, padding: 14, marginBottom: 8
  },
  quoteText: { fontSize: 14, color: '#ddd', lineHeight: 20, fontStyle: 'italic' },
  quoteRating: { fontSize: 12, marginTop: 8 },
  bugCard: {
    backgroundColor: 'rgba(239,68,68,0.04)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.1)',
    borderRadius: 10, padding: 12, marginBottom: 8
  },
  bugText: { fontSize: 13, color: '#ccc', lineHeight: 19 },
  bugDate: { fontSize: 11, color: '#555', marginTop: 4 },
  trendRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  trendDate: { flex: 1, fontSize: 12, color: '#888' },
  trendGenerated: { fontSize: 12, color: '#F59E0B', marginRight: 16 },
  trendOpened: { fontSize: 12, color: '#10B981', width: 50, textAlign: 'right' },
});
