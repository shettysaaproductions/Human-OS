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
  latestReflection: { summary: string; key_takeaways: any } | null;
  isWeekend: boolean;
  dayName: string;
  dateStr: string;
  timeStr: string;
  lastUserMessage?: string; // The most recent user message text (for availability detection)
  upcomingReminders?: { title: string; scheduled_at: string }[]; // Jarvis mode
}

// Social signal patterns — user is signalling they are busy/unavailable
const BUSY_SIGNALS = [
  'busy', 'not now', 'later', 'baad mein', 'baad me', 'abhi nahi', 'kuch time de',
  'thodi der mein', 'call kar raha hoon', 'meeting mein', 'kaam kar raha',
  'gotta go', 'gtg', 'ttyl', 'talk later', 'in a bit', 'brb', 'occupied',
  'driving', 'gym', 'khana kha raha', 'so raha', 'neend aa rahi', 'kal baat',
  'kal karte', 'not feeling', 'not in mood', 'mood nahi', 'thaka hua', 'rest kar raha'
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

    lines.push(`## SITUATION BRIEF — Nova's Internal Understanding`);
    lines.push(`- Right now: ${ctx.dayName}, ${ctx.dateStr}, ${ctx.timeStr} ${ctx.tzLabel} (${ctx.isWeekend ? 'Weekend' : 'Weekday'})`);
    lines.push(`- Time of day: ${this.getTimeOfDay(ctx.nowLocal)}`);
    lines.push(`- Time-based persona: ${this.getTimedPersona(ctx.nowLocal, ctx.isWeekend)}`);

    // ── Message Gap ──
    if (ctx.gapMinutes !== null) {
      lines.push(`- Last contact: ${this.describeGap(ctx.gapMinutes)}`);
      lines.push(`- Greeting strategy: ${this.getGreetingStrategy(ctx.gapMinutes, ctx.nowLocal)}`);
      // Hard-lock stale context when gap is significant
      if (ctx.gapMinutes > 1440) { // > 24 hours
        lines.push(`- ⛔ CONTEXT HARD STOP: It has been over 24 hours since last message. The previous conversation thread is CLOSED. Do NOT reference or continue it. Open fresh with something relevant to RIGHT NOW — current time, day, what they are likely doing.`);
      } else if (ctx.gapMinutes > 360) { // > 6 hours
        lines.push(`- ⚠️ STALE CONTEXT WARNING: ${Math.round(ctx.gapMinutes / 60)}h gap. Previous topic is likely stale. Start from the current moment — don't pick up mid-thread.`);
      }
    } else {
      lines.push(`- Last contact: First message ever. Greet warmly, introduce yourself naturally.`);
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

    // ── Jarvis Reminder Mode ──
    if (ctx.upcomingReminders && ctx.upcomingReminders.length > 0) {
      const nowMs = ctx.nowLocal.getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      const soonReminders = ctx.upcomingReminders.filter(r => {
        const remMs = new Date(r.scheduled_at).getTime();
        return remMs > nowMs && remMs - nowMs < twoHoursMs;
      });
      if (soonReminders.length > 0) {
        lines.push(`- 🔔 JARVIS MODE: These reminders are coming up in the next 2 hours: ${soonReminders.map(r => r.title).join(', ')}. If relevant to conversation, naturally weave in a heads-up. Don't be a robot about it — mention it like a friend who remembered.`);
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
    if (hour >= 5 && hour < 9) return `Early morning${isWeekend ? ' on weekend' : ''}. ${isWeekend ? 'Might be early riser or insomnia. Casual check-in.' : 'Probably getting ready for work/college. Keep it snappy.'}`;
    if (hour >= 9 && hour < 12) return `${isWeekend ? 'Weekend morning' : 'Work hours morning'}. ${isWeekend ? 'Relaxed mode. They might be free.' : 'Mid-work/study. Don\'t distract unnecessarily.'}`;
    if (hour >= 12 && hour < 14) return 'Lunch break — likely a short break. Good time for a casual conversation.';
    if (hour >= 14 && hour < 17) return `${isWeekend ? 'Weekend afternoon' : 'Afternoon at work/college'}. ${isWeekend ? 'Might be chilling, watching something, out with someone.' : 'Productive hours — keep responses helpful.'}`;
    if (hour >= 17 && hour < 20) return `Evening — winding down from the day. ${isWeekend ? 'Evening plans likely.' : 'After work/college. Most open to chatting now.'}`;
    if (hour >= 20 && hour < 23) return 'Night — prime conversation time. User is relaxed. Best time to have deeper conversations.';
    return 'Late night — likely tired. Keep it light.';
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
}

export const situationalAwareness = new SituationalAwareness();
