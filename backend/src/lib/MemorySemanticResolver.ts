import { canonicalizeKey, isKnownCanonicalKey } from './memoryKeySchema';

export type ResolutionAction = 'PERSIST' | 'QUARANTINE' | 'NO_OP';

export interface SemanticResolutionResult {
  action: ResolutionAction;
  canonicalKey?: string;
  reason?: string;
}

const MALFORMED_COMMAND_PREFIXES = [
  /^remember_this_my_/i,
  /^remember_this_/i,
  /^remember_my_/i,
  /^remember_/i,
  /^dont_forget_my_/i,
  /^dont_forget_/i,
  /^do_not_forget_my_/i,
  /^do_not_forget_/i,
  /^yaad_rakhna_mera_/i,
  /^yaad_rakhna_meri_/i,
  /^yaad_rakhna_/i,
  /^yaad_rakh_/i,
  /^keep_in_mind_my_/i,
  /^keep_in_mind_/i,
  /^ek_correction_hai_mera_/i,
  /^ek_correction_hai_meri_/i,
  /^ek_correction_hai_my_/i,
  /^ek_correction_hai_/i,
  /^actually_my_/i,
  /^actually_mera_/i,
  /^actually_meri_/i,
  /^actually_/i,
];

export class MemorySemanticResolver {
  /**
   * Evaluates an LLM-proposed key, strips command language, applies canonical mapping,
   * and strictly rejects malformed commands that cannot be resolved safely.
   */
  public static resolveProposedKey(proposedKey: string): SemanticResolutionResult {
    const trimmed = proposedKey.trim().toLowerCase();
    
    // 1. Strip imperative prefixes (e.g., "remember_this_my_favourite_beverage" -> "favourite_beverage")
    let semanticCore = trimmed;
    let hadCommandPrefix = false;

    for (const prefix of MALFORMED_COMMAND_PREFIXES) {
      if (prefix.test(semanticCore)) {
        semanticCore = semanticCore.replace(prefix, '');
        hadCommandPrefix = true;
        break; // Only strip the first matching prefix
      }
    }

    // 2. Pass the core through canonical mapping
    const { canonical } = canonicalizeKey(semanticCore);

    // 3. Strict Command-Key Defense
    // If the original string had a command prefix AND the resulting core is NOT a known canonical concept,
    // we QUARANTINE it. We do NOT allow "remember_my_obscure_concept" to become a new durable concept.
    if (hadCommandPrefix && !isKnownCanonicalKey(canonical)) {
      return {
        action: 'QUARANTINE',
        reason: `Malformed command-derived key rejected: ${trimmed}`
      };
    }

    return {
      action: 'PERSIST',
      canonicalKey: canonical
    };
  }
}
