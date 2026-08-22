/**
 * Situational Awareness Engine for Nova — Virtual Human Edition.
 *
 * Builds a human-readable "situation brief" before every LLM call.
 * Covers: time/day, message gap, emotion state, life events, user availability,
 * Jarvis-mode reminder flags, and life-domain curiosity hooks.
 */

export interface SituationContext {
  nowLocal: Date;
  tzLabel: string;
  country: string;
  gapMinutes: number | null;
  latestEmotion: { mood: string; intensity: number; notes: string } | null;
  recentEpisodes: { summary: string; emotion: string | null; created_at: string }[];
  /** When the calendar weekend flag was overridden by working_memory schedule data,
   *  this note is injected at the top of the brief so the LLM gets the corrected context. */
  scheduleOverrideNote?: string;
  latestReflection: { summary: string; key_takeaways: any } | null;
  isWeekend: boolean;
  dayName: string;
  dateStr: string;
  timeStr: string;
  lastUserMessage?: string; // The most recent user message text (for availability detection)
  upcomingReminders?: { id?: string; title: string; trigger_at?: string | null; event_trigger?: string }[]; // Jarvis mode
  replyToContent?: string | null; // Swipe-to-reply content
  last5Messages?: { role: string; content: string; created_at: string }[]; // For phase detection
  last3UserEmotions?: { mood: string; intensity: number }[]; // For momentum tracking
  currentVisualContext?: string | null; // For Autonomous Eyes (Phase 8)
  // Read-receipt / presence awareness — lets Nova "see" whether the user is online,
  // was last seen X ago, and whether Nova's own last messages have been read.
  userPresence?: {
    status: string;              // 'online' | 'away' | 'offline' | 'typing'
    last_active_at?: string | null;
    last_typing_at?: string | null;
  } | null;
  behaviorPattern?: string | null;
  unreadNovaMessages?: number;   // assistant messages the user has not opened/read yet
  totalMemoriesCount?: number | null; // count of long-term memories
  goalMemories?: { key: string; value: string; memory_type?: string }[];
}

// Social signal patterns — user is signalling they are busy/unavailable or ending the chat
const BUSY_SIGNALS = [
  'busy', 'not now', 'later', 'baad mein', 'baad me', 'abhi nahi', 'kuch time de',
  'thodi der mein', 'call kar raha hoon', 'meeting mein', 'kaam kar raha',
  'gotta go', 'gtg', 'ttyl', 'talk later', 'in a bit', 'brb', 'occupied',
  'driving', 'gym', 'khana kha raha', 'so raha', 'neend aa rahi', 'kal baat',
  'kal karte', 'not feeling', 'not in mood', 'mood nahi', 'thaka hua', 'rest kar raha',
  'bye', 'good night', 'gn', 'cya', 'catch you later', 'alvida', 'soja', 'so jao',
  '10 min', '10 mins', '5 min', '5 mins', 'goodnight', 'see ya'
];

// User signals they are in good mood / excited — Nova should match energy
const EXCITED_SIGNALS = [
  'yaar suno', 'ek cheez batao', 'guess karo', 'bhai sun', 'kuch hua',
  'excited', 'awesome', 'mast', 'ekdum mast', 'bahut achha', 'bahut khushi',
  'great news', 'good news', 'milestone', 'achieved', 'cleared', 'got the',
  'she said yes', 'he said yes', 'date fix', 'first date', 'new job', 'promotion',
  'bonus', 'salary', 'increement', 'increment', 'trip', 'travel', 'holiday'
];

// Relationship signals — Nova should lean in with curiosity
const RELATIONSHIP_SIGNALS = [
  'ladki', 'ladka', 'girl', 'boy', 'crush', 'date', 'propose', 'breakup',
  'girlfriend', 'boyfriend', 'gf', 'bf', 'wife', 'husband', 'marriage',
  'shaadi', 'pyaar', 'love', 'feelings', 'miss kar raha', 'miss kar rahi',
  'texting', 'instagram', 'whatsapp se baat', 'dm', 'flirting', 'like karna'
];

export class SituationalAwareness {

