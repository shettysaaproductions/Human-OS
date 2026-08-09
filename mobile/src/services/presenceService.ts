import { AppState, AppStateStatus } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';
import { api } from './api';

// Simple debounce implementation
function debounce<T extends (...args: any[]) => void>(func: T, wait: number): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function(this: any, ...args: any[]) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  } as T;
}

type PresenceStatus = 'online' | 'typing' | 'away' | 'offline';

interface PresenceState {
  status: PresenceStatus;
  lastActiveAt: number;
  lastTypingAt: number | null;
  currentActivity: string | null;
}

class PresenceService {
  private state: PresenceState = {
    status: 'offline',
    lastActiveAt: Date.now(),
    lastTypingAt: null,
    currentActivity: null,
  };
  
  private listeners: Set<(state: PresenceState) => void> = new Set();
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private awayTimeout: ReturnType<typeof setTimeout> | null = null;
  private appStateSubscription: any = null;

  // Timing constants (in ms)
  private readonly TYPING_DURATION = 3000;        // Show "typing" for 3s after last keystroke
  private readonly AWAY_THRESHOLD = 60000;         // 1 min = away
  private readonly OFFLINE_THRESHOLD = 300000;     // 5 min = offline
  private readonly HEARTBEAT_INTERVAL = 15000;     // Send heartbeat every 15s

  initialize() {
    // Track app foreground/background
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Set initial state
    this.updateState({ status: 'online', lastActiveAt: Date.now() });
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      this.updateState({ status: 'online', lastActiveAt: Date.now() });
    } else if (nextAppState === 'background') {
      this.updateState({ status: 'away', lastActiveAt: Date.now() });
    } else if (nextAppState === 'inactive') {
      this.updateState({ status: 'offline' });
    }
  };

  // Call this when user starts typing in chat input
  onTypingStart() {
    this.clearTypingTimeout();
    this.updateState({ status: 'typing', lastTypingAt: Date.now() });
    
    // After 3s of no typing, revert to online
    this.typingTimeout = setTimeout(() => {
      this.updateState({ status: 'online' });
    }, this.TYPING_DURATION);
  }

  // Call this when user sends a message
  onMessageSent() {
    this.clearTypingTimeout();
    this.updateState({ status: 'online', lastActiveAt: Date.now() });
    this.resetAwayTimer();
  }

  // Call this when user opens chat screen
  onChatOpen() {
    this.updateState({ status: 'online', lastActiveAt: Date.now() });
    this.resetAwayTimer();
  }

  // Call this when user scrolls or interacts
  onUserActivity() {
    // A user who is actively scrolling/interacting is NOT away. Restore 'away'/'offline'
    // to 'online' (but don't clobber 'typing' if they're mid-keystroke).
    const { status } = this.state;
    this.updateState({
      status: (status === 'away' || status === 'offline') ? 'online' : status,
      lastActiveAt: Date.now(),
    });
    this.resetAwayTimer();
  }

  private resetAwayTimer() {
    if (this.awayTimeout) clearTimeout(this.awayTimeout);
    this.awayTimeout = setTimeout(() => {
      this.updateState({ status: 'away' });
    }, this.AWAY_THRESHOLD);
  }

  private clearTypingTimeout() {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
  }

  private startHeartbeat() {
    setInterval(() => {
      this.broadcastToServer();
    }, this.HEARTBEAT_INTERVAL);
  }

  private broadcastToServer() {
    // Send presence to backend via WebSocket or HTTP
    // This lets Nova know your status in real-time
    const { status, lastActiveAt } = this.state;
    
    // Debounced API call
    this.debouncedSync({ status, lastActiveAt });
  }

  private debouncedSync = debounce(async (data: any) => {
    try {
      const user = useAuthStore.getState().user;
      if (!user?.id) return; // Don't send if not logged in

      await api.post('/presence', {
        userId: user.id,
        ...data,
        timestamp: Date.now(),
      });
    } catch (e) {
      // Non-fatal
    }
  }, 5000);

  private updateState(partial: Partial<PresenceState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach(cb => cb(this.state));
  }

  getState(): PresenceState {
    return { ...this.state };
  }

  subscribe(callback: (state: PresenceState) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  destroy() {
    this.appStateSubscription?.remove();
    this.clearTypingTimeout();
    if (this.awayTimeout) clearTimeout(this.awayTimeout);
  }
}

export const presenceService = new PresenceService();
