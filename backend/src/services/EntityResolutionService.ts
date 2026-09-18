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

    // Split compound turns or multi-line messages by newlines or sentence delimiters
    // e.g. "Tiku mere bete ka nickname hai\n\nMera name toh Sagar hai"
    const clauses = cleanMsg.split(/\n+/).map(c => c.trim()).filter(Boolean);

    if (clauses.length > 1) {
      for (const clause of clauses) {
        this.resolveSingleClause(clause, cleanMsg, context, entitiesById, result);
      }
    } else {
      this.resolveSingleClause(cleanMsg, cleanMsg, context, entitiesById, result);
    }

    result.entities = Array.from(entitiesById.values());
    return result;
  }

  /**
   * Resolves a single sentence or clause within a turn.
   */
  private resolveSingleClause(
    clause: string,
    _fullMessage: string,
    context: {
      recentMessages?: Array<{ role: string; content: string }>;
      activeEntities?: ResolvedEntity[];
      userProfileName?: string;
      sourceMessageId?: string;
    } | undefined,
    entitiesById: Map<string, ResolvedEntity>,
    result: EntityResolutionResult
  ): void {
    const cleanMsg = clause.trim();
    if (!cleanMsg) return;

    // ── 0A. Direct User Self-Name Declarations (Identity Boundary: USER / SELF) ──
    // e.g. "Mera name toh Sagar hai", "Mera naam Sagar hai", "My name is Sagar", "Main Sagar hoon"
    // Invariant: Always binds to user:self, NEVER creates a Son or relative entity.
    const selfNamePattern = /\b(?:mera|mara|my)\s+(?:naam|name|nam)\s+(?:toh\s+|to\s+|hai\s+|is\s+|)([a-zA-Z][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i;
    const selfImPattern = /\b(?:main|mein|i\s+am|im)\s+([a-zA-Z][a-zA-Z0-9\s]*?)\s+(?:hoon|hun|hai)\b/i;
    const selfCallMePattern = /\b(?:call\s+me|mujhko|mujhe)\s+([a-zA-Z][a-zA-Z0-9\s]*?)(?:\s+bulate|\s+bulati|\s+bolte|[.,;!]|$)/i;

    const selfMatch = cleanMsg.match(selfNamePattern) || cleanMsg.match(selfImPattern) || cleanMsg.match(selfCallMePattern);
    if (selfMatch) {
      const declaredName = this.capitalize(selfMatch[1].trim().replace(/\s+(?:hai|is|toh|to)$/i, ''));
      if (declaredName && !this.isNonNameWord(declaredName) && !/^(?:beta|bete|son|wife|biwi|papa|dad|father)$/i.test(declaredName)) {
        entitiesById.get('user:self')!.name = declaredName;
        result.facts.push({
          subjectEntityId: 'user:self',
          subjectEntityName: declaredName,
          predicate: 'preferred_name',
          value: declaredName,
          canonicalKey: 'preferred_name',
          confidence: 0.99,
          groundedInTurn: true,
          rawQuote: cleanMsg,
          sourceMessageId: context?.sourceMessageId,
          isDirectUserFact: true,
          temporalState: 'CURRENT',
        });
        result.primarySubjectId = 'user:self';
        return;
      }
    }

    // ── 0B. Inverted Relationship Alias / Nickname / Name Statements ───────────
    // e.g. "Tiku mere bete ka nickname hai", "Tiku is my son's nickname"
    // Invariant: Binds strictly to relationship entity (e.g. Son), NEVER to user:self!
    const invertedRelPattern = /\b([a-zA-Z]+)\s+(?:mere|meri|mera|my)\s+(father|mother|dad|mom|papa|maa|wife|biwi|patni|husband|pati|brother|bhai|sister|behen|son|beta|daughter|beti|friend|dost|dog|cat|pet)\s*(?:ka|ki|ke|'s)?\s*(nickname|nick\s*name|pyar\s+ka\s+naam|naam|name)\s*(?:hai|is)?/i;
    const invertedRelPatternEn = /\b([a-zA-Z]+)\s+(?:is|hai)\s+(?:my|mere|meri|mera)\s+(father|mother|dad|mom|papa|maa|wife|biwi|patni|husband|pati|brother|bhai|sister|behen|son|beta|daughter|beti|friend|dost|dog|cat|pet)(?:'s)?\s*(nickname|nick\s*name|pyar\s+ka\s+naam|naam|name)?/i;

    const invertedMatch = cleanMsg.match(invertedRelPattern) || cleanMsg.match(invertedRelPatternEn);
    if (invertedMatch) {
      const entityValue = this.capitalize(invertedMatch[1].trim());
      const rawRel = invertedMatch[2].toLowerCase();
      const kind = (invertedMatch[3] || 'nickname').toLowerCase();
      const relation = this.normalizeRelation(rawRel);
      const isNickname = !kind || /nick/i.test(kind);

      if (entityValue && !this.isNonNameWord(entityValue)) {
        const userRelEntityId = `user:${relation}`;
        const userRelEntityName = `User's ${relation}`;

        if (!entitiesById.has(userRelEntityId)) {
          entitiesById.set(userRelEntityId, {
            id: userRelEntityId,
            name: userRelEntityName,
            entityType: this.isPetRelation(relation) ? 'pet' : 'person',
            relationToUser: relation,
            parentEntityId: 'user:self',
            isDirectUserRelation: true,
          });
        }

        result.facts.push({
          subjectEntityId: userRelEntityId,
          subjectEntityName: userRelEntityName,
          predicate: isNickname ? 'nickname' : 'name',
          value: entityValue,
          canonicalKey: isNickname ? `${relation}_nickname` : `${relation}_name`,
          confidence: 0.98,
          groundedInTurn: true,
          rawQuote: cleanMsg,
          sourceMessageId: context?.sourceMessageId,
          isDirectUserFact: true,
          temporalState: 'CURRENT',
        });
        result.primarySubjectId = userRelEntityId;
        return;
      }
    }

    // Pattern A: Third-party possessive English: [Name]'s [Relation] [Predicate/Verb/Attribute]
    // e.g. "Ijaz's father was in the Navy", "Sushant's wife works in banking", "Alex's dog is a Golden Retriever"
    const engPossessivePattern = /\b([a-zA-Z]+)'s\s+(father|mother|dad|mom|papa|maa|wife|biwi|patni|husband|pati|brother|bhai|sister|behen|son|beta|daughter|beti|friend|dost|partner|girlfriend|gf|boyfriend|bf|fiance|fiancee|dog|cat|puppy|kitten|pet|roommate|flatmate|colleague|coworker|boss|manager|mentor)\s+(?:was|is|worked|works|served|serves|lives|lived|retired|had\s+retired)?\s*(.*)/i;
    const engPossMatch = cleanMsg.match(engPossessivePattern);

    // Pattern B: Hinglish possessive: [Name] (ke|ki|ka) [Relation] [Predicate/Verb/Attribute]
    // e.g. "Ejaz ke papa Navy me the", "Sushant ki wife banking me hai", "Rahul ka dog Bruno hai"
    const hinPossessivePattern = /\b([a-zA-Z]+)\s+(?:ke|ki|ka)\s+(papa|father|dad|pitaji|mummy|mother|mom|maa|mataji|biwi|wife|patni|husband|pati|bhai|brother|bhaiya|behen|sister|didi|beta|son|beti|daughter|dost|friend|partner|bandi|banda|girlfriend|gf|boyfriend|bf|fiance|fiancee|kutta|dog|billi|cat|pet|roommate|flatmate|colleague|coworker|boss|manager)\s+(.*)/i;
    const hinPossMatch = cleanMsg.match(hinPossessivePattern);

    // Pattern 0: Nested friend relation: e.g. "my friend's father / wife / dog" or "mere dost ke papa"
    const nestedFriendPattern = /\b(?:my|mere|mera|meri)\s+(?:friend|dost|colleague|flatmate|roommate)(?:'s|\s+ke|\s+ki|\s+ka)\s+(father|mother|dad|mom|papa|wife|husband|brother|sister|son|daughter|dog|cat|pet)\s+(.*)/i;
    const nestedFriendMatch = cleanMsg.match(nestedFriendPattern);

    if (nestedFriendMatch) {
      const relation = this.normalizeRelation(nestedFriendMatch[1]);
      const rest = nestedFriendMatch[2]?.trim() || '';
      const isPet = this.isPetRelation(relation);

      const friendEntityId = `entity:person_friend`;
      const derivedEntityId = isPet ? `entity:pet_friend_${relation}` : `entity:person_friend_${relation}`;
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
        entityType: isPet ? 'pet' : 'person',
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
      const isPet = this.isPetRelation(relation);

      const ownerEntityId = `entity:person_${ownerName.toLowerCase()}`;
      const derivedEntityId = isPet ? `entity:pet_${ownerName.toLowerCase()}_${relation}` : `${ownerEntityId}_${relation}`;
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
        entityType: isPet ? 'pet' : 'person',
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
      const isPet = this.isPetRelation(relation);

      const ownerEntityId = `entity:person_${ownerName.toLowerCase()}`;
      const derivedEntityId = isPet ? `entity:pet_${ownerName.toLowerCase()}_${relation}` : `${ownerEntityId}_${relation}`;
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
        entityType: isPet ? 'pet' : 'person',
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
      // e.g. "My father was in the Navy", "Mere papa Navy me the", "Meri wife Sakshi", "My dog Bruno is a Golden retriever", "My flatmate Rohan works at Google"
      const directUserRelPattern = /\b(?:my|mera|meri|mere)\s+(father|mother|dad|mom|papa|maa|wife|biwi|patni|husband|pati|brother|bhai|sister|behen|son|beta|daughter|beti|friend|dost|partner|girlfriend|gf|bandi|boyfriend|bf|banda|fiance|fiancee|dog|cat|puppy|kitten|pet|kutta|billi|roommate|flatmate|colleague|coworker|boss|manager|mentor)\s*(.*)/i;
      const directMatch = cleanMsg.match(directUserRelPattern);

      if (directMatch) {
        const relation = this.normalizeRelation(directMatch[1]);
        let rest = directMatch[2]?.trim() || '';
        const isPet = this.isPetRelation(relation);

        let explicitName: string | null = null;
        const nameWordMatch = rest.match(/^([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s*(.*)/);
        if (nameWordMatch) {
          const parts = nameWordMatch[1].split(/\s+/);
          const firstWord = parts[0];
          if (!this.isNonNameWord(firstWord)) {
            if (parts.length === 2 && !this.isNonNameWord(parts[1])) {
              explicitName = this.capitalize(parts[0]) + ' ' + this.capitalize(parts[1]);
              rest = nameWordMatch[2].trim();
            } else {
              explicitName = this.capitalize(parts[0]);
              rest = (parts.slice(1).join(' ') + ' ' + nameWordMatch[2]).trim();
            }
          }
        }

        let userRelEntityId: string;
        let userRelEntityName: string;

        if (explicitName) {
          userRelEntityId = isPet ? `entity:pet_${explicitName.toLowerCase().replace(/\s+/g, '_')}` : (['partner', 'girlfriend', 'boyfriend'].includes(relation) ? `entity:partner_${explicitName.toLowerCase().replace(/\s+/g, '_')}` : `entity:person_${explicitName.toLowerCase().replace(/\s+/g, '_')}`);
          userRelEntityName = explicitName;
        } else {
          userRelEntityId = isPet ? `user:pet:${relation}` : `user:${relation}`;
          userRelEntityName = `User's ${relation}`;
        }

        const relEntity: ResolvedEntity = {
          id: userRelEntityId,
          name: userRelEntityName,
          entityType: isPet ? 'pet' : 'person',
          relationToUser: relation,
          parentEntityId: 'user:self',
          isDirectUserRelation: true,
        };
        entitiesById.set(userRelEntityId, relEntity);
        result.primarySubjectId = userRelEntityId;

        if (explicitName) {
          result.facts.push({
            subjectEntityId: userRelEntityId,
            subjectEntityName: userRelEntityName,
            predicate: 'name',
            value: explicitName,
            canonicalKey: `${relation}_name`,
            confidence: 0.95,
            groundedInTurn: true,
            rawQuote: cleanMsg,
            sourceMessageId: context?.sourceMessageId,
            isDirectUserFact: true,
            temporalState: 'CURRENT'
          });
        }

        // Clean leading auxiliary words from rest (e.g. "is a Golden retriever" -> "a Golden retriever")
        const cleanRest = rest.replace(/^(?:is|was|are|were|ka\s+naam|name\s+is)\s+/i, '');

        // Check if another named person was mentioned in the predicate (e.g. "met Ejaz", "Ejaz se mila")
        const metPersonMatch = cleanRest.match(/\b(?:met|se\s+mila|spoke\s+to|with)\s+([A-Za-z]+)\b/i);
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

        const fact = this.extractFactFromPredicate(userRelEntityId, userRelEntityName, relation, cleanRest || rest, cleanMsg, context?.sourceMessageId, true);
        if (fact) {
          result.facts.push(fact);
        }
      } else {
        // ── 3. Check for Conversational Third-Party Attribution via Pronouns ─────
        // e.g. "Ejaz told me his father retired", "Sara said her dog was sick"
        const thirdPartyPronounPattern = /\b([a-zA-Z]+)\s+(?:told\s+me|said|ne\s+bataya|bola)\s+(?:that\s+)?(?:his|her|unke|uske)\s+(father|mother|dad|mom|papa|wife|husband|brother|sister|son|daughter|beti|friend|partner|girlfriend|boyfriend|dog|cat|pet|roommate|colleague|boss|manager)\s+(.*)/i;
        const thirdPartyPronounMatch = cleanMsg.match(thirdPartyPronounPattern);

        if (thirdPartyPronounMatch && !/^(?:he|she|woh|usne|maine|i)$/i.test(thirdPartyPronounMatch[1])) {
          const speakerName = this.capitalize(thirdPartyPronounMatch[1]);
          const relation = this.normalizeRelation(thirdPartyPronounMatch[2]);
          const rest = thirdPartyPronounMatch[3]?.trim() || '';
          const isPet = this.isPetRelation(relation);

          const speakerEntityId = `entity:person_${speakerName.toLowerCase()}`;
          const derivedEntityId = isPet ? `entity:pet_${speakerName.toLowerCase()}_${relation}` : `${speakerEntityId}_${relation}`;
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
            entityType: isPet ? 'pet' : 'person',
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
          // ── 4. Direct First-Person Statements (Career, Ventures, Plans, Lifestyle) ────────
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

          // Direct First-Person Lifestyle & Habits
          const smokeMatch = cleanMsg.match(/\b(?:i\s+smoke|main\s+smoke\s+karta\s+hu|i\s+smoke\s+occasionally|sushant\s+ke\s+sath\s+smoke\s+karta\s+hu|i\s+quit\s+smoking|maine\s+smoking\s+chhod\s+di|i\s+used\s+to\s+smoke)\b/i);
          if (smokeMatch) {
            const isQuit = /\b(?:quit|chhod|used\s+to|pehle|stopped)\b/i.test(cleanMsg);
            result.facts.push({
              subjectEntityId: 'user:self',
              subjectEntityName: 'User',
              predicate: 'smoking_habit',
              value: isQuit ? 'Quit / Non-Smoker' : (cleanMsg.toLowerCase().includes('occasionally') ? 'Occasional Smoker' : 'Smoker'),
              rawQuote: cleanMsg,
              canonicalKey: 'smoking_habit',
              confidence: 0.95,
              groundedInTurn: true,
              temporalState: isQuit ? 'PAST' : 'CURRENT',
              isDirectUserFact: true,
            });
          }

          const drinkMatch = cleanMsg.match(/\b(?:i\s+(?:rarely\s+drink|drink\s+occasionally|drink\s+alcohol|don't\s+drink|quit\s+drinking)|main\s+(?:drink\s+karta\s+hu|peena\s+chhod\s+diya))\b/i);
          if (drinkMatch) {
            const isNonDrinker = /\b(?:don't|quit|chhod|never|peena\s+chhod)\b/i.test(cleanMsg);
            result.facts.push({
              subjectEntityId: 'user:self',
              subjectEntityName: 'User',
              predicate: 'drinking_habit',
              value: isNonDrinker ? 'Non-Drinker' : 'Occasional Drinker',
              rawQuote: cleanMsg,
              canonicalKey: 'drinking_habit',
              confidence: 0.95,
              groundedInTurn: true,
              temporalState: isNonDrinker ? 'PAST' : 'CURRENT',
              isDirectUserFact: true,
            });
          }
        }
      }
    }

    result.entities = Array.from(entitiesById.values());
    return;
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

    const lowerRest = rest.toLowerCase().trim();

    // 1. Military Service / Navy / Army / Air Force
    if (/\b(?:navy|army|air\s*force|military|fauj|armed\s*forces)\b/i.test(lowerRest)) {
      predicate = 'military_service';
      const branchMatch = lowerRest.match(/\b(navy|army|air\s*force|military|armed\s*forces)\b/i);
      value = branchMatch ? this.capitalize(branchMatch[1]) : 'Military';
      if (/was|the|tha|thi|retired|pehle/i.test(fullMessage)) {
        temporalState = 'PAST';
      }
    }
    // 2. Comprehensive Occupation / Role / Profession
    else if (/\b(banking|banker|bank|doctor|surgeon|physician|dentist|engineer|developer|programmer|coder|teacher|professor|lecturer|student|scholar|lawyer|advocate|judge|police|inspector|cop|business|businessman|businesswoman|consultant|architect|hr|recruiter|housewife|homemaker|nurse|designer|freelancer|accountant|ca|chartered\s+accountant|driver|pilot|chef|cook|baker|artist|painter|trainer|gym\s+trainer|fitness\s+trainer|writer|author|musician|singer|dancer|actor|actress|scientist|researcher|clerk|manager|director|executive|analyst|unemployed)\b/i.test(lowerRest)) {
      predicate = 'occupation';
      const occMatch = lowerRest.match(/\b(banking|banker|bank|doctor|surgeon|physician|dentist|engineer|developer|programmer|coder|teacher|professor|lecturer|student|scholar|lawyer|advocate|judge|police|inspector|cop|business|businessman|businesswoman|consultant|architect|hr|recruiter|housewife|homemaker|nurse|designer|freelancer|accountant|ca|chartered\s+accountant|driver|pilot|chef|cook|baker|artist|painter|trainer|gym\s+trainer|fitness\s+trainer|writer|author|musician|singer|dancer|actor|actress|scientist|researcher|clerk|manager|director|executive|analyst|unemployed)\b/i);
      value = occMatch ? this.capitalize(occMatch[1]) : rest;
      if (/was|the|tha|thi|retired|pehle/i.test(fullMessage)) {
        temporalState = 'PAST';
      }
    }
    // 3. Retirement / Status
    else if (/retired|retire\s+ho\s+gaye|retire/i.test(lowerRest)) {
      predicate = 'status';
      value = 'Retired';
      temporalState = 'PAST';
    }
    // 4. Marital / Relationship Status
    else if (/\b(single|married|unmarried|divorced|widowed|engaged|shadi\s+shuda|kunwara|kunwari)\b/i.test(lowerRest)) {
      predicate = 'marital_status';
      const marMatch = lowerRest.match(/\b(single|married|unmarried|divorced|widowed|engaged)\b/i);
      value = marMatch ? this.capitalize(marMatch[1]) : (lowerRest.includes('shadi') ? 'Married' : 'Single');
      temporalState = 'CURRENT';
    }
    // 5. Dietary Preference
    else if (/\b(vegetarian|vegan|eggetarian|non-vegetarian|non-veg|veg|jain|keto)\b/i.test(lowerRest)) {
      predicate = 'dietary_preference';
      const dietMatch = lowerRest.match(/\b(vegetarian|vegan|eggetarian|non-vegetarian|non-veg|veg|jain|keto)\b/i);
      value = dietMatch ? this.capitalize(dietMatch[1]) : rest;
      temporalState = 'CURRENT';
    }
    // 6. Breed (for pets)
    else if (/golden retriever|german shepherd|labrador|beagle|poodle|pug|persian|husky|rottweiler|indie|shih tzu|bulldog|corgi|boxer|dachshund|pomeranian|golden/i.test(lowerRest)) {
      predicate = 'breed';
      const breedMatch = lowerRest.match(/\b(golden retriever|german shepherd|labrador|beagle|poodle|pug|persian|husky|rottweiler|indie|shih tzu|bulldog|corgi|boxer|dachshund|pomeranian|golden)\b/i);
      value = breedMatch ? this.capitalize(breedMatch[1] === 'golden' ? 'Golden Retriever' : breedMatch[1]) : rest;
      temporalState = 'CURRENT';
    }
    // 7. Location / Living
    else if (/lives\s+in|living\s+in|rehta\s+hai|rehti\s+hai|rehte\s+hai|shift\s+ho\s+gaya|staying\s+in|stays\s+in/i.test(lowerRest)) {
      predicate = 'location';
      const hinLocMatch = rest.match(/([a-zA-Z]+)\s+me\s+(?:rehta|rehti|rehte)\s+hai/i);
      const engLocMatch = rest.match(/(?:lives\s+in|living\s+in|in|stays\s+in)\s+([a-zA-Z\s]+)/i);
      const locMatch = hinLocMatch ? hinLocMatch[1] : (engLocMatch ? engLocMatch[1] : rest);
      value = this.capitalize(locMatch.trim().replace(/\.$/, ''));
      temporalState = 'CURRENT';
    }
    // 8. Employer / Workplace (e.g. "works at Google", "Microsoft me kaam karta hai")
    else if (/works?\s+(?:at|for|in)\s+([a-zA-Z0-9\s]+)/i.test(lowerRest) || /([a-zA-Z0-9\s]+)\s+me\s+(?:kaam\s+karta|job\s+karta)/i.test(lowerRest)) {
      predicate = 'employer';
      const empEng = rest.match(/works?\s+(?:at|for|in)\s+([a-zA-Z0-9\s\.\-]+)/i);
      const empHin = rest.match(/([a-zA-Z0-9\s\.\-]+)\s+me\s+(?:kaam|job)/i);
      const matchedComp = empEng ? empEng[1].trim().replace(/\.$/, '') : (empHin ? empHin[1].trim() : rest);
      value = this.capitalize(matchedComp);
      temporalState = 'CURRENT';
    }
    // 9. Interests / Passions / Hobbies (e.g. "loves photography", "likes painting")
    else if (/(?:loves|likes|enjoys|into|fan\s+of)\s+([a-zA-Z\s]+)/i.test(lowerRest)) {
      predicate = 'interest';
      const intMatch = rest.match(/(?:loves|likes|enjoys|into|fan\s+of)\s+([a-zA-Z\s]+)/i);
      value = this.capitalize(intMatch ? intMatch[1].trim().replace(/\.$/, '') : rest);
      temporalState = 'CURRENT';
    }

    // 10. Name assignment (e.g. "is Suresh", "ka naam Suresh hai", or rest = "Suresh", "Sakshi hai")
    if (predicate === 'attribute') {
      const fullNameMatch = rest.match(/\b(?:is|ka\s+naam|name\s+is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
      if (fullNameMatch) {
        const cleanMatched = fullNameMatch[1].replace(/\s+(?:hai|is|tha|thi|hoon|hun)$/i, '').trim();
        const firstWord = cleanMatched.split(/\s+/)[0];
        if (cleanMatched.length >= 2 && !this.isNonNameWord(firstWord) && !/^(?:mera|meri|mere|my|toh|to)$/i.test(firstWord)) {
          predicate = 'name';
          value = cleanMatched.split(/\s+/).map(w => this.capitalize(w)).join(' ').trim();
        }
      } else if (/^[a-zA-Z]+(?:\s+[a-zA-Z]+)?(?:\s+hai)?$/i.test(rest.trim())) {
        const cleanName = rest.replace(/\s+(?:hai|is|tha|thi|hoon|hun)$/i, '').trim();
        const firstWord = cleanName.split(/\s+/)[0];
        if (cleanName.length >= 2 && !this.isNonNameWord(firstWord) && !/^(?:mera|meri|mere|my|toh|to)$/i.test(firstWord)) {
          predicate = 'name';
          value = cleanName.split(/\s+/).map(w => this.capitalize(w)).join(' ').trim();
        }
      }
    }

    // Canonical key formatting:
    // If it's a DIRECT user relation (e.g. User's father), map to standard canonical key (e.g. father_occupation, father_name, brother_location)
    // If it's a THIRD-PARTY entity (e.g. Ejaz's father), generate entity-scoped key!
    let canonicalKey: string;
    if (isDirectUserRelation) {
      if (predicate === 'name') {
        canonicalKey = `${relation}_name`;
      } else if (predicate === 'nickname') {
        canonicalKey = `${relation}_nickname`;
      } else if (predicate === 'military_service' || predicate === 'occupation') {
        canonicalKey = `${relation}_occupation`;
      } else if (predicate === 'breed') {
        canonicalKey = `${relation}_breed`;
      } else if (predicate === 'location') {
        canonicalKey = `${relation}_location`;
      } else if (predicate === 'status') {
        canonicalKey = `${relation}_status`;
      } else {
        canonicalKey = `${relation}_${predicate}`;
      }
    } else if (subjectId.startsWith('entity:')) {
      canonicalKey = `${subjectId}:${predicate}`;
    } else {
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

  /**
   * Deterministically returns true if a word or token is a stopword, auxiliary verb,
   * occupation, role, pet breed, lifestyle habit, status, or adjective that should NEVER
   * be classified as a personal entity name.
   */
  public isNonNameWord(word: string): boolean {
    if (!word) return true;
    const lower = word.toLowerCase().trim().replace(/[.,;!?]+$/, '');
    if (lower.length <= 1) return true;

    // 1. Auxiliary verbs, pronouns, prepositions, articles, stopwords (English & Hinglish)
    const STOP_WORDS = new Set([
      'is', 'was', 'are', 'were', 'has', 'had', 'have', 'works', 'worked', 'working',
      'lives', 'lived', 'living', 'loves', 'loved', 'likes', 'liked', 'enjoys',
      'told', 'said', 'met', 'visited', 'bought', 'got', 'went', 'stays', 'staying',
      'ka', 'ki', 'ke', 'ko', 'se', 'ne', 'me', 'mein', 'par', 'pe', 'to', 'aur', 'ya', 'yaa',
      'a', 'an', 'the', 'in', 'at', 'on', 'for', 'from', 'with', 'about', 'by',
      'not', 'never', 'always', 'very', 'too', 'nahi', 'mat', 'bhi', 'ek',
      'hai', 'hain', 'tha', 'thi', 'the', 'hoon', 'hun', 'ho', 'gaya', 'gayi', 'gaye', 'raha', 'rahi', 'rahe',
      'naam', 'name', 'named', 'called', 'actual', 'real', 'formal', 'nick', 'nickname',
      'unka', 'unki', 'unke', 'uska', 'uski', 'uske', 'mera', 'meri', 'mere', 'apna', 'apni', 'apne',
      'hum', 'humara', 'humari', 'humare', 'yeh', 'woh', 'ye', 'wo', 'kya', 'kaun', 'kaunsa',
      'good', 'fine', 'well', 'bad', 'bura', 'achha', 'acha', 'sahi', 'galat',
      'yesterday', 'today', 'tomorrow', 'pehle', 'abhi', 'now', 'then',
      'year', 'years', 'month', 'months', 'day', 'days', 'old', 'saal'
    ]);
    if (STOP_WORDS.has(lower)) return true;

    // 2. Relational nouns
    const RELATIONAL_WORDS = new Set([
      'father', 'mother', 'dad', 'mom', 'papa', 'maa', 'pitaji', 'mataji', 'baap',
      'brother', 'bhai', 'bhaiya', 'sister', 'behen', 'didi',
      'wife', 'biwi', 'patni', 'husband', 'pati', 'shauhar', 'spouse',
      'son', 'beta', 'daughter', 'beti', 'child', 'bachha',
      'friend', 'dost', 'yaar', 'colleague', 'coworker', 'roommate', 'flatmate',
      'boss', 'manager', 'partner', 'girlfriend', 'gf', 'boyfriend', 'bf', 'banda', 'bandi',
      'dog', 'cat', 'pet', 'puppy', 'kitten', 'kutta', 'billi'
    ]);
    if (RELATIONAL_WORDS.has(lower)) return true;

    // 3. Occupations, professions, roles, and employment statuses
    const OCCUPATIONS = new Set([
      'doctor', 'dr', 'physician', 'surgeon', 'dentist', 'engineer', 'developer', 'coder', 'programmer',
      'teacher', 'professor', 'lecturer', 'educator', 'student', 'scholar',
      'lawyer', 'advocate', 'judge', 'police', 'inspector', 'officer', 'cop',
      'housewife', 'homemaker', 'nurse', 'designer', 'architect', 'freelancer',
      'accountant', 'ca', 'auditor', 'banker', 'banking', 'bank',
      'driver', 'pilot', 'captain', 'chef', 'cook', 'baker',
      'artist', 'painter', 'trainer', 'coach', 'gym_trainer', 'instructor',
      'writer', 'author', 'poet', 'musician', 'singer', 'dancer', 'actor', 'actress',
      'scientist', 'researcher', 'clerk', 'manager', 'lead', 'director',
      'founder', 'cofounder', 'entrepreneur', 'businessman', 'businesswoman', 'business',
      'ceo', 'cto', 'cfo', 'coo', 'executive', 'analyst', 'consultant', 'hr', 'recruiter',
      'intern', 'employee', 'worker', 'unemployed', 'retired', 'peon', 'security', 'guard'
    ]);
    if (OCCUPATIONS.has(lower)) return true;

    // 4. Pet breeds and animal traits
    const PET_BREEDS = new Set([
      'golden', 'retriever', 'golden retriever', 'german', 'shepherd', 'german shepherd',
      'labrador', 'lab', 'beagle', 'poodle', 'pug', 'persian', 'husky', 'rottweiler',
      'indie', 'shih', 'tzu', 'shih tzu', 'bulldog', 'corgi', 'boxer', 'dachshund',
      'doberman', 'pomeranian', 'chihuahua', 'great dane', 'maltese', 'dalmatian'
    ]);
    if (PET_BREEDS.has(lower)) return true;

    // 5. Dietary preferences, habits, and lifestyles
    const LIFESTYLE_WORDS = new Set([
      'vegetarian', 'vegan', 'eggetarian', 'non-vegetarian', 'non-veg', 'veg', 'nonveg', 'jain', 'keto',
      'smoker', 'non-smoker', 'drinker', 'non-drinker', 'alcoholic',
      'gym', 'fitness', 'workout', 'yoga', 'runner', 'athlete'
    ]);
    if (LIFESTYLE_WORDS.has(lower)) return true;

    // 6. Marital, physical, and demographic states
    const STATUS_WORDS = new Set([
      'single', 'married', 'unmarried', 'divorced', 'widowed', 'engaged',
      'sick', 'ill', 'bimar', 'fit', 'healthy', 'tall', 'short', 'fat', 'slim',
      'young', 'old', 'teenager', 'adult', 'alive', 'dead', 'passed away'
    ]);
    if (STATUS_WORDS.has(lower)) return true;

    return false;
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
    if (['girlfriend', 'gf', 'bandi'].includes(lower)) return 'girlfriend';
    if (['boyfriend', 'bf', 'banda'].includes(lower)) return 'boyfriend';
    if (['partner', 'fiance', 'fiancee'].includes(lower)) return 'partner';
    if (['dog', 'puppy', 'doggo', 'kutta', 'kutti'].includes(lower)) return 'dog';
    if (['cat', 'kitten', 'kitty', 'billi'].includes(lower)) return 'cat';
    if (['pet'].includes(lower)) return 'pet';
    if (['roommate', 'flatmate', 'roomie'].includes(lower)) return 'roommate';
    if (['colleague', 'coworker', 'teammate'].includes(lower)) return 'colleague';
    if (['boss', 'manager', 'lead', 'supervisor'].includes(lower)) return 'manager';
    if (['mentor', 'coach', 'guru'].includes(lower)) return 'mentor';
    return lower;
  }

  private isPetRelation(relation: string): boolean {
    return ['dog', 'cat', 'puppy', 'kitten', 'pet'].includes(relation.toLowerCase());
  }

  private capitalize(s: string): string {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

export const entityResolutionService = EntityResolutionService.getInstance();
