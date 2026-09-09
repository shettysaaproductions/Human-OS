/**
 * ReminderIntentDetector.ts — High-Precision Natural Reminder Parsing & Scheduling Engine
 *
 * Designed to accurately detect and schedule reminders across English, Hindi, and Hinglish:
 * e.g.:
 * - "Kal muje afternoon me 1 bJe yaad dilao na PF ke lie bank details update karna hai muje uske portal pe"
 * - "Diya tha nai muje kal sube remind karo yaad se"
 * - "remind me in 15 minutes to take medicine"
 * - "parso shaam 6 baje call karna hai yaad dila dena"
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface ReminderDetectionResult {
  detected: boolean;
  scheduled: boolean;
  reminder?: any;
  note?: string;
  task?: string;
  triggerAt?: Date;
  formattedTime?: string;
}

export class ReminderIntentDetector {
  private static instance: ReminderIntentDetector;

  static getInstance(): ReminderIntentDetector {
    if (!ReminderIntentDetector.instance) {
      ReminderIntentDetector.instance = new ReminderIntentDetector();
    }
    return ReminderIntentDetector.instance;
  }

  /**
   * Fast pre-check: does the message contain reminder intent keywords?
   */
  hasReminderIntent(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    const lower = text.toLowerCase();

    // Negative triggers: user explicitly saying do not remind
    if (/\b(?:don'?t|dont|not|mat)\s*(?:remind|yaad\s*(?:dilana|dila|karna|rakhna))\b/i.test(lower)) {
      return false;
    }
    if (/\b(?:remind|yaad)\s*mat\s*(?:karna|karo|dilana|dilao)\b/i.test(lower)) {
      return false;
    }

    // Positive triggers
    return /\b(yaad\s*(?:dilao|dilana|dila\s*dena|dila|kara|kar\s*dena|se\s*remind|dena|karna|rakhna)|remind\s*(?:me|karo|karna|kar|dena|karen)|reminder\s*(?:set|lagao|karo|banao)|alarm\s*(?:lagao|set|karo)|schedule\s*karo)\b/i.test(lower);
  }

  /**
   * Deterministically parses time, date, and task from the user's message.
   */
  parseReminderDetails(
    text: string,
    tzOffsetHours: number = 5.5
  ): {
    title: string;
    triggerAt: Date | null;
    isAmbiguous: boolean;
    formattedTime?: string;
  } {
    const lower = text.toLowerCase();

    // ── 1. Relative Duration: "in 15 minutes", "10 min me", "aadhe ghante me", "1 ghante baad"
    const relMinMatch = lower.match(/\b(?:in\s+)?(\d+)\s*(?:mins?|minutes?|minut|minute)\b(?:\s*(?:me|mein|baad|after))?/i);
    if (relMinMatch) {
      const mins = parseInt(relMinMatch[1], 10);
      const triggerAt = new Date(Date.now() + mins * 60 * 1000);
      const title = this.cleanTaskTitle(text);
      return {
        title,
        triggerAt,
        isAmbiguous: false,
        formattedTime: `in ${mins} minutes`
      };
    }

    const relHalfHrMatch = lower.match(/\b(?:aadhe|aadha|half)\s*(?:ghante?|hour)\b(?:\s*(?:me|mein|baad|after))?/i);
    if (relHalfHrMatch) {
      const triggerAt = new Date(Date.now() + 30 * 60 * 1000);
      const title = this.cleanTaskTitle(text);
      return {
        title,
        triggerAt,
        isAmbiguous: false,
        formattedTime: 'in 30 minutes'
      };
    }

    const relHrMatch = lower.match(/\b(?:in\s+)?(\d+)\s*(?:hours?|hrs?|ghante?)\b(?:\s*(?:me|mein|baad|after))?/i);
    if (relHrMatch) {
      const hrs = parseInt(relHrMatch[1], 10);
      const triggerAt = new Date(Date.now() + hrs * 3600 * 1000);
      const title = this.cleanTaskTitle(text);
      return {
        title,
        triggerAt,
        isAmbiguous: false,
        formattedTime: `in ${hrs} hour${hrs > 1 ? 's' : ''}`
      };
    }

    // ── 2. Determine Target Date
    // Current local time
    const nowLocal = new Date(Date.now() + tzOffsetHours * 3600 * 1000);
    let targetYear = nowLocal.getUTCFullYear();
    let targetMonth = nowLocal.getUTCMonth();
    let targetDay = nowLocal.getUTCDate();
    let dateIdentified = false;
    let dateLabel = 'Today';

    if (/\b(?:parso|tarso|day\s*after\s*tomorrow)\b/i.test(lower)) {
      targetDay += 2;
      dateIdentified = true;
      dateLabel = 'Day after tomorrow';
    } else if (/\b(?:kal|tomorrow)\b/i.test(lower)) {
      targetDay += 1;
      dateIdentified = true;
      dateLabel = 'Tomorrow';
    } else if (/\b(?:aaj|today|tonight)\b/i.test(lower)) {
      dateIdentified = true;
      dateLabel = 'Today';
    }

    // ── 3. Determine Period (Morning / Afternoon / Evening / Night)
    const isMorning = /\b(?:subah|sube|sawere|savere|morning|am)\b/i.test(lower);
    const isAfternoon = /\b(?:dopahar|dupeher|afternoon)\b/i.test(lower);
    const isEvening = /\b(?:shaam|sham|sanjh|evening)\b/i.test(lower);
    const isNight = /\b(?:raat|night)\b/i.test(lower);
    const isPM = /\bpm\b/i.test(lower) || isAfternoon || isEvening;

    // ── 4. Extract Explicit Numeric Time
    // Matches: "1 bJe", "1 baje", "1:00", "1pm", "13:00", "at 4", "10:30 am", etc.
    let hour: number | null = null;
    let minute: number = 0;

    const timePatterns = [
      // "1:30 pm" or "13:00"
      /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i,
      // "1 bje" or "1 baje" or "1 bJe"
      /\b(\d{1,2})\s*(?:bje|baje|bJe)\b/i,
      // "1 pm" or "1 am"
      /\b(\d{1,2})\s*(am|pm)\b/i,
      // "at 4"
      /\bat\s+(\d{1,2})\b/i
    ];

    for (const pat of timePatterns) {
      const match = lower.match(pat);
      if (match) {
        hour = parseInt(match[1], 10);
        if (match[2] && /^\d{2}$/.test(match[2])) {
          minute = parseInt(match[2], 10);
        }
        if (match[3] && match[3].toLowerCase() === 'pm') {
          if (hour < 12) hour += 12;
        } else if (match[3] && match[3].toLowerCase() === 'am') {
          if (hour === 12) hour = 0;
        }
        break;
      }
    }

    // If explicit hour found, adjust for period
    if (hour !== null) {
      if (hour >= 1 && hour <= 12) {
        if (isAfternoon || isEvening || isPM) {
          if (hour < 12) hour += 12;
        } else if (isNight) {
          if (hour >= 7 && hour <= 11) hour += 12;
          else if (hour === 12) hour = 0;
        } else if (isMorning) {
          if (hour === 12) hour = 0;
        } else {
          // Defaults for 1..6 without explicit AM: almost universally PM in reminder context
          if (hour >= 1 && hour <= 6) {
            hour += 12;
          }
        }
      }
    } else {
      // Vague period defaults if no explicit hour was specified (e.g. "kal sube", "kal afternoon")
      if (isMorning) {
        hour = 9;
        minute = 0;
      } else if (isAfternoon) {
        hour = 14;
        minute = 0;
      } else if (isEvening) {
        hour = 18;
        minute = 0;
      } else if (isNight) {
        hour = 21;
        minute = 0;
      }
    }

    if (hour === null) {
      // Intent was detected but time is completely missing
      const title = this.cleanTaskTitle(text);
      return {
        title,
        triggerAt: null,
        isAmbiguous: true
      };
    }

    // Build local target date
    const targetLocal = new Date(Date.UTC(targetYear, targetMonth, targetDay, hour, minute, 0, 0));

    // If target is today and the time has already passed, push to tomorrow
    if (!dateIdentified && targetLocal.getTime() <= nowLocal.getTime()) {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      dateLabel = 'Tomorrow';
    }

    // Convert local time back to UTC timestamp
    const triggerAt = new Date(targetLocal.getTime() - tzOffsetHours * 3600 * 1000);
    const title = this.cleanTaskTitle(text);

    const hh12 = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const timeFormatted = `${hh12}:${minute.toString().padStart(2, '0')} ${ampm}`;
    const formattedTime = `${dateLabel} at ${timeFormatted}`;

    return {
      title,
      triggerAt,
      isAmbiguous: false,
      formattedTime
    };
  }

  /**
   * Cleans reminder filler keywords and temporal expressions to leave the core task.
   */
  cleanTaskTitle(text: string): string {
    let clean = text
      .replace(/\b(?:kal|aaj|parso|tomorrow|today|tonight)\b/gi, '')
      .replace(/\b(?:subah|sube|sawere|savere|morning|afternoon|dopahar|dupeher|shaam|sham|evening|raat|night)\b/gi, '')
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:bje|baje|bJe|am|pm)?\b/gi, '')
      .replace(/\b(?:in\s+\d+\s*(?:mins?|minutes?|hours?)|aadhe\s*ghante\s*me)\b/gi, '')
      .replace(/\b(?:yaad\s*(?:dilao|dilana|dila\s*dena|dila|kara|kar\s*dena|se\s*remind|dena|karna|rakhna)|remind\s*(?:me|karo|karna|kar|dena)|reminder\s*(?:set|lagao|karo)|alarm\s*(?:lagao|set)|schedule\s*karo)\b/gi, '')
      .replace(/\b(?:na|yaad\s*se|muje|mujhe|tum|mera|meri|apna|apne|bata\s*dena|bhi)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!clean || clean.length < 3) {
      // Fallback: strip just the trigger words
      clean = text
        .replace(/\b(?:yaad\s*(?:dilao|dilana|dila\s*dena|dila|kara|kar\s*dena)|remind\s*(?:me|karo|karna))\b/gi, '')
        .trim();
    }

    return clean.slice(0, 120) || 'Reminder';
  }

  /**
   * Synchronously detects, parses, and persists a reminder into the database.
   */
  async detectAndSchedule(
    userId: string,
    message: string,
    country: string = 'IN'
  ): Promise<ReminderDetectionResult> {
    if (!this.hasReminderIntent(message)) {
      return { detected: false, scheduled: false };
    }

    // Determine user timezone offset
    let tzOffsetHours = country === 'IN' ? 5.5 : 5.5;
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('timezone_offset, country')
        .eq('id', userId)
        .maybeSingle();

      if (profile?.timezone_offset !== undefined && profile?.timezone_offset !== null) {
        tzOffsetHours = Number(profile.timezone_offset);
      }
    } catch {
      // Fall back to default
    }

    const parsed = this.parseReminderDetails(message, tzOffsetHours);

    if (parsed.isAmbiguous || !parsed.triggerAt) {
      return {
        detected: true,
        scheduled: false,
        task: parsed.title,
        note: `REMINDER_INTENT_DETECTED_BUT_TIME_AMBIGUOUS: The user asked to be reminded for "${parsed.title}", but the time was unclear. Ask them ONCE nicely: "Kab remind karna hai? (What time should I remind you?)". Do not guess a time.`
      };
    }

    // Check for existing active reminder to prevent duplicates
    try {
      const tenMinutesMs = 10 * 60 * 1000;
      const targetTimeMs = parsed.triggerAt.getTime();
      const minIso = new Date(targetTimeMs - tenMinutesMs).toISOString();
      const maxIso = new Date(targetTimeMs + tenMinutesMs).toISOString();

      const { data: existingRows } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gte('trigger_at', minIso)
        .lte('trigger_at', maxIso);

      if (existingRows && existingRows.length > 0) {
        const existing = existingRows[0];
        logger.info('[ReminderIntentDetector] Found existing equivalent reminder, reusing', {
          userId,
          reminderId: existing.id
        });

        return {
          detected: true,
          scheduled: true,
          reminder: existing,
          task: parsed.title,
          triggerAt: parsed.triggerAt,
          formattedTime: parsed.formattedTime,
          note: `REMINDER_ALREADY_PERSISTED: A reminder for "${parsed.title}" is scheduled for ${parsed.formattedTime}. Reassure the user warmly that you have noted it and will remind them at that time. NEVER say they set it in the past.`
        };
      }

      // Insert new active reminder
      const { data: inserted, error } = await supabaseAdmin
        .from('reminders')
        .insert({
          user_id: userId,
          text: parsed.title,
          trigger_at: parsed.triggerAt.toISOString(),
          status: 'active',
          is_auto: false,
          created_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (error) {
        logger.error('[ReminderIntentDetector] Failed to insert reminder', { error: error.message });
        return {
          detected: true,
          scheduled: false,
          task: parsed.title,
          note: `REMINDER_PERSISTENCE_FAILED: Failed to save the reminder in the database right now. Tell the user you'll try again shortly.`
        };
      }

      logger.info('[ReminderIntentDetector] Successfully scheduled reminder', {
        userId,
        reminderId: inserted.id,
        triggerAt: parsed.triggerAt.toISOString(),
        task: parsed.title
      });

      return {
        detected: true,
        scheduled: true,
        reminder: inserted,
        task: parsed.title,
        triggerAt: parsed.triggerAt,
        formattedTime: parsed.formattedTime,
        note: `REMINDER_ALREADY_PERSISTED: A reminder for "${parsed.title}" has been successfully scheduled for ${parsed.formattedTime}. Reassure the user warmly that you have noted it and will remind them at that time. NEVER say they set it in the past.`
      };
    } catch (err: any) {
      logger.error('[ReminderIntentDetector] Exception during reminder persistence', { error: err.message });
      return {
        detected: true,
        scheduled: false,
        task: parsed.title,
        note: `REMINDER_PERSISTENCE_FAILED: Failed to save the reminder.`
      };
    }
  }
}

export const reminderIntentDetector = ReminderIntentDetector.getInstance();