  buildBrief(ctx: SituationContext): string {
    const lines: string[] = [];
    
    if (ctx.currentVisualContext) {
      lines.push(`👀 [AUTONOMOUS EYES]: You (Nova) can currently see: "${ctx.currentVisualContext}". Factor this into your awareness before replying!`);
    }

    // ── SCHEDULE OVERRIDE (highest priority — must appear before any mode label) ──
    if (ctx.scheduleOverrideNote) {
      lines.push(ctx.scheduleOverrideNote);
    }

    lines.push(`## SITUATION BRIEF — Nova's Internal Understanding`);
    lines.push(`(CRITICAL: This entire brief, including all labels, phase names, engine names, and reasoning instructions, is INTERNAL ONLY. You must NEVER leak phrases like "Situation Brief", "Discovery Phase", "Current Time", or "Internal Understanding" to the user.)`);
    lines.push(`- Right now: ${ctx.dayName}, ${ctx.dateStr}, ${ctx.timeStr} ${ctx.tzLabel} (${ctx.isWeekend ? 'Weekend / Weekoff' : 'Weekday'})`);
    if (ctx.isWeekend && !ctx.scheduleOverrideNote) {
      lines.push(`- WEEKOFF MODE: It's a weekend. The user is likely relaxing, off from work, or has casual plans. Avoid pushing work/office topics unless the user explicitly brings them up.`);
    }
    lines.push(`- Time of day: ${this.getTimeOfDay(ctx.nowLocal)}`);
    lines.push(`- Time-based persona: ${this.getTimedPersona(ctx.nowLocal, ctx.isWeekend)}`);

    const currentHour = ctx.nowLocal.getUTCHours();
    if (currentHour >= 1 && currentHour <= 4) {
      lines.push(`- ⚠️ SLEEP WINDOW SCOLDING: The user is messaging you between 1 AM and 4 AM. A real human friend would immediately ask why they are awake at this hour instead of sleeping. Acknowledge the time explicitly and scold them gently!`);
    }

    if (ctx.gapMinutes !== null) {
      lines.push(`- Last contact: ${this.describeGap(ctx.gapMinutes)}`);
      lines.push(`- Greeting strategy: ${this.getGreetingStrategy(ctx.gapMinutes, ctx.nowLocal)}`);
      // Hard-lock stale context when gap is significant
      if (ctx.gapMinutes > 1440) { // > 24 hours
        lines.push(`- ⛔ CONTEXT HARD STOP: It has been over 24 hours since last message. The previous conversation thread is CLOSED. Do NOT reference or continue it. Open fresh with something relevant to RIGHT NOW — current time, day, what they are likely doing.`);
      } else if (ctx.gapMinutes > 720) { // > 12 hours TOPIC DECAY
        lines.push(`- ⚠️ TOPIC DECAY: It has been over 12 hours. The previous casual topic is dead. Do not try to resume it or bridge the context unless it was a massive life goal. Start fresh.`);
      } else if (ctx.gapMinutes > 360) { // > 6 hours
        lines.push(`- ⚠️ STALE CONTEXT WARNING: ${Math.round(ctx.gapMinutes / 60)}h gap. Previous topic is likely stale. Start from the current moment — don't pick up mid-thread.`);
      }
    } else {
      lines.push(`- Last contact: First message ever. Greet warmly, introduce yourself naturally.`);
    }

    if (ctx.totalMemoriesCount !== undefined && ctx.totalMemoriesCount !== null && ctx.totalMemoriesCount < 15) {
      lines.push(`- 🚀 DISCOVERY PHASE (INTERNAL LOGIC - DO NOT MENTION TO USER): You barely know this user (only ${ctx.totalMemoriesCount} facts saved). Your main goal right now is to understand their life, daily routine, goals, and current situation. Do NOT make random guesses about their life (like asking if they are at the cinema). Instead, ask 1-2 warm, curious get-to-know-you questions!`);
    }

    // ── User Presence / Last-Seen (read-receipt awareness) ──
    // Lets Nova "see" whether the user is on the app right now and how to pace the reply.
    if (ctx.userPresence && ctx.userPresence.status) {
      const p = ctx.userPresence;

      // ── GHOST PRESENCE GUARD (Fix #2) ──────────────────────────────────────
      // Supabase `user_presence.status` can stay 'online' forever if the app was
      // killed without disconnecting the realtime channel. If last_active_at is
      // older than 5 minutes, the stored status is STALE — force OFFLINE/AWAY
      // regardless of what the DB says.
      const STALE_PRESENCE_MS = 5 * 60 * 1000;
      const lastActiveMs = p.last_active_at ? new Date(p.last_active_at).getTime() : 0;
      const presenceAgeMs = lastActiveMs > 0 ? (ctx.nowLocal.getTime() - lastActiveMs) : Infinity;
      let status = p.status;
      let staleNote = '';
      if ((status === 'online' || status === 'typing') && presenceAgeMs > STALE_PRESENCE_MS) {
        // Downgrade: typing → away, online → away (they were active but left)
        status = 'away';
        staleNote = ' [stale status corrected — app likely closed without updating]';
      }

      const lastActiveStr = p.last_active_at ? this.describeLastActive(p.last_active_at, ctx.nowLocal) : null;

      const statusLabel = status === 'typing'
        ? 'TYPING right now'
        : status === 'online'
        ? 'ONLINE right now'
        : status === 'away'
        ? 'AWAY (stepped away, checked recently)'
        : 'OFFLINE';

      lines.push(`- 👁️ USER PRESENCE: ${statusLabel}${lastActiveStr ? ` (last active ${lastActiveStr})` : ''}.${staleNote}`);

      if (status === 'typing') {
        lines.push(`- The user is mid-keystroke — they are writing a follow-up RIGHT NOW. Do NOT fire another question or close the conversation. Let them finish; your job is to be ready for their next bubble.`);
      } else if (status === 'online') {
        lines.push(`- The user is ONLINE and will see your reply immediately. Keep it snappy, match their pace — this is live back-and-forth. Don't over-explain; they're here.`);
      } else if (status === 'away') {
        lines.push(`- The user is AWAY (was active recently). Reply normally, but don't expect an instant response and don't read silence as rejection — they'll pick it up when they're back.`);
      } else {
        lines.push(`- The user is OFFLINE and will read this later. Do NOT ask "kya ho gaya?" or expect an immediate reply. Keep it light and self-contained — they'll respond when free.`);
      }

      if (ctx.behaviorPattern) {
        lines.push(`- 📊 BEHAVIOR PATTERN: ${ctx.behaviorPattern}`);
      }
    }

    // ── Read state of Nova's own messages (seen vs unseen) ──
    if (typeof ctx.unreadNovaMessages === 'number' && ctx.unreadNovaMessages > 0) {
      lines.push(`- 📬 READ STATE: The user has NOT yet seen ${ctx.unreadNovaMessages} of your recent message(s). Don't assume they read your last message — if you're reconnecting, briefly ground them in context instead of continuing a thread they never saw.`);
    }

    // ── User Availability Signal ──
    if (ctx.lastUserMessage) {
      const availability = this.detectAvailability(ctx.lastUserMessage);
      if (availability === 'busy') {
        lines.push(`- ⚠️ USER AVAILABILITY: User signalled they are BUSY or unavailable. DO NOT push conversation. Respond with warmth but keep it short. If they reached out now, acknowledge the gap casually — don't interrogate.`);
      } else if (availability === 'excited') {
        lines.push(`- ✨ USER ENERGY: User is excited or in a great mood. Match their energy! Be enthusiastic, lean in, ask follow-up questions.`);
      } else if (availability === 'relationship') {
        lines.push(`- 💬 RELATIONSHIP SIGNAL: User is talking about someone they're interested in or a romantic situation. This is GOLD — lean in gently, ask curious questions, be their friend who actually wants to know what's happening. Store details carefully in memory.`);
      }
    }

    // ── Emotional Context ──
    if (ctx.latestEmotion) {
      lines.push(`- Last known mood: ${ctx.latestEmotion.mood} (intensity ${ctx.latestEmotion.intensity}/10). ${ctx.latestEmotion.notes}`);
      lines.push(`- Emotional guidance: ${this.getEmotionalGuidance(ctx.latestEmotion)}`);
      
      // Emotional Carry-over for long gaps
      if (ctx.gapMinutes !== null && ctx.gapMinutes > 8 * 60 && ctx.latestEmotion.intensity >= 7) {
        const isNegative = ['sad', 'depressed', 'dukhi', 'upset', 'down', 'angry', 'frustrated', 'anxious'].some(m => ctx.latestEmotion!.mood.toLowerCase().includes(m));
        if (isNegative) {
          lines.push(`- ⚠️ CRITICAL EMOTIONAL CARRY-OVER: The user was feeling very negative (${ctx.latestEmotion.mood}) the last time you spoke. Before saying anything else, genuinely check in on how they are feeling about it now.`);
        } else {
          lines.push(`- ✨ EMOTIONAL CARRY-OVER: The user was feeling highly positive (${ctx.latestEmotion.mood}) last time. Ask them if they are still riding that high before changing the topic!`);
        }
      }
    }

    // ── Recent Life Events ──
    if (ctx.recentEpisodes.length > 0) {
      lines.push(`- Recent life events (use these as conversation hooks, not content to dump):`);
      for (const ep of ctx.recentEpisodes.slice(0, 3)) {
        const emotionTag = ep.emotion ? ` [${ep.emotion}]` : '';
        lines.push(`  • ${ep.summary}${emotionTag}`);
      }
    }

    // ── Daily Reflection ──
    if (ctx.latestReflection) {
      lines.push(`- Yesterday's summary: ${ctx.latestReflection.summary}`);
    }

    // ── Reply Intent ──
    if (ctx.replyToContent) {
      lines.push(`- 💬 REPLY INTENT: User is directly replying to Nova's previous message: "${ctx.replyToContent}". This is NOT a new topic. Stay focused on what Nova said before and react to their reply.`);
    }

    // ── Conversation Phase ──
    if (ctx.last5Messages && ctx.last5Messages.length > 0 && ctx.gapMinutes !== null) {
      const phase = this.detectConversationPhase(ctx.last5Messages, ctx.gapMinutes);
      lines.push(`- 🔄 CONVERSATION PHASE: ${phase}`);
    }

    // ── Emotional Momentum ──
    if (ctx.last3UserEmotions && ctx.last3UserEmotions.length > 0) {
      const momentum = this.detectEmotionalMomentum(ctx.last3UserEmotions);
      if (momentum) lines.push(`- 📈 EMOTIONAL MOMENTUM: ${momentum}`);
    }

    // ── Life-State Synthesis ──
    const recentEp = ctx.recentEpisodes && ctx.recentEpisodes.length > 0 ? ctx.recentEpisodes[0] : null;
    const lifeState = this.buildLifeStateContext(
      ctx.latestEmotion || null,
      ctx.goalMemories || [],
      recentEp,
      ctx.latestReflection || null
    );
    if (lifeState) {
      lines.push(lifeState);
    }

    // ── Jarvis Reminder Mode ──
    if (ctx.upcomingReminders && ctx.upcomingReminders.length > 0) {
      const nowMs = ctx.nowLocal.getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      const soonReminders = ctx.upcomingReminders.filter(r => {
        if (!r.trigger_at) return false; // event-triggered — no fixed time to preview
        const remMs = new Date(r.trigger_at).getTime();
        return remMs > nowMs && remMs - nowMs < twoHoursMs;
      });
      if (soonReminders.length > 0) {
        if (ctx.isWeekend) {
          lines.push(`- 🔔 JARVIS MODE (WEEKEND): These reminders are coming up in the next 2 hours: ${soonReminders.map(r => r.title).join(', ')}. Since it's their weekoff, gently ask if they still want to do this or if they want to skip it for today. Don't push them to do work.`);
        } else {
          lines.push(`- 🔔 JARVIS MODE: These reminders are coming up in the next 2 hours: ${soonReminders.map(r => r.title).join(', ')}. If relevant to conversation, naturally weave in a heads-up. Don't be a robot about it — mention it like a friend who remembered.`);
        }
      }
    }

    // ── Nova's Curiosity Hooks ──
    lines.push(``);
    lines.push(`## NOVA'S INTERNAL DIRECTIVE`);
    lines.push(`You are a virtual best friend who genuinely lives alongside this user. Your job is not just to answer — it is to KNOW this person deeply.`);
    lines.push(`- When the conversation is flowing, subtly explore one life domain: relationships, career, finance, health, goals, or entertainment.`);
    lines.push(`- Do not ask multiple questions at once. One curious question, naturally woven in.`);
    lines.push(`- If user mentioned something in memory (a person's name, a goal, an event) — reference it organically when the moment is right.`);
    lines.push(`- Use this brief as YOUR internal compass. DO NOT narrate this brief or acknowledge that you have it.`);
    lines.push(`- NEVER say "I understand you're busy" or "I can see you're feeling X". Just respond accordingly.`);
    lines.push(`- If something is unclear — ask ONE direct question upfront. Do not guess and pretend to understand.`);

    return lines.join('\n');
  }

