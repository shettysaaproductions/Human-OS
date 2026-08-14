import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { useTheme } from '@react-navigation/native';
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
  const { colors } = useTheme();
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
      useNativeDriver: true,
    }).start();

    if (nextState && !thoughts && !loading) {
      fetchThoughts();
    }
  };

  const fetchThoughts = async () => {
    setLoading(true);
    setError(false);
    try {
      const cleanId = messageId.replace(/_part_\d+$/, '');
      const response = await api.get(`/chat/${cleanId}/thoughts`);
      setThoughts(response.data.thoughts || []);
    } catch (e) {
      console.error('Failed to fetch thoughts:', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const rotateInterpolate = animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg']
  });

  const getTitleForType = (type: string) => {
    switch (type) {
      case 'context': return 'Context';
      case 'action': return 'Action';
      case 'memory_link': return 'Memory';
      case 'anti_robot': return 'Filter';
      case 'reasoning': return 'Reasoning';
      default: return 'Process';
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={styles.header} 
        onPress={toggleExpand}
        activeOpacity={0.6}
      >
        <Text style={[styles.headerText, { color: colors.text, opacity: 0.5 }]}>Worked on request</Text>
        <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
          <Text style={[styles.chevronIcon, { color: colors.text, opacity: 0.5 }]}>›</Text>
        </Animated.View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.content}>
          {loading && (
            <ActivityIndicator size="small" color="#6B7280" style={styles.loader} />
          )}
          
          {error && (
            <Text style={styles.errorText}>Failed to load process logs.</Text>
          )}

          {thoughts && thoughts.length === 0 && (
            <Text style={styles.emptyText}>No internal processing required.</Text>
          )}

          {thoughts && thoughts.map((thought, index) => (
            <View key={index} style={styles.thoughtItem}>
              <View style={styles.thoughtHeader}>
                <Text style={styles.thoughtTitle}>
                  {getTitleForType(thought.type)} <Text style={styles.engineTag}>[{thought.engine}]</Text>
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
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  headerText: {
    color: '#9CA3AF', // subtle gray
    fontSize: 12,
    fontWeight: '500',
    marginRight: 6,
  },
  chevronIcon: {
    color: '#9CA3AF',
    fontSize: 16,
    fontWeight: '400',
    marginTop: -2,
  },
  content: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)', // very subtle glassmorphic backdrop for logs
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(156, 163, 175, 0.2)',
    borderRadius: 4,
  },
  loader: {
    marginVertical: 10,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  thoughtItem: {
    marginBottom: 10,
  },
  thoughtHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  thoughtTitle: {
    color: '#D1D5DB', // lighter gray for keys
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
    textTransform: 'uppercase',
  },
  engineTag: {
    color: '#6B7280',
    fontWeight: '400',
  },
  thoughtDetail: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  }
});
