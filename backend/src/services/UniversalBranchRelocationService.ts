/**
 * UniversalBranchRelocationService
 *
 * Canonical reclassification coordinator for Nova memory bubbles.
 * A relocation is a subtree operation: root bubble + descendants + attached memories
 * + attached reminders move together, with mandatory confirmation and stale-state checks.
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { LifeDomainKey, DOMAIN_TAXONOMY } from '../lib/memoryDomains';
import { invalidateAnalyticsCache } from '../routes/analytics';
import { isValidEntityName } from '../lib/entitySemanticValidator';

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
  stems: Array<{ id: string; key: string; value: string; department?: string; updated_at?: string; bubble_id?: string | null }>;
  remindersCount: number;
  reminders: Array<{ id: string; text: string; due_time?: string; bubble_id?: string | null }>;
  doubtExplanation: string;
  targetKey: string;
  targetParentBubbleId?: string;
  targetParentLabel?: string;
  rawText: string;
  createdAt: string;
  expectedUpdated: Array<{ id: string; updated_at: string }>;
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

type DetectedRelocation = {
  entityName: string;
  oldDomain?: LifeDomainKey;
  oldRelation?: string;
  newDomain: LifeDomainKey;
  newRelation: string;
  targetParentLabel?: string;
  rawText: string;
  isFictionalOrCharacter?: boolean;
  isPetRevelation?: boolean;
};

const DOMAIN_ALIASES: Record<string, LifeDomainKey> = {
  family: 'family', relationship: 'family', relationships: 'family', personal: 'family', pets: 'family',
  work: 'work', career: 'work', office: 'work', project: 'work', projects: 'work', profession: 'work',
  goals: 'goals', goal: 'goals', ambition: 'goals', ambitions: 'goals',
  lifestyle: 'lifestyle', routine: 'lifestyle', hobby: 'lifestyle', habits: 'lifestyle',
  identity: 'identity', personal_identity: 'identity',
};

function normalizeSlug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function titleFor(domain: LifeDomainKey): string {
  return DOMAIN_TAXONOMY[domain]?.title || domain;
}

function inferDomain(text: string, fallback: LifeDomainKey = 'lifestyle'): LifeDomainKey {
  const lower = text.toLowerCase();
  const keys = Object.keys(DOMAIN_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (new RegExp(`\\b${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(lower)) return DOMAIN_ALIASES[key];
  }
  if (/character|short film|film project|script|project character/.test(lower)) return 'work';
  if (/pet|dog|cat|puppy|kitten|kutta|billi/.test(lower)) return 'family';
  return fallback;
}

export class UniversalBranchRelocationService {
  private static instance: UniversalBranchRelocationService;

  static getInstance(): UniversalBranchRelocationService {
    if (!this.instance) this.instance = new UniversalBranchRelocationService();
    return this.instance;
  }

  private isInvalidEntityName(name: string): boolean {
    if (!name || name.trim().length < 2) return true;
    const lower = name.trim().toLowerCase();
    if (/\b(one|guy|person|someone|somebody|who|whom|talking|speaking|mentioned)\b/i.test(lower)) return true;
    if (/^(the\s+)?(one|person|guy|friend|character|boy|girl)\s+(i|we|you)\b/i.test(lower)) return true;
    return !isValidEntityName(name).isValid;
  }

  private cleanEntity(raw: string): string {
    return (raw || '')
      .replace(/^(my|a|an|the|mera|meri|mere)\s+/i, '')
      .replace(/\s+(is|hai|are|was|tha|thi)$/i, '')
      .trim();
  }

  private capitalizeWords(raw: string): string {
    return raw.trim().split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  private extractExplicitEntity(text: string): string | null {
    const patterns = [
      /^([A-Za-z][A-Za-z0-9 _-]{1,60}?)\s+(?:is|was|isn't|wasn't|are|were)\s+(?:not|actually)\b/i,
      /\b(?:move|shift|transfer|reclassify)\s+([A-Za-z][A-Za-z0-9_-]{1,40})(?:\s+bubble)?\b/i,
      /\b(?:about|regarding|named|called|friend|colleague|father|mother|wife|pet|dog|cat)\s+([A-Z][A-Za-z0-9_-]{1,40})\b/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) {
        const c = this.cleanEntity(m[1]);
        if (c && !this.isInvalidEntityName(c)) {
          return this.capitalizeWords(c);
        }
      }
    }
    return null;
  }

  private async resolveAntecedent(userId: string, recentMessages: Array<{ role: string; content: string }>): Promise<string | null> {
    const candidates = new Set<string>();
    for (const msg of (recentMessages || []).slice(-12)) {
      const text = msg.content || '';
      for (const match of text.matchAll(/\b([A-Z][a-z]{2,30})\b/g)) {
        const candidate = this.cleanEntity(match[1]);
        if (candidate && !/^(Nova|I|You|The|This|That|Actually|Wait|Okay|Sure|Yes|No|Hindi|English|Project|Short|Film)$/i.test(candidate)) candidates.add(this.capitalizeWords(candidate));
      }
    }
    if (!candidates.size) return null;

    const { data: memories, error } = await supabaseAdmin
      .from('memories')
      .select('id,key,value,memory_type,bubble_id,updated_at')
      .eq('user_id', userId)
      .eq('is_archived', false);
    if (error) throw error;

    const grounded = [...candidates].filter(name => {
      const slug = normalizeSlug(name);
      return (memories || []).some(m => {
        const k = String(m.key || '').toLowerCase();
        const v = String(m.value || '').toLowerCase();
        return k === slug || k.includes(`_${slug}`) || k.endsWith(slug) || v.includes(name.toLowerCase());
      });
    });

    return grounded.length === 1 ? grounded[0] : null;
  }

  detectRelocationIntentSync(text: string, _recentMessages: Array<{ role: string; content: string }> = []): (DetectedRelocation & { entityName: string }) | null {
    if (!text?.trim()) return null;
    const clean = text.trim();
    const lower = clean.toLowerCase();

    const isCharacter = /(?:not\s+my\s+friend|isn't\s+my\s+friend|dost\s+nahi(?:\s+hai|\s+tha)?).*?(?:character|short\s+film|film\s+project|script|project)/i.test(lower) ||
      /(?:character|short\s+film|film\s+project|script|project\s+character).*?(?:not\s+my\s+friend|dost\s+nahi)/i.test(lower);
    if (isCharacter) {
      const explicit = this.extractExplicitEntity(clean);
      if (!explicit) return null;
      return { entityName: explicit, oldDomain: 'family', oldRelation: 'Friend', newDomain: 'work', newRelation: lower.includes('short film') ? 'Short Film Character' : 'Project Character', rawText: clean, isFictionalOrCharacter: true };
    }

    const isPet = /(?:not\s+a\s+person|human\s+nahi|insaan?\s+nahi).*?(?:pet|dog|cat|puppy|kitten|kutta|billi)/i.test(lower);
    if (isPet) {
      const explicit = this.extractExplicitEntity(clean);
      if (!explicit) return null;
      const pet = /cat|kitten|billi/.test(lower) ? 'Pet Cat' : /dog|puppy|kutta/.test(lower) ? 'Pet Dog' : 'Pet';
      return { entityName: explicit, oldDomain: 'family', oldRelation: 'Person / Friend', newDomain: 'family', newRelation: pet, rawText: clean, isPetRevelation: true };
    }

    const move = clean.match(/\b(?:move|shift|transfer|reclassify)\s+([A-Za-z][A-Za-z0-9_-]{1,40})(?:\s+bubble)?(?:\s+(?:from|se)\s+([^to\s]+?))?\s+(?:to|me|in)\s+(.+)$/i) ||
      clean.match(/^([A-Za-z][A-Za-z0-9_-]{1,40})\s+from\s+([A-Za-z0-9_ -]+?)\s+to\s+(.+)$/i) ||
      clean.match(/^([A-Za-z][A-Za-z0-9_-]{1,40})(?:\s+bubble)?\s+ko\s+([A-Za-z0-9_ -]+?)\s+se\s+([A-Za-z0-9_ -]+?)\s+me\s+(?:shift|move|transfer)\s*(?:kar\s+do|kardo)?$/i);

    if (move) {
      const entityName = this.capitalizeWords(this.cleanEntity(move[1]));
      if (!this.isInvalidEntityName(entityName)) {
        const rawOld = move[3] ? move[2] : undefined;
        const rawNew = move[3] ? move[3] : move[2];
        const oldDomain = rawOld ? inferDomain(rawOld, 'family') : undefined;
        const oldRelation = rawOld ? titleFor(oldDomain!) : undefined;
        const target = rawNew.trim().replace(/[.!?]+$/, '');
        const domain = inferDomain(target, 'lifestyle');
        return { entityName, oldDomain, oldRelation, newDomain: domain, newRelation: titleFor(domain), targetParentLabel: target, rawText: clean };
      }
    }

    const direct = clean.match(/^([A-Za-z][A-Za-z0-9 _-]{1,40})\s+(?:is|was)\s+(?:not|isn't|wasn't)\s+(?:my|a|an|the)?\s*([^,.;]+)[,;.]?\s+(?:he|she|it|they)\s+(?:is|was|are)\s+(?:my|a|an|the)?\s*([^,.;]+)$/i);
    if (direct) {
      const entityName = this.capitalizeWords(this.cleanEntity(direct[1]));
      if (!this.isInvalidEntityName(entityName)) {
        const newRelation = direct[3].trim();
        const newDomain = inferDomain(newRelation, 'lifestyle');
        return { entityName, oldDomain: inferDomain(direct[2], 'family'), oldRelation: direct[2].trim(), newDomain, newRelation, rawText: clean };
      }
    }

    return null;
  }

  async detectRelocationIntent(userId: string, text: string, recentMessages: Array<{ role: string; content: string }> = []): Promise<BranchRelocationProposal | null> {
    if (!text?.trim()) return null;
    let detected = this.detectRelocationIntentSync(text, recentMessages);
    if (!detected && /(?:the one i was talking about|jiski baat|jo baat kar raha|actually|not my friend|dost nahi|character|pet|move|shift|transfer)/i.test(text)) {
      try {
        const antecedent = await this.resolveAntecedent(userId, recentMessages);
        if (!antecedent) return null;
        const fallbackDomain = inferDomain(text, 'lifestyle');
        const isCharacter = /character|short film|script|project/i.test(text);
        const isPet = /pet|dog|cat|puppy|kitten|kutta|billi/i.test(text);
        detected = { entityName: antecedent, oldDomain: isCharacter || isPet ? 'family' : undefined, oldRelation: isCharacter ? 'Friend' : isPet ? 'Person / Friend' : undefined, newDomain: isCharacter ? 'work' : isPet ? 'family' : fallbackDomain, newRelation: isCharacter ? (/short film|shortfilm/i.test(text) ? 'Short Film Character' : 'Project Character') : isPet ? (/cat|kitten|billi/i.test(text) ? 'Pet Cat' : 'Pet Dog') : titleFor(fallbackDomain), rawText: text, isFictionalOrCharacter: isCharacter, isPetRevelation: isPet };
      } catch (err) {
        logger.warn('[UniversalBranchRelocation] antecedent resolution failed', { error: String(err) });
        return null;
      }
    }
    if (!detected) return null;
    return this.buildProposal(userId, detected);
  }

  async buildProposal(userId: string, detected: DetectedRelocation): Promise<BranchRelocationProposal | null> {
    const entityName = this.capitalizeWords(this.cleanEntity(detected.entityName));
    const slug = normalizeSlug(entityName);
    if (!slug) return null;

    const { data: memories, error: memoryError } = await supabaseAdmin.from('memories').select('id,key,value,memory_type,bubble_id,updated_at').eq('user_id', userId).eq('is_archived', false);
    if (memoryError) throw memoryError;
    const rows = memories || [];

    const explicitRoots = rows.filter(m => {
      const k = String(m.key || '').toLowerCase();
      return k === slug || new RegExp(`^(?:friend|family|colleague|pet|character|${detected.newDomain})_${slug}$`, 'i').test(k);
    });

    const bubbleCounts = new Map<string, number>();
    for (const r of rows) if (r.bubble_id && (String(r.key || '').toLowerCase().includes(slug) || String(r.value || '').toLowerCase().includes(entityName.toLowerCase()))) bubbleCounts.set(r.bubble_id, (bubbleCounts.get(r.bubble_id) || 0) + 1);
    const branchBubbleId = bubbleCounts.size ? [...bubbleCounts.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
    let branchRows = branchBubbleId ? rows.filter(r => r.bubble_id === branchBubbleId) : [];
    if (!branchRows.length) branchRows = rows.filter(r => { const k = String(r.key || '').toLowerCase(); const v = String(r.value || '').toLowerCase(); return k === slug || k.includes(`_${slug}`) || k.startsWith(`${slug}_`) || v.includes(entityName.toLowerCase()); });
    if (!branchRows.length) return null;

    const root = explicitRoots[0] || branchRows.find(r => r.key === slug || !r.key.includes('_')) || branchRows[0];
    const oldDomain = detected.oldDomain || (root.memory_type as LifeDomainKey) || 'lifestyle';
    const oldRelation = detected.oldRelation || String(root.value || titleFor(oldDomain));

    const { data: reminders, error: reminderError } = await supabaseAdmin.from('reminders').select('id,text,trigger_at,bubble_id,notes,status,updated_at').eq('user_id', userId).neq('status', 'cancelled').neq('status', 'completed');
    if (reminderError) throw reminderError;
    const matchingReminders = (reminders || []).filter(r => (branchBubbleId && r.bubble_id === branchBubbleId) || String(r.text || '').toLowerCase().includes(entityName.toLowerCase()) || String(r.notes || '').toLowerCase().includes(entityName.toLowerCase()));

    let targetParentBubbleId: string | undefined;
    const targetParentLabel = detected.targetParentLabel && !/^work$|^career$|^family$|^relationships?$|^lifestyle$|^goals?$|^identity$/i.test(detected.targetParentLabel.trim()) ? detected.targetParentLabel.trim() : undefined;
    if (targetParentLabel) {
      const { data: bubbles, error: bubbleError } = await supabaseAdmin.from('memory_bubbles').select('id,label,slug,parent_bubble_id').eq('user_id', userId).eq('is_archived', false);
      if (bubbleError) throw bubbleError;
      const wanted = normalizeSlug(targetParentLabel);
      const candidate = (bubbles || []).find(b => normalizeSlug(String(b.label || '')) === wanted || String(b.slug || '').endsWith(`:${wanted}`));
      if (candidate) targetParentBubbleId = candidate.id;
    }

    const oldTitle = titleFor(oldDomain);
    const newTitle = titleFor(detected.newDomain);
    const countDetails = branchRows.length;
    const reminderCount = matchingReminders.length;
    const doubtExplanation = detected.isFictionalOrCharacter
      ? `Wait, earlier I thought ${entityName} was under ${oldTitle} as a ${oldRelation}. Now you're saying ${entityName} is actually a fictional character for your project under ${newTitle}. Because that changes what this entire memory branch means, I want to verify before changing it. I found ${countDetails} connected memories and ${reminderCount} connected reminders. Are you sure?`
      : detected.isPetRevelation
      ? `Wait, earlier I treated ${entityName} as a person/relationship under ${oldTitle}. Now you're saying ${entityName} is actually ${detected.newRelation}. That changes the entity type, so I want to verify before changing the branch. I found ${countDetails} connected memories and ${reminderCount} connected reminders. Are you sure?`
      : `Wait, earlier I had ${entityName} under ${oldTitle} (${oldRelation}). You are asking me to place it under ${newTitle} (${detected.newRelation}). I found ${countDetails} connected memories and ${reminderCount} connected reminders. Are you sure?`;

    const expectedUpdated = branchRows.map(r => ({ id: r.id, updated_at: r.updated_at })).filter(x => x.updated_at);
    return {
      entityName, entitySlug: slug, oldDomain, oldRelation, newDomain: detected.newDomain, newRelation: detected.newRelation,
      rootMemoryId: root.id, rootMemoryKey: root.key, stemsCount: Math.max(0, branchRows.length - 1),
      stems: branchRows.filter(r => r.id !== root.id).map(r => ({ id: r.id, key: r.key, value: r.value, department: r.memory_type, updated_at: r.updated_at, bubble_id: r.bubble_id })),
      remindersCount: matchingReminders.length, reminders: matchingReminders.map(r => ({ id: r.id, text: r.text, due_time: r.trigger_at, bubble_id: r.bubble_id })),
      doubtExplanation, targetKey: `entity_${slug}`, targetParentBubbleId, targetParentLabel, rawText: detected.rawText,
      createdAt: new Date().toISOString(), expectedUpdated, isFictionalOrCharacter: detected.isFictionalOrCharacter, isPetRevelation: detected.isPetRevelation
    };
  }

  async stagePendingRelocation(userId: string, proposal: BranchRelocationProposal): Promise<void> {
    const key = `__pending_branch_relocation:${userId}`;
    const { error: deleteError } = await supabaseAdmin.from('working_memory').delete().eq('user_id', userId).eq('key', key);
    if (deleteError) throw deleteError;
    const { error } = await supabaseAdmin.from('working_memory').insert({ user_id: userId, key, value: JSON.stringify(proposal), promotion_status: 'PENDING', created_at: new Date().toISOString() });
    if (error) throw error;
  }

  async getPendingRelocation(userId: string): Promise<BranchRelocationProposal | null> {
    const key = `__pending_branch_relocation:${userId}`;
    const { data, error } = await supabaseAdmin.from('working_memory').select('value,created_at').eq('user_id', userId).eq('key', key).maybeSingle();
    if (error) throw error;
    if (!data?.value) return null;
    if (Date.now() - new Date(data.created_at).getTime() > 30 * 60 * 1000) { await this.clearPendingRelocation(userId); return null; }
    try { return JSON.parse(data.value) as BranchRelocationProposal; } catch { await this.clearPendingRelocation(userId); return null; }
  }

  async clearPendingRelocation(userId: string): Promise<void> {
    const { error } = await supabaseAdmin.from('working_memory').delete().eq('user_id', userId).eq('key', `__pending_branch_relocation:${userId}`);
    if (error) throw error;
  }

  isAffirmativeResponse(text: string): boolean {
    const t = String(text || '').trim().toLowerCase().replace(/[.!?]+$/g, '');
    if (!t || /\b(no|nahi|nai|na|mat|don't|dont|rehne do|cancel)\b/i.test(t)) return false;
    return /^(yes|haan|haa|ha|haanji|sure|definitely|pakka|confirm|confirmed|proceed|bilkul|theek hai|thik hai|sahi hai|sahi|yup|yeah|ok|okay|kardo|kar do|shift kar do|move kar do)(?:\s+(please|kardo|kar do|it|this|that|move|shift|confirm))?$/i.test(t) ||
      /\b(yup|sahi hai|shift kar do|move kar do|confirm kar do)\b/i.test(t);
  }

  isNegativeResponse(text: string): boolean {
    const t = String(text || '').trim().toLowerCase().replace(/[.!?]+$/g, '');
    return /^(no|nahi|nai|na|mat karo|rehne do|cancel|stop|don't|dont|galat hai|aisa mat karo|rehne de)$/i.test(t);
  }

  async executeBranchRelocation(userId: string, proposal: BranchRelocationProposal): Promise<RelocationExecutionResult> {
    const memoryIds = Array.from(new Set([proposal.rootMemoryId, ...proposal.stems.map(s => s.id)].filter(Boolean))) as string[];
    const reminderIds = Array.from(new Set(proposal.reminders.map(r => r.id).filter(Boolean)));
    const fingerprint = createHash('sha256').update(JSON.stringify({ entity: proposal.entityName, memoryIds, reminderIds, target: proposal.newDomain, relation: proposal.newRelation, raw: proposal.rawText })).digest('hex');

    const { data, error } = await supabaseAdmin.rpc('move_memory_branch_atomic_v3', {
      p_user_id: userId, p_memory_ids: memoryIds, p_reminder_ids: reminderIds, p_entity_name: proposal.entityName,
      p_source_domain: proposal.oldDomain, p_target_domain: proposal.newDomain, p_old_relation: proposal.oldRelation,
      p_new_relation: proposal.newRelation, p_target_parent_bubble_id: proposal.targetParentBubbleId || null,
      p_target_parent_label: proposal.targetParentLabel || null, p_confirmation_fingerprint: fingerprint,
      p_expected_updated: proposal.expectedUpdated || [],
    });
    if (error) {
      logger.error('[UniversalBranchRelocation] atomic move failed', { userId, entityName: proposal.entityName, error: error.message });
      return { success: false, message: error.message, entityName: proposal.entityName, oldDomain: proposal.oldDomain, newDomain: proposal.newDomain, movedStemsCount: 0, movedRemindersCount: 0, eradicatedPhantomsCount: 0 };
    }
    await this.clearPendingRelocation(userId);
    invalidateAnalyticsCache(userId);
    const movedMemories = Number(data?.moved_memory_count || memoryIds.length);
    const movedReminders = Number(data?.moved_reminder_count || reminderIds.length);
    return { success: true, message: `Successfully moved ${proposal.entityName} and its complete memory branch to ${titleFor(proposal.newDomain)} (${proposal.newRelation}).`, entityName: proposal.entityName, oldDomain: proposal.oldDomain, newDomain: proposal.newDomain, movedStemsCount: Math.max(0, movedMemories - 1), movedRemindersCount: movedReminders, eradicatedPhantomsCount: 0 };
  }

  async eradicatePhantomEntity(userId: string, entityName: string, phantomRole: string, realRole: string): Promise<{ eradicated: boolean; count: number }> {
    const slug = normalizeSlug(entityName);
    const phantomSlug = normalizeSlug(phantomRole);
    const { data, error } = await supabaseAdmin.from('memories').select('id,key,value').eq('user_id', userId).eq('is_archived', false);
    if (error) throw error;
    const ids = (data || []).filter(m => { const k = String(m.key || '').toLowerCase(); const v = String(m.value || '').toLowerCase(); return (k.includes(slug) && k.includes(phantomSlug)) || (v.includes(entityName.toLowerCase()) && v.includes(phantomRole.toLowerCase())); }).map(m => m.id);
    if (!ids.length) return { eradicated: false, count: 0 };
    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin.from('memories').update({ is_archived: true, lifecycle_state: 'SUPERSEDED', supersession_reason: `[Phantom Eradication] User clarified: ${entityName} is ${realRole}, not ${phantomRole}.`, updated_at: now }).eq('user_id', userId).in('id', ids);
    if (updateError) throw updateError;
    invalidateAnalyticsCache(userId);
    return { eradicated: true, count: ids.length };
  }
}

export const universalBranchRelocationService = UniversalBranchRelocationService.getInstance();
