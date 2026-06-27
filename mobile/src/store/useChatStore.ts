import { create } from 'zustand';
import { chatService } from '../services/chatService';

export interface Message {
  id: string;
  role: 'user' | 'assistant'; // Switched from 'nova' to 'assistant' to match DB
  content: string;
  status: 'sending' | 'sent' | 'error';
  errorMessage?: string;
}

interface ChatState {
  messages: Message[];
  conversationId: string | null;
  isTyping: boolean;
  isHydrated: boolean;
  
  hydrateMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => {
  const processMessage = async (msgId: string, content: string) => {
    set({ isTyping: true });
    try {
      const state = get();
      const { reply, conversation_id } = await chatService.sendMessage(content, state.conversationId || undefined);
      
      const novaMsg: Message = {
        id: Date.now().toString() + '_nova',
        role: 'assistant',
        content: reply,
        status: 'sent'
      };

      set((s) => {
        const updated = s.messages.map(m => m.id === msgId ? { ...m, status: 'sent' as const } : m);
        return { 
          messages: [...updated, novaMsg], 
          isTyping: false,
          conversationId: conversation_id // Save the active conversation ID
        };
      });
    } catch (error: any) {
      let errorMessage = 'Network error';
      if (error.response) {
        if (error.response.status === 401) {
          errorMessage = 'Unauthorized';
        } else if (error.response.status === 404) {
          errorMessage = 'Endpoint not found';
        } else if (error.response.status >= 500) {
          errorMessage = 'Server error';
        } else {
          errorMessage = error.response.data?.error || 'Failed to send';
        }
      }
      set((s) => {
        const updated = s.messages.map(m => m.id === msgId ? { ...m, status: 'error' as const, errorMessage } : m);
        return { messages: updated, isTyping: false };
      });
    }
  };

  return {
    messages: [],
    conversationId: null,
    isTyping: false,
    isHydrated: false,
    
    hydrateMessages: async () => {
      try {
        const history = await chatService.getHistory();
        if (history && history.length > 0) {
          const formattedHistory = history.map((msg: any) => ({
            id: msg.id,
            role: msg.role === 'nova' ? 'assistant' : msg.role,
            content: msg.content,
            status: 'sent'
          }));
          set({ 
            messages: formattedHistory, 
            conversationId: history[0].conversation_id, // Get ID from most recent message
            isHydrated: true 
          });
        } else {
          set({ isHydrated: true });
        }
      } catch (e) {
        console.error('Failed to hydrate history from backend:', e);
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

      set((state) => ({ messages: [...state.messages, userMsg] }));
      await processMessage(userMsg.id, content);
    },

    retryMessage: async (messageId: string) => {
      const state = get();
      const msg = state.messages.find(m => m.id === messageId);
      if (!msg) return;

      set((s) => ({
        messages: s.messages.map(m => m.id === messageId ? { ...m, status: 'sending' as const } : m)
      }));

      await processMessage(msg.id, msg.content);
    },
    
    clearMessages: () => {
      set({ messages: [], conversationId: null });
    }
  };
});
