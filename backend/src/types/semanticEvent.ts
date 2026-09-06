/**
 * SemanticEvent — Nova canonical state authority boundary (Phase 10)
 *
 * INVARIANT:
 *   SemanticInterpreter → SemanticValidator → SemanticEvent[]
 *
 * SemanticEvent[] is the ONLY state-authoritative representation.
 * No downstream component may reinterpret the same user message for
 * authoritative durable state.
 *
 * CRITICAL: eventId is a PROVENANCE identifier only.
 *   NEVER use eventId as delivery idempotencyKey or durable logicalKey.
 *   Delivery identity is derived from stable logical keys (canonicalKey + value
 *   hash) in the outbound stack — per the Phase 8/9 idempotency contract.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReminderSpecLike = Record<string, any>;

export type SemanticEventFamily =
  | 'FactAsserted'
  | 'FactCorrected'
  | 'ScheduleAsserted'
  | 'RelationshipAsserted'
  | 'GoalAsserted'
  | 'GoalCorrected';

export type SemanticAuthority =
  | 'explicit_user'          // User explicitly stated / commanded
  | 'subconscious_inference' // Inferred from conversational context
  | 'onboarding_seed';       // Bootstrapped from structured onboarding form

/**
 * Common base for all SemanticEvents.
 *
 * eventId: crypto.randomUUID() at toSemanticEvents() time (post-validation).
 *   Provenance lineage only. Never a durable delivery key.
 *
 * sourceMessageId: chat_history row id of the originating user message.
 *   Used as source_message provenance in DB rows.
 */
export interface SemanticEventBase {
  eventId: string;
  userId: string;
  sourceMessageId: string;
  authority: SemanticAuthority;
  confidence: number;
  createdAt: string; // ISO 8601
}

/** New fact the user is asserting. */
export interface FactAssertedEvent extends SemanticEventBase {
  family: 'FactAsserted';
  canonicalKey: string;
  value: string;
}

/**
 * Correction to a previously asserted fact.
 *
 * supersedesEventId / supersedesValue: populated by CorrectionPropagator
 * from the DB lookup of the prior memory row. May be absent if no prior
 * row exists (first-time correction of an unrecorded fact).
 */
export interface FactCorrectedEvent extends SemanticEventBase {
  family: 'FactCorrected';
  canonicalKey: string;
  newValue: string;
  priorValue?: string;          // what user said was wrong (from SemanticInterpreter)
  correctionIntent: 'replace' | 'append' | 'delete';
  supersedesEventId?: string;   // provenance link to prior FactAsserted
  supersedesValue?: string;     // DB-persisted value being replaced (from CorrectionPropagator)
}

/**
 * A fully-validated, unambiguous reminder schedule.
 *
 * CONTRACT: Ambiguous intents (e.g. "mom ko 9 baje" without prior context
 * establishing that "mom" means Monday morning) MUST NOT produce this event.
 * SemanticValidator must return requiresClarification = true instead.
 * A low-confidence reminder is still a mutation — it must be clarified first.
 */
export interface ScheduleAssertedEvent extends SemanticEventBase {
  family: 'ScheduleAsserted';
  reminderSpec: ReminderSpecLike;
}

/** Person-linked relationship fact. Requires KG entity propagation in addition to memory. */
export interface RelationshipAssertedEvent extends SemanticEventBase {
  family: 'RelationshipAsserted';
  relationship: string;           // 'wife', 'mother', 'brother', etc.
  relatedPersonName: string;
  relatedPersonNickname?: string;
  canonicalKey: string;           // e.g. 'wife_name'
}

/** User asserts a life goal or project intent. */
export interface GoalAssertedEvent extends SemanticEventBase {
  family: 'GoalAsserted';
  goalDescription: string;
  goalKey?: string;
}

/**
 * User corrects/pauses/abandons a previously stated goal.
 * status: 'paused' = temporary (abhi nahi), 'abandoned' = permanent, 'resumed' = reactivated.
 */
export interface GoalCorrectedEvent extends SemanticEventBase {
  family: 'GoalCorrected';
  goalKey?: string;
  goalDescription?: string;
  status: 'paused' | 'abandoned' | 'resumed';
  supersedesEventId?: string;
}

export type SemanticEvent =
  | FactAssertedEvent
  | FactCorrectedEvent
  | ScheduleAssertedEvent
  | RelationshipAssertedEvent
  | GoalAssertedEvent
  | GoalCorrectedEvent;

// ── Type guards ────────────────────────────────────────────────────────────────
export const isFactAsserted        = (e: SemanticEvent): e is FactAssertedEvent        => e.family === 'FactAsserted';
export const isFactCorrected       = (e: SemanticEvent): e is FactCorrectedEvent       => e.family === 'FactCorrected';
export const isScheduleAsserted    = (e: SemanticEvent): e is ScheduleAssertedEvent    => e.family === 'ScheduleAsserted';
export const isRelationshipAsserted = (e: SemanticEvent): e is RelationshipAssertedEvent => e.family === 'RelationshipAsserted';
export const isGoalAsserted        = (e: SemanticEvent): e is GoalAssertedEvent        => e.family === 'GoalAsserted';
export const isGoalCorrected       = (e: SemanticEvent): e is GoalCorrectedEvent       => e.family === 'GoalCorrected';

// ── Relationship key helpers ───────────────────────────────────────────────────

const RELATIONSHIP_CANONICAL_KEYS: Record<string, string> = {
  wife: 'wife_name', husband: 'husband_name',
  mother: 'mother_name', mom: 'mother_name', mummy: 'mother_name', maa: 'mother_name',
  father: 'father_name', dad: 'father_name', papa: 'father_name',
  brother: 'brother_name', bhai: 'brother_name',
  sister: 'sister_name', behen: 'sister_name', didi: 'sister_name',
  son: 'son_name', beta: 'son_name',
  daughter: 'daughter_name', beti: 'daughter_name',
  grandfather: 'grandfather_name', grandmother: 'grandmother_name',
};

export function relationshipToCanonicalKey(relationship: string): string | undefined {
  return RELATIONSHIP_CANONICAL_KEYS[relationship.toLowerCase()];
}

export function isRelationshipKey(canonicalKey: string): boolean {
  return canonicalKey.endsWith('_name') || canonicalKey.endsWith('_nickname');
}

/** Canonical keys that map directly to columns in the profiles table. */
export const PROFILE_MAPPED_KEYS = new Set<string>([
  'preferred_name', 'timezone', 'timezone_offset', 'country', 'birth_date',
]);

export function isProfileMappedKey(canonicalKey: string): boolean {
  return PROFILE_MAPPED_KEYS.has(canonicalKey);
}
