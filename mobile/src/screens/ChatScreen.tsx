import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TextInput, Button, FlatList, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useChatStore, Message } from '../store/useChatStore';

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const { messages, isTyping, isHydrated, hydrateMessages, sendMessage, retryMessage } = useChatStore();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    hydrateMessages();
  }, []);

  const handleSend = () => {
    if (!inputText.trim()) return;
    sendMessage(inputText.trim());
    setInputText('');
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    
    return (
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.novaBubble]}>
        <Text style={[styles.messageText, isUser ? styles.userText : styles.novaText]}>
          {item.content}
        </Text>
        
        {isUser && item.status === 'error' && (
          <TouchableOpacity onPress={() => retryMessage(item.id)} style={styles.retryButton}>
            <Text style={styles.retryText}>{item.errorMessage ? `${item.errorMessage}. Tap to retry.` : 'Failed. Tap to retry.'}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (!isHydrated) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Nova</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => navigation.navigate('Brain')} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>🧠</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Diagnostics')} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />
      
      {isTyping && (
        <View style={styles.typingIndicator}>
          <Text style={styles.typingText}>Nova is typing...</Text>
        </View>
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          multiline
        />
        <Button title="Send" onPress={handleSend} disabled={!inputText.trim() || isTyping} />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f9f9f9' },
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff'
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  headerRight: { position: 'absolute', right: 16, flexDirection: 'row' },
  headerBtn: { marginLeft: 16 },
  headerBtnText: { fontSize: 20 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16, paddingBottom: 32 },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginVertical: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
    borderBottomRightRadius: 4,
  },
  novaBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#E5E5EA',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: '#fff',
  },
  novaText: {
    color: '#000',
  },
  retryButton: {
    marginTop: 4,
    padding: 4,
  },
  retryText: {
    color: '#ff3b30',
    fontSize: 12,
    fontWeight: 'bold',
  },
  typingIndicator: {
    padding: 8,
    paddingHorizontal: 16,
  },
  typingText: {
    color: '#888',
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 12,
    maxHeight: 100,
  }
});
