import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { memoryRepository } from '../services/memoryRepository';
import { logger } from '../lib/logger';
import { canonicalizeKey } from '../lib/memoryKeySchema';

export const memoryManagementRouter = Router();

// ── Human-readable label map for canonical keys ─────────────────────────────────
const KEY_LABELS: Record<string, string> = {
  mother_name: "Mother's name",
  mother_nickname: "Mother's nickname",
  father_name: "Father's name",
  father_nickname: "Father's nickname",
  wife_name: "Wife's name",
  wife_nickname: "Wife's nickname",
  husband_name: "Husband's name",
  husband_nickname: "Husband's nickname",
  son_name: "Son's name",
  son_nickname: "Son's nickname",
  daughter_name: "Daughter's name",
  daughter_nickname: "Daughter's nickname",
  sister_name: "Sister's name",
  sister_nickname: "Sister's nickname",
  brother_name: "Brother's name",
  brother_nickname: "Brother's nickname",
  company_name: "Company",
  birth_date: "Birth date",
  marriage_date: "Marriage date",
  preferred_name: "Preferred name",
  preferred_work_hours: "Preferred work hours",
  favourite_color: "Favourite color",
  favourite_beverage: "Favourite beverage",
  favourite_street_food: "Favourite street food",
};

// Category grouping for the Memory Browser
const KEY_CATEGORIES: Record<string, 'Personal' | 'Family' | 'Work' | 'Preferences'> = {
  mother_name: 'Family',
  mother_nickname: 'Family',
  father_name: 'Family',
  father_nickname: 'Family',
  wife_name: 'Family',
  wife_nickname: 'Family',
  husband_name: 'Family',
  husband_nickname: 'Family',
  son_name: 'Family',
  son_nickname: 'Family',
  daughter_name: 'Family',
  daughter_nickname: 'Family',
  sister_name: 'Family',
  sister_nickname: 'Family',
  brother_name: 'Family',
  brother_nickname: 'Family',
  company_name: 'Work',
  birth_date: 'Personal',
  marriage_date: 'Personal',
  preferred_name: 'Personal',
  preferred_work_hours: 'Work',
  favourite_color: 'Preferences',
  favourite_beverage: 'Preferences',
  favourite_street_food: 'Preferences',
};

