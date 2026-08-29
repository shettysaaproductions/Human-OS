/**
 * ReminderEngine — Nova's advanced reminder parsing and scheduling engine
 *
 * Handles all complex reminder scenarios:
 * - Relative time: "in 2 mins", "after 3 hours"
 * - Specific time of day: "at 7am", "at 17:00"
 * - Specific date+time: "on July 20 at 10am"
 * - Day-of-week filtering: "only on Saturday and Sunday"
 * - Month/year filtering: "only in December 2027"
 * - Batch scheduling: "3 times every 15 mins from 2pm"
 * - Recurring with day/month constraints
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];

export interface ReminderSpec {
  title: string;
  // Time specification (one of these)
  relative_value?: number;
  relative_unit?: string;
  time_of_day?: string;       // "HH:MM" 24-hour
  date?: string;              // "YYYY-MM-DD" specific date
  // Filtering
  active_days?: string[];     // ['monday','saturday'] or null = every day
  active_months?: string[];   // ['july','december'] or null = every month
  active_year?: number;       // 2027 or null = every year
  // Recurrence
  recurrence_interval_value?: number;
  recurrence_interval_unit?: string;
  recurrence_limit?: number;
  end_at?: string;            // ISO or "YYYY-MM-DD HH:MM"
  // Batch
  batch_count?: number;
  batch_interval_minutes?: number;
  // Event trigger (remind me WHEN a life event happens — no fixed time)
  event_trigger?: string;     // free-text: 'wake_up', 'left_the_office', ...
  // Purpose / urgency / end semantics (informational + awareness)
  purpose?: string;           // why this reminder matters
  urgency?: 'low' | 'medium' | 'high';
  end_condition?: 'until_cancelled' | 'until_date' | 'until_count';
  // Misc
  notes?: string;
  is_auto?: boolean;
}

export interface ParsedReminder {
  text: string;
  trigger_at: Date | null;    // null = event-triggered reminder (fires on event only)
  recurrence_type?: string;
  recurrence_interval?: number;
  recurrence_limit?: number;
  active_days?: string[];
  active_months?: string[];
  active_year?: number;
  end_at?: Date;
  event_trigger?: string;
  purpose?: string;
  urgency?: 'low' | 'medium' | 'high';
  end_condition?: 'until_cancelled' | 'until_date' | 'until_count';
  is_auto: boolean;
  notes?: string;
}

export interface ScheduledReminderRow {
  id?: string;
  user_id: string;
  text: string;
  trigger_at: string | null;
  status: string;
  alreadyExists?: boolean;
  [key: string]: any;
}

/**
 * Resolves a user's timezone offset in fractional hours from their profile data.
 * Priority: (1) timezone_offset (in minutes), (2) timezone (IANA string), (3) country code map.
 * Default: 5.5 (Asia/Kolkata / IST).
 */
export function resolveUserTzOffsetHours(profile?: { timezone_offset?: number | null; timezone?: string | null; country?: string | null }): number {
  if (profile?.timezone_offset !== undefined && profile?.timezone_offset !== null) {
    return profile.timezone_offset / 60;
  }
  if (profile?.timezone) {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: profile.timezone, timeZoneName: 'shortOffset' });
      const parts = formatter.formatToParts(now);
      const tzPart = parts.find(p => p.type === 'timeZoneName')?.value;
      if (tzPart) {
        const m = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
        if (m) {
          const sign = m[1] === '-' ? -1 : 1;
          const hours = parseInt(m[2], 10);
          const mins = m[3] ? parseInt(m[3], 10) : 0;
          return sign * (hours + mins / 60);
        }
      }
    } catch { /* fallback to country code map */ }
  }
  const TIMEZONE_OFFSETS: Record<string, number> = {
    IN: 5.5, US: -5, UK: 0, GB: 0, AU: 10, AE: 4, SA: 3, PK: 5, BD: 6, SG: 8, JP: 9, DE: 1, FR: 1, CA: -5, NZ: 12, ZA: 2, NG: 1, KE: 3, BR: -3
  };
  if (profile?.country && TIMEZONE_OFFSETS[profile.country.toUpperCase()] !== undefined) {
    return TIMEZONE_OFFSETS[profile.country.toUpperCase()];
  }
  return 5.5; // Default IST
}

