export type MemoryType = 'family' | 'personal' | 'work' | 'goals' | 'preferences' | 'health' | 'important_dates';

export interface Memory {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  key: string;
  value: string;
  importance: number;
  confidence: number;
  frequency: number;
  emotional_weight: number;
  is_archived: boolean;
  is_user_confirmed: boolean;
  source_message?: string;
  last_accessed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ExtractedMemory {
  shouldPersist: boolean;
  type: MemoryType;
  key: string;
  value: string;
  importance: number;
  confidence: number;
  frequency?: number;
  emotional_weight?: number;
  source_message_id?: string;
}

export interface WorkingMemory {
  id: string;
  user_id: string;
  key: string;
  value: string;
  created_at: Date;
  expires_at?: Date;
}

export interface EpisodicMemory {
  id: string;
  user_id: string;
  summary: string;
  emotion?: string;
  emotional_valence: number;
  source_message_id?: string;
  created_at: Date;
}

export interface KgNode {
  id: string;
  user_id: string;
  name: string;
  entity_type: string;
  attributes: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface KgEdge {
  id: string;
  user_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  weight: number;
  created_at: Date;
  updated_at: Date;
}

export interface EmotionalState {
  id: string;
  user_id: string;
  mood: string;
  intensity: number;
  notes?: string;
  created_at: Date;
}

export interface Reflection {
  id: string;
  user_id: string;
  reflection_type: 'daily' | 'weekly';
  summary: string;
  key_takeaways: Record<string, any>;
  created_at: Date;
}
