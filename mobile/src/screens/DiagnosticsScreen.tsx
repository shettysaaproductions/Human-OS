import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { chatService } from '../services/chatService';

export function DiagnosticsScreen({ navigation }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDiagnostics = async () => {
    setLoading(true);
    setError('');
    try {
      const diag = await chatService.getDiagnostics();
      setData(diag);
    } catch (e: any) {
      setError(e.message || 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>System Diagnostics</Text>
        <TouchableOpacity onPress={fetchDiagnostics}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" style={{ marginTop: 50 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : data ? (
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Environment</Text>
          <Text style={styles.text}>Env: {data.environment}</Text>
          <Text style={styles.text}>Latency: {data.latency_ms}ms</Text>

          <Text style={styles.sectionTitle}>Status</Text>
          <Text style={styles.text}>Supabase: {data.status.supabase}</Text>
          <Text style={styles.text}>NVIDIA API: {data.status.nvidia_api}</Text>
          <Text style={styles.text}>Render: {data.status.render}</Text>

          <Text style={styles.sectionTitle}>User Data</Text>
          <Text style={styles.text}>User ID: {data.user_id}</Text>
          <Text style={styles.text}>JWT Status: {data.jwt_status}</Text>
          
          <Text style={styles.sectionTitle}>Metrics</Text>
          <Text style={styles.text}>Total Memories: {data.metrics.memory_count}</Text>
          <Text style={styles.text}>Total Chat Messages: {data.metrics.chat_message_count}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 50,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: { fontSize: 18, fontWeight: 'bold' },
  backBtn: { padding: 8 },
  backText: { color: '#007AFF', fontSize: 16 },
  refreshText: { color: '#007AFF', fontSize: 16 },
  content: { padding: 16 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#888',
    marginTop: 20,
    marginBottom: 8,
    textTransform: 'uppercase'
  },
  text: { fontSize: 16, marginBottom: 4, color: '#333' },
  error: { color: 'red', margin: 16, textAlign: 'center' }
});
