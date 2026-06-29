import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useChatStore, Message } from '../store/useChatStore';
import { api } from '../services/api';
import { useTheme } from '../theme/ThemeContext';

// Utility functions for WhatsApp-style formatting
const formatTime = (dateString?: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutesStr} ${ampm}`;
};

const formatDateSeparator = (dateString?: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'TODAY';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'YESTERDAY';
  } else {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  }
};

// Silent telemetry helper
async function trackEvent(event_type: string, event_data?: object) {
  try {
    await api.post('/telemetry', { event_type, event_data, platform: Platform.OS, app_version: '0.2.0-beta' });
  } catch {}
}

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { messages, isTyping, isHydrated, hydrateMessages, sendMessage, retryMessage, diagnostics, developerMode } = useChatStore();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<any>(null);
  const didTrackOpen = useRef(false);
  const isNearBottomRef = useRef(true);
  const isInitialLoad = useRef(true);
  const [isListReady, setIsListReady] = useState(false);
  
  const [stickyDate, setStickyDate] = useState<string | null>(null);

  // Temporary diagnostics
  useEffect(() => {
    if (messages.length > 0) {
      console.log('Messages stored in Zustand:', messages.length);
      console.log('Oldest message:', messages[0]?.timestamp);
      console.log('Newest message:', messages[messages.length - 1]?.timestamp);
    }
  }, [messages.length]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 100,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      // The top-most visible item determines the sticky date
      const topItem = viewableItems[0].item;
      if (topItem && topItem.timestamp) {
        setStickyDate(formatDateSeparator(topItem.timestamp));
      }
    }
  }).current;

  useEffect(() => {
    hydrateMessages();
    if (!didTrackOpen.current) {
      didTrackOpen.current = true;
      trackEvent('app_open');
    }
  }, []);

  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;
    sendMessage(inputText.trim());
    setInputText('');
    isNearBottomRef.current = true;
  }, [inputText, sendMessage]);

  const handleScroll = useCallback((event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 150;
    isNearBottomRef.current = layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
  }, []);

  const renderItem = useCallback(({ item, index }: { item: Message, index: number }) => {
    const isUser = item.role === 'user';
    
    let showDateSeparator = false;
    if (index === 0) {
      showDateSeparator = true;
    } else {
      const prevMessage = messages[index - 1];
      if (prevMessage && item.timestamp) {
        const currentDate = new Date(item.timestamp).toDateString();
        const prevDate = new Date(prevMessage.timestamp || new Date().toISOString()).toDateString();
        if (currentDate !== prevDate) {
          showDateSeparator = true;
        }
      }
    }
    
    if (showDateSeparator && item.timestamp) {
      console.log("Date separator:", formatDateSeparator(item.timestamp));
    }

    return (
      <View>
        {showDateSeparator && item.timestamp && (
          <View style={s.dateSeparatorContainer}>
            <Text style={[s.dateSeparatorText, { backgroundColor: colors.border, color: colors.textSecondary }]}>
              {formatDateSeparator(item.timestamp)}
            </Text>
          </View>
        )}
        <View style={[s.bubble, isUser ? s.userBubble : s.novaBubble]}>
          {!isUser && (
            <View style={s.avatarDot} />
          )}
          <View style={[
            s.bubbleInner,
            isUser
              ? { backgroundColor: colors.userBubble, borderBottomRightRadius: 4 }
              : { backgroundColor: colors.assistantBubble, borderBottomLeftRadius: 4 }
          ]}>
            <Text style={[
              s.messageText,
              isUser ? { color: colors.buttonText } : { color: colors.assistantText }
            ]}>
              {item.content}
            </Text>
            <View style={s.timestampContainer}>
              <Text style={[
                s.timestampText,
                isUser ? { color: colors.buttonText, opacity: 0.7 } : { color: colors.assistantText, opacity: 0.6 }
              ]}>
                {formatTime(item.timestamp)}
              </Text>
            </View>
            {isUser && item.status === 'error' && (
              <TouchableOpacity onPress={() => retryMessage(item.id)} style={s.retryButton}>
                <Text style={s.retryText}>⚠️ {item.errorMessage || 'Failed'} · Tap to retry</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }, [retryMessage, colors, messages]);

  if (!isHydrated) {
    return (
      <View style={[s.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  return (
    <SafeAreaView style={[s.safeArea, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={[s.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Header */}
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <View style={s.headerLeft}>
            <View style={s.novaAvatar}>
              <Text style={s.novaAvatarText}>N</Text>
            </View>
            <View>
              <Text style={[s.headerTitle, { color: colors.textPrimary }]}>Nova</Text>
              <Text style={[s.headerSubtitle, { color: colors.textSecondary }]}>Your AI companion</Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <TouchableOpacity onPress={() => navigation.navigate('Brain')} style={s.headerBtn}>
              <Text style={s.headerBtnText}>🧠</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={s.headerBtn}>
              <Text style={s.headerBtnText}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Diagnostics Card */}
        {developerMode && diagnostics && (
          <View style={{
            position: 'absolute', top: 80, right: 16, zIndex: 100,
            backgroundColor: 'rgba(0,0,0,0.8)', padding: 10, borderRadius: 8,
            borderWidth: 1, borderColor: '#8B5CF6'
          }}>
            <Text style={{ color: '#0f0', fontSize: 10, fontWeight: 'bold' }}>DEV DIAGNOSTICS</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>API: {diagnostics.apiCount}</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>Store: {diagnostics.storeCount}</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>Rendered: {messages.length}</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>Oldest: {diagnostics.oldestTimestamp ? new Date(diagnostics.oldestTimestamp).toDateString() : 'N/A'}</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>Newest: {diagnostics.newestTimestamp ? new Date(diagnostics.newestTimestamp).toDateString() : 'N/A'}</Text>
            <Text style={{ color: '#fff', fontSize: 8 }}>User: {diagnostics.activeUserId}</Text>
            <Text style={{ color: '#fff', fontSize: 8 }}>Conv: {diagnostics.activeConversationId}</Text>
          </View>
        )}

        {/* Messages and Sticky Header Container */}
        <View style={{ flex: 1 }}>
          {stickyDate && (
            <View style={s.stickyDateContainer}>
              <Text style={[s.dateSeparatorText, { backgroundColor: colors.border, color: colors.textSecondary }]}>
                {stickyDate}
              </Text>
            </View>
          )}
          {(() => {
             console.log("FlatList data length:", messages.length);
             return null;
          })()}
          <FlashList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            maintainVisibleContentPosition={{
              startRenderingFromBottom: true
            }}
            onContentSizeChange={() => {
              if (isNearBottomRef.current) {
                const animate = !isInitialLoad.current;
                flatListRef.current?.scrollToEnd({ animated: animate });
                isInitialLoad.current = false;
              }
            }}
            onLayout={() => {
              if (isNearBottomRef.current) {
                flatListRef.current?.scrollToEnd({ animated: false });
              }
            }}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            ListEmptyComponent={
              <View style={s.emptyChat}>
                <Text style={s.emptyChatEmoji}>🌌</Text>
                <Text style={[s.emptyChatText, { color: colors.textPrimary }]}>Hi, I'm Nova.</Text>
                <Text style={[s.emptyChatSubtext, { color: colors.textSecondary }]}>Tell me about yourself — your goals, your day, what's on your mind. I remember everything.</Text>
              </View>
            }
          />
        </View>

        {/* Typing indicator */}
        {isTyping && (
          <View style={s.typingContainer}>
            <View style={s.typingDot} />
            <View style={[s.typingDot, { opacity: 0.6 }]} />
            <View style={[s.typingDot, { opacity: 0.3 }]} />
          </View>
        )}

        {/* Input */}
        <View style={[s.inputContainer, { borderTopColor: colors.border }]}>
          <TextInput
            style={[s.input, { color: colors.textPrimary, backgroundColor: colors.inputBg }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Message Nova..."
            placeholderTextColor={colors.placeholder}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[s.sendBtn, !inputText.trim() && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim()}
          >
            <Text style={s.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)'
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  novaAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#8B5CF6',
    alignItems: 'center', justifyContent: 'center'
  },
  novaAvatarText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  headerTitle: { fontSize: 16, fontWeight: 'bold' },
  headerSubtitle: { fontSize: 11 },
  headerRight: { flexDirection: 'row', gap: 4 },
  headerBtn: { padding: 8 },
  headerBtnText: { fontSize: 20 },
  listContent: { padding: 16, paddingBottom: 8 },
  bubble: { flexDirection: 'row', marginVertical: 4, alignItems: 'flex-end' },
  userBubble: { justifyContent: 'flex-end' },
  novaBubble: { justifyContent: 'flex-start', gap: 8 },
  avatarDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6', marginBottom: 6 },
  bubbleInner: { maxWidth: '80%', padding: 12, borderRadius: 18 },
  messageText: { fontSize: 16, lineHeight: 22 },
  retryButton: { marginTop: 6 },
  retryText: { color: '#F59E0B', fontSize: 12, fontWeight: '600' },
  typingContainer: {
    flexDirection: 'row', gap: 4, paddingHorizontal: 24, paddingVertical: 8, alignItems: 'center'
  },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6' },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 80 },
  emptyChatEmoji: { fontSize: 48, marginBottom: 16 },
  emptyChatText: { fontSize: 22, fontWeight: 'bold', marginBottom: 10 },
  emptyChatSubtext: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  inputContainer: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderTopWidth: 1,
    alignItems: 'flex-end', gap: 10
  },
  input: {
    flex: 1,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 16, maxHeight: 120, lineHeight: 22
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#8B5CF6',
    alignItems: 'center', justifyContent: 'center'
  },
  sendBtnDisabled: {
    backgroundColor: '#333'
  },
  sendBtnText: {
    color: '#fff', fontSize: 20, fontWeight: 'bold'
  },
  dateSeparatorContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  stickyDateContainer: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  dateSeparatorText: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: '500',
    overflow: 'hidden'
  },
  timestampContainer: {
    alignSelf: 'flex-end',
    marginTop: 4,
    marginLeft: 12,
  },
  timestampText: {
    fontSize: 10,
  }
});
