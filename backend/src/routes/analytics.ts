import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { canonicalizeKey } from '../lib/memoryKeySchema';
import { SourceAuthority } from '../types/memory';
import {
  classifyDomain,
  synthesizeConnectedDots,
  clusterMemoriesIntoWardrobes,
  buildDynamicKnowledgeGraph,
  DOMAIN_TAXONOMY,
  LifeDomainKey
} from '../lib/memoryDomains';

export const analyticsRouter = Router();

// ── In-Memory High-Performance TTL Cache ──────────────────────────────────────
// Accelerates 20-second mobile polling, returning cached Brain data in <1ms.
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const analyticsCache = new Map<string, CacheEntry<any>>();

export function getCachedAnalytics<T>(key: string): T | null {
  const entry = analyticsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    analyticsCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedAnalytics<T>(key: string, data: T, ttlSeconds: number = 15): void {
  analyticsCache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

export function invalidateAnalyticsCache(userId: string): void {
  for (const key of analyticsCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      analyticsCache.delete(key);
    }
  }
}

const AUTHORITY_RANK: Record<SourceAuthority, number> = {
  subconscious_inference: 1,
  confirmed_memory:       2,
  deterministic:          3,
  explicit_user:          4,
  needs_review:           0,
};

function authorityRank(a?: string | null): number {
  return AUTHORITY_RANK[(a ?? 'subconscious_inference') as SourceAuthority] ?? 1;
}

// GET /analytics/memories — three-layer Brain view:
//   currentMemories  = canonical CURRENT, not archived/superseded
//   workingContext   = ephemeral working_memory rows still in scope (deduplicated against canonical)
//   archivedMemories = superseded/archived history (provenance display)
//   domainCompartments = Wardrobe Life Domain compartments (family, work, goals, lifestyle, identity)
//   connectedDots    = Neural Network associative links between compartments
analyticsRouter.get('/memories', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const cacheKey = `${userId}:memories`;
    const cached = getCachedAnalytics(cacheKey);
    if (cached) {
      res.status(200).json({ success: true, data: cached, fromCache: true });
      return;
    }

    const now = new Date().toISOString();

    // ── Concurrent Fetch for All 3 Layers (Parallelized) ──────────────────────
    const activeMemoriesPromise = supabaseAdmin
      .from('memories')
      .select('id, memory_type, created_at, updated_at, key, value, importance, is_archived, source_authority, lifecycle_state')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('importance', { ascending: false })
      .limit(500);

    const workingMemoryPromise = supabaseAdmin
      .from('working_memory')
      .select('id, key, value, created_at, promotion_status, expires_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    const archivedMemoriesPromise = supabaseAdmin
      .from('memories')
      .select('id, memory_type, created_at, updated_at, key, value, importance, is_archived, source_authority, lifecycle_state')
      .eq('user_id', userId)
      .or('is_archived.eq.true,lifecycle_state.in.(SUPERSEDED,INVALIDATED)')
      .order('updated_at', { ascending: false })
      .limit(50);

    const [
      { data: activeMemories, error: activeErr },
      { data: wmRows, error: wmErr },
      { data: archivedRows, error: archErr }
    ] = await Promise.all([activeMemoriesPromise, workingMemoryPromise, archivedMemoriesPromise]);

    if (activeErr) throw activeErr;
    if (wmErr) {
      logger.warn('[Analytics/memories] Working memory fetch failed — returning empty', { error: wmErr.message });
    }
    if (archErr) {
      logger.warn('[Analytics/memories] Archived memories fetch failed — returning empty', { error: archErr.message });
    }

    // ── 2. Canonicalize + deduplicate: keep highest-authority CURRENT per key ─
    const canonicalMap = new Map<string, any>();
    for (const mem of (activeMemories || [])) {
      if (mem.lifecycle_state === 'SUPERSEDED' || mem.lifecycle_state === 'INVALIDATED') continue;

      const { canonical } = canonicalizeKey(mem.key || '');
      const domainMeta = classifyDomain(canonical, mem.memory_type);
      const normalizedMem = {
        ...mem,
        key: canonical,
        domain: domainMeta.domain,
        domainMeta
      };

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

    // Sort by importance desc, then updated_at desc
    const currentMemories = Array.from(canonicalMap.values()).sort((a, b) => {
      if ((b.importance || 0) !== (a.importance || 0)) return (b.importance || 0) - (a.importance || 0);
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    });

    // ── 3. thisWeekCount — computed from the FULL canonical set ──────────────
    const oneWeekAgo = Date.now() - 7 * 86400000;
    const thisWeekCount = currentMemories.filter(m => {
      const ts = m.updated_at ?? m.created_at;
      return ts && new Date(ts).getTime() >= oneWeekAgo;
    }).length;

    // ── 4. Categories & Domains ───────────────────────────────────────────────
    const categories: Record<string, number> = {};
    for (const mem of currentMemories) {
      const type = mem.memory_type || 'uncategorized';
      categories[type] = (categories[type] || 0) + 1;
      const domain = mem.domain || 'identity';
      categories[domain] = (categories[domain] || 0) + 1;
    }

    // ── 5. Working context — ephemeral working_memory rows still in scope ─────
    const SYSTEM_WM_KEYS = new Set([
      'nova_ignored_deferred_count',
      'ignore_escalation_count',
      'followup_suppressed_until',
      'silent_visit_count',
      'last_proactive_content',
      'user_busy_until',
      'last_curiosity_topic',
    ]);

    const workingContextRaw = (wmRows || []).filter((wm: any) =>
      wm.promotion_status !== 'SUPERSEDED' &&
      wm.promotion_status !== 'INVALIDATED' &&
      (!wm.expires_at || wm.expires_at > now) &&
      !wm.key.startsWith('__sys_') &&
      !wm.key.startsWith('_') &&
      !SYSTEM_WM_KEYS.has(wm.key) &&
      !wm.key.includes('counter') &&
      !wm.key.includes('count') &&
      !wm.key.includes('suppressed') &&
      wm.key !== 'birth_date'
    );

    // ── Context Deduplication Engine ──────────────────────────────────────────
    const workingContext = workingContextRaw.filter((wm: any) => {
      const { canonical } = canonicalizeKey(wm.key || '');
      const existingCanonicalMem = canonicalMap.get(canonical);
      if (existingCanonicalMem) {
        return false;
      }
      const valLower = (wm.value || '').toLowerCase();
      const schedMem = canonicalMap.get('work_schedule');
      if (schedMem && (wm.key.includes('schedule') || wm.key.includes('office') || wm.key.includes('timing'))) {
        const schedValLower = (schedMem.value || '').toLowerCase();
        if (schedValLower.includes(valLower) || valLower.includes('11') || valLower.includes('8pm') || valLower.includes('8 pm')) {
          return false;
        }
      }
      const compMem = canonicalMap.get('company_name');
      if (compMem && (wm.key === 'current_company' || wm.key === 'company')) {
        return false;
      }
      return true;
    }).map((wm: any) => {
      const domainMeta = classifyDomain(wm.key);
      return {
        ...wm,
        domain: domainMeta.domain,
        domainMeta
      };
    });

    // ── 6. Group into Wardrobe Domain Compartments & Entity Wardrobes ─────────────
    const { wardrobes: entityWardrobes, filteredMemories } = clusterMemoriesIntoWardrobes(currentMemories, workingContext);

    const cleanCurrentMemories = filteredMemories.filter((m: any) => !m.isCompositeDuplicate);

    const domainCompartments: Record<LifeDomainKey, {
      meta: any;
      memories: any[];
      workingContext: any[];
      count: number;
    }> = {
      family: { meta: DOMAIN_TAXONOMY.family, memories: [], workingContext: [], count: 0 },
      work: { meta: DOMAIN_TAXONOMY.work, memories: [], workingContext: [], count: 0 },
      goals: { meta: DOMAIN_TAXONOMY.goals, memories: [], workingContext: [], count: 0 },
      lifestyle: { meta: DOMAIN_TAXONOMY.lifestyle, memories: [], workingContext: [], count: 0 },
      identity: { meta: DOMAIN_TAXONOMY.identity, memories: [], workingContext: [], count: 0 },
    };

    for (const mem of cleanCurrentMemories) {
      const d = (mem.domain || 'identity') as LifeDomainKey;
      if (domainCompartments[d]) {
        domainCompartments[d].memories.push(mem);
        domainCompartments[d].count++;
      }
    }

    for (const wm of workingContext) {
      const d = (wm.domain || 'identity') as LifeDomainKey;
      if (domainCompartments[d]) {
        domainCompartments[d].workingContext.push(wm);
        domainCompartments[d].count++;
      }
    }

    // ── 7. Synthesize Neural Connected Dots ────────────────────────────────────
    const connectedDots = synthesizeConnectedDots(currentMemories, workingContext);

    // ── 8. Archived/history layer ─────────────────────────────────────────────
    const archivedMemories = (archivedRows || []).map((mem: any) => {
      const { canonical } = canonicalizeKey(mem.key || '');
      return { ...mem, key: canonical };
    });

    const responsePayload = {
      entityWardrobes,
      currentMemories: cleanCurrentMemories,
      rawMemories: currentMemories,
      workingContext,
      domainCompartments,
      connectedDots,
      archivedMemories,
      totalCount: cleanCurrentMemories.length,
      rawCount: currentMemories.length,
      wardrobeCount: entityWardrobes.length,
      categories,
      thisWeekCount,
    };

    setCachedAnalytics(cacheKey, responsePayload, 15);

    res.status(200).json({
      success: true,
      data: responsePayload
    });
  } catch (err) {
    logger.error('Failed to fetch memory analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/emotions
analyticsRouter.get('/emotions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [
      { data: states, error: statesErr },
      { data: episodic }
    ] = await Promise.all([
      supabaseAdmin
        .from('emotional_states')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(100),
      supabaseAdmin
        .from('episodic_memories')
        .select('emotion, created_at')
        .eq('user_id', userId)
        .not('emotion', 'is', null)
        .order('created_at', { ascending: true })
        .limit(50)
    ]);

    if (statesErr) throw statesErr;

    const emotionCounts: Record<string, number> = {};
    let totalEmotionEntries = 0;

    for (const s of (states || [])) {
      const mood = s.current_mood || s.state || s.emotion;
      if (mood && typeof mood === 'string') {
        const cleanMood = mood.trim().toLowerCase();
        emotionCounts[cleanMood] = (emotionCounts[cleanMood] || 0) + 1;
        totalEmotionEntries++;
      }
    }

    // Fallback or augment with episodic memory emotions if state tracking is sparse
    if (totalEmotionEntries < 5 && episodic && episodic.length > 0) {
      for (const e of episodic) {
        if (e.emotion && typeof e.emotion === 'string') {
          const clean = e.emotion.trim().toLowerCase();
          emotionCounts[clean] = (emotionCounts[clean] || 0) + 1;
          totalEmotionEntries++;
        }
      }
    }

    const dominantEmotions = Object.entries(emotionCounts)
      .map(([name, count]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        count,
        percentage: totalEmotionEntries > 0 ? Math.round((count / totalEmotionEntries) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Compute recent trajectory trends
    const recentStates = (states || []).slice(-10);
    const trends = recentStates.map(s => ({
      timestamp: s.created_at,
      state: s.current_mood || s.state || 'balanced',
      valence: s.valence ?? 0.5,
      energy: s.energy ?? 0.5
    }));

    res.status(200).json({
      success: true,
      data: {
        graph: states || [],
        dominantEmotions,
        trends
      }
    });
  } catch (err) {
    logger.error('Failed to fetch emotion analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/goals — synthesizes both kg_nodes goals and canonical memories goals
analyticsRouter.get('/goals', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [
      { data: kgGoals, error: kgErr },
      { data: memGoals, error: memErr }
    ] = await Promise.all([
      supabaseAdmin
        .from('kg_nodes')
        .select('*')
        .eq('user_id', userId)
        .eq('entity_type', 'goal')
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('memories')
        .select('id, key, value, memory_type, created_at, updated_at, is_archived, source_authority')
        .eq('user_id', userId)
        .or('memory_type.eq.goals,key.eq.goals,key.ilike.goal_%,key.ilike.%target%,key.eq.passions')
        .order('created_at', { ascending: false })
    ]);

    if (kgErr && !memGoals) throw kgErr;
    if (memErr) {
      logger.warn('[Analytics/goals] Memory goals query warning', { error: memErr.message });
    }

    const activeGoals: any[] = [];
    const completedGoals: any[] = [];
    const timeline: any[] = [];
    const seenTitles = new Set<string>();

    // 1. Process kg_nodes goals
    for (const g of (kgGoals || [])) {
      const title = (g.name || g.label || g.title || '').trim();
      if (!title || seenTitles.has(title.toLowerCase())) continue;
      seenTitles.add(title.toLowerCase());

      const status = g.status || g.attributes?.status || 'in_progress';
      const isComplete = status === 'completed' || status === 'done' || status === 'achieved';

      const goalObj = {
        id: g.id,
        title,
        description: g.description || g.attributes?.description || title,
        progress: g.progress ?? (isComplete ? 100 : 35),
        status: isComplete ? 'completed' : 'active',
        category: g.category || g.department || 'Goals',
        targetDate: g.target_date || g.attributes?.target_date || null,
        createdAt: g.created_at,
        source: 'kg'
      };

      if (isComplete) {
        completedGoals.push(goalObj);
      } else {
        activeGoals.push(goalObj);
      }

      timeline.push({
        id: `timeline-kg-${g.id}`,
        title,
        date: g.created_at,
        status: goalObj.status
      });
    }

    // 2. Synthesize memories goals (e.g. key='goals', value='Scaling Conviction HR and hiring top talent')
    for (const m of (memGoals || [])) {
      const rawVal = (m.value || '').trim();
      if (!rawVal) continue;

      // Extract individual goals if comma/semicolon/bullet separated
      const goalFragments = rawVal
        .split(/(?:;|\n|•|\d+\.\s+)/)
        .map((f: string) => f.trim())
        .filter((f: string) => f.length > 5);

      const items = goalFragments.length > 0 ? goalFragments : [rawVal];

      for (const item of items) {
        const norm = item.toLowerCase();
        if (seenTitles.has(norm)) continue;
        seenTitles.add(norm);

        const isComplete = m.is_archived || /completed|done|finished|achieved/i.test(norm);
        const goalObj = {
          id: `mem-goal-${m.id}-${seenTitles.size}`,
          title: item,
          description: item,
          progress: isComplete ? 100 : 40,
          status: isComplete ? 'completed' : 'active',
          category: 'Ambition',
          targetDate: null,
          createdAt: m.created_at || m.updated_at,
          source: 'memory'
        };

        if (isComplete) {
          completedGoals.push(goalObj);
        } else {
          activeGoals.push(goalObj);
        }

        timeline.push({
          id: `timeline-mem-${m.id}`,
          title: item,
          date: m.created_at || m.updated_at,
          status: goalObj.status
        });
      }
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.status(200).json({
      success: true,
      data: {
        activeGoals,
        completedGoals,
        timeline
      }
    });
  } catch (err) {
    logger.error('Failed to fetch goal analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/timeline — combines episodic moments and key life milestones
analyticsRouter.get('/timeline', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [
      { data: episodic, error: episodicError },
      { data: moments, error: momentsError },
      { data: milestones }
    ] = await Promise.all([
      supabaseAdmin
        .from('episodic_memories')
        .select('id, summary, emotion, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(25),
      supabaseAdmin
        .from('user_moments')
        .select('id, title, body, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(25),
      supabaseAdmin
        .from('memories')
        .select('id, key, value, created_at, updated_at, importance')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .gte('importance', 7)
        .order('created_at', { ascending: false })
        .limit(20)
    ]);

    if (episodicError) throw episodicError;
    if (momentsError) throw momentsError;

    // Format milestone memories cleanly
    const milestoneItems = (milestones || []).map((m: any) => {
      const { canonical } = canonicalizeKey(m.key || '');
      const cleanTitle = canonical.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      return {
        id: `milestone-${m.id}`,
        title: cleanTitle,
        body: m.value,
        status: 'milestone',
        created_at: m.updated_at || m.created_at,
        type: 'milestone',
        importance: m.importance
      };
    });

    // Combine and sort
    const combined = [
      ...(episodic || []).map((e: any) => ({ ...e, type: 'episodic' })),
      ...(moments || []).map((m: any) => ({ ...m, type: 'moment' })),
      ...milestoneItems
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.status(200).json({
      success: true,
      data: combined
    });
  } catch (err) {
    logger.error('Failed to fetch timeline analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/kg — Dynamic Knowledge Graph reflecting memories and departments
analyticsRouter.get('/kg', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const cacheKey = `${userId}:kg`;
    const cached = getCachedAnalytics(cacheKey);
    if (cached) {
      res.status(200).json({ success: true, data: cached, fromCache: true });
      return;
    }

    const now = new Date().toISOString();

    // Parallel fetch for active memories, working memory, and profile
    const [
      { data: activeMemories, error: activeErr },
      { data: wmRows },
      { data: profile }
    ] = await Promise.all([
      supabaseAdmin
        .from('memories')
        .select('id, memory_type, created_at, updated_at, key, value, importance, is_archived, source_authority, lifecycle_state')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('importance', { ascending: false })
        .limit(500),
      supabaseAdmin
        .from('working_memory')
        .select('id, key, value, created_at, promotion_status, expires_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('profiles')
        .select('display_name, preferred_name')
        .eq('id', userId)
        .maybeSingle()
    ]);

    if (activeErr) throw activeErr;

    // 2. Canonicalize + deduplicate
    const canonicalMap = new Map<string, any>();
    for (const mem of (activeMemories || [])) {
      if (mem.lifecycle_state === 'SUPERSEDED' || mem.lifecycle_state === 'INVALIDATED') continue;
      const { canonical } = canonicalizeKey(mem.key || '');
      const domainMeta = classifyDomain(canonical, mem.memory_type);
      canonicalMap.set(canonical, { ...mem, key: canonical, domain: domainMeta.domain, domainMeta });
    }
    const currentMemories = Array.from(canonicalMap.values());

    const SYSTEM_WM_KEYS = new Set([
      'nova_ignored_deferred_count', 'ignore_escalation_count', 'followup_suppressed_until',
      'silent_visit_count', 'last_proactive_content', 'user_busy_until', 'last_curiosity_topic'
    ]);

    const workingContext = (wmRows || []).filter((wm: any) =>
      wm.promotion_status !== 'SUPERSEDED' &&
      wm.promotion_status !== 'INVALIDATED' &&
      (!wm.expires_at || wm.expires_at > now) &&
      !wm.key.startsWith('__sys_') &&
      !wm.key.startsWith('_') &&
      !SYSTEM_WM_KEYS.has(wm.key) &&
      !wm.key.includes('counter') &&
      !wm.key.includes('count') &&
      wm.key !== 'birth_date'
    ).filter((wm: any) => {
      const { canonical } = canonicalizeKey(wm.key || '');
      return !canonicalMap.has(canonical);
    });

    const preferredName = canonicalMap.get('preferred_name')?.value || profile?.preferred_name || profile?.display_name || 'You';

    // 5. Build Dynamic Knowledge Graph
    const graphData = buildDynamicKnowledgeGraph(currentMemories, workingContext, preferredName);

    setCachedAnalytics(cacheKey, graphData, 15);

    res.status(200).json({
      success: true,
      data: graphData
    });
  } catch (err) {
    logger.error('Failed to fetch kg analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/founder
analyticsRouter.get('/founder', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Total users
    const { count: usersCount } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // 2. Total memories
    const { count: memoriesCount } = await supabaseAdmin
      .from('memories')
      .select('*', { count: 'exact', head: true });

    // 3. Moments generated
    const { count: momentsCount } = await supabaseAdmin
      .from('user_moments')
      .select('*', { count: 'exact', head: true });

    // 4. Reflections
    const { count: reflectionsCount } = await supabaseAdmin
      .from('reflections')
      .select('*', { count: 'exact', head: true });

    res.status(200).json({
      success: true,
      data: {
        totalUsers: usersCount || 0,
        totalMemories: memoriesCount || 0,
        momentsGenerated: momentsCount || 0,
        reflectionsGenerated: reflectionsCount || 0,
        aiCosts: 0.0, // Placeholder
        systemHealth: 'online'
      }
    });
  } catch (err) {
    logger.error('Failed to fetch founder analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