/**
 * BUG-03: Converts a deterministically-extracted ReminderIntent into a ReminderSpec
 * that ReminderEngine can parse and schedule. Pure deterministic logic — no LLM.
 *
 * Handles:
 *   - "in N minutes/hours" → relative_value + relative_unit
 *   - "kal [N baje|at N]"  → tomorrow's date + time_of_day
 *   - "N baje" / "N am/pm" / "at N" / "shaam/subah/dopahar/raat" → time_of_day (24h)
 *   - "HH:MM"              → time_of_day
 */
export function buildReminderSpecFromIntent(intent: { text: string; timePhrase: string; rawTime: string; isAmbiguous: boolean }, userTzOffsetHours: number = 5.5): ReminderSpec {
  const fullText = intent.text;
  const textLower = fullText.toLowerCase();

  // Strip reminder-intent keywords and time phrases from the text to get a clean title
  let title = fullText
    .replace(/\b(yaad dila(o|na)?|yaad kar dena|yaad kara|mujhe yaad|remind me|set reminder|alarm laga|mujhe remind|yaad rakhna|yaad dena)\b/gi, '')
    .replace(/\b(kal|aaj|subah|shaam|dopahar|raat|morning|evening|afternoon|night)\b/gi, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm|baje)?\b/gi, '')
    .replace(/\b(in\s+\d+\s*min(utes?)?|in\s+\d+\s*hour(s)?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Fallback to original text cleaned if title became empty
  if (!title || title.length < 3) {
    title = intent.text
      .replace(/\b(yaad dila(o|na)?|yaad kar dena|yaad kara|mujhe yaad|remind me|set reminder|alarm laga|mujhe remind|yaad rakhna|yaad dena)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (!title) title = 'Reminder';
  title = title.substring(0, 80);

  // 1. Relative time: "in N min", "in N hours"
  const inMinMatch = textLower.match(/in\s+(\d+)\s*min(?:utes?)?/);
  if (inMinMatch) {
    return { title, relative_value: parseInt(inMinMatch[1], 10), relative_unit: 'minutes', is_auto: false };
  }
  const inHrMatch = textLower.match(/in\s+(\d+)\s*hour(?:s)?/);
  if (inHrMatch) {
    return { title, relative_value: parseInt(inHrMatch[1], 10), relative_unit: 'hours', is_auto: false };
  }

  // 2. Tomorrow prefix: "kal"
  const hasKal = /\bkal\b/i.test(textLower);
  let dateStr: string | undefined = undefined;
  if (hasKal) {
    const nowLocal = new Date(Date.now() + userTzOffsetHours * 3600000);
    nowLocal.setUTCDate(nowLocal.getUTCDate() + 1);
    dateStr = nowLocal.toISOString().slice(0, 10);
  }

  // 3. Detect time of day
  const isPM = /\b(pm|shaam|dopahar|evening|afternoon)\b/i.test(textLower);
  const isAM = /\b(am|subah|morning)\b/i.test(textLower);
  const isRaat = /\b(raat|night)\b/i.test(textLower);

  const timeNumMatch = textLower.match(/(\d{1,2})(?::(\d{2}))?/);
  if (timeNumMatch) {
    let hh = parseInt(timeNumMatch[1], 10);
    const mm = timeNumMatch[2] ? parseInt(timeNumMatch[2], 10) : 0;

    if (hh > 12 && hh <= 23) {
      const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      return { title, date: dateStr, time_of_day: timeStr, is_auto: false };
    }

    if (isPM) {
      if (hh < 12) hh += 12;
    } else if (isAM) {
      if (hh === 12) hh = 0;
    } else if (isRaat) {
      if (hh >= 7 && hh <= 11) hh += 12;
      else if (hh === 12) hh = 0;
    } else {
      // Bare "N baje" or "at N"
      // In everyday reminder context, 1..6 o'clock defaults to PM (13:00..18:00)
      if (hh >= 1 && hh <= 6) {
        hh += 12;
      } else if (hh >= 7 && hh <= 11) {
        const nowLocal = new Date(Date.now() + userTzOffsetHours * 3600000);
        const currentLocalHour = nowLocal.getUTCHours();
        if (currentLocalHour >= hh && (hh + 12) > currentLocalHour) {
          hh += 12;
        }
      }
    }

    const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    return { title, date: dateStr, time_of_day: timeStr, is_auto: false };
  }

  // Fallback: relative 5 minutes
  return { title, relative_value: 5, relative_unit: 'minutes', is_auto: false };
}

export class ReminderEngine {
  public tzOffsetHours: number;

  constructor(tzOffsetHours: number = 5.5) {
    this.tzOffsetHours = tzOffsetHours;
  }

  /**
   * Returns "now" adjusted to user's local timezone (as a UTC Date).
   */
  private get localNow(): Date {
    return new Date(Date.now() + this.tzOffsetHours * 3600000);
  }

  /**
   * Convert local-time Date (treated as UTC internally) to real UTC
   */
  private localToUtc(localDate: Date): Date {
    return new Date(localDate.getTime() - this.tzOffsetHours * 3600000);
  }

  /**
   * Parse a single ReminderSpec into one or more ParsedReminders.
   * Returns an array because batch specs expand into multiple reminders.
   */
  parse(spec: ReminderSpec): ParsedReminder[] {
    // Event-triggered reminders have NO fixed time — they fire when the event is
    // signalled (e.g. "remind me when I wake up"). trigger_at stays null.
    if (spec.event_trigger) {
      return [{
        text: spec.title || 'Reminder',
        trigger_at: null,
        is_auto: spec.is_auto || false,
        notes: spec.notes,
        event_trigger: spec.event_trigger,
        purpose: spec.purpose,
        urgency: spec.urgency,
        end_condition: spec.end_condition,
      }];
    }

    const localNow = this.localNow;
    let baseTriggerLocal: Date;

    // ── 1. Resolve base trigger time ────────────────────────────────────────
    if (spec.relative_value !== undefined && spec.relative_value !== null) {
      // "in 2 minutes", "after 3 hours", etc.
      baseTriggerLocal = new Date(localNow);
      const unit = spec.relative_unit ? this.normalizeUnit(spec.relative_unit) : 'minutes';
      baseTriggerLocal = this.addDuration(baseTriggerLocal, spec.relative_value, unit);

    } else if (spec.date && spec.time_of_day) {
      // Specific date + time: "2027-12-15 at 07:00"
      const [year, month, day] = spec.date.split('-').map(Number);
      const [hh, mm] = spec.time_of_day.split(':').map(Number);
      baseTriggerLocal = new Date(Date.UTC(year, month - 1, day, hh, mm || 0, 0, 0));

    } else if (spec.date) {
      // Specific date, no time → use 9am
      const [year, month, day] = spec.date.split('-').map(Number);
      baseTriggerLocal = new Date(Date.UTC(year, month - 1, day, 9, 0, 0, 0));

    } else if (spec.time_of_day) {
      // Time of day only → today if in future, else tomorrow
      const [hh, mm] = spec.time_of_day.split(':').map(Number);
      baseTriggerLocal = new Date(localNow);
      baseTriggerLocal.setUTCHours(hh, mm || 0, 0, 0);
      // If that time has already passed today, move to tomorrow
      if (baseTriggerLocal.getTime() <= localNow.getTime()) {
        baseTriggerLocal.setUTCDate(baseTriggerLocal.getUTCDate() + 1);
      }

    } else {
      // Fallback: 5 minutes from now
      baseTriggerLocal = new Date(localNow.getTime() + 5 * 60 * 1000);
    }

    // ── 2. If day filtering is set, advance to next valid day ───────────────
    if (spec.active_days && spec.active_days.length > 0) {
      baseTriggerLocal = this.advanceToValidDay(baseTriggerLocal, spec.active_days);
    }

    // ── 3. If month filtering is set, advance to next valid month ───────────
    if (spec.active_months && spec.active_months.length > 0) {
      baseTriggerLocal = this.advanceToValidMonth(baseTriggerLocal, spec.active_months, spec.active_year);
    }

    // ── 4. Batch expansion ──────────────────────────────────────────────────
    if (spec.batch_count && spec.batch_count > 1 && spec.batch_interval_minutes) {
      const batchTitle = spec.title || 'Reminder';
      const results: ParsedReminder[] = [];
      for (let i = 0; i < spec.batch_count; i++) {
        const batchTriggerLocal = new Date(baseTriggerLocal.getTime() + i * spec.batch_interval_minutes * 60000);
        results.push({
          text: batchTitle,
          trigger_at: this.localToUtc(batchTriggerLocal),
          is_auto: spec.is_auto || false,
          notes: spec.notes,
          active_days: spec.active_days,
          active_months: spec.active_months,
          active_year: spec.active_year,
          purpose: spec.purpose,
          urgency: spec.urgency,
          end_condition: spec.end_condition,
        });
      }
      return results;
    }

    // ── 5. Single reminder ──────────────────────────────────────────────────
    const parsed: ParsedReminder = {
      text: spec.title || 'Reminder',
      trigger_at: this.localToUtc(baseTriggerLocal),
      is_auto: spec.is_auto || false,
      notes: spec.notes,
      purpose: spec.purpose,
      urgency: spec.urgency,
      end_condition: spec.end_condition,
    };

    if (spec.active_days && spec.active_days.length > 0) {
      parsed.active_days = spec.active_days.map(d => d.toLowerCase());
    }
    if (spec.active_months && spec.active_months.length > 0) {
      parsed.active_months = spec.active_months.map(m => m.toLowerCase());
    }
    if (spec.active_year) {
      parsed.active_year = spec.active_year;
    }

    // Recurrence
    if (spec.recurrence_interval_value && spec.recurrence_interval_unit) {
      parsed.recurrence_type = this.normalizeUnit(spec.recurrence_interval_unit);
      parsed.recurrence_interval = spec.recurrence_interval_value;
    }
    if (spec.recurrence_limit) {
      parsed.recurrence_limit = spec.recurrence_limit;
    }
    if (spec.end_at) {
      const endDate = new Date(spec.end_at.replace(' ', 'T'));
      if (!isNaN(endDate.getTime())) {
        parsed.end_at = endDate;
      }
    }

    return [parsed];
  }

  /**
   * Insert one or more parsed reminders into the database with cross-turn active idempotency.
   * If an equivalent active reminder already exists for this user (same normalized text,
   * same trigger time within 60s, same recurrence, status=active), the existing reminder
   * is reused and returned with `alreadyExists: true` without creating a duplicate row.
   */
  async scheduleAll(userId: string, parsedReminders: ParsedReminder[]): Promise<ScheduledReminderRow[]> {
    const valid = parsedReminders.filter(r => r.text);
    if (valid.length === 0) return [];

    // Query currently active reminders for this user to check for active equivalent duplicates
    let activeList: any[] = [];
    try {
      const { data: existingActive, error: fetchError } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (fetchError) {
        logger.warn('[ReminderEngine] Failed to query active reminders for deduplication check', { error: fetchError.message });
      } else if (existingActive) {
        activeList = existingActive;
      }
    } catch (fetchErr: any) {
      logger.warn('[ReminderEngine] Active reminder query threw exception', { error: fetchErr.message });
    }

    const results: ScheduledReminderRow[] = [];
    const rowsToInsert: any[] = [];
    const insertIndices: number[] = [];

    const normalizeText = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const getTokens = (str: string) =>
      (str || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !['muje','mujhe','mera','meri','mere','karo','karna','liye','baje','remind','yaad'].includes(w));

    const hasCoreTokenOverlap = (s1: string, s2: string): boolean => {
      const t1 = getTokens(s1);
      const t2 = getTokens(s2);
      if (t1.length === 0 || t2.length === 0) return false;
      const common = t1.filter(token => t2.includes(token));
      return common.length > 0 && common.length >= Math.min(t1.length, t2.length) * 0.5;
    };

    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      const targetTriggerTime = r.trigger_at ? r.trigger_at.getTime() : null;
      const normTargetText = normalizeText(r.text);

      // Find if an equivalent active reminder already exists
      const match = activeList.find(existing => {
        // 1. Text equivalence
        const normExistingText = normalizeText(existing.text);
        const textMatches = normExistingText === normTargetText ||
          (normTargetText.length >= 6 && normExistingText.length >= 6 &&
           (normExistingText.includes(normTargetText) || normTargetText.includes(normExistingText))) ||
          hasCoreTokenOverlap(existing.text, r.text);
        if (!textMatches) return false;

        // 2. Time equivalence
        if (targetTriggerTime !== null) {
          if (!existing.trigger_at) return false;
          const existingTime = new Date(existing.trigger_at).getTime();
          if (Math.abs(existingTime - targetTriggerTime) > 60000) return false;
        } else {
          // Event-triggered reminder
          if (existing.trigger_at) return false;
          if (normalizeText(existing.event_trigger || '') !== normalizeText(r.event_trigger || '')) return false;
        }

        // 3. Recurrence equivalence
        const recTypeMatch = (existing.recurrence_type || null) === (r.recurrence_type || null);
        const recIntervalMatch = (existing.recurrence_interval || null) === (r.recurrence_interval || null);
        if (!recTypeMatch || !recIntervalMatch) return false;

        return true;
      });

      if (match) {
        logger.info('[ReminderEngine] Active equivalent reminder found — reusing existing row', {
          id: match.id,
          text: match.text,
          trigger_at: match.trigger_at
        });
        results[i] = { ...match, alreadyExists: true };
      } else {
        insertIndices.push(i);
        rowsToInsert.push({
          user_id: userId,
          text: r.text || 'Reminder',
          trigger_at: r.trigger_at ? r.trigger_at.toISOString() : null,
          recurrence_type: r.recurrence_type || null,
          recurrence_interval: r.recurrence_interval || null,
          recurrence_limit: r.recurrence_limit || null,
          recurrence_count: 0,
          active_days: r.active_days || null,
          active_months: r.active_months || null,
          active_year: r.active_year || null,
          end_at: r.end_at ? r.end_at.toISOString() : null,
          is_auto: r.is_auto,
          notes: r.notes || null,
          status: 'active',
          purpose: r.purpose || null,
          urgency: r.urgency || 'medium',
          event_trigger: r.event_trigger || null,
          end_condition: r.end_condition || 'until_cancelled',
        });
      }
    }

    if (rowsToInsert.length > 0) {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('reminders')
        .insert(rowsToInsert)
        .select('*');

      if (insertError) throw insertError;
      (inserted || []).forEach((row, idx) => {
        const origIdx = insertIndices[idx];
        results[origIdx] = { ...row, alreadyExists: false };
      });
    }

    return results;
  }

  /**
   * Parse and schedule in one step. Returns scheduled rows (newly created or reused).
   */
  async parseAndSchedule(userId: string, spec: ReminderSpec): Promise<ScheduledReminderRow[]> {
    const parsed = this.parse(spec);
    return this.scheduleAll(userId, parsed);
  }

  /**
   * Cancel an active reminder (soft delete → status 'cancelled').
   * Scoped to the user for ownership. Returns true if a row was cancelled.
   */
  async delete(userId: string, id: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .select('id');
    if (error) {
      logger.error('[ReminderEngine] Failed to cancel reminder', { id, error: error.message });
      return false;
    }
    return !!(data && data.length > 0);
  }

  /**
   * Format trigger date(s) for human-readable confirmation using the engine's timezone offset
   */
  formatConfirmation(parsedReminders: ParsedReminder[]): string {
    // Event-triggered reminder — no fixed time.
    if (parsedReminders.length === 1 && !parsedReminders[0].trigger_at) {
      const r = parsedReminders[0];
      return `"${r.text}" — jab aap "${r.event_trigger || 'ye event'}" karo tab yaad dilaaunga!`;
    }
    if (parsedReminders.length === 1) {
      const r = parsedReminders[0];
      const localDateObj = new Date(r.trigger_at!.getTime() + this.tzOffsetHours * 3600000);
      const hh = localDateObj.getUTCHours();
      const mm = localDateObj.getUTCMinutes();
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const hh12 = hh % 12 || 12;
      const localTime = `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}`;
      
      const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const localDate = `${localDateObj.getUTCDate()} ${MONTH_SHORT[localDateObj.getUTCMonth()]} ${localDateObj.getUTCFullYear()}`;

      let msg = `"${r.text}" at ${localTime} on ${localDate}`;
      if (r.recurrence_type && r.recurrence_interval) {
        msg += ` (repeats every ${r.recurrence_interval} ${r.recurrence_type})`;
      }
      if (r.active_days && r.active_days.length > 0) {
        msg += ` — only on ${r.active_days.join(', ')}`;
      }
      if (r.active_months && r.active_months.length > 0) {
        msg += ` — only in ${r.active_months.join(', ')}`;
      }
      return msg;
    }

    const times = parsedReminders.map(r => {
      const localDateObj = new Date(r.trigger_at!.getTime() + this.tzOffsetHours * 3600000);
      const hh = localDateObj.getUTCHours();
      const mm = localDateObj.getUTCMinutes();
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const hh12 = hh % 12 || 12;
      return `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}`;
    });
    return `"${parsedReminders[0].text}" at ${times.join(', ')}`;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private normalizeUnit(unit: string): string {
    const u = unit.toLowerCase().trim();
    if (u.startsWith('mo')) return 'months';
    if (u.startsWith('m')) return 'minutes';
    if (u.startsWith('h')) return 'hours';
    if (u.startsWith('d')) return 'days';
    if (u.startsWith('w')) return 'weeks';
    if (u.startsWith('y')) return 'years';
    return 'minutes'; // ultimate fallback if completely garbage
  }

  private addDuration(date: Date, value: number, unit: string): Date {
    const d = new Date(date);
    switch (unit) {
      case 'minutes': d.setMinutes(d.getMinutes() + value); break;
      case 'hours':   d.setHours(d.getHours() + value); break;
      case 'days':    d.setDate(d.getDate() + value); break;
      case 'weeks':   d.setDate(d.getDate() + value * 7); break;
      case 'months':  d.setMonth(d.getMonth() + value); break;
    }
    return d;
  }

  private advanceToValidDay(date: Date, activeDays: string[]): Date {
    const normalizedDays = activeDays.map(d => d.toLowerCase());
    let d = new Date(date);
    let safety = 0;
    while (safety < 14) {
      const dayName = DAY_NAMES[d.getUTCDay()];
      if (normalizedDays.includes(dayName)) return d;
      d.setUTCDate(d.getUTCDate() + 1);
      safety++;
    }
    return date; // fallback
  }

  private advanceToValidMonth(date: Date, activeMonths: string[], activeYear?: number): Date {
    const normalizedMonths = activeMonths.map(m => m.toLowerCase());
    let d = new Date(date);
    let safety = 0;
    while (safety < 24) {
      const monthName = MONTH_NAMES[d.getUTCMonth()];
      const yearOk = !activeYear || d.getUTCFullYear() === activeYear;
      if (normalizedMonths.includes(monthName) && yearOk) return d;
      // Advance to 1st of next month
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(1);
      safety++;
    }
    return date; // fallback
  }
}

export const reminderEngine = new ReminderEngine(5.5); // Default IST
