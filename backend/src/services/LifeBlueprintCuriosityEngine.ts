/**
 * LifeBlueprintCuriosityEngine.ts
 *
 * Implements the Personal Life Blueprint & Progressive Adaptive Curiosity Engine.
 * Enables Nova to organically, contextually, and progressively discover the user's
 * foundational personal details — age, date of birth, sleep/wake architecture,
 * daily habits, food preferences, and personal choices — to guide and elevate their life.
 *
 * Design Invariants:
 * 1. ZERO INTERROGATION: Never dumps surveys or multiple questions at once.
 * 2. SINGLE NEXT-BEST CURIOSITY: Selects exactly 1 natural, high-EQ question based on time-of-day affinity and situational relevance.
 * 3. TIME-OF-DAY AFFINITY: Asks sleep time during night wind-down, morning habits in morning, food choices around meals, DOB during relaxed chats.
 * 4. ZERO AMNESIA: Inspects both canonical memory keys, aliases, and Entity Wardrobe traits to guarantee facts are never re-asked once known.
 */

import { clusterMemoriesIntoWardrobes, EntityWardrobe } from '../lib/memoryDomains';

export type BlueprintCategory =
  | 'IDENTITY_AND_BIO'
  | 'SLEEP_AND_RHYTHM'
  | 'DIET_AND_HEALTH'
  | 'PERSONAL_CHOICES_AND_RECHARGE'
  | 'LIFE_GOALS_AND_VALUES';

export type CuriosityTimingAffinity =
  | 'ANYTIME_CASUAL'
  | 'MORNING_FRESH'
  | 'MEAL_TIME'
  | 'EVENING_WIND_DOWN'
  | 'WEEKEND_RELAX';

export interface BlueprintItemDefinition {
  key: string;
  category: BlueprintCategory;
  title: string;
  description: string;
  importance: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  timingAffinity: CuriosityTimingAffinity;
  /** Keys or aliases that confirm this blueprint detail is already known */
  matchingKeys: string[];
  /** Regex patterns tested against memory values/traits to confirm knowledge */
  valueEvidencePatterns?: RegExp[];
  /** Warm, high-EQ Hinglish phrasing options */
  promptTemplates: string[];
  /** Why Nova needs this to improve the user's life */
  companionValue: string;
}

export interface EvaluatedBlueprintGap {
  key: string;
  category: BlueprintCategory;
  title: string;
  importance: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  isKnown: boolean;
  knownValue?: string;
  suggestedPrompt: string;
  companionValue: string;
  timingAffinity: CuriosityTimingAffinity;
  timingScore: number;
}

export interface BlueprintGapSummary {
  totalTracked: number;
  knownCount: number;
  missingCount: number;
  completionPercentage: number;
  nextBestCuriosity: EvaluatedBlueprintGap | null;
  missingGapsByCategory: Record<BlueprintCategory, EvaluatedBlueprintGap[]>;
}

