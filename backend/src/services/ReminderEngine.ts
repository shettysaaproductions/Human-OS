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
  // Misc
  notes?: string;
  is_auto?: boolean;
}

export interface ParsedReminder {
  text: string;
  trigger_at: Date;
  recurrence_type?: string;
  recurrence_interval?: number;
  recurrence_limit?: number;
  active_days?: string[];
  active_months?: string[];
  active_year?: number;
  end_at?: Date;
  is_auto: boolean;
  notes?: string;
}

export class ReminderEngine {
  private tzOffsetHours: number;

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
      // Try parse end_at as ISO or "YYYY-MM-DD HH:MM"
      const endDate = new Date(spec.end_at.replace(' ', 'T'));
      if (!isNaN(endDate.getTime())) {
        parsed.end_at = endDate;
      }
    }

    return [parsed];
  }

  /**
   * Insert one or more parsed reminders into the database.
   */
  async scheduleAll(userId: string, parsedReminders: ParsedReminder[]): Promise<any[]> {
    const rows = parsedReminders
      .filter(r => r.text)   // safety net: never insert null text
      .map(r => ({
      user_id: userId,
      text: r.text || 'Reminder',
      trigger_at: r.trigger_at.toISOString(),
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
    }));

    const { data, error } = await supabaseAdmin
      .from('reminders')
      .insert(rows)
      .select('*');

    if (error) throw error;
    return data || [];
  }

  /**
   * Parse and schedule in one step. Returns inserted rows.
   */
  async parseAndSchedule(userId: string, spec: ReminderSpec): Promise<any[]> {
    const parsed = this.parse(spec);
    return this.scheduleAll(userId, parsed);
  }

  /**
   * Format trigger date(s) for human-readable confirmation
   */
  formatConfirmation(parsedReminders: ParsedReminder[]): string {
    if (parsedReminders.length === 1) {
      const r = parsedReminders[0];
      const localTime = r.trigger_at.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
      });
      const localDate = r.trigger_at.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'
      });
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

    const times = parsedReminders.map(r =>
      r.trigger_at.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
      })
    );
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
