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
  isRecurring?: boolean;
  recurrenceType?: string;
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
   * Smart Proactive Detection: Does the message discuss a future-dated plan, upcoming activity, daily routine, or habit?
   * e.g.:
   * - "Sube muje roz workout start karna hai 8 baje uth ke"
   * - "kal se gym shuru karna hai"
   * - "roz raat ko 10 baje book padhni hai"
   * - "parso doctor ke paas jana hai"
   */
  hasFuturePlanIntent(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    const lower = text.toLowerCase();

    // Exclude explicit negatives
    if (/\b(?:don'?t|dont|not|mat)\s*(?:karna|shuru|start|jana|karunga)\b/i.test(lower)) {
      return false;
    }

    const hasHabitOrRoutine = /\b(?:roz|daily|har\s*din|every\s*day|subah|sube|sawere|savere|shaam|raat|dopahar)\b/i.test(lower);
    const hasActivity = /\b(?:workout|gym|exercise|walk|running|yoga|diet|uthna|uth\s*ke|padhna|study|class|office|meeting|khana|cook|cooking|medication|dawa|doctor|client|project|kitchen|kaam)\b/i.test(lower);
    const hasFutureIntention = /\b(?:start\s*karna|shuru\s*karna|karna\s*hai|karni\s*hai|jana\s*hai|soch\s*raha|planning|plan\s*hai|routine\s*banan[ai]|kal\s*se|parso\s*se|aaj\s*se)\b/i.test(lower);
    const hasTimeOrDate = /\b(?:\d{1,2}\s*(?:bje|baje|am|pm)|kal|parso|tarso|tomorrow|morning|evening|night)\b/i.test(lower);

    // Combination 1: Habit/routine + activity (e.g. "roz workout", "sube gym")
    if (hasHabitOrRoutine && hasActivity) return true;
    // Combination 2: Activity + Future intention (e.g. "workout start karna hai", "gym shuru karna hai")
    if (hasActivity && hasFutureIntention) return true;
    // Combination 3: Future intention + Time/date (e.g. "kal jana hai 4 baje", "8 baje uth ke start karna hai")
    if (hasFutureIntention && hasTimeOrDate) return true;
    // Combination 4: Specific habit with time (e.g. "roz 8 baje")
    if (hasHabitOrRoutine && hasTimeOrDate) return true;

    return false;
  }

  /**
   * Deterministically parses time, date, recurrence, and task from the user's message.
   */
  parseReminderDetails(
    text: string,
    tzOffsetHours: number = 5.5
  ): {
    title: string;
    triggerAt: Date | null;
    isAmbiguous: boolean;
    formattedTime?: string;
    isRecurring?: boolean;
    recurrenceType?: string;
  } {
    const lower = text.toLowerCase();
    // Current local time
    const nowLocal = new Date(Date.now() + tzOffsetHours * 3600 * 1000);

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

    // ── 1.5. Annual Event / Calendar Date Parsing (Birthdays, Anniversaries, DD/MM/YYYY, "15 din pehle", "har saal")
    const isYearlyIntent = /\b(?:har\s*saal|every\s*year|yearly|annually|har\s*year|birthday|anniversary|janamdin|date\s*of\s*birth|dob)\b/i.test(lower);

    // Check for advance offset: "15 din pehle", "10 days before", "1 hafte pehle", "2 days prior"
    let advanceDays = 0;
    const advanceMatch = lower.match(/\b(\d+)\s*(?:din|days?)\s*(?:pehle|before|prior|ahead)\b/i);
    if (advanceMatch) {
      advanceDays = parseInt(advanceMatch[1], 10);
    } else if (/\b(?:ek|1)\s*(?:hafte?|week)\s*(?:pehle|before)\b/i.test(lower)) {
      advanceDays = 7;
    }

    // Check for calendar date: DD/MM/YYYY, DD/MM, or "7th August", "August 7"
    let eventDay: number | null = null;
    let eventMonth: number | null = null; // 0-indexed (0 = Jan, 7 = Aug)

    const ddmmyyyyMatch = lower.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
    const monthNamesMap: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
      may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
      sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
    };

    if (ddmmyyyyMatch) {
      const d = parseInt(ddmmyyyyMatch[1], 10);
      const m = parseInt(ddmmyyyyMatch[2], 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        eventDay = d;
        eventMonth = m - 1; // 0-indexed
      }
    } else {
      const monthWordMatch = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\b/i) ||
                             lower.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
      if (monthWordMatch) {
        const mStr = (monthNamesMap[monthWordMatch[1].toLowerCase()] !== undefined ? monthWordMatch[1] : monthWordMatch[2]).toLowerCase();
        const dStr = (monthNamesMap[monthWordMatch[1].toLowerCase()] !== undefined ? monthWordMatch[2] : monthWordMatch[1]);
        eventMonth = monthNamesMap[mStr];
        eventDay = parseInt(dStr, 10);
      }
    }

    if (eventDay !== null && eventMonth !== null) {
      // Default notification time if not explicitly stated: 10:00 AM local
      let reminderHour = 10;
      let reminderMinute = 0;

      // Check if explicit time was also mentioned (e.g. "shaam 6 baje")
      const timeNumMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:bje|baje|bJe|am|pm)\b/i);
      if (timeNumMatch) {
        let th = parseInt(timeNumMatch[1], 10);
        reminderMinute = timeNumMatch[2] ? parseInt(timeNumMatch[2], 10) : 0;
        if (/\bpm\b/i.test(timeNumMatch[0]) || /\b(?:shaam|sham|dopahar|evening)\b/i.test(lower)) {
          if (th < 12) th += 12;
        } else if (/\bam\b/i.test(timeNumMatch[0]) || /\b(?:subah|sube|morning)\b/i.test(lower)) {
          if (th === 12) th = 0;
        }
        reminderHour = th;
      }

      let targetYear = nowLocal.getUTCFullYear();
      let targetDate = new Date(Date.UTC(targetYear, eventMonth, eventDay, reminderHour, reminderMinute, 0, 0));

      if (advanceDays > 0) {
        targetDate.setUTCDate(targetDate.getUTCDate() - advanceDays);
      }

      // If the target date in the current calendar year has already passed, schedule for NEXT year!
      if (targetDate.getTime() <= nowLocal.getTime()) {
        targetYear += 1;
        targetDate = new Date(Date.UTC(targetYear, eventMonth, eventDay, reminderHour, reminderMinute, 0, 0));
        if (advanceDays > 0) {
          targetDate.setUTCDate(targetDate.getUTCDate() - advanceDays);
        }
      }

      const triggerAt = new Date(targetDate.getTime() - tzOffsetHours * 3600 * 1000);
      const title = this.cleanTaskTitle(text);

      const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const targetMonthName = MONTH_NAMES[targetDate.getUTCMonth()];
      const targetDayNum = targetDate.getUTCDate();
      const hh12 = reminderHour % 12 || 12;
      const ampm = reminderHour >= 12 ? 'PM' : 'AM';
      const timeFormatted = `${hh12}:${reminderMinute.toString().padStart(2, '0')} ${ampm}`;

      const formattedTime = isYearlyIntent 
        ? `Every year on ${targetMonthName} ${targetDayNum} at ${timeFormatted}`
        : `${targetMonthName} ${targetDayNum}, ${targetDate.getUTCFullYear()} at ${timeFormatted}`;

      return {
        title,
        triggerAt,
        isAmbiguous: false,
        formattedTime,
        isRecurring: isYearlyIntent,
        recurrenceType: isYearlyIntent ? 'years' : undefined
      };
    }

    // ── 2. Determine Target Date
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

    const isRecurringDaily = /\b(?:roz|daily|har\s*din|every\s*day)\b/i.test(lower);
    const hh12 = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const timeFormatted = `${hh12}:${minute.toString().padStart(2, '0')} ${ampm}`;
    const formattedTime = isRecurringDaily ? `Every day at ${timeFormatted}` : `${dateLabel} at ${timeFormatted}`;

    return {
      title,
      triggerAt,
      isAmbiguous: false,
      formattedTime,
      isRecurring: isRecurringDaily,
      recurrenceType: isRecurringDaily ? 'daily' : undefined
    };
  }

  /**
   * Extracts future plan details for proactive reminder prompting.
   */
  extractFuturePlanDetails(
    text: string,
    tzOffsetHours: number = 5.5
  ): {
    title: string;
    triggerAt: Date | null;
    isRecurring?: boolean;
    recurrenceType?: string;
    formattedTime?: string;
    isAmbiguous: boolean;
  } {
    return this.parseReminderDetails(text, tzOffsetHours);
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
      .replace(/\b(?:roz|daily|har\s*din|every\s*day|har\s*saal|every\s*year|yearly|annually)\b/gi, '')
      .replace(/\b(?:start\s*karna\s*hai|shuru\s*karna\s*hai|karna\s*hai|karni\s*hai|uth\s*ke|uthna)\b/gi, '')
      .replace(/\b\d+\s*(?:din|days?)\s*(?:pehle|before|prior|ahead)\b/gi, '')
      .replace(/\b(?:date\s*of\s*birth|dob)\s*(?:ko\s*hai|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|hai)?\b/gi, '')
      .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/gi, '')
      .replace(/\b(?:na|yaad\s*se|muje|mujhe|tum|mera|meri|apna|apne|bata\s*dena|bhi|so|ko\s*hai|hai|ko)\b/gi, '')
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

    if (!parsed.triggerAt || parsed.isAmbiguous) {
      return {
        detected: true,
        scheduled: false,
        task: parsed.title,
        note: `REMINDER_CLARIFICATION_NEEDED: The user wants a reminder ("${parsed.title}"), but did not specify an exact time or day. Proactively and warmly ask them what time or date they would like to be reminded!`
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
          isRecurring: parsed.isRecurring,
          recurrenceType: parsed.recurrenceType,
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
          recurrence_type: parsed.recurrenceType || null,
          recurrence_interval: parsed.isRecurring ? 1 : null,
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
