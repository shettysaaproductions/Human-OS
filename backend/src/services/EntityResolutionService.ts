/**
 * EntityResolutionService.ts — Dedicated Semantic Entity & Reference Resolution Layer
 *
 * ARCHITECTURAL ROLE:
 * Resolves the #1 Bug Class in Human-OS: Entity & Reference Confusion.
 *
 * Before any memory or action is created, this service determines:
 * 1. Speaker: Who is speaking? (default: user)
 * 2. Mentioned Entities: Who is being discussed? (User, User's father, Ejaz, Ejaz's father, Sushant's wife, etc.)
 * 3. Relationship Ownership: WHO does each entity and fact belong to?
 *    - "Ijaz's father was in the Navy" -> Ejaz -> father -> Navy (NOT User -> father -> Navy)
 *    - "Sushant's wife works in banking" -> Sushant -> wife -> banking (NOT User -> wife -> banking)
 *    - "My friend's brother lives in Dubai" -> Friend -> brother -> Dubai
 *    - "My father met Ejaz yesterday" -> Distinguishes User's Father and Ejaz (meeting event)
 *    - "Ejaz told me his father retired" -> Subject of retired is Ejaz's father
 *    - "My wife likes the same restaurant that Ejaz's wife likes" -> Distinguishes User's wife from Ejaz's wife
 * 4. Temporal Validity: Distinguishes PAST ("was in Navy", "used to work"), CURRENT ("works at"), and FUTURE ("joining next month").
 * 5. Multi-Hop Disambiguation: Generates explicit entity-scoped canonical keys and relationship trees.
 */

export type EntityType = 'person' | 'organization' | 'pet' | 'venture' | 'place' | 'concept';

export interface ResolvedEntity {
  id: string;                    // e.g. "user:self", "entity:friend_ejaz", "entity:friend_ejaz_father"
  name: string;                  // e.g. "Ejaz", "Ejaz's father", "User"
  entityType: EntityType;
  relationToUser?: string;       // e.g. "friend", "father", "friend_father", "wife", "friend_wife"
  parentEntityId?: string;       // e.g. "entity:friend_ejaz" for Ejaz's father
  isDirectUserRelation: boolean; // true ONLY if directly related to User (e.g. User's father), false for third parties
  gender?: 'masculine' | 'feminine' | 'neutral';
}

export interface ResolvedFact {
  subjectEntityId: string;       // ID of the entity that OWNS this attribute
  subjectEntityName: string;     // Name of the entity
  predicate: string;             // e.g. "military_service", "occupation", "city", "birth_date"
  value: string;                 // e.g. "Navy", "Banking", "Dubai"
  canonicalKey: string;          // e.g. "entity:friend_ejaz_father:military_service" or "father_name" for user
  temporalState: 'PAST' | 'CURRENT' | 'FUTURE' | 'UNKNOWN';
  confidence: number;
  groundedInTurn: boolean;
  rawQuote: string;
  sourceMessageId?: string;
  isDirectUserFact: boolean;
}

export interface EntityResolutionResult {
  speaker: string;
  entities: ResolvedEntity[];
  facts: ResolvedFact[];
  primarySubjectId: string;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  clarificationQuestion?: string;
}

export class EntityResolutionService {
  private static instance: EntityResolutionService;

  static getInstance(): EntityResolutionService {
    if (!EntityResolutionService.instance) {
      EntityResolutionService.instance = new EntityResolutionService();
    }
    return EntityResolutionService.instance;
  }

