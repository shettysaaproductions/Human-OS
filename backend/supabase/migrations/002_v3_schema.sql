-- Human OS v3 Schema Update

-- 1. Modify existing memories table
ALTER TABLE memories ADD COLUMN frequency INTEGER DEFAULT 1;
ALTER TABLE memories ADD COLUMN emotional_weight INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN is_archived BOOLEAN DEFAULT false;

-- 2. Working Memory (Short-term, high volatility)
CREATE TABLE working_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_working_memory_user ON working_memory(user_id);

-- 3. Episodic Memories (Events over time)
CREATE TABLE episodic_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  summary TEXT NOT NULL,
  emotion TEXT,
  emotional_valence INTEGER DEFAULT 0, -- -10 to +10
  source_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_episodic_user ON episodic_memories(user_id);

-- 4. Knowledge Graph Nodes
CREATE TABLE kg_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- person, place, concept, goal
  attributes JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kg_nodes_user ON kg_nodes(user_id);

-- 5. Knowledge Graph Edges
CREATE TABLE kg_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_node_id UUID REFERENCES kg_nodes(id) ON DELETE CASCADE,
  target_node_id UUID REFERENCES kg_nodes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL, -- LOVES, FATHER_OF, HAS_GOAL
  weight INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kg_edges_user ON kg_edges(user_id);
CREATE INDEX idx_kg_edges_source ON kg_edges(source_node_id);

-- 6. Emotional States (Mood tracking)
CREATE TABLE emotional_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  mood TEXT NOT NULL,
  intensity INTEGER DEFAULT 5,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_emotional_states_user ON emotional_states(user_id);

-- 7. Reflections (Summaries)
CREATE TABLE reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  reflection_type TEXT NOT NULL, -- daily, weekly
  summary TEXT NOT NULL,
  key_takeaways JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_reflections_user ON reflections(user_id);
