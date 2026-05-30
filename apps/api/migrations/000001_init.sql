-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE worlds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL,
  role TEXT,
  input JSONB NOT NULL,
  personality_dna JSONB NOT NULL,
  archetype TEXT NOT NULL,
  scene_name TEXT NOT NULL,
  quote TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  share_slug TEXT UNIQUE,
  selected_variant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE world_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  variant_no INTEGER NOT NULL,
  seed TEXT NOT NULL,
  config JSONB NOT NULL,
  thumbnail_url TEXT,
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(world_id, variant_no),
  UNIQUE(world_id, seed)
);

ALTER TABLE worlds
  ADD CONSTRAINT worlds_selected_variant_fk
  FOREIGN KEY (selected_variant_id)
  REFERENCES world_variants(id)
  ON DELETE SET NULL;

CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  request_json JSONB,
  response_json JSONB,
  usage_json JSONB,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_a_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  world_b_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  match_seed TEXT NOT NULL,
  compatibility_score INTEGER NOT NULL CHECK (compatibility_score >= 0 AND compatibility_score <= 100),
  match_archetype TEXT NOT NULL,
  analysis JSONB NOT NULL,
  scene_config JSONB NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  share_slug TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_worlds_share_slug ON worlds(share_slug);
CREATE INDEX idx_worlds_created_at ON worlds(created_at DESC);
CREATE INDEX idx_world_variants_world_id ON world_variants(world_id);
CREATE INDEX idx_matches_share_slug ON matches(share_slug);
CREATE INDEX idx_ai_generations_task_created_at ON ai_generations(task, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS matches;
ALTER TABLE worlds DROP CONSTRAINT IF EXISTS worlds_selected_variant_fk;
DROP TABLE IF EXISTS world_variants;
DROP TABLE IF EXISTS ai_generations;
DROP TABLE IF EXISTS worlds;
