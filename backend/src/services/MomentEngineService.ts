import { supabaseAdmin } from '../lib/supabase';
import { novaBrain } from './NovaBrainService';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { sendMomentNotification } from '../lib/pushNotifications';

export enum MomentType {
  GOAL_FOLLOW_UP = 'GOAL_FOLLOW_UP',
  CHILD_MILESTONE = 'CHILD_MILESTONE'
}

export interface MomentPayload {
  user_id: string;
  moment_type: MomentType;
  title: string;
  body: string;
  source_memory_id?: string | null;
}

export class MomentEngineService {
  /**
   * Checks if user has active goals and evaluates if a follow-up should be generated.
   */
  async checkGoalFollowups(userId: string): Promise<MomentPayload | null> {
    try {
      // 1. Check preferences first
      const prefs = await this.getPreferences(userId);
      if (!prefs.goal_followups_enabled) {
        logger.debug(`Goal follow-ups disabled for user ${userId}`);
        return null;
      }

      // 2. Fetch user profile preferred name
      const { data: profile } = await qt.track('moment_get_profile', 'profiles', () =>
        supabaseAdmin.from('profiles').select('preferred_name').eq('id', userId).maybeSingle()
      );
      const preferredName = profile?.preferred_name || 'there';

      // 3. Fetch goals from memories table
      const { data: memories } = await qt.track('moment_get_goal_memories', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select('id, key, value, updated_at')
          .eq('user_id', userId)
          .eq('memory_type', 'goals')
          .eq('is_archived', false)
      );

      // 4. Fetch goals from Knowledge Graph nodes
      const { data: kgGoals } = await qt.track('moment_get_goal_kg', 'kg_nodes', () =>
        supabaseAdmin
          .from('kg_nodes')
          .select('id, name, attributes, updated_at')
          .eq('user_id', userId)
          .eq('entity_type', 'goal')
      );

      const goalsList: string[] = [];
      const memoryMap = new Map<string, string>(); // description -> memory/node ID

      if (memories && memories.length > 0) {
        for (const mem of memories) {
          goalsList.push(`Goal memory [ID: ${mem.id}]: Key: "${mem.key}", Value: "${mem.value}"`);
          memoryMap.set(mem.id, mem.id);
        }
      }

      if (kgGoals && kgGoals.length > 0) {
        for (const node of kgGoals) {
          const desc = `Goal KG Node [ID: ${node.id}]: Name: "${node.name}", Attributes: ${JSON.stringify(node.attributes)}`;
          goalsList.push(desc);
          memoryMap.set(node.id, node.id);
        }
      }

      if (goalsList.length === 0) {
        logger.debug(`No active goals found for user ${userId}`);
        return null;
      }

      // 5. Query last goal follow-ups to prevent spamming the same goals
      const { data: pastMoments } = await qt.track('moment_get_past_goals', 'user_moments', () =>
        supabaseAdmin
          .from('user_moments')
          .select('source_memory_id, created_at')
          .eq('user_id', userId)
          .eq('moment_type', MomentType.GOAL_FOLLOW_UP)
          .order('created_at', { ascending: false })
          .limit(5)
      );

      const pastMomentIds = (pastMoments || []).map(m => m.source_memory_id).filter(Boolean);

      const result = await novaBrain.evaluateGoalFollowup(preferredName, goalsList, pastMomentIds);

      if (result.shouldNotify && result.body) {
        // Validate source_memory_id exists in our map or goals
        let sourceId: string | null = null;
        if (result.source_memory_id && memoryMap.has(result.source_memory_id)) {
          sourceId = result.source_memory_id;
        }

        return {
          user_id: userId,
          moment_type: MomentType.GOAL_FOLLOW_UP,
          title: result.title || 'Goal Check-in',
          body: result.body,
          source_memory_id: sourceId
        };
      }

      return null;
    } catch (err) {
      logger.error(`Error in checkGoalFollowups for user ${userId}`, { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /**
   * Checks if user has child milestones/relationships and evaluates if a check-in is needed.
   */
  async checkChildMilestones(userId: string): Promise<MomentPayload | null> {
    try {
      // 1. Check preferences first
      const prefs = await this.getPreferences(userId);
      if (!prefs.child_milestones_enabled) {
        logger.debug(`Child milestones disabled for user ${userId}`);
        return null;
      }

      // 2. Fetch user profile preferred name
      const { data: profile } = await qt.track('moment_get_profile_child', 'profiles', () =>
        supabaseAdmin.from('profiles').select('preferred_name').eq('id', userId).maybeSingle()
      );
      const preferredName = profile?.preferred_name || 'there';

      // 3. Fetch family/relationships from memories
      const { data: familyMemories } = await qt.track('moment_get_family_memories', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select('id, key, value')
          .eq('user_id', userId)
          .eq('memory_type', 'family')
          .eq('is_archived', false)
      );

      // 4. Fetch KG child nodes and relationships
      // Find person nodes
      const { data: peopleNodes } = await qt.track('moment_get_kg_people', 'kg_nodes', () =>
        supabaseAdmin
          .from('kg_nodes')
          .select('id, name, attributes')
          .eq('user_id', userId)
          .eq('entity_type', 'person')
      );

      // Fetch edges to identify relationship types (e.g. PARENT_OF, FATHER_OF, MOTHER_OF, SON_OF, DAUGHTER_OF)
      const { data: edges } = await qt.track('moment_get_kg_edges', 'kg_edges', () =>
        supabaseAdmin
          .from('kg_edges')
          .select('source_node_id, target_node_id, relation_type')
          .eq('user_id', userId)
      );

      const relationships: string[] = [];
      const memoryMap = new Map<string, string>();

      if (familyMemories && familyMemories.length > 0) {
        for (const mem of familyMemories) {
          relationships.push(`Family memory [ID: ${mem.id}]: Key: "${mem.key}", Value: "${mem.value}"`);
          memoryMap.set(mem.id, mem.id);
        }
      }

      if (peopleNodes && peopleNodes.length > 0 && edges && edges.length > 0) {
        const nodeMap = new Map(peopleNodes.map(n => [n.id, n]));
        for (const edge of edges) {
          const source = nodeMap.get(edge.source_node_id);
          const target = nodeMap.get(edge.target_node_id);
          const relation = edge.relation_type.toUpperCase();

          // Check if relation is parental/child relationship
          if (
            relation.includes('PARENT') ||
            relation.includes('FATHER') ||
            relation.includes('MOTHER') ||
            relation.includes('SON') ||
            relation.includes('DAUGHTER') ||
            relation.includes('CHILD')
          ) {
            const desc = `KG Relationship [ID: ${target?.id || source?.id}]: "${source?.name || 'User'}" is ${relation} of "${target?.name || 'Child'}" (Attributes: ${JSON.stringify(target?.attributes || {})})`;
            relationships.push(desc);
            if (target) memoryMap.set(target.id, target.id);
            if (source) memoryMap.set(source.id, source.id);
          }
        }
      }

      if (relationships.length === 0) {
        logger.debug(`No family or child nodes found for user ${userId}`);
        return null;
      }

      // Query past moments for children to prevent duplicates
      const { data: pastMoments } = await qt.track('moment_get_past_children', 'user_moments', () =>
        supabaseAdmin
          .from('user_moments')
          .select('source_memory_id, created_at')
          .eq('user_id', userId)
          .eq('moment_type', MomentType.CHILD_MILESTONE)
          .order('created_at', { ascending: false })
          .limit(5)
      );

      const pastMomentIds = (pastMoments || []).map(m => m.source_memory_id).filter(Boolean);

      const result = await novaBrain.evaluateChildMilestone(preferredName, relationships, pastMomentIds);

      if (result.shouldNotify && result.body) {
        let sourceId: string | null = null;
        if (result.source_memory_id && memoryMap.has(result.source_memory_id)) {
          sourceId = result.source_memory_id;
        }

        return {
          user_id: userId,
          moment_type: MomentType.CHILD_MILESTONE,
          title: result.title || 'Child Milestone Check-in',
          body: result.body,
          source_memory_id: sourceId
        };
      }

      return null;
    } catch (err) {
      logger.error(`Error in checkChildMilestones for user ${userId}`, { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /**
   * Generates and saves a moment if notification criteria are met.
   */
  async generateMoment(userId: string, type: MomentType, rawData: any): Promise<MomentPayload> {
    const parsed = await novaBrain.refineMoment(type, rawData);

    return {
      user_id: userId,
      moment_type: type,
      title: parsed.title || 'Moment Check-in',
      body: parsed.body || '',
      source_memory_id: rawData.source_memory_id || null
    };
  }

  /**
   * Evaluates if we should notify the user based on rate limits, preferences, and quiet hours.
   */
  async shouldNotify(userId: string): Promise<boolean> {
    try {
      // 1. Fetch preferences
      const prefs = await this.getPreferences(userId);

      // If all toggles are disabled, we do not notify
      if (!prefs.goal_followups_enabled && !prefs.child_milestones_enabled) {
        logger.debug(`All moment notifications are disabled for user ${userId}`);
        return false;
      }

      // 2. Daily frequency safeguard: Max 1 moment notification per day
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const { data: todayMoments, error: momentsError } = await qt.track('moment_check_limit', 'user_moments', () =>
        supabaseAdmin
          .from('user_moments')
          .select('id')
          .eq('user_id', userId)
          .gte('created_at', startOfDay.toISOString())
          .limit(1)
      );

      if (momentsError) {
        logger.error('Failed to check today moments limit', { error: momentsError.message });
        return false;
      }

      if (todayMoments && todayMoments.length > 0) {
        logger.debug(`Daily moment limit reached (max 1/day) for user ${userId}`);
        return false;
      }

      // 3. Respect Quiet Hours
      const { data: profile } = await qt.track('moment_get_timezone', 'profiles', () =>
        supabaseAdmin.from('profiles').select('timezone').eq('id', userId).maybeSingle()
      );

      const timezone = profile?.timezone || 'UTC';
      const isQuiet = this.isCurrentTimeInQuietHours(prefs.quiet_hours, timezone);
      if (isQuiet) {
        logger.debug(`User ${userId} is currently in quiet hours (${prefs.quiet_hours}) in timezone ${timezone}`);
        return false;
      }

      return true;
    } catch (err) {
      logger.error(`Error in shouldNotify check for user ${userId}`, { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /**
   * Helper to check if current time falls within quiet hours range (e.g. "22:00-08:00")
   */
  private isCurrentTimeInQuietHours(quietHoursStr: string, timezone: string): boolean {
    try {
      const match = quietHoursStr.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
      if (!match) return false;

      const startHour = parseInt(match[1], 10);
      const startMin = parseInt(match[2], 10);
      const endHour = parseInt(match[3], 10);
      const endMin = parseInt(match[4], 10);

      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
      });

      // E.g. "14:23"
      const formatted = formatter.format(now);
      const timeMatch = formatted.match(/^(\d{1,2}):(\d{2})$/);
      if (!timeMatch) return false;

      const currentHour = parseInt(timeMatch[1], 10);
      const currentMin = parseInt(timeMatch[2], 10);

      const currentMinutes = currentHour * 60 + currentMin;
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      if (startMinutes <= endMinutes) {
        // e.g. 22:00 to 23:59
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
      } else {
        // e.g. 22:00 to 08:00
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
      }
    } catch (err) {
      logger.warn(`Failed parsing quiet hours or formatting date: ${quietHoursStr}`, { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /**
   * Get user preferences or returns default settings
   */
  async getPreferences(userId: string) {
    const { data, error } = await qt.track('moment_get_prefs', 'user_moment_preferences', () =>
      supabaseAdmin.from('user_moment_preferences').select('*').eq('user_id', userId).maybeSingle()
    );

    if (error) {
      logger.warn(`Failed to fetch preferences for user ${userId}, using defaults`, { error: error.message });
    }

    return {
      goal_followups_enabled: data?.goal_followups_enabled !== false,
      child_milestones_enabled: data?.child_milestones_enabled !== false,
      quiet_hours: data?.quiet_hours || '22:00-08:00'
    };
  }

  /**
   * Update user preferences
   */
  async updatePreferences(userId: string, prefs: { goal_followups_enabled?: boolean; child_milestones_enabled?: boolean; quiet_hours?: string }) {
    const { data, error } = await qt.track('moment_update_prefs', 'user_moment_preferences', () =>
      supabaseAdmin
        .from('user_moment_preferences')
        .upsert({
          user_id: userId,
          ...prefs,
          updated_at: new Date().toISOString()
        })
        .select('*')
        .single()
    );

    if (error) throw error;
    return data;
  }

  /**
   * Save a generated moment to the database
   */
  async saveMoment(payload: MomentPayload): Promise<any> {
    const { data, error } = await qt.track('moment_save_log', 'user_moments', () =>
      supabaseAdmin
        .from('user_moments')
        .insert({
          user_id: payload.user_id,
          moment_type: payload.moment_type,
          title: payload.title,
          body: payload.body,
          source_memory_id: payload.source_memory_id || null,
          status: 'generated'
        })
        .select('*')
        .single()
    );

    if (error) throw error;
    return data;
  }

  /**
   * Tracks telemetry for a moment (open or dismiss status)
   */
  async trackMomentStatus(momentId: string, status: 'opened' | 'dismissed'): Promise<void> {
    const updates: any = { status };
    if (status === 'opened') {
      updates.opened_at = new Date().toISOString();
    } else if (status === 'dismissed') {
      updates.dismissed_at = new Date().toISOString();
    }

    const { error } = await qt.track('moment_update_status', 'user_moments', () =>
      supabaseAdmin.from('user_moments').update(updates).eq('id', momentId)
    );

    if (error) {
      logger.error(`Failed to update moment status to ${status}`, { momentId, error: error.message });
      throw error;
    }
  }

  /**
   * Fetch aggregate telemetry metrics for moment activity
   */
  async getTelemetryMetrics() {
    const { count: generatedCount } = await qt.track('moment_telemetry_gen', 'user_moments', () =>
      supabaseAdmin.from('user_moments').select('id', { count: 'exact', head: true })
    );

    const { count: openedCount } = await qt.track('moment_telemetry_open', 'user_moments', () =>
      supabaseAdmin.from('user_moments').select('id', { count: 'exact', head: true }).not('opened_at', 'is', null)
    );

    const { count: dismissedCount } = await qt.track('moment_telemetry_dismiss', 'user_moments', () =>
      supabaseAdmin.from('user_moments').select('id', { count: 'exact', head: true }).not('dismissed_at', 'is', null)
    );

    return {
      moments_generated: generatedCount || 0,
      moments_opened: openedCount || 0,
      moments_dismissed: dismissedCount || 0
    };
  }

  /**
   * Analyzes chat history timestamps to detect repeating daily patterns
   */
  async detectActivityPatterns(userId: string): Promise<void> {
    const { data } = await supabaseAdmin
      .from('chat_history')
      .select('created_at, content')
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
      .order('created_at', { ascending: true });
    
    if (!data || data.length < 10) return;
    
    const hourBuckets: Map<number, string[]> = new Map();
    for (const msg of data) {
      const hour = new Date(msg.created_at).getUTCHours();
      if (!hourBuckets.has(hour)) hourBuckets.set(hour, []);
      hourBuckets.get(hour)!.push(msg.content.substring(0, 50));
    }
    
    let peakSummary = '';
    for (const [hour, msgs] of hourBuckets.entries()) {
      if (msgs.length >= 3) {
        const istHour = (hour + 5) % 24; // roughly +5:30 IST
        const ampm = istHour >= 12 ? 'PM' : 'AM';
        const displayHour = (istHour % 12) || 12;
        peakSummary += `- Active around ${displayHour} ${ampm} (IST). Topics: ${msgs.slice(0, 2).join(' | ')}\n`;
      }
    }

    if (peakSummary) {
      await qt.track('update_activity_pattern', 'working_memory', () =>
        supabaseAdmin.from('working_memory').upsert({
          user_id: userId,
          key: 'user_activity_pattern',
          value: `Detected Routine Activity:\n${peakSummary}`,
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
        })
      );
    }
  }

  /**
   * Triggers the engine run for all onboarded users.
   */
  async runEngineForAllUsers(): Promise<number> {
    logger.info('Starting Moment Engine check loop for all onboarded users...');
    let processedCount = 0;

    try {
      const { data: profiles, error } = await qt.track('moment_get_all_users', 'profiles', () =>
        supabaseAdmin.from('profiles').select('id').eq('onboarding_completed', true)
      );

      if (error || !profiles) {
        logger.error('Failed to retrieve profiles for Moment Engine run', { error: error?.message });
        return 0;
      }

      for (const p of profiles) {
        // Detect activity patterns proactively
        this.detectActivityPatterns(p.id).catch(err => {
          logger.error('Failed detecting patterns', { error: String(err) });
        });

        const canNotify = await this.shouldNotify(p.id);
        if (!canNotify) continue;

        // Try checking goal follow-ups
        let moment = await this.checkGoalFollowups(p.id);

        // If no goal follow-up, try child milestones
        if (!moment) {
          moment = await this.checkChildMilestones(p.id);
        }

        if (moment) {
          // Double check grounding using refine logic
          const refined = await this.generateMoment(p.id, moment.moment_type, moment);
          await this.saveMoment(refined);
          logger.info(`Generated and saved moment for user ${p.id} (${moment.moment_type})`);
          processedCount++;

          // Send push notification for proactive moment (fire & forget)
          try {
            const { data: profileData } = await supabaseAdmin
              .from('profiles')
              .select('push_token')
              .eq('id', p.id)
              .maybeSingle();
            if (profileData?.push_token) {
              await sendMomentNotification(
                profileData.push_token,
                refined.title || 'Nova',
                refined.body
              );
              logger.info(`Push notification sent for moment to user ${p.id}`);
            }
          } catch (pushErr) {
            logger.warn('Failed to send moment push notification (non-critical)', {
              error: pushErr instanceof Error ? pushErr.message : String(pushErr)
            });
          }
        }
      }
    } catch (err) {
      logger.error('Error during runEngineForAllUsers execution', { error: err instanceof Error ? err.message : String(err) });
    }

    return processedCount;
  }
}

export const momentEngineService = new MomentEngineService();
