/**
 * ReminderIntentDetector.ts — High-Precision Natural Reminder Parsing & Scheduling Engine
 *
 * Designed to accurately detect and schedule reminders across English, Hindi, and Hinglish:
 * - Direct requests: "Kal muje afternoon me 1 bJe yaad dilao na PF ke lie bank details update karna hai"
 * - Multi-step sequential batching: "remind me in 15 mins to drink water and keep reminding me 4 times"
 * - Day recurrence with exclusions: "remind me to go to gym every morning 8 am apart from friday and sunday"
 * - Monthly recurrence with month exclusions & time clarification: "every month remind me to pay bills on 28th apart from february month"
 * - Multi-turn conversational affirmation: User saying "Ok let's do that" in response to Nova's offer!
 * - Complaint shielding: Prevents past complaints ("remind nai kiya") from becoming bogus reminders.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import crypto from 'crypto';

export interface ReminderDetectionResult {
  detected: boolean;
  scheduled: boolean;
  reminder?: any;
  reminders?: any[];
  note?: string;
  task?: string;
  triggerAt?: Date;
  formattedTime?: string;
  isRecurring?: boolean;
  recurrenceType?: string;
  recurrenceInterval?: number;
  activeDays?: string[];
  activeMonths?: string[];
  isBatch?: boolean;
  batchCount?: number;
  batchIntervalMinutes?: number;
  isAmbiguous?: boolean;
  clarificationQuestion?: string;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

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

    // 1. Complaint / Missed reminder shield: If user is complaining about a missed reminder, do NOT treat as a new reminder!
    if (this.isComplaint(lower)) {
      return false;
    }

    // 2. Negative triggers: user explicitly saying do not remind
    if (/\b(?:don'?t|dont|not|mat)\s*(?:remind|yaad\s*(?:dilana|dila|karna|rakhna))\b/i.test(lower)) {
      return false;
    }
    if (/\b(?:remind|yaad)\s*mat\s*(?:karna|karo|dilana|dilao)\b/i.test(lower)) {
      return false;
    }

    // 3. Positive triggers
    return /\b(yaad\s*(?:dilao|dilana|dila\s*dena|dila|kara|kar\s*dena|se\s*remind|dena|karna|rakhna)|remind\s*(?:me|karo|karna|kar|dena|karen)|reminder\s*(?:set|lagao|karo|banao)|alarm\s*(?:lagao|set|karo)|schedule\s*karo)\b/i.test(lower);
  }

  /**
   * Checks if user is complaining or asking about a missed reminder.
   */
  isComplaint(lower: string): boolean {
    const complaintPatterns = [
      /\b(?:remind|yaad)\s*(?:nai|nahi|na|ni)\s*(?:kiya|karaya|kare|karte)\b/i,
      /\bek\s*bhi\s*bar\s*(?:remind|yaad)\b/i,
      /\bmiss\s*(?:ho\s*gaya|kar\s*diya)\b/i,
      /\b(?:bhul\s*gaye|bhuul\s*gaye|forgot\s*to\s*remind)\b/i,
      /\bwhy\s*didn'?t\s*you\s*remind\b/i,
      /\b(?:apne|aapne)\s*(?:aaj|kal)?\s*(?:sube|subah|shaam)?\s*(?:muje|mujhe)?\s*(?:ek\s*bhi\s*bar\s*)?remind\s*(?:nai|nahi|na|ni)/i,
      /\bremind\s*kyu[n]?\s*nahi\s*kiya\b/i
    ];
    return complaintPatterns.some(p => p.test(lower));
  }

  /**
   * Checks if the message is an affirmation / consent (e.g. to Nova's offer).
   */
  isAffirmation(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase().trim();
    const affirmationPattern = /^(?:ok|okay|sure|yes|yeah|yup|yess|haan|ha|haa|kar\s*do|kardo|let'?s\s*do\s*that|lets\s*do\s*that|do\s*it|chalega|done|theek\s*hai|thik\s*hai|bana\s*do|laga\s*do|please|zaroor|bilkul|haanji|definitely|alright|set\s*kar\s*do)(?:[\s!.,:;~🎉💪😊🥳]+.*)?$/i;
    return affirmationPattern.test(lower);
  }

  /**
   * Checks if assistant's message was an offer to set a reminder.
   */
  hasReminderOffer(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    const offerPatterns = [
      /\b(?:reminder|alarm)\s*(?:set\s*kar\s*doon|laga\s*doon|kar\s*du|kar\s*doon\s*tere\s*liye|kar\s*du\s*tere\s*liye)\b/i,
      /\b(?:ka\s*reminder|ka\s*alarm)\s*(?:set\s*kar|chahiye|lagau)\b/i,
      /\b(?:remind\s*kar\s*doon|yaad\s*dila\s*doon)\b/i,
      /\b(?:set\s*a\s*reminder|shall\s*i\s*remind\s*you|should\s*i\s*set\s*a\s*reminder|want\s*me\s*to\s*remind\s*you)\b/i
    ];
    return offerPatterns.some(p => p.test(lower));
  }

  /**
   * Smart Proactive Detection: Does the message discuss a future-dated plan, upcoming activity, daily routine, or habit?
   */
  hasFuturePlanIntent(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    const lower = text.toLowerCase();

    // Exclude explicit negatives
    if (/\b(?:don'?t|dont|not|mat)\s*(?:karna|shuru|start|jana|karunga)\b/i.test(lower)) {
      return false;
    }

    const hasHabitOrRoutine = /\b(?:roz|daily|har\s*din|every\s*day|subah|sube|sawere|savere|shaam|raat|dopahar)\b/i.test(lower);
    const hasActivity = /\b(?:workout|gym|exercise|walk|running|yoga|diet|uthna|uth\s*ke|padhna|study|class|office|meeting|khana|cook|cooking|medication|dawa|doctor|client|project|kitchen|kaam|water|paani|bills?)\b/i.test(lower);
    const hasFutureIntention = /\b(?:start\s*karna|shuru\s*karna|karna\s*hai|karni\s*hai|jana\s*hai|soch\s*raha|planning|plan\s*hai|routine\s*banan[ai]|kal\s*se|parso\s*se|aaj\s*se)\b/i.test(lower);
    const hasTimeOrDate = /\b(?:\d{1,2}\s*(?:bje|baje|am|pm)|kal|parso|tarso|tomorrow|morning|evening|night)\b/i.test(lower);

    if (hasHabitOrRoutine && hasActivity) return true;
    if (hasActivity && hasFutureIntention) return true;
    if (hasFutureIntention && hasTimeOrDate) return true;
    if (hasHabitOrRoutine && hasTimeOrDate) return true;

    return false;
  }

  /**
   * Deterministically parses time, date, recurrence, batching, and exclusions.
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
    recurrenceInterval?: number;
    activeDays?: string[];
    activeMonths?: string[];
    isBatch?: boolean;
    batchCount?: number;
    batchIntervalMinutes?: number;
    clarificationQuestion?: string;
  } {
    const lower = text.toLowerCase();
    const nowLocal = new Date(Date.now() + tzOffsetHours * 3600 * 1000);

    // ── 0. Multi-Step Sequential Batch ("remind me in 15 mins to drink water and keep reminding me 4 times") ──
    const repeatCountMatch = lower.match(/\b(?:keep\s*reminding\s*(?:me)?\s*(\d+)\s*times|(\d+)\s*times?\s*(?:remind|yaad)|repeat\s*(\d+)\s*times?|(\d+)\s*bar\s*(?:yaad|remind))\b/i);
    const relMinBatchMatch = lower.match(/\b(?:in\s+)?(\d+)\s*(?:mins?|minutes?|minut|minute)\b(?:\s*(?:me|mein|baad|after|every))?/i);

    if (repeatCountMatch && relMinBatchMatch) {
      const count = parseInt(repeatCountMatch[1] || repeatCountMatch[2] || repeatCountMatch[3] || repeatCountMatch[4], 10);
      const intervalMins = parseInt(relMinBatchMatch[1], 10);
      if (count > 1 && intervalMins > 0) {
        const title = this.cleanTaskTitle(text);
        const firstTrigger = new Date(Date.now() + intervalMins * 60 * 1000);
        return {
          title,
          triggerAt: firstTrigger,
          isAmbiguous: false,
          formattedTime: `in ${intervalMins} mins, repeated ${count} times (every ${intervalMins}m)`,
          isBatch: true,
          batchCount: count,
          batchIntervalMinutes: intervalMins
        };
      }
    }

    // ── 1. Relative Duration: "in 15 minutes", "10 min me", "aadhe ghante me", "1 ghante baad" ──
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

    // ── 2. Day-of-Week Recurrence with Day Exclusions ──
    // e.g. "remind me to go to gym every morning 8 am apart from friday and sunday"
    const hasEveryDayOrMorning = /\b(?:every\s*morning|every\s*day|roz|daily|har\s*din|har\s*subah|roz\s*subah)\b/i.test(lower);
    const dayExclusionMatch = lower.match(/\b(?:apart\s*from|except|excluding|chhod\s*ke|chhodkar|bina)\s+([a-zA-Z\s,]+?)(?:\s*(?:month|baje|am|pm|$))/i);

    let activeDays: string[] | undefined = undefined;
    if (hasEveryDayOrMorning && dayExclusionMatch) {
      const excludedText = dayExclusionMatch[1].toLowerCase();
      const excludedDays: string[] = [];
      for (const d of DAY_NAMES) {
        if (excludedText.includes(d) || (d === 'thursday' && excludedText.includes('thu'))) {
          excludedDays.push(d);
        }
      }
      if (excludedDays.length > 0) {
        activeDays = DAY_NAMES.filter(d => !excludedDays.includes(d));
      }
    }

    // ── 3. Monthly Recurrence with Month Exclusions & Missing Time ──
    // e.g. "every month remind me to pay bills on 28th apart from february month"
    const isMonthly = /\b(?:every\s*month|monthly|har\s*mahine|har\s*month)\b/i.test(lower);
    const dayOfMonthMatch = lower.match(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);

    if (isMonthly && dayOfMonthMatch) {
      const dayNum = parseInt(dayOfMonthMatch[1], 10);
      let activeMonths: string[] = [...MONTH_NAMES];

      const monthExclusionMatch = lower.match(/\b(?:apart\s*from|except|excluding|chhod\s*ke|chhodkar|bina)\s+([a-zA-Z\s,]+?)(?:\s*month)?\b/i);
      if (monthExclusionMatch) {
        const exclStr = monthExclusionMatch[1].toLowerCase();
        activeMonths = MONTH_NAMES.filter(m => !exclStr.includes(m) && !exclStr.includes(m.slice(0, 3)));
      }

      // Check if explicit time was mentioned
      const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:bje|baje|am|pm)\b/i);
      const title = this.cleanTaskTitle(text);

      if (!timeMatch) {
        // User didn't specify time for monthly reminder — ask for clarification
        return {
          title,
          triggerAt: null,
          isAmbiguous: true,
          clarificationQuestion: `What time on the ${dayNum}th would you like me to remind you to ${title}?`
        };
      }

      let hour = parseInt(timeMatch[1], 10);
      const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      if (/\bpm\b/i.test(timeMatch[0]) && hour < 12) hour += 12;
      else if (/\bam\b/i.test(timeMatch[0]) && hour === 12) hour = 0;

      // Find next eligible month
      let targetYear = nowLocal.getUTCFullYear();
      let targetMonth = nowLocal.getUTCMonth();
      let candidate = new Date(Date.UTC(targetYear, targetMonth, dayNum, hour, minute, 0, 0));

      let safety = 0;
      while (safety < 24) {
        const mName = MONTH_NAMES[candidate.getUTCMonth()];
        if (candidate.getTime() > nowLocal.getTime() && activeMonths.includes(mName)) {
          break;
        }
        targetMonth++;
        if (targetMonth > 11) {
          targetMonth = 0;
          targetYear++;
        }
        candidate = new Date(Date.UTC(targetYear, targetMonth, dayNum, hour, minute, 0, 0));
        safety++;
      }

      const triggerAt = new Date(candidate.getTime() - tzOffsetHours * 3600 * 1000);
      const hh12 = hour % 12 || 12;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const timeStr = `${hh12}:${minute.toString().padStart(2, '0')} ${ampm}`;
      const exclNote = activeMonths.length < 12 ? ` (excl. ${MONTH_NAMES.filter(m => !activeMonths.includes(m)).join(', ')})` : '';

      return {
        title,
        triggerAt,
        isAmbiguous: false,
        formattedTime: `Every month on ${dayNum}th at ${timeStr}${exclNote}`,
        isRecurring: true,
        recurrenceType: 'months',
        recurrenceInterval: 1,
        activeMonths
      };
    }

    // ── 4. Annual Event / Birthday ──
    const isYearlyIntent = /\b(?:har\s*saal|every\s*year|yearly|annually|har\s*year|birthday|anniversary|janamdin|date\s*of\s*birth|dob)\b/i.test(lower);
    let advanceDays = 0;
    const advanceMatch = lower.match(/\b(\d+)\s*(?:din|days?)\s*(?:pehle|before|prior|ahead)\b/i);
    if (advanceMatch) {
      advanceDays = parseInt(advanceMatch[1], 10);
    } else if (/\b(?:ek|1)\s*(?:hafte?|week)\s*(?:pehle|before)\b/i.test(lower)) {
      advanceDays = 7;
    }

    let eventDay: number | null = null;
    let eventMonth: number | null = null;
    const monthNamesMap: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
      may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
      sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
    };

    const ddmmyyyyMatch = lower.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
    if (ddmmyyyyMatch) {
      const d = parseInt(ddmmyyyyMatch[1], 10);
      const m = parseInt(ddmmyyyyMatch[2], 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        eventDay = d;
        eventMonth = m - 1;
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
      let reminderHour = 10;
      let reminderMinute = 0;
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

      if (targetDate.getTime() <= nowLocal.getTime()) {
        targetYear += 1;
        targetDate = new Date(Date.UTC(targetYear, eventMonth, eventDay, reminderHour, reminderMinute, 0, 0));
        if (advanceDays > 0) {
          targetDate.setUTCDate(targetDate.getUTCDate() - advanceDays);
        }
      }

      const triggerAt = new Date(targetDate.getTime() - tzOffsetHours * 3600 * 1000);
      const title = this.cleanTaskTitle(text);
      const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const targetMonthName = MONTH_FULL[targetDate.getUTCMonth()];
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

    // ── 5. Standard Date / Time Extraction ──
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

    const isMorning = /\b(?:subah|sube|sawere|savere|morning|am)\b/i.test(lower);
    const isAfternoon = /\b(?:dopahar|dupeher|afternoon)\b/i.test(lower);
    const isEvening = /\b(?:shaam|sham|sanjh|evening)\b/i.test(lower);
    const isNight = /\b(?:raat|night)\b/i.test(lower);
    const isPM = /\bpm\b/i.test(lower) || isAfternoon || isEvening;

    let hour: number | null = null;
    let minute: number = 0;

    const timePatterns = [
      /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i,
      /\b(\d{1,2})\s*(?:bje|baje|bJe)\b/i,
      /\b(\d{1,2})\s*(am|pm)\b/i,
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
          if (hour >= 1 && hour <= 6) {
            hour += 12;
          }
        }
      }
    } else {
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
      const title = this.cleanTaskTitle(text);
      return {
        title,
        triggerAt: null,
        isAmbiguous: true,
        clarificationQuestion: `What time would you like to be reminded to ${title}?`
      };
    }

    let targetLocal = new Date(Date.UTC(targetYear, targetMonth, targetDay, hour, minute, 0, 0));

    if (!dateIdentified && targetLocal.getTime() <= nowLocal.getTime()) {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      dateLabel = 'Tomorrow';
    }

    // If activeDays filter is present, advance targetLocal to the first valid active day
    if (activeDays && activeDays.length > 0) {
      let safety = 0;
      while (safety < 14) {
        const dayName = DAY_NAMES[targetLocal.getUTCDay()];
        if (activeDays.includes(dayName) && targetLocal.getTime() > nowLocal.getTime()) {
          break;
        }
        targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
        safety++;
      }
    }

    const triggerAt = new Date(targetLocal.getTime() - tzOffsetHours * 3600 * 1000);
    const title = this.cleanTaskTitle(text);
    const isRecurringDaily = hasEveryDayOrMorning || /\b(?:roz|daily|har\s*din|every\s*day)\b/i.test(lower);
    const hh12 = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const timeFormatted = `${hh12}:${minute.toString().padStart(2, '0')} ${ampm}`;

    let formattedTime: string;
    if (activeDays && activeDays.length > 0) {
      const dayNamesFormatted = activeDays.map(d => d.slice(0, 3).toUpperCase()).join(', ');
      formattedTime = `Every day (${dayNamesFormatted}) at ${timeFormatted}`;
    } else if (isRecurringDaily) {
      formattedTime = `Every day at ${timeFormatted}`;
    } else {
      formattedTime = `${dateLabel} at ${timeFormatted}`;
    }

    return {
      title,
      triggerAt,
      isAmbiguous: false,
      formattedTime,
      isRecurring: isRecurringDaily,
      recurrenceType: isRecurringDaily ? 'daily' : undefined,
      recurrenceInterval: isRecurringDaily ? 1 : undefined,
      activeDays
    };
  }

  /**
   * Extracts future plan details for proactive reminder prompting.
   */
  extractFuturePlanDetails(text: string, tzOffsetHours: number = 5.5) {
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
      .replace(/\b(?:roz|daily|har\s*din|every\s*day|every\s*morning|har\s*saal|every\s*year|yearly|annually|every\s*month|monthly)\b/gi, '')
      .replace(/\b(?:start\s*karna\s*hai|shuru\s*karna\s*hai|karna\s*hai|karni\s*hai|uth\s*ke|uthna)\b/gi, '')
      .replace(/\b(?:keep\s*reminding\s*me\s*\d+\s*times|\d+\s*times|\d+\s*bar)\b/gi, '')
      .replace(/\b(?:apart\s*from|except|excluding|chhod\s*ke|chhodkar|bina)\s+[a-zA-Z\s,]+/gi, '')
      .replace(/\b\d+\s*(?:din|days?)\s*(?:pehle|before|prior|ahead)\b/gi, '')
      .replace(/\b(?:date\s*of\s*birth|dob)\s*(?:ko\s*hai|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|hai)?\b/gi, '')
      .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/gi, '')
      .replace(/\b(?:na|yaad\s*se|muje|mujhe|tum|mera|meri|apna|apne|bata\s*dena|bhi|so|ko\s*hai|hai|ko)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!clean || clean.length < 3) {
      clean = text
        .replace(/\b(?:yaad\s*(?:dilao|dilana|dila\s*dena|dila|kara|kar\s*dena)|remind\s*(?:me|karo|karna))\b/gi, '')
        .trim();
    }

    return clean.slice(0, 120) || 'Reminder';
  }

  /**
   * Evaluates if user confirmed a previous reminder offer from Nova, and schedules it.
   */
  async checkAndScheduleAffirmation(
    userId: string,
    userMessage: string,
    lastAssistantMessage: string,
    tzOffsetHours: number = 5.5
  ): Promise<ReminderDetectionResult> {
    if (!lastAssistantMessage || !this.hasReminderOffer(lastAssistantMessage)) {
      return { detected: false, scheduled: false };
    }

    if (!this.isAffirmation(userMessage)) {
      return { detected: false, scheduled: false };
    }

    logger.info('[ReminderIntentDetector] User affirmed proactive reminder offer!', {
      userId,
      userMessage,
      lastAssistantMessage
    });

    // Extract proposed parameters from the assistant's previous offer
    const parsed = this.parseReminderDetails(lastAssistantMessage, tzOffsetHours);
    // If title was stripped down to 'Reminder', extract from the context
    if (parsed.title === 'Reminder' || parsed.title.length < 3) {
      if (/workout|gym/i.test(lastAssistantMessage)) parsed.title = 'Workout';
      else if (/water|paani/i.test(lastAssistantMessage)) parsed.title = 'Drink water';
      else if (/medicine|dawai/i.test(lastAssistantMessage)) parsed.title = 'Take medicine';
      else if (/bill/i.test(lastAssistantMessage)) parsed.title = 'Pay bills';
    }

    if (!parsed.triggerAt) {
      // If time was missing in the offer, default to 8:00 AM tomorrow
      const nowLocal = new Date(Date.now() + tzOffsetHours * 3600 * 1000);
      nowLocal.setUTCDate(nowLocal.getUTCDate() + 1);
      nowLocal.setUTCHours(8, 0, 0, 0);
      parsed.triggerAt = new Date(nowLocal.getTime() - tzOffsetHours * 3600 * 1000);
      parsed.formattedTime = 'Tomorrow at 8:00 AM';
      parsed.isRecurring = true;
      parsed.recurrenceType = 'days';
    }

    // Insert into database
    const { data: inserted, error } = await supabaseAdmin
      .from('reminders')
      .insert({
        user_id: userId,
        text: parsed.title,
        trigger_at: parsed.triggerAt.toISOString(),
        status: 'active',
        is_auto: false,
        recurrence_type: parsed.recurrenceType || 'days',
        recurrence_interval: parsed.isRecurring ? 1 : null,
        accountability_status: 'pending',
        created_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (error) {
      logger.error('[ReminderIntentDetector] Failed to persist affirmed reminder', { error: error.message });
      return { detected: true, scheduled: false };
    }

    return {
      detected: true,
      scheduled: true,
      reminder: inserted,
      task: parsed.title,
      triggerAt: parsed.triggerAt,
      formattedTime: parsed.formattedTime,
      isRecurring: parsed.isRecurring,
      recurrenceType: parsed.recurrenceType,
      note: `AFFIRMED_PROACTIVE_REMINDER_SCHEDULED: The user agreed to your offer! A reminder for "${parsed.title}" has been saved in the database for ${parsed.formattedTime}. Confirm this naturally and enthusiastically to the user!`
    };
  }

  /**
   * Synchronously detects, parses, and persists reminders into the database.
   */
  async detectAndSchedule(
    userId: string,
    message: string,
    country: string = 'IN'
  ): Promise<ReminderDetectionResult> {
    if (!this.hasReminderIntent(message)) {
      return { detected: false, scheduled: false };
    }

    // Determine user timezone offset (fixed: handles offset in minutes e.g. 330 -> 5.5 hours)
    let tzOffsetHours = country === 'IN' ? 5.5 : 5.5;
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('timezone_offset, country')
        .eq('id', userId)
        .maybeSingle();

      if (profile?.timezone_offset !== undefined && profile?.timezone_offset !== null) {
        const off = Number(profile.timezone_offset);
        tzOffsetHours = off > 24 ? off / 60 : off;
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
        isAmbiguous: true,
        clarificationQuestion: parsed.clarificationQuestion,
        note: `REMINDER_CLARIFICATION_NEEDED: ${parsed.clarificationQuestion || `The user wants a reminder ("${parsed.title}"), but did not specify an exact time or day. Ask them warmly what time or date they would like to be reminded!`}`
      };
    }

    // ── Multi-Step Sequential Batch Scheduling ──
    if (parsed.isBatch && parsed.batchCount && parsed.batchIntervalMinutes) {
      const batchGroupId = crypto.randomUUID();
      const rowsToInsert = [];
      for (let i = 1; i <= parsed.batchCount; i++) {
        const trigger = new Date(Date.now() + i * parsed.batchIntervalMinutes * 60 * 1000);
        rowsToInsert.push({
          user_id: userId,
          text: `${parsed.title} (step ${i}/${parsed.batchCount})`,
          trigger_at: trigger.toISOString(),
          status: 'active',
          is_auto: false,
          batch_group_id: batchGroupId,
          accountability_status: 'pending',
          created_at: new Date().toISOString()
        });
      }

      const { data: insertedList, error: bErr } = await supabaseAdmin
        .from('reminders')
        .insert(rowsToInsert)
        .select('*');

      if (bErr) {
        logger.error('[ReminderIntentDetector] Batch insert error', { error: bErr.message });
        return { detected: true, scheduled: false, note: 'REMINDER_PERSISTENCE_FAILED' };
      }

      return {
        detected: true,
        scheduled: true,
        reminders: insertedList || [],
        task: parsed.title,
        formattedTime: parsed.formattedTime,
        isBatch: true,
        batchCount: parsed.batchCount,
        note: `BATCH_REMINDERS_SCHEDULED: Scheduled ${parsed.batchCount} reminders for "${parsed.title}" every ${parsed.batchIntervalMinutes} minutes. Confirm enthusiastically to the user!`
      };
    }

    // ── Check for existing active reminder to prevent duplicates ──
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
          note: `NEW_REMINDER_SCHEDULED_FOR_FUTURE: A reminder for "${parsed.title}" is scheduled for ${parsed.formattedTime}. Confirm to the user warmly: "Done! Main tumhe ${parsed.formattedTime} pe yaad dila dungi".`
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
          recurrence_interval: parsed.isRecurring ? (parsed.recurrenceInterval || 1) : null,
          active_days: parsed.activeDays || null,
          active_months: parsed.activeMonths || null,
          accountability_status: 'pending',
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
          note: `REMINDER_PERSISTENCE_FAILED: Failed to save the reminder in the database right now.`
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
        isRecurring: parsed.isRecurring,
        recurrenceType: parsed.recurrenceType,
        activeDays: parsed.activeDays,
        activeMonths: parsed.activeMonths,
        note: `NEW_REMINDER_SCHEDULED_FOR_FUTURE: A reminder for "${parsed.title}" has been successfully scheduled for ${parsed.formattedTime}. Confirm to the user warmly: "Done! Main tumhe ${parsed.formattedTime} pe yaad dila dungi".`
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
