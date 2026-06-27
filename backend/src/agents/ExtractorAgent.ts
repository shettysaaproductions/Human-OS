import { chatCompletion } from '../lib/nvidia';
import { 
  ExtractedMemory, 
  WorkingMemory, 
  EpisodicMemory, 
  KgNode, 
  KgEdge, 
  EmotionalState 
} from '../types/memory';
import { logger } from '../lib/logger';
import { memoryRepository } from '../services/memoryRepository';
import { supabaseAdmin } from '../lib/supabase';

export interface ExtractionResult {
  semantic_memories: ExtractedMemory[];
  working_memories: Omit<WorkingMemory, 'id' | 'user_id' | 'created_at'>[];
  episodic_memories: Omit<EpisodicMemory, 'id' | 'user_id' | 'created_at'>[];
  kg_nodes: Omit<KgNode, 'id' | 'user_id' | 'created_at' | 'updated_at'>[];
  kg_edges: Omit<KgEdge, 'id' | 'user_id' | 'created_at' | 'updated_at'>[];
  emotional_state: Omit<EmotionalState, 'id' | 'user_id' | 'created_at'> | null;
}

export class ExtractorAgent {
  
  /**
   * Calls the NVIDIA LLM to extract all memory modalities from a user message.
   */
  async extractAll(userMessage: string): Promise<ExtractionResult | null> {
    try {
      const response = await chatCompletion([
        {
          role: 'system',
          content: `You are the Multi-Modal Memory Extraction Engine for HumanOS.
Analyze the user's message and extract information into the following categories. 
Return ONLY a valid JSON object with the exact keys specified below. If a category has no items, return an empty array or null for that key.

Categories to extract:
1. "semantic_memories": Long-term facts, preferences, goals. (Array)
   - shouldPersist (boolean)
   - type ("family" | "personal" | "work" | "goals" | "preferences" | "health" | "important_dates")
   - key (snake_case identifier)
   - value (string)
   - importance (0-100)
   - confidence (0.0-1.0)
   - emotional_weight (-10 to 10)

2. "working_memories": Short-term context, tasks for today, current temporary states. (Array)
   - key (snake_case)
   - value (string)
   - expires_in_hours (number, default 24)

3. "episodic_memories": Events or experiences that just happened. (Array)
   - summary (string, e.g., "Went to the park with dog")
   - emotion (string, e.g., "happy", "frustrated")
   - emotional_valence (-10 to 10)

4. "kg_nodes": Entities mentioned (people, places, concepts). (Array)
   - name (string)
   - entity_type ("person", "place", "concept", "goal", "object")
   - attributes (object with key-value string pairs)

5. "kg_edges": Relationships between the USER and the extracted kg_nodes. (Array)
   - source_node_name (MUST be "User" or match a name in kg_nodes)
   - target_node_name (MUST match a name in kg_nodes)
   - relation_type (string, e.g., "LOVES", "FATHER_OF", "WANTS_TO_VISIT")
   - weight (1-10)

6. "emotional_state": The overall current mood of the user based on the message. (Object or null)
   - mood (string)
   - intensity (1-10)
   - notes (string explanation)

Ensure the output is strictly valid JSON.`
        },
        {
          role: 'user',
          content: userMessage
        }
      ], {
        response_format: { type: 'json_object' },
        temperature: 0.1 
      });

      const parsed = JSON.parse(response) as ExtractionResult;
      
      // Ensure defaults
      return {
        semantic_memories: parsed.semantic_memories || [],
        working_memories: parsed.working_memories || [],
        episodic_memories: parsed.episodic_memories || [],
        kg_nodes: parsed.kg_nodes || [],
        kg_edges: parsed.kg_edges || [],
        emotional_state: parsed.emotional_state || null
      };

    } catch (err) {
      logger.error('ExtractorAgent failed', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /**
   * Processes the extraction result and saves all entities to the database.
   */
  async processAndSave(userId: string, userMessageId: string, result: ExtractionResult): Promise<void> {
    try {
      // 1. Semantic Memories
      for (const mem of result.semantic_memories) {
        if (mem.shouldPersist) {
          await memoryRepository.upsertMemory(userId, mem, userMessageId);
        }
      }

      // 2. Working Memories
      if (result.working_memories.length > 0) {
        const wmInserts = result.working_memories.map(wm => {
          const expires = new Date();
          expires.setHours(expires.getHours() + (wm as any).expires_in_hours || 24);
          return {
            user_id: userId,
            key: wm.key,
            value: wm.value,
            expires_at: expires.toISOString()
          };
        });
        await supabaseAdmin.from('working_memory').insert(wmInserts);
      }

      // 3. Episodic Memories
      if (result.episodic_memories.length > 0) {
        const epInserts = result.episodic_memories.map(ep => ({
          user_id: userId,
          summary: ep.summary,
          emotion: ep.emotion,
          emotional_valence: ep.emotional_valence,
          source_message_id: userMessageId
        }));
        await supabaseAdmin.from('episodic_memories').insert(epInserts);
      }

      // 4. Emotional State
      if (result.emotional_state) {
        await supabaseAdmin.from('emotional_states').insert({
          user_id: userId,
          mood: result.emotional_state.mood,
          intensity: result.emotional_state.intensity,
          notes: result.emotional_state.notes
        });
      }

      // 5. Knowledge Graph (Nodes and Edges)
      if (result.kg_nodes.length > 0) {
        const nodeMap = new Map<string, string>(); // name -> uuid
        
        // Upsert Nodes
        for (const node of result.kg_nodes) {
          const { data, error } = await supabaseAdmin
            .from('kg_nodes')
            .select('id')
            .eq('user_id', userId)
            .eq('name', node.name)
            .maybeSingle();

          if (error) {
            logger.warn('Error checking kg_nodes', { error: error.message });
          }

          let nodeId: string;
          if (data) {
            nodeId = data.id;
            // Optionally update attributes here
          } else {
            const { data: inserted } = await supabaseAdmin
              .from('kg_nodes')
              .insert({
                user_id: userId,
                name: node.name,
                entity_type: node.entity_type,
                attributes: node.attributes
              })
              .select('id')
              .single();
            if (inserted) nodeId = inserted.id;
            else continue;
          }
          nodeMap.set(node.name, nodeId);
        }

        // Insert Edges
        if (result.kg_edges.length > 0) {
          for (const edge of result.kg_edges) {
            // "User" is implicitly the user_id, but our schema expects source_node_id to be a kg_node.
            // Let's ensure a "User" node exists if needed, or handle it.
            // Actually, for simplicity, let's just make sure "User" is created as a node if it's the source.
            let sourceId = nodeMap.get((edge as any).source_node_name);
            let targetId = nodeMap.get((edge as any).target_node_name);
            
            if ((edge as any).source_node_name === 'User') {
               // Get or create 'User' node
               const { data: userNode } = await supabaseAdmin.from('kg_nodes').select('id').eq('user_id', userId).eq('name', 'User').maybeSingle();
               if (userNode) sourceId = userNode.id;
               else {
                 const { data: newU } = await supabaseAdmin.from('kg_nodes').insert({ user_id: userId, name: 'User', entity_type: 'person' }).select('id').single();
                 if (newU) sourceId = newU.id;
               }
            }

            if (sourceId && targetId) {
              await supabaseAdmin.from('kg_edges').insert({
                user_id: userId,
                source_node_id: sourceId,
                target_node_id: targetId,
                relation_type: edge.relation_type,
                weight: edge.weight
              });
            }
          }
        }
      }

    } catch (err) {
      logger.error('ExtractorAgent save failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  extractKeywords(userMessage: string): string[] {
    const stopWords = new Set(['i', 'am', 'the', 'a', 'to', 'and', 'my', 'is', 'in', 'it', 'that', 'of', 'for', 'with', 'on', 'this', 'but', 'what', 'should', 'about']);
    const words = userMessage
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
    return Array.from(new Set(words));
  }
}

export const extractorAgent = new ExtractorAgent();