  /**
   * Main resolution pass on a single user message with conversational context.
   */
  resolveTurn(
    message: string,
    context?: {
      recentMessages?: Array<{ role: string; content: string }>;
      activeEntities?: ResolvedEntity[];
      userProfileName?: string;
      sourceMessageId?: string;
    }
  ): EntityResolutionResult {
    const cleanMsg = (message || '').trim();
    const result: EntityResolutionResult = {
      speaker: 'user:self',
      entities: [
        {
          id: 'user:self',
          name: context?.userProfileName || 'User',
          entityType: 'person',
          isDirectUserRelation: true,
        }
      ],
      facts: [],
      primarySubjectId: 'user:self',
      isAmbiguous: false
    };

    if (!cleanMsg) return result;

    const entitiesById = new Map<string, ResolvedEntity>();
    entitiesById.set('user:self', result.entities[0]);

    // ── 1. Check for Explicit Third-Party Possessive Structures ───────────────
    // Examples:
    // - "Ijaz's father was in the Navy" / "Ejaz's father was in the Navy"
    // - "Ejaz ke papa Navy me the" / "Sushant ki biwi banking me hai"
    // - "My friend's brother lives in Dubai"
    // - "Ejaz told me his father retired"

    // Pattern C: Nested friend relation: "my friend's brother", "mere dost ka bhai"
    const nestedFriendPattern = /\b(?:my\s+friend's|mere\s+dost\s+ka|mere\s+dost\s+ki|mere\s+friend\s+ka|mere\s+friend\s+ki)\s+(father|mother|brother|bhai|sister|wife|biwi|son|daughter)\s+(.*)/i;
    const nestedFriendMatch = cleanMsg.match(nestedFriendPattern);

    // Pattern A: Third-party possessive English: [Name]'s [Relation] [Predicate/Verb/Attribute]
    // e.g. "Ijaz's father was in the Navy", "Sushant's wife works in banking"
    const engPossessivePattern = /\b([a-zA-Z]+)'s\s+(father|mother|dad|mom|papa|maa|wife|biwi|patni|husband|pati|brother|bhai|sister|behen|son|beta|daughter|beti|friend|dost)\s+(?:was|is|worked|works|served|serves|lives|lived|retired|had\s+retired)?\s*(.*)/i;
    const engPossMatch = cleanMsg.match(engPossessivePattern);

    // Pattern B: Hinglish possessive: [Name] (ke|ki|ka) [Relation] [Predicate/Verb/Attribute]
    // e.g. "Ejaz ke papa Navy me the", "Sushant ki wife banking me hai"
    const hinPossessivePattern = /\b([a-zA-Z]+)\s+(?:ke|ki|ka)\s+(papa|father|dad|pitaji|mummy|mother|mom|maa|mataji|biwi|wife|patni|husband|pati|bhai|brother|bhaiya|behen|sister|didi|beta|son|beti|daughter|dost|friend)\s+(.*)/i;
    const hinPossMatch = cleanMsg.match(hinPossessivePattern);

    if (nestedFriendMatch) {
      const relation = this.normalizeRelation(nestedFriendMatch[1]);
      const rest = nestedFriendMatch[2]?.trim() || '';

      const friendEntityId = `entity:person_friend`;
      const derivedEntityId = `entity:person_friend_${relation}`;
      const derivedEntityName = `Friend's ${relation}`;

      entitiesById.set(friendEntityId, {
        id: friendEntityId,
        name: 'Friend',
        entityType: 'person',
        relationToUser: 'friend',
        isDirectUserRelation: true,
      });

      entitiesById.set(derivedEntityId, {
        id: derivedEntityId,
        name: derivedEntityName,
        entityType: 'person',
        relationToUser: `friend_${relation}`,
        parentEntityId: friendEntityId,
        isDirectUserRelation: false,
      });

      result.primarySubjectId = derivedEntityId;

      const fact = this.extractFactFromPredicate(derivedEntityId, derivedEntityName, relation, rest, cleanMsg, context?.sourceMessageId);
      if (fact) {
        result.facts.push(fact);
      }
    } else if (engPossMatch && !/^(?:my|mera|meri|mere|user|friend|dost)$/i.test(engPossMatch[1])) {
      const ownerName = this.capitalize(engPossMatch[1]);
      const relation = this.normalizeRelation(engPossMatch[2]);
      const rest = engPossMatch[3]?.trim() || '';

      const ownerEntityId = `entity:person_${ownerName.toLowerCase()}`;
      const derivedEntityId = `${ownerEntityId}_${relation}`;
      const derivedEntityName = `${ownerName}'s ${relation}`;

      // Register owner entity
      const ownerEntity: ResolvedEntity = {
        id: ownerEntityId,
        name: ownerName,
        entityType: 'person',
        relationToUser: 'associate_or_friend',
        isDirectUserRelation: false,
      };
      entitiesById.set(ownerEntityId, ownerEntity);

      // Register derived entity
      const derivedEntity: ResolvedEntity = {
        id: derivedEntityId,
        name: derivedEntityName,
        entityType: 'person',
        relationToUser: `third_party_${relation}`,
        parentEntityId: ownerEntityId,
        isDirectUserRelation: false,
      };
      entitiesById.set(derivedEntityId, derivedEntity);

      result.primarySubjectId = derivedEntityId;

      // Extract attribute for this derived entity
      const fact = this.extractFactFromPredicate(derivedEntityId, derivedEntityName, relation, rest, cleanMsg, context?.sourceMessageId);
      if (fact) {
        result.facts.push(fact);
      }
    } else if (hinPossMatch && !/^(?:mera|meri|mere|my|hum|apna|dost|friend)$/i.test(hinPossMatch[1])) {
      const ownerName = this.capitalize(hinPossMatch[1]);
      const relation = this.normalizeRelation(hinPossMatch[2]);
      const rest = hinPossMatch[3]?.trim() || '';

      const ownerEntityId = `entity:person_${ownerName.toLowerCase()}`;
      const derivedEntityId = `${ownerEntityId}_${relation}`;
      const derivedEntityName = `${ownerName}'s ${relation}`;

      const ownerEntity: ResolvedEntity = {
        id: ownerEntityId,
        name: ownerName,
        entityType: 'person',
        relationToUser: 'associate_or_friend',
        isDirectUserRelation: false,
      };
      entitiesById.set(ownerEntityId, ownerEntity);

      const derivedEntity: ResolvedEntity = {
        id: derivedEntityId,
        name: derivedEntityName,
        entityType: 'person',
        relationToUser: `third_party_${relation}`,
        parentEntityId: ownerEntityId,
        isDirectUserRelation: false,
      };
      entitiesById.set(derivedEntityId, derivedEntity);

      result.primarySubjectId = derivedEntityId;

      const fact = this.extractFactFromPredicate(derivedEntityId, derivedEntityName, relation, rest, cleanMsg, context?.sourceMessageId);
      if (fact) {
        result.facts.push(fact);
      }
    } else {
      // ── 2. Check for Direct User Relations ──────────────────────────────────
      // e.g. "My father was in the Navy", "Mere papa Navy me the", "Meri wife Sakshi"
      const directUserRelPattern = /\b(?:my|mera|meri|mere)\s+(father|mother|dad|mom|papa|maa|wife|biwi|patni|husband|pati|brother|bhai|sister|behen|son|beta|daughter|beti)\s+(?:was|is|ka\s+naam|name\s+is)?\s*(.*)/i;
      const directMatch = cleanMsg.match(directUserRelPattern);

      if (directMatch) {
        const relation = this.normalizeRelation(directMatch[1]);
        const rest = directMatch[2]?.trim() || '';
        const userRelEntityId = `user:${relation}`;
        const userRelEntityName = `User's ${relation}`;

        const relEntity: ResolvedEntity = {
          id: userRelEntityId,
          name: userRelEntityName,
          entityType: 'person',
          relationToUser: relation,
          parentEntityId: 'user:self',
          isDirectUserRelation: true,
        };
        entitiesById.set(userRelEntityId, relEntity);
        result.primarySubjectId = userRelEntityId;

        // Check if another named person was mentioned in the predicate (e.g. "met Ejaz", "Ejaz se mila")
        const metPersonMatch = rest.match(/\b(?:met|se\s+mila|spoke\s+to|with)\s+([A-Za-z]+)\b/i);
        if (metPersonMatch && !/^(?:yesterday|today|tomorrow|pehle|him|her|them)$/i.test(metPersonMatch[1])) {
          const personName = this.capitalize(metPersonMatch[1]);
          const otherEntityId = `entity:person_${personName.toLowerCase()}`;
          entitiesById.set(otherEntityId, {
            id: otherEntityId,
            name: personName,
            entityType: 'person',
            relationToUser: 'associate_or_friend',
            isDirectUserRelation: false,
          });
        }

        const fact = this.extractFactFromPredicate(userRelEntityId, userRelEntityName, relation, rest, cleanMsg, context?.sourceMessageId, true);
        if (fact) {
          result.facts.push(fact);
        }
      } else {
        // ── 3. Check for Conversational Third-Party Attribution via Pronouns ─────
        // e.g. "Ejaz told me his father retired"
        const thirdPartyPronounPattern = /\b([a-zA-Z]+)\s+(?:told\s+me|said|ne\s+bataya|bola)\s+(?:that\s+)?(?:his|her|unke|uske)\s+(father|mother|dad|mom|papa|wife|husband|brother|sister|son)\s+(.*)/i;
        const thirdPartyPronounMatch = cleanMsg.match(thirdPartyPronounPattern);

        if (thirdPartyPronounMatch && !/^(?:he|she|woh|usne|maine|i)$/i.test(thirdPartyPronounMatch[1])) {
          const speakerName = this.capitalize(thirdPartyPronounMatch[1]);
          const relation = this.normalizeRelation(thirdPartyPronounMatch[2]);
          const rest = thirdPartyPronounMatch[3]?.trim() || '';

          const speakerEntityId = `entity:person_${speakerName.toLowerCase()}`;
          const derivedEntityId = `${speakerEntityId}_${relation}`;
          const derivedEntityName = `${speakerName}'s ${relation}`;

          entitiesById.set(speakerEntityId, {
            id: speakerEntityId,
            name: speakerName,
            entityType: 'person',
            relationToUser: 'associate_or_friend',
            isDirectUserRelation: false,
          });

          entitiesById.set(derivedEntityId, {
            id: derivedEntityId,
            name: derivedEntityName,
            entityType: 'person',
            relationToUser: `third_party_${relation}`,
            parentEntityId: speakerEntityId,
            isDirectUserRelation: false,
          });

          result.primarySubjectId = derivedEntityId;

          const fact = this.extractFactFromPredicate(derivedEntityId, derivedEntityName, relation, rest, cleanMsg, context?.sourceMessageId);
          if (fact) {
            result.facts.push(fact);
          }
        } else {
          // ── 4. Direct First-Person Statements (Career, Ventures, Plans) ────────
          const pastWorkMatch = cleanMsg.match(/\b(?:i\s+used\s+to\s+work\s+at|pehle\s+kaam\s+karta\s+tha|i\s+worked\s+at)\s+([A-Za-z0-9\s]+)/i);
          const curWorkMatch = cleanMsg.match(/\b(?:i\s+work\s+at|main\s+kaam\s+karta\s+hu|i\s+am\s+working\s+at)\s+([A-Za-z0-9\s]+)/i);
          const futurePlanMatch = cleanMsg.match(/\b(?:i\s+will\s+open|i\s+am\s+planning\s+to\s+open|planning\s+to\s+start|shuru\s+karne\s+ka\s+plan\s+hai)\s+([A-Za-z0-9\s]+)/i);

          if (pastWorkMatch) {
            const company = this.capitalize(pastWorkMatch[1].replace(/\.$/, '').trim());
            result.facts.push({
              subjectEntityId: 'user:self',
              subjectEntityName: 'User',
              predicate: 'past_company',
              value: company,
              rawQuote: cleanMsg,
              canonicalKey: 'past_company',
              confidence: 0.95,
              groundedInTurn: true,
              temporalState: 'PAST',
              isDirectUserFact: true,
            });
          } else if (curWorkMatch) {
            const company = this.capitalize(curWorkMatch[1].replace(/\.$/, '').trim());
            result.facts.push({
              subjectEntityId: 'user:self',
              subjectEntityName: 'User',
              predicate: 'company_name',
              value: company,
              rawQuote: cleanMsg,
              canonicalKey: 'company_name',
              confidence: 0.95,
              groundedInTurn: true,
              temporalState: 'CURRENT',
              isDirectUserFact: true,
            });
          } else if (futurePlanMatch) {
            const plan = this.capitalize(futurePlanMatch[1].replace(/\.$/, '').trim());
            result.facts.push({
              subjectEntityId: 'user:self',
              subjectEntityName: 'User',
              predicate: 'future_venture',
              value: plan,
              rawQuote: cleanMsg,
              canonicalKey: 'venture_name',
              confidence: 0.90,
              groundedInTurn: true,
              temporalState: 'FUTURE',
              isDirectUserFact: true,
            });
          }
        }
      }
    }

    result.entities = Array.from(entitiesById.values());
    return result;
  }

  /**
   * Extracts clean predicate, value, temporal validity, and canonical key
   * preserving explicit subject ownership.
   */
  private extractFactFromPredicate(
    subjectId: string,
    subjectName: string,
    relation: string,
    rest: string,
    fullMessage: string,
    sourceMessageId?: string,
    isDirectUserRelation: boolean = false
  ): ResolvedFact | null {
    if (!rest) return null;

    let predicate = 'attribute';
    let value = rest;
    let temporalState: 'PAST' | 'CURRENT' | 'FUTURE' | 'UNKNOWN' = 'CURRENT';

    const lowerRest = rest.toLowerCase();

    // 1. Military Service / Navy / Army / Air Force
    if (/navy|army|air\s*force|military|fauj|armed\s*forces/i.test(lowerRest)) {
      predicate = 'military_service';
      const branchMatch = lowerRest.match(/\b(navy|army|air\s*force|military|armed\s*forces)\b/i);
      value = branchMatch ? this.capitalize(branchMatch[1]) : 'Military';
      if (/was|the|tha|thi|retired|pehle/i.test(fullMessage)) {
        temporalState = 'PAST';
      }
    }
    // 2. Occupation / Banking / Corporate / Doctor / Teacher / Engineering
    else if (/banking|bank|doctor|engineer|teacher|professor|lawyer|police|business|consultant|architect|developer|hr/i.test(lowerRest)) {
      predicate = 'occupation';
      const occMatch = lowerRest.match(/\b(banking|bank|doctor|engineer|teacher|professor|lawyer|police|business|consultant|architect|developer|hr)\b/i);
      value = occMatch ? this.capitalize(occMatch[1]) : rest;
      if (/was|the|tha|retired/i.test(fullMessage)) {
        temporalState = 'PAST';
      }
    }
    // 3. Retirement
    else if (/retired|retire\s+ho\s+gaye|retire/i.test(lowerRest)) {
      predicate = 'status';
      value = 'Retired';
      temporalState = 'PAST';
    }
    // 4. Location / Living
    else if (/lives\s+in|living\s+in|rehta\s+hai|rehti\s+hai|rehte\s+hai|shift\s+ho\s+gaya/i.test(lowerRest)) {
      predicate = 'location';
      const hinLocMatch = rest.match(/([a-zA-Z]+)\s+me\s+(?:rehta|rehti|rehte)\s+hai/i);
      const engLocMatch = rest.match(/(?:lives\s+in|living\s+in|in)\s+([a-zA-Z\s]+)/i);
      const locMatch = hinLocMatch ? hinLocMatch[1] : (engLocMatch ? engLocMatch[1] : rest);
      value = this.capitalize(locMatch.trim());
      temporalState = 'CURRENT';
    }
    // 5. Name assignment (e.g. "is Suresh", "ka naam Suresh hai", or rest = "Suresh", "Sakshi hai")
    const fullNameMatch = fullMessage.match(/\b(?:is|ka\s+naam|name\s+is)\s+([A-Za-z]+)/i);
    if (fullNameMatch && !/^(?:navy|army|bank|banking|retired|dubai)$/i.test(fullNameMatch[1])) {
      predicate = 'name';
      value = this.capitalize(fullNameMatch[1].trim());
    } else if (predicate === 'attribute' && /^[a-zA-Z]+(?:\s+hai)?$/i.test(rest.trim())) {
      const cleanName = rest.replace(/\s+hai$/i, '').trim();
      if (cleanName.length >= 2 && !/^(?:the|tha|thi|a|an|in|at|on|good|fine|retired)$/i.test(cleanName)) {
        predicate = 'name';
        value = this.capitalize(cleanName);
      }
    }

    // Canonical key formatting:
    // If it's a DIRECT user relation (e.g. User's father), map to standard canonical key (e.g. father_occupation, father_name)
    // If it's a THIRD-PARTY entity (e.g. Ejaz's father), generate entity-scoped key!
    let canonicalKey: string;
    if (isDirectUserRelation) {
      if (predicate === 'name') {
        canonicalKey = `${relation}_name`;
      } else if (predicate === 'military_service' || predicate === 'occupation') {
        canonicalKey = `${relation}_occupation`;
      } else {
        canonicalKey = `${relation}_${predicate}`;
      }
    } else {
      // Third-party entity-scoped canonical key
      canonicalKey = `${subjectId}:${predicate}`;
    }

    return {
      subjectEntityId: subjectId,
      subjectEntityName: subjectName,
      predicate,
      value,
      canonicalKey,
      temporalState,
      confidence: 0.95,
      groundedInTurn: true,
      rawQuote: fullMessage,
      sourceMessageId,
      isDirectUserFact: isDirectUserRelation
    };
  }

  private normalizeRelation(raw: string): string {
    const lower = (raw || '').toLowerCase().trim();
    if (['father', 'dad', 'papa', 'pitaji', 'baap'].includes(lower)) return 'father';
    if (['mother', 'mom', 'mummy', 'maa', 'mataji'].includes(lower)) return 'mother';
    if (['wife', 'biwi', 'patni'].includes(lower)) return 'wife';
    if (['husband', 'pati', 'shauhar'].includes(lower)) return 'husband';
    if (['brother', 'bhai', 'bhaiya'].includes(lower)) return 'brother';
    if (['sister', 'behen', 'didi'].includes(lower)) return 'sister';
    if (['son', 'beta', 'bachha'].includes(lower)) return 'son';
    if (['daughter', 'beti'].includes(lower)) return 'daughter';
    if (['friend', 'dost', 'yaar'].includes(lower)) return 'friend';
    return lower;
  }

  private capitalize(s: string): string {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

export const entityResolutionService = EntityResolutionService.getInstance();