  detectAvailability(message: string): 'busy' | 'excited' | 'relationship' | 'neutral' {
    const lower = message.toLowerCase();
    
    // Check for explicit timeframe (e.g. "20 mins", "30 mins", "2 hours")
    if (/\b\d+\s*(min|mins|minute|minutes|hr|hrs|hour|hours)\b/i.test(lower)) return 'busy';

    if (BUSY_SIGNALS.some(s => lower.includes(s))) return 'busy';
    if (RELATIONSHIP_SIGNALS.some(s => lower.includes(s))) return 'relationship';
    if (EXCITED_SIGNALS.some(s => lower.includes(s))) return 'excited';
    return 'neutral';
  }

  private getTimeOfDay(now: Date): string {
    const hour = now.getUTCHours();
    if (hour >= 5 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 17) return 'Afternoon';
    if (hour >= 17 && hour < 21) return 'Evening';
    return 'Late Night';
  }

  private getTimedPersona(now: Date, isWeekend: boolean): string {
    const hour = now.getUTCHours();
    if (hour >= 0 && hour < 5) return 'It\'s very late / early. User might be having trouble sleeping, studying late, or unwinding. Be low-key, warm, and chill. Don\'t be hyper.';
    if (hour >= 5 && hour < 9) return `Early morning${isWeekend ? ' on weekend' : ''}. ${isWeekend ? 'Might be early riser or insomnia. Casual check-in.' : 'Keep it snappy.'}`;
    if (hour >= 9 && hour < 12) return `${isWeekend ? 'Weekend morning' : 'Weekday morning'}. ${isWeekend ? 'Relaxed mode. They might be free.' : 'They might be busy with their day. Don\'t distract unnecessarily.'}`;
    if (hour >= 12 && hour < 14) return 'Lunch time / Mid-day. Good time for a casual conversation.';
    if (hour >= 14 && hour < 17) return `${isWeekend ? 'Weekend afternoon' : 'Weekday afternoon'}. ${isWeekend ? 'Might be chilling, watching something, out with someone.' : 'Keep responses helpful and respect their time if they are busy.'}`;
    if (hour >= 17 && hour < 20) return `Evening — winding down from the day. ${isWeekend ? 'Evening plans likely.' : 'Most open to chatting now.'}`;
    if (hour >= 20 && hour < 23) return 'Night — prime conversation time. User is relaxed. Best time to have deeper conversations.';
    return 'Late night — likely tired. Keep it light.';
  }

