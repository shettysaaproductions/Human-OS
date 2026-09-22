-- Migration 20260922: Add unique index to kg_edges on (user_id, source_node_id, target_node_id, relation_type)
-- Enforces Gate 8: Database Constraint / Transaction Safety for relationship edges

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_edges_canonical_unique 
  ON public.kg_edges(user_id, source_node_id, target_node_id, relation_type);
