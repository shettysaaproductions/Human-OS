import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletion } from '../lib/nvidia';
import { supabaseAdmin } from '../lib/supabase';
import { KgNode } from '../types/memory';
import { logger } from '../lib/logger';

export class KgAgent extends BaseAgent {
  constructor() {
    super('KgAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { userId, message } = job.payload;

    const response = await chatCompletion([
      {
        role: 'system',
        content: `You are the Knowledge Graph Agent for HumanOS.
Analyze the user's message and extract entities and relationships.

Return ONLY a valid JSON object:
{
  "kg_nodes": [
    {
      "name": "string",
      "entity_type": "person" | "place" | "concept" | "goal" | "object",
      "attributes": { "key": "value" }
    }
  ],
  "kg_edges": [
    {
      "source_node_name": "User or a node from kg_nodes",
      "target_node_name": "node from kg_nodes",
      "relation_type": "string (e.g., LOVES, VISITED, OWNS)",
      "weight": 1-10
    }
  ]
}
If no graph entities are found, return {"kg_nodes": [], "kg_edges": []}.`
      },
      {
        role: 'user',
        content: message
      }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.1 
    });

    const parsed = JSON.parse(response) as { 
      kg_nodes: Omit<KgNode, 'id' | 'user_id' | 'created_at' | 'updated_at'>[],
      kg_edges: any[]
    };
    
    const nodes = parsed.kg_nodes || [];
    const edges = parsed.kg_edges || [];
    
    let created = 0;

    if (nodes.length > 0) {
      const nodeMap = new Map<string, string>(); // name -> uuid
      
      // Upsert Nodes
      for (const node of nodes) {
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
          if (inserted) {
             nodeId = inserted.id;
             created++;
          }
          else continue;
        }
        nodeMap.set(node.name, nodeId);
      }

      // Insert Edges
      if (edges.length > 0) {
        for (const edge of edges) {
          let sourceId = nodeMap.get((edge as any).source_node_name);
          let targetId = nodeMap.get((edge as any).target_node_name);
          
          if ((edge as any).source_node_name === 'User') {
             // Get or create 'User' node
             const { data: userNode } = await supabaseAdmin.from('kg_nodes').select('id').eq('user_id', userId).eq('name', 'User').maybeSingle();
             if (userNode) sourceId = userNode.id;
             else {
               const { data: newU } = await supabaseAdmin.from('kg_nodes').insert({ user_id: userId, name: 'User', entity_type: 'person', attributes: {} }).select('id').single();
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
            created++;
          }
        }
      }
    }
    
    return created;
  }
}

export const kgAgent = new KgAgent();
