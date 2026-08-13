import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { api } from '../services/api';

interface ThoughtBubbleProps {
  messageId: string;
}

interface Thought {
  engine: string;
  type: string;
  detail: string;
  data?: any;
}

export const ThoughtBubble: React.FC<ThoughtBubbleProps> = ({ messageId }) => {
  const [expanded, setExpanded] = useState(false);
  const [thoughts, setThoughts] = useState<Thought[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [animation] = useState(new Animated.Value(0));

  const toggleExpand = async () => {
    const nextState = !expanded;
    setExpanded(nextState);

    Animated.timing(animation, {
      toValue: nextState ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();

    if (nextState && !thoughts && !loading) {
      fetchThoughts();
    }
  };

  const fetchThoughts = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await api.get(`/chat/${messageId}/thoughts`);
      setThoughts(response.data.thoughts || []);
    } catch (e) {
      console.error('Failed to fetch thoughts:', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const getEmojiForType = (type: string) => {
    switch (type) {
      case 'context': return '🌐';
      case 'action': return '⚡';
      case 'memory_link': return '🧩';
      case 'anti_robot': return '🛡️';
      case 'reasoning': return '💭';
      default: return '⚙️';
    }
  };

  const getTitleForType = (type: string) => {
    switch (type) {
      case 'context': return 'Context';
      case 'action': return 'Action';
      case 'memory_link': return 'Memory Link';
      case 'anti_robot': return 'Anti-Robot Rules';
      case 'reasoning': return 'Reasoning';
      default: return 'Process';
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={styles.header} 
        onPress={toggleExpand}
        activeOpacity={0.7}
      >
        <Text style={styles.headerText}>🧠 Nova's Mind</Text>
        <Text style={styles.chevronIcon}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.content}>
          {loading && (
            <ActivityIndicator size="small" color="#8b5cf6" style={styles.loader} />
          )}
          
          {error && (
            <Text style={styles.errorText}>Failed to load thoughts.</Text>
          )}

          {thoughts && thoughts.length === 0 && (
            <Text style={styles.emptyText}>No deep thoughts for this message.</Text>
          )}

          {thoughts && thoughts.map((thought, index) => (
            <View key={index} style={styles.thoughtItem}>
              <View style={styles.thoughtHeader}>
                <Text style={styles.thoughtIcon}>{getEmojiForType(thought.type)}</Text>
                <Text style={styles.thoughtTitle}>
                  {getTitleForType(thought.type)} <Text style={styles.engineTag}>({thought.engine})</Text>
                </Text>
              </View>
              <Text style={styles.thoughtDetail}>{thought.detail}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(139, 92, 246, 0.2)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  headerText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  chevronIcon: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  loader: {
    marginVertical: 10,
  },
  errorText: {
    color: '#ff4444',
    fontSize: 12,
    marginTop: 8,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  thoughtItem: {
    marginTop: 12,
  },
  thoughtHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  thoughtIcon: {
    fontSize: 14,
  },
  thoughtTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  engineTag: {
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '400',
  },
  thoughtDetail: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    lineHeight: 18,
    paddingLeft: 20,
  }
});
