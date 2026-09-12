/**
 * EntityRelationshipCorrectionService.ts
 *
 * Dedicated Autonomous Entity Relationship Correction & Branch Severing Engine.
 *
 * ARCHITECTURAL ROLE:
 * Handles user corrections when an entity's relationship or domain compartment is corrected.
 * Example: "Ijaz is not my family member is is my office frind"
 *
 * Actions:
 * 1. Accurately detects entity relationship corrections and domain shifts.
 * 2. Surgically severs the entity's previous branch (e.g. from family / FAMILY_MEMBER).
 * 3. Reassigns the entity to the correct branch (e.g. work / office_friend / colleague).
 * 4. Updates memories (supersedes old relation rows, creates authoritative new relation row).
 * 5. Updates working_memory, kg_nodes, and kg_edges in Supabase.
 * 6. Records the audit trail in nova_correction_ledger.
 * 7. Invalidates the analytics and graph cache so mobile UI updates immediately.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { LifeDomainKey, DOMAIN_TAXONOMY } from '../lib/memoryDomains';
import { invalidateAnalyticsCache } from '../routes/analytics';

export interface EntityCorrection {
  entityName: string;
  oldRelation?: string;
  oldDomain: LifeDomainKey;
  newRelation: string;
  newDomain: LifeDomainKey;
  rawText: string;
}

export class EntityRelationshipCorrectionService {
  private static instance: EntityRelationshipCorrectionService;

  static getInstance(): EntityRelationshipCorrectionService {
    if (!EntityRelationshipCorrectionService.instance) {
      EntityRelationshipCorrectionService.instance = new EntityRelationshipCorrectionService();
    }
    return EntityRelationshipCorrectionService.instance;
  }

  /**
   * Detects if the user's turn expresses an entity relationship reclassification.
   * Handles natural typing typos (e.g., "is is my office frind", "collegue", "cowoker").
   */
  detectEntityCorrection(text: string): EntityCorrection | null {
    if (!text || typeof text !== 'string') return null;

    let clean = text.trim();
    if (!clean) return null;

    // Normalize out common user typos and speech artifacts
    clean = clean
      .replace(/\bregarding\s+memory:\s*\[[^\]]+\]:\s*["'][^"']*["']\s*-\s*/i, '') // strip modal quote prefix
      .replace(/\bregarding\s+memory:\s*\[[^\]]+\]:\s*/i, '')
      .replace(/\bregarding\s+([a-zA-Z]+):\s*/i, '$1 ')
      .replace(/\bfrind\b/gi, 'friend')
      .replace(/\bcollegue\b/gi, 'colleague')
      .replace(/\bcowoker\b/gi, 'coworker')
      .replace(/\bis\s+is\b/gi, 'is')
      .replace(/\bhes\b/gi, "he's")
      .replace(/\bshes\b/gi, "she's");

    const lower = clean.toLowerCase();

    // ── Pattern 1: Direct Negation + Reclassification ─────────────────────────
    // e.g. "Ijaz is not my family member, he is my office friend"
    // e.g. "Ijaz is not my brother, is my colleague"
    // e.g. "Ijaz family member nahi hai, office friend hai"
    // e.g. "Ijaz mera bhai nahi hai, office ka dost hai"
    const pattern1 = /\b([a-zA-Z]+)\s+(?:is\s+not|isn't|is\s+no\s+longer|are\s+not|family\s+member\s+nahi\s+hai|nahi\s+hai|mera\s+bhai\s+nahi\s+hai)\s*(?:my|a|an|mera|meri)?\s*(family\s+member|family|brother|sister|relative|bhai|behen|father|mother|son|daughter|dost|friend)?\s*[,;.-]?\s*(?:he\s+is|she\s+is|they\s+are|he's|she's|is|woh|wo|actually|to|mera|meri)?\s*(?:my|a|an|mera|meri)?\s*(office\s+friend|work\s+friend|office\s+colleague|work\s+colleague|colleague|coworker|friend|dost|office\s+ka\s+dost|office\s+dost)\b/i;

    const m1 = lower.match(pattern1);
    if (m1) {
      const entityName = this.capitalize(m1[1]);
      if (this.isValidEntityName(entityName)) {
        const oldRelRaw = m1[2] ? m1[2].trim() : 'family member';
        const newRelRaw = m1[3] ? m1[3].trim() : 'office friend';
        return this.buildCorrection(entityName, oldRelRaw, newRelRaw, clean);
      }
    }

    // ── Pattern 2: Reversed Assertion ("Ijaz is my office friend, not a family member")
    const pattern2 = /\b([a-zA-Z]+)\s+(?:is|hai)\s+(?:my|mera|meri|a|an)?\s*(office\s+friend|work\s+friend|colleague|coworker|friend|dost)\s*[,;.-]?\s*(?:not|nahi\s+hai)\s+(?:my|mera|meri|a|an)?\s*(family\s+member|family|brother|sister|relative|bhai|behen)\b/i;
    const m2 = lower.match(pattern2);
    if (m2) {
      const entityName = this.capitalize(m2[1]);
      if (this.isValidEntityName(entityName)) {
        const newRelRaw = m2[2].trim();
        const oldRelRaw = m2[3].trim();
        return this.buildCorrection(entityName, oldRelRaw, newRelRaw, clean);
      }
    }

    // ── Pattern 3: Move/Reassign Command ──────────────────────────────────────
    // e.g. "Move Ijaz from family to friends / office friends branch"
    const pattern3 = /\b(?:move|shift|transfer|put)\s+([a-zA-Z]+)\s+(?:from\s+family\s+to|se\s+hata\s+kar\s+to|to)?\s*(office\s+friends?|colleagues?|friends?|work)\s*(?:branch)?\b/i;
    const m3 = lower.match(pattern3);
    if (m3) {
      const entityName = this.capitalize(m3[1]);
      if (this.isValidEntityName(entityName)) {
        const newRelRaw = m3[2].trim();
        return this.buildCorrection(entityName, 'family member', newRelRaw, clean);
      }
    }

    return null;
  }

  private isValidEntityName(name: string): boolean {
    if (!name || name.length < 2) return false;
    const stopWords = new Set([
      'he', 'she', 'it', 'they', 'this', 'that', 'there', 'who', 'what', 'why', 'when',
      'my', 'mine', 'your', 'his', 'her', 'our', 'their', 'mera', 'meri', 'mere', 'mai'
    ]);
    return !stopWords.has(name.toLowerCase());
  }

  private capitalize(s: string): string {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  private buildCorrection(entityName: string, oldRelRaw: string, newRelRaw: string, rawText: string): EntityCorrection {
    const normNew = newRelRaw.toLowerCase();
    const isOffice = normNew.includes('office') || normNew.includes('colleague') || normNew.includes('coworker') || normNew.includes('work');

    const newRelation = isOffice
      ? (normNew.includes('colleague') ? 'Colleague' : 'Office Friend')
      : 'Friend';

    const newDomain: LifeDomainKey = isOffice ? 'work' : 'family';
    const oldDomain: LifeDomainKey = 'family';

    return {
      entityName,
      oldRelation: oldRelRaw || 'family member',
      oldDomain,
      newRelation,
      newDomain,
      rawText
    };
  }

  /**
   * Executes the branch severing, memory supersession, KG update, and cache invalidation.
   */
  async severAndReclassifyEntity(userId: string, correction: EntityCorrection): Promise<{ success: boolean; message: string }> {
    if (!userId || !correction) {
      return { success: false, message: 'Invalid arguments' };
    }

    const now = new Date().toISOString();
    const { entityName, newRelation, newDomain, rawText } = correction;
    const cleanEntitySlug = entityName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const newMemoryKey = newDomain === 'work' ? `colleague_${cleanEntitySlug}` : `friend_${cleanEntitySlug}`;
    const newMemoryValue = `${entityName} is an ${newRelation}`;

    logger.info('[EntityRelationshipCorrection] Severing old branch and reclassifying entity', {
      userId,
      entityName,
      newRelation,
      newDomain,
      newMemoryKey
    });

    try {
      // 1. Supersede any existing family memories relating to this entity
      const { data: existingMems } = await supabaseAdmin
        .from('memories')
        .select('id, key, value, memory_type')
        .eq('user_id', userId)
        .eq('is_archived', false);

      const memsToSupersede: string[] = [];

      for (const m of (existingMems || [])) {
        const k = (m.key || '').toLowerCase();
        const v = (m.value || '').toLowerCase();

        const touchesEntity = k.includes(cleanEntitySlug) || v.includes(entityName.toLowerCase());
        const isFamilyRelated = m.memory_type === 'family' || k.includes('family') || k.includes('brother') || k.includes('sister') || k.includes('relative') || k.startsWith('friend_');

        if (touchesEntity && (isFamilyRelated || k === 'brother_name')) {
          memsToSupersede.push(m.id);
        }
      }

      if (memsToSupersede.length > 0) {
        await supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'SUPERSEDED',
            supersession_reason: `[Entity Reclassification] User explicitly corrected: ${entityName} is not a ${correction.oldRelation || 'family member'}, but an ${newRelation}. (${rawText})`,
            updated_at: now
          })
          .eq('user_id', userId)
          .in('id', memsToSupersede);

        logger.info('[EntityRelationshipCorrection] Superseded old family relation rows', {
          userId,
          count: memsToSupersede.length,
          ids: memsToSupersede
        });
      }

      // 2. Persist new authoritative memory under the new domain
      const { data: existingTarget } = await supabaseAdmin
        .from('memories')
        .select('id')
        .eq('user_id', userId)
        .eq('key', newMemoryKey)
        .maybeSingle();

      if (existingTarget) {
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
          .eq('id', existingTarget.id);
      } else {
        await supabaseAdmin
          .from('memories')
          .insert({
            user_id: userId,
            key: newMemoryKey,
            value: newMemoryValue,
            memory_type: newDomain,
            importance: 85,
            confidence: 1.0,
            is_archived: false,
            lifecycle_state: 'CURRENT',
            source_authority: 'explicit_user',
            created_at: now,
            updated_at: now
          });
      }

      // 3. Clear/update working_memory
      await supabaseAdmin
        .from('working_memory')
        .delete()
        .eq('user_id', userId)
        .or(`key.eq.brother_name,key.eq.family_${cleanEntitySlug},key.eq.friend_${cleanEntitySlug}`);

      await supabaseAdmin
        .from('working_memory')
        .insert({
          user_id: userId,
          key: newMemoryKey,
          value: newMemoryValue,
          promotion_status: 'PROMOTED',
          created_at: now
        });

      // 4. Update Knowledge Graph nodes & edges (if present in kg_nodes)
      const { data: matchedKgNodes } = await supabaseAdmin
        .from('kg_nodes')
        .select('id, name, department')
        .eq('user_id', userId)
        .or(`name.ilike.%${entityName}%,raw_key.ilike.%${cleanEntitySlug}%`);

      for (const kn of (matchedKgNodes || [])) {
        // Sever old edge to dept-family
        await supabaseAdmin
          .from('kg_edges')
          .delete()
          .eq('user_id', userId)
          .or(`target_node_id.eq.${kn.id},source_node_id.eq.${kn.id}`);

        // Update node department
        await supabaseAdmin
          .from('kg_nodes')
          .update({
            department: newDomain,
            name: `${entityName} (${newRelation})`,
            entity_type: newDomain === 'work' ? 'office_friend' : 'friend',
            color: DOMAIN_TAXONOMY[newDomain].color,
            updated_at: now
          })
          .eq('id', kn.id);

        // Add new edge to dept-work (or dept-family if personal friend)
        const parentDeptId = `dept-${newDomain}`;
        await supabaseAdmin
          .from('kg_edges')
          .insert({
            user_id: userId,
            source_node_id: parentDeptId,
            target_node_id: kn.id,
            relation_type: newDomain === 'work' ? 'OFFICE_FRIEND_BRANCH' : 'FRIEND_BRANCH',
            weight: 2,
            created_at: now
          });
      }

      // 5. Record in nova_correction_ledger
      try {
        await supabaseAdmin.from('nova_correction_ledger').insert({
          user_id: userId,
          correction_source: 'user_chat_entity_reclassification',
          field_name: `${cleanEntitySlug}_relationship`,
          previous_value: correction.oldRelation || 'Family Member',
          corrected_value: newRelation,
          reason: rawText,
          created_at: now
        });
      } catch (ledgerErr) {
        logger.warn('[EntityRelationshipCorrection] Non-fatal ledger insert warning', { error: String(ledgerErr) });
      }

      // 6. Invalidate analytics and wardrobe caches immediately
      invalidateAnalyticsCache(userId);

      const confirmMsg = `Severed ${entityName} from family branch and moved to ${newRelation} under ${DOMAIN_TAXONOMY[newDomain].title}.`;
      logger.info('[EntityRelationshipCorrection] Reclassification complete', { userId, confirmMsg });

      return { success: true, message: confirmMsg };
    } catch (err: any) {
      logger.error('[EntityRelationshipCorrection] Reclassification failed', {
        userId,
        error: err?.message || String(err)
      });
      return { success: false, message: err?.message || 'Reclassification failed' };
    }
  }

  /**
   * Generates a warm, authentic, best-friend acknowledgment reply for Nova.
   */
  generateNovaReply(correction: EntityCorrection): string {
    const { entityName, newDomain } = correction;
    if (newDomain === 'work') {
      return `Got it, Saa! Maine ${entityName} ko family se hata kar tumhare office friends / work branch me shift kar diya hai. 😊`;
    }
    return `Got it, Saa! Maine ${entityName} ko family member branch se hata kar friends branch me move kar diya hai. 😊`;
  }
}

export const entityRelationshipCorrectionService = EntityRelationshipCorrectionService.getInstance();
