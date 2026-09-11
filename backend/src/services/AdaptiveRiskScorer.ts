/**
 * AdaptiveRiskScorer.ts — Continuous 360° Adaptive Risk & Uncertainty Scoring
 *
 * Implements Section 13 Adaptive Verification Loop:
 * Evaluates conversational and memory mutations to dynamically assign a risk score:
 * - LOW RISK (0 - 30): Lightweight validation (instant delivery, 0 overhead)
 * - MEDIUM RISK (31 - 70): Deeper semantic validation (antecedents, entity ownership, temporal truth)
 * - HIGH RISK (71 - 100): Multi-model verification + strict reconciliation + correction logging
 */

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskFactor {
  name: string;
  weight: number;
  description: string;
}

export interface RiskAssessment {
  score: number;
  tier: RiskTier;
  factors: RiskFactor[];
  requiresMultiModelCheck: boolean;
  requiresDeepReconciliation: boolean;
}

export class AdaptiveRiskScorer {
  private static instance: AdaptiveRiskScorer;

  static getInstance(): AdaptiveRiskScorer {
    if (!AdaptiveRiskScorer.instance) {
      AdaptiveRiskScorer.instance = new AdaptiveRiskScorer();
    }
    return AdaptiveRiskScorer.instance;
  }

  /**
   * Evaluates the incoming turn, extracted facts, and historical context
   * to determine the adaptive risk score.
   */
  evaluate(
    userMessage: string,
    extractedFacts: Array<{ key: string; value: string }> = [],
    context: {
      hasCorrections?: boolean;
      activeEntitiesCount?: number;
      conflictingMemoriesCount?: number;
    } = {}
  ): RiskAssessment {
    const text = userMessage.toLowerCase();
    const factors: RiskFactor[] = [];
    let score = 0;

    // 1. Explicit Correction Intent (+35)
    const isCorrection = context.hasCorrections ||
      /\b(actually|correction|nahi yaar|galat|nahi uska naam|not that|instead|wait no|correction:|wrong|incorrect|no, that is wrong|ye galat hai|aisa nahi hai|maine kab bola)\b/i.test(text);
    if (isCorrection) {
      factors.push({
        name: 'EXPLICIT_CORRECTION',
        weight: 70,
        description: 'User explicitly correcting previous assistant assumption or memory'
      });
      score += 70;
    }

    // 2. Multiple Named Persons or Kinship References (+30)
    const personMatches = userMessage.match(/\b([A-Z][a-z]+)\b/g) || [];
    const kinshipMatches = text.match(/\b(father|mother|dad|mom|papa|maa|wife|husband|biwi|patni|son|daughter|brother|sister|bhai|behen|beta|beti|friend|dost)\b/gi) || [];
    const totalEntitySignals = personMatches.length + kinshipMatches.length;

    if (totalEntitySignals >= 3 || (context.activeEntitiesCount && context.activeEntitiesCount >= 2)) {
      factors.push({
        name: 'MULTI_ENTITY_COMPLEXITY',
        weight: 30,
        description: 'Turn involves multiple people or kinship cross-references requiring strict ownership assignment'
      });
      score += 30;
    } else if (kinshipMatches.length >= 1) {
      factors.push({
        name: 'KINSHIP_REFERENCE',
        weight: 15,
        description: 'Turn contains family/kinship relations'
      });
      score += 15;
    }

    // 3. Pronoun Ambiguity / Cross-Turn Antecedents (+20)
    const hasPronouns = /\b(he|she|they|his|her|their|usne|uska|uski|unka|unki|iska|iski|woh|unhe)\b/i.test(text);
    if (hasPronouns && kinshipMatches.length > 0) {
      factors.push({
        name: 'PRONOUN_KINSHIP_COLLISION',
        weight: 20,
        description: 'Kinship term modified by third-person pronoun (e.g. his father, her brother)'
      });
      score += 20;
    }

    // 4. Temporal Transition / Lifecycle Shift (+25)
    const isTemporalTransition = /\b(used to|no longer|leaving|resigned|retired|shifting|planning to|will start|pehle|purana|chhod diya|agale mahine|next month|was|the|tha)\b/i.test(text);
    if (isTemporalTransition) {
      factors.push({
        name: 'TEMPORAL_TRANSITION',
        weight: 25,
        description: 'Fact modifies status from past to future or cancels current state'
      });
      score += 25;
    }

    // 5. Conflicting Memory Lookups (+30)
    if (context.conflictingMemoriesCount && context.conflictingMemoriesCount > 0) {
      factors.push({
        name: 'EXISTING_MEMORY_CONFLICT',
        weight: 30,
        description: 'Turn directly conflicts with an existing stored memory in the database'
      });
      score += 30;
    }

    // 6. Third-Party Entity-Scoped Fact Candidates (+25)
    const hasThirdPartyFacts = extractedFacts.some(f => f.key.startsWith('entity:'));
    if (hasThirdPartyFacts) {
      factors.push({
        name: 'THIRD_PARTY_ENTITY_MUTATION',
        weight: 25,
        description: 'Memory write targeting a third-party entity rather than the user'
      });
      score += 25;
    }

    // Cap score at 100
    score = Math.min(100, score);

    let tier: RiskTier = 'LOW';
    if (score >= 70) {
      tier = 'HIGH';
    } else if (score >= 30) {
      tier = 'MEDIUM';
    }

    return {
      score,
      tier,
      factors,
      requiresMultiModelCheck: tier === 'HIGH',
      requiresDeepReconciliation: tier === 'HIGH' || tier === 'MEDIUM'
    };
  }
}

export const adaptiveRiskScorer = AdaptiveRiskScorer.getInstance();