export const FOUNDATIONAL_BLUEPRINT_REGISTRY: BlueprintItemDefinition[] = [
  // ── 1. IDENTITY & BIO ANCHORS ──────────────────────────────────────────────
  {
    key: 'birth_date',
    category: 'IDENTITY_AND_BIO',
    title: 'Date of Birth / Birthday',
    description: "User's date of birth or birthday celebration date",
    importance: 'CRITICAL',
    timingAffinity: 'ANYTIME_CASUAL',
    matchingKeys: ['birth_date', 'dob', 'birthday', 'user_birthday', 'date_of_birth', 'birthdate'],
    valueEvidencePatterns: [/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i, /\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i, /\d{4}-\d{2}-\d{2}/],
    promptTemplates: [
      "Arey ek basic cheez miss ho gayi — tumhara birthday ya birth date kab aata hai? Taaki dates aur special milestones pe main hamesha tuned rahoon.",
      "Waise ek baat puchhni thi — tumhara DOB kya hai? Birthday celebrations aur milestone tracking ke lie yaad rakhna chahti hoon."
    ],
    companionValue: "Essential for marking personal milestones, astrology/zodiac context if desired, and annual celebrations."
  },
  {
    key: 'user_age',
    category: 'IDENTITY_AND_BIO',
    title: 'User Age',
    description: "User's current age in years",
    importance: 'HIGH',
    timingAffinity: 'ANYTIME_CASUAL',
    matchingKeys: ['user_age', 'age', 'my_age'],
    valueEvidencePatterns: [/\b\d{2}\s*(?:years|saal|yr|years old)\b/i, /^\d{2}$/],
    promptTemplates: [
      "Waise tumhari age kitni hai? Bas islie puchh rahi hoon taaki tumhare career stage aur life pace ke sath sahi cadence bana sakoon."
    ],
    companionValue: "Helps tailor career advice, energy rhythms, and long-term health pacing."
  },
  {
    key: 'hometown_or_city',
    category: 'IDENTITY_AND_BIO',
    title: 'Hometown & Current City',
    description: 'City where user was born or currently resides',
    importance: 'HIGH',
    timingAffinity: 'ANYTIME_CASUAL',
    matchingKeys: ['city', 'current_city', 'hometown', 'location', 'user_location', 'living_in'],
    valueEvidencePatterns: [/mumbai|delhi|bangalore|bengaluru|pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|lucknow|thane|navi mumbai/i],
    promptTemplates: [
      "Waise tum usually kaunse city me based ho? Taaki local context, weather aur timing ka exact dhyan rakh sakoon."
    ],
    companionValue: "Grounds weather awareness, local time, regional nuances, and cultural moments."
  },
  {
    key: 'native_language',
    category: 'IDENTITY_AND_BIO',
    title: 'Native Language / Cultural Roots',
    description: "User's mother tongue or cultural heritage",
    importance: 'MEDIUM',
    timingAffinity: 'ANYTIME_CASUAL',
    matchingKeys: ['mother_tongue', 'native_language', 'cultural_background', 'home_language'],
    valueEvidencePatterns: [/hindi|tulu|kannada|marathi|gujarati|bengali|tamil|telugu|malayalam|punjabi/i],
    promptTemplates: [
      "Waise ghar pe mostly kaunsi language bolte ho — Hindi ke alawa mother tongue kya hai?"
    ],
    companionValue: "Allows Nova to naturally sprinkle warm cultural phrases and respect heritage."
  },

  // ── 2. DAILY RHYTHM & SLEEP ARCHITECTURE ──────────────────────────────────
  {
    key: 'sleep_time',
    category: 'SLEEP_AND_RHYTHM',
    title: 'Usual Bedtime / Sleep Schedule',
    description: 'What time user typically sleeps or goes to bed',
    importance: 'CRITICAL',
    timingAffinity: 'EVENING_WIND_DOWN',
    matchingKeys: ['sleep_time', 'bed_time', 'sleep_schedule', 'sleep_cycle', 'sleep_hours', 'usual_sleep_time', 'bedtime'],
    valueEvidencePatterns: [/\b(?:10|11|12|1|2)\s*(?::\d{2})?\s*(?:pm|am|baje|o'clock)?\b/i, /sleep.*(?:at|around)\s*\d+/i],
    promptTemplates: [
      "Waise ek zaroori baat puchhni thi — tumhara usual sone ka time kya rehta hai? Taaki main kabhi raat ko untimely ping na karun aur wind-down sahi se plan kar sakein.",
      "Raat ko usually kitne baje sote ho? Taaki tumhare rest hours me strict quiet mode on rakh sakoon aur late night disturbing msgs bilkul na jaayein."
    ],
    companionValue: "Prevents late-night interruptions and automatically sets the system sleep quiet window."
  },
  {
    key: 'wake_time',
    category: 'SLEEP_AND_RHYTHM',
    title: 'Usual Wake-Up Time',
    description: 'What time user typically wakes up to start the day',
    importance: 'HIGH',
    timingAffinity: 'MORNING_FRESH',
    matchingKeys: ['wake_time', 'wake_up_time', 'morning_time', 'wakeup_time', 'usual_wake_time'],
    valueEvidencePatterns: [/\b(?:5|6|7|8|9|10)\s*(?::\d{2})?\s*(?:am|subah|baje)?\b/i, /wake.*(?:at|around)\s*\d+/i],
    promptTemplates: [
      "Subah usually kis time uthte ho? Taaki morning sync aur daily priorities ka timing ekdum perfect rahe.",
      "Tumhara morning wake-up time kya rehta hai usually?"
    ],
    companionValue: "Aligns morning greeting and day-planning touchpoints with the user's natural awakening."
  },
  {
    key: 'morning_starter',
    category: 'SLEEP_AND_RHYTHM',
    title: 'Morning Starter Beverage',
    description: 'First drink or ritual in the morning (Chai vs Coffee vs Water)',
    importance: 'MEDIUM',
    timingAffinity: 'MORNING_FRESH',
    matchingKeys: ['morning_starter', 'morning_drink', 'beverage_preference', 'tea_or_coffee', 'favorite_beverage'],
    valueEvidencePatterns: [/\b(?:chai|tea|coffee|black coffee|espresso|green tea|warm water|nimbu pani)\b/i],
    promptTemplates: [
      "Subah ka starter kya hota hai tumhara — garam chai, strong coffee, ya simple warm water?",
      "Chai person ho ya coffee person? Subah kickstart karne ke lie kya pasand hai?"
    ],
    companionValue: "Enables natural, relatable morning camaraderie and mindful daily check-ins."
  },
  {
    key: 'dinner_time',
    category: 'SLEEP_AND_RHYTHM',
    title: 'Typical Dinner Routine',
    description: 'What time user eats dinner with family',
    importance: 'MEDIUM',
    timingAffinity: 'EVENING_WIND_DOWN',
    matchingKeys: ['dinner_time', 'dinner_routine', 'dinner_hour'],
    valueEvidencePatterns: [/\b(?:8|9|10|11)\s*(?::\d{2})?\s*(?:pm|baje|raat)?\b/i],
    promptTemplates: [
      "Tumhara family ke sath dinner ka time usually kab rehta hai? Taaki us window me work ya alerts pause rakh sakoon."
    ],
    companionValue: "Protects family dining time from proactive interruptions."
  },

  // ── 3. DIET, NUTRITION & ENERGY ───────────────────────────────────────────
  {
    key: 'dietary_preference',
    category: 'DIET_AND_HEALTH',
    title: 'Dietary Preference (Veg / Non-Veg / Eggetarian)',
    description: 'Food preference and dietary habits',
    importance: 'HIGH',
    timingAffinity: 'MEAL_TIME',
    matchingKeys: ['dietary_preference', 'diet_preference', 'food_preference', 'is_veg', 'diet_type'],
    valueEvidencePatterns: [/\b(?:veg|vegetarian|non-veg|non-vegetarian|eggetarian|vegan|jain|pure veg)\b/i],
    promptTemplates: [
      "Waise khane me tumhara kya preference hai — pure vegetarian, non-veg, ya eggetarian?",
      "Food choices me preference kya rehti hai tumhari — veg ya non-veg dono chalte hain?"
    ],
    companionValue: "Crucial for recommending food ideas, venture menu considerations (Shetty's Dhaba), and health tips."
  },
  {
    key: 'comfort_food',
    category: 'DIET_AND_HEALTH',
    title: 'Comfort Food / Favorite Dish',
    description: "User's go-to comfort food when tired or celebrating",
    importance: 'MEDIUM',
    timingAffinity: 'MEAL_TIME',
    matchingKeys: ['comfort_food', 'favorite_dish', 'favorite_food', 'go_to_meal'],
    valueEvidencePatterns: [/\b(?:biryani|dal chawal|roti|paneer|chicken|dosa|idli|khichdi|pasta|pizza|fish curry)\b/i],
    promptTemplates: [
      "Jab lamba din ho aur stress ho, to tumhara go-to comfort food kya hota hai?",
      "Sabse pasandida khana kya hai tumhara jise khakar maza aa jaye?"
    ],
    companionValue: "Helps lift user's mood on tough days and contextualizes culinary passions."
  },

  // ── 4. HEALTH, FITNESS & STRESS RELIEF ────────────────────────────────────
  {
    key: 'fitness_routine',
    category: 'DIET_AND_HEALTH',
    title: 'Fitness & Physical Activity Routine',
    description: 'How user stays physically active (Gym, walking, yoga, sports, none)',
    importance: 'HIGH',
    timingAffinity: 'MORNING_FRESH',
    matchingKeys: ['fitness_routine', 'workout_routine', 'exercise_habit', 'gym_routine', 'daily_walk'],
    valueEvidencePatterns: [/\b(?:gym|walk|walking|running|workout|yoga|cardio|weights|cycling|badminton)\b/i],
    promptTemplates: [
      "Tumhara daily fitness ya physical activity ka kya scene hai — gym, walk, ya abhi busy schedule me paused hai?",
      "Physical routine me kuch follow karte ho jaise morning walk ya workout, ya pure office focus rehta hai?"
    ],
    companionValue: "Allows gentle wellness pacing, posture/walk reminders, and burnout prevention."
  },
  {
    key: 'stress_relief_habit',
    category: 'PERSONAL_CHOICES_AND_RECHARGE',
    title: 'Stress Relief & Decompression Habit',
    description: 'What helps user decompress when work or life gets overwhelming',
    importance: 'HIGH',
    timingAffinity: 'EVENING_WIND_DOWN',
    matchingKeys: ['stress_relief', 'stress_relief_habit', 'decompression_habit', 'recharge_method', 'how_to_relax'],
    valueEvidencePatterns: [/\b(?:music|drive|bike ride|sleeping|talking|gaming|netflix|reading|silence|chai)\b/i],
    promptTemplates: [
      "Jab din bohot hectic aur dimag full ho jaye, to tumhein sabse zyada relax kya karta hai — music, lambi drive, ya bas shanti me baithna?",
      "Tension ya stress me tumhara instant mood-lifter kya hota hai?"
    ],
    companionValue: "Equips Nova with the right calming intervention when high stress or frustration is detected."
  },

  // ── 5. PERSONAL CHOICES, PASSIONS & WEEKEND HABITS ────────────────────────
  {
    key: 'weekend_routine',
    category: 'PERSONAL_CHOICES_AND_RECHARGE',
    title: 'Sunday / Weekend Recharge Style',
    description: 'How user typically likes to spend Sundays or off days',
    importance: 'HIGH',
    timingAffinity: 'WEEKEND_RELAX',
    matchingKeys: ['weekend_routine', 'sunday_routine', 'weekend_habit', 'off_day_habit'],
    valueEvidencePatterns: [/\b(?:family time|sleeping in|outing|cooking|movies|relaxing|chilling|exploring)\b/i],
    promptTemplates: [
      "Sunday ya weekoff pe tumhara usual routine kya hota hai — pura din rest aur family time, ya kuch exploration?",
      "Weekend pe tumhein sabse zyada kya karna pasand hai?"
    ],
    companionValue: "Enables weekend mode personalization and ensures off-days feel restorative."
  },
  {
    key: 'favorite_music_genre',
    category: 'PERSONAL_CHOICES_AND_RECHARGE',
    title: 'Music Taste & Focus Sounds',
    description: 'What music user listens to during work, drive, or chill',
    importance: 'MEDIUM',
    timingAffinity: 'ANYTIME_CASUAL',
    matchingKeys: ['favorite_music', 'music_taste', 'music_genre', 'favorite_songs'],
    valueEvidencePatterns: [/\b(?:lofi|retro|bollywood|ghazal|rock|punjabi|instrumental|hip hop|classical|pop)\b/i],
    promptTemplates: [
      "Gaane sunne ka shauk hai? Kaunsa genre ya artist sabse zyada loop pe rehta hai tumhare headphone me?"
    ],
    companionValue: "Great for building deep emotional rapport and focus music recommendations."
  },
  {
    key: 'daily_commute_mode',
    category: 'PERSONAL_CHOICES_AND_RECHARGE',
    title: 'Daily Commute Mode',
    description: 'How user travels to office/meetings (Bike, Car, Metro, Local train, Walk)',
    importance: 'MEDIUM',
    timingAffinity: 'ANYTIME_CASUAL',
    matchingKeys: ['commute_mode', 'daily_commute', 'travel_mode', 'bike_or_car'],
    valueEvidencePatterns: [/\b(?:bike|motorcycle|scooter|activa|car|metro|train|auto|cab|walk)\b/i],
    promptTemplates: [
      "Daily commute kaise karte ho office ke lie — bike, car, metro ya cab?"
    ],
    companionValue: "Helps tailor travel safety reminders, traffic awareness, and departure timings."
  },

  // ── 6. CORE VALUES & LIFE PHILOSOPHY ──────────────────────────────────────
  {
    key: 'core_personal_value',
    category: 'LIFE_GOALS_AND_VALUES',
    title: 'Core Driving Force / Personal Philosophy',
    description: 'What drives the user deeply (Family security, independence, mastery, legacy)',
    importance: 'HIGH',
    timingAffinity: 'EVENING_WIND_DOWN',
    matchingKeys: ['core_value', 'life_philosophy', 'what_drives_me', 'biggest_motivation'],
    valueEvidencePatterns: [/\b(?:family|freedom|independence|success|wealth|stability|impact|growth)\b/i],
    promptTemplates: [
      "Itni mehnat aur multi-venture hustle ke peeche tumhara sabse bada drive kya hai — family ki stability, personal freedom, ya kuch bada build karna?"
    ],
    companionValue: "Aligns Nova's long-term motivational nudges directly with the user's deepest inner fire."
  }
];

export class LifeBlueprintCuriosityEngine {

  /**
   * Evaluate which foundational blueprint items are already known vs missing.
   */
  evaluateMissingBlueprintGaps(
    memories: Array<{ key: string; value: string; memory_type?: string }>,
    workingContext?: Array<{ key: string; value: string }> | Record<string, string>,
    timeContext?: {
      localHour: number;
      isWeekend: boolean;
      timeOfDayLabel?: string;
    },
    providedWardrobes?: EntityWardrobe[]
  ): BlueprintGapSummary {
    const memMap = new Map<string, string>();
    for (const m of memories || []) {
      if (m.key && m.value) {
        memMap.set(m.key.toLowerCase().trim(), String(m.value).trim());
      }
    }

    if (workingContext) {
      if (Array.isArray(workingContext)) {
        for (const w of workingContext) {
          if (w.key && w.value && !memMap.has(w.key.toLowerCase().trim())) {
            memMap.set(w.key.toLowerCase().trim(), String(w.value).trim());
          }
        }
      } else if (typeof workingContext === 'object') {
        for (const [k, v] of Object.entries(workingContext)) {
          if (k && v && !memMap.has(k.toLowerCase().trim())) {
            memMap.set(k.toLowerCase().trim(), String(v).trim());
          }
        }
      }
    }

    // Also inspect Entity Wardrobes for traits
    let wardrobes = providedWardrobes;
    if (!wardrobes) {
      try {
        const clusterResult: any = clusterMemoriesIntoWardrobes(memories || [], workingContext || {});
        wardrobes = Array.isArray(clusterResult) ? clusterResult : (clusterResult?.wardrobes || []);
      } catch {
        wardrobes = [];
      }
    }



    const evaluatedGaps: EvaluatedBlueprintGap[] = [];
    const missingGapsByCategory: Record<BlueprintCategory, EvaluatedBlueprintGap[]> = {
      IDENTITY_AND_BIO: [],
      SLEEP_AND_RHYTHM: [],
      DIET_AND_HEALTH: [],
      PERSONAL_CHOICES_AND_RECHARGE: [],
      LIFE_GOALS_AND_VALUES: []
    };

    let knownCount = 0;

    const currentHour = timeContext?.localHour ?? new Date().getUTCHours();
    const isWeekend = timeContext?.isWeekend ?? false;

    for (const def of FOUNDATIONAL_BLUEPRINT_REGISTRY) {
      let isKnown = false;
      let knownValue: string | undefined;

      // 1. Direct key match in memories or working context
      for (const mKey of def.matchingKeys) {
        if (memMap.has(mKey)) {
          // If checking user birthday/age, ensure it's not a relative's key
          if ((def.key === 'birth_date' || def.key === 'user_age') && 
              (mKey.includes('wife') || mKey.includes('sakshi') || mKey.includes('son') || mKey.includes('shreshth') || mKey.includes('father') || mKey.includes('mother'))) {
            continue;
          }
          const val = memMap.get(mKey);
          if (val && val.length > 0 && !/unknown|not specified|n\/a|none/i.test(val)) {
            isKnown = true;
            knownValue = val;
            break;
          }
        }
      }

      // 2. Trait match in Entity Wardrobes (targeting relevant traits by label/key)
      if (!isKnown && wardrobes && wardrobes.length > 0) {
        for (const w of wardrobes) {
          // If checking user bio/identity, ignore family wardrobes (Sakshi, Shreshth, parents)
          if (def.category === 'IDENTITY_AND_BIO' && w.domain === 'family') {
            continue;
          }
          // Also ignore routine reminder wardrobe when checking user birthday
          if (def.key === 'birth_date' && w.id === 'wardrobe-routine-reminders') {
            continue;
          }

          for (const trait of (w.traits || [])) {
            const traitLabelLower = (trait.label || '').toLowerCase();
            const traitKeyLower = (trait.key || '').toLowerCase();
            const traitVal = String(trait.value || '').trim();
            if (!traitVal || /unknown|not specified|n\/a|none/i.test(traitVal)) continue;

            // Ensure we don't pick up other people's birthdays
            if (def.key === 'birth_date' && (traitKeyLower.includes('sakshi') || traitKeyLower.includes('wife') || traitKeyLower.includes('son') || traitVal.toLowerCase().includes("sakshi's birthday"))) {
              continue;
            }

            const isTraitRelevant = def.matchingKeys.some(mk => 
              traitLabelLower.includes(mk.replace(/_/g, ' ')) || 
              traitKeyLower.includes(mk) ||
              traitLabelLower.includes(def.title.toLowerCase())
            ) || traitLabelLower.includes(def.key.replace(/_/g, ' '));

            if (isTraitRelevant) {
              if (!def.valueEvidencePatterns || def.valueEvidencePatterns.length === 0) {
                isKnown = true;
                knownValue = traitVal;
                break;
              } else {
                for (const pattern of def.valueEvidencePatterns) {
                  if (pattern.test(traitVal)) {
                    isKnown = true;
                    knownValue = traitVal;
                    break;
                  }
                }
              }
            }
            if (isKnown) break;
          }
          if (isKnown) break;
        }
      }

      // Calculate timing score for ordering when missing
      let timingScore = 50; // base score
      if (def.importance === 'CRITICAL') timingScore += 30;
      if (def.importance === 'HIGH') timingScore += 15;

      // Time-of-day bonuses
      if (def.timingAffinity === 'EVENING_WIND_DOWN') {
        if (currentHour >= 20 && currentHour <= 23) timingScore += 40;
        else if (currentHour >= 18 && currentHour < 20) timingScore += 20;
      } else if (def.timingAffinity === 'MORNING_FRESH') {
        if (currentHour >= 7 && currentHour <= 11) timingScore += 40;
      } else if (def.timingAffinity === 'MEAL_TIME') {
        if ((currentHour >= 12 && currentHour <= 15) || (currentHour >= 19 && currentHour <= 21)) timingScore += 40;
      } else if (def.timingAffinity === 'WEEKEND_RELAX') {
        if (isWeekend) timingScore += 40;
      } else if (def.timingAffinity === 'ANYTIME_CASUAL') {
        timingScore += 10;
      }

      const suggestedPrompt = def.promptTemplates[Math.floor(Math.random() * def.promptTemplates.length)];

      const evaluated: EvaluatedBlueprintGap = {
        key: def.key,
        category: def.category,
        title: def.title,
        importance: def.importance,
        isKnown,
        knownValue,
        suggestedPrompt,
        companionValue: def.companionValue,
        timingAffinity: def.timingAffinity,
        timingScore
      };

      if (isKnown) {
        knownCount++;
      } else {
        evaluatedGaps.push(evaluated);
        if (missingGapsByCategory[def.category]) {
          missingGapsByCategory[def.category].push(evaluated);
        }
      }
    }

    const totalTracked = FOUNDATIONAL_BLUEPRINT_REGISTRY.length;
    const missingCount = totalTracked - knownCount;
    const completionPercentage = Math.round((knownCount / totalTracked) * 100);

    // Pick next best curiosity: highest timing score among missing items
    evaluatedGaps.sort((a, b) => b.timingScore - a.timingScore);
    const nextBestCuriosity = evaluatedGaps.length > 0 ? evaluatedGaps[0] : null;

    return {
      totalTracked,
      knownCount,
      missingCount,
      completionPercentage,
      nextBestCuriosity,
      missingGapsByCategory
    };
  }

  /**
   * Helper to format a Situational Awareness briefing note for discovery.
   */
  formatDiscoveryPromptGuideline(summary: BlueprintGapSummary): string | null {
    if (!summary.nextBestCuriosity) return null;

    const top = summary.nextBestCuriosity;
    return `- 💡 COMPANION LIFE BLUEPRINT DISCOVERY (${summary.completionPercentage}% known):
  Missing Anchor: "${top.title}" [${top.key}]
  Companion Value: ${top.companionValue}
  Suggested Natural Inquiry: "${top.suggestedPrompt}"
  Rule: Weave this inquiry in warmly towards the end of your response ONLY if the conversation is casual, relaxed, or winding down. NEVER force it if the user is in a hurry, stressed, asking about work, or executing a task.`;
  }
}

export const lifeBlueprintCuriosityEngine = new LifeBlueprintCuriosityEngine();
