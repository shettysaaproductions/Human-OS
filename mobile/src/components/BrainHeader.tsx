import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface BrainHeaderProps {
  title: string;
  subtitle?: string;
  icon?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  rightElement?: React.ReactNode;
}

export const BrainHeader = React.memo(function BrainHeader({
  title,
  subtitle,
  icon,
  onRefresh,
  isRefreshing,
  rightElement
}: BrainHeaderProps) {
  const navigation = useNavigation<any>();

  const handleBack = () => {
    try {
      navigation.navigate('Chat');
    } catch {
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.backText}>Chat</Text>
        </TouchableOpacity>

        <View style={styles.titleCenter}>
          <View style={styles.titleRow}>
            {icon ? <Text style={styles.titleIcon}>{icon}</Text> : null}
            <Text style={styles.titleText} numberOfLines={1}>{title}</Text>
          </View>
          {subtitle ? (
            <Text style={styles.subtitleText} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>

        <View style={styles.rightSlot}>
          {rightElement ? (
            rightElement
          ) : onRefresh ? (
            <TouchableOpacity
              onPress={onRefresh}
              style={styles.actionBtn}
              activeOpacity={0.7}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color="#A78BFA" />
              ) : (
                <Text style={styles.actionIcon}>↻</Text>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.emptySlot} />
          )}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#09090B',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 70,
  },
  backChevron: {
    color: '#A78BFA',
    fontSize: 20,
    lineHeight: 20,
    fontWeight: '600',
    marginRight: 4,
    marginTop: -1,
  },
  backText: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
  },
  titleCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleIcon: {
    fontSize: 16,
  },
  titleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  subtitleText: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 1,
  },
  rightSlot: {
    minWidth: 70,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {
    color: '#A78BFA',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '700',
  },
  emptySlot: {
    width: 34,
  },
});
