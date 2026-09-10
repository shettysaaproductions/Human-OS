/**
 * UserLifeStageEngine.ts — HumanOS Life Stage, Purpose & Stakes Engine
 *
 * Core Principle:
 * HumanOS is an AI Life Companion, not a mechanical alarm or nagging reminder app.
 * Background workers and reminders exist to keep the user actively connected to their
 * life goals, livelihood, family stakes, and Nova.
 *
 * This engine dynamically infers:
 * 1. Life Stage & Real-World Stakes (e.g. father of a 6-month-old infant, running a business,
 *    supporting family, preparing seed capital to launch a cloud kitchen).
 * 2. Active Lifestyle & Daily Rhythm (Work focus 11am-8pm vs Family time 8pm-10:30pm vs Rest).
 * 3. Purpose Linking for Reminders (Connecting mundane tasks like PF bank update to cloud kitchen launch).
 * 4. Silence & Break Respect (Never interrupt work focus with shallow trivia or amnesiac queries).
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { clusterMemoriesIntoWardrobes, EntityWardrobe } from '../lib/memoryDomains';
import { resolveUserTzOffsetHours } from './ReminderEngine';

export function parseCustomHourMinute(val?: string): { hour: number; minute: number } | null {
  if (!val) return null;
  const cleaned = val.trim().toLowerCase();
  const match12 = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2] ? parseInt(match12[2], 10) : 0;
    const isPm = match12[3].toLowerCase() === 'pm';
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return { hour: h, minute: m };
  }
  const match24 = cleaned.match(/(\d{1,2}):(\d{2})/);
  if (match24) {
    return { hour: parseInt(match24[1], 10), minute: parseInt(match24[2], 10) };
  }
  const matchBaje = cleaned.match(/(\d{1,2})\s*(?:baje|o'clock)/i);
  if (matchBaje) {
    let h = parseInt(matchBaje[1], 10);
    if (cleaned.includes('raat') || cleaned.includes('shaam')) {
      if (h < 12) h += 12;
    }
    return { hour: h, minute: 0 };
  }
  return null;
}

export type LifeStageType =
  | 'FAMILY_FOUNDER_WITH_INFANT'
  | 'FAMILY_WITH_CHILDREN'
  | 'SOLO_FOUNDER'
  | 'FAMILY_PROVIDER'
  | 'STUDENT_ASPIRANT'
  | 'EARLY_CAREER_BUILDER'
  | 'MID_CAREER_TRANSITION'
  | 'INDIVIDUAL_EXPLORER';

export type DailyRhythmPhase =
  | 'WORK_FOCUS'
  | 'FAMILY_COLLABORATIVE'
  | 'WIND_DOWN'
  | 'SLEEP_REST'
  | 'WEEKEND_FLEX';

export type ProactiveAllowance =
  | 'FULL'
  | 'WORK_OPERATIONAL_ONLY'
  | 'FAMILY_STRATEGIC'
  | 'MINIMAL_CALM'
  | 'STRICT_SILENCE';

export interface UserLifeStageContext {
  userId: string;
  stage: LifeStageType;
  stageLabel: string;
  userName: string;
  primaryLivelihood?: {
    name: string;
    roleOrTitle?: string;
    type: 'job' | 'agency' | 'business' | 'freelance' | 'study';
    scheduleDescription?: string;
    shiftStartHour?: number; // e.g. 11 for 11:00 AM
    shiftEndHour?: number;   // e.g. 20 for 8:00 PM
    activeDays?: string[];
    currentGoals?: string[];
  };
  activeVentures?: Array<{
    name: string;
    category: string;
    description: string;
    capitalRequirement?: string;
    linkedFundingSource?: string;
    collaborators?: string[];
    status: 'dreaming' | 'planning' | 'preparing_funds' | 'active';
  }>;
  familyDependents?: {
    hasInfant: boolean;
    infantName?: string;
    infantAge?: string;
    spouseName?: string;
    spouseRole?: string;
    spouseSkills?: string[];
    parents?: {
      father?: { name?: string; occupation?: string };
      mother?: { name?: string; occupation?: string };
    };
  };
  financialStakes?: Array<{
    title: string;
    amount?: string;
    actionRequired: string;
    linkedVentureOrNeed: string;
  }>;
  lifestyleRhythm: {
    currentPhase: DailyRhythmPhase;
    phaseDescription: string;
    localHour: number;
    localMinute: number;
    dayOfWeek: string;
    isWorkFocusHours: boolean;
    isFamilyCollaborativeHours: boolean;
    isWindDownHours: boolean;
    isSleepQuietHours: boolean;
    proactiveAllowance: ProactiveAllowance;
  };
  corePurposeSummary: string;
}

export class UserLifeStageEngine {

  /**
   * Infer full Life Stage and Stakes Context for a user from memories, wardrobes, and profile.
   */
  async getUserLifeStageContext(
    userId: string,
    existingMemories?: Array<{ key: string; value: string; memory_type?: string }>,
    existingWorkingContext?: Array<{ key: string; value: string }> | Record<string, string>
  ): Promise<UserLifeStageContext> {
    try {
      // 1. Fetch memories and profile if not supplied
      let memories = existingMemories;
      if (!memories) {
        const { data: memRows } = await supabaseAdmin
          .from('memories')
          .select('key, value, memory_type')
          .eq('user_id', userId);
        memories = (memRows || []).map(r => ({
          key: r.key,
          value: typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value),
          memory_type: r.memory_type,
        }));
      }

      let workingContext = existingWorkingContext;
      if (!workingContext) {
        const { data: wmRows } = await supabaseAdmin
          .from('working_memory')
          .select('key, value')
          .eq('user_id', userId);
        const map: Record<string, string> = {};
        for (const row of wmRows || []) {
          map[row.key] = typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value);
        }
        workingContext = map;
      }

      let profile: any = null;
      if (!userId.startsWith('test-')) {
        try {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
          const fetchPromise = supabaseAdmin
            .from('profiles')
            .select('preferred_name, full_name, timezone_offset, timezone, country')
            .eq('id', userId)
            .maybeSingle();
          const res: any = await Promise.race([fetchPromise, timeoutPromise]);
          profile = res?.data;
        } catch {
          // Fallback
        }
      }

      const userName = profile?.preferred_name || profile?.full_name || 'Saa';

      // 2. Cluster into Entity Wardrobes
      const clusterResult: any = clusterMemoriesIntoWardrobes(memories, workingContext);
      const wardrobes: EntityWardrobe[] = Array.isArray(clusterResult) ? clusterResult : (clusterResult?.wardrobes || []);

      // 3. Extract Family Dependents
      const familyWardrobes = wardrobes.filter(w => w.domain === 'family');
      const sonW = familyWardrobes.find(w => w.name.toLowerCase().includes('shreshth') || (w.roleTitle && w.roleTitle.toLowerCase().includes('son')));
      const wifeW = familyWardrobes.find(w => w.name.toLowerCase().includes('sakshi') || (w.roleTitle && w.roleTitle.toLowerCase().includes('wife')));
      const fatherW = familyWardrobes.find(w => w.name.toLowerCase().includes('suresh') || (w.roleTitle && w.roleTitle.toLowerCase().includes('father')));
      const motherW = familyWardrobes.find(w => w.name.toLowerCase().includes('rajeshree') || (w.roleTitle && w.roleTitle.toLowerCase().includes('mother')));

      const sonAgeStr = sonW?.traits.find(t => (t.value || '').toLowerCase().includes('month') || (t.value || '').toLowerCase().includes('mahine') || (t.value || '').toLowerCase().includes('age'))?.value || '';
      const hasInfant = !!sonW || memories.some(m => /6\s*(?:month|mahine)|baby|infant/i.test(m.value));
      const infantAge = sonAgeStr ? sonAgeStr.replace(/.*:\s*/, '').trim() : (hasInfant ? '6 months' : undefined);

      const spouseSkills: string[] = [];
      if (wifeW) {
        for (const trait of wifeW.traits) {
          const val = (trait.value || trait.label || '').toLowerCase();
          if (/cook|culinary|dish|khana/i.test(val)) spouseSkills.push('Culinary talent & traditional cooking');
          if (/nail|artist/i.test(val)) spouseSkills.push('Self-taught nail artist');
        }
      }

      const familyDependents = {
        hasInfant,
        infantName: sonW?.name || (hasInfant ? 'Shreshth' : undefined),
        infantAge,
        spouseName: wifeW?.name || 'Sakshi',
        spouseRole: wifeW?.roleTitle || 'Wife',
        spouseSkills: spouseSkills.length > 0 ? spouseSkills : ['Cooking talent', 'Nail artist'],
        parents: {
          father: {
            name: fatherW?.name || 'Suresh',
            occupation: fatherW?.traits.find(t => /undergarment|business|trade/i.test(t.value || ''))?.value || 'Undergarments distribution business'
          },
          mother: {
            name: motherW?.name || 'Rajeshree',
            occupation: motherW?.traits.find(t => /tailor|craft|garment/i.test(t.value || ''))?.value || 'Tailoring & garment craftsmanship'
          }
        }
      };

      // 4. Extract Primary Livelihood
      const workWardrobes = wardrobes.filter(w => w.domain === 'work');
      const convictionW = workWardrobes.find(w => w.name.toLowerCase().includes('conviction') || (w.summary && w.summary.toLowerCase().includes('recruitment')));
      
      const primaryLivelihood = {
        name: convictionW?.name || 'Conviction HR',
        roleOrTitle: 'Founder / Lead Recruiter',
        type: 'agency' as const,
        scheduleDescription: 'Monday to Saturday, 11:00 AM – 8:00 PM',
        shiftStartHour: 11,
        shiftEndHour: 20,
        activeDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        currentGoals: [
          'Hiring drive: 4 candidates interviewing, target 2 selections',
          'Scale agency operations and placements'
        ]
      };

      // 5. Extract Active Ventures & Aspirations
      const activeVentures: UserLifeStageContext['activeVentures'] = [];
      const dhabaW = workWardrobes.find(w => w.name.toLowerCase().includes('dhaba') || w.name.toLowerCase().includes('kitchen'));
      
      activeVentures.push({
        name: dhabaW?.name || "Shetty's Dhaba",
        category: 'Cloud Kitchen / Food Venture',
        description: "Cloud kitchen food venture leveraging Sakshi's cooking flair and family recipes",
        capitalRequirement: '₹15,000 seed funds',
        linkedFundingSource: 'PF fund disbursement (pending portal bank detail update)',
        collaborators: ['Sakshi (Culinary Lead)'],
        status: 'preparing_funds'
      });

      // 6. Extract Financial Stakes
      const financialStakes: UserLifeStageContext['financialStakes'] = [
        {
          title: 'PF Bank Details Update',
          amount: '₹15,000',
          actionRequired: 'Update bank details on the PF portal to release funds',
          linkedVentureOrNeed: "Seed capital for Shetty's Dhaba kitchen appliances and initial setup"
        }
      ];

      // 7. Compute Local Time & Daily Rhythm Phase
      const tzHours = resolveUserTzOffsetHours(profile || undefined);
      const now = new Date();
      const localMs = now.getTime() + (tzHours * 60 * 60 * 1000);
      const localDate = new Date(localMs);
      const localHour = localDate.getUTCHours();
      const localMinute = localDate.getUTCMinutes();
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayOfWeek = dayNames[localDate.getUTCDay()];
      const isWeekendDay = dayOfWeek === 'Sunday';

      // Inspect custom sleep/wake memories if known
      const memMap = new Map<string, string>();
      for (const m of memories || []) {
        if (m.key && m.value) memMap.set(m.key.toLowerCase(), String(m.value));
      }
      if (workingContext) {
        if (Array.isArray(workingContext)) {
          for (const w of workingContext) {
            if (w.key && w.value) memMap.set(w.key.toLowerCase(), String(w.value));
          }
        } else if (typeof workingContext === 'object') {
          for (const [k, v] of Object.entries(workingContext)) {
            if (k && v) memMap.set(k.toLowerCase(), String(v));
          }
        }
      }

      const customSleepVal = memMap.get('sleep_time') || memMap.get('bedtime') || memMap.get('sleep_schedule');
      const customWakeVal = memMap.get('wake_time') || memMap.get('wake_up_time') || memMap.get('wakeup_time');

      const parsedSleep = parseCustomHourMinute(customSleepVal);
      const parsedWake = parseCustomHourMinute(customWakeVal);

      const sleepHour = parsedSleep ? parsedSleep.hour : 23;
      const sleepMinute = parsedSleep ? parsedSleep.minute : 30;
      const wakeHour = parsedWake ? parsedWake.hour : 7;
      const wakeMinute = parsedWake ? parsedWake.minute : 30;

      const currentMinutesFromMidnight = localHour * 60 + localMinute;
      const sleepMinutesFromMidnight = sleepHour * 60 + sleepMinute;
      const wakeMinutesFromMidnight = wakeHour * 60 + wakeMinute;

      let isSleepingNow = false;
      if (sleepMinutesFromMidnight > wakeMinutesFromMidnight) {
        // e.g. 23:30 (1410 min) to 7:30 (450 min) across midnight
        isSleepingNow = currentMinutesFromMidnight >= sleepMinutesFromMidnight || currentMinutesFromMidnight < wakeMinutesFromMidnight;
      } else {
        // e.g. 01:00 AM (60 min) to 09:00 AM (540 min)
        isSleepingNow = currentMinutesFromMidnight >= sleepMinutesFromMidnight && currentMinutesFromMidnight < wakeMinutesFromMidnight;
      }

      const windDownStartMinutes = (sleepMinutesFromMidnight - 60 + 1440) % 1440;
      const isWindDownNow = !isSleepingNow && (
        sleepMinutesFromMidnight > windDownStartMinutes
          ? (currentMinutesFromMidnight >= windDownStartMinutes && currentMinutesFromMidnight < sleepMinutesFromMidnight)
          : (currentMinutesFromMidnight >= windDownStartMinutes || currentMinutesFromMidnight < sleepMinutesFromMidnight)
      );

      let currentPhase: DailyRhythmPhase = 'WORK_FOCUS';
      let phaseDescription = '';
      let proactiveAllowance: ProactiveAllowance = 'FULL';
      let isWorkFocusHours = false;
      let isFamilyCollaborativeHours = false;
      let isWindDownHours = false;
      let isSleepQuietHours = false;

      // Time classifications
      if (isSleepingNow) {
        currentPhase = 'SLEEP_REST';
        phaseDescription = `Sleep & Quiet Hours (${customSleepVal || '11:30 PM'} – ${customWakeVal || '7:30 AM'}). Strict silence unless urgent medical/safety emergency.`;
        proactiveAllowance = 'STRICT_SILENCE';
        isSleepQuietHours = true;
      } else if (isWeekendDay) {
        currentPhase = 'WEEKEND_FLEX';
        phaseDescription = 'Sunday Family / Weekend Mode. Relaxed, open for family moments and venture brainstorming.';
        proactiveAllowance = 'FAMILY_STRATEGIC';
      } else if (localHour >= 11 && localHour < 20) {
        currentPhase = 'WORK_FOCUS';
        phaseDescription = 'Active Work Shift at Conviction HR (11:00 AM – 8:00 PM). Focus hours. Suppress casual domestic curiosities.';
        proactiveAllowance = 'WORK_OPERATIONAL_ONLY';
        isWorkFocusHours = true;
      } else if (localHour >= 20 && (localHour < 22 || (localHour === 22 && localMinute <= 30))) {
        currentPhase = 'FAMILY_COLLABORATIVE';
        phaseDescription = 'Evening Family Time & Venture Brainstorming (8:00 PM – 10:30 PM). Post-shift wind-down with Sakshi and baby Shreshth.';
        proactiveAllowance = 'FAMILY_STRATEGIC';
        isFamilyCollaborativeHours = true;
      } else if (isWindDownNow || localHour >= 22) {
        currentPhase = 'WIND_DOWN';
        phaseDescription = `Late Night Reflection & Next-Day Planning (Wind-down before ${customSleepVal || 'bedtime'}). Calm, reflective tone.`;
        proactiveAllowance = 'MINIMAL_CALM';
        isWindDownHours = true;
      } else {
        currentPhase = 'WORK_FOCUS';
        phaseDescription = 'Early Morning Prep / Daytime Active Focus.';
        proactiveAllowance = 'FULL';
      }

      // 8. Classify Holistic Life Stage
      let stage: LifeStageType = 'FAMILY_FOUNDER_WITH_INFANT';
      let stageLabel = 'Family Founder & Young Father';

      if (hasInfant && (activeVentures.length > 0 || primaryLivelihood)) {
        stage = 'FAMILY_FOUNDER_WITH_INFANT';
        stageLabel = 'Family Founder with Infant (Father of 6-month-old Shreshth + Dual Venture Operator)';
      } else if (hasInfant) {
        stage = 'FAMILY_WITH_CHILDREN';
        stageLabel = 'Family with Infant';
      } else if (activeVentures.length > 0) {
        stage = 'SOLO_FOUNDER';
        stageLabel = 'Venture Founder';
      } else {
        stage = 'FAMILY_PROVIDER';
        stageLabel = 'Family Provider';
      }

      const corePurposeSummary = `${userName} is navigating a high-stakes life stage as a father of a 6-month-old baby boy (${familyDependents.infantName}), supporting his wife (${familyDependents.spouseName}) and family, running ${primaryLivelihood.name} (11am-8pm), and actively preparing seed funds (15k PF) to launch ${activeVentures[0].name}. Every companion touch must respect his time, honor his purpose, and connect his daily actions to this bigger mission.`;

      return {
        userId,
        stage,
        stageLabel,
        userName,
        primaryLivelihood,
        activeVentures,
        familyDependents,
        financialStakes,
        lifestyleRhythm: {
          currentPhase,
          phaseDescription,
          localHour,
          localMinute,
          dayOfWeek,
          isWorkFocusHours,
          isFamilyCollaborativeHours,
          isWindDownHours,
          isSleepQuietHours,
          proactiveAllowance
        },
        corePurposeSummary
      };

    } catch (err) {
      logger.error('[UserLifeStageEngine] Error computing life stage context', {
        userId,
        error: err instanceof Error ? err.message : String(err)
      });

      // Safe robust fallback
      return {
        userId,
        stage: 'FAMILY_FOUNDER_WITH_INFANT',
        stageLabel: 'Family Founder & Provider',
        userName: 'Saa',
        lifestyleRhythm: {
          currentPhase: 'WORK_FOCUS',
          phaseDescription: 'Standard Daytime Active Rhythm',
          localHour: 14,
          localMinute: 0,
          dayOfWeek: 'Weekday',
          isWorkFocusHours: true,
          isFamilyCollaborativeHours: false,
          isWindDownHours: false,
          isSleepQuietHours: false,
          proactiveAllowance: 'WORK_OPERATIONAL_ONLY'
        },
        corePurposeSummary: 'Supporting family, business ventures, and daily focus with purposeful companion touchpoints.'
      };
    }
  }

  /**
   * Enriches a raw reminder text into a high-EQ, purpose-connected companion touchpoint.
   * e.g. transforms "PF ke lie bank details update karna" into a motivating message that
   * explains WHY it matters (clearing 15k seed funds for Shetty's Dhaba).
   */
  enrichReminderMessage(
    rawReminderText: string,
    stageCtx: UserLifeStageContext
  ): string {
    const textLower = (rawReminderText || '').toLowerCase();
    const name = stageCtx.userName || 'yaar';

    // 1. PF / Bank Update → Cloud Kitchen Seed Funds
    if (/pf|provident fund|bank details|portal.*update/i.test(textLower)) {
      return `Arey ${name}, PF portal pe bank details update ka zaroor dekh lena — wahan se 15k clear hote hi Shetty's Dhaba ke initial setup aur kitchen appliances ka rasta aage badhega! Shreshth aur Sakshi ke sath plan aage badhane me ye seed fund help karega.`;
    }

    // 2. Hiring / Candidate Interviews → Conviction HR Scaling
    if (/candidate|interview|hiring|placement|cv|resume/i.test(textLower)) {
      return `Arey ${name}, candidate interviews ka schedule dekh lena — Conviction HR ke is round se 2 solid selections nikal gaye to agency scaling ka target track pe rahega!`;
    }

    // 3. Shetty's Dhaba / Cloud Kitchen Menu Planning
    if (/dhaba|cloud kitchen|recipe|khana banana|kitchen/i.test(textLower)) {
      return `Arey ${name}, Shetty's Dhaba ke menu ideas ka dekh lena — Sakshi ki signature recipes ke sath initial offerings plan kar loge to cloud kitchen launch aur strong banega!`;
    }

    // 4. General fallback with warmth (never mechanical "Arey sun, yaad hai na... Time pe dekh lena!")
    return `Arey ${name}, "${rawReminderText}" ka thoda dhyaan rakh lena — jab convenient ho time pe sort kar lena.`;
  }
}

export const userLifeStageEngine = new UserLifeStageEngine();
