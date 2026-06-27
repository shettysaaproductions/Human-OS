export type MemoryType = 'family' | 'personal' | 'work' | 'goals' | 'preferences' | 'health' | 'important_dates';

export interface Memory {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  key: string;
  value: string;
  importance: number;
  confidence: number;
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
  source_message_id?: string;
}
