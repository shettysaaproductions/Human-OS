import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { chatService } from '../services/chatService';

export interface Message {
  id: string;
  role: 'user' | 'nova';
  content: string;
  status: 'sending' | 'sent' | 'error';
}

interface ChatState {
  messages: Message[];
  isTyping: boolean;
  isHydrated: boolean;
  
  hydrateMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  clearMessages: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => {
  const saveMessages = async (msgs: Message[]) => {
    try {
      await SecureStore.setItemAsync('chatHistory', JSON.stringify(msgs));
    } catch (e) {
      console.error('Failed to save chat history', e);
    }
  };

  const processMessage = async (msgId: string, content: string) => {
    set({ isTyping: true });
    try {
      const { reply } = await chatService.sendMessage(content);
      
      const novaMsg: Message = {
        id: Date.now().toString() + '_nova',
        role: 'nova',
        content: reply,
        status: 'sent'
      };

      set((state) => {
        const updated = state.messages.map(m => m.id === msgId ? { ...m, status: 'sent' as const } : m);
        const finalMsgs = [...updated, novaMsg];
        saveMessages(finalMsgs);
        return { messages: finalMsgs, isTyping: false };
      });
    } catch (error) {
      set((state) => {
        const updated = state.messages.map(m => m.id === msgId ? { ...m, status: 'error' as const } : m);
        saveMessages(updated);
        return { messages: updated, isTyping: false };
      });
    }
  };

  return {
    messages: [],
    isTyping: false,
    isHydrated: false,
    
    hydrateMessages: async () => {
      try {
        const history = await SecureStore.getItemAsync('chatHistory');
        if (history) {
          set({ messages: JSON.parse(history), isHydrated: true });
        } else {
          set({ isHydrated: true });
        }
      } catch (e) {
        set({ isHydrated: true });
      }
    },

    sendMessage: async (content: string) => {
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content,
        status: 'sending'
      };

      set((state) => {
        const newMsgs = [...state.messages, userMsg];
        saveMessages(newMsgs);
        return { messages: newMsgs };
      });

      await processMessage(userMsg.id, content);
    },

    retryMessage: async (messageId: string) => {
      const state = get();
      const msg = state.messages.find(m => m.id === messageId);
      if (!msg) return;

      set((s) => {
        const updated = s.messages.map(m => m.id === messageId ? { ...m, status: 'sending' as const } : m);
        saveMessages(updated);
        return { messages: updated };
      });

      await processMessage(msg.id, msg.content);
    },
    
    clearMessages: async () => {
      await SecureStore.deleteItemAsync('chatHistory');
      set({ messages: [] });
    }
  };
});