function getLabel(canonicalKey: string): string {
  return KEY_LABELS[canonicalKey] || canonicalKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getCategory(canonicalKey: string): 'Personal' | 'Family' | 'Work' | 'Preferences' {
  return KEY_CATEGORIES[canonicalKey] || 'Personal';
}

// GET /memories — list user's memories with search + filter (canonicalized for trust layer)
memoryManagementRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { search, type, archived, limit = '50', offset = '0' } = req.query;

    // Fetch all active memories (or archived if requested) to canonicalize in-memory
    // We fetch a larger set to allow proper canonical deduplication, then paginate
    const fetchLimit = 500;
    let query = supabaseAdmin
      .from('memories')
      .select('id, key, value, memory_type, importance, confidence, frequency, is_archived, created_at, updated_at, source_authority, lifecycle_state')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .limit(fetchLimit);

    if (archived === 'true') {
      query = query.eq('is_archived', true);
    } else {
      query = query.eq('is_archived', false);
    }

    if (type) {
      query = query.eq('memory_type', type as string);
    }

    const { data: allMemories, error } = await query;
    if (error) throw error;

    // Canonicalize and deduplicate: keep highest-authority CURRENT per canonical key
    const canonicalMap = new Map<string, any>();
    for (const mem of (allMemories || [])) {
      const { canonical } = canonicalizeKey(mem.key || '');
      const normalizedMem = { ...mem, key: canonical };

      if (!canonicalMap.has(canonical)) {
        canonicalMap.set(canonical, normalizedMem);
      } else {
        const existing = canonicalMap.get(canonical)!;
        const existingRank = authorityRank(existing.source_authority);
        const currentRank = authorityRank(mem.source_authority);
        if (currentRank > existingRank) {
          canonicalMap.set(canonical, normalizedMem);
        } else if (currentRank === existingRank) {
          const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
          const currentTime = new Date(mem.updated_at || mem.created_at).getTime();
          if (currentTime > existingTime) {
            canonicalMap.set(canonical, normalizedMem);
          }
        }
      }
    }

    let uniqueMemories = Array.from(canonicalMap.values());

    // Filter by search on canonical key or value
    if (search) {
      const q = (search as string).toLowerCase();
      uniqueMemories = uniqueMemories.filter(m =>
        m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)
      );
    }

    // Sort by importance desc, then updated_at desc for deterministic ordering
    uniqueMemories.sort((a, b) => {
      if ((b.importance || 0) !== (a.importance || 0)) return (b.importance || 0) - (a.importance || 0);
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    });

    // Paginate
    const start = Number(offset);
    const end = start + Number(limit);
    const paginated = uniqueMemories.slice(start, end);

    // Transform to safe display format
    const displayMemories = paginated.map(m => ({
      id: m.id,
      canonicalKey: m.key,
      label: getLabel(m.key),
      category: getCategory(m.key),
      value: m.value,
      memoryType: m.memory_type,
      importance: m.importance,
      confidence: m.confidence,
      isArchived: m.is_archived,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }));

    res.status(200).json({
      success: true,
      data: displayMemories,
      total: uniqueMemories.length,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (err) {
    logger.error('Failed to list memories', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// Authority rank helper (mirrors analytics.ts)
const AUTHORITY_RANK: Record<string, number> = {
  subconscious_inference: 1,
  confirmed_memory: 2,
  deterministic: 3,
  explicit_user: 4,
  needs_review: 0,
};

function authorityRank(a?: string | null): number {
  return AUTHORITY_RANK[(a ?? 'subconscious_inference')] ?? 1;
}

// GET /memories/browser — categorized, user-friendly view for Memory Browser
memoryManagementRouter.get('/browser', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { archived = 'false' } = req.query;

    // Fetch all non-archived memories for canonicalization
    const { data: allMemories, error } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, memory_type, importance, confidence, frequency, is_archived, created_at, updated_at, source_authority, lifecycle_state')
      .eq('user_id', userId)
      .eq('is_archived', archived === 'true')
      .order('importance', { ascending: false })
      .limit(500);

    if (error) throw error;

    // Canonicalize and deduplicate
    const canonicalMap = new Map<string, any>();
    for (const mem of (allMemories || [])) {
      const { canonical } = canonicalizeKey(mem.key || '');
      const normalizedMem = { ...mem, key: canonical };

      if (!canonicalMap.has(canonical)) {
        canonicalMap.set(canonical, normalizedMem);
      } else {
        const existing = canonicalMap.get(canonical)!;
        const existingRank = authorityRank(existing.source_authority);
        const currentRank = authorityRank(mem.source_authority);
        if (currentRank > existingRank) {
          canonicalMap.set(canonical, normalizedMem);
        } else if (currentRank === existingRank) {
          const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
          const currentTime = new Date(mem.updated_at || mem.created_at).getTime();
          if (currentTime > existingTime) {
            canonicalMap.set(canonical, normalizedMem);
          }
        }
      }
    }

    const uniqueMemories = Array.from(canonicalMap.values());

    // Group by category
    const categories: Record<string, any[]> = {
      Personal: [],
      Family: [],
      Work: [],
      Preferences: [],
    };

    for (const mem of uniqueMemories) {
      const category = getCategory(mem.key);
      categories[category].push({
        id: mem.id,
        canonicalKey: mem.key,
        label: getLabel(mem.key),
        category,
        value: mem.value,
        memoryType: mem.memory_type,
        importance: mem.importance,
        confidence: mem.confidence,
        isArchived: mem.is_archived,
        createdAt: mem.created_at,
        updatedAt: mem.updated_at,
      });
    }

    // Sort within each category by importance desc, then updated_at desc
    for (const cat of Object.keys(categories)) {
      categories[cat].sort((a, b) => {
        if (b.importance !== a.importance) return b.importance - a.importance;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    res.status(200).json({ success: true, data: categories });
  } catch (err) {
    logger.error('Failed to fetch memory browser data', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// DELETE /memories/:id — forget a memory (archive, not hard delete)
memoryManagementRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { id } = req.params;

    // Use repository forgetMemory which archives (preserves history per lifecycle policy)
    const forgotten = await memoryRepository.forgetMemory(userId, id);
    if (!forgotten) {
      res.status(404).json({ error: 'Memory not found or already forgotten' });
      return;
    }

    // Log without exposing raw memory value
    logger.info('User forgot memory', { memoryId: id, userId, action: 'forget' });

    res.status(200).json({ success: true, message: 'Nova no longer uses this memory' });
  } catch (err) {
    logger.error('Failed to forget memory', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// PATCH /memories/:id/archive — archive a memory
memoryManagementRouter.patch('/:id/archive', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { id } = req.params;
    const { archived = true } = req.body;

    const { data, error } = await supabaseAdmin
      .from('memories')
      .update({ is_archived: archived, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, is_archived')
      .maybeSingle();

    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Memory not found' }); return; }

    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Failed to archive memory', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// PATCH /memories/:id — edit a memory's value
memoryManagementRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { id } = req.params;
    const { value, key } = req.body;

    if (!value && !key) {
      res.status(400).json({ error: 'Provide at least one of: value, key' });
      return;
    }

    // Fetch the full current row so the edit can be routed through the
    // authoritative state-transition mechanism (MemoryRepository) instead of a
    // raw in-place mutation that would bypass lifecycle/provenance handling.
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('memories')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) { res.status(404).json({ error: 'Memory not found' }); return; }

    // Authoritative transition: archive the existing row (preserve history,
    // never physically delete) and commit the edited value as a fresh CURRENT
    // row through the repository. This never creates two CURRENT rows for a key.
    // CRITICAL: Always derive canonical key from stored record — NEVER trust client-supplied key
    const canonicalKey = existing.key;
    const newValue = value ?? existing.value;

    const archived = await memoryRepository.archiveMemory(userId, id, 'User edit via memory management');
    if (!archived) { res.status(500).json({ error: 'Failed to archive original memory during edit' }); return; }

    await memoryRepository.upsertMemory(userId, {
      type: existing.memory_type || 'semantic',
      key: canonicalKey,
      value: newValue,
      importance: existing.importance,
      confidence: existing.confidence,
      emotional_weight: existing.emotional_weight || 0,
      source_authority: 'explicit_user',
      shouldPersist: true
    } as any, 'User edit via memory management');

    res.status(200).json({
      success: true,
      data: { id: undefined, key: canonicalKey, value: newValue }
    });
  } catch (err) {
    logger.error('Failed to edit memory', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
