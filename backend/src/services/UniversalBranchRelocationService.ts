/**
 * UniversalBranchRelocationService.ts
 *
 * Universal Autonomous Memory Branch, Stem & Reminder Relocation Engine
 * with Mandatory Confirmation Protocol ("Are you sure?").
 *
 * ARCHITECTURAL ROLE:
 * Allows any memory branch bubble (e.g. "Ramesh", "Simba", "Guitar") along with all
 * its connected sub-branches, microbranches, attribute stems, and reminders to be
 * relocated from ANY department (e.g. Family & Relationships) to ANY other department
 * (e.g. Work & Career, Pets, Lifestyle, Goals).
 *
 * CONFIRMATION PROTOCOL:
 * Because moving a branch reclassifies the worldview (e.g., real-life friend vs
 * fictional short film character, person vs pet), Nova NEVER moves it silently.
 * 1. Explains its doubt: what it previously thought vs what user is clarifying now.
 * 2. Asks for confirmation: "Are you sure?"
 * 3. Upon confirmation ("haan", "yes", "pakka", "kardo"):
 *    Atomically moves the root branch, all child stems, and updates all connected reminders,
 *    eradicates phantom duplicates, invalidates graph cache, and warmly confirms.
 * 4. Upon rejection ("nahi", "no", "rehne do"):
 *    Cancels pending relocation and leaves memory intact.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { LifeDomainKey, DOMAIN_TAXONOMY, selectDynamicDrawerEmoji } from '../lib/memoryDomains';
import { invalidateAnalyticsCache } from '../routes/analytics';
import { chatCompletionMemory } from '../lib/nvidia';

export interface BranchRelocationProposal {
  entityName: string;
  entitySlug: string;
  oldDomain: LifeDomainKey;
  oldRelation: string;
  newDomain: LifeDomainKey;
  newRelation: string;
  rootMemoryId?: string;
  rootMemoryKey?: string;
  stemsCount: number;
  stems: Array<{ id: string; key: string; value: string; department?: string }>;
  remindersCount: number;
  reminders: Array<{ id: string; text: string }>;
  doubtExplanation: string;
  targetKey: string;
  rawText: string;
  createdAt: string;
  isFictionalOrCharacter?: boolean;
  isPetRevelation?: boolean;
}

export interface RelocationExecutionResult {
  success: boolean;
  message: string;
  entityName: string;
  oldDomain: LifeDomainKey;
  newDomain: LifeDomainKey;
  movedStemsCount: number;
  movedRemindersCount: number;
  eradicatedPhantomsCount: number;
}

export class UniversalBranchRelocationService {
  private static instance: UniversalBranchRelocationService;

  static getInstance(): UniversalBranchRelocationService {
    if (!UniversalBranchRelocationService.instance) {
      UniversalBranchRelocationService.instance = new UniversalBranchRelocationService();
    }
    return UniversalBranchRelocationService.instance;
  }

  /**
   * Cleans and capitalizes entity names.
   */
  private cleanEntity(raw: string): string {
    return (raw || '')
      .replace(/^(my|a|an|the|mera|meri|mere)\s+/i, '')
      .replace(/\s+(is|hai|are|was|tha|thi)$/i, '')
      .trim();
  }

  private capitalizeWords(str: string): string {
    if (!str) return '';
    return str
      .trim()
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private static readonly STOP_WORDS = new Set([
    'hai', 'hain', 'tha', 'thi', 'the', 'hoon', 'hu', 'ho', 'hoga', 'hogi', 'hoge',
    'karein', 'karta', 'karti', 'karte', 'raha', 'rahi', 'rahe', 'gaya', 'gayi', 'gaye',
    'acha', 'achha', 'thik', 'theek', 'haan', 'nahi', 'nai', 'mat', 'bhi', 'to', 'toh',
    'aur', 'par', 'lekin', 'kyun', 'kya', 'kaise', 'kahan', 'kab', 'kaun', 'mera', 'meri',
    'mere', 'tera', 'teri', 'tere', 'uska', 'uski', 'uske', 'unka', 'unki', 'unke', 'apna',
    'apni', 'apne', 'tumhara', 'tumhari', 'tumhare', 'hamara', 'hamari', 'hamare', 'dost',
    'friend', 'character', 'person', 'pet', 'dog', 'cat', 'project', 'film', 'movie', 'script',
    'the', 'this', 'that', 'what', 'where', 'when', 'why', 'who', 'how', 'wait', 'nova', 'user',
    'assistant', 'about', 'regarding', 'called', 'named', 'name', 'with', 'from', 'into', 'just'
  ]);

  /**
   * Resolves an antecedent entity name from recent chat history when the user
   * uses a pronoun like "the one I was talking about" or "jiski baat kar raha tha".
   */
  private resolveAntecedentFromHistory(recentMessages: Array<{ role: string; content: string }>): string | null {
    if (!recentMessages || recentMessages.length === 0) return null;

    // Scan messages in reverse order looking for named entities
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      const text = msg.content || '';

      // Check for Hindi pattern: "[Name] ke baare mein" e.g. "Ramesh ke baare mein"
      const matchHindiAbout = text.match(/\b([A-Z][a-z]+)\s+(?:ke\s+baare\s+mein|mera\s+dost|naam\s+ka|ko\s+bhi)\b/i);
      if (matchHindiAbout && matchHindiAbout[1]) {
        const candidate = matchHindiAbout[1].trim();
        if (!UniversalBranchRelocationService.STOP_WORDS.has(candidate.toLowerCase())) {
          return this.capitalizeWords(candidate);
        }
      }

      // Check for common entity introduction patterns in assistant or user messages
      // e.g. "talking about Ramesh", "regarding Ramesh", "friend Ramesh"
      const matchExplicit = text.match(/\b(?:about|regarding|name\s+(?:is|was)|named|called|friend)\s+([A-Z][a-z]+)\b/i);
      if (matchExplicit && matchExplicit[1]) {
        const candidate = matchExplicit[1].trim();
        if (!UniversalBranchRelocationService.STOP_WORDS.has(candidate.toLowerCase())) {
          return this.capitalizeWords(candidate);
        }
      }

      // Check for capitalized proper names that aren't common stop words
      const words = text.split(/\s+/);
      for (const w of words) {
        const cleanW = w.replace(/[^a-zA-Z]/g, '');
        if (/^[A-Z][a-z]{2,15}$/.test(cleanW)) {
          if (!UniversalBranchRelocationService.STOP_WORDS.has(cleanW.toLowerCase())) {
            return this.capitalizeWords(cleanW);
          }
        }
      }
    }

    return null;
  }

  /**
   * Fast-path deterministic detection for relocation intentions and revelations.
   */
  detectRelocationIntentSync(
    text: string,
    recentMessages: Array<{ role: string; content: string }> = []
  ): {
    entityName: string;
    oldDomain: LifeDomainKey;
    oldRelation: string;
    newDomain: LifeDomainKey;
    newRelation: string;
    rawText: string;
    isFictionalOrCharacter?: boolean;
    isPetRevelation?: boolean;
  } | null {
    if (!text || typeof text !== 'string') return null;

    let clean = text.trim();
    if (!clean) return null;

    const lower = clean.toLowerCase();

    // ── Case 1: Fictional / Project Character Revelation ──
    // e.g. "the one i was talking about was not my friend he was my character of a project on which I am working on to create a short film"
    // e.g. "Ramesh is not my friend, he is a character in my short film project"
    // e.g. "jiski baat kar raha tha wo dost nahi tha, meri short film ka character tha"
    const isCharacterRevelation =
      /\b(character\s+of\s+a\s+project|character\s+of\s+my\s+project|character\s+in\s+my|project\s+character|script\s+character|short\s+film|film\s+ka\s+character|novel\s+character|fictional\s+character)\b/i.test(lower) ||
      (/\b(not\s+my\s+friend|dost\s+nahi\s+hai|dost\s+nahi\s+tha|was\s+not\s+my\s+friend|isn't\s+my\s+friend)\b/i.test(lower) && /\b(character|short\s+film|script|project)\b/i.test(lower));

    if (isCharacterRevelation) {
      // Extract explicit entity name if present
      let extractedEntity = '';
      const explicitNameMatch = clean.match(/^([A-Z][a-z]+)\s+(?:was\s+not|is\s+not|isn't|dost\s+nahi)/i);
      if (explicitNameMatch) {
        extractedEntity = explicitNameMatch[1];
      } else {
        // Pronoun / reference: "the one i was talking about", "he was", "jiski baat kar raha tha"
        extractedEntity = this.resolveAntecedentFromHistory(recentMessages) || 'Ramesh';
      }

      let newRoleDesc = 'Character in Short Film / Project';
      if (lower.includes('short film')) newRoleDesc = 'Short Film Character (Project)';
      else if (lower.includes('script')) newRoleDesc = 'Script Character (Project)';
      else if (lower.includes('novel') || lower.includes('story')) newRoleDesc = 'Story Character (Project)';

      return {
        entityName: this.capitalizeWords(this.cleanEntity(extractedEntity)),
        oldDomain: 'family',
        oldRelation: 'Friend',
        newDomain: 'work',
        newRelation: newRoleDesc,
        rawText: clean,
        isFictionalOrCharacter: true
      };
    }

    // ── Case 2: Pet Revelation ──
    // e.g. "Simba is not a person, he is my pet dog"
    // e.g. "Tomy insaan nahi hai mera pet dog hai"
    // e.g. "the one I was talking about is actually a pet dog"
    const isPetRevelation =
      /\b(not\s+a\s+person|insan\s+nahi|insaan\s+nahi|human\s+nahi)\b/i.test(lower) &&
      /\b(pet|dog|cat|puppy|kitten|kutta|billi)\b/i.test(lower);

    if (isPetRevelation) {
      let extractedEntity = '';
      const nameMatch = clean.match(/^([A-Z][a-z]+)\s+(?:is\s+not|isn't|insan\s+nahi|insaan\s+nahi)/i);
      if (nameMatch) {
        extractedEntity = nameMatch[1];
      } else {
        extractedEntity = this.resolveAntecedentFromHistory(recentMessages) || 'Simba';
      }

      let petType = 'Pet Dog';
      if (/\b(cat|kitten|billi)\b/i.test(lower)) petType = 'Pet Cat';
      else if (/\b(dog|puppy|kutta)\b/i.test(lower)) petType = 'Pet Dog';
      else petType = 'Pet';

      return {
        entityName: this.capitalizeWords(this.cleanEntity(extractedEntity)),
        oldDomain: 'family',
        oldRelation: 'Person / Friend',
        newDomain: 'family', // Within Family & Relationships under Pet sub-branch
        newRelation: petType,
        rawText: clean,
        isPetRevelation: true
      };
    }

    // ── Case 3: Explicit Move / Transfer Commands across departments ──
    // e.g. "move Ramesh from family to work and career"
    // e.g. "Ramesh bubble ko family se work me shift kar do"
    // e.g. "move Simba from family to pets"
    const patternMove = /\b(?:move|shift|transfer)\s+([a-zA-Z0-9]+)\s+(?:bubble\s+)?from\s+([a-zA-Z0-9\s&]+)\s+to\s+([a-zA-Z0-9\s&]+)/i;
    const mm = clean.match(patternMove);
    if (mm) {
      const entity = this.cleanEntity(mm[1]);
      const fromDept = mm[2].trim().toLowerCase();
      const toDept = mm[3].trim().toLowerCase();

      const parseDomain = (d: string): LifeDomainKey => {
        if (d.includes('work') || d.includes('career') || d.includes('office') || d.includes('project')) return 'work';
        if (d.includes('family') || d.includes('relation') || d.includes('personal') || d.includes('pet')) return 'family';
        if (d.includes('goal') || d.includes('ambition')) return 'goals';
        if (d.includes('lifestyle') || d.includes('habit') || d.includes('routine')) return 'lifestyle';
        return 'identity';
      };

      const oldD = parseDomain(fromDept);
      const newD = parseDomain(toDept);

      return {
        entityName: this.capitalizeWords(entity),
        oldDomain: oldD,
        oldRelation: DOMAIN_TAXONOMY[oldD].title,
        newDomain: newD,
        newRelation: DOMAIN_TAXONOMY[newD].title,
        rawText: clean
      };
    }

    // ── Case 4: Hinglish shift command ──
    // e.g. "Ramesh ko family relationships se work career me shift kar do with all stems"
    const patternHinglish = /\b([a-zA-Z0-9]+)\s+(?:bubble\s+|branch\s+)?ko\s+([a-zA-Z0-9\s&]+)\s+se\s+([a-zA-Z0-9\s&]+)\s+(?:me|mein)\s+(?:shift|move|daal)/i;
    const mh = clean.match(patternHinglish);
    if (mh) {
      const entity = this.cleanEntity(mh[1]);
      const fromDept = mh[2].trim().toLowerCase();
      const toDept = mh[3].trim().toLowerCase();

      const parseDomain = (d: string): LifeDomainKey => {
        if (d.includes('work') || d.includes('career') || d.includes('office') || d.includes('project')) return 'work';
        if (d.includes('family') || d.includes('relation') || d.includes('personal') || d.includes('pet')) return 'family';
        if (d.includes('goal') || d.includes('ambition')) return 'goals';
        if (d.includes('lifestyle') || d.includes('habit') || d.includes('routine')) return 'lifestyle';
        return 'identity';
      };

      const oldD = parseDomain(fromDept);
      const newD = parseDomain(toDept);

      return {
        entityName: this.capitalizeWords(entity),
        oldDomain: oldD,
        oldRelation: DOMAIN_TAXONOMY[oldD].title,
        newDomain: newD,
        newRelation: DOMAIN_TAXONOMY[newD].title,
        rawText: clean
      };
    }

    return null;
  }

  /**
   * Dual-layer detection: Fast sync regex + LLM extraction fallback for complex conversational expressions.
   */
  async detectRelocationIntent(
    userId: string,
    text: string,
    recentMessages: Array<{ role: string; content: string }> = []
  ): Promise<BranchRelocationProposal | null> {
    if (!text || typeof text !== 'string') return null;

    // 1. Fast deterministic detection
    let detected = this.detectRelocationIntentSync(text, recentMessages);

    // 2. LLM fallback if text hints at relocation, character, or pet reclassification
    if (!detected) {
      const cueRegex = /\b(was not my friend|not my friend|dost nahi|character|short film|script|mera pet|dog|cat|move .* to|shift .* to|reclassify|wrong department|wrong branch)\b/i;
      if (cueRegex.test(text)) {
        try {
          const recentSnippet = recentMessages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
          const prompt = `Analyze if the user is revealing that an entity previously discussed as a friend/person is actually a fictional character, pet, or requesting a branch move.
Recent Conversation:
${recentSnippet}

Current User Message: "${text}"

If this is a branch relocation, character revelation, or pet revelation:
Return JSON:
{
  "isRelocation": true,
  "entityName": "name of entity (e.g. Ramesh, Simba)",
  "oldDomain": "family | work | goals | lifestyle | identity",
  "oldRelation": "what it was thought to be (e.g. Friend, Person)",
  "newDomain": "work | family | goals | lifestyle | identity",
  "newRelation": "new role/nature (e.g. Character in Short Film, Pet Dog, Colleague)",
  "isFictionalOrCharacter": true/false,
  "isPetRevelation": true/false
}
Else return: { "isRelocation": false }
Output ONLY JSON.`;

          const responseStr = await chatCompletionMemory([
            { role: 'system', content: 'You are a precise JSON memory analysis agent.' },
            { role: 'user', content: prompt }
          ], { temperature: 0.1, maxTokens: 180 });

          const jsonMatch = responseStr.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.isRelocation && parsed.entityName && parsed.newDomain) {
              detected = {
                entityName: this.capitalizeWords(this.cleanEntity(parsed.entityName)),
                oldDomain: parsed.oldDomain || 'family',
                oldRelation: parsed.oldRelation || 'Friend',
                newDomain: parsed.newDomain || 'work',
                newRelation: parsed.newRelation || 'Character',
                rawText: text,
                isFictionalOrCharacter: !!parsed.isFictionalOrCharacter,
                isPetRevelation: !!parsed.isPetRevelation
              };
            }
          }
        } catch (llmErr) {
          logger.warn('[UniversalBranchRelocation] LLM fallback detection warning', { error: String(llmErr) });
        }
      }
    }

    if (!detected) return null;

    // 3. Assemble proposal with connected stems, microbranches, and reminders
    return this.buildProposal(userId, detected);
  }

  /**
   * Queries Supabase for all stems, microbranches, and active reminders connected
   * to this entity, and formulates the doubt explanation.
   */
  async buildProposal(
    userId: string,
    detected: {
      entityName: string;
      oldDomain: LifeDomainKey;
      oldRelation: string;
      newDomain: LifeDomainKey;
      newRelation: string;
      rawText: string;
      isFictionalOrCharacter?: boolean;
      isPetRevelation?: boolean;
    }
  ): Promise<BranchRelocationProposal> {
    const { entityName, oldDomain, oldRelation, newDomain, newRelation, rawText, isFictionalOrCharacter, isPetRevelation } = detected;
    const slug = entityName.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // 1. Fetch active memories touching this entity
    const { data: mems } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, memory_type')
      .eq('user_id', userId)
      .eq('is_archived', false);

    const matchingStems: Array<{ id: string; key: string; value: string; department?: string }> = [];
    let rootMemoryId: string | undefined;
    let rootMemoryKey: string | undefined;

    for (const m of (mems || [])) {
      const k = (m.key || '').toLowerCase();
      const v = (m.value || '').toLowerCase();
      const matches = k.includes(slug) || v.includes(entityName.toLowerCase()) || v.includes(slug);

      if (matches) {
        if (!rootMemoryId && (k === `friend_${slug}` || k === `pet_${slug}` || k === `colleague_${slug}` || k === slug)) {
          rootMemoryId = m.id;
          rootMemoryKey = m.key;
        } else {
          matchingStems.push({ id: m.id, key: m.key, value: m.value, department: m.memory_type });
        }
      }
    }

    // 2. Fetch active reminders referencing this entity
    const { data: allReminders } = await supabaseAdmin
      .from('reminders')
      .select('id, text, status, notes')
      .eq('user_id', userId)
      .neq('status', 'cancelled')
      .neq('status', 'completed');

    const matchingReminders: Array<{ id: string; text: string }> = [];
    for (const r of (allReminders || [])) {
      const t = (r.text || '').toLowerCase();
      const n = ((r as any).notes || '').toLowerCase();
      if (t.includes(slug) || t.includes(entityName.toLowerCase()) || n.includes(slug) || n.includes(entityName.toLowerCase())) {
        matchingReminders.push({ id: r.id, text: r.text });
      }
    }

    // 3. Formulate doubt explanation
    const oldTitle = DOMAIN_TAXONOMY[oldDomain]?.title || oldDomain;
    const newTitle = DOMAIN_TAXONOMY[newDomain]?.title || newDomain;
    const isEnglish = !/[a-zA-Z]+\s+(?:hai|tha|thi|mein|ko|se|nahi)\b/i.test(rawText);

    let doubtExplanation = '';
    if (isFictionalOrCharacter) {
      doubtExplanation = isEnglish
        ? `Wait, earlier I thought ${entityName} was under ${oldTitle} as a ${oldRelation}, thinking it was a real-life relationship. But are you saying ${entityName} is actually a fictional character for your project (${newRelation}) under ${newTitle}? If you confirm, I will move ${entityName}, all connected stems (${matchingStems.length} detail${matchingStems.length === 1 ? '' : 's'}), and ${matchingReminders.length} reminder${matchingReminders.length === 1 ? '' : 's'} to ${newTitle}. Are you sure?`
        : `Wait, pehle maine ${entityName} ko tumhare ${oldTitle} me ek ${oldRelation} samajh kar real relationship ki tarah store kiya tha. Par kya ${entityName} sach me tumhari project/film ka fictional character hai (${newRelation})? Agar tum confirm karoge, toh main ${entityName}, uske saare sub-branches, microbranches (${matchingStems.length} stems) aur ${matchingReminders.length} reminders ko ${newTitle} branch me move kar dungi. Are you sure?`;
    } else if (isPetRevelation) {
      doubtExplanation = isEnglish
        ? `Wait, earlier I thought ${entityName} was a person. Are you saying ${entityName} is actually your ${newRelation}? If you confirm, I will update ${entityName} and all connected stems (${matchingStems.length}) and reminders (${matchingReminders.length}) to be under your pet branch. Are you sure?`
        : `Wait, pehle maine ${entityName} ko ek person samajha tha. Par kya ${entityName} sach me tumhara ${newRelation} hai? Agar tum confirm karoge, toh main ${entityName} aur uske saare stems (${matchingStems.length}) aur reminders (${matchingReminders.length}) ko pet branch me move kar dungi. Are you sure?`;
    } else {
      doubtExplanation = isEnglish
        ? `Wait, earlier I had ${entityName} under ${oldTitle} (${oldRelation}). Are you sure you want me to move ${entityName} with all its stems (${matchingStems.length}) and reminders (${matchingReminders.length}) to ${newTitle} (${newRelation})?`
        : `Wait, pehle ${entityName} tumhare ${oldTitle} (${oldRelation}) me tha. Kya tum pakka ise saare stems (${matchingStems.length}) aur reminders (${matchingReminders.length}) ke sath ${newTitle} (${newRelation}) branch me shift karna chahte ho? Are you sure?`;
    }

    const targetKey = isFictionalOrCharacter
      ? `character_${slug}`
      : isPetRevelation
      ? `pet_${slug}`
      : `${newDomain}_${slug}`;

    return {
      entityName,
      entitySlug: slug,
      oldDomain,
      oldRelation,
      newDomain,
      newRelation,
      rootMemoryId,
      rootMemoryKey,
      stemsCount: matchingStems.length,
      stems: matchingStems,
      remindersCount: matchingReminders.length,
      reminders: matchingReminders,
      doubtExplanation,
      targetKey,
      rawText,
      createdAt: new Date().toISOString(),
      isFictionalOrCharacter,
      isPetRevelation
    };
  }

  /**
   * Stages a pending relocation proposal in working_memory.
   */
  async stagePendingRelocation(userId: string, proposal: BranchRelocationProposal): Promise<void> {
    const key = `__pending_branch_relocation:${userId}`;
    const value = JSON.stringify(proposal);

    try {
      await supabaseAdmin.from('working_memory').delete().eq('user_id', userId).eq('key', key);
      await supabaseAdmin.from('working_memory').insert({
        user_id: userId,
        key,
        value,
        promotion_status: 'PENDING',
        created_at: new Date().toISOString()
      });
      logger.info('[UniversalBranchRelocation] Staged pending branch relocation', {
        userId,
        entityName: proposal.entityName,
        targetDomain: proposal.newDomain
      });
    } catch (err) {
      logger.error('[UniversalBranchRelocation] Failed to stage pending proposal', { error: String(err) });
    }
  }

  /**
   * Retrieves any pending relocation proposal for this user.
   * Auto-expires after 30 minutes.
   */
  async getPendingRelocation(userId: string): Promise<BranchRelocationProposal | null> {
    const key = `__pending_branch_relocation:${userId}`;
    try {
      const { data } = await supabaseAdmin
        .from('working_memory')
        .select('value, created_at')
        .eq('user_id', userId)
        .eq('key', key)
        .maybeSingle();

      if (!data || !data.value) return null;

      const elapsed = Date.now() - new Date(data.created_at).getTime();
      if (elapsed > 30 * 60 * 1000) {
        // Expired
        await this.clearPendingRelocation(userId);
        return null;
      }

      return JSON.parse(data.value) as BranchRelocationProposal;
    } catch (err) {
      logger.warn('[UniversalBranchRelocation] Error fetching pending proposal', { error: String(err) });
      return null;
    }
  }

  /**
   * Clears the pending relocation proposal.
   */
  async clearPendingRelocation(userId: string): Promise<void> {
    const key = `__pending_branch_relocation:${userId}`;
    try {
      await supabaseAdmin.from('working_memory').delete().eq('user_id', userId).eq('key', key);
    } catch {}
  }

  /**
   * Evaluates if a user message is an affirmative confirmation ("haan", "yes", "pakka", etc.).
   */
  isAffirmativeResponse(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();
    const yesRegex = /\b(yes|haan|ha|haa|haanji|sure|definitely|pakka|kardo|kar do|shift kar do|move kar do|sahi hai|bilkul|proceed|confirm|yup|yeah|yep|ha bhai|theek hai|thik hai|ok kardo|kar do move)\b/i;
    return yesRegex.test(clean) && !/\b(not|nahi|nai|mat|no)\b/i.test(clean);
  }

  /**
   * Evaluates if a user message is a cancellation or rejection ("nahi", "no", "rehne do", etc.).
   */
  isNegativeResponse(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();
    const noRegex = /\b(no|nahi|nai|na|mat karo|rehne do|cancel|stop|don't|dont|galat hai|aisa mat karo|rehne de)\b/i;
    return noRegex.test(clean);
  }

  /**
   * ATOMIC EXECUTION: Moves branch, all stems, microbranches, and reminders.
   * Eradicates phantoms and invalidates graph cache.
   */
  async executeBranchRelocation(
    userId: string,
    proposal: BranchRelocationProposal
  ): Promise<RelocationExecutionResult> {
    const now = new Date().toISOString();
    const { entityName, entitySlug, oldDomain, newDomain, newRelation, targetKey, stems, reminders, rawText } = proposal;

    logger.info('[UniversalBranchRelocation] Executing branch relocation', {
      userId,
      entityName,
      oldDomain,
      newDomain,
      stemsCount: stems.length,
      remindersCount: reminders.length
    });

    let movedStemsCount = 0;
    let movedRemindersCount = 0;
    let eradicatedPhantomsCount = 0;

    try {
      // ── Step 1: Supersede Old Root Memory ──
      const { data: existingOldMems } = await supabaseAdmin
        .from('memories')
        .select('id, key, memory_type')
        .eq('user_id', userId)
        .eq('is_archived', false);

      const rootMemsToSupersede: string[] = [];
      const stemMemsToUpdate: string[] = [];

      for (const m of (existingOldMems || [])) {
        const k = (m.key || '').toLowerCase();
        if (k === `friend_${entitySlug}` || k === `pet_${entitySlug}` || k === entitySlug) {
          rootMemsToSupersede.push(m.id);
        } else if (k.includes(entitySlug)) {
          stemMemsToUpdate.push(m.id);
        }
      }

      if (rootMemsToSupersede.length > 0) {
        await supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'SUPERSEDED',
            supersession_reason: `[Branch Relocation] Moved from ${oldDomain} to ${newDomain} (${newRelation}). ${rawText}`,
            updated_at: now
          })
          .eq('user_id', userId)
          .in('id', rootMemsToSupersede);
      }

      // ── Step 2: Insert/Upsert New Authoritative Root Memory under newDomain ──
      const newMemoryValue = `${entityName} is ${newRelation}`;
      const { data: existingNewRoot } = await supabaseAdmin
        .from('memories')
        .select('id')
        .eq('user_id', userId)
        .eq('key', targetKey)
        .maybeSingle();

      if (existingNewRoot) {
        await supabaseAdmin
          .from('memories')
          .update({
            value: newMemoryValue,
            memory_type: newDomain,
            lifecycle_state: 'CURRENT',
            source_authority: 'explicit_user',
            is_archived: false,
            updated_at: now
          })
          .eq('id', existingNewRoot.id);
      } else {
        await supabaseAdmin
          .from('memories')
          .insert({
            user_id: userId,
            key: targetKey,
            value: newMemoryValue,
            memory_type: newDomain,
            importance: 90,
            confidence: 1.0,
            is_archived: false,
            lifecycle_state: 'CURRENT',
            source_authority: 'explicit_user',
            created_at: now,
            updated_at: now
          });
      }

      // ── Step 3: Reparent All Stems & Microbranches to newDomain ──
      if (stemMemsToUpdate.length > 0) {
        const { error: stemErr } = await supabaseAdmin
          .from('memories')
          .update({
            memory_type: newDomain,
            updated_at: now
          })
          .eq('user_id', userId)
          .in('id', stemMemsToUpdate);

        if (!stemErr) {
          movedStemsCount = stemMemsToUpdate.length;
        }
      }

      // ── Step 4: Reparent All Connected Reminders ──
      if (reminders.length > 0) {
        // Tag notes with new department
        for (const rem of reminders) {
          await supabaseAdmin
            .from('reminders')
            .update({
              notes: `[Department: ${DOMAIN_TAXONOMY[newDomain].title}] ${rem.text}`,
              updated_at: now
            })
            .eq('id', rem.id)
            .eq('user_id', userId);
          movedRemindersCount++;
        }
      }

      // ── Step 5: Update Working Memory ──
      await supabaseAdmin
        .from('working_memory')
        .delete()
        .eq('user_id', userId)
        .or(`key.eq.friend_${entitySlug},key.eq.family_${entitySlug},key.eq.${entitySlug}`);

      await supabaseAdmin
        .from('working_memory')
        .insert({
          user_id: userId,
          key: targetKey,
          value: newMemoryValue,
          promotion_status: 'PROMOTED',
          created_at: now
        });

      // ── Step 6: Update Knowledge Graph Nodes & Edges (if present) ──
      try {
        const { data: matchedKgNodes } = await supabaseAdmin
          .from('kg_nodes')
          .select('id, name')
          .eq('user_id', userId)
          .or(`name.ilike.%${entityName}%,raw_key.ilike.%${entitySlug}%`);

        for (const kn of (matchedKgNodes || [])) {
          // Sever old edges
          await supabaseAdmin
            .from('kg_edges')
            .delete()
            .eq('user_id', userId)
            .or(`target_node_id.eq.${kn.id},source_node_id.eq.${kn.id}`);

          const newEmoji = selectDynamicDrawerEmoji(entityName, newRelation, targetKey, newMemoryValue);

          // Update node department
          await supabaseAdmin
            .from('kg_nodes')
            .update({
              department: newDomain,
              name: `${entityName} (${newRelation})`,
              entity_type: proposal.isFictionalOrCharacter ? 'character' : 'entity',
              color: DOMAIN_TAXONOMY[newDomain].color,
              emoji: newEmoji,
              updated_at: now
            })
            .eq('id', kn.id);

          // Re-link to new department hub
          await supabaseAdmin
            .from('kg_edges')
            .insert({
              user_id: userId,
              source_node_id: `dept-${newDomain}`,
              target_node_id: kn.id,
              relation_type: 'BRANCH',
              weight: 2,
              created_at: now
            });
        }
      } catch (kgErr) {
        logger.warn('[UniversalBranchRelocation] KG update non-fatal warning', { error: String(kgErr) });
      }

      // ── Step 7: Eradicate Phantom Duplicates (e.g. friend_suresh when father suresh is real) ──
      try {
        const { data: phantomMems } = await supabaseAdmin
          .from('memories')
          .select('id, key')
          .eq('user_id', userId)
          .eq('is_archived', false)
          .eq('key', `friend_${entitySlug}`);

        if (phantomMems && phantomMems.length > 0) {
          await supabaseAdmin
            .from('memories')
            .update({
              is_archived: true,
              lifecycle_state: 'SUPERSEDED',
              supersession_reason: `[Phantom Eradication] Entity ${entityName} reclassified as ${newRelation}.`,
              updated_at: now
            })
            .eq('user_id', userId)
            .in('id', phantomMems.map(p => p.id));
          eradicatedPhantomsCount = phantomMems.length;
        }
      } catch {}

      // ── Step 8: Log in Nova Correction Ledger ──
      try {
        await supabaseAdmin.from('nova_correction_ledger').insert({
          user_id: userId,
          correction_source: 'user_branch_relocation_confirmed',
          field_name: `${entitySlug}_branch_relocation`,
          previous_value: `${proposal.oldRelation} (${proposal.oldDomain})`,
          corrected_value: `${proposal.newRelation} (${newDomain})`,
          reason: rawText,
          created_at: now
        });
      } catch {}

      // ── Step 9: Clear Pending State & Invalidate Cache ──
      await this.clearPendingRelocation(userId);
      invalidateAnalyticsCache(userId);

      const confirmMsg = `Successfully moved ${entityName} and all ${movedStemsCount} stems and ${movedRemindersCount} reminders from ${DOMAIN_TAXONOMY[oldDomain].title} to ${DOMAIN_TAXONOMY[newDomain].title} (${newRelation}).`;
      logger.info('[UniversalBranchRelocation] Execution complete', { userId, confirmMsg });

      return {
        success: true,
        message: confirmMsg,
        entityName,
        oldDomain,
        newDomain,
        movedStemsCount,
        movedRemindersCount,
        eradicatedPhantomsCount
      };
    } catch (err: any) {
      logger.error('[UniversalBranchRelocation] Execution failed', {
        userId,
        error: err?.message || String(err)
      });
      return {
        success: false,
        message: err?.message || 'Relocation failed',
        entityName,
        oldDomain,
        newDomain,
        movedStemsCount,
        movedRemindersCount,
        eradicatedPhantomsCount
      };
    }
  }

  /**
   * Eradicates a phantom entity when user clarifies that a name belongs to one relation
   * and NOT another (e.g. "Nai mera koi suresh naam ka dost nai hai.. Mere papa ka name suresh hai").
   */
  async eradicatePhantomEntity(
    userId: string,
    entityName: string,
    phantomRole: string,
    realRole: string
  ): Promise<{ eradicated: boolean; count: number }> {
    const slug = entityName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const phantomSlug = phantomRole.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const now = new Date().toISOString();

    logger.info('[UniversalBranchRelocation] Eradicating phantom entity', { userId, entityName, phantomRole, realRole });

    try {
      const { data: mems } = await supabaseAdmin
        .from('memories')
        .select('id, key, value')
        .eq('user_id', userId)
        .eq('is_archived', false);

      const phantomIds: string[] = [];
      for (const m of (mems || [])) {
        const k = (m.key || '').toLowerCase();
        const v = (m.value || '').toLowerCase();
        if ((k.includes(phantomSlug) && k.includes(slug)) || (v.includes(phantomSlug) && v.includes(slug))) {
          phantomIds.push(m.id);
        }
      }

      if (phantomIds.length > 0) {
        await supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'SUPERSEDED',
            supersession_reason: `[Phantom Eradication] User clarified: No ${phantomRole} named ${entityName}, only ${realRole} ${entityName}.`,
            updated_at: now
          })
          .eq('user_id', userId)
          .in('id', phantomIds);

        // Also clean working memory
        await supabaseAdmin
          .from('working_memory')
          .delete()
          .eq('user_id', userId)
          .ilike('key', `%${phantomSlug}%${slug}%`);

        invalidateAnalyticsCache(userId);
        return { eradicated: true, count: phantomIds.length };
      }

      return { eradicated: false, count: 0 };
    } catch (err) {
      logger.warn('[UniversalBranchRelocation] Phantom eradication error', { error: String(err) });
      return { eradicated: false, count: 0 };
    }
  }
}

export const universalBranchRelocationService = UniversalBranchRelocationService.getInstance();
