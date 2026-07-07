import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator,
  Pressable
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useChatStore, Message } from '../store/useChatStore';
import { api } from '../services/api';
import { useTheme } from '../theme/ThemeContext';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';

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
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const [inputText, setInputText] = useState('');
  const [isReadyToRender, setIsReadyToRender] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const flatListRef = useRef<FlatList>(null);

  const isSelectionMode = selectedMessageIds.length > 0;
  
  const toggleSelectMessage = useCallback((id: string) => {
    setSelectedMessageIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);
  const didTrackOpen = useRef(false);
  const isNearBottomRef = useRef(true);
  const isInitialScrollRef = useRef(true);
  const currentOffsetRef = useRef(0);

  const logEvent = (eventName: string, explicitOffset?: number) => {
    const offset = explicitOffset !== undefined ? explicitOffset : currentOffsetRef.current;
    console.log(`[DIAGNOSTIC] ${new Date().toISOString()} | ${eventName} | messages.length: ${messages.length} | contentOffset: ${offset}`);
  };

  useEffect(() => {
    logEvent('MESSAGES_COUNT');
  }, [messages.length]);

  useEffect(() => {
    if (isHydrated) {
      logEvent('HYDRATION_COMPLETE');
    }
  }, [isHydrated]);

  const hasRenderedList = useRef(false);
  if (!hasRenderedList.current && isHydrated) {
    hasRenderedList.current = true;
    logEvent('FLATLIST_FIRST_RENDER');
  }

  // If hydrated and there are no messages, show empty state immediately
  useEffect(() => {
    if (isHydrated && messages.length === 0) {
      setIsReadyToRender(true);
    }
  }, [isHydrated, messages.length]);
  
  const [stickyDate, setStickyDate] = useState<string | null>(null);

  // Diagnostics — dev mode only
  useEffect(() => {
    if (developerMode && messages.length > 0) {
      console.log('Messages stored in Zustand:', messages.length);
      console.log('Oldest message:', messages[0]?.timestamp);
      console.log('Newest message:', messages[messages.length - 1]?.timestamp);
    }
  }, [developerMode, messages.length]);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 100,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      const topItem = viewableItems[viewableItems.length - 1].item;
      if (topItem && topItem.timestamp) {
        const newDate = formatDateSeparator(topItem.timestamp);
        // Bail out if date hasn't changed — prevents unnecessary re-renders
        setStickyDate(prev => prev === newDate ? prev : newDate);
      }
    }
  }).current;

  useEffect(() => {
    logEvent('COMPONENT_MOUNT');
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
    const { contentOffset } = event.nativeEvent;
    currentOffsetRef.current = contentOffset.y;
    const paddingToBottom = 150;
    isNearBottomRef.current = contentOffset.y < paddingToBottom;
  }, []);
  const renderItem = useCallback(({ item, index }: { item: Message, index: number }) => {
    const isUser = item.role === 'user';
    
    let showDateSeparator = false;
    if (index === reversedMessages.length - 1) {
      showDateSeparator = true;
    } else {
      const prevMessage = reversedMessages[index + 1];
      if (prevMessage && item.timestamp) {
        const currentDate = new Date(item.timestamp).toDateString();
        const prevDate = new Date(prevMessage.timestamp || new Date().toISOString()).toDateString();
        if (currentDate !== prevDate) {
          showDateSeparator = true;
        }
      }
    }
    
    if (developerMode && showDateSeparator && item.timestamp) {
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
        <Pressable 
          onLongPress={() => toggleSelectMessage(item.id)}
          onPress={() => {
            if (isSelectionMode) {
              toggleSelectMessage(item.id);
            }
          }}
          style={s.bubbleContainer}
        >
          {selectedMessageIds.includes(item.id) && (
            <View 
              pointerEvents="none" 
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(139, 92, 246, 0.15)', zIndex: 10 }]} 
            />
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
            {!isUser ? (
              <Markdown style={{
                body: { color: colors.assistantText, fontSize: 16, lineHeight: 22 },
                heading1: { color: colors.assistantText, fontSize: 24, fontWeight: 'bold', marginVertical: 12 },
                heading2: { color: colors.assistantText, fontSize: 20, fontWeight: 'bold', marginVertical: 10 },
                heading3: { color: colors.assistantText, fontSize: 18, fontWeight: 'bold', marginVertical: 8 },
                strong: { fontWeight: 'bold', color: colors.assistantText },
                em: { fontStyle: 'italic', color: colors.assistantText },
                u: { textDecorationLine: 'underline' },
                blockquote: { backgroundColor: 'rgba(139, 92, 246, 0.1)', borderLeftWidth: 4, borderLeftColor: '#8B5CF6', paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8, borderRadius: 4 },
                code_block: { backgroundColor: 'rgba(0,0,0,0.1)', padding: 10, borderRadius: 8, marginVertical: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.assistantText },
                hr: { backgroundColor: colors.border, height: 1, marginVertical: 12 },
                list_item: { flexShrink: 1 },
                bullet_list_content: { flexShrink: 1 },
                ordered_list_content: { flexShrink: 1 }
              }}
              rules={{
                fence: (node, children, parent, styles) => {
                  const content = node.content;
                  const language = node.sourceInfo;
                  const isCopyable = language === 'copyable';
                  
                  return (
                    <View key={node.key} style={s.fenceContainer}>
                      <View style={s.fenceHeader}>
                        <Text style={s.fenceLanguage}>{isCopyable ? 'Content' : (language || 'Code')}</Text>
                        <TouchableOpacity 
                          style={s.copyButton}
                          onPress={async () => {
                            await Clipboard.setStringAsync(content);
                          }}
                        >
                          <Text style={s.copyButtonText}>Copy</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={s.fenceContent}>
                        {isCopyable ? (
                          <Markdown style={{
                            body: { color: colors.assistantText, fontSize: 16, lineHeight: 24 },
                            strong: { fontWeight: 'bold' },
                            em: { fontStyle: 'italic' },
                            heading1: { color: colors.assistantText, fontSize: 24, fontWeight: 'bold', marginVertical: 8 },
                            heading2: { color: colors.assistantText, fontSize: 20, fontWeight: 'bold', marginVertical: 8 },
                            heading3: { color: colors.assistantText, fontSize: 18, fontWeight: 'bold', marginVertical: 8 },
                            blockquote: { backgroundColor: 'rgba(139, 92, 246, 0.1)', borderLeftWidth: 4, borderLeftColor: '#8B5CF6', paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8, borderRadius: 4 },
                          }}>
                            {content}
                          </Markdown>
                        ) : (
                          <Text style={{ color: colors.assistantText, fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                            {content}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                },
                textgroup: (node, children, parent, styles) => {
                  return (
                    <Text key={node.key} style={styles.textgroup}>
                      {children}
                    </Text>
                  );
                },
                text: (node, children, parent, styles) => {
                  let content = node.content;
                  // If content contains escaped asterisks \*\* or unparsed **, force bolding manually.
                  // We'll replace \*\* with ** first if they exist.
                  content = content.replace(/\\\*\\\*/g, '**');
                  
                  if (content.includes('**')) {
                    const parts = content.split(/(\*\*[\s\S]*?\*\*)/g);
                    return (
                      <Text key={node.key} style={styles.text}>
                        {parts.map((part, index) => {
                          if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                            return (
                              <Text key={index} style={{ fontWeight: 'bold', color: styles.body?.color || '#000' }}>
                                {part.slice(2, -2)}
                              </Text>
                            );
                          }
                          return <Text key={index}>{part}</Text>;
                        })}
                      </Text>
                    );
                  }
                  return <Text key={node.key} style={styles.text}>{content}</Text>;
                }
              }}>
                {item.content}
              </Markdown>
            ) : (
              <Text style={[
                s.messageText,
                { color: colors.buttonText }
              ]}>
                {item.content}
              </Text>
            )}
            <View style={s.timestampContainer}>
              {item.chunkIndex && item.chunkTotal && (
                <Text style={[
                  s.chunkIndicatorText,
                  isUser ? { color: colors.buttonText, opacity: 0.5 } : { color: colors.assistantText, opacity: 0.4 }
                ]}>
                  {item.chunkIndex}/{item.chunkTotal}
                </Text>
              )}
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
        </Pressable>
      </View>
    );
  }, [retryMessage, colors, reversedMessages, developerMode, selectedMessageIds, isSelectionMode, toggleSelectMessage]);

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
        {isSelectionMode ? (
          <View style={[s.header, { borderBottomColor: colors.border, backgroundColor: 'rgba(139, 92, 246, 0.1)' }]}>
            <View style={s.headerLeft}>
              <TouchableOpacity onPress={() => setSelectedMessageIds([])} style={s.headerBtn}>
                <Text style={[s.headerBtnText, { color: colors.textPrimary }]}>✕</Text>
              </TouchableOpacity>
              <Text style={[s.headerTitle, { color: colors.textPrimary, marginLeft: 8 }]}>{selectedMessageIds.length} Selected</Text>
            </View>
            <View style={s.headerRight}>
              <TouchableOpacity onPress={async () => {
                const selectedMsgs = messages
                  .filter(m => selectedMessageIds.includes(m.id))
                  .map(m => m.content)
                  .join('\n\n');
                if (selectedMsgs) {
                  await Clipboard.setStringAsync(selectedMsgs);
                  setSelectedMessageIds([]);
                }
              }} style={s.headerBtn}>
                <Text style={s.headerBtnText}>📋</Text>
              </TouchableOpacity>
              {selectedMessageIds.length === 1 && (
                <TouchableOpacity onPress={() => {
                  const msg = messages.find(m => m.id === selectedMessageIds[0]);
                  if (msg) {
                    setInputText(msg.content);
                  }
                  setSelectedMessageIds([]);
                }} style={s.headerBtn}>
                  <Text style={s.headerBtnText}>✏️</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
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
        )}

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

          <FlatList
            ref={flatListRef}
            inverted
            data={reversedMessages}
            extraData={selectedMessageIds}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onContentSizeChange={() => {
              logEvent('ON_CONTENT_SIZE_CHANGE');
              if (isInitialScrollRef.current) {
                if (messages.length > 0) {
                  isInitialScrollRef.current = false;
                  logEvent('INITIAL_SCROLL_COMPLETED');
                  setIsReadyToRender(true);
                }
              } else if (isNearBottomRef.current) {
                logEvent('SCROLL_TO_END_CALLED');
                flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
              }
            }}
            onLayout={() => {
              logEvent('ON_LAYOUT');
              if (isInitialScrollRef.current) {
                if (messages.length > 0) {
                  setIsReadyToRender(true);
                }
              }
            }}
            removeClippedSubviews
            windowSize={10}
            initialNumToRender={15}
            maxToRenderPerBatch={5}
            updateCellsBatchingPeriod={50}
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
          {!isReadyToRender && (
            <View style={[StyleSheet.absoluteFill, s.centerContainer, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color="#8B5CF6" />
              <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 13 }}>Syncing local companion database...</Text>
            </View>
          )}
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
  bubbleContainer: {
    paddingHorizontal: 16,
    paddingVertical: 2,
    marginHorizontal: -16,
  },
  bubble: { flexDirection: 'row', marginVertical: 2, alignItems: 'flex-end' },
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
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    marginLeft: 12,
  },
  timestampText: {
    fontSize: 10,
  },
  chunkIndicatorText: {
    fontSize: 10,
    marginRight: 6,
    fontWeight: '600',
  },
  fenceContainer: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    overflow: 'hidden',
    width: '100%',
  },
  fenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  fenceLanguage: {
    fontSize: 12,
    color: '#888',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  copyButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 6,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  fenceContent: {
    padding: 12,
  }
});
