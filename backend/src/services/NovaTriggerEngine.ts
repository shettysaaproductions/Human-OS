import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { outboundDispatcherService } from './OutboundDispatcherService';
import type { OutboundSource } from '../types/outbound';

interface TriggerContext {
  userPresence: 'online' | 'typing' | 'away' | 'offline';
  lastUserMessageAt: number;
  lastNovaReplyAt: number;
  conversationIntensity: 'casual' | 'focused' | 'deep';
  userActivity: string | null; // e.g., "working", "relaxing", "commuting"
  pendingReminders: number;
  emotionalState: any;
}

// TimingConfig removed because it is unused

export class NovaTriggerEngine {
  
  // NVIDIA rate limit safety: 30 req/min (buffer under 40 limit)
  private readonly MAX_REQUESTS_PER_MINUTE = 30;
  private requestTimestamps: number[] = [];
  private scheduledMessages: Map<string, NodeJS.Timeout> = new Map();
  private dedupeCache: Map<string, { lastContent: string, lastSentAt: number }> = new Map();

  async scheduleMessage(
    userId: string,
    context: TriggerContext,
    messageGenerator: () => Promise<string>,
    opts: { logicalKey: string; idempotencyKey: string }
  ): Promise<void> {
    // Correction 1: Stable identity is REQUIRED for any durable outbound operation.
    // Callers must supply the event-specific stable key — the TriggerEngine cannot
    // safely invent one from Date.now() because a retry crossing a minute boundary
    // would produce a different key and break idempotency.
    if (!opts?.logicalKey || !opts?.idempotencyKey) {
      throw new Error('[TriggerEngine] scheduleMessage requires a stable logicalKey and idempotencyKey from the caller');
    }
    const triggerResult = await this.shouldTrigger(context);
    
    if (!triggerResult.shouldSend) {
      logger.info(`[TriggerEngine] Blocked for ${userId}: ${triggerResult.reason}`);
      return;
    }
    
    // Cancel any existing scheduled message for this user
    const existing = this.scheduledMessages.get(userId);
    if (existing) clearTimeout(existing);
    
    // Schedule the message
    const timeout = setTimeout(async () => {
      try {
        const message = await messageGenerator();

        // Deduplication check
        const cached = this.dedupeCache.get(userId);
        if (cached && cached.lastContent === message && (Date.now() - cached.lastSentAt) < 10 * 60 * 1000) {
          logger.info(`[TriggerEngine] Deduplicated exact message for ${userId}`);
          return;
        }
        this.dedupeCache.set(userId, { lastContent: message, lastSentAt: Date.now() });

        // Route through canonical Dispatcher — owns gate, chat_history, push, and audit.
        // The caller-supplied opts.idempotencyKey guarantees this exact logical event
        // produces exactly one outbound_intents row, one chat_history row, and at-most-one push,
        // even across process restarts.
        await outboundDispatcherService.dispatch({
          userId,
          sourceEngine: 'TRIGGER_ENGINE' as OutboundSource,
          intentType: 'proactive',
          logicalKey: opts.logicalKey,
          idempotencyKey: opts.idempotencyKey,
          context: {},
          generationStrategy: 'none',
          proposedMessage: message,
          proposedAction: 'MESSAGE',
        });
      } catch (e) {
        logger.error('[TriggerEngine] Failed to dispatch scheduled message:', e);
      }

      this.scheduledMessages.delete(userId);
    }, triggerResult.delayMs);

    this.scheduledMessages.set(userId, timeout);
    logger.info(`[TriggerEngine] Scheduled message for ${userId} in ${triggerResult.delayMs}ms`);
  }


  // Timing profiles based on user presence
  private readonly TIMING_PROFILES = {
    // User is actively typing → respond quickly
    typing: { minDelayMs: 2000, maxDelayMs: 8000, urgencyBoost: true },
    
    // User is online and active → natural conversation pace
    online: { minDelayMs: 5000, maxDelayMs: 25000, urgencyBoost: false },
    
    // User hasn't interacted for 1-5 min → thoughtful pause
    away: { minDelayMs: 30000, maxDelayMs: 120000, urgencyBoost: false },
    
    // User is offline → only urgent/important messages
    offline: { minDelayMs: 300000, maxDelayMs: 900000, urgencyBoost: true },
  };

  async shouldTrigger(context: TriggerContext): Promise<{ shouldSend: boolean; delayMs: number; reason: string }> {
    
    // 1. Rate limit check
    if (!this.checkRateLimit()) {
      return { shouldSend: false, delayMs: 0, reason: 'rate_limited' };
    }

    // 2. Presence-based timing
    const profile = this.TIMING_PROFILES[context.userPresence];
    
    // 3. Urgency override (reminders, emotional crisis, important updates)
    const isUrgent = this.isUrgent(context);
    
    if (isUrgent && context.userPresence === 'offline') {
      // Even if offline, send urgent messages after shorter delay
      return { 
        shouldSend: true, 
        delayMs: 60000, // 1 min for urgent offline
        reason: 'urgent_offline' 
      };
    }

    // 4. Calculate realistic delay
    let delayMs = this.randomBetween(profile.minDelayMs, profile.maxDelayMs);
    
    // 5. Adjust for conversation intensity
    if (context.conversationIntensity === 'deep') {
      delayMs *= 1.5; // Slower, more thoughtful replies
    } else if (context.conversationIntensity === 'casual') {
      delayMs *= 0.7; // Faster, lighter replies
    }

    // 6. Check if user just sent a message (avoid interrupting)
    const secondsSinceUserMessage = (Date.now() - context.lastUserMessageAt) / 1000;
    if (secondsSinceUserMessage < 3) {
      delayMs += 5000; // Wait at least 5s after user sends something
    }

    return { shouldSend: true, delayMs, reason: `presence_${context.userPresence}` };
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    
    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_MINUTE) {
      return false;
    }
    
    this.requestTimestamps.push(now);
    return true;
  }

  private isUrgent(context: TriggerContext): boolean {
    // Check for: reminders due, emotional crisis, important updates
    if (context.pendingReminders > 0) return true;
    if (context.emotionalState?.crisisDetected) return true;
    return false;
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Determine conversation intensity based on recent messages
  async analyzeConversationIntensity(userId: string): Promise<'casual' | 'focused' | 'deep'> {
    const { data: recentMessages } = await supabaseAdmin
      .from('chat_history')
      .select('content, role')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!recentMessages) return 'casual';

    const avgLength = recentMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / recentMessages.length;
    
    if (avgLength > 200) return 'deep';
    if (avgLength > 80) return 'focused';
    return 'casual';
  }
}

export const novaTriggerEngine = new NovaTriggerEngine();
