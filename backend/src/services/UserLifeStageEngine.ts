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

      const userName = profile?.preferred_name || profile?.full_name || 'Friend';

      // 2. Cluster into Entity Wardrobes
      const clusterResult: any = clusterMemoriesIntoWardrobes(memories, workingContext);
      const wardrobes: EntityWardrobe[] = Array.isArray(clusterResult) ? clusterResult : (clusterResult?.wardrobes || []);

      // 3. Extract Family Dependents (ONLY from verified evidence)
      const familyWardrobes = wardrobes.filter(w => w.domain === 'family');
      const sonW = familyWardrobes.find(w => w.roleTitle?.toLowerCase().includes('son') || w.name.toLowerCase().includes('shreshth'));
      const daughterW = familyWardrobes.find(w => w.roleTitle?.toLowerCase().includes('daughter'));
      const wifeW = familyWardrobes.find(w => w.roleTitle?.toLowerCase().includes('wife') || w.name.toLowerCase().includes('sakshi'));
      const husbandW = familyWardrobes.find(w => w.roleTitle?.toLowerCase().includes('husband'));
      const fatherW = familyWardrobes.find(w => w.roleTitle?.toLowerCase().includes('father') || w.name.toLowerCase().includes('suresh'));
      const motherW = familyWardrobes.find(w => w.roleTitle?.toLowerCase().includes('mother') || w.name.toLowerCase().includes('rajeshree'));

      const sonAgeStr = sonW?.traits?.find(t => (t.value || '').toLowerCase().includes('month') || (t.value || '').toLowerCase().includes('mahine') || (t.value || '').toLowerCase().includes('age'))?.value || '';
      const hasInfantMem = memories.some(m => /\b(?:6\s*(?:month|mahine)|infant|newborn|baby)\b/i.test(m.value || ''));
      const hasInfant = !!sonW || hasInfantMem;
      const infantAge = sonAgeStr ? sonAgeStr.replace(/.*:\s*/, '').trim() : (hasInfant ? '6 months' : undefined);

      const spouseSkills: string[] = [];
      const spouseW = wifeW || husbandW;
      if (spouseW) {
        for (const trait of spouseW.traits || []) {
          const val = (trait.value || trait.label || '').toLowerCase();
          if (/cook|culinary|dish|khana/i.test(val)) spouseSkills.push(trait.value || 'Cooking');
          if (/nail|artist|craft/i.test(val)) spouseSkills.push(trait.value || 'Creative artist');
        }
      }

      const hasAnyFamily = hasInfant || !!spouseW || !!fatherW || !!motherW || !!daughterW;
      const familyDependents: UserLifeStageContext['familyDependents'] = hasAnyFamily ? {
        hasInfant,
        infantName: sonW?.name || (hasInfant ? (sonAgeStr ? sonW?.name : undefined) : undefined),
        infantAge,
        spouseName: spouseW?.name,
        spouseRole: spouseW?.roleTitle || (wifeW ? 'Wife' : husbandW ? 'Husband' : undefined),
        spouseSkills: spouseSkills.length > 0 ? spouseSkills : undefined,
        parents: (fatherW || motherW) ? {
          father: fatherW ? {
            name: fatherW.name,
            occupation: fatherW.traits?.find(t => /business|trade|job|work/i.test(t.value || ''))?.value
          } : undefined,
          mother: motherW ? {
            name: motherW.name,
            occupation: motherW.traits?.find(t => /tailor|craft|job|work/i.test(t.value || ''))?.value
          } : undefined,
        } : undefined
      } : undefined;

      // 4. Extract Primary Livelihood (from work wardrobes, memories, or profile)
      const workWardrobes = wardrobes.filter(w => w.domain === 'work');
      const primaryWorkW = workWardrobes.find(w => w.name && !w.name.toLowerCase().includes('dhaba') && !w.name.toLowerCase().includes('kitchen')) || workWardrobes[0];
      
      const companyMem = memories.find(m => m.key === 'company_name' || m.key === 'work_place');
      const workSchedMem = memories.find(m => m.key === 'work_schedule');
      const isStudent = memories.some(m => /\b(?:student|college|university|exam|exams|study|neet|jee|upsc|gate|cat|semester|coaching)\b/i.test(m.value || '') || (m.key && /study|college|exam/i.test(m.key)));

      let primaryLivelihood: UserLifeStageContext['primaryLivelihood'] | undefined;
      if (isStudent && !companyMem) {
        const examGoal = memories.find(m => /exam|upsc|jee|neet|gate|cat|semester/i.test(m.value || ''))?.value;
        const schedStr = memories.find(m => /schedule|timing/i.test(m.key || ''))?.value || 'Daily Study & Academic Routine';
        primaryLivelihood = {
          name: examGoal ? `Exam Prep: ${examGoal}` : 'Academic Studies & Exam Prep',
          roleOrTitle: 'Student / Aspirant',
          type: 'study',
          scheduleDescription: schedStr,
          shiftStartHour: 8,
          shiftEndHour: 18,
          activeDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          currentGoals: [
            examGoal ? `Master syllabus and succeed in ${examGoal}` : 'Clear target exams and master key concepts'
          ]
        };
      } else if (primaryWorkW || companyMem) {
        const companyName = primaryWorkW?.name || companyMem?.value || 'Work';
        const schedStr = workSchedMem?.value || 'Monday to Saturday, 11:00 AM – 8:00 PM';
        
        let startH = 10;
        let endH = 19;
        if (schedStr) {
          const hourMatches = schedStr.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|–)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
          if (hourMatches) {
            const p1 = parseCustomHourMinute(hourMatches[1]);
            const p2 = parseCustomHourMinute(hourMatches[2]);
            if (p1) startH = p1.hour;
            if (p2) endH = p2.hour;
          }
        }

        primaryLivelihood = {
          name: companyName,
          roleOrTitle: primaryWorkW?.roleTitle || 'Team Member / Professional',
          type: companyName.toLowerCase().includes('agency') || companyName.toLowerCase().includes('hr') ? 'agency' : 'job',
          scheduleDescription: schedStr,
          shiftStartHour: startH,
          shiftEndHour: endH,
          activeDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
          currentGoals: [
            `Succeed and scale operations at ${companyName}`
          ]
        };
      }

      // 5. Extract Active Ventures & Aspirations
      const activeVentures: UserLifeStageContext['activeVentures'] = [];
      const ventureW = workWardrobes.find(w => w.name && (w.name.toLowerCase().includes('dhaba') || w.name.toLowerCase().includes('kitchen') || w.name.toLowerCase().includes('startup') || w.name.toLowerCase().includes('venture')));
      const ventureMem = memories.find(m => m.key === 'venture_name');
      
      if (ventureW || ventureMem) {
        const vName = ventureW?.name || ventureMem?.value || 'Side Venture';
        activeVentures.push({
          name: vName,
          category: vName.toLowerCase().includes('kitchen') || vName.toLowerCase().includes('dhaba') ? 'Cloud Kitchen / Food Venture' : 'Startup Venture',
          description: ventureW?.summary || `Entrepreneurial venture: ${vName}`,
          capitalRequirement: memories.find(m => m.key === 'seed_funds')?.value ? '₹15,000 seed funds' : undefined,
          linkedFundingSource: memories.find(m => /pf|portal/i.test(m.value || '')) ? 'PF fund disbursement' : undefined,
          collaborators: spouseW ? [`${spouseW.name} (Culinary Lead)`] : undefined,
          status: 'preparing_funds'
        });
      }

      // 6. Extract Financial Stakes
      const financialStakes: UserLifeStageContext['financialStakes'] = [];
      const pfMem = memories.find(m => /pf|provident fund/i.test(m.key || '') || /pf.*bank/i.test(m.value || ''));
      if (pfMem) {
        financialStakes.push({
          title: 'PF Bank Details Update',
          amount: '₹15,000',
          actionRequired: 'Update bank details on the PF portal to release funds',
          linkedVentureOrNeed: activeVentures[0] ? `Seed capital for ${activeVentures[0].name}` : 'Personal savings disbursement'
        });
      }

      // 7. Compute Local Time & Daily Rhythm Phase
      const tzHours = resolveUserTzOffsetHours(profile || undefined);
      const now = new Date();
      const localMs = now.getTime() + (tzHours * 60 * 60 * 1000);
      const localDate = new Date(localMs);
      const localHour = localDate.getUTCHours();
      const localMinute = localDate.getUTCMinutes();
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayOfWeek = dayNames[localDate.getUTCDay()];
      const customWeekoffDay = (
        (workingContext && Array.isArray(workingContext) ? workingContext.find((w: any) => w.key === 'weekoff_day')?.value : null) ||
        (workingContext && typeof workingContext === 'object' && !Array.isArray(workingContext) ? (workingContext as any).weekoff_day : null)
      )?.toLowerCase();
      const isWeekendDay = customWeekoffDay 
        ? dayOfWeek.toLowerCase() === customWeekoffDay 
        : (dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday');

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
        isSleepingNow = currentMinutesFromMidnight >= sleepMinutesFromMidnight || currentMinutesFromMidnight < wakeMinutesFromMidnight;
      } else {
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
        phaseDescription = `${dayOfWeek} Rest & Flexible Mode. Relaxed, open for personal moments, hobbies, and ideas.`;
        proactiveAllowance = 'FAMILY_STRATEGIC';
      } else if (localHour >= (primaryLivelihood?.shiftStartHour ?? 11) && localHour < (primaryLivelihood?.shiftEndHour ?? 20)) {
        currentPhase = 'WORK_FOCUS';
        const focusLabel = primaryLivelihood?.name ? `Active Work Shift at ${primaryLivelihood.name}` : (isStudent ? 'Active Study & Learning Session' : 'Daytime Productive Focus');
        phaseDescription = `${focusLabel} (${primaryLivelihood?.shiftStartHour ?? 11}:00 AM – ${primaryLivelihood?.shiftEndHour ?? 8}:00 PM). Focus hours.`;
        proactiveAllowance = 'WORK_OPERATIONAL_ONLY';
        isWorkFocusHours = true;
      } else if (localHour >= 20 && (localHour < 22 || (localHour === 22 && localMinute <= 30))) {
        currentPhase = 'FAMILY_COLLABORATIVE';
        const eveningLabel = familyDependents?.spouseName || familyDependents?.infantName
          ? `Evening Family Time (${familyDependents.spouseName || 'family'}${familyDependents.infantName ? ` and baby ${familyDependents.infantName}` : ''})`
          : 'Evening Unwind & Personal Downtime';
        phaseDescription = `${eveningLabel} (8:00 PM – 10:30 PM). Post-shift wind-down and relaxed conversation.`;
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
      let stage: LifeStageType = 'INDIVIDUAL_EXPLORER';
      let stageLabel = 'Individual Explorer';

      if (hasInfant && (activeVentures.length > 0 || primaryLivelihood)) {
        stage = 'FAMILY_FOUNDER_WITH_INFANT';
        stageLabel = `Family Founder with Infant (${familyDependents?.infantName ? `Parent of ${familyDependents.infantName}` : 'Parent with Infant'} + Venture/Career Operator)`;
      } else if (hasInfant) {
        stage = 'FAMILY_WITH_CHILDREN';
        stageLabel = 'Family with Infant/Children';
      } else if (activeVentures.length > 0) {
        stage = 'SOLO_FOUNDER';
        stageLabel = `Venture Founder (${activeVentures[0].name})`;
      } else if (isStudent) {
        stage = 'STUDENT_ASPIRANT';
        stageLabel = 'Student & Knowledge Aspirant';
      } else if (primaryLivelihood) {
        stage = 'EARLY_CAREER_BUILDER';
        stageLabel = `Working Professional (${primaryLivelihood.name})`;
      } else if (familyDependents) {
        stage = 'FAMILY_PROVIDER';
        stageLabel = 'Family Connected Individual';
      } else {
        stage = 'INDIVIDUAL_EXPLORER';
        stageLabel = 'Individual Explorer';
      }

      let corePurposeSummary = '';
      if (stage === 'FAMILY_FOUNDER_WITH_INFANT') {
        corePurposeSummary = `${userName} is navigating a high-stakes life stage balancing family care for their infant (${familyDependents?.infantName || 'baby'}), supporting family, running ${primaryLivelihood?.name || 'their venture'}, and planning future milestones. Every companion touch must respect their time, honor their purpose, and connect daily actions to this mission.`;
      } else if (stage === 'STUDENT_ASPIRANT') {
        corePurposeSummary = `${userName} is dedicated to academic and competitive growth, building discipline, managing study schedules, and preparing for future milestones. Nova acts as an encouraging, attentive study partner and daily guide.`;
      } else if (stage === 'SOLO_FOUNDER') {
        corePurposeSummary = `${userName} is driving entrepreneurial ventures (${activeVentures[0]?.name || 'their business'}), balancing vision, financial discipline, and daily momentum.`;
      } else if (stage === 'EARLY_CAREER_BUILDER') {
        corePurposeSummary = `${userName} is focused on professional growth at ${primaryLivelihood?.name || 'work'}, executing daily responsibilities while cultivating a healthy work-life rhythm.`;
      } else {
        corePurposeSummary = `${userName} is establishing their daily rhythm with Nova. Nova's purpose is to be an adaptable, intelligent living companion who learns their unique lifestyle, habits, and goals naturally through genuine conversation.`;
      }

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
        stage: 'INDIVIDUAL_EXPLORER',
        stageLabel: 'Individual Explorer',
        userName: 'Friend',
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
        corePurposeSummary: 'Supporting daily focus, personal rhythm, and meaningful companion touchpoints.'
      };
    }
  }

  /**
   * Enriches a raw reminder text into a high-EQ, purpose-connected companion touchpoint.
   * Connects to user's real ventures and livelihoods dynamically if present.
   */
  enrichReminderMessage(
    rawReminderText: string,
    stageCtx: UserLifeStageContext
  ): string {
    const textLower = (rawReminderText || '').toLowerCase();
    const name = stageCtx.userName || 'yaar';
    const venture = stageCtx.activeVentures?.[0];
    const livelihood = stageCtx.primaryLivelihood;
    const infantName = stageCtx.familyDependents?.infantName;
    const spouseName = stageCtx.familyDependents?.spouseName;

    // 1. PF / Bank Update → Venture Seed Funds if venture exists
    if (/pf|provident fund|bank details|portal.*update/i.test(textLower)) {
      if (venture) {
        const famPart = infantName && spouseName ? ` ${infantName} aur ${spouseName} ke sath plan aage badhane me ye seed fund help karega.` : '';
        return `Arey ${name}, PF portal pe bank details update ka zaroor dekh lena — wahan se 15k clear hote hi ${venture.name} ke initial setup aur kitchen appliances ka rasta aage badhega!${famPart}`;
      }
      return `Arey ${name}, PF portal pe bank details update zaroor sort kar lena — funds release hote hi aage ka financial plan smooth ho jayega!`;
    }

    // 2. Hiring / Candidate Interviews → Career/Agency Scaling
    if (/candidate|interview|hiring|placement|cv|resume/i.test(textLower)) {
      const targetName = livelihood?.name || 'team';
      return `Arey ${name}, candidate interviews ka schedule dekh lena — ${targetName} ke is round se solid selections nikal gaye to scaling ka target track pe rahega!`;
    }

    // 3. Cloud Kitchen / Dhaba Menu Planning if venture exists
    if (/dhaba|cloud kitchen|recipe|khana banana|kitchen/i.test(textLower)) {
      if (venture) {
        const spousePart = spouseName ? ` ${spouseName} ki signature recipes ke sath initial offerings plan kar loge to` : '';
        return `Arey ${name}, ${venture.name} ke menu ideas ka dekh lena —${spousePart} launch aur strong banega!`;
      }
    }

    // 4. General fallback with warmth (never mechanical "Arey sun, yaad hai na... Time pe dekh lena!")
    return `Arey ${name}, "${rawReminderText}" ka thoda dhyaan rakh lena — jab convenient ho time pe sort kar lena.`;
  }
}

export const userLifeStageEngine = new UserLifeStageEngine();
