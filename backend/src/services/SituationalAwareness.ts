/**
 * Situational Awareness Engine for Nova.
 * 
 * Before every LLM call, this module synthesizes all available context
 * into a single, human-readable "situation brief" that tells the LLM
 * exactly what's happening right now in the user's life.
 * 
 * This replaces the old approach of dumping raw datetime and memory lists
 * and hoping the model figures out the situation.
 */

export interface SituationContext {
  /** Current local time for the user */
  nowLocal: Date;
  /** Timezone label (e.g., 'IST') */
  tzLabel: string;
  /** Country code */
  country: string;
  /** Minutes since the user's last message (null if first message ever) */
  gapMinutes: number | null;
  /** Latest emotional state from the EmotionalAgent */
  latestEmotion: { mood: string; intensity: number; notes: string } | null;
  /** Recent episodic memories (life events) */
  recentEpisodes: { summary: string; emotion: string | null; created_at: string }[];
  /** Latest daily reflection */
  latestReflection: { summary: string; key_takeaways: any } | null;
  /** Whether it's a weekend */
  isWeekend: boolean;
  /** Day name */
  dayName: string;
  /** Date string */
  dateStr: string;
  /** Time string */
  timeStr: string;
}

export class SituationalAwareness {

  /**
   * Builds a human-readable situation brief from all available context.
   */
  buildBrief(ctx: SituationContext): string {
    const lines: string[] = [];

    // ── Time & Day ──
    lines.push(`## SITUATION BRIEF — Your understanding of this moment`);
    lines.push(`- Right now: ${ctx.dayName}, ${ctx.dateStr}, ${ctx.timeStr} ${ctx.tzLabel} (${ctx.isWeekend ? 'Weekend' : 'Weekday'})`);
    lines.push(`- Time of day: ${this.getTimeOfDay(ctx.nowLocal)}`);

    // ── Message Gap Intelligence ──
    if (ctx.gapMinutes !== null) {
      lines.push(`- Last contact: ${this.describeGap(ctx.gapMinutes)}`);
      lines.push(`- Greeting strategy: ${this.getGreetingStrategy(ctx.gapMinutes, ctx.nowLocal)}`);
    } else {
      lines.push(`- Last contact: This appears to be the user's first message. Greet them warmly!`);
    }

    // ── Emotional Context ──
    if (ctx.latestEmotion) {
      lines.push(`- User's last known mood: ${ctx.latestEmotion.mood} (intensity: ${ctx.latestEmotion.intensity}/10). ${ctx.latestEmotion.notes}`);
      lines.push(`- Emotional guidance: ${this.getEmotionalGuidance(ctx.latestEmotion)}`);
    }

    // ── Recent Life Events ──
    if (ctx.recentEpisodes.length > 0) {
      lines.push(`- Recent life events:`);
      for (const ep of ctx.recentEpisodes.slice(0, 3)) {
        const emotionTag = ep.emotion ? ` [${ep.emotion}]` : '';
        lines.push(`  • ${ep.summary}${emotionTag}`);
      }
    }

    // ── Daily Reflection ──
    if (ctx.latestReflection) {
      lines.push(`- Yesterday's summary: ${ctx.latestReflection.summary}`);
    }

    // ── Final Instruction ──
    lines.push('');
    lines.push(`CRITICAL: Use this brief to guide your emotional tone, topic choice, and greeting style.`);
    lines.push(`- If the user has been away for hours, greet them warmly and reference what they might have been doing.`);
    lines.push(`- If the gap is just minutes, continue the conversation flow naturally. Do NOT greet or say "welcome back".`);
    lines.push(`- Match your energy to their last known emotional state.`);
    lines.push(`- This brief is YOUR internal understanding. Do NOT dump this information into your response.`);

    return lines.join('\n');
  }

  private getTimeOfDay(now: Date): string {
    const hour = now.getUTCHours();
    if (hour >= 5 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 17) return 'Afternoon';
    if (hour >= 17 && hour < 21) return 'Evening';
    return 'Night (late)';
  }

  private describeGap(gapMinutes: number): string {
    if (gapMinutes < 2) return 'Just now (user is actively chatting)';
    if (gapMinutes < 30) return `${Math.round(gapMinutes)} minutes ago (short break)`;
    if (gapMinutes < 60) return `${Math.round(gapMinutes)} minutes ago (medium break)`;
    const hours = Math.round(gapMinutes / 60);
    if (hours < 4) return `${hours} hour${hours > 1 ? 's' : ''} ago (user was busy for a while)`;
    if (hours < 12) return `${hours} hours ago (user likely had a significant activity — sleep, work, outing)`;
    if (hours < 24) return `${hours} hours ago (user hasn't messaged since earlier today or last night)`;
    const days = Math.round(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago (user has been away for a long time)`;
  }

  private getGreetingStrategy(gapMinutes: number, now: Date): string {
    const hour = now.getUTCHours();

    if (gapMinutes < 2) return 'Continue naturally. No greeting needed.';
    if (gapMinutes < 30) return 'Short break. Pick up where you left off. No greeting needed.';
    if (gapMinutes < 120) return 'Medium gap. A brief acknowledgment is fine, but don\'t over-greet.';
    
    // Long gap — context-aware greeting
    if (hour >= 5 && hour < 12) {
      return 'Long gap + morning. User probably slept. Greet with a casual "good morning" energy.';
    }
    if (hour >= 12 && hour < 17) {
      return 'Long gap + afternoon. User was likely at work or busy. Ask how their day is going.';
    }
    if (hour >= 17 && hour < 21) {
      return 'Long gap + evening. User is winding down. Reference their day or plans.';
    }
    return 'Long gap + late night. User might be unwinding or can\'t sleep. Be warm and chill.';
  }

  private getEmotionalGuidance(emotion: { mood: string; intensity: number }): string {
    const { mood, intensity } = emotion;
    const low = mood.toLowerCase();

    if (['sad', 'depressed', 'dukhi', 'upset', 'down'].some(m => low.includes(m))) {
      return intensity > 6 
        ? 'User was feeling quite down. Be extra gentle and supportive.'
        : 'User was a bit low. Be warm but don\'t force positivity.';
    }
    if (['angry', 'frustrated', 'irritated', 'annoyed'].some(m => low.includes(m))) {
      return 'User was frustrated. Acknowledge their feelings without dismissing them.';
    }
    if (['happy', 'excited', 'khush', 'glad'].some(m => low.includes(m))) {
      return 'User was in a good mood! Match their energy and be enthusiastic.';
    }
    if (['tired', 'sleepy', 'exhausted', 'thaka'].some(m => low.includes(m))) {
      return 'User was tired. Be gentle and don\'t overwhelm them with energy.';
    }
    if (['anxious', 'nervous', 'worried', 'tense'].some(m => low.includes(m))) {
      return 'User was anxious. Be calming and reassuring.';
    }
    return 'Neutral mood. Respond naturally.';
  }
}

export const situationalAwareness = new SituationalAwareness();
