/**
 * NovaContext.ts — Conversational State, Entity Focus, and Platform Awareness (Phase 1)
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. CONTEXT PRESERVATION: Maintains current conversational subject across turns so
 *    "he", "his", "Tiku", "my son", "that place", "there" resolve to the correct entity.
 * 2. ENTITY OWNERSHIP: Facts strictly belong to entities; domains are taxonomic namespaces.
 * 3. NO FULL-DATABASE SCANS: Candidate memory retrieval is bounded and index-backed.
 * 4. PLATFORM-AWARE AUTONOMY: Captures device foreground, audio route, and push constraints.
 */

export interface ContextEntity {
  id: string;                     // e.g. "entity:person_shreshth" or UUID
  name: string;                   // e.g. "Shreshth"
  entityType: 'person' | 'organization' | 'pet' | 'place' | 'venture' | 'concept';
  relationToUser?: string;        // e.g. "son", "wife", "friend", "colleague"
  gender?: 'masculine' | 'feminine' | 'neutral';
  aliases: string[];              // e.g. ["Tiku", "Tuku", "Beta", "My Son"]
  parentBubbleId?: string;        // Canonical hierarchy link
  domainKey?: string;             // Organizational taxonomy: "family", "work", etc.
  lastMentionedAt: string;        // ISO-8601
  mentionCount: number;
}

export interface EntityFocusState {
  activeEntity: ContextEntity | null;  // Current focal entity in dialog
  activeDomain: string | null;         // Current taxonomic domain
  recentEntities: ContextEntity[];     // Bounded ring buffer of recently mentioned entities (max 5)
}

export interface PlatformConstraints {
  isAppForeground: boolean;
  canSpeak: boolean;                   // Device speaker available & appropriate
  canPush: boolean;                    // Push notifications permitted & enabled
  isScreenLocked: boolean;             // Device screen locked / in-pocket
  networkType?: 'wifi' | 'cellular' | 'none';
}

export interface TemporalContext {
  nowLocal: Date;
  timezoneOffsetHours: number;
  timeStr: string;                     // e.g. "10:30 PM"
  dayName: string;                     // e.g. "Thursday"
  dateStr: string;                     // e.g. "Sep 17, 2026"
  isWeekend: boolean;
  isQuietHours: boolean;               // Sleep hours (e.g. 11 PM - 7 AM)
  timeOfDayLabel: 'morning' | 'afternoon' | 'evening' | 'night';
}

export interface CandidateMemoryFact {
  id?: string;
  key: string;
  value: string;
  bubbleId?: string;
  subjectEntityId?: string;
  confidence: number;
  isCurrent: boolean;
}

export interface CandidateKnowledge {
  entities: ContextEntity[];
  facts: CandidateMemoryFact[];
  activeReminders: Array<{ id: string; title: string; triggerAt?: string }>;
  activeGoals: Array<{ id: string; title: string; category?: string }>;
}

export interface NovaPipelineContext {
  userId: string;
  conversationId: string;
  turnId: string;
  turnSequence: number;
  userProfile: {
    preferredName?: string;
    personality?: string;
    language?: 'en' | 'hi' | 'auto';
  };
  entityFocus: EntityFocusState;
  platform: PlatformConstraints;
  temporal: TemporalContext;
  candidates: CandidateKnowledge;
  customState: Record<string, unknown>;
}

/**
 * Contextual Resolution Engine.
 * Resolves pronouns and aliases against conversational antecedents.
 */
export class ContextResolver {
  /**
   * Resolves pronouns ("he", "his", "she", "her", "that place", "there")
   * against activeEntity and recentEntities.
   */
  static resolvePronoun(
    pronounOrRef: string,
    focus: EntityFocusState
  ): ContextEntity | null {
    const term = pronounOrRef.trim().toLowerCase();

    // Masculine pronouns
    if (['he', 'him', 'his', 'woh', 'usne', 'uska', 'unka', 'bhai'].includes(term)) {
      if (focus.activeEntity && focus.activeEntity.gender === 'masculine') {
        return focus.activeEntity;
      }
      const match = focus.recentEntities.find(
        (e) => e.gender === 'masculine' || (e.entityType === 'person' && !e.gender)
      );
      if (match) return match;
    }

    // Feminine pronouns
    if (['she', 'her', 'hers', 'uski', 'unkee'].includes(term)) {
      if (focus.activeEntity && focus.activeEntity.gender === 'feminine') {
        return focus.activeEntity;
      }
      const match = focus.recentEntities.find((e) => e.gender === 'feminine');
      if (match) return match;
    }

    // Location references
    if (['there', 'that place', 'vahan', 'wahan', 'woh jagah'].includes(term)) {
      if (focus.activeEntity && focus.activeEntity.entityType === 'place') {
        return focus.activeEntity;
      }
      const match = focus.recentEntities.find((e) => e.entityType === 'place');
      if (match) return match;
    }

    // Default neutral pronoun or active subject continuation ("it", "they")
    if (['it', 'they', 'them', 'yeh', 'ye'].includes(term)) {
      if (focus.activeEntity) return focus.activeEntity;
    }

    return null;
  }

  /**
   * Resolves kinship aliases ("my son", "son", "beta", "wife", "biwi", "dost")
   * or personal nicknames ("Tiku", "Tuku") against active and candidate entities.
   */
  static resolveAliasOrRelation(
    aliasOrRelation: string,
    focus: EntityFocusState,
    candidates: ContextEntity[] = []
  ): ContextEntity | null {
    const raw = aliasOrRelation.trim().toLowerCase();
    const clean = raw.replace(/^(?:my|mera|meri|mere)\s+/i, '');

    // 1. Check activeEntity direct match
    if (focus.activeEntity) {
      if (
        focus.activeEntity.name.toLowerCase() === raw ||
        focus.activeEntity.name.toLowerCase() === clean ||
        focus.activeEntity.relationToUser?.toLowerCase() === clean ||
        focus.activeEntity.aliases.some((a) => a.toLowerCase() === raw || a.toLowerCase() === clean)
      ) {
        return focus.activeEntity;
      }
    }

    // 2. Check recentEntities
    for (const ent of focus.recentEntities) {
      if (
        ent.name.toLowerCase() === raw ||
        ent.name.toLowerCase() === clean ||
        ent.relationToUser?.toLowerCase() === clean ||
        ent.aliases.some((a) => a.toLowerCase() === raw || a.toLowerCase() === clean)
      ) {
        return ent;
      }
    }

    // 3. Check candidates retrieved from indexed candidate query
    for (const ent of candidates) {
      if (
        ent.name.toLowerCase() === raw ||
        ent.name.toLowerCase() === clean ||
        ent.relationToUser?.toLowerCase() === clean ||
        ent.aliases.some((a) => a.toLowerCase() === raw || a.toLowerCase() === clean)
      ) {
        return ent;
      }
    }

    return null;
  }

  /**
   * Updates EntityFocusState after an entity is mentioned or activated in the turn.
   */
  static updateFocus(
    currentState: EntityFocusState,
    entity: ContextEntity,
    domain?: string
  ): EntityFocusState {
    const updatedEntity: ContextEntity = {
      ...entity,
      lastMentionedAt: new Date().toISOString(),
      mentionCount: (entity.mentionCount || 0) + 1,
    };

    // Filter out previous occurrence if present, then prepend
    const remaining = currentState.recentEntities.filter((e) => e.id !== entity.id);
    const recentEntities = [updatedEntity, ...remaining].slice(0, 5);

    return {
      activeEntity: updatedEntity,
      activeDomain: domain || entity.domainKey || currentState.activeDomain,
      recentEntities,
    };
  }
}
