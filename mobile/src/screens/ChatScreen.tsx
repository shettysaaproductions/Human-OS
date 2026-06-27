import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useChatStore, Message } from '../store/useChatStore';
import { api } from '../services/api';

// Silent telemetry helper
async function trackEvent(event_type: string, event_data?: object) {
  try {
    await api.post('/telemetry', { event_type, event_data, platform: Platform.OS, app_version: '0.2.0-beta' });
  } catch {}
}

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const { messages, isTyping, isHydrated, hydrateMessages, sendMessage, retryMessage } = useChatStore();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const didTrackOpen = useRef(false);

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
  }, [inputText, sendMessage]);

  const renderItem = useCallback(({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[s.bubble, isUser ? s.userBubble : s.novaBubble]}>
        {!isUser && (
          <View style={s.avatarDot} />
        )}
        <View style={[s.bubbleInner, isUser ? s.userBubbleInner : s.novaBubbleInner]}>
          <Text style={[s.messageText, isUser ? s.userText : s.novaText]}>
            {item.content}
          </Text>
          {isUser && item.status === 'error' && (
            <TouchableOpacity onPress={() => retryMessage(item.id)} style={s.retryButton}>
              <Text style={s.retryText}>⚠️ {item.errorMessage || 'Failed'} · Tap to retry</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }, [retryMessage]);

  if (!isHydrated) {
    return (
      <View style={s.centerContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={s.novaAvatar}>
              <Text style={s.novaAvatarText}>N</Text>
            </View>
            <View>
              <Text style={s.headerTitle}>Nova</Text>
              <Text style={s.headerSubtitle}>Your AI companion</Text>
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

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          removeClippedSubviews
          windowSize={10}
          ListEmptyComponent={
            <View style={s.emptyChat}>
              <Text style={s.emptyChatEmoji}>🌌</Text>
              <Text style={s.emptyChatText}>Hi, I'm Nova.</Text>
              <Text style={s.emptyChatSubtext}>Tell me about yourself — your goals, your day, what's on your mind. I remember everything.</Text>
            </View>
          }
        />

        {/* Typing indicator */}
        {isTyping && (
          <View style={s.typingContainer}>
            <View style={s.typingDot} />
            <View style={[s.typingDot, { opacity: 0.6 }]} />
            <View style={[s.typingDot, { opacity: 0.3 }]} />
          </View>
        )}

        {/* Input */}
        <View style={s.inputContainer}>
          <TextInput
            style={s.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Message Nova..."
            placeholderTextColor="#555"
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!inputText.trim() || isTyping) && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || isTyping}
          >
            <Text style={s.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#09090B' },
  container: { flex: 1, backgroundColor: '#09090B' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.02)'
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  novaAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#8B5CF6',
    alignItems: 'center', justifyContent: 'center'
  },
  novaAvatarText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  headerTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  headerSubtitle: { fontSize: 11, color: '#666' },
  headerRight: { flexDirection: 'row', gap: 4 },
  headerBtn: { padding: 8 },
  headerBtnText: { fontSize: 20 },
  listContent: { padding: 16, paddingBottom: 8 },
  bubble: { flexDirection: 'row', marginVertical: 4, alignItems: 'flex-end' },
  userBubble: { justifyContent: 'flex-end' },
  novaBubble: { justifyContent: 'flex-start', gap: 8 },
  avatarDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6', marginBottom: 6 },
  bubbleInner: { maxWidth: '80%', padding: 12, borderRadius: 18 },
  userBubbleInner: { backgroundColor: '#8B5CF6', borderBottomRightRadius: 4 },
  novaBubbleInner: { backgroundColor: 'rgba(255,255,255,0.07)', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 16, lineHeight: 22 },
  userText: { color: '#fff' },
  novaText: { color: '#e8e8e8' },
  retryButton: { marginTop: 6 },
  retryText: { color: '#F59E0B', fontSize: 12, fontWeight: '600' },
  typingContainer: {
    flexDirection: 'row', gap: 4, paddingHorizontal: 24, paddingVertical: 8, alignItems: 'center'
  },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6' },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 80 },
  emptyChatEmoji: { fontSize: 48, marginBottom: 16 },
  emptyChatText: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  emptyChatSubtext: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 22 },
  inputContainer: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
    alignItems: 'flex-end', gap: 10
  },
  input: {
    flex: 1, color: '#fff', backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 16, maxHeight: 120, lineHeight: 22
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#8B5CF6',
    alignItems: 'center', justifyContent: 'center'
  },
  sendBtnDisabled: { backgroundColor: 'rgba(139,92,246,0.3)' },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold', lineHeight: 22 },
});
