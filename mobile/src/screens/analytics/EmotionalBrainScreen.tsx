import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  ScrollView, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

const { width } = Dimensions.get('window');

const MOOD_COLORS: Record<string, string> = {
  happy: '#10B981', joyful: '#10B981', excited: '#F59E0B',
  calm: '#06B6D4', neutral: '#888',
  anxious: '#F97316', sad: '#3B82F6', angry: '#EF4444',
  stressed: '#F97316', grateful: '#A78BFA',
};

function getMoodColor(mood: string): string {
  const key = mood?.toLowerCase() || 'neutral';
  return MOOD_COLORS[key] || '#8B5CF6';
}

function WeeklyGraph({ states }: { states: any[] }) {
  const last7 = useMemo(() => {
    const buckets: Record<string, number[]> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets[d.toISOString().split('T')[0]] = [];
    }
    (states || []).forEach(s => {
      const day = s.created_at.split('T')[0];
      if (buckets[day]) buckets[day].push(s.intensity);
    });
    return Object.entries(buckets).map(([day, vals]) => ({
      day: new Date(day).toLocaleDateString('en', { weekday: 'short' }),
      avg: vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    }));
  }, [states]);

  const maxVal = Math.max(...last7.map(d => d.avg), 1);

  return (
    <View style={sg.graphContainer}>
      <Text style={sg.sectionTitle}>Weekly Mood Graph</Text>
      <View style={sg.barChart}>
        {last7.map((d, i) => (
          <View key={i} style={sg.barCol}>
            <View style={sg.barTrack}>
              <View style={[sg.bar, { height: `${(d.avg / maxVal) * 100}%`, backgroundColor: d.avg > 5 ? '#10B981' : d.avg > 3 ? '#F59E0B' : '#EF4444' }]} />
            </View>
            <Text style={sg.barLabel}>{d.day}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function EmotionHeatmap({ states }: { states: any[] }) {
  // Build a 4-week heatmap (28 days)
  const weeks = useMemo(() => {
    const cells: Array<{ date: string; avg: number; moods: string[] }> = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayStates = (states || []).filter(s => s.created_at.startsWith(dateStr));
      const avg = dayStates.length > 0
        ? dayStates.reduce((a: number, s: any) => a + s.intensity, 0) / dayStates.length
        : 0;
      cells.push({ date: dateStr, avg, moods: dayStates.map((s: any) => s.mood) });
    }
    return cells;
  }, [states]);

  const getColor = (avg: number) => {
    if (avg === 0) return 'rgba(255,255,255,0.05)';
    if (avg >= 8) return '#10B981';
    if (avg >= 6) return '#F59E0B';
    if (avg >= 4) return '#F97316';
    return '#EF4444';
  };

  return (
    <View style={sg.heatmapContainer}>
      <Text style={sg.sectionTitle}>Monthly Heatmap</Text>
      <View style={sg.heatGrid}>
        {weeks.map((cell, i) => (
          <View
            key={i}
            style={[sg.heatCell, { backgroundColor: getColor(cell.avg) }]}
          />
        ))}
      </View>
      <View style={sg.heatLegend}>
        <Text style={sg.legendText}>Low</Text>
        {['#EF4444','#F97316','#F59E0B','#10B981'].map(c => (
          <View key={c} style={[sg.legendDot, { backgroundColor: c }]} />
        ))}
        <Text style={sg.legendText}>High</Text>
      </View>
    </View>
  );
}

export const EmotionalBrainScreen = React.memo(function EmotionalBrainScreen() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => { fetchEmotions(); }, []);

  const fetchEmotions = async () => {
    try {
      setLoading(true);
      const res = await api.get('/analytics/emotions');
      setData(res.data.data);
    } catch (err) {
      console.error('Failed to fetch emotions', err);
    } finally {
      setLoading(false);
    }
  };

  const states = data?.graph || [];

  const streakInfo = useMemo(() => {
    // Count consecutive days with at least one entry
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const hasEntry = states.some((s: any) => s.created_at.startsWith(dateStr));
      if (hasEntry) streak++;
      else if (i > 0) break;
    }
    return streak;
  }, [states]);

  const dominantMood = useMemo(() => {
    const counts: Record<string, number> = {};
    states.forEach((s: any) => {
      counts[s.mood] = (counts[s.mood] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  }, [states]);

  const avgIntensity = useMemo(() => {
    if (!states.length) return 0;
    return (states.reduce((a: number, s: any) => a + (s.intensity || 0), 0) / states.length).toFixed(1);
  }, [states]);

  if (loading) {
    return <View style={sg.center}><ActivityIndicator size="large" color="#EC4899" /></View>;
  }

  return (
    <SafeAreaView style={sg.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={sg.title}>Emotional Brain</Text>

        {/* Insights Row */}
        <View style={sg.statsRow}>
          <View style={sg.statCard}>
            <Text style={[sg.statNum, { color: '#EC4899' }]}>{streakInfo}</Text>
            <Text style={sg.statLabel}>Day Streak</Text>
          </View>
          <View style={sg.statCard}>
            <Text style={[sg.statNum, { color: '#F59E0B' }]}>{avgIntensity}</Text>
            <Text style={sg.statLabel}>Avg Intensity</Text>
          </View>
          <View style={sg.statCard}>
            <Text style={[sg.statNum, { color: '#10B981' }]}>{states.length}</Text>
            <Text style={sg.statLabel}>Total Records</Text>
          </View>
        </View>

        {/* Dominant Mood Insight */}
        {dominantMood && (
          <View style={[sg.insightCard, { borderColor: getMoodColor(dominantMood) }]}>
            <Text style={sg.insightLabel}>Dominant Mood</Text>
            <Text style={[sg.insightValue, { color: getMoodColor(dominantMood) }]}>
              {dominantMood}
            </Text>
          </View>
        )}

        <WeeklyGraph states={states} />
        <EmotionHeatmap states={states} />

        {/* Recent Moods */}
        <Text style={[sg.sectionTitle, { marginHorizontal: 16 }]}>Recent Moods</Text>
        {states.slice(0, 10).map((item: any) => (
          <View key={item.id} style={[sg.card, { borderColor: `${getMoodColor(item.mood)}33` }]}>
            <View style={sg.cardRow}>
              <Text style={[sg.moodText, { color: getMoodColor(item.mood) }]}>{item.mood}</Text>
              <View style={sg.intensityBar}>
                <View style={[sg.intensityFill, { width: `${(item.intensity / 10) * 100}%`, backgroundColor: getMoodColor(item.mood) }]} />
              </View>
              <Text style={sg.intensityNum}>{item.intensity}/10</Text>
            </View>
            {item.notes ? <Text style={sg.notes}>{item.notes}</Text> : null}
            <Text style={sg.dateText}>{new Date(item.created_at).toLocaleDateString()}</Text>
          </View>
        ))}
        {states.length === 0 && <Text style={sg.emptyText}>No emotional states recorded yet.</Text>}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
});

const sg = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginHorizontal: 16, marginTop: 8, marginBottom: 12 },
  statsRow: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 16, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center'
  },
  statNum: { fontSize: 22, fontWeight: 'bold' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  insightCard: {
    marginHorizontal: 16, marginBottom: 16, borderWidth: 1, borderRadius: 14, padding: 16,
    backgroundColor: 'rgba(255,255,255,0.03)'
  },
  insightLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  insightValue: { fontSize: 22, fontWeight: 'bold', textTransform: 'capitalize' },
  graphContainer: { marginHorizontal: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 12 },
  barChart: { flexDirection: 'row', height: 80, alignItems: 'flex-end', gap: 4 },
  barCol: { flex: 1, alignItems: 'center' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 4 },
  barLabel: { fontSize: 9, color: '#666', marginTop: 4 },
  heatmapContainer: { marginHorizontal: 16, marginBottom: 20 },
  heatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  heatCell: { width: (width - 32 - 27 * 3) / 28, height: (width - 32 - 27 * 3) / 28, borderRadius: 2 },
  heatLegend: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 10, color: '#666' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1,
    borderRadius: 12, padding: 14, marginHorizontal: 16, marginBottom: 10
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  moodText: { fontSize: 16, fontWeight: '700', textTransform: 'capitalize', width: 90 },
  intensityBar: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden', marginHorizontal: 8 },
  intensityFill: { height: '100%', borderRadius: 3 },
  intensityNum: { fontSize: 12, color: '#888', width: 36, textAlign: 'right' },
  notes: { fontSize: 13, color: '#bbb', marginBottom: 4, fontStyle: 'italic' },
  dateText: { fontSize: 11, color: '#555' },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 15 },
});