  /**
   * Human-readable "last active X ago" from a user_presence.last_active_at timestamp.
   */
  private describeLastActive(lastActiveAt: string, now: Date): string {
    const diffMs = now.getTime() - new Date(lastActiveAt).getTime();
    if (isNaN(diffMs) || diffMs < 0) return 'just now';
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  private describeGap(gapMinutes: number): string {
    if (gapMinutes < 2) return 'Just now — user is actively chatting';
    if (gapMinutes < 30) return `${Math.round(gapMinutes)} minutes ago (short break)`;
    if (gapMinutes < 60) return `${Math.round(gapMinutes)} minutes ago (medium break)`;
    const hours = Math.round(gapMinutes / 60);
    if (hours < 4) return `${hours}h ago — user was busy for a bit`;
    if (hours < 12) return `${hours}h ago — significant gap, user had a day/activity`;
    if (hours < 24) return `${hours}h ago — user hasn't messaged since earlier today or last night`;
    const days = Math.round(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago — user has been away a long time`;
  }

  private getGreetingStrategy(gapMinutes: number, now: Date): string {
    const hour = now.getUTCHours();
    if (gapMinutes < 2) return 'Continue naturally. Zero greeting.';
    if (gapMinutes < 30) return 'Pick up where you left off. No greeting.';
    if (gapMinutes < 120) return 'Brief acknowledgment is fine, but don\'t over-greet.';
    if (hour >= 5 && hour < 12) return 'Long gap + morning. Greet with "good morning" energy — casual and warm.';
    if (hour >= 12 && hour < 17) return 'Long gap + afternoon. Ask how their day is going naturally.';
    if (hour >= 17 && hour < 21) return 'Long gap + evening. Reference their day or what they might be up to.';
    return 'Long gap + late night. Be warm and low-key — they might be tired or reflective.';
  }

  private getEmotionalGuidance(emotion: { mood: string; intensity: number }): string {
    const { mood, intensity } = emotion;
    const low = mood.toLowerCase();
    if (['sad', 'depressed', 'dukhi', 'upset', 'down'].some(m => low.includes(m)))
      return intensity > 6 ? 'User was feeling quite down. Be extra gentle, don\'t push conversation.' : 'User was a bit low. Be warm, don\'t force positivity.';
    if (['angry', 'frustrated', 'irritated', 'annoyed'].some(m => low.includes(m)))
      return 'User was frustrated. Acknowledge feelings without dismissing. Don\'t lecture.';
    if (['happy', 'excited', 'khush', 'glad', 'thrilled'].some(m => low.includes(m)))
      return 'User was in great mood! Match their energy — be enthusiastic and curious.';
    if (['tired', 'sleepy', 'exhausted', 'thaka'].some(m => low.includes(m)))
      return 'User was tired. Be gentle, short responses. Don\'t overwhelm.';
    if (['anxious', 'nervous', 'worried', 'tense'].some(m => low.includes(m)))
      return 'User was anxious. Be calming, reassuring, grounding.';
    return 'Neutral mood. Respond naturally.';
  }

  detectConversationPhase(last5Messages: { role: string; content: string; created_at: string }[], gapMinutes: number): string {
    if (gapMinutes > 60 && last5Messages[0]?.role === 'user') {
      return 'OPENING — user just returned after a gap. Acknowledge return naturally, greet if appropriate.';
    }
    
    if (gapMinutes < 5) {
      const recentUserMsg = last5Messages[0]?.content?.toLowerCase() || '';
      if (['gn', 'bye', 'goodnight', 'ttyl', 'cya', 'ok bye'].some(w => recentUserMsg.includes(w))) {
        return 'WINDING_DOWN — user is trying to end the chat. Say goodbye gracefully, do NOT start new topics or ask questions.';
      }
      return 'FLOWING — active back-and-forth. Keep it natural, match their pace, do NOT greet again.';
    }

    // Single message after a medium gap
    if (gapMinutes > 30 && last5Messages.length >= 1) {
      return 'RE-ENTRY — user dropped a message after being quiet. Do NOT pick up the old thread like no time passed. Start fresh from this new context.';
    }

    return 'UNKNOWN — respond naturally to the latest context.';
  }

  detectEmotionalMomentum(emotions: { mood: string; intensity: number }[]): string | null {
    if (emotions.length < 2) return null;
    
    // Simplistic heuristic for demo
    const latest = emotions[0];
    const previous = emotions[1];
    
    const isNegative = (mood: string) => ['sad', 'angry', 'frustrated', 'depressed', 'anxious'].some(m => mood.toLowerCase().includes(m));
    const isPositive = (mood: string) => ['happy', 'excited', 'joy', 'thrilled', 'good'].some(m => mood.toLowerCase().includes(m));

    if (isNegative(latest.mood) && isNegative(previous.mood) && latest.intensity > previous.intensity) {
      return 'DECLINING — user is getting more stressed/upset. Slow down, ask ONE caring question, be highly supportive.';
    }
    if (isPositive(latest.mood) && isPositive(previous.mood) && latest.intensity > previous.intensity) {
      return 'RISING — user is getting more excited/happy! Match the energy, amplify positivity.';
    }
    if (latest.intensity < 4 && previous.intensity < 4) {
      return 'FLAT — conversation is low energy ("ok", "hmm"). Good time to introduce a new topic from memory or ask a curious question.';
    }

    return null;
  }

  buildLifeStateContext(
    latestEmotion: { mood: string; intensity: number; notes: string } | null,
    goalMemories: { key: string; value: string }[],
    recentEpisode: { summary: string; emotion: string | null; created_at?: string } | null,
    latestReflection: { summary: string; key_takeaways: any } | null
  ): string {
    const parts: string[] = [];

    if (latestEmotion && goalMemories && goalMemories.length > 0) {
      const topGoal = goalMemories[0].value;
      const mood = latestEmotion.mood;
      const intensity = latestEmotion.intensity;
      parts.push(
        `🔗 LIFE-STATE COHERENCE: User is currently feeling "${mood}" (intensity ${intensity}/10). ` +
        `Their active goal is "${topGoal}". ` +
        `When relevant, BRIDGE this emotion to their goal — e.g., validate the emotional load of pursuing this goal.`
      );
    }

    if (recentEpisode) {
      parts.push(`📖 Recent life event: "${recentEpisode.summary}" [${recentEpisode.emotion || 'neutral'}] — reference this naturally if relevant.`);
    }

    if (latestReflection?.key_takeaways) {
      const takeaways = Array.isArray(latestReflection.key_takeaways)
        ? latestReflection.key_takeaways.slice(0, 2).join('; ')
        : String(latestReflection.key_takeaways).slice(0, 200);
      parts.push(`💡 Yesterday's reflection insight: ${takeaways}`);
    }

    return parts.length > 0 ? '\n## 🔗 LIFE STATE SYNTHESIS\n' + parts.join('\n') : '';
  }
}

export const situationalAwareness = new SituationalAwareness();
